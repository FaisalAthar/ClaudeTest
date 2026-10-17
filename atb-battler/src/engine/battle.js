import { ABILITIES, ENEMIES } from './data.js';
import { computeDamage, computeHeal } from './formulas.js';
import { chooseEnemyAction, chooseHeroAction } from './ai.js';
import { createRng } from './rng.js';

// How long (seconds) an action occupies the field before the next queued one
// resolves. Gauges keep filling meanwhile — that's what makes it "active".
export const ACTION_DURATION = 0.9;
export const WAVE_TRANSITION = 1.5;
// A unit with spd S fills its gauge in 100 / S seconds.
export const ATB_RATE = 1 / 100;

// Unit states:
//   charging — gauge filling
//   ready    — hero only: gauge full, waiting for the player's command
//   queued   — action chosen, waiting its turn in the action queue
//   acting   — its action is currently resolving
//   ko       — dead
function makeUnit(def, id, side) {
  return {
    id,
    side,
    name: def.name,
    maxHp: def.hp,
    hp: def.hp,
    maxMp: def.mp ?? 0,
    mp: def.mp ?? 0,
    atk: def.atk,
    mag: def.mag,
    def: def.def,
    spd: def.spd,
    weak: def.weak ?? [],
    resist: def.resist ?? [],
    abilities: def.abilities ?? [],
    actions: def.actions ?? [],
    boss: !!def.boss,
    atb: 0,
    state: 'charging',
    defending: false,
  };
}

