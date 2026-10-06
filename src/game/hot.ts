/**
 * Hot areas: huge fenced compounds with the best loot on the surface (a military base, an industrial estate) and a bunker
 * beneath each. A plan holds everything to add to the map, already in world coordinates.
 */
import type { LootSpot, Obstacle } from '../types';
import { buildHangar, buildTower, placeParts, wallPieces } from './buildings';
import type { Parts } from './buildings';
import { buildShed } from './underground';

export interface HotShed { x: number; z: number; door: 'n' | 's' | 'e' | 'w' }
export interface HotPlan {
  kind: 'base' | 'factory';
  parts: Parts;
  /** Stair sheds that lead down to the bunker. */ sheds: HotShed[];
  /** Where vehicles wait. */ vehicles: Array<{ x: number; z: number; yaw: number }>;
  /** The gates in the fence, for a road to end at. */ gates: Array<{ x: number; z: number }>;
  radius: number;
}

const FENCE_HEIGHT = 2.4;

const emptyParts = (): Parts => ({ obstacles: [], floors: [], loot: [], proxies: [] });
function merge(into: Parts, from: Parts): void {
  into.obstacles.push(...from.obstacles); into.floors.push(...from.floors); into.loot.push(...from.loot); into.proxies!.push(...(from.proxies ?? []));
}

/** A rectangular fence round a compound with gaps at the given gates (centres of the west and east sides). */
function fence(id: string, cx: number, cz: number, halfX: number, halfZ: number, base: number, gates: Array<{ side: 'w' | 'e'; offset: number }>): Obstacle[] {
  const out: Obstacle[] = [];
  const gap = (side: 'w' | 'e') => gates.filter(g => g.side === side).map(g => ({ start: cz + g.offset - 4, end: cz + g.offset + 4, low: 0, high: FENCE_HEIGHT }));
  out.push(...wallPieces(`${id}-fence-s`, 'wall', base, 'x', cz - halfZ, cx - halfX, cx + halfX, [], FENCE_HEIGHT));
  out.push(...wallPieces(`${id}-fence-n`, 'wall', base, 'x', cz + halfZ, cx - halfX, cx + halfX, [], FENCE_HEIGHT));
  out.push(...wallPieces(`${id}-fence-w`, 'wall', base, 'z', cx - halfX, cz - halfZ, cz + halfZ, gap('w'), FENCE_HEIGHT));
  out.push(...wallPieces(`${id}-fence-e`, 'wall', base, 'z', cx + halfX, cz - halfZ, cz + halfZ, gap('e'), FENCE_HEIGHT));
  return out;
}

const container = (id: string, x: number, z: number, base: number, alongX: boolean): Obstacle =>
  ({ id, x, z, width: alongX ? 6.2 : 2.6, depth: alongX ? 2.6 : 6.2, height: 2.6, kind: 'crate', base });

/** A grid of shipping containers with gaps left in it, so it plays as a maze of alleys. */
function containerYard(id: string, cx: number, cz: number, base: number, columns: number, rows: number, plan: HotPlan, tier: 1 | 2 | 3): void {
  let n = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
    const x = cx + (c - (columns - 1) / 2) * 10.5, z = cz + (r - (rows - 1) / 2) * 5.6;
    // A repeatable scatter of gaps and a few turned the other way.
    const roll = (c * 7 + r * 13 + columns) % 11;
    if (roll === 3 || roll === 8) { plan.parts.loot.push({ x, z, y: base, tier, ...(roll === 8 ? { bias: 'heavy' as const } : {}) }); continue; }
    plan.parts.obstacles.push(container(`${id}-container${n++}`, x, z, base, roll % 4 !== 0));
  }
}

const tower = (id: string, x: number, z: number, base: number, storeys: number, flavor: 'apartment' | 'tower', swap = false): Parts =>
  placeParts(buildTower({ id, width: flavor === 'tower' ? 6.4 : 26, depth: 14, storeys, base, flavor }), x, z, swap, false);
const hangar = (id: string, x: number, z: number, base: number, width: number, depth: number, swap = false): Parts =>
  placeParts(buildHangar({ id, width, depth, base }), x, z, swap, false);

