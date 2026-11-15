import { ABILITIES, ENEMIES } from './data.js';
import { computeDamage, computeHeal } from './formulas.js';
import { chooseEnemyAction, chooseHeroAction } from './ai.js';
import { createRng } from './rng.js';

// Turn-based battle. Each round, every living unit acts once in speed order
// (fastest first, hero wins ties). The engine never measures time: when an
// action needs a timed press (QTE) it stops in phase 'qte' and the UI calls
// resolveQte(success) once the player hits or misses the window.
//
// Phases:
//   command   — hero's turn, waiting for command()
//   qte       — an attack is waiting on resolveQte()
//   turnEnd   — action resolved; UI plays it out, then calls next()
//   waveClear — every enemy down; next() brings in the next wave
//   victory / defeat

const OFFENSIVE = new Set(['physical', 'magic']);

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
    defending: false,
  };
}

export class Battle {
  constructor({ hero, stage, seed = Date.now(), auto = false }) {
    this.rng = createRng(seed);
    this.hero = makeUnit(hero, 'hero', 'hero');
    this.stage = stage;
    this.auto = auto;
    this.waveIndex = -1;
    this.enemies = [];
    this.round = 0;
    this.order = []; // unit ids for the current round
    this.turnIndex = -1;
    this.current = null; // unit whose turn it is
    this.pending = null; // { actorId, abilityId, targetId, qte } awaiting resolveQte
    this.phase = 'idle';
    this.listeners = new Set();
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(type, payload = {}) {
    const event = { type, ...payload };
    for (const fn of this.listeners) fn(event);
  }

  start() {
    this.startWave(0);
    this.beginTurn();
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

  roundOrder() {
    return [this.hero, ...this.livingEnemies()]
      .filter((u) => u.hp > 0)
      .sort((a, b) => b.spd - a.spd || (a.side === 'hero' ? -1 : b.side === 'hero' ? 1 : 0))
      .map((u) => u.id);
  }

  /** The next `count` turns, starting with the current one. */
  upcoming(count = 6) {
    const living = (id) => this.unit(id)?.hp > 0;
    const result = this.order.slice(Math.max(0, this.turnIndex)).filter(living);
    const nextRound = this.roundOrder();
    while (result.length < count && nextRound.length) result.push(...nextRound);
    return result.slice(0, count);
  }

  // ---------- Turn flow ----------

  beginTurn() {
    let actor = null;
    while (!actor) {
      this.turnIndex++;
      if (this.turnIndex >= this.order.length) {
        this.round++;
        this.order = this.roundOrder();
        this.turnIndex = 0;
        this.emit('roundStart', { round: this.round });
      }
      const candidate = this.unit(this.order[this.turnIndex]);
      if (candidate?.hp > 0) actor = candidate;
    }
    this.current = actor;
    this.emit('turnStart', { actorId: actor.id });

    if (actor.side === 'hero') {
      actor.defending = false; // Defend lasts until the hero's next turn
      this.phase = 'command';
      this.emit('heroTurn');
      if (this.auto) {
        const { abilityId, targetId } = chooseHeroAction(this);
        this.command(abilityId, targetId);
      }
    } else {
      const { abilityId } = chooseEnemyAction(actor, this);
      this.pending = { actorId: actor.id, abilityId, targetId: this.hero.id, qte: 'parry' };
      this.phase = 'qte';
      this.emit('actionStart', this.pending);
    }
  }

  // Player input on the hero's turn. Returns { ok, reason }.
  command(abilityId, targetId) {
    const hero = this.hero;
    if (this.phase !== 'command') return { ok: false, reason: 'not-your-turn' };
    if (!hero.abilities.includes(abilityId)) return { ok: false, reason: 'unknown-ability' };
    const ability = ABILITIES[abilityId];
    if (hero.mp < ability.mp) return { ok: false, reason: 'no-mp' };

    let target = ability.target === 'self' ? hero : this.unit(targetId);
    if (ability.target === 'enemy' && (!target || target.side !== 'enemy' || target.hp <= 0)) {
      target = this.livingEnemies()[0];
    }
    hero.mp -= ability.mp;

    if (OFFENSIVE.has(ability.kind)) {
      this.pending = { actorId: hero.id, abilityId, targetId: target.id, qte: 'attack' };
      this.phase = 'qte';
      this.emit('actionStart', this.pending);
    } else {
      this.emit('actionStart', { actorId: hero.id, abilityId, targetId: target.id, qte: null });
      this.applyEffect(hero, ability, target);
      this.finishTurn();
    }
    return { ok: true };
  }

  setAuto(on) {
    this.auto = on;
    if (on && this.phase === 'command') {
      const { abilityId, targetId } = chooseHeroAction(this);
      this.command(abilityId, targetId);
    }
  }

  /**
   * Outcome of the timed press for the pending action.
   *   Hero attack: success = perfect hit, double damage.
   *   Enemy attack: success = parry, no damage and the hero counters.
   */
  resolveQte(success) {
    if (this.phase !== 'qte') return;
    const { actorId, abilityId, targetId, qte } = this.pending;
    this.pending = null;
    const actor = this.unit(actorId);
    const target = this.unit(targetId);
    const ability = ABILITIES[abilityId];
    this.emit('qteResult', { kind: qte, success, actorId, targetId });

    if (qte === 'attack') {
      this.applyEffect(actor, ability, target, success ? 2 : 1);
    } else if (success) {
      this.emit('parry', { actorId: target.id, attackerId: actor.id });
      this.emit('actionStart', { actorId: target.id, abilityId: 'counter', targetId: actor.id, qte: null });
      this.applyEffect(target, ABILITIES.counter, actor);
    } else {
      this.applyEffect(actor, ability, target);
    }
    this.finishTurn();
  }

  applyEffect(actor, ability, target, bonus = 1) {
    switch (ability.kind) {
      case 'physical':
      case 'magic': {
        const { amount, tag } = computeDamage(actor, target, ability, this.rng, bonus);
        target.hp = Math.max(0, target.hp - amount);
        this.emit('damage', { actorId: actor.id, targetId: target.id, amount, tag, perfect: bonus > 1 });
        if (target.hp === 0) this.emit('ko', { unitId: target.id });
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

  finishTurn() {
    if (this.hero.hp <= 0) {
      this.phase = 'defeat';
      this.emit('defeat');
    } else if (this.livingEnemies().length === 0) {
      if (this.waveIndex + 1 >= this.totalWaves) {
        this.phase = 'victory';
        this.emit('victory');
      } else {
        this.phase = 'waveClear';
        this.emit('waveCleared', { wave: this.waveIndex });
      }
    } else {
      this.phase = 'turnEnd';
      this.emit('turnEnd');
    }
  }

  /** Called by the UI once the last action has played out. */
  next() {
    if (this.phase === 'turnEnd') {
      this.beginTurn();
    } else if (this.phase === 'waveClear') {
      this.startWave(this.waveIndex + 1);
      this.beginTurn();
    }
  }

  startWave(index) {
    this.waveIndex = index;
    this.enemies = this.stage.waves[index].map((key, n) => makeUnit(ENEMIES[key], `e${index}-${n}`, 'enemy'));
    // A new wave starts a fresh round.
    this.order = [];
    this.turnIndex = -1;
    this.hero.defending = false;
    this.emit('waveStart', { wave: index, total: this.totalWaves });
  }
}
