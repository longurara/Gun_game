import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMapWorld, OPEN_MAPS } from '../src/game/world.ts';
import { LANDMARK_SPECS } from '../src/building-assets.ts';
import { GameSimulation } from '../src/game/simulation.ts';

test('new structures appear on every open map without blocking roads, pickups or drop points', () => {
  for (const map of OPEN_MAPS) {
    const world = createMapWorld(map)!;
    assert.ok(world.structures!.length > 10, map);
    assert.deepEqual([...new Set(world.structures!.map(s => s.kind))].sort(), Object.keys(LANDMARK_SPECS).sort());
    for (const s of world.structures!) {
      const spec = LANDMARK_SPECS[s.kind];
      assert.ok(world.obstacles.some(o => o.structureId === s.id));
      for (const point of [...world.lootSpots, ...world.spawns, ...world.vehicleSpawns]) {
        assert.ok(Math.abs(point.x - s.x) >= spec.width / 2 + 1 || Math.abs(point.z - s.z) >= spec.depth / 2 + 1, map + ': structure obstructs a pickup/spawn');
      }
      for (const road of world.roads) {
        const dx = road.b.x - road.a.x, dz = road.b.z - road.a.z;
        const t = Math.max(0, Math.min(1, ((s.x - road.a.x) * dx + (s.z - road.a.z) * dz) / (dx * dx + dz * dz || 1)));
        const distance = Math.hypot(s.x - road.a.x - dx * t, s.z - road.a.z - dz * t);
        assert.ok(distance > road.width / 2 + Math.hypot(spec.width, spec.depth) / 2 + 2);
      }
    }
  }
});

test('players can enter new structures and walk through open frames', () => {
  for (const kind of ['waterTower', 'scaffold', 'crypt', 'stoneCourt'] as const) {
    const game = new GameSimulation({ seed: 10, map: 'valley', botCount: 1 });
    game.start(); game.botsFrozen = true; game.player.air = undefined; game.player.health = 1e9;
    const s = game.world.structures!.find(s => s.kind === kind)!;
    const direction = kind === 'crypt' ? -1 : 1, reach = kind === 'stoneCourt' ? 6 : 4;
    game.player.position = { x: s.x, y: game.heightAt(s.x, s.z - direction * reach), z: s.z - direction * reach };
    for (let i = 0; i < (kind === 'crypt' ? 80 : 120); i++) game.update(0.016, { moveX: 0, moveZ: direction, sprint: false, jump: false });
    assert.ok(kind === 'crypt' ? game.player.position.z < s.z + 1 : kind === 'stoneCourt' ? game.player.position.z > s.z - 1 : game.player.position.z > s.z + 2, kind + ': open entrance is obstructed');
  }
});
