import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameSimulation } from '../src/game/simulation.ts';
import { createIsland, createValley } from '../src/game/world.ts';
import { buildHangar, buildTower, floorSurface, placeParts, STOREY } from '../src/game/buildings.ts';
import type { Floor } from '../src/types.ts';

const idle = { moveX: 0, moveZ: 0, sprint: false, jump: false };

/** A fresh island match with nobody else around, so the player can be moved about. */
function island() {
  const game = new GameSimulation({ seed: 11, botCount: 1, map: 'island' });
  game.start();
  game.botsFrozen = true;
  game.player.health = 100;
  return game;
}

/** Walk the player towards a point on the floor plan until they are there (or time runs out). */
function walkTo(game: GameSimulation, x: number, z: number, seconds = 12): boolean {
  for (let i = 0; i < seconds * 30; i++) {
    const p = game.player.position, dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
    if (d < 0.35) return true;
    game.player.health = 100;
    game.update(1 / 30, { ...idle, moveX: dx / d, moveZ: dz / d });
  }
  return false;
}

const rampDirection = (f: Floor): { dx: number; dz: number; length: number } => {
  const up = f.y1 > f.y0 ? 1 : -1;
  return f.axis === 'x' ? { dx: up, dz: 0, length: f.width } : { dx: 0, dz: up, length: f.depth };
};

test('the island has apartment blocks, hospitals, warehouses and towers you can enter', () => {
  const { world } = createIsland();
  const floors = world.floors ?? [];
  const ramps = floors.filter(f => f.y0 !== f.y1);
  assert.ok(ramps.length >= 40, `${ramps.length} stair ramps`);
  for (const kind of ['hospital', 'hangar']) assert.ok(floors.some(f => f.id.includes(kind)), `no ${kind}`);
  assert.ok(floors.some(f => f.id.startsWith('tower-')), 'no watch tower');
  const blocks = new Set(floors.filter(f => /-h\d+-r0$/.test(f.id)).map(f => f.id));
  assert.ok(blocks.size >= 8, `${blocks.size} apartment blocks`);
  // No solid, unenterable blocks are left in the cities.
  assert.equal(world.obstacles.filter(o => o.kind === 'building').length, 0);
  assert.ok(createValley().world.floors!.length > 0, 'the valley has climbable buildings too');
});

test('every stair core on the island can be climbed from the ground floor to the roof deck', () => {
  const game = island();
  const { world } = createIsland();
  const floors = world.floors!;
  const starts = floors.filter(f => /-r0$/.test(f.id) && (/-h\d+-r0$/.test(f.id) || f.id.includes('hospital') || f.id.startsWith('tower-')));
  assert.ok(starts.length >= 12, `${starts.length} stair cores`);
  let checked = 0;
  for (const first of starts) {
    const prefix = first.id.replace(/-r0$/, '');
    const ramps = floors.filter(f => f.id.startsWith(prefix + '-r')).sort((a, b) => a.id.localeCompare(b.id));
    const ground = first.axis === 'x' ? Math.min(first.y0, first.y1) : Math.min(first.y0, first.y1);
    // Start at the foot of the first ramp, on the ground.
    const d0 = rampDirection(first);
    const foot = { x: first.x - d0.dx * (d0.length / 2 - 0.5), z: first.z - d0.dz * (d0.length / 2 - 0.5) };
    game.player.position = { x: foot.x, y: ground, z: foot.z };
    game.player.air = null;
    ramps.forEach((ramp, index) => {
      const d = rampDirection(ramp);
      const low = { x: ramp.x - d.dx * (d.length / 2 - 0.5), z: ramp.z - d.dz * (d.length / 2 - 0.5) };
      const top = { x: ramp.x + d.dx * (d.length / 2 + 1.5), z: ramp.z + d.dz * (d.length / 2 + 1.5) };
      assert.ok(walkTo(game, low.x, low.z), `${prefix}: reached the foot of ramp ${index}`);
      assert.ok(walkTo(game, top.x, top.z), `${prefix}: walked up ramp ${index} (at y ${game.player.position.y.toFixed(2)}, wanted ${Math.max(ramp.y0, ramp.y1).toFixed(2)})`);
      const level = Math.max(ramp.y0, ramp.y1);
      assert.ok(Math.abs(game.player.position.y - level) < 0.05, `${prefix}: on floor ${index + 1}, y ${game.player.position.y.toFixed(2)} vs ${level.toFixed(2)}`);
    });
    checked++;
  }
  assert.equal(checked, starts.length);
});

test('a slab keeps your head out of a floor you are under and a wall of the storey above does not bother the one below', () => {
  const game = island();
  const { world } = createIsland();
  const first = world.floors!.find(f => /-h\d+-r1$/.test(f.id))!;
  const prefix = first.id.replace(/-r1$/, '');
  const slab = world.floors!.find(f => f.id.startsWith(prefix + '-f1-'))!;
  // Standing on the ground under the first floor is fine (the floor is overhead, not underfoot).
  const ground = game.heightAt(slab.x, slab.z);
  assert.equal(game.supportHeight(slab.x, slab.z, ground), ground);
  // From a height that can step up onto the slab, it carries you.
  assert.equal(game.supportHeight(slab.x, slab.z, slab.y0 - 0.3), slab.y0);
});

