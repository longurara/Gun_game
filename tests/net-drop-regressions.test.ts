import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameSimulation } from '../src/game/simulation.ts';
import { applySnapshot, PROTOCOL_VERSION, SnapshotBuilder } from '../src/net/protocol.ts';
import { ClientSession, HostSession, matchOptions } from '../src/net/session.ts';
import type { MatchSetup } from '../src/net/session.ts';
import { LoopbackNetwork } from '../src/net/transport.ts';
import type { NetMessage } from '../src/net/transport.ts';
import type { PlayerInput } from '../src/types.ts';

const idle: PlayerInput = { moveX: 0, moveZ: 0, sprint: false, jump: false };
const setup: MatchSetup = {
  seed: 77, map: 'valley', botCount: 1, difficulty: 'normal', drop: true,
  players: [{ clientId: 'host', name: 'Host' }, { clientId: 'client', name: 'Client' }],
};

function match(options: { latency?: number; jitter?: number } = {}) {
  const network = new LoopbackNetwork(options, 7);
  const hostTransport = network.connect('host'), clientTransport = network.connect('client');
  const host = new GameSimulation(matchOptions(setup, 'host', false));
  const mirror = new GameSimulation(matchOptions(setup, 'client', true));
  host.start(); mirror.start(); host.botsFrozen = true;
  const hostSession = new HostSession(host, hostTransport, setup, 8000, () => network.now);
  const clientSession = new ClientSession(mirror, clientTransport, 'host', () => network.now);
  let input = { ...idle };
  const frame = () => {
    network.advance(1000 / 30);
    host.update(1 / 30, idle); hostSession.drainEvents(); hostSession.tick(1 / 30);
    mirror.update(1 / 30, input); clientSession.tick(network.now, input, mirror.player.yaw); clientSession.frame(network.now);
  };
  const run = (seconds: number) => { for (let i = 0; i < Math.ceil(seconds * 30); i++) frame(); };
  const tap = () => { input = { ...idle, jump: true }; frame(); input = { ...idle }; };
  return { network, hostTransport, clientTransport, host, mirror, hostSession, clientSession, frame, run, tap };
}

function loseFirstJumpPackets(m: ReturnType<typeof match>, ids: number[]) {
  const lost = new Set<number>();
  const sends: NetMessage[] = [];
  const send = m.clientTransport.send.bind(m.clientTransport);
  m.clientTransport.send = packet => {
    sends.push(JSON.parse(JSON.stringify(packet)));
    if (packet.k === 'in' && packet.edge === 1 && ids.includes(packet.jumpId as number) && !lost.has(packet.jumpId as number)) {
      lost.add(packet.jumpId as number); return;
    }
    send(packet);
  };
  return { lost, sends };
}

test('a lost quick plane-jump tap is recovered without a second press or a premature canopy', () => {
  const m = match({ latency: 80 });
  const { lost, sends } = loseFirstJumpPackets(m, [1]);
  m.run(3); m.tap();
  assert.equal(m.mirror.player.air?.mode, 'freefall', 'the local press predicts the jump immediately');
  m.run(2);
  assert.deepEqual([...lost], [1], 'the first packet carrying the tap was lost');
  assert.ok(sends.filter(packet => packet.jumpId === 1).length > 3, 'later packets continue to carry the latest press');
  assert.equal(m.host.actorById('p1')!.air?.mode, 'freefall', 'the host recovered the tap');
  assert.equal(m.mirror.player.air?.mode, 'freefall', 'duplicate press ids cannot open the canopy');
  assert.ok(m.mirror.player.position.y < 260, 'the client keeps falling instead of hanging beside the plane');
  assert.ok(Math.abs(m.mirror.player.position.y - m.host.actorById('p1')!.position.y) < 25, 'client and host descent agree');
});

