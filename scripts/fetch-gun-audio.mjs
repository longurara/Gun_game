import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// Acquisition tools only: Node, Python and FFmpeg. The game ships eight local OGG files.
const output = new URL('../output/assets/gun-audio/', import.meta.url);
await mkdir(output, { recursive: true });
async function get(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`${new URL(url).hostname}: HTTP ${response.status}`);
  return response;
}
for (const [index, slug] of ['snakes-authentic-gun-sounds', 'snakes-second-authentic-gun-sounds-pack'].entries()) {
  const page = `https://f8studios.itch.io/${slug}`;
  const response = await get(page), html = await response.text();
  await writeFile(new URL(`page-${index}.html`, output), html);
  const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const csrf = html.match(/name="csrf_token" value="([^"]+)"/)?.[1];
  if (!csrf) throw new Error('itch.io page has no download token');
  const post = async (url, token) => (await get(url, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie, Referer: page },
    body: new URLSearchParams({ csrf_token: token }),
  })).json();
  // The same zero-price flow as “No thanks, just take me to the downloads”.
  const download = await post(`${page}/download_url`, csrf);
  if (!download.url) throw new Error('Free download page unavailable');
  const downloadHtml = await (await get(download.url, { headers: { Cookie: cookie } })).text();
  const upload = downloadHtml.match(/data-upload_id="(\d+)"/)?.[1];
  const downloadCsrf = downloadHtml.match(/name="csrf_token" value="([^"]+)"/)?.[1];
  if (!upload || !downloadCsrf) throw new Error('Free archive unavailable');
  const file = await post(`${page}/file/${upload}?source=game_download`, downloadCsrf);
  if (!file.url) throw new Error('Archive download unavailable');
  await writeFile(new URL(`snake-${index + 1}.zip`, output), Buffer.from(await (await get(file.url)).arrayBuffer()));
  console.log(`Downloaded SnakeF8 pack ${index + 1}`);
}
await writeFile(new URL('lmg_fire01.mp3', output), Buffer.from(await (await get('https://opengameart.org/sites/default/files/lmg_fire01.mp3')).arrayBuffer()));
await writeFile(new URL('page-2.html', output), await (await get('https://opengameart.org/content/light-machine-gun')).text());
const licenses = new URL('../src/assets/audio/guns/', import.meta.url);
await mkdir(licenses, { recursive: true });
await writeFile(new URL('CC-BY-4.0.txt', licenses), await (await get('https://creativecommons.org/licenses/by/4.0/legalcode.txt')).text());
execFileSync('python', [fileURLToPath(new URL('prepare-gun-audio.py', import.meta.url))], { stdio: 'inherit' });
// Fail if the processing step did not produce the tracked provenance manifest.
await readFile(new URL('manifest.json', licenses));
