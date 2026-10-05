import type { Stance } from '../types';

/**
 * What standing, crouching and lying down change. Heights are metres; speeds m/s. Spread, stealth and recoil are
 * multipliers: a lower stance is slower but steadier, harder to see and harder to hit.
 */
export interface StanceData {
  height: number; speed: number; sprint: number;
  /** Eye height (camera pivot), chest (where shots leave) and the point bots aim at. */
  eye: number; chest: number; aimY: number;
  /** Half width of the body box used for hits. */
  half: number;
  spread: number; stealth: number; recoil: number;
}

export const STANCE: Record<Stance, StanceData> = {
  stand: { height: 1.85, speed: 5.2, sprint: 8.1, eye: 1.52, chest: 1.35, aimY: 1.12, half: 0.37, spread: 1, stealth: 1, recoil: 1 },
  crouch: { height: 1.37, speed: 2.9, sprint: 2.9, eye: 1.1, chest: 1.0, aimY: 0.85, half: 0.4, spread: 0.72, stealth: 0.78, recoil: 0.8 },
  prone: { height: 0.6, speed: 1.3, sprint: 1.3, eye: 0.5, chest: 0.4, aimY: 0.32, half: 0.55, spread: 0.5, stealth: 0.55, recoil: 0.6 },
};

export const stanceOf = (actor: { stance?: Stance }): StanceData => STANCE[actor.stance ?? 'stand'];

/** Where the body ends and the head box begins, as a share of height: the head is the top quarter when standing. */
export const NECK = 0.77;

/**
 * Extra bullet spread (radians) from what the shooter is doing: walking, sprinting and jumping all throw the aim off,
 * and looking down the sights steadies it. `speed` is the shooter's current speed in m/s.
 */
export function movementSpread(speed: number, airborne: boolean, aimed: boolean): number {
  if (!Number.isFinite(speed) || speed < 0.3) return airborne ? (aimed ? 0.025 : 0.045) : 0;
  let extra = 0.012 * Math.min(1, speed / 5.2);
  if (speed > 6.5) extra += 0.02;
  if (airborne) extra += 0.045;
  return extra * (aimed ? 0.55 : 1);
}