/** A military base: a fenced compound with hangars, barracks, a headquarters, watch towers in the corners, a motor pool and a container yard. */
export function planBase(id: string, cx: number, cz: number, base: number): HotPlan {
  const plan: HotPlan = { kind: 'base', parts: emptyParts(), sheds: [], vehicles: [], gates: [{ x: cx - 100, z: cz }, { x: cx + 100, z: cz }], radius: 132 };
  const at = (x: number, z: number): [number, number] => [cx + x, cz + z];
  plan.parts.obstacles.push(...fence(id, cx, cz, 100, 80, base, [{ side: 'w', offset: 0 }, { side: 'e', offset: 0 }]));
  merge(plan.parts, hangar(`${id}-hangar0`, ...at(-62, -52), base, 34, 20));
  merge(plan.parts, hangar(`${id}-hangar1`, ...at(-18, -52), base, 34, 20));
  merge(plan.parts, tower(`${id}-hq`, ...at(60, -52), base, 3, 'apartment'));
  for (const [i, x] of [-60, -20, 30].entries()) merge(plan.parts, tower(`${id}-barracks${i}`, ...at(x, 50), base, 2, 'apartment'));
  for (const [i, [x, z]] of ([[-90, -66], [90, -66], [-90, 66], [90, 66]] as Array<[number, number]>).entries()) merge(plan.parts, tower(`${id}-watch${i}`, ...at(x, z), base, 3, 'tower', true));
  containerYard(`${id}-yard`, ...at(5, 0), base, 7, 4, plan, 3);
  for (const [x, z, door] of [[-84, 22, 'e'], [84, -22, 'w'], [0, -26, 'n'], [8, 31, 'n']] as Array<[number, number, HotShed['door']]>) {
    const [sx, sz] = at(x, z);
    plan.sheds.push({ x: sx, z: sz, door });
  }
  for (let i = 0; i < 6; i++) { const [x, z] = at(16 + i * 8, -33); plan.vehicles.push({ x, z, yaw: Math.PI / 2 }); }
  // Supply crates with good loot spread along the fence and in front of the hangars.
  for (const [x, z] of [[-90, -30], [-90, 10], [-80, 60], [90, 30], [80, 60], [-40, -30], [20, -20], [40, 26], [-14, 28], [-72, -20]] as Array<[number, number]>) {
    const [wx, wz] = at(x, z);
    plan.parts.obstacles.push({ id: `${id}-supply${plan.parts.obstacles.length}`, x: wx, z: wz, width: 2.2, depth: 1.6, height: 1.3, kind: 'crate', base });
    plan.parts.loot.push({ x: wx + 2.2, z: wz + 0.4, y: base, tier: 3, bias: 'heavy' });
  }
  return plan;
}

/** An industrial estate: big warehouses, silos and a chimney, an office block, and a maze of containers between them. */
export function planFactory(id: string, cx: number, cz: number, base: number): HotPlan {
  const plan: HotPlan = { kind: 'factory', parts: emptyParts(), sheds: [], vehicles: [], gates: [{ x: cx - 90, z: cz }, { x: cx + 90, z: cz }], radius: 112 };
  const at = (x: number, z: number): [number, number] => [cx + x, cz + z];
  plan.parts.obstacles.push(...fence(id, cx, cz, 90, 70, base, [{ side: 'w', offset: 0 }, { side: 'e', offset: 0 }]));
  for (const [i, z] of [-44, 0, 44].entries()) merge(plan.parts, hangar(`${id}-hall${i}`, ...at(-58, z), base, 40, 24));
  merge(plan.parts, hangar(`${id}-store`, ...at(0, -52), base, 30, 18));
  merge(plan.parts, tower(`${id}-office`, ...at(45, 44), base, 2, 'apartment'));
  for (let i = 0; i < 4; i++) {
    const [x, z] = at(34 + i * 13, -48);
    plan.parts.obstacles.push({ id: `${id}-silo${i}`, x, z, width: 8, depth: 8, height: 22, kind: 'building', base });
    plan.parts.proxies!.push({ id: `${id}-silo${i}-far`, x, z, width: 8, depth: 8, height: 22, kind: 'building', base });
  }
  const [chx, chz] = at(80, -20);
  plan.parts.obstacles.push({ id: `${id}-chimney`, x: chx, z: chz, width: 4, depth: 4, height: 44, kind: 'building', base });
  plan.parts.proxies!.push({ id: `${id}-chimney-far`, x: chx, z: chz, width: 4, depth: 4, height: 44, kind: 'building', base });
  containerYard(`${id}-yard`, ...at(8, 0), base, 6, 4, plan, 2);
  for (const [x, z, door] of [[84, 8, 'w'], [-8, 60, 's']] as Array<[number, number, HotShed['door']]>) {
    const [sx, sz] = at(x, z);
    plan.sheds.push({ x: sx, z: sz, door });
  }
  for (let i = 0; i < 4; i++) { const [x, z] = at(20 + i * 9, 24); plan.vehicles.push({ x, z, yaw: 0 }); }
  const extra: LootSpot[] = [];
  for (const [x, z] of [[-20, -30], [30, 20], [60, 10], [-2, 30], [24, -22], [66, 56]] as Array<[number, number]>) { const [wx, wz] = at(x, z); extra.push({ x: wx, z: wz, y: base, tier: 3, bias: 'heavy' }); }
  plan.parts.loot.push(...extra);
  return plan;
}

/** Build the stair sheds of a plan: walls and a roof for each, ready to add to the map. */
export function shedObstacles(id: string, plan: HotPlan, base: number): Obstacle[] {
  return plan.sheds.flatMap((shed, i) => buildShed(`${id}-shed${i}`, shed.x, shed.z, base, shed.door));
}
