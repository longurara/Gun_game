import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { brotliDecompressSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const workspace = new URL('../', import.meta.url);
const output = new URL('output/assets/enemies/', workspace);
const raw = new URL('raw/', output), destination = new URL('public/assets/enemies/', workspace);
await mkdir(raw, { recursive: true }); await mkdir(destination, { recursive: true });
async function get(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`${new URL(url).hostname}: HTTP ${response.status}`);
  return response;
}
const selected = [
  ['punk', 'BTALZymknF'], ['hoodie', 'gKLBoRsyKe'],
  ['toon-soldier', 'PpLF4rt4ah'], ['toon-hazmat', 'z3TSQYx1Kn'], ['toon-enemy', 'mdGe4IN31v'],
  ['woman-soldier', 'oAArCNHjFB'], ['woman-punk', 'djXoqejw6w'],
];
const provenance = [];
for (const [key, id] of selected) {
  const page = `https://poly.pizza/m/${id}`, html = await (await get(page)).text();
  const state = JSON.parse(html.match(/window\.__SERVER_APP_STATE__\s*=\s*(\{.*?\})<\/script>/s)[1]);
  const model = state.initialData.model;
  if (model.Creator.Username !== 'Quaternius' || !['CC0 1.0', 'CC-BY 3.0'].includes(model.Licence)) throw new Error(`Review author/license for ${key}`);
  await writeFile(new URL(`${key}-data.json`, output), JSON.stringify(state.initialData, null, 2));
  const sourceUrl = html.match(/<model-viewer[^>]+src="([^"]+)"/)[1];
  let bytes = Buffer.from(await (await get(sourceUrl)).arrayBuffer());
  if (bytes.toString('ascii', 0, 4) !== 'glTF') bytes = brotliDecompressSync(bytes);
  if (bytes.toString('ascii', 0, 4) !== 'glTF') throw new Error(`Invalid GLB: ${key}`);
  await writeFile(new URL(`${key}.glb`, raw), bytes);
  provenance.push({ file: `${key}.glb`, title: model.Title, author: model.Creator.Username, license: model.Licence, page, sourceUrl, sourceSha256: createHash('sha256').update(bytes).digest('hex') });
  console.log(`Downloaded ${key}`);
}
const page = 'https://kenney.nl/assets/animated-characters-survivors';
const html = await (await get(page)).text();
const zipUrl = html.match(/https:\/\/kenney\.nl\/media\/[^'"\s]+\.zip/)[0];
const zip = new URL('kenney.zip', output);
await writeFile(zip, Buffer.from(await (await get(zipUrl)).arrayBuffer()));
const unpacked = new URL('kenney/', output);
execFileSync('python', ['-c', `import sys,zipfile,pathlib
root=pathlib.Path(sys.argv[2]).resolve()
with zipfile.ZipFile(sys.argv[1]) as archive:
 for entry in archive.infolist():
  if not (root/entry.filename).resolve().is_relative_to(root): raise ValueError('Unsafe archive path')
 archive.extractall(root)
`, fileURLToPath(zip), fileURLToPath(unpacked)]);
// Official release converter, used only for acquisition. Not bundled with the game.
const tools = new URL('tools/', output); await mkdir(tools, { recursive: true });
const converter = new URL('FBX2glTF.exe', tools);
await writeFile(converter, Buffer.from(await (await get('https://github.com/facebookincubator/FBX2glTF/releases/download/v0.9.7/FBX2glTF-windows-x64.exe')).arrayBuffer()));
for (const [key, file] of [['character', 'Model/characterMedium.fbx'], ['idle', 'Animations/idle.fbx'], ['run', 'Animations/run.fbx'], ['jump', 'Animations/jump.fbx']]) {
  execFileSync(fileURLToPath(converter), ['--binary', '--input', fileURLToPath(new URL(file, unpacked)), '--output', fileURLToPath(new URL(`kenney-${key}`, raw))], { stdio: 'inherit' });
}
execFileSync('python', [fileURLToPath(new URL('scripts/prepare-enemy-assets.py', workspace))], { stdio: 'inherit' });
const processing = JSON.parse(await readFile(new URL('processing.json', destination), 'utf8'));
const manifest = processing.map(entry => ({ ...entry, ...(provenance.find(source => source.file === entry.file) ?? { author: 'Kenney', title: 'Animated Characters Survivors', license: 'CC0 1.0', page, sourceUrl: zipUrl }) }));
for (const name of ['survivorFemaleA', 'survivorMaleB', 'zombieA', 'zombieC']) {
  const file = `${name}.png`, bytes = await readFile(new URL(file, destination));
  manifest.push({ file, author: 'Kenney', license: 'CC0 1.0', page, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), processing: 'Original texture, unchanged' });
}
await writeFile(new URL('manifest.json', destination), JSON.stringify(manifest, null, 2) + '\n');
