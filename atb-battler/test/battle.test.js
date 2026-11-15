import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from '../src/engine/battle.js';
import { HERO, STAGES } from '../src/engine/data.js';
import { computeDamage } from '../src/engine/formulas.js';
import { chooseHeroAction } from '../src/engine/ai.js';

function newBattle(opts = {}) {
  const battle = new Battle({ hero: HERO, stage: STAGES.forest, seed: 42, ...opts });
  const events = [];
  battle.on((e) => events.push(e));
  battle.start();
  return { battle, events };
}

// Drives the battle to `predicate`, answering every QTE with `qte(pending)`
// and every hero turn with the auto AI.
function play(battle, { qte = () => false, until = () => false, maxTurns = 2000 } = {}) {
  for (let i = 0; i < maxTurns && !until(); i++) {
    if (battle.phase === 'command') {
      const { abilityId, targetId } = chooseHeroAction(battle);
      battle.command(abilityId, targetId);
    } else if (battle.phase === 'qte') {
      battle.resolveQte(qte(battle.pending));
    } else if (battle.phase === 'turnEnd' || battle.phase === 'waveClear') {
      battle.next();
    } else {
      break;
    }
  }
}

// Runs enemy turns (missing the parry) until it's the hero's turn.
function toHeroTurn(battle) {
  play(battle, { until: () => battle.phase === 'command' });
}

test('rounds go in speed order, hero first', () => {
  const { battle } = newBattle();
  assert.equal(battle.phase, 'command');
  assert.equal(battle.current.id, 'hero');
  assert.deepEqual(battle.upcoming(3), ['hero', 'e0-0', 'e0-1']);
});

test('the battle waits on the hero: nothing happens without a command', () => {
  const { battle, events } = newBattle();
  const before = events.length;
  battle.next();
  battle.resolveQte(true);
  assert.equal(battle.phase, 'command');
  assert.equal(events.length, before);
});

test('attacking starts a QTE; a perfect hit doubles damage', () => {
  const run = (success) => {
    const { battle, events } = newBattle();
    const target = battle.enemies[0];
    assert.deepEqual(battle.command('attack', target.id), { ok: true });
    assert.equal(battle.phase, 'qte');
    assert.equal(battle.pending.qte, 'attack');
    battle.resolveQte(success);
    return events.find((e) => e.type === 'damage');
  };
  const normal = run(false);
  const perfect = run(true);
  assert.equal(normal.perfect, false);
  assert.equal(perfect.perfect, true);
  assert.equal(perfect.amount, normal.amount * 2); // same seed → same variance roll
});

test('spells use the attack QTE too; Cure and Defend do not', () => {
  const { battle } = newBattle();
  battle.command('fire', battle.enemies[0].id);
  assert.equal(battle.pending.qte, 'attack');
  battle.resolveQte(false);
  battle.next();
  toHeroTurn(battle);
  battle.command('defend');
  assert.equal(battle.phase, 'turnEnd');
  assert.equal(battle.hero.defending, true);
});

test('enemy turns ask for a parry QTE against the hero', () => {
  const { battle } = newBattle();
  battle.command('defend');
  battle.next();
  assert.equal(battle.phase, 'qte');
  assert.equal(battle.pending.qte, 'parry');
  assert.equal(battle.pending.targetId, 'hero');
  assert.equal(battle.current.side, 'enemy');
});

test('a missed parry lands the hit', () => {
  const { battle, events } = newBattle();
  battle.command('attack', battle.enemies[0].id);
  battle.resolveQte(false);
  battle.next();
  const hp = battle.hero.hp;
  battle.resolveQte(false);
  const hit = events.find((e) => e.type === 'damage' && e.targetId === 'hero');
  assert.ok(hit);
  assert.equal(battle.hero.hp, hp - hit.amount);
});

test('a parry blocks all damage and counters the attacker', () => {
  const { battle, events } = newBattle();
  battle.command('attack', battle.enemies[0].id);
  battle.resolveQte(false);
  battle.next();
  const attacker = battle.current;
  const hp = battle.hero.hp;
  const enemyHp = attacker.hp;
  const from = events.length;
  battle.resolveQte(true);
  assert.equal(battle.hero.hp, hp);
  assert.ok(events.some((e) => e.type === 'parry' && e.attackerId === attacker.id));
  const counter = events.slice(from).find((e) => e.type === 'damage' && e.actorId === 'hero' && e.targetId === attacker.id && !e.perfect);
  assert.ok(counter);
  assert.equal(attacker.hp, Math.max(0, enemyHp - counter.amount));
});

test('Defend halves a hit until the hero acts again', () => {
  const rng = () => 0.5;
  const attacker = { atk: 20, mag: 20 };
  const target = { def: 10, weak: [], resist: [], defending: false };
  const claw = { kind: 'physical', power: 1 };
  const normal = computeDamage(attacker, target, claw, rng).amount;
  const guarded = computeDamage(attacker, { ...target, defending: true }, claw, rng).amount;
  assert.equal(guarded, Math.round(normal * 0.5));

  const { battle } = newBattle();
  battle.command('defend');
  battle.next();
  toHeroTurn(battle);
  assert.equal(battle.hero.defending, false);
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

test('command is rejected off-turn or without MP', () => {
  const { battle } = newBattle();
  battle.command('defend');
  assert.equal(battle.command('attack', battle.enemies[0].id).reason, 'not-your-turn');
  battle.next();
  toHeroTurn(battle);
  battle.hero.mp = 0;
  assert.equal(battle.command('fire', battle.enemies[0].id).reason, 'no-mp');
});

test('a dead target is swapped for a living enemy', () => {
  const { battle, events } = newBattle();
  const [first, second] = battle.enemies;
  first.hp = 0;
  battle.command('attack', first.id);
  battle.resolveQte(false);
  assert.equal(events.find((e) => e.type === 'damage').targetId, second.id);
});

test('KO\'d enemies drop out of the turn order', () => {
  const { battle } = newBattle();
  battle.enemies[0].hp = 0;
  assert.deepEqual(battle.upcoming(3), ['hero', 'e0-1', 'hero']);
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

test('a perfect-timing player clears every wave', () => {
  const { battle, events } = newBattle();
  play(battle, { qte: () => true, until: () => ['victory', 'defeat'].includes(battle.phase) });
  assert.equal(battle.phase, 'victory');
  assert.equal(events.filter((e) => e.type === 'waveStart').length, STAGES.forest.waves.length);
});

test('a hero who never acts is defeated', () => {
  const { battle, events } = newBattle();
  for (let i = 0; i < 500 && battle.phase !== 'defeat'; i++) {
    if (battle.phase === 'command') battle.command('defend');
    else if (battle.phase === 'qte') battle.resolveQte(false);
    else battle.next();
  }
  assert.equal(battle.phase, 'defeat');
  assert.ok(events.some((e) => e.type === 'defeat'));
});
