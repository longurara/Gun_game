import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameSimulation } from '../src/game/simulation.ts';
import { createValley, createValleyWorld, VALLEY_HALF } from '../src/game/world.ts';
import type { PlayerInput } from '../src/types.ts';

const idle: PlayerInput = { moveX: 0, moveZ: 0, sprint: false, jump: false };
const inLake = (x: number, z: number, lakes: Array<{ x: number; z: number; r: number }>, scale = 1.1) => lakes.some(l => Math.hypot(x - l.x, z - l.z) < l.r * scale);

test('the 1 km valley is generated once, with settlements, houses, lakes, forest and no sea', () => {
  const first = createValley();
  assert.equal(first, createValley(), 'generation is cached');
  const { world, terrain } = first;
  assert.equal(world.id, 'valley');
  assert.equal(world.halfSize, VALLEY_HALF);
  assert.ok(world.towns.length >= 6, `${world.towns.length} settlements`);
  assert.ok(world.obstacles.filter(o => o.kind === 'roof').length >= 50, 'enterable houses');
  assert.ok(world.water!.lakes.length >= 2);
  assert.ok(world.obstacles.filter(o => o.kind === 'tree').length >= 200, 'a real forest');
  assert.ok(world.vehicleSpawns.length >= 10);
  assert.ok(world.water!.seaLevel < -10, 'no sea level inside the terrain');
  for (let x = -VALLEY_HALF; x <= VALLEY_HALF; x += 25) for (let z = -VALLEY_HALF; z <= VALLEY_HALF; z += 25) {
    const h = terrain(x, z);
    assert.ok(Number.isFinite(h) && h > 5 && h < 160, `height ${h} at ${x},${z}`);
  }
  // The edge climbs into hills that close the valley in.
  assert.ok(terrain(VALLEY_HALF - 5, 0) > terrain(0, 0) + 10 || terrain(0, VALLEY_HALF - 5) > terrain(0, 0) + 10);
  let steepest = 0;
  for (let x = -380; x <= 380; x += 10) for (let z = -380; z <= 380; z += 10) {
    const h = terrain(x, z);
    steepest = Math.max(steepest, Math.hypot(terrain(x + 1, z) - h, terrain(x, z + 1) - h));
  }
  assert.ok(steepest < 1.3, `steepest playable slope ${steepest.toFixed(2)}`);
});

test('drop points, loot and cars sit on dry land; there is enough of everything for a crowd', () => {
  const { world, terrain } = createValley();
  const lakes = world.water!.lakes;
  assert.ok(world.spawns.length >= 80, `${world.spawns.length} drop points`);
  for (const spawn of world.spawns) assert.ok(!inLake(spawn.x, spawn.z, lakes) && Math.abs(spawn.x) < 420 && Math.abs(spawn.z) < 420, 'a drop point is wet or too close to the rim');
  for (const spot of world.lootSpots) assert.ok(!inLake(spot.x, spot.z, lakes) && terrain(spot.x, spot.z) > 5, 'loot in a lake');
  for (const car of world.vehicleSpawns) assert.ok(!inLake(car.x, car.z, lakes), 'a car starts in a lake');
  const game = new GameSimulation({ seed: 5, botCount: 50, map: 'valley' });
  game.start();
  assert.ok(game.state.loot.length >= 300, `${game.state.loot.length} items for 51 players`);
  const roofs = game.world.obstacles.filter(o => o.kind === 'roof');
  const indoors = game.state.loot.filter(l => roofs.some(r => Math.abs(l.position.x - r.x) < r.width / 2 && Math.abs(l.position.z - r.z) < r.depth / 2)).length;
  assert.ok(indoors / game.state.loot.length > 0.5, `${indoors} of ${game.state.loot.length} items are indoors`);
  for (const kind of ['helmet1', 'vest1', 'rifle', 'medkit'] as const) assert.ok(game.state.loot.some(l => l.kind === kind), `no ${kind}`);
});

