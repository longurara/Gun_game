import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebRTCTransport } from '../src/net/webrtc.ts';
import { rtcConfiguration, loadRtcConfiguration } from '../src/net/config.ts';
import type { NetMessage, Transport, TransportStatus } from '../src/net/transport.ts';

class Signaling implements Transport {
  clientId = 'host'; sent: NetMessage[] = []; closed = false;
  handlers: Array<(m: NetMessage, f: string) => void> = [];
  send(message: NetMessage) { this.sent.push(message); }
  onMessage(fn: (m: NetMessage, f: string) => void) { this.handlers.push(fn); }
  onStatus(_fn: (s: TransportStatus) => void) {}
  close() { this.closed = true; }
  receive(message: NetMessage, from: string) { for (const fn of this.handlers) fn(message, from); }
}
class Channel {
  label = 'lastlight'; readyState = 'connecting'; bufferedAmount = 0; sent: string[] = [];
  onopen: (() => void) | null = null; onclose: (() => void) | null = null;
  onerror: (() => void) | null = null; onmessage: ((event: { data: string }) => void) | null = null;
  open() { this.readyState = 'open'; this.onopen?.(); }
  close() { this.readyState = 'closed'; this.onclose?.(); }
  send(text: string) { this.sent.push(text); }
}
class PeerConnection {
  channel = new Channel(); localDescription: any = null; remoteDescription: any = null;
  connectionState = 'new'; onicecandidate: any = null; ondatachannel: any = null; onconnectionstatechange: any = null;
  candidates: unknown[] = []; closed = false;
  offers: unknown[] = []; report = new Map<string, any>();
  createDataChannel() { return this.channel; }
  async createOffer(options?: unknown) { this.offers.push(options); return { type: 'offer', sdp: 'test-offer' }; }
  async createAnswer() { return { type: 'answer', sdp: 'test-answer' }; }
  async setLocalDescription(description: any) {
    this.localDescription = { ...description, toJSON: () => description };
    this.onicecandidate?.({ candidate: { toJSON: () => ({ candidate: 'local-ice' }) } });
  }
  async setRemoteDescription(description: any) { this.remoteDescription = description; }
  async addIceCandidate(candidate: unknown) { assert.ok(this.remoteDescription, 'candidate waits for remote SDP'); this.candidates.push(candidate); }
  async getStats() { return this.report; }
  close() { this.closed = true; this.connectionState = 'closed'; }
}
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
function host(ids = ['guest']) {
  const signaling = new Signaling(), pcs: PeerConnection[] = [];
  const transport = new WebRTCTransport(signaling, 'host', { peerConnection: () => {
    const pc = new PeerConnection(); pcs.push(pc); return pc as unknown as RTCPeerConnection;
  } });
  transport.send({ k: 'roster', players: ['host', ...ids].map(id => ({ id })) });
  // Tests of data delivery can skip the production join pacer.
  for (let i = 1; i < ids.length; i++) { (transport as any).nextOfferAt = -Infinity; (transport as any).nextOffer(); }
  return { signaling, transport, pcs };
}

test('offer precedes local ICE; remote ICE waits for the answer, wrong recipients/sessions are ignored', async t => {
  const { signaling, transport, pcs } = host(); t.after(() => transport.close());
  await flush();
  const packets = signaling.sent.filter(p => p.k === 'rtc-signal');
  assert.equal((packets[0].description as any).type, 'offer'); assert.ok(packets[1].candidate);
  const session = packets[0].session;
  signaling.receive({ k: 'rtc-signal', to: 'host', session: 'old', candidate: { candidate: 'stale' } }, 'guest');
  signaling.receive({ k: 'rtc-signal', to: 'elsewhere', session, candidate: { candidate: 'wrong-to' } }, 'guest');
  signaling.receive({ k: 'rtc-signal', to: 'host', session, candidate: { candidate: 'unknown' } }, 'stranger');
  signaling.receive({ k: 'rtc-signal', to: 'host', session, candidate: { candidate: 'valid' } }, 'guest');
  await flush(); assert.deepEqual(pcs[0].candidates, []);
  signaling.receive({ k: 'rtc-signal', to: 'host', session, description: { type: 'answer', sdp: 'answer' } }, 'guest');
  await flush(); assert.deepEqual(pcs[0].candidates, [{ candidate: 'valid' }]);
});

