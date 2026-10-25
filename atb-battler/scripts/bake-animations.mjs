// Retargets CC0 Mesh2Motion animations onto the hero and writes them to
// public/assets/hero/battle-anims.json.
//
// One-time setup: put human-base-animations.glb and human-addon-animations.glb
// (from https://github.com/scottpetrovic/mesh2motion-app, static/animations/)
// into atb-battler/anim-source/.
//
// Usage: node scripts/bake-animations.mjs [--preview <dir>]
//   --preview writes side-by-side source/hero PNGs for each clip.
import { writeFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const BASE = 'human-base-animations.glb';
const ADDON = 'human-addon-animations.glb';

// Battle action → source clip. Change these and re-run to swap animations.
export const CLIPS = {
  attack: { file: BASE, clip: 'Sword_Attack' },
  cast: { file: BASE, clip: 'Spell_Simple_Shoot' },
  heal: { file: ADDON, clip: 'Power Up' },
  defend: { file: BASE, clip: 'Sword_Block' },
  hit: { file: BASE, clip: 'Hit_Chest' },
  ko: { file: ADDON, clip: 'Death_B' },
  victory: { file: ADDON, clip: 'Victory' },
  hurtIdle: { file: ADDON, clip: 'Idle Hurt' },
};

const OUT = new URL('../public/assets/hero/battle-anims.json', import.meta.url).pathname;
const previewIdx = process.argv.indexOf('--preview');
const previewDir = previewIdx > 0 ? process.argv[previewIdx + 1] : null;

const server = await createServer({
  root: new URL('..', import.meta.url).pathname,
  logLevel: 'error',
  server: { port: 5199, strictPort: false },
});
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

try {
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  page.on('pageerror', (e) => console.error('[page]', e.message));
  await page.goto(`${url}tools/bake/`);
  await page.waitForFunction(() => window.bakeReady);
  const json = await page.evaluate((clips) => window.bake(clips), CLIPS);
  writeFileSync(OUT, json);
  console.log(`wrote ${OUT} (${(json.length / 1024).toFixed(0)} KB, ${Object.keys(CLIPS).length} clips)`);

  for (const [name, spec] of Object.entries(CLIPS)) {
    const worst = await page.evaluate(([n, s]) => window.verify(n, s), [name, spec]);
    console.log(`  ${name.padEnd(9)} worst bone error: ${worst.join(', ')}`);
  }

  if (previewDir) {
    mkdirSync(previewDir, { recursive: true });
    for (const [name, spec] of Object.entries(CLIPS)) {
      for (const f of [0.15, 0.4, 0.7]) {
        await page.evaluate(([n, frac, s]) => window.preview(n, frac, s), [name, f, spec]);
        await page.locator('canvas').screenshot({ path: `${previewDir}/${name}-${Math.round(f * 100)}.png` });
      }
    }
    console.log(`previews in ${previewDir}`);
  }
} finally {
  await browser.close();
  await server.close();
}
