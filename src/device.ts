import type { GameSettings } from './types';

/** Prefer coarse touch input; a mouse-equipped desktop keeps keyboard controls. */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(pointer: coarse)').matches
    || (navigator.maxTouchPoints > 0 && window.matchMedia('(max-width: 1100px)').matches);
}

/** Babylon without adaptToDeviceRatio renders CSS pixels / hardware scaling. */
export function renderBudgetFor(quality: GameSettings['quality'], touch: boolean, width: number, height: number, dpr = 1) {
  const area = Math.max(1, width) * Math.max(1, height);
  if (touch) {
    const pixelBudget = quality === 'low' ? 550_000 : 900_000;
    const baseScale = quality === 'low' ? 1.15 : 1;
    return { scaling: Math.max(baseScale, Math.sqrt(area / pixelBudget)), shadows: false };
  }
  return { scaling: quality === 'low' ? Math.max(1.4, dpr) : Math.max(1, dpr * 0.75), shadows: quality === 'high' };
}
