import { LANDMARK_SPECS } from '../building-assets';
import { addBuildingLandmarks } from './structures';
import type { Field, Floor, HotArea, Lake, LootSpot, MapId, MapTheme, Obstacle, Portal, River, RoadSegment, Town, Vec2, VehicleSpawn, Vec3, WorldConfig, ZoneProfile } from '../types';
import { buildHangar, buildHouse, buildTower, DOOR_HEIGHT, DOOR_WIDTH, HOUSE_HEIGHT, placeParts, WALL_THICKNESS, wallPieces } from './buildings';
import type { Parts } from './buildings';
import { SpatialGrid } from './spatial';
import { planBase, planFactory, shedObstacles } from './hot';
import { buildBunker, buildShed, linkShed } from './underground';
import { buildCompound, compoundGate, ISLAND_COMPOUNDS, isCompound, routeCompoundRoads } from './compounds';

/** The island is generated from a fixed seed so every match is played on the same map. */
export const ISLAND_SEED = 20260;
export const ISLAND_HALF = 2000;

export const ISLAND_ZONE: ZoneProfile = {
  start: 2400,
  radii: [1700, 1100, 700, 420, 220, 90, 0],
  waits: [40, 40, 35, 30, 25, 20, 10],
  shrinks: [90, 75, 60, 50, 40, 35, 30],
};

export const VALLEY_SEED = 71013;
export const VALLEY_HALF = 500;

export const VALLEY_ZONE: ZoneProfile = {
  start: 720,
  radii: [520, 340, 200, 110, 45, 0],
  waits: [35, 30, 25, 25, 20, 10],
  shrinks: [50, 45, 40, 35, 30, 25],
};

/**
 * The long maps: about twenty minutes from the drop to the last circle (see `zoneSeconds`). Eight circles, with long waits for
 * looting and driving early on and a slow squeeze at the end.
 */
const LONG_WAITS = [130, 110, 95, 80, 65, 50, 35, 20];
const LONG_SHRINKS = [130, 115, 100, 85, 70, 55, 45, 30];
/** Seconds from the start of a match to the end of the last circle. */
export const zoneSeconds = (zone: ZoneProfile): number => zone.waits.reduce((a, b) => a + b, 0) + zone.shrinks.reduce((a, b) => a + b, 0);

export const DESERT_SEED = 31415;
export const DESERT_HALF = 2500;
export const DESERT_ZONE: ZoneProfile = { start: 3600, radii: [2700, 2000, 1450, 1000, 640, 360, 160, 0], waits: LONG_WAITS, shrinks: LONG_SHRINKS };
export const PINES_SEED = 52717;
export const PINES_HALF = 2250;
export const PINES_ZONE: ZoneProfile = { start: 3250, radii: [2450, 1800, 1300, 900, 580, 330, 150, 0], waits: LONG_WAITS, shrinks: LONG_SHRINKS };
export const METRO_SEED = 90210;
export const METRO_HALF = 1500;
export const METRO_ZONE: ZoneProfile = { start: 2150, radii: [1600, 1180, 850, 580, 360, 190, 80, 0], waits: LONG_WAITS, shrinks: LONG_SHRINKS };

/** Everything that differs between the big island and the compact 1 km valley. */
export interface WorldSpec {
  id: MapId; half: number; seed: number; zone: ZoneProfile;
  /** True: the coast fades into open sea. False: a ring of hills closes the map in and there is no sea. */
  sea: boolean;
  hills: { wavelength: number; amplitude: number; base: number; ridgeWavelength: number; maskWavelength: number; mountains: number };
  towns: Array<{ tier: Town['tier']; radius: number; count: number }>;
  townEdge: number; townGap: number; roadJitter: number; extraRoads: number; extraRoadReach: number;
  lakes: { count: number; edge: number; radius: [number, number]; height: [number, number]; gap: number };
  // radius is [minimum, random span]
  rivers: { count: number; edge: number; start: number };
  forestScale: number; fieldScale: number; rocks: number; rockEdge: number; wildCaches: number; wildEdge: number;
  spawnStep: number; spawnEdge: number; carStart: [number, number]; carStep: [number, number];
  /** Stair towers in the wild. */
  towers: number;
  /** Trees per forest patch relative to the island (1). */
  treeDensity?: number;
  /** Huge fenced compounds with the best loot, each with a bunker beneath it; and whether the cities have bunkers too. */
  hot?: Array<'base' | 'factory'>; bunkers?: boolean;
  /** How the map looks; absent keeps the original look. */
  theme?: MapTheme;
}

const ISLAND_SPEC: WorldSpec = {
  id: 'island', half: ISLAND_HALF, seed: ISLAND_SEED, zone: ISLAND_ZONE, sea: true,
  hills: { wavelength: 760, amplitude: 84, base: 30, ridgeWavelength: 1100, maskWavelength: 1500, mountains: 80 },
  towns: [{ tier: 'city', radius: 185, count: 2 }, { tier: 'town', radius: 125, count: 5 }, { tier: 'hamlet', radius: 70, count: 9 }],
  townEdge: 380, townGap: 260, roadJitter: 160, extraRoads: 4, extraRoadReach: 1300,
  lakes: { count: 7, edge: 520, radius: [55, 70], height: [8, 52], gap: 160 },
  rivers: { count: 3, edge: 700, start: 48 },
  forestScale: 1, fieldScale: 1, rocks: 520, rockEdge: 120, wildCaches: 90, wildEdge: 200,
  spawnStep: 190, spawnEdge: 260, carStart: [90, 80], carStep: [260, 120], towers: 8,
  hot: [], bunkers: true,
};

/** A 1 x 1 km valley ringed by hills: a few settlements, lakes, forest and a bot-heavy fight. */
const VALLEY_SPEC: WorldSpec = {
  id: 'valley', half: VALLEY_HALF, seed: VALLEY_SEED, zone: VALLEY_ZONE, sea: false,
  hills: { wavelength: 320, amplitude: 24, base: 26, ridgeWavelength: 460, maskWavelength: 640, mountains: 16 },
  towns: [{ tier: 'city', radius: 95, count: 1 }, { tier: 'town', radius: 65, count: 2 }, { tier: 'hamlet', radius: 40, count: 4 }],
  townEdge: 150, townGap: 70, roadJitter: 60, extraRoads: 2, extraRoadReach: 700,
  lakes: { count: 3, edge: 150, radius: [24, 12], height: [8, 46], gap: 50 },
  rivers: { count: 0, edge: 200, start: 40 },
  forestScale: 2.6, fieldScale: 0.55, rocks: 120, rockEdge: 50, wildCaches: 60, wildEdge: 70,
  spawnStep: 70, spawnEdge: 100, carStart: [50, 40], carStep: [150, 60], towers: 3,
};

