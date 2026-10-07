import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { LobbyView } from '../src/lobby-ui.ts';

test('joining by button or Enter forwards the selected route before joining a room', () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://game.example' });
  Object.assign(globalThis, { document: dom.window.document, localStorage: dom.window.localStorage });
  const joins: unknown[][] = [];
  const view = new LobbyView(dom.window.document.getElementById('root')!, {
    onCreate() {}, onJoin: (...args) => joins.push(args), onStart() {}, onLeave() {}, onClose() {},
  });
  view.show(true); view.prefillCode('ABCDE');
  const mode = dom.window.document.getElementById('mp-mode') as HTMLSelectElement;
  const name = dom.window.document.getElementById('mp-name') as HTMLInputElement; name.value = 'Bạn';
  const button = dom.window.document.getElementById('mp-join')!;
  button.click(); assert.deepEqual(joins, [['ABCDE', 'Bạn', 'p2p']]);
  mode.value = 'turn'; mode.dispatchEvent(new dom.window.Event('change'));
  assert.match(dom.window.document.getElementById('mp-mode-hint')!.textContent!, /Tiêu thụ/);
  dom.window.document.getElementById('mp-code')!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter' }));
  assert.deepEqual(joins[1], ['ABCDE', 'Bạn', 'turn']);
  view.prefillCode('FGHJK'); assert.equal(joins.length, 2, 'links and friend invitations wait for the player to choose a route');
  dom.window.close();
});
