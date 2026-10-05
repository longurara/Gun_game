import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { GameSimulation } from '../src/game/simulation.ts';
import { GameUI } from '../src/ui.ts';

function setup(touch = false) {
  const dom = new JSDOM('<!doctype html><html><body><div id="ui-root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, HTMLElement: dom.window.HTMLElement });
  dom.window.HTMLCanvasElement.prototype.getContext = () => null;
  if (touch) document.documentElement.dataset.input = 'touch';
  const changes: boolean[] = [], actions: string[] = [];
  const ui = new GameUI({ onStart() {}, onResume() {}, onRestart() {}, onMenu() {}, onSettings() {}, onInventoryChange: open => changes.push(open), onInventoryPickup: id => actions.push(id) });
  const sim = new GameSimulation({ map: 'arena', botCount: 5, difficulty: 'normal' });
  const update = () => { ui.update(sim.state, sim.world, ''); ui.updateInventory(sim.player, sim.nearbyLoot()); };
  return { dom, ui, sim, changes, actions, update };
}

test('full inventory only opens in a live match and closes for pause, death and spectators', () => {
  const { ui, sim, changes, update } = setup();
  ui.toggleInventory(true);
  assert.equal(ui.inventoryOpen, false);
  sim.start(); update(); ui.toggleInventory(true);
  assert.equal(ui.inventoryOpen, true);
  assert.equal(document.getElementById('ui-root')!.dataset.inventory, 'open');
  assert.equal(document.getElementById('inventory-toggle')!.getAttribute('aria-expanded'), 'true');
  sim.setPaused(true); update();
  assert.equal(ui.inventoryOpen, false);
  sim.setPaused(false); update(); ui.toggleInventory(true);
  sim.player.alive = false; update();
  assert.equal(ui.inventoryOpen, false);
  sim.player.alive = true; sim.state.spectating = true; update(); ui.toggleInventory(true);
  assert.equal(ui.inventoryOpen, false);
  assert.deepEqual(changes, [true, false, true, false]);
});

test('map, compact weapon drawer and full inventory remain mutually exclusive on touch', () => {
  const { dom, ui, sim, update } = setup(true);
  sim.start(); update();
  document.getElementById('touch-inventory-toggle')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(document.getElementById('weapon-panel')!.classList.contains('touch-picker-open'), true);
  ui.toggleInventory(true);
  assert.equal(document.getElementById('weapon-panel')!.classList.contains('touch-picker-open'), false);
  assert.equal(ui.touchOverlayOpen, true);
  ui.toggleMap(true);
  assert.equal(ui.inventoryOpen, false);
  assert.equal(ui.mapOpen, true);
  ui.toggleInventory(true);
  assert.equal(ui.mapOpen, false);
  assert.equal(ui.inventoryOpen, true);
  ui.toggleInventory(false);
  assert.equal(ui.touchOverlayOpen, false);
});

test('close button returns HUD state and Escape closes inventory without opening pause', () => {
  const { dom, ui, sim, update } = setup();
  sim.start(); update(); ui.toggleInventory(true);
  document.getElementById('inventory-close')!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(ui.inventoryOpen, false);
  assert.equal(sim.state.phase, 'playing');
  assert.equal(document.getElementById('ui-root')!.hasAttribute('data-inventory'), false);
  ui.toggleInventory(true);
  document.getElementById('inventory-close')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(ui.inventoryOpen, false);
  assert.equal(document.getElementById('inventory-toggle')!.getAttribute('aria-expanded'), 'false');
});
