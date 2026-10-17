import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { loadAssetBuffer } from './assets.js';

// Same character and Mixamo idle clip as the third-person prototype in the
// repo root (see ../README.md for where they came from).
const MODEL_PATH = 'hero/hero.fbx';
const IDLE_PATH = 'hero/idle.fbx';
const TARGET_HEIGHT = 1.8;
const TRACK_NAME_RE = /^(.+)\.(quaternion|position)$/;

function findSkinnedMesh(object) {
  let found = null;
  object.traverse((node) => {
    if (!found && node.isSkinnedMesh) found = node;
  });
  return found;
}

// Scale to TARGET_HEIGHT with feet at y=0, whatever units the FBX used.
function normalizeTransform(root) {
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  if (size.y > 0) root.scale.setScalar(TARGET_HEIGHT / size.y);
  const box = new THREE.Box3().setFromObject(root);
  root.position.x -= (box.min.x + box.max.x) / 2;
  root.position.z -= (box.min.z + box.max.z) / 2;
  root.position.y -= box.min.y;
}

// idle.fbx was retargeted to this exact skin by Mixamo, so its tracks only
// need renaming to the ".bones[Name]" form a SkinnedMesh mixer resolves.
function remapToSkinnedMeshTracks(clip, skeleton) {
  const boneNames = new Set(skeleton.bones.map((b) => b.name));
  const tracks = [];
  for (const track of clip.tracks) {
    const match = track.name.match(TRACK_NAME_RE);
    if (!match || !boneNames.has(match[1])) continue;
    const Ctor = match[2] === 'quaternion' ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack;
    tracks.push(new Ctor(`.bones[${match[1]}].${match[2]}`, track.times.slice(), track.values.slice()));
  }
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

function buildPlaceholder() {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x4d6fb0, roughness: 0.6 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.0, 4, 12), mat);
  body.position.y = 0.95;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 16), mat);
  head.position.y = 1.75;
  group.add(body, head);
  return group;
}

/**
 * Returns { root, materials, mixer } — mixer is null for the placeholder.
 * materials are collected so the stage can flash them on hit.
 */
export async function loadHeroModel() {
  const loader = new FBXLoader();
  let root;
  try {
    root = loader.parse(await loadAssetBuffer(MODEL_PATH), '');
  } catch (err) {
    console.warn(`[hero] Could not load ${MODEL_PATH} (${err.message ?? err}); using placeholder.`);
    root = buildPlaceholder();
  }

  const materials = [];
  root.traverse((node) => {
    if (!node.isMesh) return;
    for (const mat of Array.isArray(node.material) ? node.material : [node.material]) {
      // The source FBX has no diffuse textures; give it a visible tint.
      if (!mat.map) mat.color.set(0x9c8f7a);
      materials.push(mat);
    }
  });
  normalizeTransform(root);

  let mixer = null;
  const skinned = findSkinnedMesh(root);
  if (skinned) {
    try {
      const idleSource = loader.parse(await loadAssetBuffer(IDLE_PATH), '');
      const clip = remapToSkinnedMeshTracks(idleSource.animations[0], skinned.skeleton);
      mixer = new THREE.AnimationMixer(skinned);
      mixer.clipAction(clip).play();
    } catch (err) {
      console.warn(`[hero] Idle animation unavailable (${err.message ?? err}).`);
    }
  }

  return { root, materials, mixer };
}
