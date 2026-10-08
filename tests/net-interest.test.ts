import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameSimulation } from '../src/game/simulation.ts';
import { applySnapshot, SnapshotBuilder } from '../src/net/protocol.ts';
import { HostSession, ClientSession, matchOptions } from '../src/net/session.ts';
import type { MatchSetup } from '../src/net/session.ts';
import type { NetMessage, Transport } from '../src/net/transport.ts';
import { WireEncoder, WireDecoder } from '../src/net/wire.ts';
import { SUPPLIES } from '../src/game/supplies.ts';

const idle = { moveX: 0, moveZ: 0, sprint: false, jump: false };
const setup: MatchSetup = { seed: 9123, map: 'island', botCount: 4, difficulty: 'normal', drop: false, players: [{ clientId: 'host', name: 'Host' }, { clientId: 'a', name: 'A' }, { clientId: 'b', name: 'B' }] };
class Capture implements Transport {
  sent: NetMessage[] = []; handlers: Array<(m: NetMessage, from: string) => void> = []; blocked = new Set<string>();
  constructor(readonly clientId: string) {}
  send(m: NetMessage) { this.sent.push(m); }
  snapshotReady(id: string) { return !this.blocked.has(id); }
  onMessage(fn: (m: NetMessage, from: string) => void) { this.handlers.push(fn); }
  onStatus() {}
  close() {}
  receive(m: NetMessage, from: string) { this.handlers.forEach(fn => fn(m, from)); }
}
function game(client = 'host', remote = false) {
  const sim = new GameSimulation(matchOptions(setup, client, remote)); sim.start(); sim.botsFrozen = true;
  for (const actor of sim.humans) actor.position = { x: actor.id === 'p2' ? 1200 : -1200, y: 0, z: 0 };
  sim.actorById('bot-1')!.position = { x: -1180, y: 0, z: 0 };
  sim.actorById('bot-2')!.position = { x: 1180, y: 0, z: 0 };
  sim.state.vehicles[0].position = { x: -1190, y: 0, z: 0 };
  return sim;
}

test('each recipient gets its own inventory, public weapons, view and independent loot history', () => {
  const host = game(), a = new SnapshotBuilder(host, 'p1'), b = new SnapshotBuilder(host, 'p2'), mirror = game('a', true);
  host.humans[2].ownedWeapons.push('pistol'); host.humans[1].medkits = 8;
  const sa = a.build([]), sb = b.build([]);
  assert.deepEqual(sa.priv.map(row => row.id), ['p1']); assert.deepEqual(sb.priv.map(row => row.id), ['p2']);
  assert.ok(sa.pub?.some(([index, owned]) => index === 2 && owned.length === 2));
  assert.ok(sa.a.some(row => host.state.actors[row[0]].id === 'bot-1')); assert.ok(!sa.a.some(row => host.state.actors[row[0]].id === 'bot-2'));
  assert.ok(sb.a.some(row => host.state.actors[row[0]].id === 'bot-2')); assert.ok(!sb.a.some(row => host.state.actors[row[0]].id === 'bot-1'));
  assert.equal(sa.a.filter(row => host.state.actors[row[0]].isPlayer).length, 3);
  const message = { k: 'snap', s: sa }, roundtrip = new WireDecoder().decode(new WireEncoder().encode(message)); assert.deepEqual(roundtrip, message);
  applySnapshot(mirror, sa); assert.equal(mirror.player.medkits, 8); assert.deepEqual(mirror.humans[2].ownedWeapons, host.humans[2].ownedWeapons);
  assert.equal(mirror.state.aliveCount, host.state.actors.filter(actor => actor.alive).length);
  const item = host.state.loot.find(item => item.active && item.kind === 'medkit')!;
  const index = host.state.loot.indexOf(item); host.humans[2].position = { ...item.position }; host.pickupLoot(item.id, host.humans[2]);
  assert.ok(a.build([]).loot.off.includes(index)); assert.ok(b.build([]).loot.off.includes(index));
  assert.equal(a.build([], true).loot.add.length, host.state.loot.length);
});

