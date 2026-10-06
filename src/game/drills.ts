import type { RangeDummySpec } from '../types';

/**
 * Timed scoring drills on the shooting range. A drill names which targets count and how long it lasts; every hit on a counting
 * target scores, more for distance, for a moving or popping target, for the head and for the kill, and a run of quick hits
 * raises a multiplier.
 */
export type DrillId = 'warm' | 'far' | 'moving' | 'pop' | 'mixed';
export type TargetGroup = 'lane' | 'sway' | 'run' | 'pop';

export interface DrillDef {
  id: DrillId; name: string; blurb: string; seconds: number;
  /** Does a hit on this target count towards the drill? */
  counts: (spec: RangeDummySpec) => boolean;
}

export const groupOf = (spec: RangeDummySpec): TargetGroup => spec.motion?.kind ?? (spec.sway ? 'sway' : 'lane');

export const DRILLS: Record<DrillId, DrillDef> = {
  warm: { id: 'warm', name: 'Khởi động', blurb: 'Bia gần, 15–50 m', seconds: 45, counts: s => groupOf(s) === 'lane' && s.distance <= 50 },
  far: { id: 'far', name: 'Tầm xa', blurb: 'Bia từ 100 m trở ra', seconds: 75, counts: s => groupOf(s) === 'lane' && s.distance >= 100 },
  moving: { id: 'moving', name: 'Bia di động', blurb: 'Bia trượt và bia chạy ngang', seconds: 60, counts: s => groupOf(s) === 'sway' || groupOf(s) === 'run' },
  pop: { id: 'pop', name: 'Bia bật lên', blurb: 'Bia nhô lên rồi thụt xuống', seconds: 45, counts: s => groupOf(s) === 'pop' },
  mixed: { id: 'mixed', name: 'Tổng hợp', blurb: 'Mọi loại bia', seconds: 90, counts: () => true },
};
export const DRILL_ORDER: readonly DrillId[] = ['warm', 'far', 'moving', 'pop', 'mixed'];
export const isDrillId = (id: unknown): id is DrillId => typeof id === 'string' && Object.hasOwn(DRILLS, id);

/** Hits within this many seconds of the last one keep the multiplier growing. */
export const COMBO_WINDOW = 2.2;
export const COMBO_STEP = 0.1;
export const COMBO_MAX = 10;

export const comboMultiplier = (combo: number): number => 1 + Math.min(COMBO_MAX, Math.max(0, combo)) * COMBO_STEP;

/** Points for one hit: 10, plus 1 per 10 m; x1.5 for a moving target and x1.4 for a popping one; x2 for the head; a kill adds a bonus; then the combo. */
export function hitPoints(spec: RangeDummySpec, distance: number, head: boolean, killed: boolean, combo: number): number {
  const group = groupOf(spec);
  let points = 10 + Math.floor(Math.max(0, distance) / 10);
  if (group === 'sway' || group === 'run') points *= 1.5;
  else if (group === 'pop') points *= 1.4;
  if (head) points *= 2;
  if (killed) points += group === 'lane' ? 15 : 25;
  return Math.round(points * comboMultiplier(combo));
}

/** The rank a score earns in a drill, for the end-of-drill message. */
export function drillGrade(id: DrillId, score: number): string {
  const unit = { warm: 450, far: 700, moving: 650, pop: 600, mixed: 1100 }[id];
  const ratio = score / unit;
  return ratio >= 1.5 ? 'S' : ratio >= 1.1 ? 'A' : ratio >= 0.75 ? 'B' : ratio >= 0.4 ? 'C' : 'D';
}