test('start waits for every channel; gameplay bypasses signaling and sender identity is bound to its peer', async t => {
  const { signaling, transport, pcs } = host(['a', 'b']); t.after(() => transport.close());
  await flush(); assert.throws(() => transport.send({ k: 'start' }));
  pcs[0].channel.open(); assert.equal(transport.ready, false);
  pcs[1].channel.open(); assert.equal(transport.ready, true);
  const received: Array<[string, string]> = []; transport.onMessage((m, f) => received.push([m.k, f]));
  const count = signaling.sent.length;
  transport.send({ k: 'start', setup: {} }); transport.send({ k: 'snap', s: { seq: 1 } });
  assert.equal(signaling.sent.length, count);
  assert.ok(pcs.every(pc => JSON.parse(pc.channel.sent.at(-1)!).k === 'snap'));
  signaling.receive({ k: 'in' }, 'a');
  pcs[0].channel.onmessage?.({ data: JSON.stringify({ k: 'in', f: 'b' }) });
  assert.deepEqual(received, [['in', 'a']]);
  signaling.receive({ k: 'hello', rtc: 1 }, 'late-guest');
  assert.deepEqual(signaling.sent.at(-1), { k: 'reject', to: 'late-guest', why: 'started' });
});

test('a congested peer is disconnected without queuing unbounded data or ending other guests', async t => {
  const { signaling, transport, pcs } = host(['a', 'b']); t.after(() => transport.close()); await flush();
  pcs.forEach(pc => pc.channel.open()); transport.send({ k: 'start' });
  const received: string[] = []; transport.onMessage((m, f) => { if (m.k === 'bye') received.push(f); });
  pcs[0].channel.bufferedAmount = 1024 * 1024;
  transport.send({ k: 'snap', s: {} });
  assert.deepEqual(received, ['a']); assert.equal(pcs[0].closed, true); assert.equal(pcs[1].closed, false);
  assert.equal(JSON.parse(pcs[1].channel.sent.at(-1)!).k, 'snap');
  transport.close(); assert.equal(signaling.closed, true); assert.equal(pcs[1].closed, true);
});

test('ICE configuration supports STUN/TURN and rejects invalid JSON/servers', () => {
  assert.match((rtcConfiguration(undefined).iceServers![0].urls as string), /^stun:/);
  assert.deepEqual(rtcConfiguration('[]'), { iceServers: [] });
  assert.equal(rtcConfiguration('[{"urls":["turn:example.test:3478"],"username":"u","credential":"p"}]').iceServers![0].username, 'u');
  for (const raw of ['{', '{}', '[null]', '[{"urls":42}]']) assert.throws(() => rtcConfiguration(raw));
});

test('TURN credential endpoint is awaited, requires a relay and hides keys on failure', async () => {
  const servers = [{ urls: 'turns:relay.example:443?transport=tcp', username: 'u', credential: 'p' }];
  let calls = 0;
  const request = (async (_url: unknown, options: RequestInit) => {
    calls++; assert.equal(options.credentials, 'omit'); assert.equal(options.cache, 'no-store');
    assert.ok(options.signal); return new Response(JSON.stringify(servers));
  }) as typeof fetch;
  assert.deepEqual(await loadRtcConfiguration('https://credential.example/?apiKey=private-value', request), { iceServers: servers });
  assert.equal(calls, 1);
  for (const response of [new Response('denied', { status: 401 }), new Response('[]'), new Response('{}'), new Response('invalid')]) {
    await assert.rejects(loadRtcConfiguration('https://credential.example/?apiKey=private-value', (async () => response) as typeof fetch), error => {
      assert.match((error as Error).message, /TURN/); assert.doesNotMatch((error as Error).message, /private-value|credential\.example/); return true;
    });
  }
  await assert.rejects(loadRtcConfiguration('http://credential.example', request)); assert.equal(calls, 1);
});

