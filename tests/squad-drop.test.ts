import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameSimulation } from '../src/game/simulation.ts';
import { LoopbackNetwork } from '../src/net/transport.ts';
import { Lobby } from '../src/net/lobby.ts';
import { HostSession, ClientSession, matchOptions } from '../src/net/session.ts';
import type { MatchSetup } from '../src/net/session.ts';
import { applySnapshot, SnapshotBuilder } from '../src/net/protocol.ts';
import type { PlayerInput } from '../src/types.ts';

const idle: PlayerInput = { moveX: 0, moveZ: 0, sprint: false, jump: false };
const setup: MatchSetup = { seed: 77, map: 'valley', botCount: 1, difficulty: 'normal', drop: true,
  players: [{ clientId: 'host', name: 'Host' }, { clientId: 'lead', name: 'Người dẫn' }, { clientId: 'mate', name: 'Đồng đội' }], dropLeader: 'lead' };
function game(remote = false, me = 'host') {
  const sim = new GameSimulation(matchOptions(setup, me, remote)); sim.start(); sim.botsFrozen = true; return sim;
}
function run(sim: GameSimulation, seconds: number, leader: PlayerInput = idle, local: PlayerInput = idle) {
  sim.setHumanInput('p1', leader);
  for (let i = 0; i < Math.ceil(seconds * 30); i++) sim.update(1 / 30, local);
}
function jump(sim: GameSimulation) { run(sim, 1 / 30, { ...idle, jump: true }); run(sim, 1 / 30); }

test('the host can select a guest to lead; clients see the choice; unknown members and client changes are rejected', () => {
  const network = new LoopbackNetwork(), ht = network.connect('host'), ct = network.connect('lead');
  const config = { map: 'valley' as const, botCount: 1, difficulty: 'normal' as const };
  const host = new Lobby(ht, 'Host', 'host', config), client = new Lobby(ct, 'Lead', 'client', config);
  host.tick(0); client.tick(0); network.advance(20);
  host.setDropLeader('lead'); network.advance(20);
  assert.equal(client.dropLeader, 'lead');
  host.setDropLeader('stranger'); client.setDropLeader('host');
  assert.equal(host.dropLeader, 'lead'); assert.equal(client.dropLeader, 'lead');
  assert.equal(host.start()!.dropLeader, 'lead'); network.advance(20);
  assert.equal(client.setup!.dropLeader, 'lead');
});

test('a selected leader leaving the waiting room clears the choice instead of starting with a missing leader', () => {
  const network = new LoopbackNetwork(), ht = network.connect('host'), ct = network.connect('lead');
  const config = { map: 'valley' as const, botCount: 1, difficulty: 'normal' as const };
  const host = new Lobby(ht, 'Host', 'host', config), client = new Lobby(ct, 'Lead', 'client', config);
  host.tick(0); client.tick(0); network.advance(20); host.setDropLeader('lead');
  client.leave(); network.advance(20);
  assert.equal(host.dropLeader, undefined); assert.equal(host.start()!.dropLeader, undefined);
});

test('a guest leads the host and teammate through jump, steering and canopy opening while follower input is ignored', () => {
  const sim = game(), leader = sim.actorById('p1')!, mate = sim.actorById('p2')!;
  assert.equal(sim.player.dropFollowing, 'p1'); assert.equal(leader.dropFollowing, undefined);
  run(sim, 3, idle, { ...idle, jump: true, moveX: -45 });
  assert.equal(sim.player.air!.mode, 'plane', 'follower cannot jump separately without detaching');
  jump(sim);
  assert.ok(sim.humans.every(actor => actor.air?.mode === 'freefall'));
  sim.setHumanInput('p2', { ...idle, jump: true, moveZ: -45 });
  run(sim, 1.2, { ...idle, moveX: 28 }, { ...idle, moveX: -45 });
  for (const follower of [sim.player, mate]) {
    assert.equal(follower.position.y, leader.position.y);
    assert.deepEqual(follower.air, leader.air);
    assert.ok(Math.hypot(follower.position.x - leader.position.x, follower.position.z - leader.position.z) < 30);
  }
  const events = sim.drainEvents().filter(event => event.type === 'drop' && event.stage === 'jump');
  assert.equal(events.length, 3, 'each human jumps exactly once');
  jump(sim);
  assert.ok(sim.humans.every(actor => actor.air?.mode === 'chute'));
});

