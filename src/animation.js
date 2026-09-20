import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const ANIM_SOURCE_URL = '/assets/anim_source/Soldier.glb';
const HIP_BONE_NAME = 'mixamorigHips';
const BLEND_RATE = 6; // higher = snappier idle/walk transition
const TRACK_NAME_RE = /^(.+)\.(quaternion|position)$/;

/**
 * Blends between an idle and a walk clip based on movement state. Both
 * actions play simultaneously and their weights are cross-faded, which
 * avoids popping and lets partial speeds (if ever added) blend smoothly.
 */
class LocomotionAnimator {
  constructor(mixer, idleAction, walkAction) {
    this.mixer = mixer;
    this.idleAction = idleAction;
    this.walkAction = walkAction;
    this.blend = 0; // 0 = fully idle, 1 = fully walking

    idleAction.play();
    walkAction.play();
    idleAction.setEffectiveWeight(1);
    walkAction.setEffectiveWeight(0);
  }

  setMoving(isMoving, delta) {
    const target = isMoving ? 1 : 0;
    this.blend += (target - this.blend) * Math.min(1, BLEND_RATE * delta);
    this.idleAction.setEffectiveWeight(1 - this.blend);
    this.walkAction.setEffectiveWeight(this.blend);
  }

  update(delta) {
    this.mixer.update(delta);
  }
}

function findSkinnedMesh(object) {
  let found = null;
  object.traverse((node) => {
    if (!found && node.isSkinnedMesh) found = node;
  });
  return found;
}

/** Applies only the rotation+scale (no translation) part of `matrix` to `vec` in place. */
function applyDirectionOnly(vec, matrix) {
  const m = matrix.elements;
  const { x, y, z } = vec;
  vec.x = m[0] * x + m[4] * y + m[8] * z;
  vec.y = m[1] * x + m[5] * y + m[9] * z;
  vec.z = m[2] * x + m[6] * y + m[10] * z;
  return vec;
}

/**
 * Retargets the hip's translation (root motion) track. This can't reuse a
 * simple local-position subtraction: Soldier's hip bone has its own internal
 * parent scale (its local position and world position differ by orders of
 * magnitude), while the hero's rig doesn't (local == world there), so a
 * naive local-space delta mixes two incompatible units. Instead this drives
 * the source hip bone through each frame, reads its true WORLD-space
 * displacement from rest, scales that by the two skeletons' height ratio,
 * then projects it into the target hip's own local space via its parent's
 * (fixed, since only the hip itself animates) world matrix.
 */
function retargetHipPositionTrack(track, targetHip, sourceHip, heightRatio) {
  const restSourceWorld = new THREE.Vector3();
  sourceHip.getWorldPosition(restSourceWorld);
  const restSourceLocal = sourceHip.position.clone();
  const restTargetLocal = targetHip.position.clone();
  const targetParentWorldInverse = new THREE.Matrix4().copy(targetHip.parent.matrixWorld).invert();

  const n = track.values.length / 3;
  const out = new Float32Array(track.values.length);
  const sample = new THREE.Vector3();
  const worldPos = new THREE.Vector3();
  const localDelta = new THREE.Vector3();

  for (let i = 0; i < n; i++) {
    sample.fromArray(track.values, i * 3);
    sourceHip.position.copy(sample);
    sourceHip.updateMatrixWorld(true);
    sourceHip.getWorldPosition(worldPos);

    localDelta.subVectors(worldPos, restSourceWorld).multiplyScalar(heightRatio);
    applyDirectionOnly(localDelta, targetParentWorldInverse);
    localDelta.add(restTargetLocal);
    localDelta.toArray(out, i * 3);
  }

  sourceHip.position.copy(restSourceLocal);
  sourceHip.updateMatrixWorld(true);

  return out;
}

/**
 * Retargets a clip authored for sourceSkeleton onto targetSkeleton by
 * transplanting each bone's LOCAL rotation delta from its own rest pose,
 * rather than forcing a shared world-space orientation. THREE.SkeletonUtils'
 * retarget() takes the latter approach and it breaks down here: even though
 * both rigs are Mixamo output with identical bone names, each was
 * auto-rigged against a different source mesh, so their bones don't share
 * the same local axis convention at rest - forcing target's world rotation
 * to match source's produces twisted, wildly bent limbs. A local delta
 * (new_local = targetRest * (sourceRest^-1 * animatedLocal)) only ever
 * transplants the *relative* motion, so it's immune to that mismatch as
 * long as both skeletons share the same bone hierarchy/names, which they do.
 */
