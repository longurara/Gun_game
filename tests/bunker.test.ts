import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameSimulation } from '../src/game/simulation.ts';
import { createMapWorld, mapData, OPEN_MAPS } from '../src/game/world.ts';
import { BUNKER_Y, DEEP } from '../src/game/underground.ts';
import type { MapId, Portal, WorldConfig } from '../src/types.ts';

const idle = { moveX: 0, moveZ: 0, sprint: false, jump: false };
const HOT_MAPS: MapId[] = ['island', 'desert', 'pines', 'metro'];

type Walker = { walkable(p: { x: number; z: number }, padding?: number, standing?: number, height?: number): boolean };

test('every big map but the valley has hot areas with a bunker beneath them, and the valley is left as it was', () => {
  for (const id of HOT_MAPS) {
    const w = createMapWorld(id)!;
    assert.ok((w.hotAreas?.length ?? 0) >= 2, `${id}: hot areas`);
    assert.ok((w.portals?.length ?? 0) >= 12 && w.portals!.length % 2 === 0, `${id}: stairs come in pairs`);
    assert.ok(w.obstacles.some(o => (o.base ?? 0) <= BUNKER_Y), `${id}: there is something underground`);
  }
  const valley = createMapWorld('valley')!;
  assert.equal(valley.portals, undefined);
  assert.equal(valley.hotAreas, undefined);
  assert.deepEqual([...OPEN_MAPS].sort(), ['desert', 'island', 'metro', 'pines', 'valley']);
});

test('hot areas keep clear of towns and of each other, and stand on level ground inside the map', () => {
  for (const id of HOT_MAPS) {
    const w = createMapWorld(id)!, hots = w.hotAreas!;
    for (const [i, h] of hots.entries()) {
      assert.ok(Math.max(Math.abs(h.x), Math.abs(h.z)) + h.radius < w.halfSize, `${id}: ${h.name} hangs off the map`);
      for (const t of w.towns) assert.ok(Math.hypot(h.x - t.x, h.z - t.z) > h.radius + t.radius, `${id}: ${h.name} overlaps ${t.name}`);
      for (const o of hots.slice(i + 1)) assert.ok(Math.hypot(h.x - o.x, h.z - o.z) > h.radius + o.radius, `${id}: ${h.name} overlaps ${o.name}`);
    }
  }
});

test('hot areas and bunkers are generated the same every time', () => {
  for (const id of HOT_MAPS) {
    const a = createMapWorld(id)!, b = createMapWorld(id)!;
    assert.deepEqual(a.hotAreas, b.hotAreas);
    assert.deepEqual(a.portals, b.portals);
    assert.equal(a.obstacles.length, b.obstacles.length);
    assert.equal(a.lootSpots.length, b.lootSpots.length);
    assert.equal(mapData(id), mapData(id));
  }
});

test('the best loot is in the hot areas and the bunkers', () => {
  for (const id of HOT_MAPS) {
    const w = createMapWorld(id)!;
    const under = w.lootSpots.filter(s => s.y !== undefined && s.y <= BUNKER_Y + 0.5);
    assert.ok(under.length >= 40, `${id}: ${under.length} spots underground`);
    assert.ok(under.every(s => s.tier === 3), `${id}: the bunkers hold only the best`);
    for (const h of w.hotAreas!) {
      const inside = w.lootSpots.filter(s => (s.y ?? 0) > BUNKER_Y + 1 && Math.hypot(s.x - h.x, s.z - h.z) < h.radius && s.tier === 3);
      assert.ok(inside.length >= 6, `${id}: ${h.name} has ${inside.length} top-tier spots above ground`);
    }
  }
});

function sandbox(id: MapId): { sim: GameSimulation; world: WorldConfig; step(): void } {
  const sim = new GameSimulation({ seed: 5, botCount: 0, map: id });
  sim.start();
  return { sim, world: sim.world, step: () => sim.update(1 / 30, idle) };
}

test('each stairwell down lands at its bunker, and the stairs up lead back out beside the same shed', () => {
  for (const id of HOT_MAPS) {
    const { sim, world } = sandbox(id);
    const byId = new Map(world.portals!.map(p => [p.id, p]));
    for (const down of world.portals!.filter(p => p.down)) {
      const up = byId.get(down.id.replace(/-down$/, '-up'))!;
      assert.ok(up && !up.down, `${down.id} has a way back`);
      assert.ok(down.to.y <= BUNKER_Y + 0.01 && up.y <= BUNKER_Y + 0.01 && up.to.y > BUNKER_Y + DEEP, `${id}: heights`);
      assert.ok(Math.hypot(down.to.x - up.x, down.to.z - up.z) < 5, `${id}: the landing is by the stairs up`);
      assert.ok(Math.hypot(up.to.x - down.x, up.to.z - down.z) < 6, `${id}: the stairs up come out by the shed`);
    }
    // Take a stairwell for real and come back.
    const portal = world.portals!.find(p => p.down)!;
    sim.player.position = { x: portal.x, y: portal.y, z: portal.z };
    assert.equal(sim.portalNear(), portal);
    assert.ok(sim.interact());
    assert.ok(sim.player.position.y <= BUNKER_Y + 0.01, `${id}: now underground`);
    assert.ok(sim.events.some(e => e.type === 'portal' && e.down), 'an event for the view');
    // A few steps from the landing the stairs up are in reach, and they lead out again.
    const up = world.portals!.find(p => !p.down && p.id === portal.id.replace(/-down$/, '-up'))!;
    sim.player.position = { x: up.x, y: up.y, z: up.z };
    assert.equal(sim.portalNear(), up);
    assert.ok(sim.interact());
    assert.ok(sim.player.position.y > BUNKER_Y + DEEP, `${id}: back on the surface`);
    assert.ok(sim.events.some(e => e.type === 'portal' && !e.down));
  }
});

