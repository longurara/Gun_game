import type { Obstacle, RangeDummySpec, RangeMotion, VehicleSpawn, WorldConfig } from '../types';
import type { VehicleKind } from './vehicles';

/**
 * The shooting range: a flat 400 m square for practice. The firing line is at the south end; five lanes run north with targets
 * at 15 to 250 m, two rows of targets slide from side to side, and a small yard in the east holds bots that shoot back.
 * Every gun is racked behind the line, and the player can ask for any of them at the touch of a key.
 */
export const RANGE_HALF = 200;
/** Where the firing line is (z) and where the player stands. */
export const FIRING_Z = -150;
export const LANE_X = [-80, -40, 0, 40, 80] as const;
/** Metres from the firing line to each target in a lane. */
export const LANE_DISTANCES = [15, 25, 50, 75, 100, 150, 200, 250] as const;
/** The yard where bots roam, in the east. */
export const YARD = { x0: 100, x1: 190, z0: -110, z1: 100 };

/** The motor pool in the west, one of every kind of vehicle in two columns facing the field, and the slalom in the north to try them on. */
export const MOTOR_POOL: Array<{ kind: VehicleKind; x: number; z: number }> = (['car', 'coupe', 'jeep', 'pickup', 'van', 'minibus', 'bike', 'scooter', 'quad', 'buggy', 'tuktuk', 'sidecar'] as VehicleKind[]).map((kind, i) => ({
  kind, x: i % 2 === 0 ? -150 : -180, z: -105 + Math.floor(i / 2) * 36,
}));
/** The slalom: cones every 16 m along the north strip, alternating sides of the line. */
export const SLALOM = { z: 150, x0: -165, x1: 85, step: 16, offset: 4.5 };
export const SPEED_STRIP = { z: 178, x0: -190, x1: 190 };

export const RANGE_ZONE = { start: 1e6, radii: [1e6], waits: [1e9], shrinks: [1e9] };

/** Targets stand to either side of the lane centre in turn, so from the middle of the lane a near one never hides a far one. */
const SIDE_STEP = [-9, 9, -10, 10, -8, 8, -5, 5];
function laneDummies(): RangeDummySpec[] {
  const dummies: RangeDummySpec[] = [];
  for (const [lane, x] of LANE_X.entries()) {
    LANE_DISTANCES.forEach((distance, i) => {
      dummies.push({ id: `dummy-${lane + 1}-${distance}`, x: x + SIDE_STEP[i % SIDE_STEP.length], z: FIRING_Z + distance, distance });
    });
  }
  // Two rows of moving targets that slide across the field of fire.
  [[30, 18, 6.5], [70, 24, 8.5]].forEach(([distance, amp, period], row) => {
    [-45, 0, 45].forEach((x, i) => dummies.push({ id: `dummy-m${row + 1}${i + 1}`, x, z: FIRING_Z + distance, distance, sway: { amp, period, phase: i * 2.1 + row } }));
  });
  // Runners that cross the whole field: two at a walk and a jog at 40 m, a sprinter at 90 m.
  [[40, 3.2, 0], [40, 5, 0.5], [90, 7.5, 0.25]].forEach(([distance, speed, phase], i) => dummies.push({
    id: `dummy-r${i + 1}`, x: -95, z: FIRING_Z + distance, distance, motion: { kind: 'run', from: -95, to: 95, speed, pause: 0.8, phase },
  }));
  // Pop-up targets: they stand for a moment, duck, and stand again, at their own rhythm.
  [[-60, 20], [-20, 35], [20, 60], [60, 90], [100, 130], [-100, 70]].forEach(([x, distance], i) => dummies.push({
    id: `dummy-p${i + 1}`, x, z: FIRING_Z + distance, distance, motion: { kind: 'pop', up: 1.6 + (i % 3) * 0.25, down: 1.2 + (i % 2) * 0.5, phase: i * 0.9 },
  }));
  return dummies;
}

