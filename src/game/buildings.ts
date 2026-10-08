/**
 * Multi-storey buildings. A building is built in its own frame (centred on the origin, long side along x) from walls with
 * door and window openings, floor slabs with stairwell holes, stair ramps, parapets, furniture and loot spots, then moved to
 * its place on the map (turned a quarter and/or mirrored). People climb on `Floor`s: flat slabs and sloped ramps.
 */
import type { Floor, LootSpot, Obstacle } from '../types';

export const WALL_THICKNESS = 0.4;
export const HOUSE_HEIGHT = 3.3;
export const DOOR_WIDTH = 2.6;
export const DOOR_HEIGHT = 2.5;
/** Distance between one floor and the next. */
export const STOREY = HOUSE_HEIGHT;
export const SLAB = 0.25;
/** Upper walls stop this far under the next floor, so someone standing on that floor is clear of them. */
const WALL_GAP = 0.03;
export const STAIR_WIDTH = 2.2;
export const STAIR_LENGTH = 7;
/** The stair core: two ramps side by side with a landing at each end, at the west end of the building. */
export const CORE_WIDTH = 6.4;
export const CORE_DEPTH = 14;

/** How far above their feet someone can step up onto a slab or ramp (a stair riser, not a wall). */
export const STEP_UP = 0.6;

/** The height of a floor's walking surface at (x, z): flat, or along its ramp. */
export function floorSurface(f: Floor, x: number, z: number): number {
  if (f.y0 === f.y1 || !f.axis) return f.y0;
  const t = f.axis === 'x' ? (x - (f.x - f.width / 2)) / f.width : (z - (f.z - f.depth / 2)) / f.depth;
  return f.y0 + (f.y1 - f.y0) * Math.min(1, Math.max(0, t));
}

export interface Opening { start: number; end: number; low: number; high: number }
export interface Parts { obstacles: Obstacle[]; floors: Floor[]; loot: LootSpot[]; proxies?: Obstacle[] }

/** Wall segment along one axis with rectangular openings (doors and windows) cut out. */
export function wallPieces(
  id: string, kind: Obstacle['kind'], base: number, axis: 'x' | 'z', fixed: number, from: number, to: number,
  openings: Opening[], top = HOUSE_HEIGHT,
): Obstacle[] {
  const pieces: Obstacle[] = [];
  const sorted = [...openings].sort((a, b) => a.start - b.start);
  const push = (a: number, b: number, bottom: number, upper: number, suffix: string) => {
    if (b - a < 0.05 || upper - bottom < 0.05) return;
    const mid = (a + b) / 2, len = b - a;
    pieces.push(axis === 'x'
      ? { id: `${id}-${suffix}`, x: mid, z: fixed, width: len, depth: WALL_THICKNESS, height: upper, bottom: bottom || undefined, kind, base }
      : { id: `${id}-${suffix}`, x: fixed, z: mid, width: WALL_THICKNESS, depth: len, height: upper, bottom: bottom || undefined, kind, base });
  };
  let cursor = from;
  sorted.forEach((opening, i) => {
    push(cursor, opening.start, 0, top, `s${i}`);
    push(opening.start, opening.end, 0, opening.low, `l${i}`);
    push(opening.start, opening.end, opening.high, top, `h${i}`);
    cursor = opening.end;
  });
  push(cursor, to, 0, top, 'e');
  return pieces;
}

interface Rect { x0: number; x1: number; z0: number; z1: number }

