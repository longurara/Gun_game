import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const output = new URL('../output/assets/menu/', import.meta.url);
await mkdir(output, { recursive: true });
const packs = [
  ['bunker', 'https://colorosse.com/assets/2d/ui/bunker-panel-ui-kit', 'https://cdn.colorosse.com/downloads/bunker-panel-ui-kit/bunker-panel-ui-kit.zip'],
  ['prompts', 'https://kenney.nl/assets/input-prompts'],
  ['sounds', 'https://kenney.nl/assets/interface-sounds'],
];
for (const [name, page, direct] of packs) {
  const html = await fetch(page).then(r => { if (!r.ok) throw new Error(`${page}: ${r.status}`); return r.text(); });
  const source = direct ?? html.match(/https:\/\/kenney\.nl\/media\/[^'"\s]+\.zip/)?.[0];
  if (!source) throw new Error(`No official download for ${name}`);
  const response = await fetch(source);
  if (!response.ok) throw new Error(`${source}: ${response.status}`);
  const zip = new URL(`${name}.zip`, output);
  await writeFile(zip, Buffer.from(await response.arrayBuffer()));
  // Validate every archive path before extraction. Acquisition only; Python is not a game dependency.
  execFileSync('python', ['-c', `import sys,zipfile,pathlib
root=pathlib.Path(sys.argv[2]).resolve()
with zipfile.ZipFile(sys.argv[1]) as z:
 for entry in z.infolist():
  target=(root/entry.filename).resolve()
  if not target.is_relative_to(root): raise ValueError('Unsafe archive path')
 z.extractall(root)
`, fileURLToPath(zip), fileURLToPath(new URL(`${name}/`, output))]);
  await writeFile(new URL(`${name}-source.json`, output), JSON.stringify({ page, source }, null, 2) + '\n');
  console.log(`Downloaded ${name} from ${source}`);
}

const workspace = new URL('../', import.meta.url);
const manifest = [];
async function install(pack, sourcePath, destinationPath, transform) {
  const source = new URL(`${pack}/${sourcePath}`, output);
  const destination = new URL(destinationPath, workspace);
  const original = await readFile(source);
  const bytes = transform ? Buffer.from(transform(original.toString('utf8'))) : original;
  await mkdir(new URL('./', destination), { recursive: true });
  await writeFile(destination, bytes);
  const provenance = JSON.parse(await readFile(new URL(`${pack}-source.json`, output), 'utf8'));
  manifest.push({ file: destinationPath, original: sourcePath, ...provenance, license: pack === 'bunker' ? 'CC BY 4.0' : 'CC0 1.0', modified: !!transform, bytes: bytes.length, sourceSha256: createHash('sha256').update(original).digest('hex'), sha256: createHash('sha256').update(bytes).digest('hex') });
}
const palette = {
  '#282e21': '#182128', '#39422f': '#26343e', '#141711': '#11181e', '#1c2017': '#1b252d',
  '#343b2b': '#202c35', '#434c36': '#30404b', '#b8c48f': '#71818b',
  '#404934': '#2c3c47', '#4c573d': '#3a4e5a', '#c8412b': '#f5b50a',
  '#2b3225': '#17222a', '#3c4532': '#24343f', '#737b59': '#b88a28',
  '#2a3123': '#192127', '#3b4430': '#242e36', '#3e4431': '#44515a',
  '#0b0d09': '#0a0d0f', '#424c36': '#38464f',
};
const recolor = svg => svg.replace(/#[0-9a-f]{6}/gi, value => palette[value.toLowerCase()] ?? value);
// The source's deep notches intersect text when stretched; simplify its cut outline for responsive nine-slicing.
function button(svg, amber = false) {
  let result = recolor(svg).replace(/d="M [^"]+"/g, 'd="M7 1H144L151 8V34L144 41H7L1 34V8Z"');
  if (amber) result = result.replace(/#[0-9a-f]{6}/gi, value => ({ '#202c35': '#f5b50a', '#30404b': '#ffd263', '#71818b': '#a87805', '#2c3c47': '#ffc52c', '#3a4e5a': '#ffdb7b', '#f5b50a': '#fbe3a2', '#17222a': '#dca007', '#24343f': '#efb128', '#b88a28': '#9b6f04' }[value] ?? value));
  return result;
}
for (const state of ['default', 'hover', 'pressed', 'disabled']) {
  await install('bunker', `bunker-panel-ui-kit/button-${state}.svg`, `src/assets/ui/bunker/button-${state}.svg`, svg => button(svg));
  await install('bunker', `bunker-panel-ui-kit/button-${state}.svg`, `src/assets/ui/bunker/action-${state}.svg`, svg => button(svg, true));
}
await install('bunker', 'bunker-panel-ui-kit/panel-window.svg', 'src/assets/ui/bunker/panel-window.svg', svg => recolor(svg)
  .replace(/d="M 20\.48[^"]+"/g, 'd="M10 2H116L126 12V116L116 126H10L2 118V10Z"')
  .replace(/d="M 28\.3[^"]+"/g, 'd="M14 12H114L116 14V114L114 116H14L12 114V14Z"'));
await install('bunker', 'bunker-panel-ui-kit/divider.svg', 'src/assets/ui/bunker/divider.svg', recolor);
await install('bunker', 'bunker-panel-ui-kit/LICENSE.txt', 'src/assets/ui/bunker/LICENSE.txt');
for (const name of ['keyboard_w', 'keyboard_a', 'keyboard_s', 'keyboard_d', 'keyboard_space', 'keyboard_escape', 'keyboard_e', 'keyboard_f', 'keyboard_1', 'keyboard_2', 'keyboard_3', 'keyboard_tab', 'keyboard_m', 'mouse_left', 'mouse_right']) {
  await install('prompts', `Keyboard & Mouse/Vector/${name}.svg`, `src/assets/ui/input-prompts/${name}.svg`);
}
for (const name of ['touch_swipe_move', 'touch_swipe_horizontal', 'touch_tap']) {
  await install('prompts', `Touch/Vector/${name}.svg`, `src/assets/ui/input-prompts/${name}.svg`);
}
await install('prompts', 'License.txt', 'src/assets/ui/input-prompts/License.txt');
for (const [name, original] of [['hover', 'tick_002'], ['click', 'click_001'], ['confirm', 'confirmation_001'], ['back', 'back_001']]) {
  await install('sounds', `Audio/${original}.ogg`, `src/assets/audio/interface/${name}.ogg`);
}
await install('sounds', 'License.txt', 'src/assets/audio/interface/License.txt');
await writeFile(new URL('src/assets/ui/menu-manifest.json', workspace), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Installed ${manifest.length} selected menu files`);