test('detaching restores independent controls and keeps the other follower slot and flight velocity intact', () => {
  const sim = game(), leader = sim.actorById('p1')!, mate = sim.actorById('p2')!;
  run(sim, 3); jump(sim); run(sim, 1.2, { ...idle, moveX: 28 }); jump(sim);
  // Remove the plane's exit momentum so opposite steering can diverge within this short sample.
  for (const human of sim.humans) { human.air!.vx = 0; human.air!.vz = 0; }
  const velocity = { ...sim.player.air! }, offset = { x: mate.position.x - leader.position.x, z: mate.position.z - leader.position.z };
  assert.equal(sim.detachDrop(), true); assert.deepEqual(sim.player.air, velocity);
  assert.equal(sim.detachDrop(), false);
  run(sim, 1, { ...idle, moveX: 16 }, { ...idle, moveX: -16 });
  assert.equal(sim.player.dropFollowing, undefined);
  assert.ok(Math.abs(sim.player.air!.vx - leader.air!.vx) > 5);
  assert.ok(Math.abs(mate.position.x - leader.position.x - offset.x) < 1e-7);
  assert.ok(Math.abs(mate.position.z - leader.position.z - offset.z) < 1e-7);
});

test('losing the leader releases followers; landing removes all follow state; independent drops stay unchanged', () => {
  const sim = game(); run(sim, 3); jump(sim);
  sim.eliminate('p1'); run(sim, 1 / 30);
  assert.equal(sim.player.dropFollowing, undefined); assert.equal(sim.actorById('p2')!.dropFollowing, undefined);
  assert.equal(sim.player.air?.mode, 'freefall');
  const spot = sim.world.spawns[0];
  sim.player.position = { x: spot.x, y: sim.heightAt(spot.x, spot.z) + .1, z: spot.z };
  sim.player.air = { mode: 'chute', vx: 0, vy: -6.5, vz: 0, time: 3 };
  run(sim, .2);
  assert.equal(sim.player.air, null); assert.equal(sim.player.dropFollowing, undefined);
  const independent = new GameSimulation(matchOptions({ ...setup, dropLeader: undefined }, 'host', false)); independent.start();
  assert.ok(independent.humans.every(actor => !actor.dropFollowing));
  const arena = new GameSimulation(matchOptions({ ...setup, map: 'arena' }, 'host', false)); arena.start();
  assert.ok(arena.humans.every(actor => !actor.dropFollowing && !actor.air));
});

test('snapshots carry follow and detach state and follower prediction keeps the host velocity instead of braking', () => {
  const sim = game(), mirror = game(true), builder = new SnapshotBuilder(sim);
  run(sim, 3); jump(sim); run(sim, 1, { ...idle, moveX: 28 });
  const snapshot = builder.build([]); const applied = applySnapshot(mirror, snapshot, { writePositions: true });
  mirror.player.position = { x: applied.local!.x, y: applied.local!.y, z: applied.local!.z };
  assert.equal(mirror.player.dropFollowing, 'p1');
  const before = { ...mirror.player.position }, velocity = { ...mirror.player.air! };
  mirror.update(.1, { ...idle, moveX: -45, jump: true });
  assert.equal(mirror.player.air!.vx, velocity.vx);
  assert.ok(Math.abs(mirror.player.position.x - before.x - velocity.vx * .1) < 1e-7);
  sim.detachDrop(); applySnapshot(mirror, builder.build([]));
  assert.equal(mirror.player.dropFollowing, undefined);
});

test('a follower client can detach over the session without controlling another teammate', () => {
  const network = new LoopbackNetwork({ latency: 60, jitter: 15 }, 7), ht = network.connect('host'), ct = network.connect('mate');
  const sim = game(), mirror = game(true, 'mate');
  const host = new HostSession(sim, ht, setup, 8000, () => network.now), client = new ClientSession(mirror, ct, 'host', () => network.now);
  const frame = () => { network.advance(1000 / 30); sim.update(1 / 30, idle); host.drainEvents(); host.tick(1 / 30);
    mirror.update(1 / 30, idle); client.tick(network.now, idle, 0); client.frame(network.now); };
  for (let i = 0; i < 90; i++) frame();
  sim.setHumanInput('p1', { ...idle, jump: true }, true); frame(); sim.setHumanInput('p1', idle);
  for (let i = 0; i < 30; i++) frame();
  assert.equal(mirror.player.dropFollowing, 'p1'); assert.equal(mirror.player.air?.mode, 'freefall');
  client.queueCommand('drop-detach', 'p0');
  for (let i = 0; i < 30; i++) frame();
  assert.equal(sim.actorById('p2')!.dropFollowing, undefined); assert.equal(mirror.player.dropFollowing, undefined);
  assert.equal(sim.player.dropFollowing, 'p1', 'command arguments cannot detach somebody else');
});
