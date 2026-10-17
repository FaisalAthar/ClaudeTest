import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Battle, ACTION_DURATION } from '../src/engine/battle.js';
import { HERO, STAGES } from '../src/engine/data.js';
import { computeDamage } from '../src/engine/formulas.js';
import { chooseHeroAction } from '../src/engine/ai.js';

const STEP = 1 / 60;

function newBattle(opts = {}) {
  const battle = new Battle({ hero: HERO, stage: STAGES.forest, seed: 42, ...opts });
  const events = [];
  battle.on((e) => events.push(e));
  battle.start();
  return { battle, events };
}

function runUntil(battle, predicate, maxSeconds = 600) {
  for (let t = 0; t < maxSeconds; t += STEP) {
    if (predicate()) return true;
    battle.update(STEP);
  }
  return predicate();
}

test('gauge fills at spd / 100 per second', () => {
  const { battle } = newBattle();
  battle.update(0.5);
  assert.ok(Math.abs(battle.hero.atb - 0.5 * HERO.spd / 100) < 1e-9);
});

test('manual hero waits for a command once the gauge is full', () => {
  const { battle, events } = newBattle();
  runUntil(battle, () => battle.hero.state === 'ready');
  assert.ok(events.some((e) => e.type === 'heroReady'));
  const atbBefore = battle.hero.atb;
  battle.update(1);
  assert.equal(battle.hero.state, 'ready');
  assert.equal(battle.hero.atb, atbBefore);
});

test('active mode keeps enemy gauges filling while the hero is ready', () => {
  const { battle } = newBattle({ atbMode: 'active' });
  runUntil(battle, () => battle.hero.state === 'ready');
  const charging = battle.enemies.find((e) => e.state === 'charging');
  assert.ok(charging);
  const before = charging.atb;
  battle.update(0.1);
  assert.ok(charging.atb > before || charging.state !== 'charging');
});

test('wait mode freezes all gauges while the hero is ready', () => {
  const { battle } = newBattle({ atbMode: 'wait' });
  runUntil(battle, () => battle.hero.state === 'ready');
  const snapshot = battle.enemies.map((e) => e.atb);
  battle.update(2);
  assert.deepEqual(battle.enemies.map((e) => e.atb), snapshot);
});

test('command queues the action, resolves it, then resets the gauge', () => {
  const { battle, events } = newBattle();
  runUntil(battle, () => battle.hero.state === 'ready');
  const target = battle.enemies[0];
  assert.deepEqual(battle.command('attack', target.id), { ok: true });
  runUntil(battle, () => events.some((e) => e.type === 'actionEnd' && e.actorId === 'hero'));
  const dmg = events.find((e) => e.type === 'damage' && e.actorId === 'hero');
  assert.equal(dmg.targetId, target.id);
  assert.ok(target.hp < target.maxHp);
  assert.equal(battle.hero.state, 'charging');
  assert.ok(battle.hero.atb < 0.1);
});

test('command is rejected when not ready or out of MP', () => {
  const { battle } = newBattle();
  assert.equal(battle.command('attack', battle.enemies[0].id).reason, 'not-ready');
  runUntil(battle, () => battle.hero.state === 'ready');
  battle.hero.mp = 0;
  assert.equal(battle.command('fire', battle.enemies[0].id).reason, 'no-mp');
});

test('actions resolve one at a time, ACTION_DURATION apart', () => {
  const { battle, events } = newBattle({ auto: true });
  runUntil(battle, () => events.filter((e) => e.type === 'actionStart').length >= 4, 60);
  const starts = events.filter((e) => e.type === 'actionStart').map((e) => e.time);
  for (let i = 1; i < starts.length; i++) {
    assert.ok(starts[i] - starts[i - 1] >= ACTION_DURATION - STEP);
  }
});

test('weakness doubles damage and resistance halves it', () => {
  const rng = () => 0.5;
  const attacker = { atk: 20, mag: 20 };
  const base = { def: 10, weak: [], resist: [], defending: false };
  const fire = { kind: 'magic', element: 'fire', power: 1.5 };
  const neutral = computeDamage(attacker, base, fire, rng).amount;
  const weak = computeDamage(attacker, { ...base, weak: ['fire'] }, fire, rng);
  const resist = computeDamage(attacker, { ...base, resist: ['fire'] }, fire, rng);
  assert.equal(weak.amount, neutral * 2);
  assert.equal(weak.tag, 'weak');
  assert.equal(resist.amount, Math.round(neutral * 0.5));
});

test('defending halves incoming damage', () => {
  const rng = () => 0.5;
  const attacker = { atk: 20, mag: 20 };
  const target = { def: 10, weak: [], resist: [], defending: false };
  const claw = { kind: 'physical', power: 1 };
  const normal = computeDamage(attacker, target, claw, rng).amount;
  const guarded = computeDamage(attacker, { ...target, defending: true }, claw, rng).amount;
  assert.equal(guarded, Math.round(normal * 0.5));
});

test('queued action retargets when its target dies first', () => {
  const { battle, events } = newBattle();
  runUntil(battle, () => battle.hero.state === 'ready');
  const [first, second] = battle.enemies;
  battle.command('attack', first.id);
  battle.knockOut(first);
  first.hp = 0;
  runUntil(battle, () => events.some((e) => e.type === 'damage' && e.actorId === 'hero'));
  assert.equal(events.find((e) => e.type === 'damage' && e.actorId === 'hero').targetId, second.id);
});

test('auto AI heals when low, exploits weakness, else attacks', () => {
  const { battle } = newBattle();
  battle.hero.hp = 50;
  assert.equal(chooseHeroAction(battle).abilityId, 'cure');
  battle.hero.hp = battle.hero.maxHp;
  assert.equal(chooseHeroAction(battle).abilityId, 'fire'); // goblins are weak to fire
  battle.hero.mp = 9; // only Cure reserve left
  assert.equal(chooseHeroAction(battle).abilityId, 'attack');
});

test('clearing every wave ends in victory', () => {
  const { battle, events } = newBattle({ auto: true });
  runUntil(battle, () => battle.phase === 'victory' || battle.phase === 'defeat');
  assert.equal(events.filter((e) => e.type === 'waveStart').length, STAGES.forest.waves.length);
  assert.equal(battle.phase, 'victory');
});

test('hero KO ends in defeat', () => {
  const { battle, events } = newBattle();
  runUntil(battle, () => battle.phase === 'defeat');
  assert.ok(events.some((e) => e.type === 'defeat'));
  assert.equal(battle.hero.hp, 0);
});