export class Battle {
  constructor({ hero, stage, seed = Date.now(), atbMode = 'active', auto = false }) {
    this.rng = createRng(seed);
    this.hero = makeUnit(hero, 'hero', 'hero');
    this.stage = stage;
    this.atbMode = atbMode;
    this.auto = auto;
    this.waveIndex = -1;
    this.enemies = [];
    this.queue = [];
    this.current = null;
    this.phase = 'idle'; // idle | battle | transition | victory | defeat
    this.transitionTimer = 0;
    this.time = 0;
    this.listeners = new Set();
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(type, payload = {}) {
    const event = { type, time: this.time, ...payload };
    for (const fn of this.listeners) fn(event);
  }

  start() {
    this.startWave(0);
  }

  unit(id) {
    return id === this.hero.id ? this.hero : this.enemies.find((e) => e.id === id);
  }

  livingEnemies() {
    return this.enemies.filter((e) => e.hp > 0);
  }

  get totalWaves() {
    return this.stage.waves.length;
  }

  // Wait mode freezes gauges while the player is deciding; active mode doesn't.
  get gaugesFrozen() {
    return this.atbMode === 'wait' && !this.auto && this.hero.state === 'ready';
  }

  update(dt) {
    if (this.phase === 'transition') {
      this.transitionTimer -= dt;
      if (this.transitionTimer <= 0) this.startWave(this.waveIndex + 1);
      return;
    }
    if (this.phase !== 'battle') return;
    this.time += dt;

    if (!this.gaugesFrozen) {
      for (const u of [this.hero, ...this.enemies]) {
        if (u.state !== 'charging') continue;
        u.atb = Math.min(1, u.atb + dt * u.spd * ATB_RATE);
        if (u.atb >= 1) this.onGaugeFull(u);
      }
    }

    if (this.current) {
      this.current.remaining -= dt;
      if (this.current.remaining <= 0) this.finishAction();
    }
    if (this.phase === 'battle' && !this.current) this.beginNextAction();
  }

  onGaugeFull(u) {
    if (u.side === 'enemy') {
      this.enqueue(u, chooseEnemyAction(u, this));
    } else if (this.auto) {
      this.enqueue(u, chooseHeroAction(this));
    } else {
      u.state = 'ready';
      this.emit('heroReady');
    }
  }

  enqueue(actor, { abilityId, targetId }) {
    actor.state = 'queued';
    this.queue.push({ actorId: actor.id, abilityId, targetId });
    this.emit('queued', { actorId: actor.id, abilityId, targetId });
  }

  // Player input. Returns { ok, reason } so the UI can explain rejections.
  command(abilityId, targetId) {
    const hero = this.hero;
    if (this.phase !== 'battle') return { ok: false, reason: 'not-in-battle' };
    if (hero.state !== 'ready') return { ok: false, reason: 'not-ready' };
    if (!hero.abilities.includes(abilityId)) return { ok: false, reason: 'unknown-ability' };
    const ability = ABILITIES[abilityId];
    if (hero.mp < ability.mp) return { ok: false, reason: 'no-mp' };
    let target = ability.target === 'self' ? hero : this.unit(targetId);
    if (ability.target === 'enemy' && (!target || target.side !== 'enemy' || target.hp <= 0)) {
      target = this.livingEnemies()[0];
    }
    this.enqueue(hero, { abilityId, targetId: target.id });
    return { ok: true };
  }

  setAuto(on) {
    this.auto = on;
    if (on && this.phase === 'battle' && this.hero.state === 'ready') {
      this.enqueue(this.hero, chooseHeroAction(this));
    }
  }

  setAtbMode(mode) {
    this.atbMode = mode;
  }

  beginNextAction() {
    while (this.queue.length) {
      const entry = this.queue.shift();
      const actor = this.unit(entry.actorId);
      if (!actor || actor.hp <= 0) continue;
      let abilityId = entry.abilityId;
      if (actor.mp < ABILITIES[abilityId].mp) abilityId = 'attack';
      const ability = ABILITIES[abilityId];

      let target = this.unit(entry.targetId);
      if (ability.target === 'self') {
        target = actor;
      } else if (!target || target.hp <= 0) {
        // Original target died while this action waited in the queue.
        target = actor.side === 'hero' ? this.livingEnemies()[0] : this.hero;
        if (!target) continue;
      }

      actor.state = 'acting';
      actor.mp -= ability.mp;
      actor.defending = false;
      this.current = { actor, ability, abilityId, target, remaining: ACTION_DURATION };
      this.emit('actionStart', { actorId: actor.id, abilityId, targetId: target.id });
      this.applyEffect(actor, ability, target);
      return;
    }
  }

  applyEffect(actor, ability, target) {
    switch (ability.kind) {
      case 'physical':
      case 'magic': {
        const { amount, tag } = computeDamage(actor, target, ability, this.rng);
        target.hp = Math.max(0, target.hp - amount);
        this.emit('damage', { actorId: actor.id, targetId: target.id, amount, tag });
        if (target.hp === 0) this.knockOut(target);
        break;
      }
      case 'heal': {
        const amount = Math.min(computeHeal(actor, ability, this.rng), target.maxHp - target.hp);
        target.hp += amount;
        this.emit('heal', { targetId: target.id, amount });
        break;
      }
      case 'defend':
        actor.defending = true;
        this.emit('defend', { actorId: actor.id });
        break;
    }
    if (ability.mpGain && actor.maxMp) {
      const gain = Math.min(ability.mpGain, actor.maxMp - actor.mp);
      actor.mp += gain;
      if (gain) this.emit('mpGain', { actorId: actor.id, amount: gain });
    }
  }

  knockOut(unit) {
    unit.state = 'ko';
    unit.atb = 0;
    this.queue = this.queue.filter((q) => q.actorId !== unit.id);
    this.emit('ko', { unitId: unit.id });
  }

  finishAction() {
    const { actor } = this.current;
    this.current = null;
    if (actor.hp > 0) {
      actor.atb = 0;
      actor.state = 'charging';
    }
    this.emit('actionEnd', { actorId: actor.id });
    this.checkOutcome();
  }

  checkOutcome() {
    if (this.hero.hp <= 0) {
      this.phase = 'defeat';
      this.emit('defeat');
    } else if (this.livingEnemies().length === 0) {
      this.queue = [];
      if (this.hero.state === 'queued') this.hero.state = 'charging'; // re-picks next wave
      if (this.waveIndex + 1 >= this.totalWaves) {
        this.phase = 'victory';
        this.emit('victory');
      } else {
        this.phase = 'transition';
        this.transitionTimer = WAVE_TRANSITION;
        this.emit('waveCleared', { wave: this.waveIndex });
      }
    }
  }

  startWave(index) {
    this.waveIndex = index;
    this.enemies = this.stage.waves[index].map((key, n) => {
      const enemy = makeUnit(ENEMIES[key], `e${index}-${n}`, 'enemy');
      enemy.atb = this.rng() * 0.3; // stagger so enemies don't act in lockstep
      return enemy;
    });
    this.phase = 'battle';
    this.emit('waveStart', { wave: index, total: this.totalWaves });
  }
}
