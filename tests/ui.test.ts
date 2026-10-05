import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { GameSimulation } from '../src/game/simulation.ts';
import type { GameUI as GameUIType } from '../src/ui.ts';

// The HUD is plain DOM, so a fake browser is enough to check its behaviour (not its CSS).
let GameUI: typeof GameUIType;
let dom: JSDOM;

function freshDom(touch = false): void {
  dom = new JSDOM('<!doctype html><html><body><div id="ui-root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, HTMLElement: dom.window.HTMLElement });
  if (touch) dom.window.document.documentElement.dataset.input = 'touch';
}
const callbacks = () => ({ onStart() {}, onResume() {}, onRestart() {}, onMenu() {}, onSettings() {}, onSelectWeapon() {} });
const el = (id: string) => dom.window.document.getElementById(id)!;
const click = (node: Element) => node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
const change = (node: Element) => node.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
const kill = (game: GameSimulation) => (game as unknown as { damage(a: unknown, n: number, s?: string): void }).damage(game.player, 999, 'bot-1');

before(async () => {
  freshDom();
  ({ GameUI } = await import('../src/ui.ts'));
});

test('the air readout toggles data-air on the page and leaves no attribute behind on the ground (the HUD-vanishes regression)', () => {
  freshDom();
  const ui = new GameUI(callbacks());
  const html = dom.window.document.documentElement, root = el('ui-root');
  ui.setAir({ mode: 'freefall', altitude: 400, speed: 60, seconds: 12 });
  assert.equal(root.dataset.air, 'freefall');
  assert.equal(html.dataset.air, 'freefall');
  assert.equal(el('air-hud').hidden, false);
  ui.setAir({ mode: 'chute', altitude: 90, speed: 6, seconds: 14 });
  assert.equal(html.dataset.air, 'chute');
  ui.setAir(null);
  // An empty data-air would still match [data-air] in CSS and hide the crosshair, weapon panel and health bar.
  assert.equal(root.hasAttribute('data-air'), false);
  assert.equal(html.hasAttribute('data-air'), false);
  assert.equal(el('air-hud').hidden, true);
});

test('the flight readout shows altitude, speed, time left and the landing flag line', () => {
  freshDom();
  const ui = new GameUI(callbacks());
  ui.setAir({ mode: 'freefall', altitude: 412.4, speed: 50, seconds: 8.4, flag: { distance: 1530, reachable: false, auto: false } });
  assert.equal(el('air-alt').textContent, '412');
  assert.equal(el('air-speed').textContent, '180');
  assert.equal(el('air-left').textContent, '8');
  assert.match(el('air-flag').textContent!, /1\.5 KM.*NGOÀI TẦM LƯỢN/);
  assert.equal(el('air-flag').hidden, false);
  ui.setAir({ mode: 'chute', altitude: 50, speed: 6, seconds: 7, flag: { distance: 80, reachable: true, auto: true } });
  assert.match(el('air-flag').textContent!, /80 M.*TỚI ĐƯỢC.*TỰ LÁI BẬT/);
  ui.setAir({ mode: 'chute', altitude: 50, speed: 6, seconds: 7 });
  assert.equal(el('air-flag').hidden, true);
});

test('settings are saved and restored: gyroscope mode, sensitivity, hints and the FPS readout', () => {
  freshDom(true);
  const first = new GameUI(callbacks());
  assert.equal(first.settings.gyro, 'aim', 'phones default to gyro while aiming');
  click(dom.window.document.querySelector('#gyro-choice button[data-value="always"]')!);
  const slider = el('gyro-sensitivity') as HTMLInputElement;
  slider.value = '1.6'; slider.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  const tips = el('tips') as HTMLInputElement;
  tips.checked = false; change(tips);
  const fps = el('show-fps') as HTMLInputElement;
  fps.checked = true; change(fps);
  assert.equal(first.settings.gyro, 'always');
  el('ui-root').innerHTML = '';
  const again = new GameUI(callbacks());
  assert.equal(again.settings.gyro, 'always');
  assert.equal(again.settings.gyroSensitivity, 1.6);
  assert.equal(again.settings.tips, false);
  assert.equal(again.settings.showFps, true);
});

test('a desktop starts with the gyroscope off, and bad stored values fall back to defaults', () => {
  freshDom();
  dom.window.localStorage.setItem('lastlight.settings.v1', JSON.stringify({ gyro: 'sideways', gyroSensitivity: 99, tips: 'yes' }));
  const ui = new GameUI(callbacks());
  assert.equal(ui.settings.gyro, 'off');
  assert.equal(ui.settings.gyroSensitivity, 3, 'clamped');
  assert.equal(ui.settings.tips, true);
});

test('a hint shows once, is remembered across visits, and stays quiet when hints are off', () => {
  freshDom();
  const ui = new GameUI(callbacks());
  ui.tip('car', 'Nhấn F để lên xe');
  assert.match(el('toast').textContent!, /GỢI Ý · Nhấn F để lên xe/);
  assert.equal(el('toast').hidden, false);
  ui.notify('khác');
  ui.tip('car', 'Nhấn F để lên xe');
  assert.equal(el('toast').textContent, 'khác', 'not shown a second time');
  assert.deepEqual(JSON.parse(dom.window.localStorage.getItem('lastlight.tips.v1')!), ['car']);
  el('ui-root').innerHTML = '';
  const next = new GameUI(callbacks());
  next.tip('car', 'lại');
  assert.notEqual(el('toast').textContent, 'GỢI Ý · lại', 'remembered in the next session');
  const tips = el('tips') as HTMLInputElement;
  tips.checked = false; change(tips);
  next.tip('heal', 'Nhấn H');
  assert.ok(!/Nhấn H/.test(el('toast').textContent!), 'hints off');
});

test('the spectate banner names who is watched and the HUD marks itself, then clears', () => {
  freshDom();
  const ui = new GameUI(callbacks());
  ui.setSpectate('Đối thủ 7');
  assert.equal(el('spectate-bar').hidden, false);
  assert.match(el('spectate-name').textContent!, /ĐỐI THỦ 7/);
  assert.equal(el('ui-root').dataset.spectate, 'on');
  ui.setSpectate(null);
  assert.equal(el('spectate-bar').hidden, true);
  assert.equal(el('ui-root').hasAttribute('data-spectate'), false);
});

test('the results screen shows the place the player died in, and offers to keep watching only while there is a match to watch', () => {
  freshDom();
  const ui = new GameUI(callbacks());
  const game = new GameSimulation({ seed: 4, botCount: 9, map: 'arena' });
  game.start();
  ui.update(game.state, game.world, '');
  kill(game);
  game.update(1 / 30);
  ui.update(game.state, game.world, '');
  assert.equal(el('result-screen').hidden, false);
  assert.equal(el('result-rank').textContent, `#${game.state.actors.length}`);
  assert.equal(el('spectate-button').hidden, false);
  assert.ok(game.continueAsSpectator());
  ui.update(game.state, game.world, ''); // the next frame: the results close while the match goes on
  assert.equal(el('result-screen').hidden, true);
  game.state.actors.filter(a => !a.isPlayer).slice(1).forEach(a => { a.alive = false; });
  game.update(1 / 30);
  ui.update(game.state, game.world, '');
  assert.equal(el('result-rank').textContent, `#${game.state.actors.length}`, 'the place stays where the player died');
  assert.equal(el('spectate-button').hidden, true);
});

test('the landing flag can be set and cleared, and big-map clicks place it in world coordinates', () => {
  freshDom();
  const ui = new GameUI(callbacks());
  const game = new GameSimulation({ seed: 4, botCount: 2, map: 'valley', drop: true });
  game.start();
  ui.update(game.state, game.world, '');
  assert.equal(ui.waypoint, null);
  ui.setWaypoint({ x: 100, z: -50 });
  assert.deepEqual(ui.waypoint, { x: 100, z: -50 });
  ui.setWaypoint(null);
  // Click the middle of the big map: the world origin.
  const canvas = el('bigmap') as HTMLCanvasElement;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 440, height: 440, right: 440, bottom: 440, x: 0, y: 0, toJSON() {} });
  canvas.dispatchEvent(new dom.window.MouseEvent('click', { clientX: 220, clientY: 220, bubbles: true }));
  assert.ok(ui.waypoint && Math.abs(ui.waypoint.x) < 2 && Math.abs(ui.waypoint.z) < 2, JSON.stringify(ui.waypoint));
  // Clicking the flag again removes it.
  canvas.dispatchEvent(new dom.window.MouseEvent('click', { clientX: 221, clientY: 221, bubbles: true }));
  assert.equal(ui.waypoint, null);
});

