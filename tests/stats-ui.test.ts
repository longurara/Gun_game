import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { GameSimulation } from '../src/game/simulation.ts';
import { MatchStats } from '../src/match-stats.ts';
import type { GameUI as GameUIType } from '../src/ui.ts';

let GameUI: typeof GameUIType;
let dom: JSDOM;
before(async () => {
  dom = new JSDOM('<!doctype html><html><body><div id="ui-root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, HTMLElement: dom.window.HTMLElement });
  ({ GameUI } = await import('../src/ui.ts'));
});
const click = (node: Element) => node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

test('after a match the results screen offers the statistics: weapons, highlights and kills, and a way back', () => {
  localStorage.clear();
  const stats = new MatchStats();
  const ctx = { localId: 'player', t: 90, nameOf: (id: string) => id };
  stats.event({ type: 'shot', actorId: 'player', weapon: 'rifle', from: { x: 0, y: 1, z: 0 }, to: { x: 0, y: 1, z: 30 }, hitId: 'bot-1' }, ctx);
  stats.event({ type: 'damage', actorId: 'bot-1', amount: 45, sourceId: 'player', cause: 'rifle' }, ctx);
  stats.event({ type: 'kill', actorId: 'bot-1', killerId: 'player', cause: 'rifle', at: { x: 40, y: 0, z: 30 }, from: { x: 0, y: 0, z: 0 } }, ctx);
  stats.sample(0, { x: 0, z: 0 }, 'foot'); stats.sample(5, { x: 10, z: 5 }, 'foot');
  const ui = new GameUI({ onStart() {}, onResume() {}, onRestart() {}, onMenu() {}, onSettings() {}, onSelectWeapon() {}, onStats: () => stats.summary() });
  const game = new GameSimulation({ seed: 6, botCount: 3, map: 'arena' });
  game.start();
  const doc = dom.window.document;
  ui.update(game.state, game.world, '');
  assert.equal(doc.getElementById('stats-screen')!.hidden, true);
  game.state.phase = 'lost';
  ui.update(game.state, game.world, '');
  const button = doc.getElementById('stats-button') as HTMLButtonElement;
  assert.equal(button.hidden, false, 'the results screen has the button');
  click(button);
  assert.equal(doc.getElementById('stats-screen')!.hidden, false, 'the statistics open');
  assert.match(doc.getElementById('stats-weapons')!.textContent!, /AR-26/);
  assert.match(doc.getElementById('stats-lights')!.textContent!, /Sát thương gây ra/);
  assert.match(doc.getElementById('stats-lights')!.textContent!, /50 m/, 'the kill was 50 m away');
  assert.match(doc.getElementById('stats-kills')!.textContent!, /bot-1/);
  assert.equal(doc.getElementById('stats-kills-title')!.hidden, false);
  click(doc.getElementById('stats-close')!);
  assert.equal(doc.getElementById('stats-screen')!.hidden, true, 'and close again');
});

test('the range has no statistics button', () => {
  localStorage.clear();
  const ui = new GameUI({ onStart() {}, onResume() {}, onRestart() {}, onMenu() {}, onSettings() {}, onSelectWeapon() {}, onStats: () => null });
  const game = new GameSimulation({ seed: 6, botCount: 0, map: 'range' });
  game.start();
  ui.update(game.state, game.world, '');
  game.state.phase = 'lost';
  ui.update(game.state, game.world, '');
  assert.equal(dom.window.document.getElementById('stats-button')!.hidden, true);
});
