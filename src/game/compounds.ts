import type { CompoundKind, HotArea, Obstacle, RoadSegment, Vec2, VehicleSpawn } from '../types';
import { buildHangar, buildTower, placeParts, wallPieces } from './buildings';
import type { Parts } from './buildings';

/** Reserved before towns, roads and vegetation: every island has exactly these four destinations. */
export const ISLAND_COMPOUNDS: readonly HotArea[] = [
  { id: 'compound-temple', name: 'Thiên Điện', kind: 'temple', x: -820, z: -760, radius: 200 },
  { id: 'compound-depot', name: 'Bến xe Lam Sơn', kind: 'depot', x: 820, z: -760, radius: 200 },
  { id: 'compound-garden', name: 'Trúc Viên', kind: 'garden', x: -820, z: 760, radius: 200 },
  { id: 'compound-citadel', name: 'Thành Đá', kind: 'citadel', x: 820, z: 760, radius: 200 },
];
export const compoundGate = (kind: CompoundKind): number => kind === 'depot' ? 120 : kind === 'garden' ? 116 : 104;
export function isCompound(kind: HotArea['kind']): kind is CompoundKind { return kind !== 'base' && kind !== 'factory'; }
/** Paved compounds have no meadow grass; the garden keeps its lawns and base/factory compounds keep their old look. */
export const clearsGrass = (kind: HotArea['kind']): boolean => isCompound(kind) && kind !== 'garden';

/** Route roads around reserved footprints, using a tiny visibility graph of their outer corners. */
export function routeCompoundRoads(roads: RoadSegment[], areas: readonly HotArea[]): RoadSegment[] {
  const bounds = areas.map(a => ({ x0: a.x - 144, x1: a.x + 144, z0: a.z - 144, z1: a.z + 144 }));
  const inside = (p: Vec2, b: typeof bounds[number]) => p.x > b.x0 && p.x < b.x1 && p.z > b.z0 && p.z < b.z1;
  return roads.flatMap(road => {
    // Gate approaches intentionally end inside their own footprint, on the clear central lane.
    const boxes = bounds.filter(b => !inside(road.a, b) && !inside(road.b, b));
    const clear = (a: Vec2, b: Vec2) => boxes.every(box => {
      let near = 0, far = 1;
      for (const [v, delta, low, high] of [[a.x, b.x - a.x, box.x0, box.x1], [a.z, b.z - a.z, box.z0, box.z1]]) {
        if (Math.abs(delta) < 1e-8) { if (v <= low || v >= high) return true; }
        else { const t0 = (low - v) / delta, t1 = (high - v) / delta; near = Math.max(near, Math.min(t0, t1)); far = Math.min(far, Math.max(t0, t1)); }
      }
      return near >= far - 1e-8 || far <= 0 || near >= 1;
    });
    if (clear(road.a, road.b)) return [road];
    const points: Vec2[] = [road.a, road.b, ...boxes.flatMap(b => [
      { x: b.x0 - 1, z: b.z0 - 1 }, { x: b.x1 + 1, z: b.z0 - 1 }, { x: b.x1 + 1, z: b.z1 + 1 }, { x: b.x0 - 1, z: b.z1 + 1 },
    ])];
    const cost = points.map(() => Infinity), previous = points.map(() => -1), visited = new Set<number>(); cost[0] = 0;
    for (let step = 0; step < points.length; step++) {
      let current = -1;
      for (let i = 0; i < points.length; i++) if (!visited.has(i) && (current < 0 || cost[i] < cost[current])) current = i;
      if (current < 0 || !Number.isFinite(cost[current])) break;
      if (current === 1) break;
      visited.add(current);
      for (let next = 0; next < points.length; next++) if (!visited.has(next) && clear(points[current], points[next])) {
        const c = cost[current] + Math.hypot(points[next].x - points[current].x, points[next].z - points[current].z);
        if (c < cost[next]) { cost[next] = c; previous[next] = current; }
      }
    }
    const path = [1];
    for (let p = previous[1]; p >= 0; p = previous[p]) path.unshift(p);
    if (path[0] !== 0) throw new Error('No road route around the island compounds');
    return path.slice(1).map((p, i) => ({ a: points[path[i]], b: points[p], width: road.width }));
  });
}

