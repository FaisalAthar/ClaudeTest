import { ABILITIES } from './data.js';

const HEAL_THRESHOLD = 0.4;

// Auto-battle priorities: heal when low, exploit weaknesses (keeping enough
// MP in reserve for a Cure), otherwise basic-attack the weakest enemy.
export function chooseHeroAction(battle) {
  const hero = battle.hero;
  const enemies = battle.livingEnemies();
  const known = hero.abilities.map((id) => ({ id, ...ABILITIES[id] }));
  const cure = known.find((a) => a.kind === 'heal');

  if (cure && hero.hp / hero.maxHp < HEAL_THRESHOLD && hero.mp >= cure.mp) {
    return { abilityId: cure.id, targetId: hero.id };
  }

  const reserve = cure ? cure.mp : 0;
  const spells = known.filter((a) => a.element && hero.mp - a.mp >= reserve);
  let best = null;
  for (const spell of spells) {
    for (const enemy of enemies) {
      if (!enemy.weak.includes(spell.element)) continue;
      if (!best || enemy.hp < best.enemy.hp) best = { spell, enemy };
    }
  }
  if (best) return { abilityId: best.spell.id, targetId: best.enemy.id };

  const target = enemies.reduce((low, e) => (e.hp < low.hp ? e : low), enemies[0]);
  return { abilityId: 'attack', targetId: target.id };
}

export function chooseEnemyAction(enemy, battle) {
  const total = enemy.actions.reduce((sum, a) => sum + a.weight, 0);
  let roll = battle.rng() * total;
  for (const action of enemy.actions) {
    roll -= action.weight;
    if (roll < 0) return { abilityId: action.id, targetId: battle.hero.id };
  }
  return { abilityId: enemy.actions[0].id, targetId: battle.hero.id };
}
