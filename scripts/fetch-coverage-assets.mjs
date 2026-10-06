import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Source archives stay outside the web build. prepare-coverage-assets selects runtime files.
const root = new URL('../output/assets/coverage/', import.meta.url);
await mkdir(root, { recursive: true });
const manifest = [];
for (const slug of ['car-kit', 'particle-pack', 'smoke-particles', 'impact-sounds', 'rpg-audio', 'sci-fi-sounds', 'skyboxes', 'nature-kit', 'blaster-kit']) {
  const page = `https://kenney.nl/assets/${slug}`;
  const response = await fetch(page, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${slug}: ${response.status}`);
  const html = await response.text();
  if (!html.includes('CC0')) throw new Error(`Changed license: ${slug}`);
  const sourceUrl = html.match(/https:\/\/kenney\.nl\/media\/[^'"\s]+\.zip/)?.[0];
  if (!sourceUrl) throw new Error(`Missing download: ${slug}`);
  const download = await fetch(sourceUrl, { signal: AbortSignal.timeout(60000) });
  if (!download.ok) throw new Error(`${slug}: ${download.status}`);
  const bytes = Buffer.from(await download.arrayBuffer());
  const zip = new URL(`${slug}.zip`, root), dir = new URL(`${slug}/`, root);
  await writeFile(zip, bytes);
  execFileSync('python', ['-c', `import sys,zipfile,pathlib
root=pathlib.Path(sys.argv[2]).resolve()
with zipfile.ZipFile(sys.argv[1]) as z:
 for item in z.infolist():
  p=pathlib.PurePosixPath(item.filename)
  if p.is_absolute() or '..' in p.parts: raise ValueError('Unsafe archive path')
  target=(root/pathlib.Path(*p.parts)).resolve()
  if not target.is_relative_to(root): raise ValueError('Unsafe destination')
  if not item.is_dir():
   target.parent.mkdir(parents=True,exist_ok=True)
   target.write_bytes(z.read(item))`, fileURLToPath(zip), fileURLToPath(dir)]);
  manifest.push({ slug, author: 'Kenney', license: 'CC0-1.0', page, sourceUrl, archiveBytes: bytes.length, archiveSha256: createHash('sha256').update(bytes).digest('hex') });
  console.log(`${slug}: ${bytes.length} bytes`);
  await writeFile(new URL('sources.json', root), JSON.stringify(manifest, null, 2));
}
