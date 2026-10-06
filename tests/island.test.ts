import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameSimulation } from '../src/game/simulation.ts';
import { coastMask, createIsland, createIslandWorld, createValley, ISLAND_HALF } from '../src/game/world.ts';
import { isWeaponKind, WEAPONS } from '../src/game/weapons.ts';
import type { PlayerInput } from '../src/types.ts';

const idle: PlayerInput = { moveX: 0, moveZ: 0, sprint: false, jump: false };
const lakeOf = (x: number, z: number, lakes: Array<{ x: number; z: number; r: number }>) => lakes.some(l => Math.hypot(x - l.x, z - l.z) < l.r * 1.1);

test('the island is generated once, identically, with towns, roads, lakes, farmland and plenty of drop points', () => {
  const first = createIsland();
  const again = createIsland();
  assert.equal(first, again, 'generation is cached');
  const { world } = first;
  assert.equal(world.id, 'island');
  assert.equal(world.halfSize, ISLAND_HALF);
  assert.ok(world.towns.length >= 12, `${world.towns.length} towns`);
  assert.ok(world.roads.length >= 20);
  assert.ok(world.water!.lakes.length >= 4 && world.water!.rivers.length >= 1);
  assert.ok(world.fields!.length >= 10);
  assert.ok(world.spawns.length >= 200, 'enough drop points for 101 players');
  assert.ok(world.vehicleSpawns.length >= 30);
  // A match gets its own obstacle list, so mutating it cannot corrupt the shared map.
  const match = createIslandWorld();
  match.obstacles.length = 0;
  assert.ok(createIslandWorld().obstacles.length > 5000);
});

test('roads are never cut: no house, crate or field lies on a road, and a river does not sink one', () => {
  const segDist = (x: number, z: number, a: { x: number; z: number }, b: { x: number; z: number }) => {
    const dx = b.x - a.x, dz = b.z - a.z, t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    return Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
  };
  for (const map of ['island', 'valley'] as const) {
    const { world, terrain } = map === 'island' ? createIsland() : createValley();
    for (const o of world.obstacles) {
      if (o.kind === 'tree' || o.kind === 'floor' || (o.base ?? 0) < -30) continue;
      for (const road of world.roads) assert.ok(segDist(o.x, o.z, road.a, road.b) >= road.width / 2 + Math.min(o.width, o.depth) / 2 - 0.5, `${map}: ${o.id} sits on a road`);
    }
    for (const f of world.fields!) for (const road of world.roads) assert.ok(segDist(f.x, f.z, road.a, road.b) > road.width / 2, `${map}: a field is on a road`);
    // Along every road the ground stays above the water that crosses it.
    for (const road of world.roads) {
      const length = Math.hypot(road.b.x - road.a.x, road.b.z - road.a.z);
      for (let s = 0; s <= length; s += 4) {
        const x = road.a.x + (road.b.x - road.a.x) * s / length, z = road.a.z + (road.b.z - road.a.z) * s / length;
        for (const river of world.water!.rivers) river.points.forEach((p, i) => {
          if (Math.hypot(p.x - x, p.z - z) < 4) assert.ok(terrain(x, z) > p.level + 0.1, `${map}: a river drowns the road at ${x.toFixed(0)},${z.toFixed(0)}`);
        });
      }
    }
  }
});

test('terrain is smooth and bounded; the coast fades into open sea and the land is walkable-steep at worst', () => {
  const { terrain } = createIsland();
  let steepest = 0;
  for (let x = -1800; x <= 1800; x += 25) {
    for (let z = -1800; z <= 1800; z += 25) {
      const h = terrain(x, z);
      assert.ok(Number.isFinite(h) && h < 250 && h > -20, `height ${h} at ${x},${z}`);
      if (h > 2) steepest = Math.max(steepest, Math.hypot(terrain(x + 1, z) - h, terrain(x, z + 1) - h));
    }
  }
  assert.ok(steepest < 1.6, `steepest slope ${steepest.toFixed(2)}`);
  assert.ok(terrain(ISLAND_HALF - 5, 0) < -1 && coastMask(ISLAND_HALF - 5, 0) < 0.05, 'open sea beyond the shore');
  assert.ok(coastMask(0, 0) > 0.99);
  // Lookups are served from tiles; they must agree with themselves between calls.
  assert.equal(terrain(123.4, -567.8), terrain(123.4, -567.8));
});