test('a valley match puts 51 people on distinct land spots, each with a sidearm and a vehicle fleet to use', () => {
  const game = new GameSimulation({ seed: 9, botCount: 50, map: 'valley' });
  game.start();
  assert.equal(game.state.actors.length, 51);
  assert.equal(new Set(game.state.actors.map(a => `${Math.round(a.position.x)},${Math.round(a.position.z)}`)).size, 51);
  for (const actor of game.state.actors) {
    assert.deepEqual(actor.ownedWeapons, ['pistol']);
    assert.equal(actor.position.y, game.heightAt(actor.position.x, actor.position.z));
  }
  assert.ok(game.state.vehicles.length >= 10);
  assert.equal(game.world.zone.start, 720);
});

test('the safe circle in the valley always closes in on dry ground', () => {
  const { terrain, world } = createValley();
  for (const seed of [1, 2, 3, 4]) {
    const game = new GameSimulation({ seed, botCount: 5, map: 'valley' });
    game.start();
    game.botsFrozen = true;
    game.player.health = 1e9;
    for (let t = 0; t < 420 && game.state.phase === 'playing'; t += 5) {
      game.update(5, idle);
      const z = game.state.zone;
      assert.ok(!inLake(z.nextCenter.x, z.nextCenter.z, world.water!.lakes) && terrain(z.nextCenter.x, z.nextCenter.z) > 5, `seed ${seed}: next circle over water at ${t}s`);
    }
  }
});

test('walking into a valley lake is blocked', () => {
  const { world, terrain } = createValley();
  const lake = world.water!.lakes[0];
  const game = new GameSimulation({ seed: 4, botCount: 1, map: 'valley' });
  game.start();
  game.botsFrozen = true;
  game.player.health = 1e9;
  const x = lake.x + lake.r * 1.4, z = lake.z;
  game.player.position = { x, y: terrain(x, z), z };
  for (let i = 0; i < 300; i++) {
    game.update(0.1, { moveX: -1, moveZ: 0, sprint: true, jump: false });
    const p = game.player.position;
    assert.ok(!(Math.hypot(p.x - lake.x, p.z - lake.z) < lake.r && terrain(p.x, p.z) < lake.level - 1.05), `entered deep water at step ${i}`);
  }
});

test('50 bots fight a whole valley match: heavy early action, steady thinning and a winner in about six minutes', () => {
  const game = new GameSimulation({ seed: 3, botCount: 50, map: 'valley', difficulty: 'normal' });
  game.start();
  game.player.health = 1e9;
  const alive: number[] = [];
  let botKills = 0;
  while (game.state.phase === 'playing' && game.state.elapsed < 600) {
    const z = game.state.zone, p = game.player.position, d = Math.hypot(z.center.x - p.x, z.center.z - p.z);
    game.update(0.1, { moveX: d > z.radius - 15 ? (z.center.x - p.x) / d : 0, moveZ: d > z.radius - 15 ? (z.center.z - p.z) / d : 0, sprint: false, jump: false });
    for (const event of game.drainEvents()) if (event.type === 'kill' && event.killerId) botKills++;
    if (game.state.elapsed >= (alive.length + 1) * 60) alive.push(game.state.actors.filter(a => a.alive).length);
  }
  assert.equal(game.state.phase, 'won');
  assert.ok(game.state.elapsed > 200 && game.state.elapsed < 480, `ended at ${game.state.elapsed.toFixed(0)}s`);
  assert.ok(alive[0] >= 15, `the opening is not an instant wipe (${alive[0]} alive at 1 min)`);
  for (let i = 1; i < alive.length; i++) assert.ok(alive[i] <= alive[i - 1], 'nobody respawns');
  assert.ok(botKills >= 25, `bots fought each other (${botKills} kills)`);
});

test('the valley stays cheap to simulate with 50 bots', () => {
  const game = new GameSimulation({ seed: 11, botCount: 50, map: 'valley' });
  game.start();
  game.player.health = 1e9;
  game.update(20, idle);
  const started = performance.now();
  for (let i = 0; i < 600; i++) game.update(1 / 60, idle);
  const average = (performance.now() - started) / 600;
  assert.ok(average < 6, `average ${average.toFixed(2)} ms per 60 Hz step`);
});

test('each match gets its own valley world object so mutations never leak between matches', () => {
  const a = createValleyWorld();
  a.obstacles.length = 0;
  assert.ok(createValleyWorld().obstacles.length > 500);
});