export interface CompoundPlan { parts: Parts; vehicles: VehicleSpawn[] }

/** Physical modules and their render palette travel together; decorative walls never seal a doorway. */
export function buildCompound(kind: CompoundKind, id: string, cx: number, cz: number, base: number): CompoundPlan {
  const parts: Parts = { obstacles: [], floors: [], loot: [], proxies: [] }, vehicles: VehicleSpawn[] = [];
  let serial = 0;
  const name = (label: string) => `${id}-${label}-${serial++}`;
  const box = (label: string, x: number, z: number, w: number, d: number, h: number, y = 0, type: Obstacle['kind'] = 'wall') => {
    const o: Obstacle = { id: name(label), x: cx + x, z: cz + z, width: w, depth: d, base, bottom: y, height: y + h, kind: type, compoundStyle: kind };
    parts.obstacles.push(o); return o;
  };
  const merge = (other: Parts, x: number, z: number) => {
    const placed = placeParts(other, cx + x, cz + z, false, false);
    parts.obstacles.push(...placed.obstacles.map(o => ({ ...o, compoundStyle: kind })));
    parts.floors.push(...placed.floors); parts.loot.push(...placed.loot);
    parts.proxies!.push(...(placed.proxies ?? []).map(o => ({ ...o, compoundStyle: kind })));
  };
  const slab = (label: string, x: number, z: number, w: number, d: number, top: number) => {
    box(label, x, z, w, d, Math.max(0.12, top), 0, 'floor');
    parts.floors.push({ id: name(label + '-surface'), x: cx + x, z: cz + z, width: w, depth: d, y0: base + Math.max(0.12, top), y1: base + Math.max(0.12, top) });
  };
  const ramp = (label: string, x: number, z: number, w: number, d: number, low: number, high: number, axis: 'x' | 'z') => {
    parts.floors.push({ id: name(label), x: cx + x, z: cz + z, width: w, depth: d, y0: base + low, y1: base + high, axis });
  };
  const roof = (x: number, z: number, w: number, d: number, y: number, rise = 4) => {
    const o = box('pagoda-roof', x, z, w, d, rise, y, 'roof'); o.roofShape = 'pagoda';
  };
  const loot = (x: number, z: number, y = 0.12, heavy = false) => parts.loot.push({ x: cx + x, z: cz + z, y: base + y, tier: 3, ...(heavy ? { bias: 'heavy' as const } : {}) });
  const fence = (hx: number, hz: number, height: number) => {
    // Both road gates are at z=0; a third pedestrian entrance is centred in the front wall.
    for (const side of [-1, 1]) {
      for (const segment of [-1, 1]) box('perimeter', side * hx, segment * (hz / 2 + 5), 0.8, hz - 10, height);
      for (const segment of [-1, 1]) box('perimeter', segment * (hx / 2 + 6), side * hz, hx - 12, 0.8, height);
    }
  };
  const pavilion = (x: number, z: number, w: number, d: number, y = 0.12, tiers = 1) => {
    slab('pavilion-base', x, z, w + 2, d + 2, y);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box('pillar', x + sx * (w / 2 - 0.7), z + sz * (d / 2 - 0.7), 0.65, 0.65, 5, y);
    roof(x, z, w + 4, d + 4, y + 5, 3.5);
    if (tiers > 1) { box('upper-pavilion', x, z, w * 0.5, d * 0.5, 3, y + 8.5); roof(x, z, w * 0.65 + 3, d * 0.65 + 3, y + 11.5, 3); }
    loot(x + 2, z, y);
  };
  const hall = (x: number, z: number, w: number, d: number, y = 0.12) => {
    slab('hall-floor', x, z, w, d, y);
    for (const side of [-1, 1]) {
      const openings = [{ start: x - 3.5, end: x + 3.5, low: 0, high: 4 }];
      parts.obstacles.push(...wallPieces(name('hall-front'), 'wall', base + y, 'x', cz + z + side * d / 2, cx + x - w / 2, cx + x + w / 2,
        openings.map(o => ({ ...o, start: cx + o.start, end: cx + o.end })), 5.8).map(o => ({ ...o, compoundStyle: kind })));
      box('hall-end', x + side * w / 2, z, 0.6, d, 5.8, y);
    }
    for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) box('pillar', x + sx * (w / 2 - 1.2), z + (k - 1) * d / 3, 0.7, 0.7, 6, y);
    roof(x, z, w + 5, d + 5, y + 6, 5);
    for (const sx of [-1, 1]) { box('altar', x + sx * w / 4, z + d / 4, 5, 2, 1.2, y, 'crate'); loot(x + sx * w / 4, z - d / 4, y); }
  };
  const cover = (x: number, z: number) => { box('supply', x, z, 3.2, 2, 1.5, 0, 'crate'); loot(x + 2.4, z); };

  if (kind === 'temple') {
    fence(104, 120, 2.8);
    slab('court-paving', 0, -8, 150, 78, 0.12);
    slab('rear-terrace', 0, 68, 156, 56, 4);
    ramp('ceremonial-stairs', 0, 28, 22, 24, 0.12, 4, 'z');
    hall(0, 70, 56, 26, 4); hall(-54, -48, 36, 22); hall(54, -48, 36, 22);
    hall(-51, 20, 32, 20); hall(51, 20, 32, 20);
    for (const x of [-104, 104]) { for (const z of [-8, 8]) box('gate-pillar', x, z, 1.2, 1.2, 7); roof(x, 0, 10, 23, 7, 3); }
    pavilion(0, -93, 22, 16, 0.12, 2);
    // The colonnades start north of the gate lane, so cars can drive straight in from either gate.
    for (const x of [-84, 84]) {
      roof(x, 47, 9, 80, 5.6, 2.5);
      for (const z of [9, 24, 39, 54, 69, 84]) box('pillar', x, z, 0.8, 0.8, 5.6);
    }
    // Lanterns mark the inner sanctuary and flank the ceremonial stairs, outside the side halls.
    for (const [x, z] of [[-44, -10], [44, -10], [-18, 20], [18, 20]]) { box('stone-lantern', x, z, 1.8, 1.8, 3); roof(x, z, 3.2, 3.2, 3, 1.2); }
    for (const x of [-68, 68]) for (const z of [-91, 98]) cover(x, z);
    vehicles.push({ x: cx - 122, z: cz, yaw: Math.PI / 2 });
  } else if (kind === 'depot') {
    fence(120, 108, 2.4);
    slab('depot-asphalt', 0, -6, 212, 70, 0.12);
    // Drive-through hall: six open service bays separated by columns, rather than a sealed facade.
    const hx = -20, hz = 58, w = 112, d = 48;
    box('garage-back', hx, hz + d / 2, w, 0.6, 8);
    for (const sx of [-1, 1]) box('garage-end', hx + sx * w / 2, hz, 0.6, d, 8);
    for (let k = 0; k <= 6; k++) box('garage-pillar', hx - w / 2 + k * w / 6, hz - d / 2, 0.9, 0.9, 8);
    box('blue-garage-trim', hx, hz - d / 2, w, 0.9, 1, 7);
    const ceiling = box('garage-roof', hx, hz, w + 2, d + 2, 0.6, 8, 'roof'); ceiling.roofShape = 'flat';
    for (let k = 0; k < 6; k++) { cover(hx - w / 2 + (k + 0.5) * w / 6, hz + 8); box('detail-solar', hx - 42 + k * 17, hz, 12, 20, 0.18, 8.65); }
    merge(buildTower({ id: name('terminal'), width: 36, depth: 18, storeys: 3, base, flavor: 'apartment' }), 76, 58);
    merge(buildHangar({ id: name('warehouse'), width: 48, depth: 28, base }), -65, -70);
    for (let k = 0; k < 5; k++) {
      const x = -72 + k * 32;
      // Parking islands and a covered passenger platform frame a clear central road.
      box('parking-island', x, -27, 20, 2, 0.25, 0, 'floor');
      vehicles.push({ x: cx + x, z: cz - 43, yaw: 0 });
      if (k < 4) cover(x, -96);
    }
    roof(73, -70, 38, 20, 4.5, 1.8);
    for (const x of [58, 88]) box('platform-pillar', x, -70, 0.7, 0.7, 4.5);
  } else if (kind === 'garden') {
    fence(116, 116, 2.2);
    slab('garden-east-west-path', 0, 0, 212, 8, 0.12);
    slab('garden-front-path', 0, -52, 8, 96, 0.12);
    pavilion(0, 76, 22, 22, 0.12, 2); hall(-66, -66, 32, 20); hall(66, -66, 32, 20);
    // A raised stone bridge with broad stairs and open space below its central deck. Its south flight starts north of the
    // east-west lane, so cars on the lane never pass through the steps.
    box('bridge-deck', 0, 34, 12, 16, 0.3, 3.3, 'floor');
    parts.floors.push({ id: name('bridge-surface'), x: cx, z: cz + 34, width: 12, depth: 16, y0: base + 3.6, y1: base + 3.6 });
    ramp('bridge-south-stairs', 0, 16, 12, 20, 0.12, 3.6, 'z');
    ramp('bridge-north-stairs', 0, 52, 12, 20, 3.6, 0.12, 'z');
    for (const x of [-6.5, 6.5]) box('bridge-balustrade', x, 34, 0.6, 16, 1.2, 3.6);
    for (const x of [-4.5, 4.5]) for (const z of [28, 40]) box('bridge-foot', x, z, 2, 2, 3.6);
    for (const x of [-54, 54]) pavilion(x, 36, 12, 12);
    // Sparse bamboo clusters leave the lanes clear; every stalk belongs to the existing chunk mesh.
    for (const side of [-1, 1]) for (let k = 0; k < 22; k++) {
      const x = side * (83 + k % 4 * 4), z = -87 + Math.floor(k / 4) * 34;
      box('bamboo', x, z, 0.22, 0.22, 11 + k % 3, 0, 'tree');
    }
    for (const x of [-30, 30]) for (const z of [-20, 88]) { box('garden-rock', x, z, 7, 5, 3.2, 0, 'rock'); loot(x + 5, z); }
    vehicles.push({ x: cx - 132, z: cz, yaw: Math.PI / 2 });
  } else {
    fence(104, 104, 5.5);
    slab('citadel-court-paving', 0, -5, 180, 166, 0.12);
    for (const x of [-88, 88]) for (const z of [-88, 88]) merge(buildTower({ id: name('watchtower'), width: 8, depth: 14, storeys: 4, base, flavor: 'tower' }), x, z);
    merge(buildTower({ id: name('keep'), width: 54, depth: 26, storeys: 4, base, flavor: 'apartment' }), 0, 57);
    for (const x of [-60, 60]) merge(buildHangar({ id: name('barracks'), width: 32, depth: 24, base }), x, -55);
    // Accessible wall walks have a dedicated ramp; no teleport is needed to reach them. The ramp starts north of the
    // gate opening, and the merlons sit on the outer wall so the walk stays clear at head height.
    for (const x of [-100, 100]) {
      slab('wall-walk', x, 65, 6, 58, 4.4);
      ramp('wall-stairs', x, 24, 6, 24, 0, 4.4, 'z');
      for (let z = 38; z < 94; z += 6) box('detail-merlon', Math.sign(x) * 104, z, 0.8, 1.4, 1.5, 5.5);
    }
    for (const x of [-46, 46]) for (const z of [-15, 15]) cover(x, z);
    vehicles.push({ x: cx - 121, z: cz, yaw: Math.PI / 2 }, { x: cx + 121, z: cz, yaw: -Math.PI / 2 });
  }
  if (kind === 'temple' || kind === 'garden') for (const x of [-48, 48]) for (const z of [-96, 96]) box('cherry-tree', x, z, 0.8, 0.8, 8, kind === 'temple' && z > 0 ? 4 : 0, 'tree');
  // Common loot in open courtyards, away from the road spine and stairs.
  for (const x of [-24, 24]) for (const z of [-32, -12]) loot(x, z, 0, true);
  return { parts, vehicles };
}