test('the crosshair opens with the bullet spread and the stance badge shows only when not standing', () => {
  freshDom();
  const ui = new GameUI(callbacks());
  ui.setCrosshair(4);
  assert.equal(el('crosshair').style.getPropertyValue('--gap'), '4px');
  ui.setCrosshair(17.26);
  assert.equal(el('crosshair').style.getPropertyValue('--gap'), '17.5px');
  ui.setCrosshair(500);
  assert.equal(el('crosshair').style.getPropertyValue('--gap'), '60px', 'capped');
  assert.equal(el('stance-badge').hidden, true);
  ui.setStance('crouch');
  assert.equal(el('stance-badge').hidden, false);
  assert.equal(el('stance-badge').textContent, 'ĐANG NGỒI');
  ui.setStance('prone');
  assert.equal(el('stance-badge').textContent, 'ĐANG NẰM');
  ui.setStance('stand');
  assert.equal(el('stance-badge').hidden, true);
});

test('recoil strength and aim assist are settings that persist; phones default to gentle recoil and light assist', () => {
  freshDom(true);
  const first = new GameUI(callbacks());
  assert.equal(first.settings.aimAssist, 'low');
  assert.equal(first.settings.recoilScale, 0.75);
  click(dom.window.document.querySelector('#assist-choice button[data-value="high"]')!);
  const slider = el('recoil-scale') as HTMLInputElement;
  slider.value = '1.25'; slider.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  el('ui-root').innerHTML = '';
  const again = new GameUI(callbacks());
  assert.equal(again.settings.aimAssist, 'high');
  assert.equal(again.settings.recoilScale, 1.25);
  assert.equal(el('recoil-value').textContent, '1.25×');
  freshDom();
  const desktop = new GameUI(callbacks());
  assert.equal(desktop.settings.aimAssist, 'off', 'no aim assist on a mouse by default');
  assert.equal(desktop.settings.recoilScale, 1, 'full PUBG-style recoil on a desktop');
});

test('gunshot cues point the right way, fade with distance and cycle through a few markers; the setting persists', () => {
  freshDom(true);
  const ui = new GameUI(callbacks());
  assert.equal(ui.settings.soundIndicator, true, 'on by default on phones');
  ui.showSoundFrom(Math.PI / 2, 0.8);
  assert.match(el('sound-dir-0').style.transform, /rotate\(1\.5707/);
  assert.equal(el('sound-dir-0').style.getPropertyValue('--loud'), '0.80');
  assert.ok(el('sound-dir-0').classList.contains('flash'));
  ui.showSoundFrom(-1, 0.05);
  assert.equal(el('sound-dir-1').style.getPropertyValue('--loud'), '0.25', 'even a faint shot leaves a visible cue');
  ui.showSoundFrom(0, 1); ui.showSoundFrom(0, 1); ui.showSoundFrom(2, 1);
  assert.match(el('sound-dir-0').style.transform, /rotate\(2rad\)/, 'the fifth cue reuses the first marker');
  const box = el('sound-indicator') as HTMLInputElement;
  box.checked = false; change(box);
  el('ui-root').innerHTML = '';
  assert.equal(new GameUI(callbacks()).settings.soundIndicator, false);
});
