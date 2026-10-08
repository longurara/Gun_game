import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIslandWorld } from '../src/game/world.ts';
import { GameSimulation } from '../src/game/simulation.ts';
import { clearsGrass, compoundGate, ISLAND_COMPOUNDS, routeCompoundRoads } from '../src/game/compounds.ts';
import type { CompoundKind, Vec2 } from '../src/types.ts';

const idle = { moveX: 0, moveZ: 0, sprint: false, jump: false };
const dist = (p: Vec2, a: Vec2, b: Vec2) => {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t);
};
function walk(game: GameSimulation, x: number, z: number, seconds = 25) {
  for (let i = 0; i < seconds * 30; i++) {
    const p = game.player.position, dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
    if (d < 0.3) return true;
    game.player.health = 100;
    game.update(1 / 30, { ...idle, moveX: dx / d, moveZ: dz / d });
  }
  return false;
}

test('the island reserves exactly four deterministic, large, distinct compounds with matching physics and loot', () => {
  const world = createIslandWorld(), again = createIslandWorld();
  assert.deepEqual(world.hotAreas, ISLAND_COMPOUNDS);
  assert.deepEqual(world.hotAreas, again.hotAreas);
  assert.notEqual(world.obstacles, again.obstacles);
  assert.deepEqual(new Set(world.hotAreas!.map(h => h.kind)), new Set(['temple', 'depot', 'garden', 'citadel']));
  for (const h of world.hotAreas!) {
    const modules = world.obstacles.filter(o => o.compoundStyle === h.kind);
    assert.ok(modules.length >= 50, `${h.name}: substantial playable modules`);
    assert.ok(modules.every(o => [o.x, o.z, o.base, o.width, o.depth, o.height].every(Number.isFinite)), h.name);
    assert.ok(modules.every(o => o.width > 0 && o.depth > 0 && o.height > (o.bottom ?? 0)), h.name);
    assert.ok(world.lootSpots.filter(l => Math.hypot(l.x - h.x, l.z - h.z) < h.radius && l.tier === 3).length >= 10, h.name);
    assert.ok(world.roads.some(r => Math.min(dist({ x: h.x - compoundGate(h.kind as CompoundKind), z: h.z }, r.a, r.b), dist({ x: h.x + compoundGate(h.kind as CompoundKind), z: h.z }, r.a, r.b)) < 1), h.name + ': road to gate');
    for (const o of modules) assert.ok(Math.abs(world.terrain!(o.x, o.z) - world.terrain!(h.x, h.z)) < 0.15, `${o.id}: level foundation`);
    assert.ok(world.portals!.some(p => p.id.startsWith('bunker-' + h.id)), h.name + ': bunker preserved');
  }
  assert.ok(world.obstacles.filter(o => o.compoundStyle).length < 1800, 'modules remain bounded');
});

test('all four citadel watchtowers, its main keep, and the depot terminal can be climbed to the roof', () => {
  const game = new GameSimulation({ seed: 11, botCount: 1, map: 'island' }); game.start(); game.botsFrozen = true;
  const floors = game.world.floors!;
  const starts = floors.filter(f => f.id.startsWith('compound-') && /-(?:watchtower|keep|terminal)-\d+-r0$/.test(f.id));
  assert.equal(starts.length, 6);
  for (const first of starts) {
    const prefix = first.id.replace(/-r0$/, '');
    const ramps = floors.filter(f => f.id.startsWith(prefix + '-r')).sort((a, b) => a.id.localeCompare(b.id));
    const direction = (f: typeof first) => {
      const sign = f.y1 > f.y0 ? 1 : -1, x = f.axis === 'x';
      return { dx: x ? sign : 0, dz: x ? 0 : sign, length: x ? f.width : f.depth };
    };
    const d = direction(first);
    game.player.position = { x: first.x - d.dx * (d.length / 2 - .5), z: first.z - d.dz * (d.length / 2 - .5), y: Math.min(first.y0, first.y1) }; game.player.air = null;
    for (const r of ramps) {
      const v = direction(r);
      assert.ok(walk(game, r.x - v.dx * (v.length / 2 - .5), r.z - v.dz * (v.length / 2 - .5)), r.id + ': landing');
      assert.ok(walk(game, r.x + v.dx * (v.length / 2 + 1.5), r.z + v.dz * (v.length / 2 + 1.5)), r.id + ': ascend');
      assert.ok(Math.abs(game.player.position.y - Math.max(r.y0, r.y1)) < .05, r.id + ': correct floor');
    }
  }
});

test('a player can cross both road gates in all four compounds without hitting a fence or building', () => {
  const game = new GameSimulation({ seed: 3, botCount: 1, map: 'island' }); game.start(); game.botsFrozen = true;
  for (const h of game.world.hotAreas!) {
    const gate = compoundGate(h.kind as CompoundKind);
    for (const side of [-1, 1]) {
      game.player.position = { x: h.x + side * (gate + 10), z: h.z, y: game.heightAt(h.x, h.z) };
      game.player.air = null;
      assert.ok(walk(game, h.x + side * (gate - 14), h.z), h.name + ': gate ' + side);
    }
  }
});

