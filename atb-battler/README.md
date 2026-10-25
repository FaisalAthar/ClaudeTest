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

## Hero model and animations

- **Model + idle**: `public/assets/hero/hero.fbx` and `idle.fbx`, the same
  Village Hero and Mixamo idle as the third-person prototype in the repo root.
- **Battle moves**: retargeted from the CC0 animation library in
  [Mesh2Motion](https://github.com/scottpetrovic/mesh2motion-app)
  (`static/animations/human-base-animations.glb` and
  `human-addon-animations.glb`), baked into `public/assets/hero/battle-anims.json`:

  | Battle action | Source clip |
  |---|---|
  | Attack | `Sword_Attack` (played at 1.4×) |
  | Fire / Blizzard / Thunder | `Spell_Simple_Shoot` |
  | Cure | `Power Up` |
  | Defend | `Sword_Block` |
  | Taking a hit | `Hit_Chest` |
  | KO | `Death_B` |
  | Victory | `Victory` |
  | Idle below 30% HP | `Idle Hurt` |

- **Sword**: a small procedural mesh parented to the right-hand bone.

### Re-baking

To swap a clip, edit `CLIPS` in `scripts/bake-animations.mjs`, put the two
Mesh2Motion GLBs in `anim-source/` (git-ignored), and run:

```bash
node scripts/bake-animations.mjs --preview /some/dir   # needs Playwright's Chromium
```

The source rig uses Unreal-style bone names and a different rest pose from
the Mixamo hero, so `tools/bake/retarget.js` maps bones by name and transfers
each bone's world-space rotation from its own rest pose, after aligning the
two rest poses by bone direction. The script prints each clip's worst
per-bone direction error against the source (currently under 10°) and,
with `--preview`, writes side-by-side source/hero frames.

## Layout

```
src/engine/   pure game logic, no DOM — unit-testable
  battle.js     ATB loop, action queue, waves, win/loss, event emitter
  formulas.js   damage / heal / element math
  ai.js         auto-battle hero AI + weighted enemy AI
  data.js       abilities, hero, enemies, stages (all tuning lives here)
  rng.js        seeded PRNG for reproducible battles
src/ui/       DOM renderer that listens to engine events
src/stage/    Three.js hero layer: model, sword, animation blending, effects
tools/bake/   browser page used by scripts/bake-animations.mjs
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
