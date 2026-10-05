import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameSimulation } from '../src/game/simulation.ts';
import { applySnapshot, PROTOCOL_VERSION, SnapshotBuilder } from '../src/net/protocol.ts';
import { ClientSession, HostSession, matchOptions } from '../src/net/session.ts';
import type { MatchSetup } from '../src/net/session.ts';
import { LoopbackNetwork } from '../src/net/transport.ts';
import type { PlayerInput } from '../src/types.ts';

const idle: PlayerInput = { moveX: 0, moveZ: 0, sprint: false, jump: false };

function setup() {
  const config: MatchSetup = {
    seed: 41, map: 'arena', botCount: 0, difficulty: 'normal', drop: false,
    players: [{ clientId: 'host', name: 'Host' }, { clientId: 'client', name: 'Client' }],
  };
  const host = new GameSimulation(matchOptions(config, 'host', false));
  const mirror = new GameSimulation(matchOptions(config, 'client', true));
  host.start(); mirror.start();
  for (const sim of [host, mirror]) {
    sim.world.obstacles = [];
    sim.state.loot = [];
    sim.actorById('p0')!.position = { x: 20, y: 0, z: 0 };
    sim.actorById('p1')!.position = { x: 0, y: 0, z: 0 };
    sim.drainEvents();
  }
  const network = new LoopbackNetwork();
  const hostTransport = network.connect('host');
  const clientTransport = network.connect('client');
  const hostSession = new HostSession(host, hostTransport, config, 8000, () => network.now);
  const clientSession = new ClientSession(mirror, clientTransport, 'host', () => network.now);
  const flush = () => {
    network.advance(100);
    clientSession.tick(network.now, idle, 0);
    network.advance(1);
    hostSession.drainEvents();
    hostSession.tick(0.11);
    network.advance(1);
  };
  return { host, mirror, network, hostSession, clientSession, clientTransport, flush, actor: host.actorById('p1')! };
}

test('inventory commands are authoritative and addressed to the client actor; snapshots return exact stacks', () => {
  const { host, mirror, actor, clientSession, flush } = setup();
  actor.medkits = 4;
  const own = host.player.medkits;
  clientSession.queueCommand('inventory-drop', { kind: 'medkit', amount: 3 });
  assert.equal(actor.medkits, 4, 'queueing a command does not mutate the host');
  const localBefore = mirror.player.medkits;
  assert.equal(mirror.player.medkits, localBefore, 'queueing a command does not mutate the mirror');
  flush();
  assert.equal(actor.medkits, 1);
  assert.equal(host.player.medkits, own, 'the client cannot act on the host inventory');
  assert.equal(mirror.player.medkits, 1);
  const dropped = host.state.loot.at(-1)!;
  assert.equal(dropped.amount, 3);
  assert.equal(mirror.state.loot.at(-1)!.amount, 3);
  clientSession.queueCommand('inventory-pickup', dropped.id);
  flush();
  assert.equal(actor.medkits, 4);
  assert.equal(mirror.player.medkits, 4);
  assert.equal(mirror.state.loot.at(-1)!.active, false);
  const events = clientSession.drainEvents().filter(event => event.type === 'pickup');
  assert.equal(events.length, 1);
  assert.equal(events[0].for, 'p1');
  clientSession.queueCommand('inventory-pickup', dropped.id);
  flush();
  assert.equal(actor.medkits, 4, 'repeated commands cannot duplicate a picked-up stack');
});

test('a client can choose the farther row and cannot pick a remote or higher-floor item', () => {
  const { host, actor, clientSession, flush } = setup();
  host.state.loot.push(
    { id: 'nearest', kind: '556Ammo', active: true, position: { x: 0.1, y: 0, z: 0 } },
    { id: 'chosen', kind: 'medkit', active: true, position: { x: 1, y: 0, z: 0 } },
    { id: 'far', kind: 'medkit', active: true, position: { x: 10, y: 0, z: 0 } },
    { id: 'floor', kind: 'medkit', active: true, position: { x: 0, y: 5, z: 0 } },
  );
  const kits = actor.medkits;
  clientSession.queueCommand('inventory-pickup', 'chosen');
  clientSession.queueCommand('inventory-pickup', 'far');
  clientSession.queueCommand('inventory-pickup', 'floor');
  flush();
  assert.equal(actor.medkits, kits + 1);
  assert.deepEqual(host.state.loot.map(item => item.active), [true, false, true, true]);
});

