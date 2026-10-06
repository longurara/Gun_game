import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameSimulation } from '../src/game/simulation.ts';
import { createIsland } from '../src/game/world.ts';
import { VEHICLES } from '../src/game/vehicles.ts';
import type { Actor, PlayerInput, Vehicle } from '../src/types.ts';

const idle: PlayerInput = { moveX: 0, moveZ: 0, sprint: false, jump: false };
const drive = (throttle: number, steer = 0, handbrake = false): PlayerInput => ({ ...idle, throttle, steer, jump: handbrake });

/** An island match with the player standing on a town's flat plateau, clear ground, and frozen bots. */
function yard(options: { bots?: number; frozen?: boolean } = {}) {
  const { world } = createIsland();
  const town = world.towns[0];
  const game = new GameSimulation({ seed: 6, botCount: options.bots ?? 2, map: 'island', difficulty: 'normal' });
  game.start();
  game.botsFrozen = options.frozen ?? true;
  game.world.obstacles = [];
  game.state.vehicles = [];
  game.state.loot = [];
  const base = { x: town.x, z: town.z };
  game.player.position = { x: base.x, y: game.heightAt(base.x, base.z), z: base.z };
  game.player.health = 1e9;
  let n = 0;
  const car = (dx: number, dz: number, yaw = 0): Vehicle => {
    const x = base.x + dx, z = base.z + dz;
    const v: Vehicle = { id: `t${n++}`, position: { x, y: game.heightAt(x, z), z }, yaw, speed: 0, health: 300, driverId: null, colorIndex: 0, hitTimer: 0 };
    game.state.vehicles.push(v);
    return v;
  };
  game.drainEvents();
  return { game, base, car, player: game.player };
}

test('the island has cars on its roads and the arena has none', () => {
  const island = new GameSimulation({ seed: 1, botCount: 5, map: 'island' });
  island.start();
  assert.ok(island.state.vehicles.length >= 30);
  for (const v of island.state.vehicles) assert.equal(v.health, VEHICLES[v.kind].health);
  const arena = new GameSimulation({ seed: 1, botCount: 5 });
  arena.start();
  assert.equal(arena.state.vehicles.length, 0);
});

test('the player gets in a car within reach, not one far away, and steps out beside it', () => {
  const { game, car, player } = yard();
  const near = car(2.5, 0);
  const far = car(40, 0);
  assert.equal(game.vehicleInReach?.id, near.id);
  assert.equal(game.useVehicle(), true);
  assert.equal(player.vehicleId, near.id);
  assert.equal(near.driverId, 'player');
  assert.equal(game.useVehicle(), true, 'pressing the key again gets out');
  assert.equal(player.vehicleId, null);
  assert.equal(near.driverId, null);
  assert.ok(Math.hypot(player.position.x - near.position.x, player.position.z - near.position.z) > 2, 'the player stands clear of the doors');
  assert.equal(far.driverId, null);
  player.position = { ...far.position };
  player.position.x += 30;
  assert.equal(game.vehicleInReach, null);
  assert.equal(game.useVehicle(), false);
});

test('a driver cannot shoot, reload, heal or pick things up while driving; the car carries the player', () => {
  const { game, car, player } = yard();
  const v = car(2, 0);
  game.useVehicle();
  assert.equal(game.shootPlayer({ x: 0, y: 1, z: 50 }), false);
  assert.equal(game.reload(), false);
  assert.equal(game.heal(), false);
  assert.equal(game.interact(), false);
  game.update(2, drive(1));
  assert.ok(v.speed > 10);
  assert.ok(Math.hypot(player.position.x - v.position.x, player.position.z - v.position.z) < 0.01, 'the driver rides along');
  assert.equal(player.yaw, v.yaw);
});

