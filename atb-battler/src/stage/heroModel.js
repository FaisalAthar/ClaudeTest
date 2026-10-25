import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { loadAssetBuffer } from './assets.js';
import { HeroAnimator } from './heroAnimator.js';

// Same character and Mixamo idle clip as the third-person prototype in the
// repo root (see ../README.md for where they came from).
const MODEL_PATH = 'hero/hero.fbx';
const IDLE_PATH = 'hero/idle.fbx';
// Baked by scripts/bake-animations.mjs from CC0 Mesh2Motion clips.
const BATTLE_ANIMS_PATH = 'hero/battle-anims.json';
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

// A simple low-poly sword in the right hand, so the sword clips read as
// sword attacks. Built in world space at the rest pose, then parented to the
// hand bone so it follows every animation.
function attachSword(root) {
  const hand = root.getObjectByName('mixamorigRightHand');
  const index = root.getObjectByName('mixamorigRightHandIndex1');
  const thumb = root.getObjectByName('mixamorigRightHandThumb2');
  if (!hand || !index || !thumb) return;
  root.updateMatrixWorld(true);
  const at = (o) => o.getWorldPosition(new THREE.Vector3());
  const handPos = at(hand);
  const fingers = at(index).sub(handPos).normalize();
  // Blade leaves the fist on the thumb side, square to the fingers.
  const thumbSide = at(thumb).sub(handPos);
  const blade = thumbSide.sub(fingers.clone().multiplyScalar(thumbSide.dot(fingers))).normalize();

  const steel = new THREE.MeshStandardMaterial({ color: 0xd9dde8, metalness: 0.8, roughness: 0.3 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xb8892f, metalness: 0.6, roughness: 0.45 });
  const sword = new THREE.Group();
  const bladeMesh = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.78, 0.015), steel);
  bladeMesh.position.y = 0.47;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.04), brass);
  guard.position.y = 0.07;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.16, 8), brass);
  grip.position.y = -0.02;
  sword.add(bladeMesh, guard, grip);
  sword.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), blade);
  sword.position.copy(handPos).addScaledVector(fingers, 0.06);
  sword.updateMatrixWorld();
  hand.attach(sword); // keeps the world-space size/pose under the scaled rig
}

/**
 * Returns { root, materials, animator }; animator is null for the placeholder.
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

  let animator = null;
  const skinned = findSkinnedMesh(root);
  if (skinned) {
    attachSword(root);
    try {
      const idleSource = loader.parse(await loadAssetBuffer(IDLE_PATH), '');
      const idle = remapToSkinnedMeshTracks(idleSource.animations[0], skinned.skeleton);
      let battleClips = [];
      try {
        const json = JSON.parse(new TextDecoder().decode(await loadAssetBuffer(BATTLE_ANIMS_PATH)));
        battleClips = json.map((c) => THREE.AnimationClip.parse(c));
      } catch (err) {
        console.warn(`[hero] Battle animations unavailable (${err.message ?? err}).`);
      }
      animator = new HeroAnimator(new THREE.AnimationMixer(skinned), idle, battleClips);
    } catch (err) {
      console.warn(`[hero] Idle animation unavailable (${err.message ?? err}).`);
    }
  }

  return { root, materials, animator };
}