test('host rejects malformed inventory arguments, invalid amounts and attempts to remove the last gun', () => {
  const { host, actor, network, clientTransport } = setup();
  const before = { reserve: { ...actor.reserve }, medkits: actor.medkits, owned: [...actor.ownedWeapons] };
  const invalid: unknown[] = [
    null, 42, {}, 'inventory-drop',
    ['inventory-pickup', {}], ['inventory-pickup', 'x'.repeat(129)],
    ['inventory-drop', null], ['inventory-drop', ['medkit', 1]],
    ['inventory-drop', { kind: 'medkit', amount: '1' }],
    ['inventory-drop', { kind: 'medkit', amount: 0 }],
    ['inventory-drop', { kind: 'medkit', amount: -1 }],
    ['inventory-drop', { kind: 'medkit', amount: 0.5 }],
    ['inventory-drop', { kind: 'medkit', amount: 1_000_001 }],
    ['inventory-drop', { kind: 'medkit' }],
    ['inventory-drop', { kind: 'made-up', amount: 1 }],
    ['inventory-drop', { kind: 'rifle', amount: 1 }],
  ];
  clientTransport.send({ k: 'in', seq: 1, cmds: invalid });
  network.advance(1);
  assert.deepEqual(actor.reserve, before.reserve);
  assert.equal(actor.medkits, before.medkits);
  assert.deepEqual(actor.ownedWeapons, before.owned);
  assert.equal(host.state.loot.length, 0);
});

test('dropped magazine and worn armour payloads round trip through JSON and host snapshots', () => {
  const { host, mirror, actor, clientSession, flush } = setup();
  actor.ownedWeapons.push('pistol');
  actor.ammo.rifle = 7;
  actor.ammo.pistol = 4;
  actor.helmet = 3;
  actor.helmetHp = 26.5;
  const reserve = actor.reserve['556'];
  clientSession.queueCommand('inventory-drop', { kind: 'rifle', amount: 1 });
  clientSession.queueCommand('inventory-drop', { kind: 'helmet3', amount: 1 });
  flush();
  assert.equal(mirror.player.weapon, 'pistol');
  assert.equal(mirror.player.ammo.rifle, 0);
  const gun = host.state.loot.find(item => item.kind === 'rifle')!;
  const helmet = host.state.loot.find(item => item.kind === 'helmet3')!;
  assert.equal(mirror.state.loot.find(item => item.id === gun.id)!.loadedAmmo, 7);
  assert.equal(mirror.state.loot.find(item => item.id === helmet.id)!.durability, 26.5);
  clientSession.queueCommand('inventory-pickup', gun.id);
  clientSession.queueCommand('inventory-pickup', helmet.id);
  flush();
  assert.equal(actor.ammo.rifle, 7);
  assert.equal(mirror.player.ammo.rifle, 7);
  assert.equal(actor.reserve['556'], reserve);
  assert.equal(actor.helmetHp, 26.5);
  // Private armour rows retain the protocol's existing integer HUD precision.
  assert.equal(mirror.player.helmetHp, Math.round(26.5));
});

test('a newly dropped stack already picked up before a snapshot arrives is marked inactive on mirrors', () => {
  const { host, mirror, actor } = setup();
  const builder = new SnapshotBuilder(host);
  actor.medkits = 3;
  host.dropItem('medkit', 2, actor);
  const drop = host.state.loot.at(-1)!;
  host.pickupLoot(drop.id, actor);
  const snapshot = JSON.parse(JSON.stringify(builder.build([])));
  applySnapshot(mirror, snapshot);
  assert.equal(mirror.state.loot.at(-1)!.amount, 2);
  assert.equal(mirror.state.loot.at(-1)!.active, false);
  assert.equal(mirror.player.medkits, 3);
});