/** `rect` minus the holes, as a list of rectangles. */
function subtract(rect: Rect, holes: Rect[]): Rect[] {
  let pieces: Rect[] = [rect];
  for (const hole of holes) {
    const next: Rect[] = [];
    for (const r of pieces) {
      if (hole.x1 <= r.x0 || hole.x0 >= r.x1 || hole.z1 <= r.z0 || hole.z0 >= r.z1) { next.push(r); continue; }
      const ix0 = Math.max(r.x0, hole.x0), ix1 = Math.min(r.x1, hole.x1);
      if (hole.z0 > r.z0) next.push({ x0: r.x0, x1: r.x1, z0: r.z0, z1: hole.z0 });
      if (hole.z1 < r.z1) next.push({ x0: r.x0, x1: r.x1, z0: hole.z1, z1: r.z1 });
      const z0 = Math.max(r.z0, hole.z0), z1 = Math.min(r.z1, hole.z1);
      if (ix0 > r.x0) next.push({ x0: r.x0, x1: ix0, z0, z1 });
      if (ix1 < r.x1) next.push({ x0: ix1, x1: r.x1, z0, z1 });
    }
    pieces = next;
  }
  return pieces.filter(r => r.x1 - r.x0 > 0.05 && r.z1 - r.z0 > 0.05);
}

/** Windows spread along a wall of the given extent, `step` metres apart, skipping `avoid` ranges. */
function windowsAlong(from: number, to: number, step: number, avoid: Array<[number, number]> = [], low = 1.0, high = 2.15): Opening[] {
  const count = Math.max(1, Math.floor((to - from - 2) / step));
  const openings: Opening[] = [];
  for (let i = 0; i < count; i++) {
    const center = from + (i + 0.5) * (to - from) / count;
    if (avoid.some(([a, b]) => center + 1.0 > a && center - 1.0 < b)) continue;
    openings.push({ start: center - 0.8, end: center + 0.8, low, high });
  }
  return openings;
}

const doorAt = (center: number, width = DOOR_WIDTH, high = DOOR_HEIGHT): Opening => ({ start: center - width / 2, end: center + width / 2, low: 0, high });

export interface TowerSpec {
  id: string; width: number; depth: number; storeys: number; base: number;
  /** Which kind of loot the rooms hold. */
  flavor: 'apartment' | 'hospital' | 'tower';
}

/** The footprints of the stair ramps in the core: even ramps on the left, odd on the right (in building space). */
function rampRect(x0: number, index: number): Rect {
  const left = index % 2 === 0;
  const xa = x0 + (left ? 0.8 : 0.8 + STAIR_WIDTH + 0.4);
  return { x0: xa, x1: xa + STAIR_WIDTH, z0: -STAIR_LENGTH / 2, z1: STAIR_LENGTH / 2 };
}

/**
 * An apartment block, hospital or watch tower: `storeys` floors reached by a stair core, windows on every side, interior
 * walls with doorways, furniture, loot on every floor and an open roof deck behind a parapet.
 */
