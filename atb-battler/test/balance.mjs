// Balance probe: run many seeded battles with the auto AI choosing commands
// and a simulated player who lands each QTE with a given probability.
// Usage: node test/balance.mjs [runs]
import { Battle } from '../src/engine/battle.js';
import { HERO, STAGES } from '../src/engine/data.js';
import { chooseHeroAction } from '../src/engine/ai.js';
import { createRng } from '../src/engine/rng.js';

const runs = Number(process.argv[2] ?? 300);

function simulate(seed, hitRate, parryRate) {
  const battle = new Battle({ hero: HERO, stage: STAGES.forest, seed });
  const roll = createRng(seed * 7919 + 1);
  battle.start();
  let turns = 0;
  while (!['victory', 'defeat'].includes(battle.phase) && turns < 5000) {
    if (battle.phase === 'command') {
      const { abilityId, targetId } = chooseHeroAction(battle);
      battle.command(abilityId, targetId);
    } else if (battle.phase === 'qte') {
      const rate = battle.pending.qte === 'attack' ? hitRate : parryRate;
      battle.resolveQte(roll() < rate);
    } else {
      battle.next();
      turns++;
    }
  }
  return { won: battle.phase === 'victory', hp: battle.hero.hp / battle.hero.maxHp, turns };
}

console.log('hit%  parry%   win%  avg turns  avg HP left on win');
for (const [hit, parry] of [[0, 0], [0.5, 0.3], [0.7, 0.5], [1, 1]]) {
  let wins = 0;
  let hp = 0;
  let turns = 0;
  for (let seed = 1; seed <= runs; seed++) {
    const r = simulate(seed, hit, parry);
    turns += r.turns;
    if (r.won) {
      wins++;
      hp += r.hp;
    }
  }
  console.log(
    `${String(hit * 100).padStart(4)}  ${String(parry * 100).padStart(6)}  ${((wins / runs) * 100).toFixed(1).padStart(5)}  ${(turns / runs).toFixed(1).padStart(9)}  ${wins ? ((hp / wins) * 100).toFixed(1) : '-'}%`
  );
}
