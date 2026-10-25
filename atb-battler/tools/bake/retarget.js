import * as THREE from 'three';

// Mesh2Motion / Quaternius "mannequin" rig → Mixamo rig. The hero has no
// middle/ring/pinky fingers or Thumb1, so those source bones are dropped.
const SIDES = [
  ['l', 'Left'],
  ['r', 'Right'],
];
export const BONE_MAP = {
  pelvis: 'Hips',
  spine_01: 'Spine',
  spine_02: 'Spine1',
  spine_03: 'Spine2',
  neck_01: 'Neck',
  head: 'Head',
};
for (const [s, S] of SIDES) {
  Object.assign(BONE_MAP, {
    [`clavicle_${s}`]: `${S}Shoulder`,
    [`upperarm_${s}`]: `${S}Arm`,
    [`lowerarm_${s}`]: `${S}ForeArm`,
    [`hand_${s}`]: `${S}Hand`,
    [`index_01_${s}`]: `${S}HandIndex1`,
    [`index_02_${s}`]: `${S}HandIndex2`,
    [`index_03_${s}`]: `${S}HandIndex3`,
    [`thumb_02_${s}`]: `${S}HandThumb2`,
    [`thumb_03_${s}`]: `${S}HandThumb3`,
    [`thigh_${s}`]: `${S}UpLeg`,
    [`calf_${s}`]: `${S}Leg`,
    [`foot_${s}`]: `${S}Foot`,
    [`ball_${s}`]: `${S}ToeBase`,
  });
}

// Child each bone "points at", used to line up the two rigs' rest poses.
// Bones not listed (head, fingertips, toes) reuse their parent's alignment.
export const AIM = { pelvis: 'spine_01', spine_01: 'spine_02', spine_02: 'spine_03', spine_03: 'neck_01', neck_01: 'head' };
for (const s of ['l', 'r']) {
  Object.assign(AIM, {
    [`clavicle_${s}`]: `upperarm_${s}`,
    [`upperarm_${s}`]: `lowerarm_${s}`,
    [`lowerarm_${s}`]: `hand_${s}`,
    [`hand_${s}`]: `index_01_${s}`,
    [`index_01_${s}`]: `index_02_${s}`,
    [`index_02_${s}`]: `index_03_${s}`,
    [`thumb_02_${s}`]: `thumb_03_${s}`,
    [`thigh_${s}`]: `calf_${s}`,
    [`calf_${s}`]: `foot_${s}`,
    [`foot_${s}`]: `ball_${s}`,
  });
}

const worldPos = (o) => o.getWorldPosition(new THREE.Vector3());
const worldQuat = (o) => o.getWorldQuaternion(new THREE.Quaternion());

function boneIndex(root) {
  const bones = new Map();
  root.traverse((n) => {
    if (n.isBone) bones.set(n.name, n);
  });
  return bones;
}

// Forward vector from the hips: left thigh minus right thigh, crossed with up.
function facing(leftThigh, rightThigh) {
  const left = worldPos(leftThigh).sub(worldPos(rightThigh)).setY(0).normalize();
  return new THREE.Vector3().crossVectors(left, new THREE.Vector3(0, 1, 0)).normalize();
}

/**
 * Prepares a retargeter from a source scene (mannequin rig, at rest) onto a
 * target object containing a Mixamo-named skeleton (at rest, unscaled).
 *
 * Per bone and frame: take the source bone's WORLD rotation change from its
 * own rest pose, and apply it on top of the target's rest pose after
 * swinging the target bone to point the way the source bone points at rest.
 * Working in world space makes the rigs' different local bone axes
 * irrelevant; the rest alignment cancels their different rest poses
 * (A-pose vs T-pose).
 */