export function buildTower(spec: TowerSpec): Parts {
  const { id, width: W, depth: D, storeys: S, base, flavor } = spec;
  const x0 = -W / 2, x1 = W / 2, z0 = -D / 2, z1 = D / 2;
  const coreX = x0 + CORE_WIDTH;
  const hasMain = W > CORE_WIDTH + 4;
  const wallTop = STOREY - WALL_GAP;
  const parts: Parts = { obstacles: [], floors: [], loot: [], proxies: [{ id: `${id}-far`, x: 0, z: 0, width: W, depth: D, height: S * STOREY, kind: 'building', base }] };
  const mainCenter = hasMain ? (coreX + x1) / 2 : (x0 + x1) / 2;

  for (let k = 0; k < S; k++) {
    const level = base + k * STOREY;
    const ground = k === 0;
    const walls = (side: string, axis: 'x' | 'z', fixed: number, from: number, to: number, openings: Opening[]) =>
      parts.obstacles.push(...wallPieces(`${id}-${k}${side}`, 'wall', level, axis, fixed, from, to, openings, wallTop));
    const door = ground ? [doorAt(mainCenter)] : [];
    const avoid: Array<[number, number]> = ground ? [[mainCenter - 1.3, mainCenter + 1.3]] : [];
    walls('s', 'x', z0, x0, x1, [...windowsAlong(x0, x1, 5, avoid), ...door]);
    walls('n', 'x', z1, x0, x1, [...windowsAlong(x0, x1, 5, avoid), ...door]);
    walls('w', 'z', x0, z0, z1, windowsAlong(z0, z1, 6));
    walls('e', 'z', x1, z0, z1, windowsAlong(z0, z1, 6));
    if (hasMain) {
      // The core door opens onto each landing; the main part is split by a long wall with two doorways.
      const landing = (STAIR_LENGTH / 2 + D / 2) / 2;
      walls('c', 'z', coreX, z0, z1, [doorAt(-landing), doorAt(landing)]);
      walls('m', 'x', 0, coreX, x1, [doorAt(coreX + (x1 - coreX) * 0.25), doorAt(coreX + (x1 - coreX) * 0.75)]);
      // A couple of crates and cabinets to fight around.
      const furniture: Array<[number, number, number, number]> = [
        [coreX + 3, -D / 4, 1.4, 0.9], [x1 - 3, D / 4, 1.0, 1.4], [(coreX + x1) / 2, -D / 4 - 0.6, 1.2, 1.2], [coreX + 5, D / 4, 2.2, 0.9],
      ];
      furniture.forEach(([fx, fz, w, d], i) => parts.obstacles.push({ id: `${id}-${k}-crate${i}`, x: fx, z: fz, width: w, depth: d, height: 1.1, kind: 'crate', base: level }));
      const tier = ground ? 2 : 3;
      const bias = flavor === 'hospital' ? 'medical' : undefined;
      parts.loot.push({ x: coreX + 4, z: -D / 4 + 0.4, y: level, tier, bias }, { x: x1 - 4, z: D / 4 - 0.4, y: level, tier, bias });
      if (W > 20) parts.loot.push({ x: (coreX + x1) / 2, z: D / 4, y: level, tier, bias });
    } else {
      parts.loot.push({ x: x0 + CORE_WIDTH / 2, z: z0 + 1.2, y: level, tier: ground ? 2 : 3 });
    }
  }

  // Floors: a slab over every storey (the last one is the roof deck) with the stairwell cut out of it.
  for (let k = 1; k <= S; k++) {
    const y = k * STOREY;
    const slabs = subtract({ x0, x1, z0, z1 }, [rampRect(x0, k - 1)]);
    slabs.forEach((r, i) => {
      const w = r.x1 - r.x0, d = r.z1 - r.z0, x = (r.x0 + r.x1) / 2, z = (r.z0 + r.z1) / 2;
      parts.obstacles.push({ id: `${id}-f${k}-${i}`, x, z, width: w, depth: d, height: y, bottom: y - SLAB, kind: 'floor', base });
      parts.floors.push({ id: `${id}-f${k}-${i}`, x, z, width: w, depth: d, y0: base + y, y1: base + y });
    });
  }

  // Stair ramps: ramp k climbs from floor k to floor k + 1, rising towards +z on the left and -z on the right.
  for (let k = 0; k < S; k++) {
    const r = rampRect(x0, k), left = k % 2 === 0;
    const low = base + k * STOREY, high = base + (k + 1) * STOREY;
    parts.floors.push({ id: `${id}-r${k}`, x: (r.x0 + r.x1) / 2, z: 0, width: STAIR_WIDTH, depth: STAIR_LENGTH, y0: left ? low : high, y1: left ? high : low, axis: 'z' });
  }

  // Roof deck: a parapet all round to hide behind, and the best loot in the building.
  const deck = base + S * STOREY;
  const parapet = (side: string, axis: 'x' | 'z', fixed: number, from: number, to: number) => {
    const mid = (from + to) / 2, len = to - from;
    parts.obstacles.push(axis === 'x'
      ? { id: `${id}-p${side}`, x: mid, z: fixed, width: len, depth: WALL_THICKNESS, height: S * STOREY + 1.1, bottom: S * STOREY, kind: 'wall', base }
      : { id: `${id}-p${side}`, x: fixed, z: mid, width: WALL_THICKNESS, depth: len, height: S * STOREY + 1.1, bottom: S * STOREY, kind: 'wall', base });
  };
  parapet('s', 'x', z0 + WALL_THICKNESS / 2, x0, x1); parapet('n', 'x', z1 - WALL_THICKNESS / 2, x0, x1);
  parapet('w', 'z', x0 + WALL_THICKNESS / 2, z0, z1); parapet('e', 'z', x1 - WALL_THICKNESS / 2, z0, z1);
  // On a compact tower, keep the crate above the unused flight: an even storey count finishes on the right-hand ramp.
  const deckX = hasMain ? mainCenter : x0 + 0.8 + (S % 2 ? STAIR_WIDTH + 0.4 : 0) + STAIR_WIDTH / 2;
  parts.obstacles.push({ id: `${id}-roof-crate`, x: deckX, z: 0, width: 1.6, depth: 1.2, height: 1.1, kind: 'crate', base: deck });
  parts.loot.push({ x: deckX, z: -2.2, y: deck, tier: 3 }, { x: deckX + (hasMain ? 3 : 0), z: 2.4, y: deck, tier: 3 });
  return parts;
}


