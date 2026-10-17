// Bundles the Vite build into one self-contained HTML file (inline CSS + JS)
// suitable for hosting as a single page. Usage: node scripts/build-artifact.mjs <out.html>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = new URL('../dist/', import.meta.url).pathname;
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const cssPath = html.match(/href="\.\/(assets\/[^"]+\.css)"/)[1];
const jsPath = html.match(/src="\.\/(assets\/[^"]+\.js)"/)[1];
const css = readFileSync(join(dist, cssPath), 'utf8');
const js = readFileSync(join(dist, jsPath), 'utf8').replace(/<\/script/gi, '<\\/script');
const body = html.match(/<body>([\s\S]*)<\/body>/)[1];

const out = `<title>ATB Battler</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>${css}</style>
${body.trim()}
<script type="module">${js}</script>
`;
writeFileSync(process.argv[2], out);
console.log(`wrote ${process.argv[2]} (${(out.length / 1024).toFixed(1)} KB)`);
