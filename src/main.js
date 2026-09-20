import * as THREE from 'three';
import { buildEnvironment } from './environment.js';
import { loadCharacter } from './character.js';
import { loadLocomotionAnimator } from './animation.js';
import { ThirdPersonController } from './ThirdPersonController.js';

const app = document.getElementById('app');
const hint = document.getElementById('hint');
const placeholderBanner = document.getElementById('placeholder-banner');

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  500
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

buildEnvironment(scene);

const { root: character, isPlaceholder } = await loadCharacter();
scene.add(character);
if (isPlaceholder) placeholderBanner.classList.add('visible');

const animator = await loadLocomotionAnimator(character);

const controller = new ThirdPersonController(camera, character, renderer.domElement);

if (import.meta.env.DEV) {
  window.__debugController = controller;
  window.__debugCharacter = character;
  window.__debugAnimator = animator;
}

function requestLock() {
  if (document.pointerLockElement !== renderer.domElement) {
    renderer.domElement.requestPointerLock();
  }
}
// The hint overlay sits on top of the canvas (so it can show "click to
// play"), which means the initial click lands on it, not the canvas -
// it needs its own listener or pointer lock would never engage.
hint.addEventListener('click', requestLock);
renderer.domElement.addEventListener('click', requestLock);
document.addEventListener('pointerlockchange', () => {
  hint.classList.toggle('hidden', document.pointerLockElement === renderer.domElement);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.1);
  controller.update(delta);
  if (animator) {
    animator.setMoving(controller.isMoving, delta);
    animator.update(delta);
  }
  renderer.render(scene, camera);
}
animate();
