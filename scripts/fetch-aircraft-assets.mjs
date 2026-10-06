import { mkdir, writeFile } from 'node:fs/promises';
import { brotliDecompressSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const destination = new URL('../public/assets/aircraft/', import.meta.url);
await mkdir(destination, { recursive: true });
async function get(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Aircraft download: HTTP ${response.status}`);
  return response;
}
const page = 'https://poly.pizza/m/2eG17I-VDiG';
const html = await (await get(page)).text();
const state = JSON.parse(html.match(/window\.__SERVER_APP_STATE__\s*=\s*(\{.*?\})<\/script>/s)[1]);
const model = state.initialData.model;
if (model.Creator.Username !== 'Poly by Google' || model.Licence !== 'CC-BY 3.0') throw new Error('Review changed aircraft author/license');
const sourceUrl = html.match(/<model-viewer[^>]+src="([^"]+)"/)[1];
let bytes = Buffer.from(await (await get(sourceUrl)).arrayBuffer());
if (bytes.toString('ascii', 0, 4) !== 'glTF') bytes = brotliDecompressSync(bytes);
if (bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(8) !== bytes.length) throw new Error('Invalid aircraft GLB');
await writeFile(new URL('airplane.glb', destination), bytes);
await writeFile(new URL('manifest.json', destination), JSON.stringify({ file: 'airplane.glb', title: model.Title, author: model.Creator.Username, license: model.Licence, licenseUrl: 'https://creativecommons.org/licenses/by/3.0/', page, sourceUrl, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), processing: 'Original GLB unchanged; runtime aligns nose to +Z, scales to 34 m wingspan and adapts materials for game lighting', verified: '2026-10-06' }, null, 2) + '\n');
console.log(`Downloaded airplane.glb (${bytes.length} bytes)`);
