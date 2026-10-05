import type { AmmoKind, AmmoType, ArmorKind, ArmorSlot, LootKind, WeaponClass, WeaponConfig, WeaponType } from '../types';
import { AMMO_LABEL, AMMO_ORDER, AMMO_PICKUP, ARSENAL, CLASS_BASE } from './arsenal';

export { AMMO_LABEL, AMMO_ORDER, AMMO_PICKUP, ARSENAL, CLASS_BASE };

/** Accent colour shown on HUD cards and pickups, taken from a gun's furniture. */
const FURNITURE_COLOR: Record<string, string> = {
  poly: '#a8b0ac', tan: '#d2b57a', od: '#93a266', wood: '#c08a50', dwood: '#8a5a38',
  camoW: '#7aa052', camoD: '#d4b27a', camoU: '#8f97a3', camoS: '#e3edf2', red: '#d65a4a', wht: '#e8ecee',
};
const METAL_COLOR: Record<string, string> = { gld: '#efc54e', crm: '#dfe7ea', ti: '#a9b8c4', blu: '#6f8fb5', slv: '#cdd2d4' };
/** Core gun whose recorded gunshot each class borrows. */
const VOICE: Record<WeaponClass, WeaponType> = {
  pistol: 'pistol', smg: 'smg', ar: 'rifle', br: 'dmr', lmg: 'lmg', shotgun: 'shotgun', dmr: 'dmr', sniper: 'sniper', amr: 'heavySniper',
};

function accentFor(look: string): string {
  const tokens = look.split(' ');
  const metal = tokens.find(t => METAL_COLOR[t]);
  const furniture = tokens.find(t => FURNITURE_COLOR[t] && t !== 'poly');
  if (metal && (metal === 'gld' || metal === 'crm')) return METAL_COLOR[metal];
  return FURNITURE_COLOR[furniture ?? 'poly'] ?? (metal ? METAL_COLOR[metal] : '#a8b0ac');
}

const round = (value: number, places = 4) => Math.round(value * 10 ** places) / 10 ** places;

export const WEAPONS: Record<WeaponType, WeaponConfig> = Object.fromEntries(ARSENAL.map(entry => {
  const base = CLASS_BASE[entry.cls], m = entry.mods;
  const rate = m.rate ?? 1, range = m.range ?? 1, spread = m.spread ?? 1;
  const config: WeaponConfig = {
    id: entry.id, label: entry.label, category: entry.category ?? base.label, kind: entry.cls, ammoType: entry.ammo, tier: entry.tier,
    sidearm: base.sidearm, fireMode: m.mode ?? base.fireMode, zoom: m.zoom ?? base.zoom,
    magazine: m.mag ?? base.magazine, damage: round(base.damage * (m.dmg ?? 1), 3), pellets: m.pellets ?? base.pellets,
    fireInterval: round(base.fireInterval / rate), reloadTime: round(base.reloadTime * (m.reload ?? 1), 3),
    range: Math.round(base.range * range), spread: round(base.spread * spread), aimSpread: round(base.aimSpread * spread, 5),
    recoil: round(base.recoil * (m.rec ?? 1)), preferredRange: Math.round(base.preferredRange * range),
    color: accentFor(entry.look), ammoPickup: AMMO_PICKUP[entry.ammo],
    loudness: Math.round(base.loudness * (m.loud ?? 1)),
    value: round(base.value + (entry.tier - 1) * 0.8, 2),
    look: entry.look, voice: VOICE[entry.cls],
  };
  return [entry.id, config];
}));

/** The original eight guns, in their original order. */
export const CORE_WEAPONS: readonly WeaponType[] = ['rifle', 'shotgun', 'smg', 'pistol', 'dmr', 'sniper', 'heavySniper', 'lmg'];

/** Every gun id. The original eight come first and keep the number keys of the arena armoury. */
export const WEAPON_ORDER: readonly WeaponType[] = ARSENAL.map(entry => entry.id);

export const GUNS_BY_CLASS: Record<WeaponClass, WeaponType[]> = { pistol: [], smg: [], ar: [], br: [], lmg: [], shotgun: [], dmr: [], sniper: [], amr: [] };
for (const entry of ARSENAL) GUNS_BY_CLASS[entry.cls].push(entry.id);

/** Loadout: two main guns and one sidearm, as in a battle royale. */
export const PRIMARY_SLOTS = 2;
export const isSidearm = (weapon: WeaponType): boolean => WEAPONS[weapon]?.sidearm === true;

/** Owned weapons in slot order: main guns first (oldest first), then the sidearm. Slots 1 and 2 are main guns, slot 3 the sidearm. */
export function slotOrder(owned: readonly WeaponType[]): WeaponType[] {
  return [...owned.filter(w => !isSidearm(w)).slice(0, PRIMARY_SLOTS), ...owned.filter(isSidearm).slice(0, 1)];
}

/** Damage absorbed by each armour tier and how much punishment it can take before breaking. */
export const ARMOR_REDUCTION = [0, 0.3, 0.4, 0.55] as const;
export const ARMOR_DURABILITY = [0, 80, 150, 230] as const;
export const ARMOR_NAMES: Record<ArmorSlot, string> = { helmet: 'Mũ bảo hiểm', vest: 'Áo giáp' };
export function isArmorKind(kind: string): kind is ArmorKind { return /^(?:helmet|vest)[123]$/.test(kind); }
export function parseArmor(kind: ArmorKind): { slot: ArmorSlot; level: number } {
  return { slot: kind.startsWith('helmet') ? 'helmet' : 'vest', level: Number(kind.slice(-1)) };
}
export const armorKind = (slot: ArmorSlot, level: number): ArmorKind => `${slot}${level as 1 | 2 | 3}`;

export function isWeaponKind(kind: string): kind is WeaponType { return Object.hasOwn(WEAPONS, kind); }
/** Ammunition pickup for a calibre. */
export function ammoKindOf(ammo: AmmoType): AmmoKind { return `${ammo}Ammo`; }
/** The ammunition a gun eats. */
export function ammoKindFor(weapon: WeaponType): AmmoKind { return ammoKindOf(WEAPONS[weapon].ammoType); }
/** Calibre of an ammunition pickup, or null for anything else. */
export function ammoTypeOf(kind: LootKind): AmmoType | null {
  if (!kind.endsWith('Ammo')) return null;
  const type = kind.slice(0, -4);
  return (AMMO_ORDER as readonly string[]).includes(type) ? type as AmmoType : null;
}
/** Magazines of per-gun rounds, indexed by gun id (all zero). */
export function emptyAmmo(): Record<WeaponType, number> {
  return Object.fromEntries(WEAPON_ORDER.map(type => [type, 0])) as Record<WeaponType, number>;
}
/** Spare rounds, indexed by calibre (all zero). */
export function emptyReserve(): Record<AmmoType, number> {
  return Object.fromEntries(AMMO_ORDER.map(type => [type, 0])) as Record<AmmoType, number>;
}
export function lootLabel(kind: LootKind): string {
  if (kind === 'medkit') return 'Túi cứu thương';
  if (isArmorKind(kind)) { const { slot, level } = parseArmor(kind); return `${ARMOR_NAMES[slot]} cấp ${level}`; }
  if (isWeaponKind(kind)) return `${WEAPONS[kind].label} · ${WEAPONS[kind].category}`;
  const ammo = ammoTypeOf(kind);
  return ammo ? `Đạn ${AMMO_LABEL[ammo]}` : 'Vật phẩm';
}
