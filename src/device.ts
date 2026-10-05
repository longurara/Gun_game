import type { GameSettings } from './types';

/** Prefer coarse touch input; a mouse-equipped desktop keeps keyboard controls. */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(pointer: coarse)').matches
    || (navigator.maxTouchPoints > 0 && window.matchMedia('(max-width: 1100px)').matches);
}

/** A swipe across the short screen edge turns about 90 degrees on a phone. */
export function touchLookSensitivity(width: number, height: number, preference = 1, aimZoom: number | null = null): number {
  const shortEdge = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? Math.max(320, Math.min(600, width, height)) : 390;
  const userScale = Number.isFinite(preference) ? Math.max(0.35, Math.min(2, preference)) : 1;
  const aimScale = aimZoom === null ? 1 : 0.72 / Math.sqrt(Number.isFinite(aimZoom) && aimZoom > 0 ? aimZoom : 1);
  return 0.004 * (390 / shortEdge) * userScale * aimScale;
}

/** Babylon without adaptToDeviceRatio renders CSS pixels / hardware scaling. */
export function renderBudgetFor(quality: GameSettings['quality'], touch: boolean, _width: number, _height: number, dpr = 1) {
  if (touch) {
    const density = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
    // Render every device pixel at both quality levels, with no resolution cap.
    return { scaling: 1 / density, shadows: false };
  }
  return { scaling: quality === 'low' ? Math.max(1.4, dpr) : Math.max(1, dpr * 0.75), shadows: quality === 'high' };
}