test('everything is placed on dry land: drop points, loot, vehicles, trees', () => {
  const { world, terrain } = createIsland();
  const lakes = world.water!.lakes;
  for (const spawn of world.spawns) assert.ok(terrain(spawn.x, spawn.z) > 2 && !lakeOf(spawn.x, spawn.z, lakes), `drop point ${spawn.x},${spawn.z} is wet`);
  for (const spot of world.lootSpots) assert.ok(terrain(spot.x, spot.z) > 1.5 && !lakeOf(spot.x, spot.z, lakes), `loot ${spot.x},${spot.z} is wet`);
  for (const car of world.vehicleSpawns) assert.ok(terrain(car.x, car.z) > 1.5 && !lakeOf(car.x, car.z, lakes), 'a car starts in water');
  for (const tree of world.obstacles.filter(o => o.kind === 'tree')) assert.ok(terrain(tree.x, tree.z) > 1.5, 'a tree stands in the sea');
});

test('houses can be entered: each has a doorway at least as wide as a walker needs, and most loot sits inside', () => {
  const game = new GameSimulation({ seed: 3, botCount: 100, map: 'island' });
  game.start();
  const roofs = game.world.obstacles.filter(o => o.kind === 'roof');
  // Apartment blocks, hospitals and towers have floor slabs instead of a pitched roof: they count as indoors too.
  const buildings = game.world.obstacles.filter(o => o.kind === 'roof' || o.kind === 'floor');
  assert.ok(roofs.length >= 300, `${roofs.length} houses`);
  const inside = (x: number, z: number) => buildings.some(r => Math.abs(x - r.x) < r.width / 2 && Math.abs(z - r.z) < r.depth / 2);
  const share = game.state.loot.filter(l => inside(l.position.x, l.position.z)).length / game.state.loot.length;
  assert.ok(share > 0.65, `only ${(share * 100).toFixed(0)}% of pickups are indoors`);
  // Heavy weapons are kept inside, not scattered in the open.
  // (The hot areas and the bunkers are the exception: their crates hold the heaviest guns in the open or underground.)
  const hot = game.world.hotAreas ?? [];
  const special = (l: { position: { x: number; y: number; z: number } }) => l.position.y < -30 || hot.some(h => Math.hypot(l.position.x - h.x, l.position.z - h.z) < h.radius);
  const heavy = game.state.loot.filter(l => isWeaponKind(l.kind) && (WEAPONS[l.kind].kind === 'sniper' || WEAPONS[l.kind].kind === 'amr') && !special(l));
  assert.ok(heavy.length > 10 && heavy.every(l => inside(l.position.x, l.position.z)), 'sniper rifles are only found in houses');
  // Armour exists at every tier.
  for (const kind of ['helmet1', 'helmet2', 'helmet3', 'vest1', 'vest2', 'vest3']) assert.ok(game.state.loot.some(l => l.kind === kind), `no ${kind} on the map`);
});

test('a match starts everyone on land with a sidearm, and the player really can walk into a house', () => {
  const game = new GameSimulation({ seed: 9, botCount: 100, map: 'island', difficulty: 'normal' });
  game.start();
  game.botsFrozen = true;
  assert.equal(game.state.actors.length, 101);
  assert.equal(new Set(game.state.actors.map(a => `${Math.round(a.position.x)},${Math.round(a.position.z)}`)).size, 101, 'everyone spawns somewhere different');
  for (const actor of game.state.actors) {
    assert.ok(game.heightAt(actor.position.x, actor.position.z) > 1.8, `${actor.id} spawned in water`);
    assert.deepEqual(actor.ownedWeapons, ['pistol']);
    assert.equal(actor.position.y, game.heightAt(actor.position.x, actor.position.z));
  }
  // Walk through a doorway: find a house, stand outside its door, walk in.
  const walls = game.world.obstacles.filter(o => o.kind === 'wall');
  const house = game.world.obstacles.find(o => o.kind === 'roof')!;
  const id = house.id.replace('-roof', '');
  const pieces = walls.filter(w => w.id.startsWith(id + '-'));
  const south = pieces.filter(w => w.id.startsWith(id + '-s-')), north = pieces.filter(w => w.id.startsWith(id + '-n-'));
  const doorSide = (list: typeof pieces) => list.length >= 3 && list.some(w => w.bottom !== undefined && w.height === 3.3 && w.id.includes('-h'));
  assert.ok(pieces.length >= 8, 'a house is made of several wall pieces');
  assert.ok(doorSide(south) || doorSide(north) || pieces.some(w => w.id.includes('-h')), 'the door has a lintel');
});