/** A sun-baked red desert: dunes and mesas, a few oases, scrub instead of forest, towns far apart and long roads between them. */
const DESERT_SPEC: WorldSpec = {
  id: 'desert', half: DESERT_HALF, seed: DESERT_SEED, zone: DESERT_ZONE, sea: false,
  hills: { wavelength: 900, amplitude: 34, base: 22, ridgeWavelength: 1300, maskWavelength: 1800, mountains: 70 },
  towns: [{ tier: 'city', radius: 190, count: 2 }, { tier: 'town', radius: 120, count: 5 }, { tier: 'hamlet', radius: 65, count: 9 }],
  townEdge: 450, townGap: 320, roadJitter: 220, extraRoads: 5, extraRoadReach: 1700,
  lakes: { count: 4, edge: 600, radius: [30, 30], height: [10, 60], gap: 300 },
  rivers: { count: 0, edge: 700, start: 48 },
  forestScale: 1, fieldScale: 0.35, rocks: 1400, rockEdge: 150, wildCaches: 110, wildEdge: 250,
  spawnStep: 230, spawnEdge: 300, carStart: [100, 90], carStep: [280, 130], towers: 12,
  treeDensity: 0.12, hot: ['base', 'factory', 'base'], bunkers: true,
  theme: { sand: 0.9, grass: 0.08, tint: [1.08, 0.98, 0.84], haze: [0.87, 0.79, 0.64], fogDensity: 0.0026 },
};

/** Pine highlands: steep, forested, laced with rivers and lakes. Cover everywhere, long sight lines nowhere. */
const PINES_SPEC: WorldSpec = {
  id: 'pines', half: PINES_HALF, seed: PINES_SEED, zone: PINES_ZONE, sea: false,
  hills: { wavelength: 640, amplitude: 70, base: 34, ridgeWavelength: 900, maskWavelength: 1200, mountains: 120 },
  towns: [{ tier: 'city', radius: 170, count: 1 }, { tier: 'town', radius: 115, count: 5 }, { tier: 'hamlet', radius: 65, count: 11 }],
  townEdge: 420, townGap: 260, roadJitter: 200, extraRoads: 4, extraRoadReach: 1500,
  lakes: { count: 9, edge: 500, radius: [45, 50], height: [8, 70], gap: 150 },
  rivers: { count: 0, edge: 600, start: 55 },
  forestScale: 1.6, fieldScale: 0.7, rocks: 700, rockEdge: 130, wildCaches: 100, wildEdge: 220,
  spawnStep: 210, spawnEdge: 280, carStart: [100, 90], carStep: [300, 140], towers: 10,
  treeDensity: 1.5, hot: ['base', 'factory'], bunkers: true,
  theme: { sand: 0, grass: 1, tint: [0.8, 0.92, 0.82], haze: [0.7, 0.79, 0.83], fogDensity: 0.0034 },
};

/** A dense metropolis: five cities close together, tall blocks, parks between them. Short sight lines and constant fighting. */
const METRO_SPEC: WorldSpec = {
  id: 'metro', half: METRO_HALF, seed: METRO_SEED, zone: METRO_ZONE, sea: false,
  hills: { wavelength: 600, amplitude: 20, base: 24, ridgeWavelength: 700, maskWavelength: 900, mountains: 14 },
  towns: [{ tier: 'city', radius: 210, count: 5 }, { tier: 'town', radius: 120, count: 4 }, { tier: 'hamlet', radius: 60, count: 3 }],
  townEdge: 260, townGap: 70, roadJitter: 90, extraRoads: 7, extraRoadReach: 1200,
  lakes: { count: 3, edge: 350, radius: [40, 30], height: [8, 40], gap: 120 },
  rivers: { count: 0, edge: 400, start: 30 },
  forestScale: 1.8, fieldScale: 0.4, rocks: 160, rockEdge: 80, wildCaches: 50, wildEdge: 120,
  spawnStep: 140, spawnEdge: 200, carStart: [60, 50], carStep: [180, 80], towers: 14,
  treeDensity: 0.5, hot: ['factory', 'base'], bunkers: true,
  theme: { sand: 0, grass: 0.4, tint: [0.92, 0.95, 0.92], haze: [0.74, 0.77, 0.8], fogDensity: 0.003 },
};

/** Every open map's recipe, by id. */
const SPECS: Partial<Record<MapId, WorldSpec>> = { island: ISLAND_SPEC, valley: VALLEY_SPEC, desert: DESERT_SPEC, pines: PINES_SPEC, metro: METRO_SPEC };

export { WALL_THICKNESS, HOUSE_HEIGHT, DOOR_WIDTH, DOOR_HEIGHT };

export const obstacleBase = (o: Obstacle): number => o.base ?? 0;
export const obstacleBottom = (o: Obstacle): number => obstacleBase(o) + (o.bottom ?? 0);
export const obstacleTop = (o: Obstacle): number => obstacleBase(o) + o.height;

export function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function lattice(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const smooth = (t: number) => t * t * (3 - 2 * t);
function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const u = smooth(x - ix), v = smooth(z - iz);
  const a = lattice(ix, iz, seed), b = lattice(ix + 1, iz, seed), c = lattice(ix, iz + 1, seed), d = lattice(ix + 1, iz + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, z: number, seed: number, octaves: number): number {
  let amplitude = 0.5, frequency = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * frequency, z * frequency, seed + i * 31) * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return sum / norm;
}
/** Where forests grow: used for tree placement and to darken the forest floor. */
/** Forest patches scale with the map, so a 1 km valley still has woods; set whenever a map is handed out. */
let activeForestScale = 1;
export const forestNoise = (x: number, z: number): number => fbm(x * activeForestScale / 420, z * activeForestScale / 420, 203, 3);
/** Low-frequency noise for ground colour variation (rendering only). */
export const groundNoise = (x: number, z: number): number => fbm(x / 90, z / 90, 313, 3);
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const distance = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);

export const SEA_LEVEL = 0;
const SEA_FLOOR = -7;

/** 1 well inland, 0 open sea; a wobbling shoreline roughly follows the square border. */
function coastFor(spec: WorldSpec): (x: number, z: number) => number {
  if (!spec.sea) return () => 1;
  return (x, z) => {
    const edge = 1 - Math.max(Math.abs(x), Math.abs(z)) / spec.half;
    const wobble = (fbm(x / 520, z / 520, 7, 3) - 0.5) * 0.26;
    return smooth(clamp01((edge + wobble - 0.05) / 0.15));
  };
}
export const coastMask = coastFor(ISLAND_SPEC);

/** Rolling hills with a few ridged mountains; fading into the sea at the coast, or ringed by hills when there is no sea. */
function heightFor(spec: WorldSpec, coast: (x: number, z: number) => number): (x: number, z: number) => number {
  const h = spec.hills;
  return (x, z) => {
    const hills = (fbm(x / h.wavelength, z / h.wavelength, 11, 5) - 0.5) * h.amplitude + h.base;
    const ridge = 1 - Math.abs(2 * fbm(x / h.ridgeWavelength, z / h.ridgeWavelength, 47, 3) - 1);
    const mask = smooth(clamp01((fbm(x / h.maskWavelength, z / h.maskWavelength, 91, 2) - 0.48) * 5));
    let land = hills + ridge * ridge * mask * h.mountains;
    if (!spec.sea) {
      // No sea: the map edge climbs into hills that wall the valley in.
      const edge = Math.max(Math.abs(x), Math.abs(z)) / spec.half;
      land += smooth(clamp01((edge - 0.7) / 0.3)) * (spec.id === 'valley' ? 38 : 55);
    }
    const m = coast(x, z);
    return land * m + SEA_FLOOR * (1 - m);
  };
}

