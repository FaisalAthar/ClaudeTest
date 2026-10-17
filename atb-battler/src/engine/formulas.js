export function elementModifier(target, element) {
  if (!element) return { mult: 1, tag: null };
  if (target.weak.includes(element)) return { mult: 2, tag: 'weak' };
  if (target.resist.includes(element)) return { mult: 0.5, tag: 'resist' };
  return { mult: 1, tag: null };
}

// Physical: atk vs full def. Magic: mag vs half def. ±10% variance.
export function computeDamage(attacker, target, ability, rng) {
  const magic = ability.kind === 'magic';
  const stat = magic ? attacker.mag : attacker.atk;
  const defense = magic ? target.def * 0.5 : target.def;
  const base = Math.max(1, stat * ability.power * 2 - defense);
  const variance = 0.9 + rng() * 0.2;
  const { mult, tag } = elementModifier(target, ability.element);
  const guard = target.defending ? 0.5 : 1;
  return { amount: Math.max(1, Math.round(base * variance * mult * guard)), tag };
}

export function computeHeal(caster, ability, rng) {
  return Math.round(caster.mag * ability.power * (0.95 + rng() * 0.1));
}
