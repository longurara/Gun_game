import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { brotliDecompressSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const workspace = new URL('../', import.meta.url);
const output = new URL('output/assets/', workspace);
await mkdir(output, { recursive: true });
const stateFrom = html => JSON.parse(html.match(/window\.__SERVER_APP_STATE__\s*=\s*(\{.*?\})<\/script>/s)[1]);
for (const [pack, page] of [['guns', 'Ultimate-Guns-Pack-cpgUfI4t2F'], ['characters', 'Ultimate-Modular-Men-Pack-ZiH8muWqwQ']]) {
  const response = await fetch(`https://poly.pizza/bundle/${page}`);
  if (!response.ok) throw new Error(`Cannot download ${pack}: ${response.status}`);
  const html = await response.text();
  await writeFile(new URL(`${pack}-page.html`, output), html);
  const state = stateFrom(html);
  const models = state.initialData.list.Models;
  await writeFile(new URL(`${pack}-data.json`, output), JSON.stringify(models, null, 2));
  console.log(`${pack}: ${models.length} models available`);
}
const chars = JSON.parse(await readFile(new URL('characters-data.json', output)));
const guns = JSON.parse(await readFile(new URL('guns-data.json', output)));
const destination = new URL('public/assets/free/', workspace);
await mkdir(destination, { recursive: true });
const selected = [
  ['swat', 'Btfn3G5Xv4'],
  ['gun-3', 'DcNE0HVdW8'],
  ['gun-5', 'K2lXTYFSLC'],
  ['gun-6', 'fpLucho45C'],
  ['gun-7', 'Jyn9qex4ba'],
  ['gun-9', '9C26wSpMS0'],
  ['gun-14', 'ZmPTnh7njL'],
  ['gun-17', '7ehatxr7FY'],
  ['gun-18', 'i65hEldsw6'],
  ['gun-19', 'XCIC2Ae4Rb'],
  ['gun-20', 'ASOMZIErq3'],
  ['gun-22', 'nsP3JukU73'],
  ['gun-23', 'iKAlIbHUFD'],
  ['gun-24', 'Bgvuu4CUMV'],
].map(([name, id]) => [name, [...chars, ...guns].find(model => model.publicID === id)]);
const manifest = [];
for (const [name, model] of selected) {
  if (!model || model.licence !== 'CC0 1.0') throw new Error(`Model or CC0 license needs review: ${name}`);
  const html = await fetch(`https://poly.pizza${model.url}`).then(r => r.text());
  await writeFile(new URL(`${model.publicID}-page.html`, output), html);
  const state = stateFrom(html);
  await writeFile(new URL(`${model.publicID}-data.json`, output), JSON.stringify(state.initialData, null, 2));
  const sourceUrl = html.match(/<model-viewer[^>]+src="([^"]+)"/)[1];
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error(`${sourceUrl}: ${response.status}`);
  let bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.toString('ascii', 0, 4) !== 'glTF') bytes = brotliDecompressSync(bytes);
  if (bytes.toString('ascii', 0, 4) !== 'glTF') throw new Error(`Invalid GLB: ${name}`);
  const jsonSize = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonSize));
  await writeFile(new URL(`${name}.glb`, destination), bytes);
  manifest.push({ file: `${name}.glb`, title: model.title, creator: 'Quaternius', license: model.licence, page: `https://poly.pizza${model.url}`, sourceUrl, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  console.log(`${name}: ${bytes.length} bytes, ${gltf.meshes?.length ?? 0} meshes`);
  if (name === 'swat') await writeFile(new URL('swat-gltf.json', output), JSON.stringify(gltf, null, 2));
}
await writeFile(new URL('manifest.json', destination), JSON.stringify(manifest, null, 2) + '\n');
const ui = new URL('src/assets/ui/kenney/', workspace);
await mkdir(ui, { recursive: true });
const uiPage = await fetch('https://kenney.nl/assets/ui-pack').then(r => r.text());
const uiSource = uiPage.match(/https:\/\/kenney\.nl\/media\/[^'"\s]+\.zip/)[0];
const zip = new URL('kenney-ui.zip', output), unpacked = new URL('kenney-ui/', output);
await writeFile(zip, Buffer.from(await fetch(uiSource).then(r => r.arrayBuffer())));
// Used only by this acquisition script; Python is not required to run the game.
execFileSync('python', ['-c', 'import sys,zipfile;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', fileURLToPath(zip), fileURLToPath(unpacked)]);
for (const [color, name] of [['Yellow', 'button_rectangle_depth_flat'], ['Grey', 'button_rectangle_depth_flat'], ['Yellow', 'icon_checkmark'], ['Yellow', 'star']]) {
  const from = new URL(`kenney-ui/Vector/${color}/${name}.svg`, output);
  let svg = await readFile(from, 'utf8');
  if (color === 'Grey') for (const [old, colour] of Object.entries({ '#989AAF': '#414B55', '#FFFFFF': '#64737E', '#DADCE7': '#1F2932', '#666880': '#121B22' })) svg = svg.replaceAll(old, colour);
  await writeFile(new URL(`${color.toLowerCase()}-${name}.svg`, ui), svg);
}
await copyFile(new URL('kenney-ui/License.txt', output), new URL('License.txt', ui));