export type HouseLayout = 'cottage' | 'longhouse' | 'wing';
export interface HouseSpec {
  id: string; width: number; depth: number; base: number; tier: 1 | 2 | 3; layout: HouseLayout; style?: Obstacle['houseStyle'];
}

/** A street-facing home in local space: entrance south, connected rooms and clear loot spots. */
export function buildHouse(spec: HouseSpec): Parts {
  const { id, width: W, depth: D, base, tier, layout } = spec;
  const x0 = -W / 2, x1 = W / 2, z0 = -D / 2, z1 = D / 2;
  const split = -W * 0.1, join = D * 0.05;
  const parts: Parts = { obstacles: [], floors: [], loot: [] };
  const wall = (side: string, axis: 'x' | 'z', fixed: number, from: number, to: number, openings: Opening[]) => {
    parts.obstacles.push(...wallPieces(id + '-' + side, 'wall', base, axis, fixed, from, to, openings).map(o => ({ ...o, houseId: id })));
  };
  const roof = (suffix: string, x: number, z: number, width: number, depth: number) => {
    parts.obstacles.push({ id: id + '-' + suffix, x, z, width: width + 0.6, depth: depth + 0.6,
      height: HOUSE_HEIGHT + 0.35, bottom: HOUSE_HEIGHT, kind: 'roof', base, houseId: id });
  };
  wall('s', 'x', z0, x0, x1, [doorAt(0), ...windowsAlong(x0, x1, 4.5, [[-1.7, 1.7]])]);
  if (layout === 'wing') {
    // The missing rear-left corner is a courtyard, with matching walls and roof sections.
    wall('w', 'z', x0, z0, join, windowsAlong(z0, join, 4.5));
    wall('e', 'z', x1, z0, z1, windowsAlong(z0, z1, 4.5));
    wall('n', 'x', z1, split, x1, [doorAt((split + x1) / 2)]);
    wall('court-n', 'x', join, x0, split, windowsAlong(x0, split, 4.5));
    wall('court-w', 'z', split, join, z1, windowsAlong(join, z1, 4.5));
    wall('room', 'x', join, split, x1, [doorAt((split + x1) / 2)]);
    roof('roof', 0, (z0 + join) / 2, W, join - z0);
    roof('wing-roof', (split + x1) / 2, (join + z1) / 2, x1 - split, z1 - join);
    parts.loot.push({ x: 0, z: -D * 0.22, y: base, tier }, { x: (split + x1) / 2, z: D * 0.28, y: base, tier });
  } else {
    parts.loot.push({ x: 0, z: -D * 0.22, y: base, tier });
    wall('w', 'z', x0, z0, z1, windowsAlong(z0, z1, 4.5));
    wall('e', 'z', x1, z0, z1, windowsAlong(z0, z1, 4.5));
    wall('n', 'x', z1, x0, x1, [doorAt(0), ...windowsAlong(x0, x1, 4.5, [[-1.7, 1.7]])]);
    wall('room', 'x', join, x0, x1, [doorAt(0)]);
    if (layout === 'longhouse') {
      wall('room-rear', 'z', 0, join, z1, [doorAt((join + z1) / 2, 1.8)]);
      parts.loot.push({ x: -W * 0.25, z: D * 0.3, y: base, tier }, { x: W * 0.25, z: D * 0.3, y: base, tier });
    } else parts.loot.push({ x: 0, z: D * 0.3, y: base, tier });
    roof('roof', 0, 0, W, D);
  }
  // Keep the original one/two loot spots per plot while distributing them across rooms.
  parts.loot = parts.loot.slice(0, W * D > 90 ? 2 : 1);
  // Cover stays against room edges, leaving a wide front-to-back route through the doors.
  parts.obstacles.push({ id: id + '-table', x: x0 + 1.7, z: z0 + 1.8, width: 1.6, depth: 0.8,
    height: 0.85, kind: 'crate', base, houseId: id, furnishing: 'table' });
  parts.obstacles.push({ id: id + '-bed', x: x1 - 0.9, z: z1 - 1.6, width: 1.3, depth: 2,
    height: 0.65, kind: 'crate', base, houseId: id, furnishing: 'bed' });
  parts.obstacles.push({ id: id + '-canopy', x: 0, z: z0 - 0.45, width: 3.8, depth: 1.5,
    bottom: 2.8, height: 2.98, kind: 'roof', base, houseId: id, roofShape: 'flat' });
  for (const x of [-1.75, 1.75]) parts.obstacles.push({ id: id + '-porch-' + (x < 0 ? 'w' : 'e'), x, z: z0 - 0.9,
    width: 0.18, depth: 0.18, height: 2.8, kind: 'wall', base, houseId: id });
  for (const part of parts.obstacles) part.houseStyle = spec.style;
  return parts;
}