function retargetLocalDelta(targetSkeleton, sourceSkeleton, sourceClip, { heightRatio }) {
  const targetRestQuat = new Map();
  targetSkeleton.bones.forEach((b) => targetRestQuat.set(b.name, b.quaternion.clone()));
  const sourceRestQuat = new Map();
  sourceSkeleton.bones.forEach((b) => sourceRestQuat.set(b.name, b.quaternion.clone()));

  const tracks = [];
  const q = new THREE.Quaternion();
  const delta = new THREE.Quaternion();

  for (const track of sourceClip.tracks) {
    const match = track.name.match(TRACK_NAME_RE);
    if (!match) continue;
    const [, boneName, prop] = match;

    if (prop === 'quaternion') {
      if (!targetRestQuat.has(boneName) || !sourceRestQuat.has(boneName)) continue; // e.g. finger bones target/source doesn't have
      const targetRest = targetRestQuat.get(boneName);
      const sourceRestInv = sourceRestQuat.get(boneName).clone().invert();
      const n = track.values.length / 4;
      const out = new Float32Array(track.values.length);
      for (let i = 0; i < n; i++) {
        q.fromArray(track.values, i * 4);
        delta.copy(sourceRestInv).multiply(q);
        q.copy(targetRest).multiply(delta);
        q.toArray(out, i * 4);
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(`.bones[${boneName}].quaternion`, track.times.slice(), out));
    } else if (prop === 'position' && boneName === HIP_BONE_NAME) {
      // Only the hip translates (root motion); every other bone keeps
      // target's own limb-length positions and just rotates.
      const targetHip = targetSkeleton.getBoneByName(HIP_BONE_NAME);
      const sourceHip = sourceSkeleton.getBoneByName(HIP_BONE_NAME);
      const out = retargetHipPositionTrack(track, targetHip, sourceHip, heightRatio);
      tracks.push(new THREE.VectorKeyframeTrack(`.bones[${boneName}].position`, track.times.slice(), out));
    }
  }

  return new THREE.AnimationClip(sourceClip.name, sourceClip.duration, tracks);
}

/**
 * Loads the Idle/Walk clips from three.js's official Mixamo-rigged "Soldier"
 * demo asset and retargets them onto root's own skeleton. Returns null if
 * root has no skinned mesh to animate (e.g. the placeholder).
 */
export async function loadLocomotionAnimator(root) {
  const targetMesh = findSkinnedMesh(root);
  if (!targetMesh) return null;

  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(ANIM_SOURCE_URL);
  const sourceMesh = findSkinnedMesh(gltf.scene);
  const idleSourceClip = gltf.animations.find((clip) => clip.name === 'Idle');
  const walkSourceClip = gltf.animations.find((clip) => clip.name === 'Walk');
  if (!sourceMesh || !idleSourceClip || !walkSourceClip) {
    console.warn('[animation] Expected skeleton/Idle/Walk clips not found in', ANIM_SOURCE_URL);
    return null;
  }

  // root carries the non-unit scale character.js applies to normalize the
  // raw FBX to a fixed height; the skeleton's own bone positions/matrices
  // stay in those raw units. Reset it to identity for the whole retargeting
  // pass (retargetHipPositionTrack reads target hip's parent world matrix),
  // and use the two skeletons' raw-unit height ratio to convert the hip's
  // translation between them.
  const previousScale = root.scale.clone();
  root.scale.set(1, 1, 1);
  root.updateMatrixWorld(true);
  const rawBox = new THREE.Box3().setFromObject(root);
  const rawHeight = rawBox.max.y - rawBox.min.y;

  const sourceBox = new THREE.Box3().setFromObject(gltf.scene);
  const sourceHeight = sourceBox.max.y - sourceBox.min.y;
  const heightRatio = rawHeight / sourceHeight;

  const idleClip = retargetLocalDelta(targetMesh.skeleton, sourceMesh.skeleton, idleSourceClip, { heightRatio });
  const walkClip = retargetLocalDelta(targetMesh.skeleton, sourceMesh.skeleton, walkSourceClip, { heightRatio });

  root.scale.copy(previousScale);
  root.updateMatrixWorld(true);

  // Track paths are unprefixed ".bones[Name]..." paths, which PropertyBinding
  // resolves against the mixer's root directly, so root must be the
  // SkinnedMesh itself (it owns .skeleton), not the enclosing Group.
  const mixer = new THREE.AnimationMixer(targetMesh);
  const idleAction = mixer.clipAction(idleClip);
  const walkAction = mixer.clipAction(walkClip);

  return new LocomotionAnimator(mixer, idleAction, walkAction);
}
