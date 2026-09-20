# Village Hero — 3rd Person Prototype

A minimal third-person action-game scaffold built with [Three.js](https://threejs.org/):
an empty test environment (flat ground + grid + sky) with a controllable rigged
character, WASD movement, and mouse-orbit camera look.

## Running it

```bash
npm install
npm run dev
```

Open the printed local URL, click the canvas to lock the pointer, then:

- **WASD** / arrow keys — move (relative to camera facing)
- **Mouse** — orbit the camera around the character (look around)
- **Scroll wheel** — zoom camera distance in/out
- **Esc** — release the pointer lock

## Character asset

The controllable character is `public/assets/character/hero.fbx`, sourced from the
[Village Hero — Looking Around](https://sketchfab.com/3d-models/village-hero-looking-around-573ee3c1426a4ea49468fbb94a97def1)
Sketchfab model. It's loaded with `three`'s `FBXLoader` in `src/character.js`, which:

- Normalizes scale/position so the model is ~1.8m tall with its feet at `y = 0`,
  regardless of the FBX's original unit scale.
- Falls back to a simple placeholder capsule if `hero.fbx` fails to load, so the
  game still runs without the asset present.

## Idle / walk animation

The hero's rig uses standard Mixamo bone names (`mixamorigHips`, `mixamorigSpine`,
etc. — no colon, since the source FBX has it stripped). `src/animation.js` blends
between two clips based on `ThirdPersonController`'s movement state (`main.js`'s
render loop calls `animator.setMoving(controller.isMoving, delta)` every frame):

- **Idle** — `public/assets/anim_source/idle.fbx`. Its embedded metadata
  identifies it as a Mixamo "Retargeted Clip" already computed against this
  exact character's uploaded skin, so it's applied directly (`remapToSkinnedMeshTracks`
  just rewrites its track names to the `.bones[Name]` form the skinned mesh
  needs — no pose correction, since Mixamo already did that server-side).
- **Walk** — `public/assets/anim_source/walking.fbx`, from a generic Mixamo
  locomotion pack. Unlike the idle clip, it's *not* retargeted for this
  character (it's motion-only, authored against Mixamo's generic "X Bot" rig),
  so it goes through `retargetLocalDelta` using the pack's own bundled
  `XBot.fbx` as the precise rest-pose reference — the exact skeleton the clip
  was built for, rather than an unrelated stand-in.

Retargeting a Mixamo rig against an animation authored for a *different*
character isn't a straight copy even when bone names match exactly — the two
skeletons don't share a rest pose or local bone-axis convention.
`retargetLocalDelta` transplants each bone's *local rotation delta from its
own rest pose* rather than forcing a shared world-space orientation (which is
what `THREE.SkeletonUtils.retarget` does, and why it wasn't used here — it
produced twisted limbs on this model, even using the correct source
skeleton). The hip's translation (root motion) is handled separately,
converted through each skeleton's actual world-space displacement so the two
rigs' differing internal unit scales don't leak in. To replace either clip
with a fresh Mixamo-retargeted-for-this-character animation, drop it next to
`idle.fbx` and bind it the same direct way — no retargeting needed.

**Known limitation:** the "Source" FBX download from Sketchfab includes geometry,
rig, and animation, but no diffuse textures — Sketchfab's raw source export
doesn't bundle the baked color maps used in its web viewer. The character
currently renders with a flat neutral tint (`src/character.js`) instead of its
full painted look. To get the textured version, re-download the model from
Sketchfab using the **"Autoconverted format (glTF)"** download option instead
of "Original/Source" — that format bakes the viewer textures into the file —
and swap the loader back to `GLTFLoader` pointed at that `.glb`.

## Project structure

```
src/
  main.js                 # renderer/scene bootstrap, render loop
  environment.js           # empty test environment: ground, lights, fog
  character.js              # FBX character loading + placeholder fallback
  animation.js              # idle/walk clip retargeting + blending
  ThirdPersonController.js  # WASD input, pointer-lock mouse look, orbit camera
public/assets/character/
  hero.fbx                 # the character model
public/assets/anim_source/
  idle.fbx                  # Idle clip, pre-retargeted by Mixamo for this character
  walking.fbx                # Walk clip, DIY-retargeted via XBot.fbx below
  XBot.fbx                    # rest-pose reference walking.fbx was authored against
```