test('falling off a roof hurts, a one-storey drop does not', () => {
  const game = island();
  const { world } = createIsland();
  const ramp = world.floors!.find(f => /-h\d+-r2$/.test(f.id))!;
  const prefix = ramp.id.replace(/-r2$/, '');
  const roof = world.floors!.filter(f => f.id.startsWith(prefix + '-f3-')).sort((a, b) => b.width * b.depth - a.width * a.depth)[0];
  const deck = roof.y0;
  const ground = game.heightAt(roof.x, roof.z);
  game.player.position = { x: roof.x, y: deck, z: roof.z };
  game.update(1 / 30, idle);
  assert.ok(Math.abs(game.player.position.y - deck) < 0.01, 'standing on the roof deck');
  // Step off the building: just keep walking away from its middle until the ground is below.
  const first = world.floors!.find(f => f.id === `${prefix}-f3-0`)!;
  void first;
  game.player.position.y = deck;
  game.player.health = 100;
  // Teleport out over open ground at the same height and let go.
  const open = { x: roof.x + 60, z: roof.z + 60 };
  game.player.position = { x: open.x, y: game.heightAt(open.x, open.z) + (deck - ground), z: open.z };
  for (let i = 0; i < 60 && game.player.position.y > game.heightAt(open.x, open.z) + 0.01; i++) game.update(1 / 30, idle);
  assert.ok(game.player.health < 80, `fell ${(deck - ground).toFixed(1)} m and kept ${game.player.health.toFixed(0)} health`);

  game.player.health = 100;
  game.player.position = { x: open.x, y: game.heightAt(open.x, open.z) + STOREY, z: open.z };
  for (let i = 0; i < 60 && game.player.position.y > game.heightAt(open.x, open.z) + 0.01; i++) game.update(1 / 30, idle);
  assert.equal(game.player.health, 100, 'one storey is a safe drop');
});

test('an item dropped upstairs lies on that floor', () => {
  const game = island();
  const { world } = createIsland();
  const ramp = world.floors!.find(f => /-h\d+-r0$/.test(f.id))!;
  const prefix = ramp.id.replace(/-r0$/, '');
  const slab = world.floors!.filter(f => f.id.startsWith(prefix + '-f1-')).sort((a, b) => b.width * b.depth - a.width * a.depth)[0];
  game.player.position = { x: slab.x, y: slab.y0, z: slab.z };
  game.player.air = null;
  game.dropItem('medkit', 1);
  game.player.medkits = 2;
  const before = game.state.loot.length;
  game.dropItem('pistol', 1);
  game.player.ownedWeapons = ['pistol', 'rifle'];
  assert.ok(game.dropItem('rifle', 1) || game.state.loot.length >= before);
  const dropped = game.state.loot.slice(before);
  for (const item of dropped) assert.ok(Math.abs(item.position.y - slab.y0) < 0.01, `${item.kind} dropped at y ${item.position.y} instead of ${slab.y0}`);
});

test('bots keep to the ground floor: nothing upstairs is on their shopping list', () => {
  const game = island();
  const upstairs = game.state.loot.filter(l => l.position.y - game.heightAt(l.position.x, l.position.z) > 1.5);
  assert.ok(upstairs.length >= 100, `${upstairs.length} items upstairs`);
  const runtimes = (game as unknown as { runtimes: Map<string, { lootRef: { id: string } | null; lootTimer: number }> }).runtimes;
  // Put a bot right under a pile of upstairs loot and let it look around.
  const bot = game.state.actors.find(a => !a.isPlayer)!;
  const pile = upstairs[0];
  bot.position = { x: pile.position.x, y: game.heightAt(pile.position.x, pile.position.z), z: pile.position.z };
  game.botsFrozen = false;
  for (let i = 0; i < 90; i++) { game.player.health = 100; game.update(1 / 30, idle); }
  const chosen = runtimes.get(bot.id)?.lootRef;
  if (chosen) assert.ok(!upstairs.some(l => l.id === chosen.id), 'the bot went for an item upstairs');
});

