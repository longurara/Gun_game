import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameSimulation } from '../src/game/simulation.ts';
import { VEHICLES, vehicleKindFor } from '../src/game/vehicles.ts';

const idle = { moveX: 0, moveZ: 0, sprint: false, jump: false };

function island() {
  const game = new GameSimulation({ seed: 5, botCount: 2, map: 'island' });
  game.start();
  game.botsFrozen = true;
  game.player.air = null;
  return game;
}
/** Put the player on a vehicle of this kind (moved to a clear stretch of ground next to it). */
function board(game: GameSimulation, kind: 'car' | 'bike' | 'buggy') {
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
  const top = (kind: 'car' | 'bike' | 'buggy', seconds: number) => {
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
