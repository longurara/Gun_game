/**
 * Bunkers: big underground complexes of corridors and rooms, reached by stairs inside small surface sheds. They sit deep
 * below the terrain (at BUNKER_Y), so nothing about the ground above matters: the floor is a `Floor`, the walls and the
 * ceiling are ordinary obstacles. A stairwell is a pair of portals: step up to one and press E to come out at the other.
 */
import type { Floor, LootSpot, Obstacle, Portal } from '../types';
import { DOOR_HEIGHT, DOOR_WIDTH, SLAB, wallPieces } from './buildings';
import type { Opening, Parts } from './buildings';

/** Height of every bunker floor (absolute), and of its walls. */
export const BUNKER_Y = -42;
export const BUNKER_HEIGHT = 4;
/** Someone this far below the ground is underground: they stand on bunker floors, not on the terrain. */
export const DEEP = 4;

export interface BunkerSpec {
  id: string; width: number; depth: number;
  /** Half the side of the central hall. */ hall: number;
  /** Which corridor ends have stairs: any of east, west, north, south. */ ends: Array<'e' | 'w' | 'n' | 's'>;
}
/** A stairwell end of a bunker, in the bunker's own frame: where the stairs are and where someone arriving from above lands. */
export interface BunkerEnd { end: 'e' | 'w' | 'n' | 's'; x: number; z: number; landX: number; landZ: number }
export interface BunkerParts extends Parts { ends: BunkerEnd[]; rooms: number }

const door = (center: number, width = DOOR_WIDTH): Opening => ({ start: center - width / 2, end: center + width / 2, low: 0, high: DOOR_HEIGHT });

/**
 * A cross of two corridors with a big hall where they meet, and rooms along every corridor arm (two a side on the long arms,
 * one beside each short arm), every room with a door to its corridor and a door to its neighbour, so there are loops to fight round.
 */
export function buildBunker(spec: BunkerSpec): BunkerParts {
  const { id, width: W, depth: D, hall: h } = spec;
  const c = 2, base = BUNKER_Y, H = BUNKER_HEIGHT;
  const parts: BunkerParts = { obstacles: [], floors: [], loot: [], ends: [], rooms: 0 };
  let n = 0;
  const wall = (axis: 'x' | 'z', fixed: number, from: number, to: number, doors: Opening[] = []) => {
    parts.obstacles.push(...wallPieces(`${id}-w${n++}`, 'wall', base, axis, fixed, from, to, doors, H));
  };
  const hw = W / 2, hd = D / 2;
  const rooms = Math.max(1, Math.round((hw - h) / 17));
  const rw = (hw - h) / rooms;
  const mid = (a: number, b: number) => (a + b) / 2;

  // The outer walls.
  wall('x', -hd, -hw, hw); wall('x', hd, -hw, hw); wall('z', -hw, -hd, hd); wall('z', hw, -hd, hd);
  // The hall: open to the corridors through wide gaps, and to the rooms beside it through doors.
  for (const s of [-1, 1]) {
    wall('x', s * h, -h, h, [door(0, 2 * c), door(-mid(c, h)), door(mid(c, h))]);
    wall('z', s * h, -hd, hd, [door(0, 2 * c), door(-mid(c, h)), door(mid(c, h)), door(-mid(h, hd)), door(mid(h, hd))]);
  }
  // Corridor walls and the doors from them into the rooms.
  for (const s of [-1, 1]) {
    const along = (side: number) => Array.from({ length: rooms }, (_, i) => door(side * (h + (i + 0.5) * rw)));
    wall('x', s * c, h, hw, along(1)); wall('x', s * c, -hw, -h, along(-1).reverse());
    wall('z', s * c, h, hd, [door(mid(h, hd))]); wall('z', s * c, -hd, -h, [door(-mid(h, hd))]);
  }
  // Walls between neighbouring rooms along the long arms, each with a doorway.
  for (const s of [-1, 1]) for (let i = 1; i < rooms; i++) {
    const x = s * (h + i * rw);
    wall('z', x, c, hd, [door(mid(c, hd))]); wall('z', x, -hd, -c, [door(-mid(c, hd))]);
  }
  parts.rooms = rooms * 4 + 4;

  // Floor and ceiling over the whole complex.
  parts.obstacles.push({ id: `${id}-floor`, x: 0, z: 0, width: W + WALL_PAD, depth: D + WALL_PAD, height: 0, bottom: -SLAB, kind: 'floor', base });
  parts.obstacles.push({ id: `${id}-ceiling`, x: 0, z: 0, width: W + WALL_PAD, depth: D + WALL_PAD, height: H + SLAB, bottom: H, kind: 'floor', base });
  parts.floors.push({ id: `${id}-floor`, x: 0, z: 0, width: W, depth: D, y0: base, y1: base } as Floor);

  // The hall: pillars to hide behind, low crates, and the best loot in the complex.
  for (const [x, z] of [[-h / 2, -h / 2], [h / 2, -h / 2], [-h / 2, h / 2], [h / 2, h / 2]]) {
    parts.obstacles.push({ id: `${id}-pillar${n++}`, x, z, width: 1.5, depth: 1.5, height: H, kind: 'wall', base });
  }
  const crate = (x: number, z: number, w: number, d: number, height: number) => parts.obstacles.push({ id: `${id}-crate${n++}`, x, z, width: w, depth: d, height, kind: 'crate', base });
  crate(-h * 0.8, 0, 2.6, 1.4, 1.2); crate(h * 0.8, 0, 2.6, 1.4, 1.2); crate(0, -h * 0.8, 1.4, 2.6, 1.2); crate(0, h * 0.8, 1.4, 2.6, 1.2);
  const spot = (x: number, z: number, bias?: LootSpot['bias']) => parts.loot.push({ x, z, y: base, tier: 3, ...(bias ? { bias } : {}) });
  spot(-h * 0.45, 0, 'heavy'); spot(h * 0.45, 0, 'heavy'); spot(0, -h * 0.45); spot(0, h * 0.45); spot(-h * 0.75, h * 0.5, 'heavy'); spot(h * 0.75, -h * 0.5, 'heavy');

  // Every room: cover along one side and loot further in than the door.
  let medical = 0;
  const room = (x0: number, x1: number, z0: number, z1: number, doorSide: 'z' | 'x') => {
    const cx = mid(x0, x1), cz = mid(z0, z1), w = x1 - x0, d = z1 - z0;
    const deep = doorSide === 'z' ? Math.sign(cz) : 0;       // which way is "far" from a door in z
    const farX = doorSide === 'x' ? Math.sign(cx) : 0;
    crate(cx - (doorSide === 'z' ? w * 0.28 : 0), cz - (doorSide === 'x' ? d * 0.28 : 0), 1.6, 1.2, 1.1);
    const lx = cx + farX * w * 0.28 + (doorSide === 'z' ? w * 0.22 : 0), lz = cz + deep * d * 0.28 + (doorSide === 'x' ? d * 0.22 : 0);
    spot(lx, lz, medical++ % 3 === 0 ? 'medical' : undefined);
    if (Math.min(w, d) > 11) spot(cx - (doorSide === 'z' ? w * 0.2 : 0), cz + deep * d * 0.1 - (doorSide === 'x' ? d * 0.2 : 0));
  };
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    for (let i = 0; i < rooms; i++) {
      const a = h + i * rw, b = a + rw;
      room(sx > 0 ? a : -b, sx > 0 ? b : -a, sz > 0 ? c : -hd, sz > 0 ? hd : -c, 'z');
    }
    // The narrow room beside the end of a short arm.
    room(sx > 0 ? c : -h, sx > 0 ? h : -c, sz > 0 ? h : -hd, sz > 0 ? hd : -h, 'x');
  }

  // Stairs at the end of each wanted corridor arm, and a landing a few steps in.
  const ends: Record<BunkerEnd['end'], BunkerEnd> = {
    e: { end: 'e', x: hw - 2.2, z: 0, landX: hw - 5.5, landZ: 0 }, w: { end: 'w', x: -hw + 2.2, z: 0, landX: -hw + 5.5, landZ: 0 },
    n: { end: 'n', x: 0, z: hd - 2.2, landX: 0, landZ: hd - 5.5 }, s: { end: 's', x: 0, z: -hd + 2.2, landX: 0, landZ: -hd + 5.5 },
  };
  parts.ends = spec.ends.map(end => ends[end]);
  return parts;
}
const WALL_PAD = 0.4;

