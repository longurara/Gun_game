import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameSimulation } from '../src/game/simulation.ts';
import { HostSession, ClientSession, matchOptions } from '../src/net/session.ts';
import type { MatchSetup } from '../src/net/session.ts';
import { LoopbackNetwork, RECONNECT_GRACE_MS } from '../src/net/transport.ts';
import type { NetMessage, Transport, TransportStatus, PeerState } from '../src/net/transport.ts';
import { SnapshotBuilder, applySnapshot } from '../src/net/protocol.ts';
import { WireEncoder } from '../src/net/wire.ts';
import type { PlayerInput } from '../src/types.ts';

const idle: PlayerInput = { moveX: 0, moveZ: 0, sprint: false, jump: false };
const setup: MatchSetup = { seed: 77, map: 'arena', botCount: 3, difficulty: 'normal', drop: false,
  players: [{ clientId: 'host', name: 'Host' }, { clientId: 'client', name: 'Client' }, { clientId: 'mate', name: 'Mate' }] };
class GatedTransport implements Transport {
  online = true;
  sent: NetMessage[] = [];
  states: Array<(id: string, state: PeerState) => void> = [];
  statuses: Array<(status: TransportStatus) => void> = [];
  private handlers: Array<(message: NetMessage, from: string) => void> = [];
  private endpoint;
  constructor(readonly clientId: string, net: LoopbackNetwork) {
    this.endpoint = net.connect(clientId);
    this.endpoint.onMessage((message, from) => { if (this.online) for (const handler of this.handlers) handler(message, from); });
  }
  send(message: NetMessage) { if (this.online) { this.sent.push(message); this.endpoint.send(message); } }
  onMessage(handler: (message: NetMessage, from: string) => void) { this.handlers.push(handler); }
  onStatus(handler: (status: TransportStatus) => void) { this.statuses.push(handler); }
  onPeerState(handler: (id: string, state: PeerState) => void) { this.states.push(handler); }
  peer(id: string, state: PeerState) { for (const handler of this.states) handler(id, state); }
  status(status: TransportStatus) { for (const handler of this.statuses) handler(status); }
  close() { this.endpoint.close(); }
}
function room() {
  const net = new LoopbackNetwork({ latency: 20 }), ht = new GatedTransport('host', net), ct = new GatedTransport('client', net);
  const host = new GameSimulation(matchOptions(setup, 'host', false)), mirror = new GameSimulation(matchOptions(setup, 'client', true));
  host.start(); host.botsFrozen = true; mirror.start();
  const hs = new HostSession(host, ht, setup, 1000, () => net.now), cs = new ClientSession(mirror, ct, 'host', () => net.now);
  const frame = () => { net.advance(1000 / 30); host.update(1 / 30, idle); hs.drainEvents(); hs.tick(1 / 30);
    if (!cs.reconnecting) mirror.update(1 / 30, idle); cs.tick(net.now, idle, 0); if (!cs.reconnecting) cs.frame(net.now); };
  const run = (seconds: number) => { for (let i = 0; i < seconds * 30; i++) frame(); };
  const disconnect = () => { ct.online = false; ct.status('reconnecting'); ht.peer('client', 'reconnecting'); };
  const reconnect = () => { ct.online = true; ht.peer('client', 'open'); ct.status('open'); };
  run(.5); return { net, ht, ct, host, mirror, hs, cs, run, disconnect, reconnect };
}
test('disconnect protects health and armour, clears held input and pending attacks, then fully restores the same actor', () => {
  const r = room(), actor = r.host.actorById('p1')!;
  actor.health = 68; actor.helmet = 2; actor.helmetHp = 70; actor.vest = 2; actor.vestHp = 80;
  actor.position = { x: -60, y: 0, z: -22 };
  r.host.setHumanInput(actor.id, { ...idle, moveX: 1, jump: true }, true);
  r.cs.queueFire({ x: 1, y: 1, z: 1 }, false); r.cs.queueCommand('reload');
  r.disconnect();
  assert.equal(actor.reconnecting, true);
  const sim = r.host as any;
  assert.equal(sim.absorb(actor, 100, false), 0); sim.damage(actor, 1000, 'p0');
  assert.equal(actor.health, 68); assert.equal(actor.vestHp, 80);
  const oldPosition = { ...actor.position };
  r.run(.5); assert.ok(Math.hypot(actor.position.x - oldPosition.x, actor.position.z - oldPosition.z) < .1);
  assert.equal(actor.position.y, 0, 'pending jump is cancelled');
  r.run(12);
  assert.equal(actor.alive, true); assert.equal(r.cs.connectionLost, false);
  // Change authoritative state while this client cannot receive it.
  actor.position = { x: 20, y: 0, z: -22 }; actor.ammo[actor.weapon] = 7;
  r.host.state.loot[0].active = false;
  r.host.state.loot.push({ id: 'offline-drop', kind: 'medkit', position: { x: 20, y: 0, z: -22 }, active: true, amount: 3 });
  r.host.state.loot[1].amount = 11;
  r.mirror.state.loot[1].active = false;
  r.mirror.state.loot[1].amount = 99;
  const sentAt = r.ct.sent.length;
  r.reconnect(); r.run(.6);
  assert.equal(actor.reconnecting, undefined); assert.equal(r.cs.reconnecting, false);
  assert.equal(r.mirror.player.id, actor.id); assert.equal(r.mirror.player.health, 68);
  assert.equal(r.mirror.player.ammo[actor.weapon], 7);
  assert.ok(Math.hypot(r.mirror.player.position.x - actor.position.x, r.mirror.player.position.z - actor.position.z) < .1);
  assert.equal(r.mirror.state.loot[0].active, false); assert.equal(r.mirror.state.loot[1].amount, 11);
  assert.equal(r.mirror.state.loot[1].active, true, 'full resync also restores a pickup reactivated by the host');
  assert.equal(r.mirror.state.loot.find(l => l.id === 'offline-drop')?.amount, 3);
  assert.ok(r.ct.sent.slice(sentAt).filter(m => m.k === 'in').every(m => !m.fires && !m.cmds), 'offline attacks are discarded');
  sim.damage(actor, 10, 'p0'); assert.equal(actor.health, 58, 'protection ends as soon as resume completes');
});
test('the grace expires after 30 seconds and repeated reconnect attempts cannot renew it or resurrect a player', () => {
  const r = room(), actor = r.host.actorById('p1')!; r.disconnect();
  r.run(29); assert.equal(actor.alive, true);
  r.ht.peer('client', 'reconnecting'); r.run(1.2);
  assert.equal(actor.alive, false); assert.equal(actor.reconnecting, undefined); assert.equal(r.cs.connectionLost, true);
  r.reconnect(); r.run(.3); assert.equal(actor.alive, false);
});
test('voluntary leave bypasses protection and host departure is terminal', () => {
  const r = room(); r.disconnect(); r.ct.online = true; r.ct.send({ k: 'bye' }); r.run(.2);
  assert.equal(r.host.actorById('p1')!.alive, false);
  r.ht.send({ k: 'closed' }); r.run(.2); assert.equal(r.cs.closedByHost, true);
});
test('a silent connection uses the same protected window even without transport state callbacks', () => {
  const r = room(); r.ct.online = false; r.run(1.2);
  assert.equal(r.host.actorById('p1')!.reconnecting, true); assert.equal(r.host.actorById('p1')!.alive, true);
  r.ct.online = true; r.run(3);
  assert.equal(r.host.actorById('p1')!.reconnecting, undefined); assert.equal(r.cs.reconnecting, false);
});
test('forced resync carries complete loot and protection flags, within the binary packet limit on the largest map', () => {
  const largeSetup = { ...setup, map: 'desert' as const, botCount: 100 };
  const sim = new GameSimulation(matchOptions(largeSetup, 'host', false)); sim.start();
  sim.setReconnecting('p1', true);
  const snapshot = new SnapshotBuilder(sim).build([], true);
  const encoded = new WireEncoder().encode({ k: 'resume-state', to: 'client', s: snapshot });
  assert.ok(encoded.length < 256 * 1024);
  const mirror = new GameSimulation(matchOptions(largeSetup, 'client', true)); mirror.start();
  applySnapshot(mirror, snapshot, { writePositions: true }); assert.equal(mirror.player.reconnecting, true);
  assert.equal(snapshot.loot.add.length, sim.state.loot.length); assert.equal(RECONNECT_GRACE_MS, 30000);
});
