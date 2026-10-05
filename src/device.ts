import type { GameSettings } from './types';

/** Prefer coarse touch input; a mouse-equipped desktop keeps keyboard controls. */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(pointer: coarse)').matches
    || (navigator.maxTouchPoints > 0 && window.matchMedia('(max-width: 1100px)').matches);
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
