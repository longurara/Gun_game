import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { DEFAULT_SKIN, isUnlocked, lockText, SKINS, skinById, usableSkin } from '../src/skins.ts';
import { outfitFor } from '../src/outfits.ts';
import { Lobby } from '../src/net/lobby.ts';
import type { RoomConfig } from '../src/net/lobby.ts';
import { LoopbackNetwork } from '../src/net/transport.ts';
import type { GameUI as GameUIType } from '../src/ui.ts';

let GameUI: typeof GameUIType;
let dom: JSDOM;
function freshDom(): void {
  dom = new JSDOM('<!doctype html><html><body><div id="ui-root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, HTMLElement: dom.window.HTMLElement });
}
const callbacks = () => ({ onStart() {}, onResume() {}, onRestart() {}, onMenu() {}, onSettings() {}, onSelectWeapon() {} });
const click = (node: Element) => node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
before(async () => { freshDom(); ({ GameUI } = await import('../src/ui.ts')); });

test('there are eight outfits with unique ids, one free, the rest earned, and every outfit looks different', () => {
  assert.equal(SKINS.length, 8);
  assert.equal(new Set(SKINS.map(s => s.id)).size, SKINS.length);
  assert.equal(SKINS.filter(s => s.unlock.kind === 'free').length, 1);
  assert.equal(SKINS.find(s => s.unlock.kind === 'free')!.id, DEFAULT_SKIN);
  assert.equal(new Set(SKINS.map(s => JSON.stringify(s.outfit.fabric) + JSON.stringify(s.outfit.hat))).size, SKINS.length);
});

test('outfits unlock with wins or kills, and an outfit that is not earned falls back to the default', () => {
  const jungle = skinById('jungle')!, gold = skinById('gold')!;
  assert.equal(isUnlocked(jungle, { wins: 0, kills: 0 }), false);
  assert.equal(isUnlocked(jungle, { wins: 0, kills: 1 }), true);
  assert.equal(isUnlocked(gold, { wins: 9, kills: 999 }), false);
  assert.equal(isUnlocked(gold, { wins: 10, kills: 0 }), true);
  assert.match(lockText(gold, { wins: 4, kills: 0 }), /4 \/ 10/);
  assert.equal(usableSkin('gold', { wins: 0, kills: 0 }), DEFAULT_SKIN);
  assert.equal(usableSkin('gold', { wins: 12, kills: 0 }), 'gold');
  assert.equal(usableSkin('no-such-skin', { wins: 99, kills: 99 }), DEFAULT_SKIN);
  assert.equal(usableSkin(undefined, { wins: 0, kills: 0 }), DEFAULT_SKIN);
});

test('the player wears the chosen outfit, friends keep their jersey colour but take the cap, and bots are unchanged', () => {
  const gold = skinById('gold')!;
  assert.deepEqual(outfitFor('p0', true, false, 'gold').fabric, gold.outfit.fabric);
  assert.notDeepEqual(outfitFor('p0', true, false, 'gold').fabric, outfitFor('p0', true, false).fabric);
  const friend = outfitFor('p2', true, true, 'gold'), plain = outfitFor('p2', true, true);
  assert.deepEqual(friend.fabric, plain.fabric, 'the jersey colour stays');
  assert.deepEqual(friend.hat, gold.outfit.hat);
  assert.deepEqual(outfitFor('bot-3', false, false, 'gold'), outfitFor('bot-3', false, false), 'a bot ignores outfits');
  assert.deepEqual(outfitFor('p0', true, false, 'nonsense'), outfitFor('p0', true, false), 'an unknown outfit is ignored');
});

test('the picker shows locked outfits as locked, selects an earned one and remembers it', () => {
  freshDom();
  localStorage.setItem('lastlight.best.v1', JSON.stringify({ wins: 1, kills: 4, survival: 100, killsTotal: 12 }));
  const ui = new GameUI(callbacks());
  const doc = dom.window.document;
  const cards = [...doc.querySelectorAll<HTMLButtonElement>('#skin-grid .skin-card')];
  assert.equal(cards.length, SKINS.length);
  const byId = (id: string) => cards.find(card => card.dataset.skin === id)!;
  assert.ok(byId('default').classList.contains('on'));
  assert.ok(!byId('jungle').classList.contains('locked'), '12 kills opens the jungle outfit');
  assert.ok(!byId('desert').classList.contains('locked'), 'and the desert one at 10');
  assert.ok(!byId('arctic').classList.contains('locked'), 'one win opens the arctic outfit');
  assert.ok(byId('gold').classList.contains('locked'));
  assert.match(byId('gold').textContent!, /1 \/ 10/);
  click(byId('gold'));
  assert.equal(ui.settings.skin, DEFAULT_SKIN, 'a locked outfit cannot be chosen');
  click(byId('desert'));
  assert.equal(ui.settings.skin, 'desert');
  assert.equal(ui.currentSkin(), 'desert');
  assert.ok(doc.querySelector('#skin-grid [data-skin="desert"]')!.classList.contains('on'));
  const again = new GameUI(callbacks());
  assert.equal(again.settings.skin, 'desert', 'it is saved');
  localStorage.setItem('lastlight.settings.v1', JSON.stringify({ skin: 'gold' }));
  assert.equal(new GameUI(callbacks()).currentSkin(), DEFAULT_SKIN, 'a saved choice that is not earned yields the default');
});

test('everybody in an online room learns the outfits the others chose', () => {
  const cfg: RoomConfig = { map: 'arena', botCount: 3, difficulty: 'normal' };
  const net = new LoopbackNetwork({ latency: 30 }, 5);
  const hostT = net.connect('host0000'), guestT = net.connect('guest000');
  const host = new Lobby(hostT, 'Hana', 'host', cfg, () => 0.1);
  const guest = new Lobby(guestT, 'Minh', 'client', cfg);
  host.setSkin('gold'); guest.setSkin('arctic');
  const lobbies = [host, guest];
  for (let i = 0; i < 40; i++) { net.advance(100); lobbies.forEach(l => l.tick(net.now)); }
  assert.deepEqual(host.players.map(p => [p.name, p.skin]), [['Hana', 'gold'], ['Minh', 'arctic']]);
  assert.deepEqual(guest.players.map(p => [p.name, p.skin]), [['Hana', 'gold'], ['Minh', 'arctic']]);
  const setup = host.start(net.now)!;
  assert.deepEqual(setup.players.map(p => p.skin), ['gold', 'arctic']);
  // Junk is not accepted as an outfit name.
  host.setSkin('<script>');
  assert.equal(host.players[0].skin, undefined);
});