export function createRangeWorld(): WorldConfig {
  const obstacles: Obstacle[] = [];
  // A low counter in front of each lane to shoot over, and barricades at 10 m to practise from cover.
  for (const x of LANE_X) {
    obstacles.push({ id: `counter-${x}`, x, z: FIRING_Z + 3, width: 8, depth: 1.2, height: 1.1, kind: 'crate' });
    obstacles.push({ id: `barricade-${x}`, x: x + 13, z: FIRING_Z + 10, width: 2.4, depth: 1.2, height: 1.4, kind: 'crate' });
  }
  // The bots' yard: a few buildings and plenty of cover.
  [['yard-hall', 125, -70, 18, 12, 7], ['yard-shed', 170, -35, 12, 10, 6], ['yard-barn', 140, 10, 16, 12, 7], ['yard-depot', 176, 52, 14, 14, 8]].forEach(([id, x, z, w, d, h]) =>
    obstacles.push({ id: id as string, x: x as number, z: z as number, width: w as number, depth: d as number, height: h as number, kind: 'building' }));
  [[110, -20], [155, -75], [130, 40], [180, 15], [112, 70], [160, 80], [146, -30]].forEach(([x, z], i) =>
    obstacles.push({ id: `yard-crate-${i}`, x, z, width: 3.2, depth: 3.2, height: 1.6, kind: 'crate' }));
  [[118, 32], [185, -80], [100, -100]].forEach(([x, z], i) => obstacles.push({ id: `yard-rock-${i}`, x, z, width: 6, depth: 5, height: 3.2, kind: 'rock' }));

  // The slalom: orange cones in the north strip.
  for (let x = SLALOM.x0, i = 0; x <= SLALOM.x1; x += SLALOM.step, i++) obstacles.push({ id: `cone-${i}`, x, z: SLALOM.z + (i % 2 === 0 ? SLALOM.offset : -SLALOM.offset), width: 0.7, depth: 0.7, height: 0.9, kind: 'crate' });
  const vehicleSpawns: VehicleSpawn[] = MOTOR_POOL.map(p => ({ x: p.x, z: p.z, yaw: Math.PI / 2 }));
  const botSpawns = [[112, -90], [150, -55], [186, -10], [125, 25], [160, 38], [110, 62], [183, 70], [146, -100], [105, -45], [175, 90]].map(([x, z]) => ({ x, y: 0, z }));
  return {
    id: 'range', halfSize: RANGE_HALF, zone: RANGE_ZONE, towns: [], roads: [], vehicleSpawns, vehicleKinds: MOTOR_POOL.map(p => p.kind), lootSpots: [],
    obstacles,
    spawns: [{ x: 0, y: 0, z: FIRING_Z - 2 }, ...botSpawns],
    range: { playerSpawn: { x: 0, y: 0, z: FIRING_Z - 2 }, firingZ: FIRING_Z, dummies: laneDummies(), botSpawns, laneX: [...LANE_X], distances: [...LANE_DISTANCES], yard: YARD },
  };
}

/** Where a running target is at a time, and which way it faces (-1, 0 or 1 along x; 0 while it pauses at an end). */
export function runState(motion: Extract<RangeMotion, { kind: 'run' }>, time: number): { x: number; dir: number } {
  const length = Math.abs(motion.to - motion.from), sign = Math.sign(motion.to - motion.from) || 1;
  const leg = length / Math.max(0.1, motion.speed), period = 2 * (leg + motion.pause);
  const u = (((time + motion.phase * period) % period) + period) % period;
  if (u < leg) return { x: motion.from + sign * length * (u / leg), dir: sign };
  if (u < leg + motion.pause) return { x: motion.to, dir: 0 };
  if (u < 2 * leg + motion.pause) return { x: motion.to - sign * length * ((u - leg - motion.pause) / leg), dir: -sign };
  return { x: motion.from, dir: 0 };
}

/** Is a pop-up target standing at this time? */
export function popUp(motion: Extract<RangeMotion, { kind: 'pop' }>, time: number): boolean {
  const period = motion.up + motion.down;
  return (((time + motion.phase) % period) + period) % period < motion.up;
}