test('throttle accelerates to a top speed, steering turns, the brake stops it, reverse is slower', () => {
  const { game, car } = yard();
  const v = car(3, 0, 0);
  game.useVehicle();
  game.update(1, drive(1));
  assert.ok(v.speed > 6 && v.speed < 12, `after 1 s: ${v.speed.toFixed(1)}`);
  game.update(8, drive(1));
  assert.ok(v.speed > 26 && v.speed <= 33.5, `top speed ${v.speed.toFixed(1)} m/s`);
  const heading = v.yaw;
  game.update(1, drive(1, 1));
  assert.ok(v.yaw > heading + 0.1, 'steering right turns the car clockwise');
  game.update(1.5, drive(0, 0, true));
  game.update(2, drive(0, 0, true));
  assert.ok(Math.abs(v.speed) < 0.5, 'the handbrake stops the car');
  game.update(6, drive(-1));
  assert.ok(v.speed < -5 && v.speed >= -11, `reverse ${v.speed.toFixed(1)}`);
  // Without input a moving car coasts to a halt.
  const coast = yard();
  const w = coast.car(3, 0, 0);
  coast.game.useVehicle();
  coast.game.update(3, drive(1));
  const fast = w.speed;
  coast.game.update(4, drive(0));
  assert.ok(w.speed < fast * 0.4, 'drag slows a coasting car');
});

test('hitting a wall at speed stops the car, hurts it and the driver, and wrecks it when hit hard enough', () => {
  const { game, base, car, player } = yard();
  game.world.obstacles = [{ id: 'wall', x: base.x, z: base.z + 60, width: 40, depth: 3, height: 5, kind: 'building', base: game.heightAt(base.x, base.z) }];
  const v = car(0, 3.5, 0);
  assert.equal(game.useVehicle(), true);
  player.health = 100;
  let crashed = 0;
  for (let i = 0; i < 400 && v.health > 0; i++) {
    game.update(0.05, drive(1));
    for (const e of game.drainEvents()) if (e.type === 'crash') crashed++;
  }
  assert.ok(crashed > 0, 'a crash was reported');
  assert.ok(v.position.z < base.z + 60 - 1.5 - 1, `the car never passed the wall (z ${v.position.z - base.z})`);
  assert.ok(v.health < 300, 'the car was damaged');
  assert.ok(player.health < 100 || v.health <= 0, 'the driver felt it');
  // Keep ramming until it is destroyed.
  for (let i = 0; i < 2000 && v.health > 0; i++) { game.update(0.05, drive(i % 40 < 30 ? 1 : -1)); game.drainEvents(); }
  assert.ok(v.health <= 0, 'repeated impacts destroy the car');
  assert.ok(game.world.obstacles.some(o => o.kind === 'wreck'), 'a wreck blocks the road');
});

test('a car cannot be driven into deep water', () => {
  const { world, terrain } = createIsland();
  const lake = world.water!.lakes[0];
  const game = new GameSimulation({ seed: 6, botCount: 1, map: 'island' });
  game.start();
  game.botsFrozen = true;
  game.world.obstacles = [];
  const x = lake.x + lake.r * 1.5, z = lake.z;
  game.state.vehicles = [{ id: 'boat', position: { x, y: terrain(x, z), z }, yaw: -Math.PI / 2, speed: 0, health: 1e6, driverId: null, colorIndex: 0, hitTimer: 0 }];
  game.player.position = { x: x + 2, y: terrain(x + 2, z), z };
  game.player.health = 1e9;
  assert.equal(game.useVehicle(), true);
  for (let i = 0; i < 400; i++) {
    game.update(0.05, drive(1));
    const v = game.state.vehicles[0];
    const deep = Math.hypot(v.position.x - lake.x, v.position.z - lake.z) < lake.r && terrain(v.position.x, v.position.z) < lake.level - 1.05;
    assert.ok(!deep, `the car entered the lake at step ${i}`);
  }
});

test('a moving car runs people over and credits the driver; a slow car does not', () => {
  const { game, car, base, player } = yard({ bots: 1 });
  const victim = game.state.actors[1];
  victim.position = { x: base.x, y: game.heightAt(base.x, base.z + 30), z: base.z + 30 };
  victim.health = 100;
  game.state.actors = [player, victim];
  const v = car(0, 4, 0);
  game.useVehicle();
  game.update(3, drive(1));
  assert.ok(victim.health < 100, 'the bot was hit');
  assert.ok(victim.health > 0 || !victim.alive);
  const slow = yard({ bots: 1 });
  const bystander = slow.game.state.actors[1];
  bystander.position = { x: slow.base.x, y: slow.game.heightAt(slow.base.x, slow.base.z + 6), z: slow.base.z + 6 };
  bystander.health = 100;
  slow.game.state.actors = [slow.player, bystander];
  const s = slow.car(0, 2, 0);
  slow.game.useVehicle();
  s.speed = 3;
  slow.game.update(0.5, drive(0));
  assert.equal(bystander.health, 100, 'a crawling car is harmless');
});