test('a lost canopy tap is recovered and repeated plane/canopy press ids are applied once', () => {
  const m = match({ latency: 100, jitter: 90 });
  const { lost } = loseFirstJumpPackets(m, [1, 2]);
  m.run(3); m.tap(); m.run(2);
  assert.equal(m.host.actorById('p1')!.air?.mode, 'freefall', 'resending the first press does not open the canopy');
  m.tap();
  assert.equal(m.mirror.player.air?.mode, 'chute', 'the second local press opens the canopy immediately');
  m.run(2);
  assert.deepEqual([...lost], [1, 2]);
  assert.equal(m.host.actorById('p1')!.air?.mode, 'chute', 'the second tap reaches the host despite its first packet being lost');
  assert.equal(m.mirror.player.air?.mode, 'chute');
  assert.ok(Math.abs(m.mirror.player.position.y - m.host.actorById('p1')!.position.y) < 10);
});

test('pre-jump and pre-canopy private payloads preserve the predicted velocity, time and live inventory', () => {
  const m = match();
  m.host.update(3); for (let i = 0; i < 3; i++) m.mirror.update(1);
  const builder = new SnapshotBuilder(m.host);
  const truth = m.host.actorById('p1')!;
  truth.health = 73; truth.medkits = 3;
  m.mirror.player.air = { mode: 'freefall', vx: 11, vy: -23, vz: 7, time: 0.8 };
  const fall = { ...m.mirror.player.air };
  const first = applySnapshot(m.mirror, builder.build([]), { keepFlight: true });
  assert.equal(first.flightRegress, true);
  assert.deepEqual(m.mirror.player.air, fall, 'a plane payload cannot zero a falling player');
  assert.equal(m.mirror.player.health, 73); assert.equal(m.mirror.player.medkits, 3, 'other authority still applies');
  truth.air = { mode: 'freefall', vx: 8, vy: -45, vz: 6, time: 2 };
  m.mirror.player.air = { mode: 'chute', vx: 4, vy: -9, vz: 5, time: 2.2 };
  const canopy = { ...m.mirror.player.air };
  const second = applySnapshot(m.mirror, builder.build([]), { keepFlight: true });
  assert.equal(second.flightRegress, true);
  assert.deepEqual(m.mirror.player.air, canopy, 'a free-fall payload cannot replace canopy speed');
  truth.air = { mode: 'chute', vx: 1, vy: -6.5, vz: 2, time: 3 };
  applySnapshot(m.mirror, builder.build([]), { keepFlight: true });
  assert.deepEqual(m.mirror.player.air, truth.air, 'matching authority resumes normally');
});

test('a pre-jump plane snapshot cannot pull a predicted falling client back to plane altitude', () => {
  const m = match();
  m.host.update(3); for (let i = 0; i < 3; i++) m.mirror.update(1);
  m.mirror.update(1 / 30, { ...idle, jump: true });
  m.mirror.update(0.5, idle);
  const before = { position: { ...m.mirror.player.position }, air: { ...m.mirror.player.air! } };
  const snapshot = new SnapshotBuilder(m.host).build([]);
  m.clientTransport.receive({ k: 'snap', s: snapshot }, 'host');
  assert.deepEqual(m.mirror.player.position, before.position, 'position correction is deferred with the older flight stage');
  assert.deepEqual(m.mirror.player.air, before.air);
});

