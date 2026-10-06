import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { brotliDecompressSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const dest = new URL('../public/assets/coverage/', import.meta.url);
await mkdir(dest, { recursive: true });
const choices = {
  minibus: '9Rj7a89ypPQ', motorcycle: 'dse64pqMKAR', scooter: 'awXCP7LUcz6', buggy: 'eZ_13w7qZh7', jeep: 'AcSdGGrgYP',
  backpack: 'vF7TuXCPDH', firstaid: 'wP00rePSRD', molotov: 'jsmWZYqVlM',
  pan: 'f9my9iJZMv', machete: 'SMBU5kBYtZ', crowbar: 'MkTjC7C7bN', sickle: 'M0eBGCueYE',
  crossbow: 'kHb0kA11oD', grenadeLauncher: 'phmPZCnGOA', rocketLauncher: 'eJNzLpBsEt',
  bandage: '1NDBCuuP_W4', energy: 'D5BL5EHdvb', painkiller: '1rtnvryfQZl', parachute: '3Z7vJ96JIEB',
};
const manifest = JSON.parse(await readFile(new URL('poly-manifest.json', dest), 'utf8').catch(() => '[]'));
async function get(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r; }
    catch (error) { if (attempt === 2) throw error; await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); }
  }
}
for (const [name, id] of Object.entries(choices)) {
  if (manifest.some(m => m.file === `${name}.glb`)) continue;
  const page = `https://poly.pizza/m/${id}`;
  const response = await get(page);
  if (!response.ok) throw new Error(`${name}: ${response.status}`);
  const html = await response.text();
  const model = JSON.parse(html.match(/window\.__SERVER_APP_STATE__\s*=\s*(\{.*?\})<\/script>/s)[1]).initialData.model;
  if (!['CC0 1.0', 'CC-BY 3.0'].includes(model.Licence)) throw new Error(`Review license ${name}: ${model.Licence}`);
  const sourceUrl = html.match(/<model-viewer[^>]+src="([^"]+)"/)[1];
  const download = await get(sourceUrl);
  if (!download.ok) throw new Error(`${name} download: ${download.status}`);
  let bytes = Buffer.from(await download.arrayBuffer());
  if (bytes.toString('ascii', 0, 4) !== 'glTF') bytes = brotliDecompressSync(bytes);
  if (bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(8) !== bytes.length) throw new Error(`Invalid GLB: ${name}`);
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  const triangles = json.meshes.reduce((n, m) => n + m.primitives.reduce((s, p) => s + json.accessors[p.indices ?? p.attributes.POSITION].count / 3, 0), 0);
  manifest.push({ file: `${name}.glb`, title: model.Title, author: model.Creator.Username, license: model.Licence, page, sourceUrl, bytes: bytes.length, triangles, sha256: createHash('sha256').update(bytes).digest('hex'), processing: 'Original GLB; runtime transforms and shared materials' });
  await writeFile(new URL(`${name}.glb`, dest), bytes);
  await writeFile(new URL('poly-manifest.json', dest), JSON.stringify(manifest, null, 2));
  console.log(`${name}: ${bytes.length} bytes, ${triangles} triangles, ${model.Licence}`);
}