const TOWN_NAMES = ['Bến Đá', 'Thung Lũng', 'Cầu Sắt', 'Đồi Thông', 'Mỏ Than', 'Ga Cũ', 'Cảng Nhỏ', 'Suối Cạn', 'Nhà Máy', 'Đèo Gió', 'Chợ Đêm', 'Xóm Cát', 'Trạm Gác', 'Hồ Gương', 'Vườn Cam', 'Cồn Sỏi', 'Lò Gạch', 'Bãi Đá'];

interface Plateau { x: number; z: number; height: number; inner: number; outer: number }

export interface IslandData {
  world: Omit<WorldConfig, 'obstacles'> & { obstacles: Obstacle[] };
  terrain: (x: number, z: number) => number;
}

const cache = new Map<MapId, IslandData>();

function placeTowns(random: () => number, spec: WorldSpec, coast: (x: number, z: number) => number, reserved: readonly HotArea[] = []): Town[] {
  const towns: Town[] = [];
  let name = 0;
  for (const { tier, radius, count } of spec.towns) {
    for (let placed = 0, attempts = 0; placed < count && attempts < 600; attempts++) {
      const x = (random() * 2 - 1) * (spec.half - spec.townEdge), z = (random() * 2 - 1) * (spec.half - spec.townEdge);
      if (towns.some(t => distance(x, z, t.x, t.z) < t.radius + radius + spec.townGap)) continue;
      if (reserved.some(h => distance(x, z, h.x, h.z) < h.radius + radius * 1.7 + 60)) continue;
      if (coast(x, z) < 0.995 || coast(x + radius * 2, z) < 0.99 || coast(x - radius * 2, z) < 0.99 || coast(x, z + radius * 2) < 0.99 || coast(x, z - radius * 2) < 0.99) continue;
      towns.push({ id: `town-${towns.length}`, name: TOWN_NAMES[name++ % TOWN_NAMES.length], x, z, radius, tier });
      placed++;
    }
  }
  return towns;
}