test('periodic resync recovers exact drop contents after the first add snapshot is lost', () => {
  const { host, mirror, actor } = setup();
  const builder = new SnapshotBuilder(host);
  actor.reserve['556'] = 17;
  host.dropItem('556Ammo', 6, actor);
  const lost = builder.build([]);
  assert.equal(lost.loot.add.length, 1);
  for (let i = 0; i < 48; i++) applySnapshot(mirror, JSON.parse(JSON.stringify(builder.build([]))));
  assert.equal(mirror.state.loot.length, 0, 'the first addition was lost');
  applySnapshot(mirror, JSON.parse(JSON.stringify(builder.build([]))));
  assert.equal(mirror.state.loot.length, 1);
  assert.equal(mirror.state.loot[0].amount, 6);
  assert.equal(mirror.player.reserve['556'], 11);
});

test('legacy six-field pickup rows still decode using normal world defaults', () => {
  const { host, mirror } = setup();
  const builder = new SnapshotBuilder(host);
  host.state.loot.push({ id: 'legacy', kind: 'medkit', active: true, position: { x: 1, y: 0, z: 0 } });
  const snapshot = JSON.parse(JSON.stringify(builder.build([])));
  assert.equal(snapshot.v, PROTOCOL_VERSION);
  assert.equal(snapshot.loot.add[0].length, 6);
  applySnapshot(mirror, snapshot);
  assert.equal(mirror.state.loot[0].amount, undefined);
  assert.equal(mirror.state.loot[0].loadedAmmo, undefined);
  assert.equal(mirror.state.loot[0].durability, undefined);
});

test('missing add packets leave safe inactive slots and a late row replaces its placeholder', () => {
  const { host, mirror, actor } = setup();
  const builder = new SnapshotBuilder(host);
  actor.medkits = 3;
  actor.reserve['556'] = 17;
  host.dropItem('medkit', 2, actor);
  const earlier = JSON.parse(JSON.stringify(builder.build([])));
  const firstId = host.state.loot[0].id;
  host.dropItem('556Ammo', 6, actor);
  const later = JSON.parse(JSON.stringify(builder.build([])));
  const secondId = host.state.loot[1].id;

  // Index 1 arrives before index 0. The empty slot must not crash the spatial grid or become collectible.
  applySnapshot(mirror, later);
  assert.equal(mirror.state.loot.length, 2);
  assert.ok(mirror.state.loot.every(item => item !== undefined));
  assert.equal(mirror.state.loot[0].active, false);
  const placeholderId = mirror.state.loot[0].id;
  assert.equal(mirror.pickupLoot(placeholderId), false);
  assert.deepEqual(mirror.nearbyLoot().map(item => item.id), [secondId]);
  assert.equal(mirror.state.loot[1].amount, 6);

  applySnapshot(mirror, earlier);
  assert.equal(mirror.state.loot[0].id, firstId, 'late metadata replaces the inactive placeholder');
  assert.equal(mirror.state.loot[0].amount, 2);
  assert.equal(mirror.state.loot[0].active, true);
  assert.equal(mirror.state.loot[1].id, secondId, 'the newer slot is retained');
  assert.equal(mirror.nearbyLoot().length, 2);
});

test('resync replaces missing slots while keeping already consumed drops inactive', () => {
  const { host, mirror, actor } = setup();
  const builder = new SnapshotBuilder(host);
  actor.medkits = 3;
  actor.reserve['556'] = 17;
  host.dropItem('medkit', 2, actor);
  const first = host.state.loot[0];
  builder.build([]); // Lost add for index 0.
  host.pickupLoot(first.id, actor);
  host.dropItem('556Ammo', 6, actor);
  applySnapshot(mirror, JSON.parse(JSON.stringify(builder.build([]))));
  assert.equal(mirror.state.loot[0].active, false);
  assert.equal(mirror.nearbyLoot().length, 1);
  for (let i = 0; i < 48; i++) applySnapshot(mirror, JSON.parse(JSON.stringify(builder.build([]))));
  assert.equal(mirror.state.loot[0].id, first.id);
  assert.equal(mirror.state.loot[0].amount, 2);
  assert.equal(mirror.state.loot[0].active, false);
  assert.equal(mirror.state.loot[1].amount, 6);
  assert.equal(mirror.nearbyLoot().length, 1);
});
