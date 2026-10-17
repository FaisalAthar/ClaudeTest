// Binary assets come from ./assets/ in dev, or from base64 blobs injected by
// scripts/build-artifact.mjs when the game is bundled into a single page
// (which can't fetch arbitrary files).
export async function loadAssetBuffer(path) {
  const embedded = globalThis.__EMBEDDED_ASSETS__?.[path];
  if (embedded) {
    const bin = atob(embedded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }
  const res = await fetch(`./assets/${path}`);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.arrayBuffer();
}
