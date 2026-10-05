import type { AmmoKind, LootKind, WeaponConfig, WeaponType } from '../types';

/** Order also defines the keyboard shortcuts 1–8. */
export const WEAPON_ORDER: readonly WeaponType[] = ['rifle', 'shotgun', 'smg', 'pistol', 'dmr', 'sniper', 'heavySniper', 'lmg'];

export const WEAPONS: Record<WeaponType, WeaponConfig> = {
  rifle: { label: 'AR-26', category: 'Súng trường', fireMode: 'auto', zoom: 1.4, magazine: 30, damage: 25, pellets: 1, fireInterval: 0.15, reloadTime: 1.9, range: 135, spread: 0.006, aimSpread: 0.002, recoil: 0.010, preferredRange: 24, color: '#e6b16d', ammoPickup: 45 },
  shotgun: { label: 'SG-8', category: 'Shotgun', fireMode: 'semi', zoom: 1.2, magazine: 6, damage: 11, pellets: 8, fireInterval: 0.85, reloadTime: 2.65, range: 38, spread: 0.07, aimSpread: 0.06, recoil: 0.026, preferredRange: 10, color: '#cb9c65', ammoPickup: 12 },
  smg: { label: 'VX-9', category: 'Tiểu liên', fireMode: 'auto', zoom: 1.5, magazine: 32, damage: 18, pellets: 1, fireInterval: 0.075, reloadTime: 1.65, range: 75, spread: 0.018, aimSpread: 0.007, recoil: 0.006, preferredRange: 16, color: '#73c5a9', ammoPickup: 64 },
  pistol: { label: 'P-9', category: 'Súng lục', fireMode: 'semi', zoom: 1.3, magazine: 15, damage: 32, pellets: 1, fireInterval: 0.28, reloadTime: 1.25, range: 65, spread: 0.02, aimSpread: 0.006, recoil: 0.012, preferredRange: 12, color: '#c8d1bd', ammoPickup: 30 },
  dmr: { label: 'DMR-14', category: 'Súng thiện xạ', fireMode: 'semi', zoom: 4, magazine: 12, damage: 43, pellets: 1, fireInterval: 0.4, reloadTime: 2.25, range: 175, spread: 0.022, aimSpread: 0.001, recoil: 0.020, preferredRange: 32, color: '#9cb4d7', ammoPickup: 24 },
  sniper: { label: 'SR-98', category: 'Súng ngắm', fireMode: 'bolt', zoom: 6, magazine: 5, damage: 70, pellets: 1, fireInterval: 1.35, reloadTime: 2.9, range: 210, spread: 0.045, aimSpread: 0.0006, recoil: 0.036, preferredRange: 38, color: '#dbb577', ammoPickup: 10 },
  heavySniper: { label: 'AMR-50', category: 'Súng ngắm hạng nặng', fireMode: 'bolt', zoom: 8, magazine: 4, damage: 85, pellets: 1, fireInterval: 1.85, reloadTime: 3.7, range: 250, spread: 0.065, aimSpread: 0.0004, recoil: 0.05, preferredRange: 42, color: '#c79287', ammoPickup: 8 },
  lmg: { label: 'MG-60', category: 'Súng máy', fireMode: 'auto', zoom: 2, magazine: 75, damage: 23, pellets: 1, fireInterval: 0.105, reloadTime: 4.6, range: 145, spread: 0.017, aimSpread: 0.006, recoil: 0.014, preferredRange: 28, color: '#b5b579', ammoPickup: 75 },
};

export function isWeaponKind(kind: string): kind is WeaponType { return WEAPON_ORDER.includes(kind as WeaponType); }
export function ammoKindFor(weapon: WeaponType): AmmoKind { return `${weapon}Ammo`; }
export function weaponForAmmo(kind: LootKind): WeaponType | null {
  if (!kind.endsWith('Ammo')) return null;
  const weapon = kind.slice(0, -4);
  return isWeaponKind(weapon) ? weapon : null;
}
export function emptyAmmo(): Record<WeaponType, number> {
  return Object.fromEntries(WEAPON_ORDER.map(type => [type, 0])) as Record<WeaponType, number>;
}
export function lootLabel(kind: LootKind): string {
  if (kind === 'medkit') return 'Túi cứu thương';
  if (isWeaponKind(kind)) return `${WEAPONS[kind].label} · ${WEAPONS[kind].category}`;
  const weapon = weaponForAmmo(kind);
  return weapon ? `Đạn ${WEAPONS[weapon].label}` : 'Vật phẩm';
}