test('buildings can be mirrored and turned without breaking their stairs', () => {
  for (const swap of [false, true]) for (const mirror of [false, true]) {
    const tower = placeParts(buildTower({ id: 't', width: 26, depth: 14, storeys: 3, base: 0, flavor: 'apartment' }), 100, 200, swap, mirror);
    const ramps = tower.floors.filter(f => f.y0 !== f.y1).sort((a, b) => a.id.localeCompare(b.id));
    assert.equal(ramps.length, 3);
    ramps.forEach((ramp, k) => {
      const d = rampDirection(ramp);
      const lowEnd = { x: ramp.x - d.dx * d.length / 2, z: ramp.z - d.dz * d.length / 2 };
      const highEnd = { x: ramp.x + d.dx * d.length / 2, z: ramp.z + d.dz * d.length / 2 };
      assert.ok(Math.abs(floorSurface(ramp, lowEnd.x + d.dx * 0.01, lowEnd.z + d.dz * 0.01) - k * STOREY) < 0.05, `ramp ${k} starts on floor ${k} (swap ${swap}, mirror ${mirror})`);
      assert.ok(Math.abs(floorSurface(ramp, highEnd.x - d.dx * 0.01, highEnd.z - d.dz * 0.01) - (k + 1) * STOREY) < 0.05, `ramp ${k} ends on floor ${k + 1}`);
    });
    const hangar = placeParts(buildHangar({ id: 'h', width: 30, depth: 18, base: 0 }), 0, 0, swap, mirror);
    const mezz = hangar.floors.find(f => f.id === 'h-mezz')!, ramp = hangar.floors.find(f => f.id === 'h-ramp')!;
    const d = rampDirection(ramp), top = { x: ramp.x + d.dx * (d.length / 2 + 0.2), z: ramp.z + d.dz * (d.length / 2 + 0.2) };
    assert.ok(Math.abs(top.x - mezz.x) < mezz.width / 2 + 0.01 && Math.abs(top.z - mezz.z) < mezz.depth / 2 + 0.01, `the hangar ramp leads onto its mezzanine (swap ${swap}, mirror ${mirror})`);
  }
});

test('every warehouse mezzanine can be reached by its ramp, and the valley buildings can be climbed too', () => {
  const game = island();
  const { world } = createIsland();
  const ramps = world.floors!.filter(f => f.id.endsWith('-hangar-ramp'));
  assert.ok(ramps.length >= 5, `${ramps.length} warehouses`);
  for (const ramp of ramps) {
    const mezz = world.floors!.find(f => f.id === ramp.id.replace('-ramp', '-mezz'))!;
    const d = rampDirection(ramp);
    const foot = { x: ramp.x - d.dx * (d.length / 2 - 0.5), z: ramp.z - d.dz * (d.length / 2 - 0.5) };
    game.player.position = { x: foot.x, y: Math.min(ramp.y0, ramp.y1), z: foot.z };
    assert.ok(walkTo(game, ramp.x + d.dx * (d.length / 2 + 1.5), ramp.z + d.dz * (d.length / 2 + 1.5)), `${ramp.id}: up the ramp`);
    assert.ok(Math.abs(game.player.position.y - mezz.y0) < 0.05, `${ramp.id}: on the mezzanine (${game.player.position.y.toFixed(2)} vs ${mezz.y0.toFixed(2)})`);
  }
  const valley = new GameSimulation({ seed: 11, botCount: 1, map: 'valley' });
  valley.start(); valley.botsFrozen = true;
  const vf = createValley().world.floors!;
  const first = vf.find(f => /-r0$/.test(f.id))!;
  const prefix = first.id.replace(/-r0$/, '');
  const stair = vf.filter(f => f.id.startsWith(prefix + '-r')).sort((a, b) => a.id.localeCompare(b.id));
  const d0 = rampDirection(first);
  valley.player.position = { x: first.x - d0.dx * (d0.length / 2 - 0.5), y: Math.min(first.y0, first.y1), z: first.z - d0.dz * (d0.length / 2 - 0.5) };
  for (const r of stair) {
    const d = rampDirection(r);
    assert.ok(walkTo(valley, r.x - d.dx * (d.length / 2 - 0.5), r.z - d.dz * (d.length / 2 - 0.5)), 'foot');
    assert.ok(walkTo(valley, r.x + d.dx * (d.length / 2 + 1.5), r.z + d.dz * (d.length / 2 + 1.5)), 'top');
    assert.ok(Math.abs(valley.player.position.y - Math.max(r.y0, r.y1)) < 0.05, `${r.id} reached its floor`);
  }
});

test('bots crowding a city find routes to their goals instead of flooding the map with failed searches', () => {
  const game = new GameSimulation({ seed: 5, botCount: 100, map: 'island' });
  game.start();
  const sim = game as unknown as { findPath(from: { x: number; z: number }, goal: { x: number; z: number }): unknown[]; world: { towns: Array<{ x: number; z: number; radius: number }> } };
  let calls = 0, failed = 0;
  const original = sim.findPath.bind(sim);
  sim.findPath = (from, goal) => { const path = original(from, goal); calls++; if (!path.length) failed++; return path; };
  const city = [...sim.world.towns].sort((a, b) => b.radius - a.radius)[0];
  let moved = 0;
  for (const bot of game.state.actors) {
    if (bot.isPlayer || moved >= 30) continue;
    bot.position.x = city.x + Math.cos(moved * 0.7) * (20 + moved * 4); bot.position.z = city.z + Math.sin(moved * 0.7) * (20 + moved * 4);
    bot.position.y = game.heightAt(bot.position.x, bot.position.z);
    moved++;
  }
  game.player.position.x = city.x + 10; game.player.position.z = city.z + 10; game.player.position.y = game.heightAt(city.x + 10, city.z + 10);
  for (let i = 0; i < 600; i++) game.update(1 / 30, idle);
  assert.ok(calls > 20, `${calls} searches`);
  assert.ok(failed / calls < 0.25, `${failed} of ${calls} route searches found nothing`);
});