test('scope hysteresis, hiding stale actors/cars and re-entry discard old interpolation poses', () => {
  const host = game(), mirror = game('a', true), builder = new SnapshotBuilder(host, 'p1'), transport = new Capture('a');
  let now = 1000; const client = new ClientSession(mirror, transport, 'host', () => now);
  const publish = () => { host.state.elapsed += .1; now += 100; transport.receive({ k: 'snap', to: 'a', s: builder.build([]) }, 'host'); };
  publish();
  const bot = host.actorById('bot-1')!, copy = mirror.actorById(bot.id)!;
  assert.equal(copy.netVisible, true); assert.equal(mirror.actorById('bot-2')!.netVisible, false);
  bot.position.x = host.humans[1].position.x + 440; publish(); assert.equal(copy.netVisible, true, '40m exit margin');
  bot.position.x = host.humans[1].position.x + 470; publish(); assert.equal(copy.netVisible, false);
  host.humans[1].position.x = 1200; publish(); assert.equal(mirror.state.vehicles[0].netVisible, false);
  host.humans[1].position.x = -1200; bot.position.x = -1160; host.state.vehicles[0].position.x = -1170; publish();
  assert.equal(copy.netVisible, true); assert.equal(copy.position.x, -1160);
  client.frame(now); assert.equal(copy.position.x, -1160, 'old view cannot interpolate the actor back to an earlier location');
  assert.equal(mirror.state.vehicles[0].netVisible, true); assert.equal(mirror.state.vehicles[0].position.x, -1170);
});

test('a dead recipient follows a remote human or bot, while living recipients cannot redirect their view', () => {
  const host = game(), builder = new SnapshotBuilder(host, 'p1');
  assert.ok(builder.build([], false, 'p2').a.some(row => host.state.actors[row[0]].id === 'bot-1'));
  host.humans[1].alive = false;
  const watched = builder.build([], false, 'p2');
  assert.ok(watched.a.some(row => host.state.actors[row[0]].id === 'bot-2')); assert.ok(!watched.a.some(row => host.state.actors[row[0]].id === 'bot-1'));
  assert.ok(builder.build([], false, 'bot-2').a.some(row => host.state.actors[row[0]].id === 'bot-2'));
});

test('a congested guest holds events/loot without advancing its snapshot; other guests keep receiving', () => {
  const sim = game(), transport = new Capture('host'); let now = 1000;
  const host = new HostSession(sim, transport, setup, 3000, () => now);
  transport.blocked.add('a');
  (sim as any).damage(sim.actorById('bot-1'), 1000, 'p0'); host.drainEvents();
  for (let i = 0; i < 10; i++) { now += 50; host.tick(.05); }
  assert.equal(transport.sent.filter(m => m.to === 'a').length, 0);
  assert.equal(transport.sent.filter(m => m.to === 'b').length, 10);
  const bFirst = transport.sent.find(m => m.to === 'b')!;
  assert.deepEqual(Object.keys(bFirst.echo as object), ['b']); assert.equal((bFirst.s as any).priv[0].id, 'p2');
  transport.blocked.clear(); now += 50; host.tick(.05);
  const first = transport.sent.find(m => m.to === 'a')!; const s = first.s as any;
  assert.equal(s.seq, 1); assert.ok(s.ev.some((e: any) => e.type === 'kill' && e.actorId === 'bot-1'));
  assert.ok(s.loot.add.some((row: any[]) => row[1] === 'drop-bot-1-weapon'));
  now += 50; host.tick(.05);
  assert.ok(!(transport.sent.at(-2)!.s as any).ev.some((e: any) => e.type === 'kill'), 'durable event delivered once');
  transport.receive({ k: 'resume' }, 'a');
  const resumed = transport.sent.at(-1)!.s as any;
  assert.equal(resumed.rs, 1); assert.equal(resumed.priv.length, 1); assert.equal(resumed.priv[0].id, 'p1'); assert.equal(resumed.loot.add.length, sim.state.loot.length);
});

test('stationary input uses four heartbeats per second; turns, movement, jumps and commands send promptly', () => {
  const sim = game('a', true), transport = new Capture('a'); let now = 1000;
  const client = new ClientSession(sim, transport, 'host', () => now);
  for (let i = 0; i < 120; i++) { now += 1000 / 60; client.tick(now, idle, 0); }
  assert.ok(transport.sent.length >= 8 && transport.sent.length <= 9, `${transport.sent.length} idle packets in two seconds`);
  const before = transport.sent.length; now += 50; client.tick(now, idle, .2);
  assert.equal(transport.sent.length, before + 1); assert.equal(transport.sent.at(-1)!.yaw, .2);
  now += 50; client.tick(now, { ...idle, moveZ: 1 }, .2); assert.equal(transport.sent.at(-1)!.mz, 1);
  now += 50; client.tick(now, idle, .2); assert.equal(transport.sent.at(-1)!.mz, 0, 'stop is not held until heartbeat');
  now += 40; client.tick(now, { ...idle, jump: true }, .2); assert.equal(transport.sent.at(-1)!.edge, 1);
  now += 40; client.queueCommand('reload'); client.tick(now, idle, .2); assert.deepEqual(transport.sent.at(-1)!.cmds, [['reload']]);
});

