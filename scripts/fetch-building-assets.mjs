import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Keep the complete source library outside public/: only models selected for a map should be shipped to players.
const workspace = new URL('../', import.meta.url);
const output = new URL('output/assets/buildings/', workspace);
const destination = new URL('assets-source/free-buildings/', workspace);
await mkdir(output, { recursive: true });
await mkdir(destination, { recursive: true });
const packs = ['building-kit', 'modular-buildings', 'city-kit-suburban', 'city-kit-commercial', 'city-kit-industrial', 'factory-kit', 'city-kit-roads', 'furniture-kit', 'survival-kit', 'space-station-kit'];
const manifest = [];
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
for (const slug of packs) {
  const page = `https://kenney.nl/assets/${slug}`;
  const response = await fetch(page);
  if (!response.ok) throw new Error(`${page}: HTTP ${response.status}`);
  const html = await response.text();
  if (!html.includes('CC0')) throw new Error(`License needs review: ${slug}`);
  const sourceUrl = html.match(/https:\/\/kenney\.nl\/media\/[^'"\s]+\.zip/)?.[0];
  if (!sourceUrl) throw new Error(`No creator download for ${slug}`);
  const zipResponse = await fetch(sourceUrl);
  if (!zipResponse.ok) throw new Error(`${sourceUrl}: HTTP ${zipResponse.status}`);
  const bytes = Buffer.from(await zipResponse.arrayBuffer());
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
  manifest.push({ slug, creator: 'Kenney', license: 'CC0-1.0', page, sourceUrl, zipBytes: bytes.length, zipSha256: createHash('sha256').update(bytes).digest('hex'), models: glbs.length, files });
  console.log(`${slug}: ${glbs.length} GLB models, ${bytes.length} archive bytes`);
  await writeFile(new URL('manifest.json', destination), JSON.stringify(manifest, null, 2) + '\n');
}