/** A small surface shed with a door on one side: the way down to a bunker. */
export function buildShed(id: string, x: number, z: number, base: number, doorSide: 'n' | 's' | 'e' | 'w'): Obstacle[] {
  const size = 6, half = size / 2, obstacles: Obstacle[] = [];
  const sides: Array<['n' | 's' | 'e' | 'w', 'x' | 'z', number, number, number]> = [
    ['s', 'x', z - half, x - half, x + half], ['n', 'x', z + half, x - half, x + half], ['w', 'z', x - half, z - half, z + half], ['e', 'z', x + half, z - half, z + half],
  ];
  for (const [side, axis, fixed, from, to] of sides) {
    const open: Opening[] = side === doorSide ? [{ start: (from + to) / 2 - DOOR_WIDTH / 2, end: (from + to) / 2 + DOOR_WIDTH / 2, low: 0, high: DOOR_HEIGHT }] : [];
    obstacles.push(...wallPieces(`${id}-${side}`, 'wall', base, axis, fixed, from, to, open));
  }
  obstacles.push({ id: `${id}-roof`, x, z, width: size + 0.6, depth: size + 0.6, height: 3.65, bottom: 3.3, kind: 'roof', base });
  return obstacles;
}

const OUT: Record<'n' | 's' | 'e' | 'w', [number, number]> = { n: [0, 1], s: [0, -1], e: [1, 0], w: [-1, 0] };

/**
 * Join a shed on the surface to one end of a bunker with two portals. `at` is where the bunker sits on the map (its centre).
 */
export function linkShed(id: string, shed: { x: number; z: number; base: number; door: 'n' | 's' | 'e' | 'w' }, end: BunkerEnd, at: { x: number; z: number }, label: string): Portal[] {
  const [dx, dz] = OUT[shed.door];
  return [
    { id: `${id}-down`, x: shed.x, y: shed.base, z: shed.z, to: { x: at.x + end.landX, y: BUNKER_Y, z: at.z + end.landZ }, label: `Xuống ${label}`, down: true },
    { id: `${id}-up`, x: at.x + end.x, y: BUNKER_Y, z: at.z + end.z, to: { x: shed.x + dx * 4.4, y: shed.base, z: shed.z + dz * 4.4 }, label: 'Lên mặt đất', down: false },
  ];
}
