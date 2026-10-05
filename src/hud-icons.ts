import { WEAPONS } from './game/weapons';
import type { WeaponType } from './types';

/** Small side profiles keep the weapon HUD readable without a large card. */
export function weaponHudIcon(weapon: WeaponType): string {
  const kind = WEAPONS[weapon].kind;
  const path = kind === 'pistol'
    ? 'M25 8h65v11H61l-7 17H36l7-17H25zm13 11h17l-3 7H40z'
    : kind === 'sniper' || kind === 'dmr' || kind === 'amr'
      ? 'M4 20 20 13h38v-4h15v4h31v4h12v3H78l-4 6H59l-4 12h-8l3-12H28L6 29zm34-14h38v5H38z'
      : kind === 'shotgun'
        ? 'M3 19 22 12h38v2h51v4H69v6H53l-7 13h-9l4-13H25L4 29zm61 1h27v5H64z'
        : kind === 'smg'
          ? 'M10 15h18l9-6h46v5h28v5H84l-8 7H62v12H50V26H38l-5 11H23l6-18H10zm49-11h15v5H59z'
          : kind === 'lmg'
            ? 'M3 14h25l8-5h48v5h30v5H89l-9 7H68v12H49V26H37l-6 11H20l7-18H3zm80 11h4l6 14h-4z'
            : 'M3 16 25 10h17l5 4h39v-3h9v3h20v5H88l-9 6H63l7 13H57l-8-13H38l-5 12H23l5-18H3zm45-9h21v6H48z';
  return `<svg class="slot-weapon-icon" viewBox="0 0 120 40" fill="currentColor" aria-hidden="true"><path d="${path}"/></svg>`;
}
