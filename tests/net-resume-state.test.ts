import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameSimulation } from '../src/game/simulation.ts';
import { ClientSession, matchOptions } from '../src/net/session.ts';
import type { MatchSetup } from '../src/net/session.ts';
import { SnapshotBuilder } from '../src/net/protocol.ts';
import { LoopbackNetwork } from '../src/net/transport.ts';

const idle = { moveX: 0, moveZ: 0, sprint: false, jump: false };
const setup: MatchSetup = { seed: 77, map: 'arena', botCount: 3, difficulty: 'normal', drop: false,
  players: [{ clientId: 'host', name: 'Host' }, { clientId: 'guest', name: 'Guest' }] };
function room(config = setup) {
  const network = new LoopbackNetwork(), ht = network.connect('host'), gt = network.connect('guest');
  const host = new GameSimulation(matchOptions(config, 'host', false)), mirror = new GameSimulation(matchOptions(config, 'guest', true));
  host.start(); mirror.start(); host.botsFrozen = true;
  const client = new ClientSession(mirror, gt, 'host', () => network.now), builder = new SnapshotBuilder(host, 'p1');
  const send = (resume = true) => { ht.send({ k: resume ? 'resume-state' : 'snap', to: 'guest', s: builder.build([], resume) }); network.advance(0); };
  return { host, mirror, client, send };
}

test('resume restores the local position and yaw before input resumes or another snapshot arrives', () => {
  const r = room(), authoritative = r.host.humans[1];
  authoritative.position = { x: -60, y: 0, z: -22 }; authoritative.yaw = 1.25;
  r.mirror.player.position = { x: 20, y: 10, z: 30 }; r.mirror.player.yaw = -1;
  r.send();
  assert.equal(r.client.reconnecting, false);
  assert.deepEqual(r.mirror.player.position, authoritative.position);
  assert.equal(r.mirror.player.yaw, authoritative.yaw);
});

test('resume clears a stale jump velocity when the host has already landed', () => {
  const r = room();
  r.mirror.player.position = { x: -60, y: 0, z: -22 };
  r.host.humans[1].position = { ...r.mirror.player.position };
  r.mirror.setMotion(r.mirror.player, { vy: 6.7, speed: 5 });
  r.host.setMotion(r.host.humans[1], { vy: 0, speed: 0 });
  r.send();
  r.mirror.update(1 / 30, idle);
  assert.equal(r.mirror.player.position.y, 0, 'reconnecting cannot launch the player into a second jump');
  assert.deepEqual(r.mirror.motionOf(r.mirror.player), { vy: 0, speed: 0 });
});

test('normal snapshots preserve an in-progress predicted jump instead of resetting velocity', () => {
  const r = room();
  r.mirror.player.position = { x: -60, y: 1, z: -22 };
  r.host.humans[1].position = { ...r.mirror.player.position };
  r.mirror.setMotion(r.mirror.player, { vy: 3, speed: 0 });
  r.host.setMotion(r.host.humans[1], { vy: 0, speed: 0 });
  r.send(false);
  assert.equal(r.mirror.motionOf(r.mirror.player).vy, 3);
});

test('resume restores the authoritative battle kill total even if the kill events were lost', () => {
  const r = room(); r.host.humans[1].kills = 5; r.mirror.state.kills = 1;
  r.send();
  assert.equal(r.mirror.player.kills, 5);
  assert.equal(r.mirror.state.kills, 5);
  r.send(false); assert.equal(r.mirror.state.kills, 5, 'repeated snapshots cannot count a kill again');
});

test('a vault interrupted by disconnection cannot teleport the player back to its old start after resume', () => {
  const r = room(); r.mirror.world.obstacles = [];
  r.mirror.player.position = { x: 0, y: 0, z: 0 };
  r.mirror.world.obstacles.push({ id: 'vault-crate', x: 0, z: 1.6, width: 1.2, depth: 1, height: 1.1, kind: 'crate' });
  for (let i = 0; i < 6; i++) r.mirror.update(1 / 30, { ...idle, moveZ: 1 });
  r.mirror.update(1 / 30, { ...idle, moveZ: 1, jump: true });
  assert.ok((r.mirror as any).runtime(r.mirror.player).vault, 'a real predicted vault is in progress');
  r.host.humans[1].position = { x: -60, y: 0, z: -22 }; r.send();
  r.mirror.update(1 / 30, idle);
  assert.deepEqual(r.mirror.player.position, r.host.humans[1].position);
});

test('resume restores both the driver and vehicle immediately and prediction continues from the host speed', () => {
  const r = room({ ...setup, map: 'range', botCount: 0 }), car = r.host.state.vehicles[0], driver = r.host.humans[1];
  car.position = { x: -60, y: 0, z: -22 }; driver.position = { x: -58.8, y: 0, z: -22 };
  assert.equal(r.host.useVehicle(driver), true);
  car.speed = 12; car.yaw = 1.25; driver.yaw = car.yaw;
  const copy = r.mirror.state.vehicles[0];
  r.mirror.player.vehicleId = copy.id; copy.driverId = r.mirror.localId;
  copy.position = { x: 20, y: 0, z: 30 }; copy.speed = 90; copy.yaw = -2;
  r.mirror.player.position = { x: 20, y: .3, z: 30 };
  r.send();
  assert.deepEqual(r.mirror.player.position, driver.position);
  assert.deepEqual(copy.position, car.position); assert.equal(copy.speed, 12); assert.equal(copy.yaw, 1.25);
  r.client.frame(0); assert.deepEqual(r.mirror.player.position, driver.position);
});
