import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const MODEL_URL = '/assets/character/hero.fbx';
const TARGET_HEIGHT = 1.8; // meters, used to normalize whatever scale the source FBX uses

function buildPlaceholder() {
  const group = new THREE.Group();
  group.name = 'PlaceholderHero';

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x4d6fb0, roughness: 0.6 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0xe0a848, roughness: 0.5 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.0, 4, 12), bodyMat);
  body.position.y = 0.95;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 16), bodyMat);
  head.position.y = 1.75;
  head.castShadow = true;
  group.add(head);

  // Nose cone so the facing direction is obvious at a glance.
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.22, 8), accentMat);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 1.75, 0.3);
  group.add(nose);

  return group;
}

/**
 * Rescales and re-centers a loaded model so it's TARGET_HEIGHT tall with its
 * feet at y=0, regardless of the arbitrary units/pivot the source FBX used.
 */
function normalizeTransform(root) {
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (size.y > 0) {
    const scale = TARGET_HEIGHT / size.y;
    root.scale.setScalar(scale);
  }

  const box2 = new THREE.Box3().setFromObject(root);
  root.position.x -= (box2.min.x + box2.max.x) / 2;
  root.position.z -= (box2.min.z + box2.max.z) / 2;
  root.position.y -= box2.min.y;
}

/**
 * Attempts to load the real Sketchfab-sourced FBX model from
 * /assets/character/hero.fbx (served from the public/ directory).
 * Falls back to a simple placeholder capsule if the file isn't present.
 */
export async function loadCharacter() {
  const loader = new FBXLoader();

  try {
    const root = await loader.loadAsync(MODEL_URL);
    root.traverse((node) => {
      if (node.isMesh) {
        node.castShadow = true;
        node.receiveShadow = true;
        if (node.material) {
          const materials = Array.isArray(node.material) ? node.material : [node.material];
          materials.forEach((mat) => {
            mat.roughness = mat.roughness ?? 0.8;
            // The source FBX ships with no diffuse textures, only a flat
            // near-black material, which reads as an unlit silhouette.
            // Give it a visible neutral tint until real textures are added.
            if (!mat.map) mat.color.set(0x9c8f7a);
          });
        }
      }
    });

    normalizeTransform(root);

    return { root, isPlaceholder: false };
  } catch (err) {
    console.warn(
      `[character] Could not load ${MODEL_URL} (${err.message ?? err}). ` +
        'Using placeholder capsule instead.'
    );
    return { root: buildPlaceholder(), isPlaceholder: true };
  }
}
