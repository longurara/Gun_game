import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const dest = new URL('../public/assets/coverage/', import.meta.url), output = new URL('../output/assets/coverage/audio/', import.meta.url);
await mkdir(output, { recursive: true });
const manifest = JSON.parse(await readFile(new URL('audio-manifest.json', dest), 'utf8').catch(() => '[]'));
const sources = [
  ['reload', 'SpringySpringo', 'gun-reload-sounds', 'assaultriflereload1_0.wav'],
  ['reload-pistol', 'SpringySpringo', 'gun-reload-sounds', 'gunreload1.wav'],
  ['reload-shotgun', 'SpringySpringo', 'gun-reload-sounds', 'shotguncock_0.wav'],
  ['engine', 'domasx2', 'racing-car-engine-sound-loops', 'loop_0.wav'],
  ['wind', 'SketchMan3', 'wind-whoosh-loop', 'wind%20woosh%20loop.ogg'],
  ['drip', 'Independent.nu (submitted by qubodup)', 'dripping-water-loop', 'atmosbasement.mp3_.flac'],
];
for (const [name, author, slug, original] of sources) {
  if (manifest.some(m => m.file === `${name}.ogg`)) continue;
  const page = `https://opengameart.org/content/${slug}`;
  const html = await (await fetch(page)).text();
  if (!html.includes('CC0') || !html.includes(original)) throw new Error(`Changed source/license ${name}`);
  const sourceUrl = `https://opengameart.org/sites/default/files/${original}`;
  const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${name}: ${response.status}`);
  const raw = Buffer.from(await response.arrayBuffer()), path = new URL(original.replaceAll('%20', ' '), output);
  await writeFile(path, raw);
  const target = new URL(`${name}.ogg`, dest);
  execFileSync(process.env.FFMPEG_PATH ?? 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', fileURLToPath(path), '-t', '8', '-ac', '1', '-ar', '44100', '-af', 'loudnorm=I=-20:TP=-2:LRA=7', '-c:a', 'libvorbis', '-q:a', '3', fileURLToPath(target)]);
  const data = await readFile(target);
  manifest.push({ file: `${name}.ogg`, author, license: 'CC0-1.0', page, sourceUrl, originalSha256: createHash('sha256').update(raw).digest('hex'), bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), processing: 'Mono 44.1kHz Vorbis, loudness normalised -20 LUFS' });
  console.log(`${name}: ${data.length} bytes`);
}
if (!manifest.some(m => m.file === 'breath.ogg')) {
  const page = 'https://opengameart.org/content/80-cc0-creature-sfx';
  const html = await (await fetch(page)).text();
  if (!html.includes('CC0')) throw new Error('Changed breath license');
  const sourceUrl = 'https://opengameart.org/sites/default/files/80-CC0-creature-SFX_0.zip';
  const raw = Buffer.from(await (await fetch(sourceUrl)).arrayBuffer());
  const zip = new URL('creature.zip', output), wav = new URL('breath.wav', output); await writeFile(zip, raw);
  const sourceFile = execFileSync('python', ['-c', `import zipfile,sys
with zipfile.ZipFile(sys.argv[1]) as z:
 f=next(n for n in z.namelist() if 'breath' in n.lower() and n.lower().endswith(('.wav','.ogg')))
 open(sys.argv[2],'wb').write(z.read(f));print(f)`, fileURLToPath(zip), fileURLToPath(wav)], { encoding: 'utf8' }).trim();
  const target = new URL('breath.ogg', dest);
  execFileSync(process.env.FFMPEG_PATH ?? 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', fileURLToPath(wav), '-t', '1', '-ac', '1', '-ar', '44100', '-af', 'loudnorm=I=-24:TP=-3:LRA=7', '-c:a', 'libvorbis', '-q:a', '3', fileURLToPath(target)]);
  const data = await readFile(target);
  manifest.push({ file: 'breath.ogg', author: 'rubberduck', license: 'CC0-1.0', page, sourceUrl, sourceFile, originalSha256: createHash('sha256').update(raw).digest('hex'), bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), processing: 'First second, mono 44.1kHz Vorbis, -24 LUFS' });
}
await writeFile(new URL('audio-manifest.json', dest), JSON.stringify(manifest, null, 2));
