# ATB Battler

A portrait mobile auto-battler in the style of classic Final Fantasy's Active
Time Battle: one hero vs. waves of enemies. Built for the web (Vite, no
framework), with app-store packaging planned later via Capacitor.

## Running

```bash
cd atb-battler
npm install
npm run dev      # open the printed URL (use your phone on the same network)
npm test         # engine unit tests
node test/balance.mjs 300   # auto-battle win rate / duration across seeds
```

## Phase 1 — core mechanic (current)

- **ATB gauges**: every unit's gauge fills at `spd / 100` per second. When it's
  full, the unit picks an action and joins a FIFO **action queue**; actions
  resolve one at a time (`ACTION_DURATION`), and gauges keep filling while they
  play.
- **Active / Wait** toggle: in Wait mode, all gauges freeze while the hero has a
  command pending; in Active mode, enemies keep charging while you decide.
- **Commands**: Attack (+3 MP), Fire / Blizzard / Thunder (6 MP), Cure (9 MP),
  Defend (halves damage taken until the hero's next action).
- **Elements**: weakness ×2 (shows `WEAK!`), resistance ×0.5. Tap an enemy to
  lock it as your target.
- **Auto battle**: heals below 40% HP, otherwise casts a spell the weakest
  vulnerable enemy is weak to (keeping a Cure's worth of MP in reserve),
  otherwise attacks the lowest-HP enemy.
- **Speed**: 1× / 2× / 3×.
- **Stage**: 3 waves (Goblins → Frost Wolf + Bomb → Ogre boss).

## Layout

```
src/engine/   pure game logic, no DOM — unit-testable
  battle.js     ATB loop, action queue, waves, win/loss, event emitter
  formulas.js   damage / heal / element math
  ai.js         auto-battle hero AI + weighted enemy AI
  data.js       abilities, hero, enemies, stages (all tuning lives here)
  rng.js        seeded PRNG for reproducible battles
src/ui/       DOM renderer that listens to engine events
test/         node:test suite + balance probe
```

The UI only reads engine state and calls `battle.command()`, `setAuto()` and
`setAtbMode()`, so phase 2 can replace it with a 3D Three.js scene without
touching the rules.

## Roadmap

1. ~~Core ATB mechanic~~ (this phase)
2. Visuals: Three.js battle scene, Mixamo hero + enemy models, attack/cast/hit
   animations, VFX
3. Progression: stage select, XP/levels, ability cards/jobs, equipment, save data
4. Mobile: touch polish, performance, PWA, Capacitor builds
5. Content: more enemies, bosses, stages, story
