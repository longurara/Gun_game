import type { WeaponClass } from '../types';

/**
 * Bullet drop. Bullets are still instant (no travel time) but follow an arc: they fall under gravity, and a gun's
 * sights are "zeroed" so the arc crosses the line of sight at one distance. Closer than that the bullet is a touch
 * above where you aim, beyond it the bullet drops below. Gravity is exaggerated so the effect matters at the game's
 * ranges (a 200 m shot with a sniper rifle lands about half a metre low).
 */
export const GRAVITY = 36;

/** Muzzle velocity in m/s by class: pistols and shotguns are slow, rifles fast, sniper rifles fastest. */
export const MUZZLE_VELOCITY: Record<WeaponClass, number> = {
  pistol: 360, smg: 400, shotgun: 400, ar: 740, br: 800, lmg: 750, dmr: 830, sniper: 920, amr: 960,
};

/** Metres at which each class's sights are zeroed: scoped guns at 100 m, others close in. */
export const ZERO_DISTANCE: Record<WeaponClass, number> = {
  pistol: 40, smg: 50, shotgun: 25, ar: 60, br: 70, lmg: 70, dmr: 100, sniper: 100, amr: 100,
};

/** Shots shorter than this fly straight: the drop is under a few centimetres and not worth tracing in pieces. */
export const STRAIGHT_RANGE = 45;
/** Length of each straight piece when an arc is traced. */
export const SEGMENT = 20;

/** How far a bullet has fallen after `distance` metres of flight. */
export const dropAt = (distance: number, velocity: number): number => {
  const time = distance / velocity;
  return 0.5 * GRAVITY * time * time;
};

/**
 * Height of the bullet above (positive) or below (negative) the aim line after `distance` metres, for sights zeroed
 * at `zero` metres. Zero exactly at the zero distance and at the muzzle.
 */
export function pathOffset(distance: number, velocity: number, zero: number): number {
  if (!(distance > 0) || !(velocity > 0) || !(zero > 0)) return 0;
  return distance * dropAt(zero, velocity) / zero - dropAt(distance, velocity);
}

/**
 * How much higher than the target to aim so the bullet arrives on it: used by bots, which are assumed to hold over
 * correctly (they still miss through spread and tracking lag).
 */
export const holdover = (distance: number, velocity: number, zero: number): number => -pathOffset(distance, velocity, zero);