test('older, duplicate and unsupported snapshots cannot rewind flight, health, inventory, timers or repeat events', () => {
  const m = match();
  m.host.update(3); for (let i = 0; i < 3; i++) m.mirror.update(1);
  const builder = new SnapshotBuilder(m.host);
  const old = builder.build([{ type: 'message', text: 'old' }]);
  const truth = m.host.actorById('p1')!;
  truth.air = { mode: 'freefall', vx: 2, vy: -20, vz: 3, time: 1 };
  truth.position.y = 280; truth.health = 80; truth.medkits = 4; m.host.state.elapsed = 4;
  const fresh = builder.build([{ type: 'message', text: 'fresh' }]);
  m.clientTransport.receive({ k: 'snap', s: fresh, echo: { client: 1 } }, 'host');
  const accepted = { air: { ...m.mirror.player.air! }, position: { ...m.mirror.player.position }, health: m.mirror.player.health, medkits: m.mirror.player.medkits, elapsed: m.mirror.state.elapsed };
  const rtt = m.clientSession.rttMs;
  assert.deepEqual(m.clientSession.drainEvents(), fresh.ev);
  m.network.advance(100);
  m.clientTransport.receive({ k: 'snap', s: old, echo: { client: 99 } }, 'host');
  m.clientTransport.receive({ k: 'snap', s: fresh, echo: { client: 99 } }, 'host');
  const unsupported = { ...builder.build([{ type: 'message', text: 'unsupported' }]), v: PROTOCOL_VERSION + 1 };
  m.clientTransport.receive({ k: 'snap', s: unsupported, echo: { client: 99 } }, 'host');
  assert.deepEqual({ air: m.mirror.player.air, position: m.mirror.player.position, health: m.mirror.player.health, medkits: m.mirror.player.medkits, elapsed: m.mirror.state.elapsed }, accepted);
  assert.deepEqual(m.clientSession.drainEvents(), []);
  assert.equal(m.clientSession.rttMs, rtt, 'discarded messages do not perturb RTT');
  assert.equal(m.clientSession.silence, 0.1, 'discarded messages do not renew the host heartbeat');
  m.clientTransport.receive({ k: 'snap', s: { ...unsupported, v: PROTOCOL_VERSION } }, 'host');
  assert.deepEqual(m.clientSession.drainEvents(), unsupported.ev, 'unsupported sequence was not consumed');
});

test('invalid numbered jump ids are rejected while legacy jump-edge packets still work', () => {
  const m = match();
  m.host.update(3);
  for (const [index, jumpId] of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '1', null].entries()) {
    m.hostTransport.receive({ k: 'in', seq: index + 1, jumpId, edge: 1, ju: 0 }, 'client');
    m.host.update(1 / 30);
    assert.equal(m.host.actorById('p1')!.air?.mode, 'plane');
  }
  m.hostTransport.receive({ k: 'in', seq: 20, edge: 1, ju: 0 }, 'client');
  m.host.update(1 / 30);
  assert.equal(m.host.actorById('p1')!.air?.mode, 'freefall', 'older clients retain the edge boolean path');
});

test('an unconfirmed predicted flight still yields to bounded host authority', () => {
  const m = match();
  m.host.update(3); for (let i = 0; i < 3; i++) m.mirror.update(1);
  m.mirror.player.air = { mode: 'freefall', vx: 0, vy: -20, vz: 0, time: 1 };
  const builder = new SnapshotBuilder(m.host);
  for (let i = 0; i < 13; i++) m.clientTransport.receive({ k: 'snap', s: builder.build([]) }, 'host');
  assert.equal(m.mirror.player.air?.mode, 'plane', 'prediction protection expires when the host keeps rejecting the jump');
});

test('with delayed jittered snapshots and a lost jump tap the client completes free fall, canopy and landing', () => {
  const m = match({ latency: 140, jitter: 180 });
  loseFirstJumpPackets(m, [1]);
  m.run(3); m.tap();
  const seen = new Set<string>();
  for (let i = 0; i < 60 * 30 && (m.mirror.player.air || m.host.actorById('p1')!.air); i++) {
    m.frame(); seen.add(m.mirror.player.air?.mode ?? 'landed');
  }
  assert.ok(seen.has('freefall') && seen.has('chute'), 'the client rendered both descent stages');
  assert.equal(m.host.actorById('p1')!.air, null); assert.equal(m.mirror.player.air, null);
  m.run(1);
  assert.ok(m.mirror.player.alive && m.host.actorById('p1')!.alive);
  assert.ok(Math.hypot(m.mirror.player.position.x - m.host.actorById('p1')!.position.x, m.mirror.player.position.z - m.host.actorById('p1')!.position.z) < 5, 'the landing converges to host authority');
});