test('targeted packets for a different guest cannot overwrite a local inventory or sequence', () => {
  const host = game(), mirror = game('a', true), transport = new Capture('a');
  new ClientSession(mirror, transport, 'host', () => 1000);
  host.humans[1].medkits = 9;
  transport.receive({ k: 'snap', to: 'b', s: new SnapshotBuilder(host, 'p2').build([]) }, 'host');
  transport.receive({ k: 'snap', to: 'a', s: new SnapshotBuilder(host, 'p1').build([]) }, 'host');
  assert.equal(mirror.player.medkits, 9);
});

test('a congested guest still receives match results after the other guests have finished their final sends', () => {
  const sim = game(), transport = new Capture('host'); let now = 1000;
  const host = new HostSession(sim, transport, setup, 3000, () => now);
  transport.blocked.add('a'); sim.state.phase = 'won'; sim.state.winnerId = 'p0';
  for (let i = 0; i < 20; i++) { now += 50; host.tick(.05); }
  assert.equal(transport.sent.length, 6);
  transport.blocked.clear(); now += 50; host.tick(.05);
  assert.equal(transport.sent.at(-1)!.to, 'a'); assert.equal((transport.sent.at(-1)!.s as any).over, 'p0');
});

test('partial pickups update seed contents for each guest and repair a missed update without full seed retransmission', () => {
  const config = { ...setup, map: 'range' as const, botCount: 0 };
  const host = new GameSimulation(matchOptions(config, 'host', false)), mirror = new GameSimulation(matchOptions(config, 'a', true));
  host.start(); mirror.start();
  const a = new SnapshotBuilder(host, 'p1'), b = new SnapshotBuilder(host, 'p2');
  assert.deepEqual(a.build([]).loot.add, []);
  const loot = host.state.loot.find(item => item.kind === 'bandage')!, index = host.state.loot.indexOf(loot), picker = host.humans[0];
  picker.pack = 3; picker.supplies.bandage = SUPPLIES.bandage.max - 1; picker.position = { ...loot.position };
  assert.equal(host.pickupLoot(loot.id, picker), true); assert.equal(loot.active, true); assert.equal(loot.amount, 3);
  const changed = a.build([]), encoded = new WireEncoder().encode({ k: 'snap', s: changed });
  assert.equal(changed.loot.add.length, 1); assert.equal(changed.loot.add[0][0], index);
  applySnapshot(mirror, new WireDecoder().decode(encoded).s as any);
  assert.equal(mirror.state.loot[index].amount, 3);
  // Guest B misses its immediate update and gets it back from the periodic reassertion.
  assert.equal(b.build([]).loot.add.length, 1);
  for (let i = 0; i < 49; i++) {
    const snapshot = b.build([]);
    if (snapshot.seq < 50) assert.deepEqual(snapshot.loot.add, []);
    else { assert.equal(snapshot.loot.add.length, 1); assert.equal(snapshot.loot.add[0][6], 3); }
  }
  // Picking up the rest still removes the same edited row on mirrors, including after reassertion.
  picker.supplies.bandage = 0; assert.equal(host.pickupLoot(loot.id, picker), true); assert.equal(loot.active, false);
  applySnapshot(mirror, a.build([])); assert.equal(mirror.state.loot[index].active, false);
  let periodic = a.build([]); while (periodic.seq % 50) periodic = a.build([]);
  applySnapshot(mirror, periodic); assert.equal(mirror.state.loot[index].active, false);
  const full = a.build([], true); applySnapshot(mirror, full); assert.equal(mirror.state.loot[index].active, false);
});

test('dynamic partial stacks synchronize their changed contents without creating duplicate pickups', () => {
  const host = game(), mirror = game('a', true), builder = new SnapshotBuilder(host, 'p1');
  host.state.loot.push({ id: 'stack-drop', kind: 'bandage', position: { ...host.humans[1].position }, active: true, amount: 4 });
  applySnapshot(mirror, builder.build([]));
  const index = host.state.loot.length - 1, actor = host.humans[1];
  actor.pack = 3; actor.supplies.bandage = 11; assert.equal(host.pickupLoot('stack-drop', actor), true);
  const changed = builder.build([]); assert.equal(changed.loot.add.length, 1); applySnapshot(mirror, changed);
  assert.equal(mirror.state.loot[index].amount, 3); assert.equal(mirror.state.loot[index].active, true);
  assert.equal(mirror.state.loot.filter(item => item.id === 'stack-drop').length, 1);
});
