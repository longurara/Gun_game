import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameSimulation } from '../src/game/simulation.ts';
import { HULLS, VEHICLES, vehicleKindFor } from '../src/game/vehicles.ts';
import type { VehicleKind } from '../src/game/vehicles.ts';

const idle = { moveX: 0, moveZ: 0, sprint: false, jump: false };

function island() {
  const game = new GameSimulation({ seed: 5, botCount: 2, map: 'island' });
  game.start();
  game.botsFrozen = true;
  game.player.air = null;
  return game;
}
/** Put the player on a vehicle of this kind (moved to a clear stretch of ground next to it). */
function board(game: GameSimulation, kind: VehicleKind) {
  const car = game.state.vehicles.find(v => v.kind === kind)!;
  game.player.position = { x: car.position.x + 1.2, y: car.position.y, z: car.position.z };
  assert.ok(game.useVehicle(game.player), `boarded the ${kind}`);
  return car;
}

test('the island parks cars, motorbikes and buggies, always the same ones in the same places', () => {
  const game = island();
  const kinds = new Map<string, number>();
  for (const v of game.state.vehicles) kinds.set(v.kind, (kinds.get(v.kind) ?? 0) + 1);
  assert.ok((kinds.get('car') ?? 0) > 5 && (kinds.get('bike') ?? 0) >= 2 && (kinds.get('buggy') ?? 0) >= 2, JSON.stringify([...kinds]));
  assert.deepEqual(game.state.vehicles.map(v => v.kind), game.state.vehicles.map((_, i) => vehicleKindFor(i)));
  for (const v of game.state.vehicles) assert.equal(v.health, VEHICLES[v.kind].health);
});

test('a motorbike is quicker off the line and faster flat out than a car, and a buggy sits between', () => {
  const top = (kind: VehicleKind, seconds: number) => {
    const game = island();
    const car = board(game, kind);
    // A long straight on open ground: flatten the way by clearing obstacles near the car.
    game.world.obstacles = game.world.obstacles.filter(o => Math.hypot(o.x - car.position.x, o.z - car.position.z) > 400);
    let best = 0;
    for (let i = 0; i < seconds * 30; i++) { game.update(1 / 30, { ...idle, throttle: 1, steer: 0 }); best = Math.max(best, car.speed); }
    return best;
  };
  assert.ok(top('bike', 1.2) > top('car', 1.2), 'the bike gets going sooner');
  assert.ok(top('bike', 8) > top('car', 8) && top('buggy', 8) < top('car', 8), 'the bike is fastest, the buggy slowest');
  assert.ok(top('car', 12) > VEHICLES.car.maxForward - 2);
});

test('inside a car you are covered from bullets, on a bike or a buggy you are not', () => {
  for (const [kind, covered] of [['car', true], ['bike', false], ['buggy', false]] as const) {
    const game = island();
    const car = board(game, kind);
    const shooter = game.state.actors.find(a => !a.isPlayer)!;
    // Stand the shooter a short way off, level with the rider, with open ground between.
    game.world.obstacles = game.world.obstacles.filter(o => Math.hypot(o.x - car.position.x, o.z - car.position.z) > 60);
    const sz = car.position.z - 25;
    shooter.position = { x: car.position.x, y: game.heightAt(car.position.x, sz), z: sz };
    game.player.health = 100;
    const before = car.health;
    let hit = false;
    for (let i = 0; i < 12 && !hit; i++) {
      shooter.ammo[shooter.weapon] = 30;
      (game as unknown as { runtime(a: unknown): { cooldown: number; weaponCooldowns: Record<string, number> } }).runtime(shooter).cooldown = 0;
      game.shootPlayer({ x: car.position.x, y: car.position.y + 1.1, z: car.position.z }, true, shooter);
      hit = game.player.health < 100;
      game.update(0.4, idle);
    }
    // A closed car takes the bullets and lets only a little through to the driver; an open seat takes a whole bullet.
    if (covered) { assert.ok(100 - game.player.health < 8, `the ${kind} driver is shielded (lost ${(100 - game.player.health).toFixed(1)})`); assert.ok(car.health < before, 'the car takes the bullets'); }
    else assert.ok(100 - game.player.health >= 20, `the ${kind} rider is hit (lost ${(100 - game.player.health).toFixed(1)})`);
  }
});

test('a crash that a car shrugs off hurts a bike rider', () => {
  const hurt = (kind: 'car' | 'bike') => {
    const game = island();
    const car = board(game, kind);
    const before = game.player.health = 100;
    car.speed = 8;
    (game as unknown as { crash(v: unknown): void }).crash(car);
    return before - game.player.health;
  };
  assert.equal(hurt('car'), 0);
  assert.ok(hurt('bike') > 0);
});

test('a mirror drives each kind the way the host does', () => {
  const options = { seed: 5, botCount: 2, map: 'island', humans: 2, names: ['A', 'B'], drop: false } as const;
  const host = new GameSimulation({ ...options, localId: 'p0' });
  const mirror = new GameSimulation({ ...options, localId: 'p1', remote: true });
  host.start(); mirror.start();
  assert.deepEqual(mirror.state.vehicles.map(v => v.kind), host.state.vehicles.map(v => v.kind));
});