export function createRetargeter(sourceRoot, targetRoot, prefix = 'mixamorig') {
  const src = boneIndex(sourceRoot);
  const tgt = boneIndex(targetRoot);

  // Turn the source so both characters face the same way; otherwise a
  // forward sword swing could come out as a backward one.
  sourceRoot.updateMatrixWorld(true);
  targetRoot.updateMatrixWorld(true);
  const fs = facing(src.get('thigh_l'), src.get('thigh_r'));
  const ft = facing(tgt.get(`${prefix}LeftUpLeg`), tgt.get(`${prefix}RightUpLeg`));
  const yaw = Math.atan2(fs.x, fs.z) - Math.atan2(ft.x, ft.z);
  const turntable = new THREE.Group();
  turntable.rotation.y = -yaw;
  const originalParent = sourceRoot.parent;
  turntable.add(sourceRoot);
  turntable.updateMatrixWorld(true);

  const pairs = [];
  const align = new Map();
  for (const [sName, tShort] of Object.entries(BONE_MAP)) {
    const s = src.get(sName);
    const t = tgt.get(prefix + tShort);
    if (!s || !t) continue;
    pairs.push({ s, t, sRestInv: worldQuat(s).invert(), tRestWorld: worldQuat(t) });
  }
  // Rest alignment, parents before children (BONE_MAP is ordered that way per chain).
  for (const p of pairs) {
    const aimName = AIM[p.s.name];
    const tAim = aimName && tgt.get(prefix + BONE_MAP[aimName]);
    if (tAim) {
      const ds = worldPos(src.get(aimName)).sub(worldPos(p.s)).normalize();
      const dt = worldPos(tAim).sub(worldPos(p.t)).normalize();
      align.set(p.t.name, new THREE.Quaternion().setFromUnitVectors(dt, ds));
    } else {
      const parentPair = pairs.find((q) => q.t === p.t.parent);
      align.set(p.t.name, parentPair ? align.get(parentPair.t.name).clone() : new THREE.Quaternion());
    }
  }

  const sHips = src.get('pelvis');
  const tHips = tgt.get(`${prefix}Hips`);
  const sHipsRest = worldPos(sHips);
  const groundT = new THREE.Box3().setFromObject(targetRoot).min.y;
  const groundS = new THREE.Box3().setFromObject(turntable).min.y;
  const heightRatio = (worldPos(tHips).y - groundT) / (sHipsRest.y - groundS);
  const tHipsRestLocal = tHips.position.clone();
  const tHipsParentInv = new THREE.Matrix3().setFromMatrix4(tHips.parent.matrixWorld).invert();

  // Target bones in parent-first order, with their static rest data.
  const order = [];
  tHips.traverse((n) => n.isBone && order.push(n));
  const tRestLocal = new Map(order.map((b) => [b.name, b.quaternion.clone()]));
  const tHipsParentWorld = worldQuat(tHips.parent);
  const pairByTarget = new Map(pairs.map((p) => [p.t.name, p]));

  function restore() {
    originalParent ? originalParent.add(sourceRoot) : turntable.remove(sourceRoot);
  }

  /** Samples the source's current pose (caller sets it) into target-local values. */
  function sample() {
    turntable.updateMatrixWorld(true);
    const world = new Map();
    const local = new Map();
    for (const bone of order) {
      const parentWorld = bone === tHips ? tHipsParentWorld : world.get(bone.parent.name);
      const pair = pairByTarget.get(bone.name);
      let w;
      if (pair) {
        const delta = worldQuat(pair.s).multiply(pair.sRestInv);
        w = delta.multiply(align.get(bone.name)).multiply(pair.tRestWorld);
      } else {
        w = parentWorld.clone().multiply(tRestLocal.get(bone.name));
      }
      world.set(bone.name, w);
      local.set(bone.name, parentWorld.clone().invert().multiply(w));
    }
    const hipDelta = worldPos(sHips).sub(sHipsRest).multiplyScalar(heightRatio).applyMatrix3(tHipsParentInv);
    return { local, hipPosition: tHipsRestLocal.clone().add(hipDelta) };
  }

  // Only bones in the skin can be animated; end bones (HeadTop_End, Thumb4…)
  // exist in the FBX hierarchy but not in the skeleton.
  const skinned = [];
  targetRoot.traverse((n) => n.isSkinnedMesh && skinned.push(n));
  const skinBones = new Set(skinned.flatMap((m) => m.skeleton.bones.map((b) => b.name)));

  return { sample, restore, order, yaw, skinBones };
}

/** Bakes `clip` (from the source rig) into an AnimationClip for the target rig. */
export function bakeClip(retargeter, sourceRoot, clip, { name, fps = 30 } = {}) {
  const mixer = new THREE.AnimationMixer(sourceRoot);
  const action = mixer.clipAction(clip);
  action.play();
  const frames = Math.max(2, Math.round(clip.duration * fps) + 1);
  const times = [];
  const quats = new Map(retargeter.order.map((b) => [b.name, []]));
  const hip = [];
  for (let i = 0; i < frames; i++) {
    const t = Math.min(clip.duration, i / fps);
    mixer.setTime(t);
    const { local, hipPosition } = retargeter.sample();
    times.push(t);
    for (const [boneName, q] of local) quats.get(boneName).push(q.x, q.y, q.z, q.w);
    hip.push(hipPosition.x, hipPosition.y, hipPosition.z);
  }
  action.stop();
  mixer.uncacheRoot(sourceRoot);

  const round = (v) => Math.round(v * 1e4) / 1e4;
  const tracks = [];
  for (const [boneName, values] of quats) {
    if (!retargeter.skinBones.has(boneName)) continue;
    tracks.push(new THREE.QuaternionKeyframeTrack(`.bones[${boneName}].quaternion`, times, values.map(round)));
  }
  const hipsName = retargeter.order[0].name;
  tracks.push(new THREE.VectorKeyframeTrack(`.bones[${hipsName}].position`, times, hip.map(round)));
  // optimize() drops keyframes that don't change the pose (still fingers etc.).
  return new THREE.AnimationClip(name ?? clip.name, clip.duration, tracks).optimize();
}
