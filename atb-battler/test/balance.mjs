// Balance probe: run many seeded auto-battles and report win rate / duration.
// Usage: node test/balance.mjs [runs]
import { Battle } from '../src/engine/battle.js';
import { HERO, STAGES } from '../src/engine/data.js';

const runs = Number(process.argv[2] ?? 200);
const STEP = 1 / 30;
let wins = 0;
let totalTime = 0;
let hpLeft = 0;

for (let seed = 1; seed <= runs; seed++) {
  const battle = new Battle({ hero: HERO, stage: STAGES.forest, seed, auto: true });
  battle.start();
  let t = 0;
  while (battle.phase !== 'victory' && battle.phase !== 'defeat' && t < 900) {
    battle.update(STEP);
    t += STEP;
  }
  if (battle.phase === 'victory') {
    wins++;
    hpLeft += battle.hero.hp / battle.hero.maxHp;
  }
  totalTime += t;
}

console.log(`auto win rate: ${((wins / runs) * 100).toFixed(1)}%`);
console.log(`avg battle length: ${(totalTime / runs).toFixed(1)}s`);
console.log(`avg HP left on win: ${wins ? ((hpLeft / wins) * 100).toFixed(1) : 0}%`);
