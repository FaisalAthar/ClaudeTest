// Bundles the Vite build into one self-contained HTML file (inline CSS + JS)
// suitable for hosting as a single page. Binary assets under public/assets are
// embedded as base64 and read back by src/stage/assets.js.
// Usage: node scripts/build-artifact.mjs <out.html>
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = new URL('../dist/', import.meta.url).pathname;
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const cssPath = html.match(/href="\.\/(assets\/[^"]+\.css)"/)[1];
const jsPath = html.match(/src="\.\/(assets\/[^"]+\.js)"/)[1];
const css = readFileSync(join(dist, cssPath), 'utf8');
const js = readFileSync(join(dist, jsPath), 'utf8').replace(/<\/script/gi, '<\\/script');
const assetsDir = new URL('../public/assets/', import.meta.url).pathname;
const assets = {};
for (const file of readdirSync(assetsDir, { recursive: true })) {
  if (!/\.(fbx|glb)$/i.test(file)) continue;
  assets[file.split('\\').join('/')] = readFileSync(join(assetsDir, file)).toString('base64');
}
const body = html.match(/<body>([\s\S]*)<\/body>/)[1];

const out = `<title>ATB Battler</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>${css}</style>
${body.trim()}
<script>globalThis.__EMBEDDED_ASSETS__ = ${JSON.stringify(assets)};</script>
<script type="module">${js}</script>
`;
writeFileSync(process.argv[2], out);
console.log(`wrote ${process.argv[2]} (${(out.length / 1024).toFixed(1)} KB)`);
