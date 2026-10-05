import type { AirMode, AirState, Plane, Vec2 } from '../types';

/**
 * Parachute drop: a transport plane crosses the map, everybody jumps when they like, falls freely (steering with
 * the move keys, Shift to dive) and lands under a canopy. All numbers are metres and seconds.
 */
export const DROP = {
  /** Horizontal and vertical speed caps: plain free fall glides far, a dive gets down fast. */
  freefall: { h: 28, v: 45 }, dive: { h: 45, v: 78 },
  /** Under the canopy; speeding up trades a faster descent for more reach. */
  chute: { h: 16, v: 6.5 }, chuteFast: { h: 22, v: 9 },
  freefallAccel: 18, chuteAccel: 10, fallAccel: 35,
  /** The canopy opens by itself below this height above the ground. */
  autoOpen: 100,
  /** Landing faster than this hurts (an open canopy never gets near it). */
  safeLanding: 12,
  /** The door stays shut for a moment at the start of the match. */
  doorDelay: 1.5,
  /** Extra seconds the first zone wait is stretched so nobody is shot by the circle while still airborne. */
  zoneGrace: 20,
} as const;

const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));

/** Move `value` toward `target` by at most `step`. */
export function approach(value: number, target: number, step: number): number {
  return value + clamp(target - value, -step, step);
}

/** The plane flies high enough to give a useful glide on the 4 km island and a short one on the small map. */
export const planeAltitude = (half: number): number => clamp(half * 0.4, 300, 800);
export const planeSpeed = (length: number): number => clamp(length / 55, 36, 75);

/**
 * A straight flight path across the whole map: a random heading, shifted sideways so it does not always pass
 * through the middle. `rand` is the simulation's seeded generator, so a match's route is reproducible.
 */
export function makePlane(half: number, rand: () => number): Plane {
  const angle = rand() * Math.PI * 2;
  const dir = { x: Math.sin(angle), z: Math.cos(angle) };
  const offset = (rand() - 0.5) * half * 0.5;
  const centre = { x: -dir.z * offset, z: dir.x * offset };
  let tin = -Infinity, tout = Infinity;
  for (const axis of ['x', 'z'] as const) {
    if (Math.abs(dir[axis]) < 1e-6) continue;
    const a = (-half - centre[axis]) / dir[axis], b = (half - centre[axis]) / dir[axis];
    tin = Math.max(tin, Math.min(a, b));
    tout = Math.min(tout, Math.max(a, b));
  }
  const from = { x: centre.x + dir.x * tin, z: centre.z + dir.z * tin };
  const to = { x: centre.x + dir.x * tout, z: centre.z + dir.z * tout };
  const length = tout - tin;
  return {
    x: from.x, z: from.z, y: planeAltitude(half), yaw: Math.atan2(dir.x, dir.z), speed: planeSpeed(length),
    from, to, length, travelled: 0, active: true,
  };
}

export function placePlane(plane: Plane): void {
  const t = plane.length > 0 ? plane.travelled / plane.length : 0;
  plane.x = plane.from.x + (plane.to.x - plane.from.x) * t;
  plane.z = plane.from.z + (plane.to.z - plane.from.z) * t;
}

/** How far a jumper can still glide from `agl` metres above the ground, with a margin for slow steering and terrain. */
export function remainingGlide(mode: AirMode, agl: number): number {
  if (mode === 'chute') return Math.max(0, agl) / DROP.chute.v * DROP.chute.h * 0.9;
  const free = Math.max(0, agl - DROP.autoOpen) / DROP.freefall.v * DROP.freefall.h;
  return (free + DROP.autoOpen / DROP.chute.v * DROP.chute.h) * 0.85;
}

/** Glide range from the plane's altitude over typical ground. */
export const glideReach = (altitude: number, ground = 40): number => remainingGlide('freefall', altitude - ground);

/** Position of a point relative to the flight line: distance along it and distance to the side. */
export function alongLine(plane: Pick<Plane, 'from' | 'to' | 'length'>, point: Vec2): { along: number; side: number } {
  const dx = (plane.to.x - plane.from.x) / plane.length, dz = (plane.to.z - plane.from.z) / plane.length;
  const px = point.x - plane.from.x, pz = point.z - plane.from.z;
  return { along: px * dx + pz * dz, side: Math.abs(px * -dz + pz * dx) };
}

export interface AirControl { x: number; z: number; dive: boolean }

/** Update an airborne actor's velocity toward what the controls ask for. Free fall and canopy have different limits. */
export function steerAir(air: AirState, control: AirControl, dt: number): void {
  const cap = air.mode === 'chute' ? (control.dive ? DROP.chuteFast : DROP.chute) : control.dive ? DROP.dive : DROP.freefall;
  const accel = (air.mode === 'chute' ? DROP.chuteAccel : DROP.freefallAccel) * dt;
  const length = Math.hypot(control.x, control.z);
  const scale = length > 1 ? 1 / length : 1;
  air.vx = approach(air.vx, control.x * scale * cap.h, accel);
  air.vz = approach(air.vz, control.z * scale * cap.h, accel);
  air.vy = approach(air.vy, -cap.v, DROP.fallAccel * dt);
  air.time += dt;
}
