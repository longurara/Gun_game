import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHouse, placeParts } from '../src/game/buildings.ts';
import type { HouseLayout } from '../src/game/buildings.ts';
import { createIsland, createValley } from '../src/game/world.ts';

test('every home layout has walkable routes from its porch to every loot spot', () => {
  for (const layout of ['cottage', 'longhouse', 'wing'] as HouseLayout[]) {
    for (const [width, depth] of [[8, 7], [10, 9], [15, 13]]) {
      for (const swap of [false, true]) for (const mirror of [false, true]) {
        const home = placeParts(buildHouse({ id: 'home', width, depth, base: 12, tier: 2, layout }), 30, -20, swap, mirror);
        const solid = home.obstacles.filter(o => (o.bottom ?? 0) < 1.8);
        const clear = (x: number, z: number) => !solid.some(o =>
          Math.abs(x - o.x) < o.width / 2 + 0.45 && Math.abs(z - o.z) < o.depth / 2 + 0.45);
        const start = swap ? [30 - depth / 2 - 2, -20] : [30, -20 - depth / 2 - 2];
        const step = 0.25, limit = Math.ceil((Math.max(width, depth) + 6) / step);
        const queue = [[0, 0]], seen = new Set(['0,0']);
        for (let i = 0; i < queue.length; i++) {
          const [gx, gz] = queue[i];
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = gx + dx, nz = gz + dz, key = nx + ',' + nz;
            if (Math.abs(nx) > limit || Math.abs(nz) > limit || seen.has(key)) continue;
            if (!clear(start[0] + nx * step, start[1] + nz * step)) continue;
            seen.add(key); queue.push([nx, nz]);
          }
        }
        for (const spot of home.loot) {
          assert.ok(clear(spot.x, spot.z), layout + ': loot overlaps solid cover');
          assert.ok(queue.some(([gx, gz]) => Math.hypot(start[0] + gx * step - spot.x, start[1] + gz * step - spot.z) < 0.3),
            layout + ': unreachable loot at ' + spot.x + ',' + spot.z);
        }
        assert.equal(home.loot.length, width * depth > 90 ? 2 : 1);
        assert.ok(home.obstacles.some(o => o.id.includes('-room-')));
        assert.ok(home.obstacles.some(o => o.roofShape === 'flat' && (o.bottom ?? 0) >= 2.8));
        assert.ok(home.obstacles.filter(o => o.furnishing).length === 2);
      }
    }
  }
});

test('an L home leaves its courtyard open and uses separate roof sections', () => {
  const home = buildHouse({ id: 'wing', width: 12, depth: 10, base: 0, tier: 1, layout: 'wing' });
  const roofs = home.obstacles.filter(o => o.kind === 'roof' && !o.roofShape);
  assert.equal(roofs.length, 2);
  assert.ok(!roofs.some(o => Math.abs(-4 - o.x) < o.width / 2 && Math.abs(3 - o.z) < o.depth / 2));
});

test('generated maps share home palettes and keep every home loot spot clear of its walls and furniture', () => {
  for (const { world } of [createIsland(), createValley()]) {
    const homes = new Map<string, typeof world.obstacles>();
    for (const obstacle of world.obstacles) if (obstacle.houseId) {
      const list = homes.get(obstacle.houseId) ?? [];
      list.push(obstacle); homes.set(obstacle.houseId, list);
    }
    assert.ok(homes.size > 20);
    assert.ok([...homes.values()].some(parts => parts.some(o => o.id.endsWith('-wing-roof'))));
    for (const parts of homes.values()) for (const roof of parts.filter(o => o.kind === 'roof' && !o.roofShape)) {
      for (const spot of world.lootSpots.filter(l => Math.abs((l.y ?? 0) - (roof.base ?? 0)) < 0.1 && Math.abs(l.x - roof.x) < roof.width / 2 - 0.3 && Math.abs(l.z - roof.z) < roof.depth / 2 - 0.3)) {
        assert.ok(!parts.some(o => (o.bottom ?? 0) < 1.8 && Math.abs(spot.x - o.x) < o.width / 2 + 0.45 && Math.abs(spot.z - o.z) < o.depth / 2 + 0.45), roof.id + ': blocked loot');
      }
    }
  }
});
