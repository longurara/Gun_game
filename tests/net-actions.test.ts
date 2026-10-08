import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameSimulation } from '../src/game/simulation.ts';
import { ClientSession, HostSession, matchOptions } from '../src/net/session.ts';
import type { MatchSetup } from '../src/net/session.ts';
import { SnapshotBuilder } from '../src/net/protocol.ts';
import { LoopbackNetwork } from '../src/net/transport.ts';

const idle = { moveX: 0, moveZ: 0, sprint: false, jump: false };
const target = { x: 0, y: 100, z: 100 };
function room() {
  const setup: MatchSetup = { seed: 77, map: 'range', botCount: 0, difficulty: 'normal', drop: false,
    players: [{ clientId: 'host', name: 'Host' }, { clientId: 'guest', name: 'Guest' }] };
  const network = new LoopbackNetwork(), ht = network.connect('host'), gt = network.connect('guest');
  const host = new GameSimulation(matchOptions(setup, 'host', false)), mirror = new GameSimulation(matchOptions(setup, 'guest', true));
  host.start(); mirror.start(); host.botsFrozen = true;
  const guest = host.actorById('p1')!;
  host.rangeEquip('pistol', guest); host.rangeEquip('rifle', guest);
  const hs = new HostSession(host, ht, setup, 3000, () => network.now);
  const client = new ClientSession(mirror, gt, 'host', () => network.now), builder = new SnapshotBuilder(host, 'p1');
  const send = () => { ht.send({ k: 'snap', to: 'guest', s: builder.build([]) }); network.advance(0); };
  send();
  const flush = () => { client.tick(network.now, idle, 0); network.advance(0); };
  const shoot = () => { assert.ok(mirror.shootPlayer(target, true)); client.queueFire(target, true); };
  return { network, ht, gt, host, mirror, guest, hs, client, send, flush, shoot };
}

test('a fire queued before a weapon switch spends ammo from the gun actually fired', () => {
  const r = room(), rifle = r.guest.ammo.rifle, pistol = r.guest.ammo.pistol;
  r.shoot(); r.mirror.switchWeapon('pistol'); r.client.queueCommand('switch', 'pistol'); r.flush();
  assert.equal(r.guest.ammo.rifle, rifle - 1);
  assert.equal(r.guest.ammo.pistol, pistol);
  assert.equal(r.guest.weapon, 'pistol');
});

test('firing and reloading in the same input packet executes the fire before reload', () => {
  const r = room(), ammo = r.guest.ammo.rifle;
  r.shoot(); r.client.queueCommand('reload'); r.flush();
  assert.equal(r.guest.ammo.rifle, ammo - 1);
  assert.ok(r.guest.reloading > 0, 'the reload is not rejected against the pre-shot full magazine');
});

test('equip, fire and equip back keep their order within one packet', () => {
  const r = room(), rifle = r.guest.ammo.rifle, pistol = r.guest.ammo.pistol;
  r.mirror.rangeEquip('pistol'); r.client.queueCommand('range-equip', 'pistol'); r.shoot();
  r.mirror.rangeEquip('rifle'); r.client.queueCommand('range-equip', 'rifle'); r.flush();
  assert.equal(r.guest.ammo.pistol, pistol - 1);
  assert.equal(r.guest.ammo.rifle, rifle);
  assert.equal(r.guest.weapon, 'rifle');
});

test('a recently fired rifle cannot clamp the magazine of a newly acquired pistol to zero', () => {
  const r = room(); r.mirror.player.ammo.pistol = 0; r.shoot();
  r.host.rangeEquip('pistol', r.guest); r.send();
  assert.equal(r.mirror.player.weapon, 'pistol');
  assert.equal(r.mirror.player.ammo.pistol, r.guest.ammo.pistol);
});

test('recent shots from both guns remain protected across a quick switch', () => {
  const r = room(); r.shoot(); const rifle = r.mirror.player.ammo.rifle;
  r.mirror.switchWeapon('pistol'); r.client.queueCommand('switch', 'pistol'); r.mirror.update(.3, idle);
  r.shoot(); const pistol = r.mirror.player.ammo.pistol;
  r.mirror.switchWeapon('rifle'); r.client.queueCommand('switch', 'rifle'); r.send();
  assert.equal(r.mirror.player.ammo.rifle, rifle);
  assert.equal(r.mirror.player.ammo.pistol, pistol, 'an old snapshot cannot refill the holstered gun that was also fired');
});