test('the stairs only work from close by, and not from a car or in the air', () => {
  const { sim, world } = sandbox('island');
  const portal = world.portals!.find(p => p.down)!;
  sim.player.position = { x: portal.x + 6, y: portal.y, z: portal.z };
  assert.equal(sim.portalNear(), null);
  assert.equal(sim.useStairs(), false);
  sim.player.position = { x: portal.x, y: portal.y + 6, z: portal.z };
  assert.equal(sim.portalNear(), null, 'not from the roof');
});

test('underground you stand on the bunker floor, not on the terrain overhead', () => {
  const { sim, world, step } = sandbox('island');
  const portal = world.portals!.find(p => p.down)!;
  sim.player.position = { x: portal.x, y: portal.y, z: portal.z };
  sim.interact();
  const p = sim.player.position;
  for (let i = 0; i < 60; i++) step();
  assert.ok(Math.abs(sim.player.position.y - BUNKER_Y) < 0.05, `stands at ${sim.player.position.y}`);
  assert.ok(Math.abs(sim.supportHeight(p.x, p.z, BUNKER_Y) - BUNKER_Y) < 0.05);
  assert.ok(sim.heightAt(p.x, p.z) > BUNKER_Y + DEEP, 'the terrain is far overhead');
  // At the surface the same column still supports the ground.
  assert.ok(Math.abs(sim.supportHeight(p.x, p.z, sim.heightAt(p.x, p.z)) - sim.heightAt(p.x, p.z)) < 0.05);
});

test('from every landing a player can walk to every loot spot and room in the bunker', () => {
  for (const id of HOT_MAPS) {
    const { sim, world } = sandbox(id);
    const walker = sim as unknown as Walker;
    const sites = new Map<string, { x0: number; z0: number }>();
    for (const portal of world.portals!.filter(p => p.down)) sites.set(portal.id.replace(/-s\d+-down$/, ''), { x0: 0, z0: 0 });
    for (const key of sites.keys()) {
      const mine = world.portals!.filter(p => p.down && p.id.startsWith(`${key}-s`));
      const start = mine[0].to;
      const cell = 0.5, seen = new Set<string>();
      const stack: Array<[number, number]> = [[start.x, start.z]];
      const k = (x: number, z: number) => `${Math.round(x / cell)},${Math.round(z / cell)}`;
      seen.add(k(start.x, start.z));
      assert.ok(walker.walkable({ x: start.x, z: start.z }, 0.45, BUNKER_Y, 1.8), `${id} ${key}: the landing is clear`);
      while (stack.length) {
        const [x, z] = stack.pop()!;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx * cell, nz = z + dz * cell, key2 = k(nx, nz);
          if (seen.has(key2) || !walker.walkable({ x: nx, z: nz }, 0.45, BUNKER_Y, 1.8)) continue;
          seen.add(key2); stack.push([nx, nz]);
        }
      }
      const spots = world.lootSpots.filter(s => (s.y ?? 0) <= BUNKER_Y + 0.5 && Math.abs(s.x - start.x) < 80 && Math.abs(s.z - start.z) < 80);
      const bunkerSpots = spots.filter(s => walker.walkable({ x: s.x, z: s.z }, 0.05, BUNKER_Y, 1.8) !== undefined);
      assert.ok(bunkerSpots.length > 0);
      const near = [-3, -2, -1, 0, 1, 2, 3];
      for (const s of bunkerSpots) assert.ok(near.some(dx => near.some(dz => seen.has(k(s.x + dx * cell, s.z + dz * cell)))), `${id} ${key}: loot at ${s.x.toFixed(1)},${s.z.toFixed(1)} cannot be reached`);
      // Every stairwell of the bunker is on the same connected floor.
      for (const portal of world.portals!.filter(p => !p.down && p.id.startsWith(`${key}-s`))) {
        assert.ok([-1, 0, 1].some(dx => [-1, 0, 1].some(dz => seen.has(k(portal.x + dx * cell * 2, portal.z + dz * cell * 2)))), `${id} ${key}: ${portal.id} is cut off`);
      }
    }
  }
});

test('nobody walks through bunker walls or up through the ceiling, and bullets are not stopped by the ground overhead', () => {
  const { sim, world } = sandbox('island');
  const portal = world.portals!.find(p => p.down)!;
  sim.player.position = { x: portal.x, y: portal.y, z: portal.z };
  sim.interact();
  const here = { ...sim.player.position };
  const walker = sim as unknown as Walker;
  assert.equal(walker.walkable({ x: here.x, z: here.z - 300 }, 0.45, BUNKER_Y, 1.8), true, 'outside the complex there is nothing underground to bump into');
  const terrainHit = (sim as unknown as { terrainHit(o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, range: number): unknown }).terrainHit;
  assert.equal(terrainHit.call(sim, { x: here.x, y: here.y + 1.6, z: here.z }, { x: 0, y: 0.3, z: 0.95 }, 60), null);
});
