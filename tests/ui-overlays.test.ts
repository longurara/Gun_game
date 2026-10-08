import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { GameSimulation } from '../src/game/simulation.ts';
import { GameUI } from '../src/ui.ts';
import { ChatView } from '../src/chat-ui.ts';

function setup() {
  const dom = new JSDOM('<div id="ui-root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, HTMLElement: dom.window.HTMLElement });
  dom.window.HTMLCanvasElement.prototype.getContext = () => null;
  const ui = new GameUI({ onStart() {}, onResume() {}, onRestart() {}, onMenu() {}, onSettings() {} });
  const sim = new GameSimulation({ seed: 4, map: 'range', botCount: 0 }); sim.start();
  const update = () => { ui.update(sim.state, sim.world, ''); ui.updateInventory(sim.player, sim.nearbyLoot()); };
  update();
  return { dom, ui, sim, update };
}

test('opening inventory replaces the armoury instead of stacking both dialogs', () => {
  const { ui } = setup(); ui.toggleArmoury(true); ui.toggleInventory(true);
  assert.equal(ui.inventoryOpen, true); assert.equal(ui.armouryOpen, false);
  assert.equal(document.activeElement?.id, 'inventory-close');
});

test('opening the armoury replaces inventory and keeps focus in the new dialog', () => {
  const { ui } = setup(); ui.toggleInventory(true); ui.toggleArmoury(true);
  assert.equal(ui.armouryOpen, true); assert.equal(ui.inventoryOpen, false);
  assert.equal(document.activeElement?.id, 'armoury-search');
});

test('opening the map replaces the armoury and focuses its close button', () => {
  const { ui } = setup(); ui.toggleArmoury(true); ui.toggleMap(true);
  assert.equal(ui.mapOpen, true); assert.equal(ui.armouryOpen, false);
  assert.equal(document.activeElement?.id, 'map-close');
});

test('dying with the armoury open closes it and respawn does not reopen it', () => {
  const { ui, sim, update } = setup(); ui.toggleArmoury(true);
  sim.player.alive = false; update(); assert.equal(ui.armouryOpen, false);
  sim.player.alive = true; update(); assert.equal(ui.armouryOpen, false);
});

test('returning to the menu closes the armoury without leaving focus in hidden search', () => {
  const { ui, sim, update } = setup(); ui.toggleArmoury(true);
  sim.returnToMenu(); update();
  assert.equal(ui.armouryOpen, false); assert.equal(document.activeElement?.id, 'start-button');
});

test('dead players and spectators cannot reopen the armoury', () => {
  const { ui, sim, update } = setup(); sim.player.alive = false; update(); ui.toggleArmoury(true);
  assert.equal(ui.armouryOpen, false);
  sim.player.alive = true; sim.state.spectating = true; update(); ui.toggleArmoury(true);
  assert.equal(ui.armouryOpen, false);
});

test('the multiplayer pause menu closes the armoury and map', () => {
  const { ui } = setup(); ui.setMultiplayer(true); ui.toggleArmoury(true); ui.setMpMenu(true);
  assert.equal(ui.armouryOpen, false); assert.equal(ui.mapOpen, false);
  ui.setMpMenu(false); ui.toggleMap(true); ui.setMpMenu(true);
  assert.equal(ui.mapOpen, false); assert.equal(document.activeElement?.id, 'resume-button');
});

test('map and armoury cannot open over the multiplayer pause menu', () => {
  const { ui } = setup(); ui.setMultiplayer(true); ui.setMpMenu(true);
  ui.toggleMap(true); assert.equal(ui.mapOpen, false);
  ui.toggleArmoury(true); assert.equal(ui.armouryOpen, false);
});

function chat() {
  const { dom } = setup();
  const view = new ChatView(document.getElementById('ui-root')!, { send: () => true, toggle() {}, exit() {} });
  view.setEnabled(true);
  return { view, dom };
}

test('a new match starts with no unread badge from the previous room', () => {
  const { view } = chat(); view.render([{ id: 1, from: 'guest', name: 'Bạn', text: 'Chào' }]);
  const badge = document.getElementById('chat-unread')!; assert.equal(badge.hidden, false);
  view.setEnabled(false); view.setEnabled(true);
  assert.equal(badge.hidden, true);
});

test('leaving a match clears the old draft and send error from chat', () => {
  const { view } = chat(); view.toggle(true);
  const input = document.getElementById('chat-input') as HTMLInputElement;
  input.value = 'Bản nháp phòng cũ'; document.getElementById('chat-hint')!.textContent = 'Lỗi gửi cũ';
  view.setEnabled(false); view.setEnabled(true); view.toggle(true);
  assert.equal(input.value, ''); assert.match(document.getElementById('chat-hint')!.textContent!, /Enter để gửi/);
});
