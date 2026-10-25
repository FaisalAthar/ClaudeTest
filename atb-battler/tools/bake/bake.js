import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createRetargeter, bakeClip, AIM, BONE_MAP } from './retarget.js';

const HERO_URL = '/public/assets/hero/hero.fbx';
const SOURCE_DIR = '/anim-source/';

const sources = new Map();
async function loadSource(file) {
  if (!sources.has(file)) sources.set(file, await new GLTFLoader().loadAsync(SOURCE_DIR + file));
  return sources.get(file);
}

let baked = [];
let sourceYaw = 0;

// clips: { battleName: { file, clip } } → JSON array of AnimationClip.toJSON()
window.bake = async (clips) => {
  const hero = await new FBXLoader().loadAsync(HERO_URL);
  hero.updateMatrixWorld(true);
  baked = [];
  for (const [name, { file, clip }] of Object.entries(clips)) {
    const gltf = await loadSource(file);
    const source = gltf.animations.find((a) => a.name === clip);
    if (!source) throw new Error(`${file} has no clip "${clip}"`);
    const retargeter = createRetargeter(gltf.scene, hero);
    sourceYaw = retargeter.yaw;
    baked.push(bakeClip(retargeter, gltf.scene, source, { name }));
    retargeter.restore();
  }
  return JSON.stringify(baked.map((c) => THREE.AnimationClip.toJSON(c)));
};

// Side-by-side check: source mannequin (left) and the hero with the baked
// clip (right), both posed at the same fraction of the clip.
let view;
window.preview = async (name, fraction, sourceSpec) => {
  if (!view) {
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(640, 400);
    document.body.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1d2e);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 2.5));
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(2, 4, 3);
    scene.add(sun);
    scene.add(new THREE.GridHelper(6, 12, 0x445, 0x334));
    const camera = new THREE.PerspectiveCamera(35, 640 / 400, 0.1, 50);
    camera.position.set(2.2, 1.6, 4.4);
    camera.lookAt(0, 0.9, 0);

    const hero = await new FBXLoader().loadAsync(HERO_URL);
    const size = new THREE.Box3().setFromObject(hero).getSize(new THREE.Vector3());
    hero.scale.setScalar(1.8 / size.y);
    hero.position.x = 0.8;
    hero.traverse((n) => n.isMesh && [n.material].flat().forEach((m) => m.color?.set(0x9c8f7a)));
    scene.add(hero);
    let skinned;
    hero.traverse((n) => n.isSkinnedMesh && !skinned && (skinned = n));
    view = { renderer, scene, camera, heroMixer: new THREE.AnimationMixer(skinned), mannequin: null };
  }
  const clip = baked.find((c) => c.name === name);
  view.heroMixer.stopAllAction();
  view.heroMixer.clipAction(clip).play();
  view.heroMixer.setTime(clip.duration * fraction);

  const gltf = await loadSource(sourceSpec.file);
  if (view.mannequin !== gltf.scene) {
    if (view.mannequin) view.scene.remove(view.mannequin.parent);
    const holder = new THREE.Group();
    holder.position.x = -0.8;
    holder.rotation.y = -sourceYaw; // face the same way as the hero
    holder.add(gltf.scene);
    view.scene.add(holder);
    view.mannequin = gltf.scene;
    view.sourceMixer = new THREE.AnimationMixer(gltf.scene);
  }
  view.sourceMixer.stopAllAction();
  const src = gltf.animations.find((a) => a.name === sourceSpec.clip);
  view.sourceMixer.clipAction(src).play();
  view.sourceMixer.setTime(src.duration * fraction);

  view.renderer.render(view.scene, view.camera);
};

// Numeric check: angle (degrees) between each bone's direction on the source
// and on the retargeted hero, sampled across the clip. Returns the worst bones.
window.verify = async (name, sourceSpec) => {
  const hero = await new FBXLoader().loadAsync(HERO_URL);
  let skinned;
  hero.traverse((n) => n.isSkinnedMesh && !skinned && (skinned = n));
  const heroMixer = new THREE.AnimationMixer(skinned);
  const clip = baked.find((c) => c.name === name);
  heroMixer.clipAction(clip).play();

  const gltf = await loadSource(sourceSpec.file);
  const turntable = new THREE.Group();
  turntable.rotation.y = -sourceYaw;
  turntable.add(gltf.scene);
  const srcMixer = new THREE.AnimationMixer(gltf.scene);
  const src = gltf.animations.find((a) => a.name === sourceSpec.clip);
  srcMixer.clipAction(src).play();

  const byName = (root) => {
    const m = new Map();
    root.traverse((n) => n.isBone && m.set(n.name, n));
    return m;
  };
  const sb = byName(gltf.scene);
  const tb = byName(hero);
  const dir = (a, b) => b.getWorldPosition(new THREE.Vector3()).sub(a.getWorldPosition(new THREE.Vector3())).normalize();
  const worst = new Map();
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    heroMixer.setTime(clip.duration * f);
    srcMixer.setTime(src.duration * f);
    hero.updateMatrixWorld(true);
    turntable.updateMatrixWorld(true);
    for (const [s, aim] of Object.entries(AIM)) {
      const t = tb.get('mixamorig' + BONE_MAP[s]);
      const ta = tb.get('mixamorig' + BONE_MAP[aim]);
      if (!t || !ta) continue;
      const deg = THREE.MathUtils.radToDeg(dir(sb.get(s), sb.get(aim)).angleTo(dir(t, ta)));
      worst.set(s, Math.max(worst.get(s) ?? 0, deg));
    }
  }
  turntable.remove(gltf.scene);
  return [...worst].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([b, d]) => `${b} ${d.toFixed(1)}°`);
};

window.bakeReady = true;