test('pending range equip keeps the new gun in the loadout with its loaded ammo until acknowledged', () => {
  const r = room(); r.mirror.rangeEquip('heavySniper'); r.client.queueCommand('range-equip', 'heavySniper');
  const ammo = r.mirror.player.ammo.heavySniper; r.send();
  assert.equal(r.mirror.player.weapon, 'heavySniper');
  assert.ok(r.mirror.player.ownedWeapons.includes('heavySniper'));
  assert.equal(r.mirror.player.ammo.heavySniper, ammo);
  r.flush(); r.send();
  assert.equal(r.guest.weapon, 'heavySniper');
  assert.deepEqual(r.mirror.player.ownedWeapons, r.guest.ownedWeapons);
});

test('entering a car discards the correction left over from walking', () => {
  const r = room(), car = r.host.state.vehicles[0];
  car.position = { x: 2, y: 0, z: 0 }; r.guest.position = { x: 1, y: 0, z: 0 }; r.mirror.player.position = { x: 0, y: 0, z: 0 };
  r.send(); assert.ok(r.client.corrections.count > 0);
  assert.ok(r.host.useVehicle(r.guest)); r.send(); r.client.frame(0);
  r.client.tick(33, idle, 0); r.client.tick(66, idle, 0);
  const copy = r.mirror.state.vehicles[0];
  assert.deepEqual(copy.position, car.position, 'old walking correction must not move the car');
});

test('exiting a car starts at the authoritative doorway with no stale driving correction', () => {
  const r = room(), car = r.host.state.vehicles[0];
  car.position = { x: 2, y: 0, z: 0 }; r.guest.position = { x: 1, y: 0, z: 0 };
  assert.ok(r.host.useVehicle(r.guest)); r.send(); r.client.frame(0);
  car.position.x += 1; r.send();
  assert.ok(r.host.useVehicle(r.guest)); r.send();
  assert.deepEqual(r.mirror.player.position, r.guest.position);
  r.client.tick(33, idle, 0); r.client.tick(66, idle, 0);
  assert.deepEqual(r.mirror.player.position, r.guest.position);
});

test('entering a car during a vault cannot resume the old vault after exiting elsewhere', () => {
  const r = room();
  r.host.world.obstacles = [{ id: 'vault-crate', x: 0, z: 1.6, width: 1.2, depth: 1, height: 1.1, kind: 'crate' }];
  r.guest.position = { x: 0, y: 0, z: 0 }; r.host.setHumanInput('p1', { ...idle, moveZ: 1 });
  for (let i = 0; i < 6; i++) r.host.update(1 / 30, idle);
  r.host.setHumanInput('p1', { ...idle, moveZ: 1, jump: true }); r.host.update(1 / 30, idle);
  assert.ok((r.host as any).runtime(r.guest).vault);
  const car = r.host.state.vehicles[0]; car.position = { x: 1, y: 0, z: r.guest.position.z };
  assert.ok(r.host.useVehicle(r.guest)); car.position = { x: 20, y: 0, z: 20 }; assert.ok(r.host.useVehicle(r.guest));
  const doorway = { ...r.guest.position }; r.host.setHumanInput('p1', idle); r.host.update(1 / 30, idle);
  assert.deepEqual(r.guest.position, doorway);
});

test('a player upstairs cannot enter a car through the floor just because the horizontal distance is small', () => {
  const r = room(), car = r.host.state.vehicles[0];
  car.position = { x: 0, y: 0, z: 0 }; r.guest.position = { x: 0, y: 3, z: 0 };
  assert.equal(r.host.useVehicle(r.guest), false);
  assert.equal(car.driverId, null);
});

test('duplicated or invalid action indices never run a command twice and legacy input still works', () => {
  const r = room(), car = r.host.state.vehicles[0];
  car.position = { x: 1, y: 0, z: 0 }; r.guest.position = { x: 0, y: 0, z: 0 };
  r.gt.send({ k: 'in', seq: 1, ct: 1, cmds: [['vehicle']], order: [0, 0, -99, 100, .5, '0'] }); r.network.advance(0);
  assert.equal(r.guest.vehicleId, car.id, 'the duplicate does not toggle the player back out');
  r.gt.send({ k: 'in', seq: 2, ct: 2, cmds: [['vehicle']] }); r.network.advance(0);
  assert.equal(r.guest.vehicleId, null, 'old clients without order metadata keep working');
});
