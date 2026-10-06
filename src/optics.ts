/**
 * What the player looks through when aiming through a variable scope (anything from 4x up). Pure helpers, so the zoom
 * steps can be tested.
 */

/** Magnifications a variable scope can be set to, lowest first. A scope offers every step up to its own maximum. */
export const ZOOM_STEPS = [1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 15] as const;

/** From this magnification up a gun is aimed through a scope; below it the gun is aimed over the shoulder. */
export const SCOPE_FROM = 4;

/** The magnifications a gun's sight allows. A plain sight has one fixed level; a scope runs from 1x to its maximum. */
export function zoomLevels(max: number): number[] {
  const top = Number.isFinite(max) && max > 0 ? max : 1;
  if (top < SCOPE_FROM) return [top];
  const levels: number[] = ZOOM_STEPS.filter(step => step < top - 1e-6);
  levels.push(top);
  return levels;
}

/** Move one step along the levels (negative is out, positive is in), staying inside them. */
export function stepZoom(levels: readonly number[], current: number, direction: number): number {
  let index = 0, best = Infinity;
  levels.forEach((level, i) => { const gap = Math.abs(level - current); if (gap < best) { best = gap; index = i; } });
  return levels[Math.max(0, Math.min(levels.length - 1, index + Math.sign(direction)))];
}

/** Keep a remembered magnification inside what the sight offers now (an attachment may have changed it). */
export function clampZoom(levels: readonly number[], wanted: number | undefined): number {
  if (wanted === undefined) return levels[levels.length - 1];
  return stepZoom(levels, wanted, 0);
}

/** The vertical field of view when looking through a sight of this magnification. */
export const fovFor = (zoom: number, base = 0.92): number => 2 * Math.atan(Math.tan(base / 2) / Math.max(1, zoom));