export interface HangarSpec { id: string; width: number; depth: number; base: number }

/** A big warehouse: tall walls, two wide doors, high windows, a roof, a mezzanine with a stair ramp and plenty of cover. */
export function buildHangar(spec: HangarSpec): Parts {
  const { id, width: W, depth: D, base } = spec;
  const x0 = -W / 2, x1 = W / 2, z0 = -D / 2, z1 = D / 2;
  const H = 2 * STOREY;
  const parts: Parts = { obstacles: [], floors: [], loot: [] };
  const bigDoor = (center: number): Opening => ({ start: center - 2, end: center + 2, low: 0, high: 4.5 });
  const walls = (side: string, axis: 'x' | 'z', fixed: number, from: number, to: number, openings: Opening[]) =>
    parts.obstacles.push(...wallPieces(`${id}-${side}`, 'wall', base, axis, fixed, from, to, openings, H));
  const high = (from: number, to: number, avoid: Array<[number, number]>) => windowsAlong(from, to, 5, avoid, 4.0, 5.4);
  const doors = [-W / 4, W / 4];
  walls('s', 'x', z0, x0, x1, [...high(x0, x1, doors.map(d => [d - 2.4, d + 2.4] as [number, number])), ...doors.map(bigDoor)]);
  walls('n', 'x', z1, x0, x1, [...high(x0, x1, []), bigDoor(0)]);
  walls('w', 'z', x0, z0, z1, high(z0, z1, []));
  walls('e', 'z', x1, z0, z1, high(z0, z1, []));
  parts.obstacles.push({ id: `${id}-roof`, x: 0, z: 0, width: W + 0.6, depth: D + 0.6, height: H + 0.35, bottom: H, kind: 'roof', base });

  // Mezzanine along the north wall, a rail on its open side, and a ramp up to it at its east end.
  const mx0 = x0 + 1, mx1 = x0 + 19, mz0 = z1 - 5, mz1 = z1 - 0.2;
  const y = STOREY;
  parts.obstacles.push({ id: `${id}-mezz`, x: (mx0 + mx1) / 2, z: (mz0 + mz1) / 2, width: mx1 - mx0, depth: mz1 - mz0, height: y, bottom: y - SLAB, kind: 'floor', base });
  parts.floors.push({ id: `${id}-mezz`, x: (mx0 + mx1) / 2, z: (mz0 + mz1) / 2, width: mx1 - mx0, depth: mz1 - mz0, y0: base + y, y1: base + y });
  parts.obstacles.push({ id: `${id}-rail`, x: (mx0 + mx1) / 2, z: mz0 + WALL_THICKNESS / 2, width: mx1 - mx0, depth: WALL_THICKNESS, height: y + 1.0, bottom: y, kind: 'wall', base });
  parts.floors.push({ id: `${id}-ramp`, x: mx1 + STAIR_LENGTH / 2, z: z1 - 2.5, width: STAIR_LENGTH, depth: STAIR_WIDTH, y0: base + y, y1: base, axis: 'x' });

  // Cover on the floor and on the mezzanine, and loot in the middle of the hall.
  const crates: Array<[number, number, number, number, number]> = [
    [-9, -2, 3, 2, 1.6], [-2, 3, 2, 2, 1.2], [5, -3, 3.4, 2, 1.8], [10, 1, 2, 2, 1.2], [-11, 4, 2.4, 1.6, 1.1], [1, -6, 2, 2, 1.1],
  ];
  crates.forEach(([cx, cz, w, d, h], i) => parts.obstacles.push({ id: `${id}-crate${i}`, x: cx, z: cz, width: w, depth: d, height: h, kind: 'crate', base }));
  parts.obstacles.push({ id: `${id}-mcrate`, x: x0 + 8, z: z1 - 2.6, width: 2.4, depth: 1.4, height: y + 1.1, bottom: y, kind: 'crate', base });
  parts.loot.push(
    { x: -4, z: -2, y: base, tier: 3 }, { x: 6, z: 2, y: base, tier: 3, bias: 'heavy' },
    { x: x0 + 4, z: z1 - 2.5, y: base + y, tier: 3, bias: 'heavy' }, { x: x0 + 12, z: z1 - 2.5, y: base + y, tier: 3 },
  );
  return parts;
}

