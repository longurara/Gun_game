import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Keep the complete source library outside public/: only models selected for a map should be shipped to players.
const workspace = new URL('../', import.meta.url);
const output = new URL('output/assets/buildings/', workspace);
const destination = new URL('assets-source/free-buildings/', workspace);
await mkdir(output, { recursive: true });
await mkdir(destination, { recursive: true });
const requested = process.argv.slice(2);
const packs = requested.length ? requested : ['building-kit', 'modular-buildings', 'city-kit-suburban', 'city-kit-commercial', 'city-kit-industrial', 'factory-kit', 'city-kit-roads', 'furniture-kit', 'survival-kit', 'space-station-kit', 'fantasy-town-kit', 'castle-kit', 'pirate-kit', 'retro-urban-kit', 'graveyard-kit', 'modular-dungeon-kit'];
const manifest = JSON.parse(await readFile(new URL('manifest.json', destination), 'utf8').catch(() => '[]'));
if (packs.some(slug => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))) throw new Error('Invalid pack slug');
async function inventory(dir, prefix = '') {
  const records = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const name = prefix + item.name, path = new URL(item.name + (item.isDirectory() ? '/' : ''), dir);
    if (item.isDirectory()) records.push(...await inventory(path, name + '/'));
    else {
      const bytes = await readFile(path);
      records.push({ file: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
  }
  return records;
}
// Native curl uses the Windows network configuration, which Node fetch may not inherit.
async function download(url) {
  if (process.platform !== 'win32') {
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(url + ': HTTP ' + response.status);
    return Buffer.from(await response.arrayBuffer());
  }
  const temporary = fileURLToPath(new URL(createHash('sha256').update(url).digest('hex').slice(0, 20) + '.bin', output));
  if (url.endsWith('.zip')) {
    const known = manifest.find(pack => pack.sourceUrl === url);
    const cached = await readFile(temporary).catch(() => known ? readFile(new URL(known.slug + '.zip', output)).catch(() => null) : null);
    if (known && cached && cached.length === known.zipBytes && createHash('sha256').update(cached).digest('hex') === known.zipSha256) return cached;
  }
  await new Promise((resolve, reject) => execFile('curl.exe', ['--fail', '--location', '--silent', '--show-error', '--connect-timeout', '15', '--max-time', '300', '--retry', '2', ...(url.endsWith('.zip') ? ['--continue-at', '-'] : []), '--output', temporary, url], { windowsHide: true }, error => error ? reject(error) : resolve()));
  return readFile(temporary);
}
// Fetch four independent packs concurrently; extraction and manifest updates remain sequential.
const downloaded = new Map(), pending = [...new Set(packs)];
await Promise.all(Array.from({ length: 4 }, async () => {
  while (pending.length) {
    const slug = pending.shift(), page = 'https://kenney.nl/assets/' + slug;
    console.log('Downloading ' + slug);
    const html = (await download(page)).toString('utf8');
    if (!html.includes('CC0')) throw new Error('License needs review: ' + slug);
    const sourceUrl = html.match(/https:\/\/kenney\.nl\/media\/[^'"\s]+\.zip/)?.[0];
    if (!sourceUrl) throw new Error('No creator download for ' + slug);
    const bytes = await download(sourceUrl);
    downloaded.set(slug, { page, sourceUrl, bytes });
    console.log('Downloaded ' + slug + ': ' + bytes.length + ' bytes');
  }
}));
for (const slug of new Set(packs)) {
  const { page, sourceUrl, bytes } = downloaded.get(slug);
  const zip = new URL(`${slug}.zip`, output), dir = new URL(`${slug}/`, destination);
  await writeFile(zip, bytes);
  await mkdir(dir, { recursive: true });
  // Extract GLB exports with supporting textures and the original license. Validate archive paths before writing.
  const python = `import sys,zipfile,pathlib
root=pathlib.Path(sys.argv[2]).resolve()
with zipfile.ZipFile(sys.argv[1]) as z:
 for item in z.infolist():
  p=pathlib.PurePosixPath(item.filename)
  if p.is_absolute() or '..' in p.parts: raise ValueError('Unsafe archive path')
  keep=(any(part.lower() in ('glb','glb format','gltf','gltf format') for part in p.parts) or p.name.lower().startswith('license') or p.name.lower() in ('preview.png','preview.jpg'))
  if keep and not item.is_dir():
   target=(root/pathlib.Path(*p.parts)).resolve()
   if not target.is_relative_to(root): raise ValueError('Unsafe destination')
   target.parent.mkdir(parents=True,exist_ok=True)
   target.write_bytes(z.read(item))
`;
  execFileSync('python', ['-c', python, fileURLToPath(zip), fileURLToPath(dir)]);
  const files = await inventory(dir), glbs = files.filter(f => f.file.toLowerCase().endsWith('.glb'));
  if (!glbs.length) throw new Error(`No GLB exports: ${slug}`);
  for (const file of glbs) {
    const data = await readFile(new URL(file.file, dir));
    if (data.toString('ascii', 0, 4) !== 'glTF' || data.readUInt32LE(8) !== data.length) throw new Error(`Invalid GLB ${slug}/${file.file}`);
  }
  const previous = manifest.findIndex(pack => pack.slug === slug);
  if (previous >= 0) manifest.splice(previous, 1);
  manifest.push({ slug, creator: 'Kenney', license: 'CC0-1.0', page, sourceUrl, zipBytes: bytes.length, zipSha256: createHash('sha256').update(bytes).digest('hex'), models: glbs.length, files });
  console.log(`${slug}: ${glbs.length} GLB models, ${bytes.length} archive bytes`);
  await writeFile(new URL('manifest.json', destination), JSON.stringify(manifest, null, 2) + '\n');
}