function generate(spec: WorldSpec): IslandData {
  const half = spec.half;
  const coast = coastFor(spec);
  const rawHeight = heightFor(spec, coast);
  const random = mulberry32(spec.seed);
  const reserved = spec.id === 'island' ? ISLAND_COMPOUNDS : [];
  const towns = placeTowns(random, spec, coast, reserved);

  const obstacles: Obstacle[] = [];
  const floors: Floor[] = [];
  const proxies: Obstacle[] = [];
  const lootSpots: LootSpot[] = [];
  const roads: RoadSegment[] = [];
  const hots: HotArea[] = reserved.map(h => ({ ...h }));
  const nearTown = (x: number, z: number, margin: number) => towns.some(t => distance(x, z, t.x, t.z) < t.radius + margin) || hots.some(h => distance(x, z, h.x, h.z) < h.radius + margin);

  // Roads: link every town to its nearest already-linked neighbour, then add a few extra loops.
  const linked = [towns[0]];
  const pending = towns.slice(1);
  const addRoad = (a: Town, b: Town) => {
    let mx = (a.x + b.x) / 2 + (random() - 0.5) * spec.roadJitter, mz = (a.z + b.z) / 2 + (random() - 0.5) * spec.roadJitter;
    for (const h of reserved) if (Math.abs(mx - h.x) < 150 && Math.abs(mz - h.z) < 150) mz = h.z + (mz < h.z ? -150 : 150);
    roads.push({ a: { x: a.x, z: a.z }, b: { x: mx, z: mz }, width: 7 }, { a: { x: mx, z: mz }, b: { x: b.x, z: b.z }, width: 7 });
  };
  while (pending.length) {
    let best: [Town, Town] | null = null, bestDistance = Infinity;
    for (const p of pending) for (const l of linked) {
      const d = distance(p.x, p.z, l.x, l.z);
      if (d < bestDistance) { bestDistance = d; best = [l, p]; }
    }
    if (!best) break;
    addRoad(best[0], best[1]);
    linked.push(best[1]);
    pending.splice(pending.indexOf(best[1]), 1);
  }
  for (let i = 0; i < spec.extraRoads; i++) {
    const a = towns[Math.floor(random() * towns.length)], b = towns[Math.floor(random() * towns.length)];
    if (a !== b && distance(a.x, a.z, b.x, b.z) < spec.extraRoadReach) addRoad(a, b);
  }
  // Hot areas: huge fenced compounds on level ground away from the towns, each joined to the nearest town by a road. They use their
  // own random stream, so adding them leaves the rest of the map where it was.
  const hotRandom = mulberry32(spec.seed ^ 0x5eed5);
  const HOT_NAMES = { base: ['Căn cứ Đại Bàng', 'Căn cứ Thiết Giáp', 'Căn cứ Sắt Đá', 'Căn cứ Hắc Ưng'], factory: ['Khu công nghiệp Thép', 'Nhà máy Hóa Chất', 'Khu kho vận Cảng', 'Nhà máy Điện'] };
  const hotUsed = { base: 0, factory: 0 };
  for (const kind of spec.hot ?? []) {
    const radius = kind === 'base' ? 132 : 112;
    for (let attempt = 0; attempt < 500; attempt++) {
      const x = (hotRandom() * 2 - 1) * (half - spec.townEdge - radius * 0.4), z = (hotRandom() * 2 - 1) * (half - spec.townEdge - radius * 0.4);
      if (coast(x, z) < 0.995 || [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ox, oz]) => coast(x + ox * radius, z + oz * radius) < 0.99)) continue;
      if (towns.some(t => distance(x, z, t.x, t.z) < t.radius + radius + 90) || hots.some(h => distance(x, z, h.x, h.z) < h.radius + radius + 180)) continue;
      const level = rawHeight(x, z);
      if (level < 6 || [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]].some(([ox, oz]) => Math.abs(rawHeight(x + ox * radius * 0.8, z + oz * radius * 0.8) - level) > 14)) continue;
      const names = HOT_NAMES[kind];
      hots.push({ id: `hot-${hots.length}`, name: names[hotUsed[kind]++ % names.length], kind, x, z, radius });
      break;
    }
  }
  for (const hot of hots) {
    const gate = isCompound(hot.kind) ? compoundGate(hot.kind) : hot.kind === 'base' ? 100 : 90;
    let nearest = towns[0];
    for (const t of towns) if (distance(hot.x, hot.z, t.x, t.z) < distance(hot.x, hot.z, nearest.x, nearest.z)) nearest = t;
    const dir = nearest.x < hot.x ? -1 : 1;
    // The road runs straight through the gate and well clear of the fence before it turns towards the town.
    const inside = { x: hot.x + dir * (gate - 5), z: hot.z }, from = { x: hot.x + dir * (gate + 26), z: hot.z };
    // The bend never doubles back past the gate, so the road cannot cut across the compound's fence.
    const bend = (from.x + nearest.x) / 2 + (hotRandom() - 0.5) * spec.roadJitter, mz = (from.z + nearest.z) / 2 + (hotRandom() - 0.5) * spec.roadJitter;
    const mx = dir > 0 ? Math.max(bend, from.x + 8) : Math.min(bend, from.x - 8);
    roads.push({ a: inside, b: from, width: 7 }, { a: from, b: { x: mx, z: mz }, width: 7 }, { a: { x: mx, z: mz }, b: { x: nearest.x, z: nearest.z }, width: 7 });
  }
  if (reserved.length) {
    const routed = routeCompoundRoads(roads, reserved);
    roads.splice(0, roads.length, ...routed);
  }
  const roadDistance = (x: number, z: number): number => {
    let best = Infinity;
    for (const road of roads) {
      const dx = road.b.x - road.a.x, dz = road.b.z - road.a.z;
      const t = clamp01(((x - road.a.x) * dx + (z - road.a.z) * dz) / (dx * dx + dz * dz || 1));
      best = Math.min(best, distance(x, z, road.a.x + dx * t, road.a.z + dz * t));
    }
    return best;
  };

  // Water. Lakes avoid roads and towns; rivers follow the slope down to the sea and are shallow enough to wade.
  const segmentDistance = (x: number, z: number, ax: number, az: number, bx: number, bz: number): number => {
    const dx = bx - ax, dz = bz - az;
    const t = clamp01(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1));
    return distance(x, z, ax + dx * t, az + dz * t);
  };
  /** A footprint centred here, reaching `reach` metres out, touches a road. */
  const onRoad = (x: number, z: number, reach: number): boolean =>
    roads.some(road => segmentDistance(x, z, road.a.x, road.a.z, road.b.x, road.b.z) < road.width / 2 + reach);
  const lakes: Lake[] = [];
  for (let attempt = 0; attempt < 500 && lakes.length < spec.lakes.count; attempt++) {
    const x = (random() * 2 - 1) * (half - spec.lakes.edge), z = (random() * 2 - 1) * (half - spec.lakes.edge);
    const r = spec.lakes.radius[0] + random() * spec.lakes.radius[1];
    const h = rawHeight(x, z);
    if (coast(x, z) < 0.99 || h > spec.lakes.height[1] || h < spec.lakes.height[0]) continue;
    if (towns.some(t => distance(x, z, t.x, t.z) < t.radius * 1.9 + r * 1.6) || hots.some(h => distance(x, z, h.x, h.z) < h.radius * 1.5 + r * 1.6)) continue;
    if (lakes.some(l => distance(x, z, l.x, l.z) < l.r + r + spec.lakes.gap)) continue;
    if (roads.some(road => segmentDistance(x, z, road.a.x, road.a.z, road.b.x, road.b.z) < r * 1.9 + 14)) continue;
    lakes.push({ x, z, r, level: h - 0.4 });
  }
  const rivers: River[] = [];
  for (let attempt = 0; attempt < 600 && rivers.length < spec.rivers.count; attempt++) {
    let x = (random() * 2 - 1) * (half - spec.rivers.edge), z = (random() * 2 - 1) * (half - spec.rivers.edge);
    if (rawHeight(x, z) < spec.rivers.start || coast(x, z) < 0.99) continue;
    const points: River['points'] = [];
    let level = rawHeight(x, z) - 0.8, hx = 0, hz = 0, reachedSea = false;
    for (let i = 0; i < 220; i++) {
      const h = rawHeight(x, z);
      level = Math.min(level - 0.12, h - 0.8);
      points.push({ x, z, level });
      if (h < 2.5) { reachedSea = points.length > 25; break; }
      const gx = (rawHeight(x + 10, z) - rawHeight(x - 10, z)) / 20, gz = (rawHeight(x, z + 10) - rawHeight(x, z - 10)) / 20;
      const length = Math.hypot(gx, gz) || 1;
      // Blend steepest descent with the previous heading so the channel meanders smoothly.
      // A gentle pull toward the nearest shore keeps a river from stalling in a hollow.
      const pullX = Math.abs(x) > Math.abs(z) ? Math.sign(x) : 0, pullZ = Math.abs(z) >= Math.abs(x) ? Math.sign(z) : 0;
      hx = hx * 0.55 + (-gx / length) * 0.33 + pullX * 0.12; hz = hz * 0.55 + (-gz / length) * 0.33 + pullZ * 0.12;
      const hl = Math.hypot(hx, hz) || 1;
      x += hx / hl * 40; z += hz / hl * 40;
      if (Math.abs(x) > half - 40 || Math.abs(z) > half - 40) break;
    }
    if (!reachedSea) continue;
    const blocked = points.some(p => towns.some(t => distance(p.x, p.z, t.x, t.z) < t.radius * 1.75 + 25) || hots.some(h => distance(p.x, p.z, h.x, h.z) < h.radius * (isCompound(h.kind) ? 1.05 : 1.5) + 25) || lakes.some(l => distance(p.x, p.z, l.x, l.z) < l.r * 1.9 + 30));
    if (blocked) continue;
    rivers.push({ points, width: 9 + random() * 6 });
  }
  // Four reserved destinations can block the long downhill channels. Keep a shallow coastal stream in the remaining rim.
  if (reserved.length && !rivers.length) {
    for (const axis of ['x', 'z'] as const) for (const side of [-1, 1]) for (let offset = -1200; offset <= 1200 && !rivers.length; offset += 100) {
      const points: River['points'] = [];
      let level = Infinity;
      for (let i = 0; i < 38; i++) {
        const along = side * (half - 550 + i * 20), across = offset + Math.sin(i * 0.18) * 14;
        const x = axis === 'x' ? along : across, z = axis === 'z' ? along : across;
        level = Math.min(level - 0.06, rawHeight(x, z) - 0.65);
        points.push({ x, z, level });
        if (rawHeight(x, z) < 2.5) break;
      }
      if (points.length < 12 || points.some(p => towns.some(t => distance(p.x, p.z, t.x, t.z) < t.radius * 1.75 + 25)
        || hots.some(h => distance(p.x, p.z, h.x, h.z) < h.radius * 1.05 + 25) || lakes.some(l => distance(p.x, p.z, l.x, l.z) < l.r * 1.9 + 30))) continue;
      rivers.push({ points, width: 10 });
    }
  }
  const BANK = 26;
  interface RiverSegment { ax: number; az: number; bx: number; bz: number; la: number; lb: number; half: number }
  const riverGrid = new SpatialGrid<RiverSegment>(64);
  for (const river of rivers) {
    for (let i = 0; i + 1 < river.points.length; i++) {
      const a = river.points[i], b = river.points[i + 1], pad = river.width / 2 + BANK;
      riverGrid.insertBox({ ax: a.x, az: a.z, bx: b.x, bz: b.z, la: a.level, lb: b.level, half: river.width / 2 }, Math.min(a.x, b.x) - pad, Math.min(a.z, b.z) - pad, Math.max(a.x, b.x) + pad, Math.max(a.z, b.z) + pad);
    }
  }
  const carve = (x: number, z: number, natural: number): number => {
    let height = natural;
    let strongest = 0;
    riverGrid.queryBox(x, z, x, z, seg => {
      const dx = seg.bx - seg.ax, dz = seg.bz - seg.az;
      const t = clamp01(((x - seg.ax) * dx + (z - seg.az) * dz) / (dx * dx + dz * dz || 1));
      const d = distance(x, z, seg.ax + dx * t, seg.az + dz * t);
      if (d > seg.half + BANK) return;
      const w = 1 - smooth(clamp01((d - seg.half) / BANK));
      if (w > strongest) { strongest = w; height = natural + (seg.la + (seg.lb - seg.la) * t - 0.55 - natural) * w; }
    });
    if (strongest > 0) {
      // Where a road crosses a river the ground stays up as a causeway, so the road is not drowned or cut by the channel.
      const along = roadDistance(x, z);
      if (along < 16) height = natural + (height - natural) * smooth(clamp01((along - 5) / 11));
    }
    for (const lake of lakes) {
      const dx = x - lake.x, dz = z - lake.z;
      if (Math.abs(dx) > lake.r * 1.9 || Math.abs(dz) > lake.r * 1.9) continue;
      const d = Math.hypot(dx, dz);
      if (d >= lake.r * 1.9) continue;
      const w = 1 - smooth(clamp01((d - lake.r * 0.7) / (lake.r * 1.2)));
      const bed = d < lake.r * 0.95 ? lake.level - 3.5 * (1 - smooth(d / (lake.r * 0.95))) : lake.level;
      if (w > strongest) { strongest = w; height = natural + (bed - natural) * w; }
    }
    return height;
  };

  // Towns sit on flattened plateaus so houses, streets and floors share one level.
  const plateaus: Plateau[] = [...towns.map(town => ({
    x: town.x, z: town.z, height: rawHeight(town.x, town.z), inner: town.radius * 0.95, outer: town.radius * 1.7,
  })), ...hots.map(hot => ({ x: hot.x, z: hot.z, height: rawHeight(hot.x, hot.z), inner: hot.radius * 0.95, outer: hot.radius * 1.55 }))];
  const analytic = (x: number, z: number): number => {
    let height = carve(x, z, rawHeight(x, z));
    for (const plateau of plateaus) {
      const dx = x - plateau.x, dz = z - plateau.z;
      if (Math.abs(dx) > plateau.outer || Math.abs(dz) > plateau.outer) continue;
      const d = Math.hypot(dx, dz);
      if (d >= plateau.outer) continue;
      const blend = 1 - smooth(clamp01((d - plateau.inner) / (plateau.outer - plateau.inner)));
      height += (plateau.height - height) * blend;
    }
    return height;
  };
  // Heights are looked up constantly (movement, line of sight, bullets), so they are served from lazily filled
  // 64 m tiles on a 2 m lattice with bilinear interpolation instead of re-evaluating the noise each time.
  const TILE_CELLS = 32, LATTICE = 2, SIDE = TILE_CELLS + 1;
  const tiles = new Map<number, Float32Array>();
  const terrain = (x: number, z: number): number => {
    const fx = x / LATTICE, fz = z / LATTICE;
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = Math.floor(ix / TILE_CELLS), tz = Math.floor(iz / TILE_CELLS);
    const key = (tx + 512) * 1024 + (tz + 512);
    let tile = tiles.get(key);
    if (!tile) {
      tile = new Float32Array(SIDE * SIDE);
      for (let j = 0; j < SIDE; j++) for (let i = 0; i < SIDE; i++) tile[j * SIDE + i] = analytic((tx * TILE_CELLS + i) * LATTICE, (tz * TILE_CELLS + j) * LATTICE);
      tiles.set(key, tile);
    }
    const lx = ix - tx * TILE_CELLS, lz = iz - tz * TILE_CELLS, u = fx - ix, v = fz - iz;
    const a = tile[lz * SIDE + lx], b = tile[lz * SIDE + lx + 1], c = tile[(lz + 1) * SIDE + lx], d = tile[(lz + 1) * SIDE + lx + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  /** Dry, solid ground clear of the shore and of lakes. */
  const landOk = (x: number, z: number, margin = 0): boolean => {
    if (terrain(x, z) < 1.8 + margin * 0.3) return false;
    return !lakes.some(l => distance(x, z, l.x, l.z) < l.r * 1.15 + margin);
  };
  const riverNear = (x: number, z: number, margin: number): boolean => {
    let near = false;
    riverGrid.queryBox(x, z, x, z, seg => { if (segmentDistance(x, z, seg.ax, seg.az, seg.bx, seg.bz) < seg.half + margin) { near = true; return true; } });
    return near;
  };

  const addParts = (parts: Parts) => { obstacles.push(...parts.obstacles); floors.push(...parts.floors); lootSpots.push(...parts.loot); proxies.push(...(parts.proxies ?? [])); };
  /** Ground under a footprint is level enough to build a big block on. */
  const flat = (x: number, z: number, w: number, d: number, base: number, tolerance = 0.8): boolean => {
    for (const ox of [-1, -0.5, 0, 0.5, 1]) for (const oz of [-1, -0.5, 0, 0.5, 1]) if (Math.abs(terrain(x + ox * w / 2, z + oz * d / 2) - base) >= tolerance) return false;
    return true;
  };
  /** Room for a footprint: nothing but trees close to it, and not across the main street. */
  const clearFor = (x: number, z: number, w: number, d: number, margin: number): boolean =>
    !obstacles.some(o => o.kind !== 'tree' && Math.abs(x - o.x) < o.width / 2 + w / 2 + margin && Math.abs(z - o.z) < o.depth / 2 + d / 2 + margin)
    && !obstacles.some(o => o.kind === 'tree' && Math.abs(x - o.x) < w / 2 + 1.5 && Math.abs(z - o.z) < d / 2 + 1.5);

  // Town layout: a main street with houses on both sides; cities add apartment blocks you can climb.
  const tierOf = { city: 3, town: 2, hamlet: 1 } as const;
  for (const town of towns) {
    const base = terrain(town.x, town.z);
    const alongX = random() < 0.5;
    const rows = town.tier === 'city' ? 3 : town.tier === 'town' ? 2 : 1;
    let houseIndex = 0;
    // Street: the main street the houses face (it stays clear of buildings, so cars can start on it).
    const reach = town.radius * 0.95;
    roads.push(alongX
      ? { a: { x: town.x - reach, z: town.z }, b: { x: town.x + reach, z: town.z }, width: 9 }
      : { a: { x: town.x, z: town.z - reach }, b: { x: town.x, z: town.z + reach }, width: 9 });
    for (let row = -rows; row <= rows; row++) {
      if (row === 0) continue;
      const side = Math.sign(row);
      const offset = side * (14 + (Math.abs(row) - 1) * 46);
      for (let along = -town.radius * 0.85; along < town.radius * 0.85;) {
        // In a city one slot in five is an apartment block: longer than a house, so the slot is sized for it.
        const block = town.tier === 'city' && random() < 0.2;
        const width = block ? 26 : 8 + Math.floor(random() * 8), depth = block ? 14 : 7 + Math.floor(random() * 7);
        const cx = alongX ? town.x + along + width / 2 : town.x + offset + side * depth / 2;
        const cz = alongX ? town.z + offset + side * depth / 2 : town.z + along + width / 2;
        along += width + 5 + random() * 10;
        if (Math.hypot(cx - town.x, cz - town.z) > town.radius || random() < 0.12) continue;
        const id = `${town.id}-h${houseIndex++}`;
        const w = alongX ? width : depth, d = alongX ? depth : width;
        const mirror = random() < 0.5, storeys = random() < 0.7 ? 3 : 2;
        // A road between towns runs straight to the centre, so it must not go through a house: skip the plot.
        if (onRoad(cx, cz, Math.hypot(w, d) / 2)) { if (!block) { random(); random(); } continue; }
        if (block && flat(cx, cz, w, d, base)) {
          addParts(placeParts(buildTower({ id, width: 26, depth: 14, storeys, base, flavor: 'apartment' }), cx, cz, !alongX, mirror));
          continue;
        }
        const tier = Math.max(1, Math.min(3, tierOf[town.tier] - (random() < 0.4 ? 1 : 0))) as 1 | 2 | 3;
        // Preserve the map RNG sequence: floor plans vary deterministically with the plot index.
        const layout = houseIndex % 3 === 0 ? 'wing' : houseIndex % 3 === 1 && width >= 10 ? 'longhouse' : 'cottage';
        const style = town.tier === 'hamlet' && houseIndex % 7 === 0 ? 'mill' : houseIndex % 3 === 0 ? 'brick' : houseIndex % 3 === 1 ? 'timber' : 'hipped';
        const home = buildHouse({ id, width, depth, base, tier, layout, style });
        if (side < 0) {
          for (const part of home.obstacles) part.z = -part.z;
          for (const spot of home.loot) spot.z = -spot.z;
        }
        addParts(placeParts(home, cx, cz, !alongX, mirror));
        random(); // Former optional crate roll; keep later town and vehicle placement stable.
      }
    }
    for (let i = 0; i < town.radius / 12; i++) {
      const angle = random() * Math.PI * 2, r = random() * town.radius * 0.9;
      const x = town.x + Math.cos(angle) * r, z = town.z + Math.sin(angle) * r;
      if (Math.abs(alongX ? z - town.z : x - town.x) < 9) continue;
      if (obstacles.some(o => o.kind === 'roof' && Math.abs(x - o.x) < o.width / 2 + 2 && Math.abs(z - o.z) < o.depth / 2 + 2)) continue;
      const width = 2 + random() * 2, depth = 2 + random() * 2, height = 1.2 + random() * 0.8;
      if (onRoad(x, z, Math.max(width, depth))) continue;
      // A stair flight can protrude past a house's roof. Random street crates must leave its approach clear too.
      if (floors.some(f => Math.abs(x - f.x) < (width + f.width) / 2 + 1 && Math.abs(z - f.z) < (depth + f.depth) / 2 + 1)) continue;
      obstacles.push({ id: `${town.id}-c${i}`, x, z, width, depth, height, kind: 'crate', base });
      // The crate's loot lies on the ground beside it (inside the crate it would be hidden), on the first clear side.
      const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([sx, sz]) => ({ x: x + sx * (width / 2 + 1.4), z: z + sz * (depth / 2 + 1.4) }));
      const beside = sides.find(p => !obstacles.some(o => Math.abs(p.x - o.x) < o.width / 2 + 0.6 && Math.abs(p.z - o.z) < o.depth / 2 + 0.6)) ?? sides[0];
      lootSpots.push({ x: beside.x, z: beside.z, y: base, tier: 1 });
    }
  }

  // Landmarks: every city gets a hospital and a warehouse, every town a warehouse (a big building you can fight inside).
  const cityIndex = new Map<string, number>();
  for (const town of towns) {
    if (town.tier === 'hamlet') continue;
    const wanted: Array<'hospital' | 'hangar'> = town.tier === 'city' ? ['hospital', 'hangar'] : ['hangar'];
    for (const kind of wanted) {
      const swapSpot = random() < 0.5;
      const w = kind === 'hospital' ? 24 : 30, d = kind === 'hospital' ? 14 : 18;
      for (let attempt = 0; attempt < 60; attempt++) {
        const angle = random() * Math.PI * 2, r = town.radius * (0.35 + random() * 0.55);
        const x = town.x + Math.cos(angle) * r, z = town.z + Math.sin(angle) * r;
        const fw = swapSpot ? d : w, fd = swapSpot ? w : d;
        const base = terrain(x, z);
        if (Math.hypot(x - town.x, z - town.z) + Math.max(fw, fd) / 2 > town.radius * 0.95) continue;
        if (!flat(x, z, fw, fd, base) || !clearFor(x, z, fw, fd, 6) || !landOk(x, z, 4) || riverNear(x, z, 12)) continue;
        // Keep the main streets clear: streets are drawn as roads, so stay off every road segment.
        if (roads.some(road => segmentDistance(x, z, road.a.x, road.a.z, road.b.x, road.b.z) < road.width / 2 + Math.max(fw, fd) / 2 + 2)) continue;
        const id = `${town.id}-${kind}`;
        const parts = kind === 'hospital' ? buildTower({ id, width: w, depth: d, storeys: 2, base, flavor: 'hospital' }) : buildHangar({ id, width: w, depth: d, base });
        addParts(placeParts(parts, x, z, swapSpot, random() < 0.5));
        cityIndex.set(id, 1);
        break;
      }
    }
  }
  // The hot areas' buildings and the sheds over their bunker stairs; the cities get a pair of sheds too.
  interface BunkerSite { id: string; x: number; z: number; width: number; depth: number; hall: number; label: string; sheds: Array<{ x: number; z: number; base: number; door: 'n' | 's' | 'e' | 'w' }> }
  const bunkerSites: BunkerSite[] = [];
  const hotCars: Array<{ x: number; z: number; yaw: number }> = [];
  for (const hot of hots) {
    const level = terrain(hot.x, hot.z);
    if (isCompound(hot.kind)) {
      const plan = buildCompound(hot.kind, hot.id, hot.x, hot.z, level);
      addParts(plan.parts); hotCars.push(...plan.vehicles);
      const sheds = [-1, 1].map(side => ({ x: hot.x + side * 136, z: hot.z + side * 20, base: level, door: (side < 0 ? 'e' : 'w') as 'e' | 'w' }));
      for (const [i, shed] of sheds.entries()) obstacles.push(...buildShed(`${hot.id}-shed${i}`, shed.x, shed.z, level, shed.door));
      bunkerSites.push({ id: `bunker-${hot.id}`, x: hot.x, z: hot.z, width: 72, depth: 48, hall: 9, label: `hầm ${hot.name}`, sheds });
      continue;
    }
    const plan = hot.kind === 'base' ? planBase(hot.id, hot.x, hot.z, level) : planFactory(hot.id, hot.x, hot.z, level);
    addParts(plan.parts);
    obstacles.push(...shedObstacles(hot.id, plan, level));
    hotCars.push(...plan.vehicles);
    bunkerSites.push({ id: `bunker-${hot.id}`, x: hot.x, z: hot.z, width: hot.kind === 'base' ? 96 : 72, depth: hot.kind === 'base' ? 64 : 48, hall: hot.kind === 'base' ? 12 : 9, label: `hầm ${hot.name}`, sheds: plan.sheds.map(shed => ({ ...shed, base: level })) });
  }
  if (spec.bunkers) for (const town of towns) {
    if (town.tier !== 'city') continue;
    const sheds: BunkerSite['sheds'] = [];
    for (const turn of [0.5, 0.5 + Math.PI]) for (let attempt = 0; attempt < 60 && sheds.length < (turn === 0.5 ? 1 : 2); attempt++) {
      const angle = turn + (hotRandom() - 0.5) * 1.4, r = town.radius * (0.5 + hotRandom() * 0.35);
      const x = town.x + Math.cos(angle) * r, z = town.z + Math.sin(angle) * r, level = terrain(x, z);
      if (!flat(x, z, 6, 6, level, 0.6) || !clearFor(x, z, 6, 6, 5) || roads.some(road => segmentDistance(x, z, road.a.x, road.a.z, road.b.x, road.b.z) < road.width / 2 + 7)) continue;
      const dx = town.x - x, dz = town.z - z;
      const door = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'e' : 'w') : (dz > 0 ? 'n' : 's');
      obstacles.push(...buildShed(`${town.id}-shed${sheds.length}`, x, z, level, door));
      sheds.push({ x, z, base: level, door });
    }
    if (sheds.length >= 2) bunkerSites.push({ id: `bunker-${town.id}`, x: town.x, z: town.z, width: 64, depth: 44, hall: 9, label: `hầm ${town.name}`, sheds });
  }

  // Watch towers: stair towers out in the wild, on level ground, for sniping and a view.
  for (let made = 0, tries = 0; made < spec.towers && tries < 400; tries++) {
    const x = (random() * 2 - 1) * (half - spec.wildEdge), z = (random() * 2 - 1) * (half - spec.wildEdge);
    const base = terrain(x, z);
    const swapSpot = random() < 0.5, fw = swapSpot ? 14 : 6.4, fd = swapSpot ? 6.4 : 14;
    if (nearTown(x, z, 30) || !landOk(x, z, 6) || riverNear(x, z, 12) || !flat(x, z, fw, fd, base, 0.2) || !clearFor(x, z, fw, fd, 8)) continue;
    if (roads.some(road => segmentDistance(x, z, road.a.x, road.a.z, road.b.x, road.b.z) < road.width / 2 + 12)) continue;
    addParts(placeParts(buildTower({ id: `tower-${made}`, width: 6.4, depth: 14, storeys: 3, base, flavor: 'tower' }), x, z, swapSpot, random() < 0.5));
    made++;
  }

  // Farmland patches near the smaller settlements.
  const fields: Field[] = [];
  for (const town of towns) {
    if (town.tier === 'city') continue;
    for (let made = 0, tries = 0; made < (town.tier === 'town' ? 3 : 2) && tries < 40; tries++) {
      const angle = random() * Math.PI * 2, d0 = town.radius * (1.9 + random() * 0.9);
      const x = town.x + Math.cos(angle) * d0, z = town.z + Math.sin(angle) * d0, w = (55 + random() * 70) * spec.fieldScale, d = (45 + random() * 60) * spec.fieldScale;
      const corners = [[0, 0], [w / 2, d / 2], [-w / 2, d / 2], [w / 2, -d / 2], [-w / 2, -d / 2]];
      if (!corners.every(([ox, oz]) => landOk(x + ox, z + oz, 3) && !riverNear(x + ox, z + oz, 10) && !nearTown(x + ox, z + oz, 10))) continue;
      if (Math.abs(terrain(x + w / 2, z) - terrain(x - w / 2, z)) > 7 || Math.abs(terrain(x, z + d / 2) - terrain(x, z - d / 2)) > 7) continue;
      if (fields.some(f => Math.abs(f.x - x) < (f.w + w) / 2 + 10 && Math.abs(f.z - z) < (f.d + d) / 2 + 10)) continue;
      if (corners.some(([ox, oz]) => onRoad(x + ox, z + oz, 6)) || onRoad(x, z, Math.hypot(w, d) / 2)) continue;
      fields.push({ x, z, w, d, crop: Math.floor(random() * 3) as 0 | 1 | 2 });
      made++;
    }
  }
  const inField = (x: number, z: number, margin: number) => fields.some(f => Math.abs(x - f.x) < f.w / 2 + margin && Math.abs(z - f.z) < f.d / 2 + margin);

  // Wilderness: boulders, forest and lone supply caches.
  const wildernessSolids = new SpatialGrid<Obstacle>(32);
  const reserveWilderness = (o: Obstacle) => wildernessSolids.insertBox(o, o.x - o.width / 2, o.z - o.depth / 2, o.x + o.width / 2, o.z + o.depth / 2);
  obstacles.forEach(reserveWilderness);
  const wildernessBlocked = (x: number, z: number, w: number, d: number, margin: number): boolean => {
    let blocked = false;
    wildernessSolids.queryBox(x - w / 2 - margin, z - d / 2 - margin, x + w / 2 + margin, z + d / 2 + margin, o => {
      if (Math.abs(x - o.x) < (w + o.width) / 2 + margin && Math.abs(z - o.z) < (d + o.depth) / 2 + margin) { blocked = true; return true; }
    });
    return blocked;
  };
  for (let i = 0; i < spec.rocks; i++) {
    const x = (random() * 2 - 1) * (half - spec.rockEdge), z = (random() * 2 - 1) * (half - spec.rockEdge);
    if (nearTown(x, z, 20) || roadDistance(x, z) < 8 || !landOk(x, z, 2) || riverNear(x, z, 3)) continue;
    const w = 3 + random() * 6, d = 3 + random() * 6, h = 1.8 + random() * 3.5;
    if (wildernessBlocked(x, z, w, d, 2)) continue;
    const rock: Obstacle = { id: `rock-${i}`, x, z, width: w, depth: d, height: h, kind: 'rock', base: terrain(x, z) - 0.6 };
    obstacles.push(rock); reserveWilderness(rock);
    if (random() < 0.12) lootSpots.push({ x: x + w, z, y: terrain(x + w, z), tier: 1 });
  }
  const spacing = 19;
  for (let gx = -half + 60; gx < half - 60; gx += spacing) {
    for (let gz = -half + 60; gz < half - 60; gz += spacing) {
      const forest = fbm(gx * spec.forestScale / 420, gz * spec.forestScale / 420, 203, 3);
      if (forest < 0.5 || random() > (forest - 0.5) * 3.2 * (spec.treeDensity ?? 1)) continue;
      const x = gx + (random() - 0.5) * spacing, z = gz + (random() - 0.5) * spacing;
      if (nearTown(x, z, 25) || roadDistance(x, z) < 7 || !landOk(x, z, 4) || riverNear(x, z, 4) || inField(x, z, 6)) continue;
      const height = 7 + random() * 7;
      if (wildernessBlocked(x, z, 0.8, 0.8, 2)) continue;
      obstacles.push({ id: `tree-${obstacles.length}`, x, z, width: 0.8, depth: 0.8, height, kind: 'tree', base: terrain(x, z) - 0.3 });
    }
  }
  for (let i = 0; i < spec.wildCaches; i++) {
    const x = (random() * 2 - 1) * (half - spec.wildEdge), z = (random() * 2 - 1) * (half - spec.wildEdge);
    if (!nearTown(x, z, 40) && landOk(x, z, 4) && !riverNear(x, z, 4)) lootSpots.push({ x, z, y: terrain(x, z), tier: random() < 0.3 ? 2 : 1 });
  }

  const structures = addBuildingLandmarks({ half, towns, fields, roads, obstacles, loot: lootSpots, terrain, landOk, riverNear });

  proxies.push(...structures.map(s => ({ id: s.id + '-far', x: s.x, z: s.z, base: s.base, kind: 'building' as const, width: LANDMARK_SPECS[s.kind].width, depth: LANDMARK_SPECS[s.kind].depth, height: LANDMARK_SPECS[s.kind].height })));

  // Candidate drop points: a jittered grid, away from towns' centres and the rim.
  const spawns: Vec3[] = [];
  const step = spec.spawnStep;
  for (let gx = -half + spec.spawnEdge; gx <= half - spec.spawnEdge; gx += step) {
    for (let gz = -half + spec.spawnEdge; gz <= half - spec.spawnEdge; gz += step) {
      const x = gx + (random() - 0.5) * step * 0.7, z = gz + (random() - 0.5) * step * 0.7;
      if (!landOk(x, z, 8) || riverNear(x, z, 14) || coast(x, z) < 0.97) continue;
      if (obstacles.some(o => o.kind !== 'tree' && Math.abs(x - o.x) < o.width / 2 + 4 && Math.abs(z - o.z) < o.depth / 2 + 4)) continue;
      if (obstacles.some(o => o.kind === 'tree' && Math.abs(x - o.x) < 3 && Math.abs(z - o.z) < 3)) continue;
      spawns.push({ x, y: terrain(x, z), z });
    }
  }

  // Cars wait on roads between towns and in town streets.
  const vehicleSpawns: VehicleSpawn[] = [];
  for (const road of roads) {
    const length = distance(road.a.x, road.a.z, road.b.x, road.b.z);
    for (let d = spec.carStart[0] + random() * spec.carStart[1]; d < length - 60; d += spec.carStep[0] + random() * spec.carStep[1]) {
      const t = d / length;
      const x = road.a.x + (road.b.x - road.a.x) * t, z = road.a.z + (road.b.z - road.a.z) * t;
      if (!landOk(x + 2, z + 2, 2) || riverNear(x + 2, z + 2, 6)) continue;
      vehicleSpawns.push({ x: x + 2, z: z + 2, yaw: Math.atan2(road.b.x - road.a.x, road.b.z - road.a.z) });
    }
  }
  for (const town of towns) vehicleSpawns.push({ x: town.x + 4, z: town.z + 4, yaw: random() * Math.PI * 2 });
  for (const car of hotCars) vehicleSpawns.push(car);

  // The bunkers go in last, deep underground: nothing above them has to make room, and nothing else is placed by them.
  const portals: Portal[] = [];
  for (const site of bunkerSites) {
    const ends: Array<'e' | 'w' | 'n' | 's'> = site.sheds.length >= 4 ? ['e', 'w', 'n', 's'] : site.sheds.length === 3 ? ['e', 'w', 'n'] : ['e', 'w'];
    const bunker = buildBunker({ id: site.id, width: site.width, depth: site.depth, hall: site.hall, ends });
    addParts(placeParts(bunker, site.x, site.z, false, false));
    site.sheds.forEach((shed, i) => portals.push(...linkShed(`${site.id}-s${i}`, shed, bunker.ends[i % bunker.ends.length], site, site.label)));
  }

  return {
    terrain,
    world: {
      id: spec.id, halfSize: half, obstacles, spawns, terrain, zone: spec.zone, towns, roads, vehicleSpawns, lootSpots, floors, proxies, structures,
      ...(spec.theme ? { theme: spec.theme } : {}),
      ...(portals.length ? { portals } : {}), ...(hots.length ? { hotAreas: hots } : {}),
      // Without a sea, put the waterline far below any terrain so no shore, beach or open water is ever drawn.
      water: { seaLevel: spec.sea ? SEA_LEVEL : -60, lakes, rivers }, fields,
    },
  };
}

