import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameSimulation } from '../src/game/simulation.ts';
import { ClientSession, matchOptions } from '../src/net/session.ts';
import type { MatchSetup } from '../src/net/session.ts';
import { SnapshotBuilder } from '../src/net/protocol.ts';
import { LoopbackNetwork } from '../src/net/transport.ts';
import type { GameEvent, MapId, Projectile } from '../src/types.ts';

const idle = { moveX: 0, moveZ: 0, sprint: false, jump: false };
function room(map: MapId = 'range') {
  const setup: MatchSetup = { seed: 77, map, botCount: 0, difficulty: 'normal', drop: false,
    players: [{ clientId: 'host', name: 'Host' }, { clientId: 'guest', name: 'Guest' }] };
  const network = new LoopbackNetwork(), ht = network.connect('host'), gt = network.connect('guest');
  const host = new GameSimulation(matchOptions(setup, 'host', false)), mirror = new GameSimulation(matchOptions(setup, 'guest', true));
  host.start(); mirror.start(); host.botsFrozen = true;
  const client = new ClientSession(mirror, gt, 'host', () => network.now), builder = new SnapshotBuilder(host, 'p1');
  const send = (events: GameEvent[] = []) => { ht.send({ k: 'snap', to: 'guest', s: builder.build(events) }); network.advance(0); };
  return { host, mirror, client, network, send, guest: host.actorById('p1')! };
}

function vault(sim: GameSimulation) {
  sim.world.obstacles = [{ id: 'vault-crate', x: 0, z: 1.6, width: 1.2, depth: 1, height: 1.1, kind: 'crate' }];
  sim.player.position = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < 6; i++) sim.update(1 / 30, { ...idle, moveZ: 1 });
  sim.update(1 / 30, { ...idle, moveZ: 1, jump: true });
  assert.ok((sim as any).runtime(sim.player).vault, 'a real predicted vault started');
}
function respawn(r: ReturnType<typeof room>) {
  (r.host as any).damage(r.guest, 1000, 'p0'); r.send(); assert.equal(r.mirror.player.alive, false);
  r.host.update(2.1, idle); assert.equal(r.guest.alive, true); r.send();
}

test('an ordinary range respawn cancels a predicted vault and places the player at spawn immediately', () => {
  const r = room(); vault(r.mirror); respawn(r);
  assert.deepEqual(r.mirror.player.position, r.guest.position);
  r.mirror.update(1 / 30, idle);
  assert.deepEqual(r.mirror.player.position, r.guest.position, 'old vault cannot drag the revived player back');
});

test('a range respawn clears stale jump velocity without waiting for reconnect', () => {
  const r = room(); r.mirror.setMotion(r.mirror.player, { vy: 6.7, speed: 5 }); respawn(r);
  r.mirror.update(1 / 30, idle);
  assert.equal(r.mirror.player.position.y, r.guest.position.y, 'the player does not jump again on respawn');
  assert.deepEqual(r.mirror.motionOf(r.mirror.player), { vy: 0, speed: 0 });
});

test('range respawn resets the dead client weapon cooldown just as the host resets its runtime', () => {
  const r = room(); r.host.rangeEquip('heavySniper', r.guest); r.send();
  assert.equal(r.mirror.shootPlayer({ x: 0, y: 10, z: 100 }, true), true); respawn(r);
  assert.equal(r.mirror.shootPlayer({ x: 0, y: 10, z: 100 }, true), true, 'a pre-death cooldown cannot prevent firing after revival');
});

test('a close stair teleport cancels the local vault and is not eased through the wall', () => {
  const r = room('arena'); vault(r.mirror);
  r.guest.position = { ...r.mirror.player.position };
  const from = { ...r.guest.position }, to = { x: from.x + 4, y: 0, z: from.z + 3 };
  r.host.world.portals = [{ id: 'stairs', x: from.x, y: from.y, z: from.z, to, label: 'Stairs' }];
  assert.equal(r.host.useStairs(r.guest), true); r.send(r.host.drainEvents());
  assert.deepEqual(r.mirror.player.position, to);
  r.mirror.update(1 / 30, idle); r.client.tick(33, idle, 0);
  assert.deepEqual(r.mirror.player.position, to, 'old prediction and correction offsets were cleared');
});

test('a remote stair teleport shorter than the generic teleport threshold does not interpolate through walls', () => {
  const r = room('arena'), actor = r.host.player;
  actor.position = { x: -60, y: 0, z: -22 }; r.send(); r.client.frame(0);
  r.network.advance(50); r.host.update(.05, idle);
  const from = { ...actor.position }, to = { x: from.x + 4, y: 0, z: from.z + 3 };
  r.host.world.portals = [{ id: 'stairs', x: from.x, y: from.y, z: from.z, to, label: 'Stairs' }];
  assert.equal(r.host.useStairs(actor), true); r.send(r.host.drainEvents()); r.client.frame(r.network.now);
  assert.deepEqual(r.mirror.actorById('p0')!.position, to, 'buffered old poses cannot pull the actor back into the stairs');
});

for (const [kind, gravity] of [['rocket', .96], ['shell', 4.8], ['frag', 16]] as const) {
  test(`client ${kind} projection uses its actual gravity`, () => {
    const r = room('arena');
    r.host.state.projectiles = [{ id: 1, kind, x: 0, y: 10, z: 0, vx: 4, vy: 0, vz: 5, fuse: 6, owner: 'p0' }];
    r.send(); r.client.frame(200);
    const p = r.mirror.state.projectiles![0];
    assert.ok(Math.abs(p.y - (10 - gravity * .2 * .2 / 2)) < 1e-6, `${kind} does not use another projectile's arc`);
    assert.ok(Math.abs(p.vy + gravity * .2) < 1e-6, 'rendered velocity agrees with the arc');
  });
}

for (const [name, floorY] of [['bunker', -10], ['upper floor', 3]] as const) {
  test(`projectiles respect the ${name} support surface instead of the terrain`, () => {
    const r = room('arena');
    r.mirror.world.floors = [{ id: name, x: 0, z: 0, width: 10, depth: 10, y0: floorY, y1: floorY }];
    const p: Projectile = { id: 1, kind: 'frag', x: 0, y: floorY + .16, z: 0, vx: 0, vy: -1, vz: 0, fuse: 2, owner: 'p0' };
    r.host.state.projectiles = [p]; r.send(); r.client.frame(200);
    assert.ok(Math.abs(r.mirror.state.projectiles![0].y - (floorY + .12)) < 1e-6);
  });
}
