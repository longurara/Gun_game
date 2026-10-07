import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChatSession, chatText, CHAT_HISTORY } from '../src/net/chat.ts';
import { LoopbackNetwork } from '../src/net/transport.ts';
import type { MatchSetup } from '../src/net/session.ts';

const setup: MatchSetup = { seed: 1, map: 'arena', botCount: 1, difficulty: 'normal', drop: false,
  players: [{ clientId: 'host', name: 'Chủ phòng' }, { clientId: 'a', name: 'Minh' }, { clientId: 'b', name: 'Lan' }] };
function room() {
  const net = new LoopbackNetwork(), transports = ['host', 'a', 'b'].map(id => net.connect(id));
  const sessions = transports.map((transport, i) => new ChatSession(transport, setup, i ? 'client' : 'host', 'host', () => net.now));
  return { net, transports, sessions, deliver: () => { net.advance(1); net.advance(1); } };
}
test('P2P room chat authenticates sender names, forwards Unicode to all guests and ignores forged client chat', () => {
  const r = room();
  assert.equal(r.sessions[1].send('  Xin chào đồng đội 👋  '), true); r.deliver();
  assert.ok(r.sessions.every(s => s.history[0].name === 'Minh' && s.history[0].text === 'Xin chào đồng đội 👋'));
  r.transports[1].send({ k: 'chat', row: { id: 900, name: 'Host', from: 'host', text: 'forged' } });
  r.transports[1].send({ k: 'chat-send', text: 'Tới từ Minh', from: 'host', name: 'Host' }); r.deliver();
  assert.ok(r.sessions.every(s => s.history.length === 2 && s.history[1].name === 'Minh'));
  r.net.connect('stranger').send({ k: 'chat-send', text: 'not a member' }); r.deliver();
  assert.ok(r.sessions.every(s => s.history.length === 2));
  assert.equal(chatText('x'.repeat(241)), ''); assert.equal(chatText('\u0000\n\t'), '');
  assert.equal(chatText('👋'.repeat(240)), '👋'.repeat(240));
});
test('host and clients limit bursts and bound history; reconnect replay recovers missed messages without duplicates', () => {
  const r = room();
  for (let i = 0; i < 10; i++) r.transports[1].send({ k: 'chat-send', text: `burst${i}` });
  r.deliver(); assert.equal(r.sessions[0].history.length, 3);
  r.net.advance(1000); r.transports[1].send({ k: 'chat-send', text: 'refill' }); r.deliver();
  assert.equal(r.sessions[0].history.length, 4);
  assert.equal(r.sessions[0].send('host'), true); r.deliver();
  // Rebuild the observer to simulate missing the earlier chat while disconnected.
  const recovered = new ChatSession(r.transports[2], setup, 'client', 'host', () => r.net.now);
  r.transports[0].send({ k: 'resume-state', to: 'b' }); r.deliver(); r.deliver();
  assert.deepEqual(recovered.history, r.sessions[0].history);
  r.net.advance(2100); r.transports[2].send({ k: 'chat-history' }); r.deliver();
  assert.equal(recovered.history.length, 5);
  for (let i = 0; i < CHAT_HISTORY + 10; i++) { r.net.advance(1000); r.sessions[0].send(`line${i}`); r.deliver(); }
  assert.ok(r.sessions.every(s => s.history.length === CHAT_HISTORY));
});