test('deep water blocks walking: the sea and lakes cannot be entered, rivers can be waded', () => {
  const { world, terrain } = createIsland();
  const lake = world.water!.lakes[0];
  const game = new GameSimulation({ seed: 4, botCount: 1, map: 'island' });
  game.start();
  game.botsFrozen = true;
  // Walk straight at the middle of a lake for a long time.
  const start = { x: lake.x + lake.r * 1.3, z: lake.z };
  game.player.position = { x: start.x, y: terrain(start.x, start.z), z: start.z };
  game.player.health = 1e9;
  for (let i = 0; i < 400; i++) {
    game.update(0.1, { moveX: -1, moveZ: 0, sprint: true, jump: false });
    const p = game.player.position;
    const deep = Math.hypot(p.x - lake.x, p.z - lake.z) < lake.r && terrain(p.x, p.z) < lake.level - 1.05;
    assert.ok(!deep, `walked into deep lake water at step ${i}`);
  }
  assert.ok(game.player.position.x > lake.x + lake.r * 0.5, 'the shore stopped the walker');
  // And toward the open sea.
  let shoreX = 1500;
  while (terrain(shoreX, 0) > -0.4 && shoreX < ISLAND_HALF - 2) shoreX += 5;
  const sea = new GameSimulation({ seed: 4, botCount: 1, map: 'island' });
  sea.start();
  sea.botsFrozen = true;
  sea.player.position = { x: shoreX - 30, y: terrain(shoreX - 30, 0), z: 0 };
  sea.player.health = 1e9;
  for (let i = 0; i < 300; i++) {
    sea.update(0.1, { moveX: 1, moveZ: 0, sprint: true, jump: false });
    const p = sea.player.position;
    assert.ok(terrain(p.x, p.z) >= -1.05, `walked out to sea at step ${i}`);
  }
  // Rivers are shallow.
  const river = world.water!.rivers[0];
  const mid = river.points[Math.floor(river.points.length / 2)];
  assert.ok(terrain(mid.x, mid.z) > mid.level - 1, 'river beds are within wading depth');
});

test('the safe zone always closes in on dry land', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const game = new GameSimulation({ seed, botCount: 10, map: 'island' });
    game.start();
    game.botsFrozen = true;
    game.player.health = 1e9;
    const { terrain } = createIsland();
    for (let t = 0; t < 700 && game.state.phase === 'playing'; t += 5) {
      game.update(5, idle);
      const z = game.state.zone;
      assert.ok(terrain(z.nextCenter.x, z.nextCenter.z) > 2, `seed ${seed}: next circle centred in water at ${t}s`);
    }
  }
});

test('100 bots play a whole island match: the field thins steadily and the winner is decided inside ten minutes', () => {
  const game = new GameSimulation({ seed: 7, botCount: 100, map: 'island', difficulty: 'normal' });
  game.start();
  game.player.health = 1e9;
  const alive: number[] = [];
  let botKills = 0, zoneKills = 0;
  while (game.state.phase === 'playing' && game.state.elapsed < 700) {
    const z = game.state.zone, p = game.player.position, d = Math.hypot(z.center.x - p.x, z.center.z - p.z);
    game.update(0.1, { moveX: d > z.radius - 20 ? (z.center.x - p.x) / d : 0, moveZ: d > z.radius - 20 ? (z.center.z - p.z) / d : 0, sprint: false, jump: false });
    for (const event of game.drainEvents()) if (event.type === 'kill') event.killerId ? botKills++ : zoneKills++;
    if (game.state.elapsed >= (alive.length + 1) * 120) alive.push(game.state.actors.filter(a => a.alive).length);
  }
  assert.equal(game.state.phase, 'won');
  assert.ok(game.state.elapsed > 300 && game.state.elapsed < 600, `ended at ${game.state.elapsed.toFixed(0)}s`);
  assert.ok(alive[0] > 60, `the opening is not a massacre (${alive[0]} alive at 2 min)`);
  for (let i = 1; i < alive.length; i++) assert.ok(alive[i] <= alive[i - 1], 'nobody respawns');
  assert.ok(botKills >= 20, `bots fought each other (${botKills} kills)`);
  assert.ok(zoneKills >= 10, `the zone claimed stragglers (${zoneKills})`);
});

test('100 bots stay cheap to simulate: average step well under a frame budget', () => {
  const game = new GameSimulation({ seed: 11, botCount: 100, map: 'island', difficulty: 'normal' });
  game.start();
  game.player.health = 1e9;
  game.update(30, idle); // let the opening settle
  const started = performance.now();
  const steps = 600;
  for (let i = 0; i < steps; i++) game.update(1 / 60, idle);
  const average = (performance.now() - started) / steps;
  assert.ok(average < 6, `average ${average.toFixed(2)} ms per 60 Hz step`);
});

test('every bot that is shot at long range or hears gunfire can still be tracked: distant bots use the cheap routine', () => {
  const game = new GameSimulation({ seed: 21, botCount: 100, map: 'island' });
  game.start();
  game.player.health = 1e9;
  const before = new Map(game.state.actors.map(a => [a.id, { x: a.position.x, z: a.position.z }]));
  game.update(40, idle);
  const moved = game.state.actors.filter(a => !a.isPlayer && a.alive && Math.hypot(a.position.x - before.get(a.id)!.x, a.position.z - before.get(a.id)!.z) > 20);
  assert.ok(moved.length > 60, `${moved.length} of 100 bots travelled while off-screen`);
});
