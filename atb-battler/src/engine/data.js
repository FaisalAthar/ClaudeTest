// All game content lives here as plain data so tuning never touches engine code.
//
// kind:   'physical' (atk vs def) | 'magic' (mag vs half def) | 'heal' | 'defend'
// target: 'enemy' (an opponent) | 'self'
// power:  multiplier fed into the formulas in formulas.js
// mpGain: MP restored to the user after the action (rewards basic attacks)

export const ABILITIES = {
  attack: { name: 'Attack', kind: 'physical', power: 1.0, mp: 0, target: 'enemy', mpGain: 3 },
  fire: { name: 'Fire', kind: 'magic', element: 'fire', power: 1.6, mp: 6, target: 'enemy' },
  blizzard: { name: 'Blizzard', kind: 'magic', element: 'ice', power: 1.6, mp: 6, target: 'enemy' },
  thunder: { name: 'Thunder', kind: 'magic', element: 'thunder', power: 1.6, mp: 6, target: 'enemy' },
  cure: { name: 'Cure', kind: 'heal', power: 3.2, mp: 9, target: 'self' },
  defend: { name: 'Defend', kind: 'defend', mp: 0, target: 'self' },

  // Enemy-only
  claw: { name: 'Claw', kind: 'physical', power: 1.0, mp: 0, target: 'enemy' },
  bite: { name: 'Bite', kind: 'physical', power: 1.3, mp: 0, target: 'enemy' },
  frostBreath: { name: 'Frost Breath', kind: 'magic', element: 'ice', power: 1.4, mp: 0, target: 'enemy' },
  blaze: { name: 'Blaze', kind: 'magic', element: 'fire', power: 1.4, mp: 0, target: 'enemy' },
  club: { name: 'Club', kind: 'physical', power: 1.0, mp: 0, target: 'enemy' },
  smash: { name: 'Smash', kind: 'physical', power: 1.8, mp: 0, target: 'enemy' },
};

export const HERO = {
  name: 'Hero',
  hp: 360,
  mp: 48,
  atk: 22,
  mag: 26,
  def: 12,
  spd: 40,
  abilities: ['attack', 'fire', 'blizzard', 'thunder', 'cure', 'defend'],
};

// actions: weighted list the enemy AI picks from.
export const ENEMIES = {
  goblin: {
    name: 'Goblin', hp: 90, atk: 16, mag: 8, def: 6, spd: 30,
    weak: ['fire'], resist: [],
    actions: [{ id: 'claw', weight: 1 }],
  },
  frostWolf: {
    name: 'Frost Wolf', hp: 120, atk: 18, mag: 14, def: 8, spd: 38,
    weak: ['fire'], resist: ['ice'],
    actions: [{ id: 'bite', weight: 2 }, { id: 'frostBreath', weight: 1 }],
  },
  bomb: {
    name: 'Bomb', hp: 110, atk: 10, mag: 18, def: 6, spd: 26,
    weak: ['ice'], resist: ['fire'],
    actions: [{ id: 'blaze', weight: 1 }],
  },
  ogre: {
    name: 'Ogre', hp: 520, atk: 26, mag: 10, def: 14, spd: 22, boss: true,
    weak: ['thunder'], resist: [],
    actions: [{ id: 'club', weight: 3 }, { id: 'smash', weight: 1 }],
  },
};

export const STAGES = {
  forest: {
    name: 'Whispering Forest',
    waves: [
      ['goblin', 'goblin'],
      ['frostWolf', 'bomb'],
      ['ogre'],
    ],
  },
};
