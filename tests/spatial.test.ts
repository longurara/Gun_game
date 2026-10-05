import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpatialGrid } from '../src/game/spatial.ts';

interface Box { id: number; minX: number; minZ: number; maxX: number; maxZ: number }

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

function randomBoxes(count: number, spread: number, random: () => number): Box[] {
  return Array.from({ length: count }, (_, id) => {
    const x = (random() - 0.5) * spread, z = (random() - 0.5) * spread;
    const w = 0.5 + random() * 18, d = 0.5 + random() * 18;
    return { id, minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 };
  });
}

const overlaps = (b: Box, x0: number, z0: number, x1: number, z1: number) => b.minX <= x1 && b.maxX >= x0 && b.minZ <= z1 && b.maxZ >= z0;

/** Slab test of a 2D segment against a box. */
function segmentHitsBox(b: Box, ax: number, az: number, bx: number, bz: number): boolean {
  let near = 0, far = 1;
  for (const [o, d, lo, hi] of [[ax, bx - ax, b.minX, b.maxX], [az, bz - az, b.minZ, b.maxZ]] as const) {
    if (Math.abs(d) < 1e-12) { if (o < lo || o > hi) return false; continue; }
    let t0 = (lo - o) / d, t1 = (hi - o) / d;
    if (t0 > t1) [t0, t1] = [t1, t0];
    near = Math.max(near, t0); far = Math.min(far, t1);
    if (near > far) return false;
  }
  return true;
}

test('queryBox returns every overlapping box exactly once and never invents boxes', () => {
  const random = lcg(7);
  const boxes = randomBoxes(800, 600, random);
  const grid = new SpatialGrid<Box>(24);
  for (const box of boxes) grid.insertBox(box, box.minX, box.minZ, box.maxX, box.maxZ);
  for (let i = 0; i < 200; i++) {
    const x = (random() - 0.5) * 600, z = (random() - 0.5) * 600, r = random() * 60;
    const seen: number[] = [];
    grid.queryBox(x - r, z - r, x + r, z + r, box => { seen.push(box.id); });
    assert.equal(new Set(seen).size, seen.length, 'a box was visited twice');
    const expected = boxes.filter(b => overlaps(b, x - r, z - r, x + r, z + r)).map(b => b.id);
    for (const id of expected) assert.ok(seen.includes(id), `missed box ${id}`);
  }
});

test('querySegment visits every box the segment really crosses, in any direction', () => {
  const random = lcg(99);
  const boxes = randomBoxes(1200, 800, random);
  const grid = new SpatialGrid<Box>(24);
  for (const box of boxes) grid.insertBox(box, box.minX, box.minZ, box.maxX, box.maxZ);
  for (let i = 0; i < 400; i++) {
    const ax = (random() - 0.5) * 800, az = (random() - 0.5) * 800;
    const angle = random() * Math.PI * 2, length = random() * 260;
    const bx = ax + Math.cos(angle) * length, bz = az + Math.sin(angle) * length;
    const seen = new Set<number>();
    grid.querySegment(ax, az, bx, bz, box => { seen.add(box.id); });
    for (const box of boxes) {
      if (segmentHitsBox(box, ax, az, bx, bz)) assert.ok(seen.has(box.id), `segment ${i} missed box ${box.id}`);
    }
  }
});

test('querySegment handles axis-aligned, zero-length and point items; early exit stops traversal', () => {
  const grid = new SpatialGrid<string>(10);
  grid.insertPoint('a', 5, 5);
  grid.insertPoint('b', 35, 5);
  grid.insertBox('wall', 20, -50, 22, 50);
  const names: string[] = [];
  grid.querySegment(0, 5, 40, 5, name => { names.push(name); });
  assert.deepEqual(names.sort(), ['a', 'b', 'wall']);
  const solo: string[] = [];
  grid.querySegment(5, 5, 5, 5, name => { solo.push(name); });
  assert.deepEqual(solo, ['a']);
  const first: string[] = [];
  grid.querySegment(0, 5, 40, 5, name => { first.push(name); return true; });
  assert.equal(first.length, 1);
  grid.clear();
  assert.equal(grid.size, 0);
});
