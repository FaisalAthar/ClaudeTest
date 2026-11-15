# Hex Battler

A portrait mobile turn-based battler: one hero against waves of enemies, with
timed button presses (QTEs) on every attack, in the spirit of Clair Obscur:
Expedition 33. Built for the web (Vite + Three.js), with app-store packaging
planned later via Capacitor. (The folder keeps its original `atb-battler`
name.)

## Running

```bash
cd atb-battler
npm install
npm run dev      # open the printed URL (use your phone on the same network)
npm test         # engine unit tests
node test/balance.mjs 300   # win rate by QTE skill across seeds
```

## Combat

- **Turns**: each round every living unit acts once, fastest first (the hero
  wins ties). The strip under the wave counter shows the next seven turns.
  Nothing happens on the hero's turn until you pick a command.
- **Attack QTE**: Attack, Fire, Blizzard and Thunder bring up a hexagon in the
  middle of the screen: a thick outline closes in on a solid core. Tap anywhere (or
  press Space) as they meet for a **perfect hit, ×2 damage**. Early, late or
  no tap = normal damage.
- **Parry QTE**: on an enemy's turn the card glows red, then the hexagon
  appears in the middle of the screen. Tap on time to **parry**: no damage, and the hero
  counter-attacks (Counter, 1.2× an Attack, +3 MP). Miss and the hit lands.
- Timing per move is `qteTime` in `src/engine/data.js` (0.75–1.35 s; heavier
  enemy moves are slower to read); windows are `QTE_WINDOW` (±110 ms for a
  perfect hit, ±90 ms for a parry).
- **Other commands**: Cure (9 MP) and Defend (halves damage until your next
  turn) need no timing. Attacks and counters restore 3 MP.
- **Elements**: weakness ×2 (`WEAK!`), resistance ×0.5. Tap an enemy to
  target it.
- **Auto**: the AI picks commands (heal when low, exploit weaknesses, else
  attack the weakest enemy); you still time every QTE.
- **Stage**: 3 waves (Goblins → Frost Wolf + Bomb → Ogre boss).

Balance from `node test/balance.mjs 300` (AI picking commands):

| Perfect hits | Parries | Win rate |
|---|---|---|
| 0% | 0% | 0% |
| 50% | 30% | 57% |
| 70% | 50% | 98% |
| 100% | 100% | 100% |

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
  battle.js     turn order, QTE hand-off, parry/counter, waves, win/loss
  formulas.js   damage / heal / element math
  ai.js         auto-battle hero AI + weighted enemy AI
  data.js       abilities, hero, enemies, stages (all tuning lives here)
  rng.js        seeded PRNG for reproducible battles
src/ui/       DOM renderer that listens to engine events; qte.js = hexagon prompt
src/stage/    Three.js hero layer: model, sword, animation blending, effects
tools/bake/   browser page used by scripts/bake-animations.mjs
test/         node:test suite + balance probe
```

The engine never measures time. When an attack needs a timed press it waits
in phase `qte`; the UI runs the hexagon prompt and reports back with
`battle.resolveQte(success)`, then calls `battle.next()` once the action has
played out. That keeps the rules fully unit-testable without a browser.

## Roadmap

1. ~~Core battle mechanic~~ (now turn-based with QTEs)
2. Visuals: Three.js battle scene, Mixamo hero + enemy models, attack/cast/hit
   animations, VFX
3. Progression: stage select, XP/levels, ability cards/jobs, equipment, save data
4. Mobile: touch polish, performance, PWA, Capacitor builds
5. Content: more enemies, bosses, stages, story