function dataFor(spec: WorldSpec): IslandData {
  let data = cache.get(spec.id);
  if (!data) { data = generate(spec); cache.set(spec.id, data); }
  return data;
}

export function createIsland(): IslandData { return dataFor(ISLAND_SPEC); }
export function createValley(): IslandData { return dataFor(VALLEY_SPEC); }
/** Generated map data for the open-world maps; the flat arena has none. */
export function mapData(map: MapId): IslandData | null { const spec = SPECS[map]; return spec ? dataFor(spec) : null; }
/** The maps that are generated rather than built by hand, with the time their circles take. */
export const OPEN_MAPS = Object.keys(SPECS) as MapId[];



/** Fresh world object per match: static data is shared, the obstacle list can be mutated safely. */
function freshWorld(data: IslandData, forestScale: number): WorldConfig {
  activeForestScale = forestScale;
  const { world } = data;
  return { ...world, obstacles: world.obstacles.slice(), spawns: world.spawns.map(s => ({ ...s })) };
}
export function createIslandWorld(): WorldConfig { return freshWorld(createIsland(), ISLAND_SPEC.forestScale); }
export function createValleyWorld(): WorldConfig { return freshWorld(createValley(), VALLEY_SPEC.forestScale); }
/** A fresh world of any generated map (undefined for the arena). */
export function createMapWorld(map: MapId): WorldConfig | null {
  const spec = SPECS[map];
  return spec ? freshWorld(dataFor(spec), spec.forestScale) : null;
}

export function heightAtWorld(world: WorldConfig, x: number, z: number): number {
  return world.terrain ? world.terrain(x, z) : 0;
}

export type { Vec2 };