/** Move a building from its own frame to the map: mirrored along x if asked, turned a quarter (x and z swapped) if asked. */
export function placeParts(parts: Parts, cx: number, cz: number, swap: boolean, mirror: boolean): Parts {
  const at = (x: number, z: number): [number, number] => { const lx = mirror ? -x : x; return swap ? [cx + z, cz + lx] : [cx + lx, cz + z]; };
  const obstacles = parts.obstacles.map(o => {
    const [x, z] = at(o.x, o.z);
    return swap ? { ...o, x, z, width: o.depth, depth: o.width } : { ...o, x, z };
  });
  const floors = parts.floors.map(f => {
    const [x, z] = at(f.x, f.z);
    let { y0, y1, axis } = f;
    if (mirror && axis === 'x') [y0, y1] = [y1, y0];
    if (swap && axis) axis = axis === 'x' ? 'z' : 'x';
    return swap ? { ...f, x, z, width: f.depth, depth: f.width, y0, y1, axis } : { ...f, x, z, y0, y1, axis };
  });
  const loot = parts.loot.map(spot => { const [x, z] = at(spot.x, spot.z); return { ...spot, x, z }; });
  const proxies = (parts.proxies ?? []).map(o => {
    const [x, z] = at(o.x, o.z);
    return swap ? { ...o, x, z, width: o.depth, depth: o.width } : { ...o, x, z };
  });
  return { obstacles, floors, loot, proxies };
}