test('handshake replays SDP and bundled ICE, ignores duplicate/stale answers and stops after opening', async t => {
  let now = 0;
  const signaling = new Signaling(), pc = new PeerConnection();
  const transport = new WebRTCTransport(signaling, 'host', { clock: () => now, peerConnection: () => pc as unknown as RTCPeerConnection });
  t.after(() => transport.close());
  transport.send({ k: 'roster', players: [{ id: 'host' }, { id: 'guest' }] }); await flush();
  const initial = signaling.sent.find(message => message.description)!;
  // Browsers can update m=/c= lines as ICE gathering progresses, not just add candidates.
  pc.localDescription = { type: 'offer', sdp: 'gathered-offer', toJSON: () => ({ type: 'offer', sdp: 'gathered-offer' }) };
  now = 3000; (transport as any).health(); await flush();
  const replay = signaling.sent.at(-1)!;
  assert.equal(replay.session, initial.session); assert.equal(replay.revision, initial.revision);
  assert.deepEqual(replay.description, initial.description, 'replayed SDP is frozen for this negotiation');
  assert.deepEqual(replay.candidates, [{ candidate: 'local-ice' }]);
  let accepted = 0;
  const original = pc.setRemoteDescription.bind(pc);
  pc.setRemoteDescription = async description => {
    if (accepted > 0) throw new DOMException('answer cannot be applied in stable', 'InvalidStateError');
    accepted++; await original(description);
  };
  const answer = { k: 'rtc-signal', to: 'host', session: initial.session, revision: initial.revision,
    description: { type: 'answer', sdp: 'answer' }, candidates: [{ candidate: 'guest-ice' }] };
  signaling.receive(answer, 'guest'); signaling.receive(answer, 'guest'); await flush();
  signaling.receive({ ...answer, description: { type: 'answer', sdp: 'gathered-answer-with-different-connection-lines' } }, 'guest'); await flush();
  assert.equal(accepted, 1); assert.ok(pc.candidates.some((c: any) => c.candidate === 'guest-ice'));
  assert.equal(transport.netStats()[0].state, 'connecting', 'changed duplicate answer must not close the connection');
  signaling.receive({ ...answer, revision: 0, description: { type: 'answer', sdp: 'stale-answer' } }, 'guest'); await flush();
  assert.equal(accepted, 1);
  pc.channel.open(); const descriptions = signaling.sent.filter(message => message.description).length;
  now = 6000; (transport as any).health(); await flush();
  assert.equal(signaling.sent.filter(message => message.description).length, descriptions);
});

test('timeout distinguishes missing signaling from an ICE path blocked without TURN', async t => {
  let now = 0;
  const signaling = new Signaling(), pc = new PeerConnection();
  const transport = new WebRTCTransport(signaling, 'host', { clock: () => now, handshakeTimeoutMs: 2000,
    peerConnection: () => pc as unknown as RTCPeerConnection });
  t.after(() => transport.close());
  transport.send({ k: 'roster', players: [{ id: 'host' }, { id: 'guest' }] }); await flush();
  assert.match((transport as any).handshakeError((transport as any).peers.get('guest')), /phản hồi handshake/);
  pc.remoteDescription = { type: 'answer', sdp: 'test' };
  now = 3000; (transport as any).health();
  assert.equal(transport.netStats()[0].state, 'failed'); assert.match(transport.netStats()[0].error!, /Chưa cấu hình TURN/);
});

test('large Unicode snapshots are chunked below SCTP limits and reassembled exactly once', async t => {
  const { transport, pcs } = host(); t.after(() => transport.close()); await flush(); pcs[0].channel.open();
  const packet = { k: 'snap', s: 'đồng bộ 🪂'.repeat(8000) };
  transport.send(packet);
  assert.ok(pcs[0].channel.sent.length > 1);
  assert.ok(pcs[0].channel.sent.every(text => Buffer.byteLength(text) < 65536));
  const received: NetMessage[] = []; transport.onMessage(message => received.push(message));
  for (const text of pcs[0].channel.sent) pcs[0].channel.onmessage?.({ data: text });
  assert.deepEqual(received, [packet]);
  // Out-of-order/incomplete fragments must never escape to the simulation.
  pcs[0].channel.onmessage?.({ data: JSON.stringify({ k: 'rtc-chunk', id: 99, index: 1, total: 2, part: 'bad' }) });
  assert.equal(received.length, 1);
});

test('selected candidate stats distinguish relay from direct and brief disconnection triggers host ICE restart', async t => {
  let now = 0;
  const signaling = new Signaling(), pc = new PeerConnection();
  pc.report = new Map([
    ['transport', { type: 'transport', selectedCandidatePairId: 'pair' }],
    ['pair', { id: 'pair', type: 'candidate-pair', localCandidateId: 'local', remoteCandidateId: 'remote' }],
    ['local', { candidateType: 'host' }], ['remote', { candidateType: 'relay' }],
  ]);
  const transport = new WebRTCTransport(signaling, 'host', { clock: () => now, peerConnection: () => pc as unknown as RTCPeerConnection });
  t.after(() => transport.close());
  transport.send({ k: 'roster', players: [{ id: 'host' }, { id: 'guest' }] }); await flush();
  pc.channel.open(); await flush(); assert.equal(transport.netStats()[0].route, 'relay');
  pc.connectionState = 'disconnected'; pc.onconnectionstatechange(); now = 3000;
  (transport as any).health(); await flush();
  assert.deepEqual(pc.offers.at(-1), { iceRestart: true });
  assert.equal(pc.closed, false);
  pc.connectionState = 'connected'; pc.onconnectionstatechange();
  pc.report.get('remote').candidateType = 'host';
  pc.channel.onmessage?.({ data: JSON.stringify({ k: 'rtc-pong', seq: JSON.parse(pc.channel.sent.at(-1)!).seq }) });
  now = 4000; (transport as any).health(); await flush();
  assert.equal(transport.netStats()[0].route, 'direct');
});
