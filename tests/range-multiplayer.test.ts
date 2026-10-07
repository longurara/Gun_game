import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameSimulation } from '../src/game/simulation.ts';
import { ClientSession, HostSession, matchOptions } from '../src/net/session.ts';
import type { MatchSetup } from '../src/net/session.ts';
import { LoopbackNetwork } from '../src/net/transport.ts';
import { applySnapshot, SnapshotBuilder } from '../src/net/protocol.ts';
import { WireEncoder, WireDecoder } from '../src/net/wire.ts';
import { WEAPONS } from '../src/game/weapons.ts';

const idle = { moveX: 0, moveZ: 0, sprint: false, jump: false };
const setup: MatchSetup = { seed: 44, map: 'range', botCount: 0, difficulty: 'normal', drop: false,
  players: Array.from({ length: 6 }, (_, index) => ({ clientId: `u${index}`, name: `Bạn ${index}` })) };
function make(id = 'u0', remote = false) { const sim = new GameSimulation(matchOptions(setup, id, remote)); sim.start(); sim.botsFrozen = true; return sim; }
const hurt = (sim: GameSimulation, id: string, amount = 1000) => (sim as any).damage(sim.actorById(id), amount, 'bot-1');

test('six range members have matching independent identities and distinct spawn positions on every machine', () => {
  const host = make();
  assert.deepEqual(host.humans.map(a => a.id), ['p0', 'p1', 'p2', 'p3', 'p4', 'p5']);
  assert.equal(new Set(host.humans.map(a => `${a.position.x}:${a.position.z}`)).size, 6);
  for (const [index, member] of setup.players.entries()) {
    const mirror = make(member.clientId, true);
    assert.equal(mirror.localId, `p${index}`); assert.equal(mirror.player.name, member.name);
    assert.deepEqual(mirror.state.actors.map(a => a.id), host.state.actors.map(a => a.id));
  }
});

test('all humans refill supplies and respawn individually, but a departed member cannot return', () => {
  const sim = make(), positions = sim.humans.map(a => ({ ...a.position }));
  for (const actor of sim.humans) { actor.reserve['9mm'] = 0; actor.medkits = 0; actor.position.z = 0; hurt(sim, actor.id); }
  for (let i = 0; i < 80; i++) sim.update(1 / 30, idle);
  for (const [index, actor] of sim.humans.entries()) {
    assert.ok(actor.alive); assert.equal(actor.health, 100); assert.deepEqual(actor.position, positions[index]);
    assert.ok(actor.reserve['9mm'] >= 400 && actor.medkits >= 3);
  }
  sim.setImmortal(true, sim.humans[1]); sim.eliminate('p1');
  for (let i = 0; i < 90; i++) sim.update(1 / 30, idle);
  assert.ok(!sim.humans[1].alive && sim.humans[1].hidden); assert.equal(sim.state.phase, 'playing');
});

test('immortality and armour protection are per member; drills and hit counts belong to the shooter', () => {
  const sim = make(), [host, guest] = sim.humans;
  sim.setImmortal(true, guest); guest.vest = 2; guest.vestHp = 80;
  assert.equal((sim as any).absorb(guest, 100, false), 0); hurt(sim, guest.id); hurt(sim, host.id, 20);
  assert.equal(guest.health, 100); assert.equal(guest.vestHp, 80); assert.equal(host.health, 80);
  assert.ok(sim.startDrill('warm', host)); assert.ok(sim.startDrill('mixed', guest));
  const target = sim.actorById('dummy-3-15')!;
  host.position = { x: 150, y: 0, z: -150 }; guest.position = { x: target.position.x, y: 0, z: target.position.z - 8 };
  sim.rangeEquip('pistol', guest); guest.yaw = 0;
  assert.ok(sim.shootPlayer({ ...target.position, y: 1.1 }, true, guest));
  assert.equal(guest.practice!.shots, 1); assert.ok(guest.practice!.hits > 0 && guest.practice!.drill!.score > 0);
  assert.equal(host.practice!.drill!.score, 0); assert.equal(host.practice!.drill!.shots, 0);
  assert.ok(sim.stopDrill(guest)); assert.ok(!host.practice!.drill!.done);
});

test('binary snapshots carry personal range state, pop-up visibility and clear stale death ranks after respawn', () => {
  const sim = make(), mirror = make('u1', true), guest = sim.humans[1];
  sim.startDrill('moving', guest); sim.setImmortal(true, guest); guest.practice!.shots = 5; guest.practice!.hits = 3; guest.kills = 2;
  sim.state.actors.find(a => a.dummy)!.hidden = true;
  mirror.player.alive = false; mirror.player.rank = 8; mirror.state.playerRank = 8; mirror.state.diedAt = 1;
  const snap = new SnapshotBuilder(sim).build([]);
  const packet = new WireDecoder().decode(new WireEncoder().encode({ k: 'snap', s: snap as any }));
  applySnapshot(mirror, packet.s as any);
  assert.equal(mirror.player.practice!.drill!.id, 'moving'); assert.equal(mirror.immortal, true);
  assert.equal(mirror.state.shots, 5); assert.equal(mirror.state.hits, 3); assert.equal(mirror.state.kills, 2);
  assert.equal(mirror.player.rank, undefined); assert.equal(mirror.state.playerRank, undefined); assert.equal(mirror.state.diedAt, undefined);
  assert.equal(mirror.state.actors.find(a => a.dummy)!.hidden, true);
});

test('host validates guest range commands, movement, shared vehicle reset and leaving over the normal session', () => {
  const network = new LoopbackNetwork({}, 3), hostWire = network.connect('u0'), guestWire = network.connect('u1');
  const sim = make(), mirror = make('u1', true);
  // Only these two clients take part in this transport test.
  const pair = { ...setup, players: setup.players.slice(0, 2) };
  const host = new HostSession(sim, hostWire, pair, 3000, () => network.now);
  const client = new ClientSession(mirror, guestWire, 'u0', () => network.now);
  function step(frames = 10) { for (let i = 0; i < frames; i++) { network.advance(50); client.tick(network.now, { ...idle, moveZ: 1 }, 0); network.advance(0); sim.update(.05, idle); host.drainEvents(); host.tick(.05); network.advance(0); client.frame(network.now); } }
  client.queueCommand('range-equip', 'sniper'); client.queueCommand('range-drill', 'far'); client.queueCommand('range-immortal', true);
  const initialZ = sim.humans[1].position.z; step();
  assert.equal(sim.humans[1].weapon, 'sniper'); assert.equal(sim.humans[1].ammo.sniper, WEAPONS.sniper.magazine);
  assert.equal(mirror.player.weapon, 'sniper'); assert.equal(mirror.player.practice!.drill!.id, 'far'); assert.ok(mirror.immortal);
  assert.ok(sim.humans[1].position.z > initialZ); assert.equal(sim.humans[0].weapon, 'rifle'); assert.ok(!sim.humans[0].practice!.immortal);
  const fullHealth = sim.state.vehicles[0].health;
  sim.state.vehicles[0].health = 1; client.queueCommand('range-reset-vehicles'); step(); assert.equal(sim.state.vehicles[0].health, fullHealth);
  client.queueCommand('range-equip', 'constructor'); client.queueCommand('range-drill', 'constructor'); step(); assert.equal(sim.humans[1].weapon, 'sniper');
  client.leave(); network.advance(0); for (let i = 0; i < 90; i++) sim.update(1 / 30, idle);
  assert.ok(!sim.humans[1].alive); assert.equal(sim.state.phase, 'playing'); host.close();
});
