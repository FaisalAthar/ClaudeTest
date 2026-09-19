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
- Plays back the model's first embedded animation clip ("looking around" idle) via
  `THREE.AnimationMixer`.
- Falls back to a simple placeholder capsule if `hero.fbx` fails to load, so the
  game still runs without the asset present.

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
  ThirdPersonController.js  # WASD input, pointer-lock mouse look, orbit camera
public/assets/character/
  hero.fbx                 # the character model
```
