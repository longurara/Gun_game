import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { GameSimulation } from '../src/game/simulation.ts';
import { WEAPON_ORDER, WEAPONS } from '../src/game/weapons.ts';
import type { GameUI as GameUIType } from '../src/ui.ts';
import type { WeaponType } from '../src/types.ts';

let GameUI: typeof GameUIType;
let dom: JSDOM;
before(async () => {
  dom = new JSDOM('<!doctype html><html><body><div id="ui-root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, HTMLElement: dom.window.HTMLElement });
  ({ GameUI } = await import('../src/ui.ts'));
});
const click = (node: Element) => node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

function rangeUi() {
  const taken: WeaponType[] = [], opened: boolean[] = [];
  const ui = new GameUI({
    onStart() {}, onResume() {}, onRestart() {}, onMenu() {}, onSettings() {}, onSelectWeapon() {},
    onRangeEquip: weapon => taken.push(weapon), onArmouryChange: open => opened.push(open),
  });
  const game = new GameSimulation({ seed: 4, botCount: 2, map: 'range' });
  game.start();
  ui.update(game.state, game.world, '');
  return { ui, game, taken, opened, doc: dom.window.document };
}

test('the menu shows the immortal switch only for the range, and keeps it', () => {
  localStorage.clear();
  const ui = new GameUI({ onStart() {}, onResume() {}, onRestart() {}, onMenu() {}, onSettings() {}, onSelectWeapon() {} });
  const doc = dom.window.document;
  assert.equal(doc.getElementById('immortal-group')!.hidden, true, 'hidden on the island');
  click(doc.querySelector('#map-choice button[data-value="range"]')!);
  assert.equal(ui.settings.map, 'range');
  assert.equal(doc.getElementById('immortal-group')!.hidden, false);
  assert.deepEqual([...doc.querySelectorAll('#bot-choice button')].map(b => (b as HTMLElement).dataset.value), ['0', '3', '6', '10']);
  assert.equal(ui.settings.botCount, 3);
  click(doc.querySelector('#immortal-choice button[data-value="on"]')!);
  assert.equal(ui.settings.immortal, true);
  const again = new GameUI({ onStart() {}, onResume() {}, onRestart() {}, onMenu() {}, onSettings() {}, onSelectWeapon() {} });
  assert.equal(again.settings.immortal, true, 'remembered');
  click(doc.querySelector('#map-choice button[data-value="island"]')!);
  assert.equal(doc.getElementById('immortal-group')!.hidden, true);
});

test('the armoury lists every gun, filters by class and by name, and a click takes the gun', () => {
  localStorage.clear();
  const { ui, taken, opened, doc } = rangeUi();
  assert.equal(ui.armouryOpen, false);
  ui.toggleArmoury(true);
  assert.equal(ui.armouryOpen, true);
  assert.deepEqual(opened, [true]);
  const cards = () => [...doc.querySelectorAll<HTMLButtonElement>('#armoury-grid button[data-weapon]')];
  assert.equal(cards().length, WEAPON_ORDER.length);
  assert.ok(doc.querySelectorAll('#armoury-classes button').length >= 9);
  // Pick a class.
  click(doc.querySelector('#armoury-classes button[data-class="sniper"]')!);
  assert.ok(cards().length > 5 && cards().every(c => WEAPONS[c.dataset.weapon as WeaponType].kind === 'sniper'));
  // Search by name across everything.
  click(doc.querySelector('#armoury-classes button[data-class="all"]')!);
  const search = doc.getElementById('armoury-search') as HTMLInputElement;
  search.value = 'm416'; search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.deepEqual(cards().map(c => c.dataset.weapon), ['m416']);
  search.value = 'zzz-no-such-gun'; search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(cards().length, 0);
  assert.ok(doc.querySelector('.armoury-empty'));
  search.value = ''; search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  // A click equips, and marks the card.
  click(cards().find(c => c.dataset.weapon === 'awm')!);
  assert.deepEqual(taken, ['awm']);
  assert.ok(cards().find(c => c.dataset.weapon === 'awm')!.classList.contains('on'));
  // Escape closes it.
  doc.getElementById('range-armoury')!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(ui.armouryOpen, false);
  assert.deepEqual(opened, [true, false]);
});

test('the range panel shows the last hit and the accuracy, and the immortal button flips the setting', () => {
  localStorage.clear();
  const { ui, game, doc } = rangeUi();
  assert.equal(doc.getElementById('range-panel')!.hidden, false);
  assert.equal(doc.getElementById('ui-root')!.classList.contains('on-range'), true);
  assert.match(doc.getElementById('range-stats')!.textContent!, /Chưa bắn/);
  ui.rangeHit(41.6, 86.4, true);
  game.state.shots = 10; game.state.hits = 7; game.state.kills = 2;
  ui.update(game.state, game.world, '');
  assert.match(doc.getElementById('range-last')!.textContent!, /ĐẦU.*42.*86 m/);
  assert.match(doc.getElementById('range-stats')!.textContent!, /70%.*7\/10.*2 bia/);
  assert.equal(doc.getElementById('range-immortal-state')!.textContent, 'TẮT');
  click(doc.getElementById('range-immortal')!);
  assert.equal(ui.settings.immortal, true);
  ui.update(game.state, game.world, '');
  assert.equal(doc.getElementById('range-immortal-state')!.textContent, 'BẬT');
  assert.equal(doc.getElementById('range-immortal')!.getAttribute('aria-pressed'), 'true');
  // On a real map the panel is gone.
  const island = new GameSimulation({ seed: 3, botCount: 5, map: 'island' });
  island.start();
  ui.update(island.state, island.world, '');
  assert.equal(doc.getElementById('range-panel')!.hidden, true);
});

test('the scope shows a breath meter that follows what the shooter has left', () => {
  localStorage.clear();
  const { ui, doc } = rangeUi();
  ui.setBreath(1, false, false);
  assert.equal(doc.getElementById('scope-breath-fill')!.style.transform, 'scaleX(1)');
  assert.match(doc.getElementById('scope-breath-label')!.textContent!, /NÍN THỞ/);
  ui.setBreath(0.4, true, false);
  assert.equal(doc.getElementById('scope-breath-fill')!.style.transform, 'scaleX(0.4)');
  assert.ok(doc.getElementById('scope-breath')!.classList.contains('holding'));
  assert.match(doc.getElementById('scope-breath-label')!.textContent!, /ĐANG/);
  ui.setBreath(0, false, true);
  assert.ok(doc.getElementById('scope-breath')!.classList.contains('winded'));
  assert.match(doc.getElementById('scope-breath-label')!.textContent!, /HẾT HƠI/);
});