test('shooting a car wrecks it: the driver is ejected, the blast hurts bystanders and it can no longer be driven', () => {
  const { game, car, base, player } = yard({ bots: 2 });
  const bystander: Actor = game.state.actors[1];
  const driver: Actor = game.state.actors[2];
  const v = car(0, 12, 0);
  v.driverId = driver.id; driver.vehicleId = v.id;
  driver.position = { ...v.position };
  bystander.position = { x: v.position.x + 3, y: v.position.y, z: v.position.z };
  bystander.health = 100;
  game.state.actors = [player, bystander, driver];
  player.position = { x: base.x, y: game.heightAt(base.x, base.z), z: base.z };
  v.health = 10;
  game.botsFrozen = true;
  const aim = { x: v.position.x, y: v.position.y + 1, z: v.position.z };
  assert.equal(game.shootPlayer(aim, true), true);
  assert.ok(v.health <= 0, 'one more hit destroys it');
  assert.equal(driver.vehicleId, null, 'the driver was thrown out');
  assert.equal(v.driverId, null);
  assert.ok(driver.health < 100, 'the explosion hurt the driver');
  assert.ok(bystander.health < 100, 'and anyone standing close');
  assert.ok(game.drainEvents().some(e => e.type === 'explosion'));
  player.position = { x: v.position.x - 2, y: v.position.y, z: v.position.z };
  assert.equal(game.vehicleInReach, null, 'a wreck cannot be entered');
});

test('bullets that miss the car pass by; an occupied car shields its driver from direct hits', () => {
  const { game, car, base, player } = yard({ bots: 1 });
  const driver = game.state.actors[1];
  const v = car(0, 15, 0);
  v.driverId = driver.id; driver.vehicleId = v.id; driver.position = { ...v.position };
  game.state.actors = [player, driver];
  game.botsFrozen = true;
  player.position = { x: base.x, y: game.heightAt(base.x, base.z), z: base.z };
  const before = driver.health;
  game.shootPlayer({ x: v.position.x, y: v.position.y + 1, z: v.position.z }, true);
  assert.ok(driver.health > before - 5, 'the driver takes only a sliver of a hit on the car');
  assert.ok(v.health < 300);
  assert.equal(game.state.hits, 0, 'hitting a car is not counted as hitting a person');
});

test('a dying driver tumbles out of the car, which keeps its health', () => {
  const { game, car, player } = yard({ bots: 1 });
  const driver = game.state.actors[1];
  const v = car(0, 10, 0);
  v.driverId = driver.id; driver.vehicleId = v.id; driver.position = { ...v.position };
  game.state.actors = [player, driver];
  game.botsFrozen = true;
  game.update(0.1, idle);
  driver.health = 1;
  (game as unknown as { damage(a: Actor, n: number): void }).damage(driver, 50);
  assert.equal(driver.alive, false);
  assert.equal(driver.vehicleId, null);
  assert.equal(v.driverId, null);
  assert.equal(v.health, 300);
});

test('a bot with a far destination walks to a nearby car, drives there on its own and gets out', () => {
  const { game, base, car, player } = yard({ bots: 1, frozen: false });
  const bot = game.state.actors[1];
  game.state.actors = [player, bot];
  player.position = { x: 1500, y: game.heightAt(1500, 1500), z: 1500 }; // keep the bot in the cheap tier of nothing else
  const v = car(25, 0, 0);
  bot.position = { x: base.x, y: game.heightAt(base.x, base.z), z: base.z };
  bot.health = 100;
  const runtime = (game as unknown as { runtime(a: Actor): { goal: { x: number; z: number } | null; destination: unknown } }).runtime(bot);
  const destination = { x: base.x + 60, z: base.z + 330 };
  runtime.goal = destination;
  let boarded = false, left = false;
  let top = 0;
  for (let t = 0; t < 90 && !left; t += 0.1) {
    runtime.goal = runtime.goal ?? destination;
    game.update(0.1, idle);
    game.drainEvents();
    if (bot.vehicleId === v.id) { boarded = true; top = Math.max(top, Math.abs(v.speed)); }
    if (boarded && !bot.vehicleId) left = true;
  }
  assert.ok(boarded, 'the bot got into the car');
  assert.ok(top > 15, `and drove it (top ${top.toFixed(0)} m/s)`);
  assert.ok(left, 'then got out again');
});
