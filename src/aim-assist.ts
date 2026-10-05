/**
 * Touch aim assist in the style of mobile shooters: the camera slows down while the crosshair crosses an enemy (so a
 * thumb can rest on the target) and, while shooting or aiming, is drawn gently toward the enemy's body.
 */
export type AssistLevel = 'off' | 'low' | 'high';

interface Tuning { cone: number; slowest: number; pull: number }
const DEG = Math.PI / 180;
const TUNING: Record<Exclude<AssistLevel, 'off'>, Tuning> = {
  low: { cone: 3.5 * DEG, slowest: 0.7, pull: 1.6 },
  high: { cone: 6 * DEG, slowest: 0.5, pull: 3.2 },
};

export interface AssistTarget { id: string; yaw: number; pitch: number; distance: number }
export interface AssistHit { id: string; dYaw: number; dPitch: number; angle: number }

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** The enemy closest to the crosshair within the assist cone, as the turn needed to put the crosshair on it. */
export function pickAssist(viewYaw: number, viewPitch: number, targets: readonly AssistTarget[], level: AssistLevel): AssistHit | null {
  if (level === 'off') return null;
  const cone = TUNING[level].cone;
  let best: AssistHit | null = null;
  for (const target of targets) {
    const dYaw = wrap(target.yaw - viewYaw), dPitch = target.pitch - viewPitch;
    // Yaw spans less of the screen the higher you look; scale it so the cone is a circle on screen.
    const angle = Math.hypot(dYaw * Math.cos(viewPitch), dPitch);
    if (angle < cone && (!best || angle < best.angle)) best = { id: target.id, dYaw, dPitch, angle };
  }
  return best;
}

/** How much to scale look speed (1 = unchanged): slowest right on the target, easing back to normal at the cone's edge. */
export function lookScale(hit: AssistHit | null, level: AssistLevel): number {
  if (!hit || level === 'off') return 1;
  const { cone, slowest } = TUNING[level];
  const closeness = 1 - Math.min(1, hit.angle / cone);
  return 1 - (1 - slowest) * Math.sqrt(closeness);
}

/** The turn (radians) to add this frame to pull the crosshair toward the target; zero unless shooting or aiming. */
export function pullStep(hit: AssistHit | null, level: AssistLevel, dt: number, engaged: boolean): { yaw: number; pitch: number } {
  if (!hit || level === 'off' || !engaged || !(dt > 0)) return { yaw: 0, pitch: 0 };
  const { cone, pull } = TUNING[level];
  // Strongest when nearly on target, fading to nothing at the edge so it never drags the aim across the screen.
  const fade = 1 - Math.min(1, hit.angle / cone);
  const share = Math.min(1, pull * fade * dt);
  return { yaw: hit.dYaw * share, pitch: hit.dPitch * share };
}