test('the ceremonial stairs reach the raised main hall, and the garden bridge can be crossed in both directions', () => {
  const game = new GameSimulation({ seed: 5, botCount: 1, map: 'island' }); game.start(); game.botsFrozen = true;
  const temple = game.world.hotAreas!.find(h => h.kind === 'temple')!, base = game.heightAt(temple.x, temple.z);
  game.player.position = { x: temple.x, z: temple.z + 14, y: base }; game.player.air = null;
  assert.ok(walk(game, temple.x, temple.z + 70), 'enter the main hall through its doorway');
  assert.ok(Math.abs(game.player.position.y - (base + 4)) < 0.05, 'on the upper terrace');
  assert.ok(walk(game, temple.x, temple.z + 14), 'descend the ceremonial stairs');
  const garden = game.world.hotAreas!.find(h => h.kind === 'garden')!;
  for (const side of [-1, 1]) {
    game.player.position = { x: garden.x, z: garden.z + (side < 0 ? -6 : 66), y: game.heightAt(garden.x, garden.z) }; game.player.air = null;
    assert.ok(walk(game, garden.x, garden.z + 30), 'walk up onto bridge ' + side);
    assert.ok(Math.abs(game.player.position.y - (game.heightAt(garden.x, garden.z) + 3.6)) < 0.05);
    assert.ok(walk(game, garden.x, garden.z + (side < 0 ? 66 : -6)), 'walk off bridge ' + side);
  }
});

test('all generated roads avoid compound walls, and detours preserve a gate approach', () => {
  const world = createIslandWorld();
  for (const o of world.obstacles.filter(o => o.compoundStyle && !['roof', 'floor', 'tree'].includes(o.kind))) {
    for (const r of world.roads) assert.ok(dist(o, r.a, r.b) > Math.min(o.width, o.depth) / 2 + r.width / 2 - 0.2, `${o.id}: road crosses a solid`);
  }
  const routed = routeCompoundRoads([{ a: { x: -400, z: 0 }, b: { x: 400, z: 0 }, width: 7 }], [{ ...ISLAND_COMPOUNDS[0], x: 0, z: 0 }]);
  assert.ok(routed.length >= 3); assert.deepEqual(routed[0].a, { x: -400, z: 0 }); assert.deepEqual(routed.at(-1)!.b, { x: 400, z: 0 });
  assert.ok(routed.every(r => dist({ x: 0, z: 0 }, r.a, r.b) >= 144));
});

test('forest trunks never grow through the stair flights of wilderness towers', () => {
  const w = createIslandWorld();
  const ramps = w.floors!.filter(f => f.id.startsWith('tower-') && f.y0 !== f.y1);
  assert.ok(ramps.length >= 3);
  for (const t of w.obstacles.filter(o => o.kind === 'tree' && !o.compoundStyle)) for (const r of ramps) {
    assert.ok(Math.abs(t.x - r.x) > (t.width + r.width) / 2 || Math.abs(t.z - r.z) > (t.depth + r.depth) / 2, t.id + ': stairwell clear');
  }
});

test('the lane between both gates of every compound is free of ground-level solids and stair flights', () => {
  const world = createIslandWorld();
  for (const h of world.hotAreas!) {
    const gate = compoundGate(h.kind as CompoundKind), ground = world.terrain!(h.x, h.z);
    for (const o of world.obstacles.filter(o => o.compoundStyle === h.kind && o.kind !== 'floor')) {
      if ((o.base ?? 0) + (o.bottom ?? 0) > ground + 2.5) continue;
      const onLane = Math.abs(o.x - h.x) < gate + o.width / 2 && Math.abs(o.z - h.z) < 3.5 + o.depth / 2;
      assert.ok(!onLane, `${o.id} blocks the gate lane of ${h.name}`);
    }
    // Vehicles ignore stair surfaces and would drive through the drawn steps.
    for (const f of world.floors!.filter(f => f.id.startsWith(h.id + '-') && f.y0 !== f.y1)) {
      const onLane = Math.abs(f.x - h.x) < gate + f.width / 2 && Math.abs(f.z - h.z) < 3.5 + f.depth / 2;
      assert.ok(!onLane, `${f.id} crosses the gate lane of ${h.name}`);
    }
  }
});

test('both citadel wall walks can be walked end to end at full height', () => {
  const game = new GameSimulation({ seed: 7, botCount: 1, map: 'island' }); game.start(); game.botsFrozen = true;
  const citadel = game.world.hotAreas!.find(h => h.kind === 'citadel')!, ground = game.heightAt(citadel.x, citadel.z);
  for (const x of [citadel.x - 100, citadel.x + 100]) {
    game.player.position = { x, z: citadel.z + 11, y: ground }; game.player.air = null;
    assert.ok(walk(game, x, citadel.z + 40), 'climb the wall stairs');
    assert.ok(Math.abs(game.player.position.y - (ground + 4.4)) < 0.05, 'on the wall walk');
    assert.ok(walk(game, x, citadel.z + 92), 'walk to the north end');
    assert.ok(Math.abs(game.player.position.y - (ground + 4.4)) < 0.05, 'still on the wall walk');
  }
});

test('courtyard decorations never stand inside a hall', () => {
  const world = createIslandWorld();
  const halls = world.obstacles.filter(o => o.compoundStyle && o.id.includes('-hall-floor-'));
  assert.equal(halls.length, 7);
  for (const o of world.obstacles.filter(o => /-(?:stone-lantern|cherry-tree|garden-rock|bamboo)-/.test(o.id))) for (const hall of halls) {
    assert.ok(Math.abs(o.x - hall.x) >= (o.width + hall.width) / 2 || Math.abs(o.z - hall.z) >= (o.depth + hall.depth) / 2, `${o.id} is inside ${hall.id}`);
  }
});

test('grass is cleared from paved compounds but still grows in the garden and around base or factory compounds', () => {
  assert.deepEqual(['temple', 'depot', 'garden', 'citadel', 'base', 'factory'].map(k => clearsGrass(k as CompoundKind)), [true, true, false, true, false, false]);
});