const ALL_KINDS = Object.keys(VEHICLES) as VehicleKind[];

test('the island parks every kind of vehicle, from scooters to a minibus', () => {
  const game = island();
  const kinds = new Set(game.state.vehicles.map(v => v.kind));
  assert.deepEqual(ALL_KINDS.filter(kind => !kinds.has(kind)), [], 'a kind that never spawns');
  assert.equal(ALL_KINDS.length, 12);
});

test('every kind has sane handling and a hit box that agrees with whether the driver is exposed', () => {
  for (const kind of ALL_KINDS) {
    const s = VEHICLES[kind], h = HULLS[kind];
    assert.ok(s.label.length > 2 && s.health >= 60 && s.radius > 0.5 && s.maxForward > s.maxReverse && s.accel > 2 && s.lock > 0.3 && s.lock < 1.1 && s.wheelbase > 0.8 && s.hurtAt > 3, kind);
    assert.ok(h.half > 0.2 && h.length > h.half && h.low >= 0.1 && h.high > h.low + 0.5, `${kind} hit box`);
    assert.ok(s.radius >= h.half, `${kind}: the collision circle covers the body`);
    // A closed body is tall enough to hide the driver; an open one leaves them showing above it.
    assert.equal(h.high >= 1.2, !s.exposed, `${kind}: hull height ${h.high} but exposed=${s.exposed}`);
  }
  assert.ok(VEHICLES.minibus.health > VEHICLES.van.health && VEHICLES.van.health > VEHICLES.pickup.health && VEHICLES.pickup.health > VEHICLES.car.health);
  assert.ok(VEHICLES.coupe.maxForward > VEHICLES.bike.maxForward && VEHICLES.scooter.health < VEHICLES.bike.health);
  assert.ok(VEHICLES.minibus.accel < VEHICLES.van.accel && VEHICLES.minibus.lock < VEHICLES.car.lock, 'big vehicles are slow to start and turn wide');
});

test('every kind can be boarded, driven up to speed, steered and reversed', () => {
  for (const kind of ALL_KINDS) {
    const game = island();
    const car = board(game, kind);
    game.world.obstacles = game.world.obstacles.filter(o => Math.hypot(o.x - car.position.x, o.z - car.position.z) > 400);
    const stats = VEHICLES[kind];
    for (let i = 0; i < 8 * 30; i++) game.update(1 / 30, { ...idle, throttle: 1, steer: 0 });
    assert.ok(car.speed > stats.maxForward * 0.7 && car.speed <= stats.maxForward * 1.1 + 1e-6, `${kind} reached ${car.speed.toFixed(1)} of ${stats.maxForward}`);
    const yaw = car.yaw;
    for (let i = 0; i < 30; i++) game.update(1 / 30, { ...idle, throttle: 1, steer: 1 });
    assert.ok(Math.abs(Math.atan2(Math.sin(car.yaw - yaw), Math.cos(car.yaw - yaw))) > 0.05, `${kind} does not steer`);
    for (let i = 0; i < 10 * 30; i++) game.update(1 / 30, { ...idle, throttle: -1, steer: 0 });
    assert.ok(car.speed < 0 && car.speed >= -stats.maxReverse * 1.2 - 1e-6, `${kind} reverse speed ${car.speed.toFixed(1)}`);
    assert.ok(Number.isFinite(car.position.x + car.position.z + car.position.y), kind);
    assert.ok(game.useVehicle(game.player), `${kind}: gets out again`);
  }
});

test('a wrecked vehicle leaves a hulk as big as the vehicle was', () => {
  const sizes = new Map<string, number>();
  for (const kind of ['scooter', 'car', 'minibus'] as VehicleKind[]) {
    const game = island();
    const car = board(game, kind);
    game.world.obstacles = game.world.obstacles.filter(o => Math.hypot(o.x - car.position.x, o.z - car.position.z) > 400);
    const wx = car.position.x + Math.sin(car.yaw) * 60, wz = car.position.z + Math.cos(car.yaw) * 60;
    // Tall enough that no hill ahead lifts the vehicle over it.
    const wall = { id: 'qa-wall', x: wx, z: wz, width: 30, depth: 30, height: 60, kind: 'wall' as const, base: game.heightAt(wx, wz) - 20 };
    game.world.obstacles.push(wall);
    car.health = 5; // already battered, so the first hard crash finishes it
    for (let i = 0; i < 20 * 30 && car.health > 0; i++) game.update(1 / 30, { ...idle, throttle: 1, steer: 0 });
    assert.ok(car.health <= 0, `${kind} did not crash`);
    const hulk = game.world.obstacles.find(o => o.id === `wreck-${car.id}`)!;
    sizes.set(kind, Math.max(hulk.width, hulk.depth));
  }
  assert.ok(sizes.get('scooter')! < sizes.get('car')! && sizes.get('car')! < sizes.get('minibus')!, JSON.stringify([...sizes]));
});
