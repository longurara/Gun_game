import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebRTCTransport } from '../src/net/webrtc.ts';
import { rtcConfiguration, loadRtcConfiguration } from '../src/net/config.ts';
import type { NetMessage, Transport, TransportStatus } from '../src/net/transport.ts';
import { fragment, WireDecoder, WireEncoder, WIRE_VERSION } from '../src/net/wire.ts';
import { reconnectProof } from '../src/net/reconnect-auth.ts';
import { connectionConfiguration } from '../src/net/connection-mode.ts';

const read = (bytes: ArrayBuffer) => new WireDecoder().decode(new Uint8Array(bytes));
const write = (message: NetMessage) => new WireEncoder().encode(message).buffer as ArrayBuffer;

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
  label = 'lastlight'; readyState = 'connecting'; bufferedAmount = 0; sent: ArrayBuffer[] = [];
  onopen: (() => void) | null = null; onclose: (() => void) | null = null;
  onerror: (() => void) | null = null; onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;
  open() { this.readyState = 'open'; this.onopen?.(); }
  close() { this.readyState = 'closed'; this.onclose?.(); }
  send(bytes: ArrayBuffer) { this.sent.push(bytes); }
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
async function until(predicate: () => boolean): Promise<void> {
  const deadline = performance.now() + 2000;
  while (!predicate() && performance.now() < deadline) await flush();
  assert.ok(predicate(), 'asynchronous crypto verification completed');
}
function host(ids = ['guest'], clock?: () => number) {
  const signaling = new Signaling(), pcs: PeerConnection[] = [];
  const transport = new WebRTCTransport(signaling, 'host', { clock, peerConnection: () => {
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

test('closed match channels rebuild with a private reconnect ticket and preserve the 30-second deadline across attempts', async t => {
  let now = 1000;
  const { signaling, transport, pcs } = host(['guest'], () => now); t.after(() => transport.close());
  const changes: string[] = []; transport.onPeerState((id, state) => changes.push(`${id}:${state}`));
  await flush(); pcs[0].channel.open();
  const ticket = read(pcs[0].channel.sent.at(-1)!).token;
  assert.equal(typeof ticket, 'string');
  assert.ok(signaling.sent.every(packet => !packet.token), 'private ticket is shared through P2P only');
  const originalOffer = signaling.sent.find(packet => (packet.description as any)?.type === 'offer')!;
  transport.send({ k: 'start' });
  const proof = await reconnectProof(ticket as string, 'guest', 'host', 1);
  signaling.receive({ k: 'rtc-reconnect', to: 'host', attempt: 1, proof }, 'guest'); await flush();
  await until(() => (transport as any).acceptedAttempts.get('guest') === 1);
  assert.equal(transport.netStats()[0].state, 'open', 'old requests cannot interrupt a healthy channel');
  pcs[0].channel.close();
  assert.equal(transport.netStats()[0].state, 'reconnecting');
  signaling.receive({ k: 'rtc-reconnect', to: 'host', attempt: 2, proof: 'wrong' }, 'guest'); await flush();
  assert.equal(pcs.length, 1);
  const request = { k: 'rtc-reconnect', to: 'host', attempt: 2, proof: await reconnectProof(ticket as string, 'guest', 'host', 2) };
  signaling.receive(request, 'guest'); await flush();
  await until(() => pcs.length === 2); await flush();
  assert.equal(pcs.length, 2);
  const replacement = signaling.sent.filter(packet => (packet.description as any)?.type === 'offer').at(-1)!;
  assert.equal(replacement.generation, 1); assert.notEqual(replacement.session, originalOffer.session);
  signaling.receive(request, 'guest'); await flush(); assert.equal(pcs.length, 2, 'replayed proof does not trigger another attempt');
  signaling.receive({ k: 'rtc-signal', to: 'host', session: originalOffer.session, description: { type: 'answer', sdp: 'old' } }, 'guest');
  await flush(); assert.equal(pcs[1].remoteDescription, null);
  now += 29_000; (transport as any).health(); await flush();
  assert.equal(transport.netStats()[0].state, 'reconnecting');
  now += 1001; (transport as any).health(); await flush();
  assert.equal(transport.netStats()[0].state, 'failed');
  assert.deepEqual(changes, ['guest:open', 'guest:reconnecting', 'guest:failed']);
  const count = pcs.length;
  signaling.receive(request, 'guest'); await flush(); assert.equal(pcs.length, count);
});

test('a brief match disconnection recovers on the existing channel; a stale offer cannot replace a newer client peer', async t => {
  let now = 1000;
  const h = host(['guest'], () => now); t.after(() => h.transport.close()); await flush(); h.pcs[0].channel.open();
  h.transport.send({ k: 'start' });
  h.pcs[0].connectionState = 'disconnected'; h.pcs[0].onconnectionstatechange();
  assert.equal(h.transport.ready, false);
  h.pcs[0].connectionState = 'connected'; h.pcs[0].onconnectionstatechange();
  h.pcs[0].channel.onmessage?.({ data: write({ k: 'in', seq: 2 }) });
  assert.equal(h.transport.ready, true); now += 1000; (h.transport as any).health(); assert.equal(h.pcs.length, 1);
  const signals = new Signaling(); signals.clientId = 'guest'; const pcs: PeerConnection[] = [];
  const client = new WebRTCTransport(signals, 'client', { clock: () => now, peerConnection: () => { const pc = new PeerConnection(); pcs.push(pc); return pc as any; } });
  t.after(() => client.close());
  signals.receive({ k: 'roster', rtc: WIRE_VERSION, players: [{ id: 'host' }, { id: 'guest' }] }, 'host');
  const offer = (session: string, generation: number) => ({ k: 'rtc-signal', to: 'guest', session, generation, revision: 1, description: { type: 'offer', sdp: session } });
  signals.receive(offer('first', 0), 'host'); await flush();
  signals.receive(offer('new', 1), 'host'); await flush();
  signals.receive(offer('first', 0), 'host'); await flush();
  assert.equal(pcs.length, 2); assert.equal(pcs[0].closed, true); assert.equal(pcs[1].remoteDescription.sdp, 'new');
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
  assert.ok(pcs.every(pc => read(pc.channel.sent.at(-1)!).k === 'snap'));
  signaling.receive({ k: 'in' }, 'a');
  pcs[0].channel.onmessage?.({ data: write({ k: 'in', f: 'b' }) });
  assert.deepEqual(received, [['in', 'a']]);
  signaling.receive({ k: 'hello', rtc: 1 }, 'late-guest');
  assert.deepEqual(signaling.sent.at(-1), { k: 'reject', to: 'late-guest', why: 'started' });
});

test('binary snapshot baselines are per peer and resync requests force a new full frame', async t => {
  const { transport, pcs } = host(['a', 'b']); t.after(() => transport.close()); await flush(); pcs.forEach(pc => pc.channel.open());
  const decoders = pcs.map(() => new WireDecoder()), received: NetMessage[] = []; transport.onMessage(message => received.push(message));
  const make = (seq: number) => ({ k: 'snap', s: { seq, a: [[0, seq, 0, 1]], inventory: Array(200).fill('same') } });
  transport.send(make(1)); pcs.forEach((pc, i) => assert.deepEqual(decoders[i].decode(new Uint8Array(pc.channel.sent.at(-1)!)), make(1)));
  transport.send(make(2)); pcs.forEach((pc, i) => {
    const bytes = new Uint8Array(pc.channel.sent.at(-1)!); assert.equal(bytes[3], 2); assert.deepEqual(decoders[i].decode(bytes), make(2));
  });
  pcs[0].channel.onmessage?.({ data: write({ k: 'rtc-resync' }) });
  transport.send(make(3));
  assert.equal(new Uint8Array(pcs[0].channel.sent.at(-1)!)[3], 1);
  assert.equal(new Uint8Array(pcs[1].channel.sent.at(-1)!)[3], 2);
  pcs.forEach((pc, i) => assert.deepEqual(decoders[i].decode(new Uint8Array(pc.channel.sent.at(-1)!)), make(3)));
  assert.deepEqual(received, [], 'codec control messages do not reach game logic');
});

test('mixed wire versions fail in the lobby with a reload message instead of a broken match', async t => {
  const { signaling, transport } = host(); t.after(() => transport.close()); await flush();
  signaling.receive({ k: 'hello', rtc: 1 }, 'old-guest');
  assert.deepEqual(signaling.sent.at(-1), { k: 'reject', to: 'old-guest', why: 'webrtc' });
  assert.equal(signaling.sent.find(m => m.k === 'roster')!.rtc, WIRE_VERSION);
  const clientSignals = new Signaling(); clientSignals.clientId = 'guest';
  const client = new WebRTCTransport(clientSignals, 'client', { peerConnection: () => new PeerConnection() as unknown as RTCPeerConnection }); t.after(() => client.close());
  const errors: string[] = []; client.onStatus((status, detail) => { if (status === 'error') errors.push(detail!); });
  clientSignals.receive({ k: 'roster', rtc: 1, players: [{ id: 'host' }, { id: 'guest' }] }, 'host');
  assert.match(errors[0], /tải lại game/); assert.equal(client.ready, false);
});

test('a receiver missing a baseline requests resync over the DataChannel, never signaling', async t => {
  const { transport, pcs, signaling } = host(); t.after(() => transport.close()); await flush(); pcs[0].channel.open();
  const remote = new WireEncoder(), received: NetMessage[] = []; transport.onMessage(message => received.push(message));
  const make = (seq: number) => ({ k: 'snap', s: { seq, inventory: Array(100).fill('same') } });
  const first = remote.encode(make(1)); // Lost before reaching this receiver.
  assert.equal(first[3], 1);
  const signals = signaling.sent.length;
  pcs[0].channel.onmessage?.({ data: remote.encode(make(2)).buffer as ArrayBuffer });
  assert.equal(read(pcs[0].channel.sent.at(-1)!).k, 'rtc-resync');
  assert.equal(signaling.sent.length, signals); assert.deepEqual(received, []);
  remote.reset(); pcs[0].channel.onmessage?.({ data: remote.encode(make(3)).buffer as ArrayBuffer });
  assert.deepEqual(received, [make(3)]);
});

test('a congested peer is disconnected without queuing unbounded data or ending other guests', async t => {
  const { signaling, transport, pcs } = host(['a', 'b']); t.after(() => transport.close()); await flush();
  pcs.forEach(pc => pc.channel.open()); transport.send({ k: 'start' });
  const received: string[] = []; transport.onPeerState((id, state) => { if (state === 'reconnecting') received.push(id); });
  pcs[0].channel.bufferedAmount = 1024 * 1024;
  transport.send({ k: 'snap', s: {} });
  assert.deepEqual(received, ['a']); assert.equal(pcs[0].closed, true); assert.equal(pcs[1].closed, false);
  assert.equal(read(pcs[1].channel.sent.at(-1)!).k, 'snap');
  transport.close(); assert.equal(signaling.closed, true); assert.equal(pcs[1].closed, true);
});

test('snapshot flow control slows only the congested guest, leaves critical traffic reliable and preserves baselines', async t => {
  let now = 1000;
  const { transport, pcs } = host(['a', 'b'], () => now); t.after(() => transport.close()); await flush();
  pcs.forEach(pc => pc.channel.open()); transport.send({ k: 'start' });
  const decoder = new WireDecoder(), make = (seq: number) => ({ k: 'snap', to: 'a', s: { seq, unchanged: Array(100).fill('same') } });
  transport.send(make(1)); decoder.decode(new Uint8Array(pcs[0].channel.sent.at(-1)!));
  pcs[0].channel.bufferedAmount = 9000;
  assert.equal(transport.snapshotReady('a'), false); assert.equal(transport.snapshotReady('b'), true);
  now += 200; assert.equal(transport.snapshotReady('a'), true);
  pcs[0].channel.bufferedAmount = 16384; assert.equal(transport.snapshotReady('a'), false);
  transport.send({ k: 'chat', to: 'a', text: 'reliable' }); assert.equal(read(pcs[0].channel.sent.at(-1)!).k, 'chat');
  assert.equal(transport.netStats()[0].state, 'open');
  pcs[0].channel.bufferedAmount = 0; assert.equal(transport.snapshotReady('a'), true);
  transport.send(make(2)); assert.deepEqual(decoder.decode(new Uint8Array(pcs[0].channel.sent.at(-1)!)), make(2));
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

test('explicit direct joins skip the TURN service, mixed ICE entries lose relay credentials, and TURN forces relay', async () => {
  const configuration: RTCConfiguration = { iceServers: [{ urls: ['stun:stun.example:3478', 'turn:relay.example:3478'], username: 'u', credential: 'secret' }] };
  assert.deepEqual(connectionConfiguration(configuration, 'p2p'), { iceTransportPolicy: 'all', iceServers: [{ urls: ['stun:stun.example:3478'] }] });
  assert.equal(connectionConfiguration(configuration, 'turn').iceTransportPolicy, 'relay');
  assert.equal(configuration.iceTransportPolicy, undefined, 'source configuration stays intact for other guests');
  assert.throws(() => connectionConfiguration({ iceServers: [] }, 'turn'), /TURN/);
  const direct = await loadRtcConfiguration('https://unavailable.example', (async () => { throw new Error('must not request TURN'); }) as typeof fetch, 'p2p');
  assert.equal(direct.iceTransportPolicy, 'all');
  assert.ok(direct.iceServers?.every(server => (Array.isArray(server.urls) ? server.urls : [server.urls]).every(url => /^stun:/.test(url))));
  const relay = await loadRtcConfiguration('https://relay.example', (async () => new Response(JSON.stringify(configuration.iceServers))) as typeof fetch, 'turn');
  assert.equal(relay.iceTransportPolicy, 'relay');
});

test('host honors a different route for each guest and preserves it during reconnect', async t => {
  let now = 0;
  const signaling = new Signaling(), configurations: RTCConfiguration[] = [], pcs: PeerConnection[] = [];
  const transport = new WebRTCTransport(signaling, 'host', {
    clock: () => now, configuration: { iceServers: [{ urls: 'stun:stun.example:3478' }, { urls: 'turn:relay.example:3478', username: 'u', credential: 'p' }] },
    peerConnection: configuration => { configurations.push(configuration); const pc = new PeerConnection(); pcs.push(pc); return pc as unknown as RTCPeerConnection; },
  });
  t.after(() => transport.close());
  signaling.receive({ k: 'hello', rtc: WIRE_VERSION, connectionMode: 'p2p' }, 'direct');
  signaling.receive({ k: 'hello', rtc: WIRE_VERSION, connectionMode: 'turn' }, 'relay');
  transport.send({ k: 'roster', players: ['host', 'direct', 'relay'].map(id => ({ id })) });
  now = 1000; (transport as any).nextOffer(); await flush();
  assert.equal(configurations[0].iceTransportPolicy, 'all');
  assert.ok(configurations[0].iceServers?.every(server => !JSON.stringify(server.urls).includes('turn:')));
  assert.equal(configurations[1].iceTransportPolicy, 'relay');
  pcs.forEach(pc => pc.channel.open()); transport.send({ k: 'start' });
  pcs[0].channel.close(); pcs[1].channel.close();
  now = 10000; transport.reconnectPeer('direct'); transport.reconnectPeer('relay'); await flush();
  assert.equal(configurations[2].iceTransportPolicy, 'all'); assert.equal(configurations[3].iceTransportPolicy, 'relay');
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
  assert.ok(pcs[0].channel.sent.every(bytes => bytes.byteLength < 65536));
  const received: NetMessage[] = []; transport.onMessage(message => received.push(message));
  for (const text of pcs[0].channel.sent) pcs[0].channel.onmessage?.({ data: text });
  assert.deepEqual(received, [packet]);
  // Out-of-order/incomplete fragments must never escape to the simulation.
  const incomplete = fragment(new WireEncoder().encode(packet), 99, 8192)[1];
  pcs[0].channel.onmessage?.({ data: incomplete.buffer as ArrayBuffer });
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
  pc.channel.onmessage?.({ data: write({ k: 'rtc-pong', seq: read(pc.channel.sent.at(-1)!).seq }) });
  now = 4000; (transport as any).health(); await flush();
  assert.equal(transport.netStats()[0].route, 'direct');
});
