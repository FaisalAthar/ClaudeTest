import * as THREE from 'three';

// Playback speed per battle move (1 = as authored). The sword swing is sped
// up so it lands inside the engine's ACTION_DURATION window.
const TIME_SCALE = { attack: 1.4 };
// Moves that end in a pose the hero should hold instead of returning to idle.
const HOLD = new Set(['ko', 'victory']);
const FADE_IN = 0.12;
const FADE_OUT = 0.25;

/**
 * Layers one-shot battle moves (attack, cast, hit, ...) over a looping idle.
 * The idle switches to a hurt stance while HP is low.
 */
export class HeroAnimator {
  constructor(mixer, idleClip, clips) {
    this.mixer = mixer;
    this.idle = mixer.clipAction(idleClip);
    this.actions = new Map();
    for (const clip of clips) {
      const action = mixer.clipAction(clip);
      if (clip.name === 'hurtIdle') {
        this.hurtIdle = action;
        continue;
      }
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.timeScale = TIME_SCALE[clip.name] ?? 1;
      this.actions.set(clip.name, action);
    }
    this.hurt = false;
    this.current = null; // active one-shot
    this.held = false;
    mixer.addEventListener('finished', (e) => this.onFinished(e.action));
    this.reset();
  }

  has(name) {
    return this.actions.has(name);
  }

  get base() {
    return this.hurt && this.hurtIdle ? this.hurtIdle : this.idle;
  }

  play(name) {
    const action = this.actions.get(name);
    if (!action || this.held) return;
    const from = this.current ?? this.base;
    action.reset().play();
    if (from !== action) action.crossFadeFrom(from, FADE_IN, false);
    this.current = action;
    this.held = HOLD.has(name);
  }

  setHurt(hurt) {
    if (hurt === this.hurt || !this.hurtIdle) return;
    const from = this.base;
    this.hurt = hurt;
    if (this.current) return; // picked up when the one-shot ends
    this.base.reset().play().crossFadeFrom(from, FADE_OUT, false);
  }

  onFinished(action) {
    if (action !== this.current || this.held) return;
    this.base.reset().play().crossFadeFrom(action, FADE_OUT, false);
    this.current = null;
  }

  reset() {
    this.mixer.stopAllAction();
    this.current = null;
    this.held = false;
    this.hurt = false;
    this.idle.reset().play();
  }

  update(dt) {
    this.mixer.update(dt);
  }
}
