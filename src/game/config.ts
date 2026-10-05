import type { WorldConfig, ZoneProfile } from '../types';
export { WEAPONS } from './weapons';

export const ACTOR_RADIUS = 0.42;
export const ACTOR_HEIGHT = 1.85;
export const INTERACTION_RANGE = 2.8;
export const HEAL_TIME = 3;
export const HEAL_AMOUNT = 60;

export const ARENA_ZONE: ZoneProfile = {
  start: 98,
  radii: [80, 60, 42, 25, 11, 0],
  waits: [60, 45, 35, 30, 20, 10],
  shrinks: [35, 35, 40, 40, 40, 40],
};

/** All buildings are solid exterior cover; no inaccessible interior loot. */
export function createArenaWorld(): WorldConfig {
  return {
    id: 'arena',
    halfSize: 100,
    zone: ARENA_ZONE, towns: [], roads: [], vehicleSpawns: [], lootSpots: [],
    obstacles: [
      { id: 'depot-west', x: -32, z: -42, width: 16, depth: 12, height: 8, kind: 'building' },
      { id: 'depot-east', x: 30, z: -43, width: 14, depth: 14, height: 7, kind: 'building' },
      { id: 'workshop', x: -44, z: 5, width: 15, depth: 19, height: 9, kind: 'building' },
      { id: 'station', x: 36, z: 10, width: 17, depth: 12, height: 7, kind: 'building' },
      { id: 'north-house', x: 0, z: 43, width: 18, depth: 12, height: 8, kind: 'building' },
      { id: 'north-shed', x: -44, z: 52, width: 12, depth: 10, height: 6, kind: 'building' },
      { id: 'crate-spawn-left', x: -8, z: -59, width: 3, depth: 3, height: 1.4, kind: 'crate' },
      { id: 'crate-spawn-right', x: 9, z: -57, width: 4, depth: 3, height: 1.5, kind: 'crate' },
      { id: 'crate-center-left', x: -13, z: -13, width: 4, depth: 4, height: 1.8, kind: 'crate' },
      { id: 'crate-center-right', x: 12, z: -2, width: 4, depth: 4, height: 1.8, kind: 'crate' },
      { id: 'crate-north', x: 17, z: 30, width: 4, depth: 3, height: 1.5, kind: 'crate' },
      { id: 'rock-west', x: -67, z: -10, width: 6, depth: 5, height: 3.2, kind: 'rock' },
      { id: 'rock-east', x: 65, z: 36, width: 7, depth: 6, height: 3.8, kind: 'rock' },
      { id: 'rock-south', x: 48, z: -67, width: 6, depth: 6, height: 3, kind: 'rock' },
      { id: 'rock-north', x: -20, z: 74, width: 7, depth: 5, height: 3.4, kind: 'rock' },
      { id: 'low-cover', x: 0, z: -30, width: 5, depth: 2, height: 0.8, kind: 'crate' },
    ],
    spawns: [
      { x: 0, y: 0, z: -65 },
      { x: -65, y: 0, z: -51 }, { x: 65, y: 0, z: -28 },
      { x: -65, y: 0, z: 27 }, { x: 55, y: 0, z: 62 },
      { x: 0, y: 0, z: 79 }, { x: -71, y: 0, z: 69 },
      { x: 75, y: 0, z: 10 },
    ],
  };
}

/** Back-compatible default: the original 200 m arena. */
export const createWorld = createArenaWorld;
