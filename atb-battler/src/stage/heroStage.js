import * as THREE from 'three';
import { loadHeroModel } from './heroModel.js';

const ELEMENT_COLORS = { fire: 0xff6a3d, ice: 0x6fd3ff, thunder: 0xf7e05a };
const HEAL_COLOR = 0x6dffa8;
const GUARD_COLOR = 0x6f9bff;
const HIT_COLOR = new THREE.Color(0xff3030);
const HEAD_HEIGHT = 1.95;

// The hero stands with their back three-quarters to the camera, facing the
// enemies "up" the screen (+z). Attacks lunge toward +z.
const FACING = 0.35;

function blobShadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/**
 * A transparent Three.js layer that renders only the hero, with
 * procedural battle moves (lunge, cast ring, hit flash, KO fall) driven by
 * engine events. Real Mixamo action clips can replace these later.
 */
export class HeroStage {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.className = 'stage-canvas';
    container.prepend(this.renderer.domElement);

    this.scene = new THREE.Scene();
    // Framed so the hero's full body fills the lower part of the field,
    // leaving the top clear for the enemy cards.
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    this.camera.position.set(-1.3, 2.0, -6.2);
    this.camera.lookAt(0.4, 1.4, 2);

    this.scene.add(new THREE.HemisphereLight(0xcfd8ff, 0x2a2440, 2.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(-3, 5, -4);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xffc98a, 1.6);
    rim.position.set(3, 3, 5);
    this.scene.add(rim);

    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 1.6),
      new THREE.MeshBasicMaterial({ map: blobShadowTexture(), transparent: true, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.01;
    this.scene.add(shadow);

    // pivot carries procedural offsets; the model inside keeps its normalized transform.
    this.pivot = new THREE.Group();
    this.pivot.rotation.y = FACING;
    this.scene.add(this.pivot);

    this.tweens = [];
    this.effects = [];
    this.materials = [];
    this.animator = null;
    this.flash = 0;
    this.headPos = new THREE.Vector3();

    this.ready = loadHeroModel().then(({ root, materials, animator }) => {
      this.pivot.add(root);
      this.materials = materials.filter((m) => m.emissive);
      this.animator = animator;
    });

    this.resize();
    new ResizeObserver(() => this.resize()).observe(container);
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  reset() {
    this.tweens = [];
    for (const fx of this.effects) this.scene.remove(fx.mesh);
    this.effects = [];
    this.flash = 0;
    this.animator?.reset();
  }

  // Plays a baked clip if there is one; returns false so callers can fall
  // back to a procedural move (e.g. when the clips failed to load).
  clip(name) {
    if (!this.animator?.has(name)) return false;
    this.animator.play(name);
    return true;
  }

  setHurt(hurt) {
    this.animator?.setHurt(hurt);
  }

  // ---------- Moves ----------
  attack() {
    const animated = this.clip('attack');
    // Step in toward the enemies; the clip swings in place.
    this.tween(animated ? 0.9 : 0.45, (p, o) => {
      const s = Math.sin(Math.PI * p);
      o.z += s * (animated ? 0.8 : 1.1);
      if (!animated) o.rotX += s * 0.25;
    });
  }

  cast(element) {
    if (!this.clip('cast')) {
      this.tween(0.5, (p, o) => {
        o.y += Math.sin(Math.PI * p) * 0.18;
      });
    }
    this.ring(ELEMENT_COLORS[element] ?? 0xffffff);
  }

  heal() {
    this.clip('heal');
    this.ring(HEAL_COLOR);
  }

  defend() {
    this.clip('defend');
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1.1, 24, 16),
      new THREE.MeshBasicMaterial({ color: GUARD_COLOR, transparent: true, opacity: 0.35, depthWrite: false })
    );
    mesh.position.y = 0.95;
    this.effect(mesh, 0.7, (p, m) => {
      m.material.opacity = 0.35 * (1 - p);
      m.scale.setScalar(0.9 + p * 0.2);
    });
  }

  hit() {
    this.flash = 1;
    this.clip('hit');
    this.tween(0.3, (p, o) => {
      o.z -= Math.sin(Math.PI * p) * 0.3;
    });
  }

  ko() {
    if (this.clip('ko')) return;
    this.tween(0.7, (p, o) => {
      o.rotX -= p * 1.45;
      o.z -= p * 0.4;
    }, true);
  }

  victory() {
    if (this.clip('victory')) return;
    this.tween(0.6, (p, o) => {
      o.y += Math.sin(Math.PI * p) * 0.35;
      o.rotY += p * Math.PI * 2;
    });
  }

  // ---------- Internals ----------
  tween(duration, apply, hold = false) {
    this.tweens.push({ t: 0, duration, apply, hold });
  }

  ring(color) {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.7, 48),
      new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.03;
    this.effect(mesh, 0.7, (p, m) => {
      m.scale.setScalar(0.4 + p * 1.6);
      m.material.opacity = 1 - p;
      m.position.y = 0.03 + p * 0.9;
    });
  }

  effect(mesh, duration, apply) {
    this.scene.add(mesh);
    this.effects.push({ mesh, t: 0, duration, apply });
  }

  // battleDt follows the game's speed setting.
  update(realDt, battleDt) {
    this.animator?.update(battleDt);

    const o = { y: 0, z: 0, rotX: 0, rotY: 0 };
    this.tweens = this.tweens.filter((tw) => {
      tw.t = Math.min(tw.duration, tw.t + battleDt);
      tw.apply(tw.t / tw.duration, o);
      return tw.t < tw.duration || tw.hold;
    });
    this.pivot.position.set(0, o.y, o.z);
    this.pivot.rotation.set(o.rotX, FACING + o.rotY, 0);

    this.effects = this.effects.filter((fx) => {
      fx.t += battleDt;
      fx.apply(Math.min(1, fx.t / fx.duration), fx.mesh);
      if (fx.t < fx.duration) return true;
      this.scene.remove(fx.mesh);
      fx.mesh.geometry.dispose();
      fx.mesh.material.dispose();
      return false;
    });

    this.flash = Math.max(0, this.flash - battleDt * 4);
    for (const m of this.materials) m.emissive.copy(HIT_COLOR).multiplyScalar(this.flash * 0.8);

    this.renderer.render(this.scene, this.camera);
  }

  // Where the hero's head is, in CSS pixels relative to the container.
  headScreenPosition() {
    this.headPos.set(0, HEAD_HEIGHT, 0).applyMatrix4(this.pivot.matrixWorld).project(this.camera);
    return {
      x: ((this.headPos.x + 1) / 2) * this.container.clientWidth,
      y: ((1 - this.headPos.y) / 2) * this.container.clientHeight,
    };
  }
}
