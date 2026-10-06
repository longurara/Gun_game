/**
 * Backpacks and gun attachments. A backpack sets how much a person can carry (ammunition, healing items, grenades, spare
 * parts); attachments change how a gun behaves: scopes magnify, a suppressor hushes it, a compensator and grips calm it,
 * an extended magazine holds more. Bots do not use either; this is for the people in the match.
 */
import type { Actor, AmmoType, LootKind, WeaponType } from '../types';
import type { SupplyKind } from './supplies';
import { WEAPONS } from './weapons';

export type PackKind = 'pack1' | 'pack2' | 'pack3';
export type AttachSlot = 'scope' | 'muzzle' | 'grip' | 'mag';
export type AttachKind = 'scope2' | 'scope3' | 'scope4' | 'scope6' | 'suppressor' | 'compensator' | 'vgrip' | 'agrip' | 'extmag';
export type Attachments = Partial<Record<AttachSlot, AttachKind>>;

export const PACK_ORDER: PackKind[] = ['pack1', 'pack2', 'pack3'];
export const ATTACH_ORDER: AttachKind[] = ['scope2', 'scope3', 'scope4', 'scope6', 'suppressor', 'compensator', 'vgrip', 'agrip', 'extmag'];
export const ATTACH_SLOTS: AttachSlot[] = ['scope', 'muzzle', 'grip', 'mag'];

export interface PackConfig { kind: PackKind; label: string; level: 1 | 2 | 3; bonus: number }
/** What a person carries with no pack at all, and what each pack adds. */
export const PACK_BASE = 60;
export const PACKS: Record<PackKind, PackConfig> = {
  pack1: { kind: 'pack1', label: 'Ba lô cấp 1', level: 1, bonus: 50 },
  pack2: { kind: 'pack2', label: 'Ba lô cấp 2', level: 2, bonus: 110 },
  pack3: { kind: 'pack3', label: 'Ba lô cấp 3', level: 3, bonus: 190 },
};

export interface AttachConfig {
  kind: AttachKind; label: string; slot: AttachSlot;
  /** Magnification a scope gives. */
  zoom?: number;
  /** Multipliers: how loud a shot is, how wide it scatters, how hard the gun kicks, how many rounds the magazine holds. */
  loud?: number; spread?: number; recoil?: number; mag?: number;
  /** Which gun classes take it. */
  classes: string[];
}
export const ATTACH: Record<AttachKind, AttachConfig> = {
  scope2: { kind: 'scope2', label: 'Ống ngắm 2×', slot: 'scope', zoom: 2, classes: ['smg', 'ar', 'br', 'dmr', 'lmg', 'sniper'] },
  scope3: { kind: 'scope3', label: 'Ống ngắm 3×', slot: 'scope', zoom: 3, classes: ['smg', 'ar', 'br', 'dmr', 'lmg', 'sniper'] },
  scope4: { kind: 'scope4', label: 'Ống ngắm 4×', slot: 'scope', zoom: 4, classes: ['ar', 'br', 'dmr', 'lmg', 'sniper'] },
  scope6: { kind: 'scope6', label: 'Ống ngắm 6×', slot: 'scope', zoom: 6, classes: ['br', 'dmr', 'sniper'] },
  suppressor: { kind: 'suppressor', label: 'Giảm thanh', slot: 'muzzle', loud: 0.4, classes: ['pistol', 'smg', 'ar', 'br', 'dmr', 'sniper'] },
  compensator: { kind: 'compensator', label: 'Giảm giật', slot: 'muzzle', recoil: 0.8, spread: 0.95, classes: ['smg', 'ar', 'br', 'lmg', 'dmr'] },
  vgrip: { kind: 'vgrip', label: 'Tay cầm dọc', slot: 'grip', recoil: 0.86, classes: ['smg', 'ar', 'br', 'lmg', 'dmr'] },
  agrip: { kind: 'agrip', label: 'Tay cầm chéo', slot: 'grip', spread: 0.86, classes: ['smg', 'ar', 'br', 'lmg', 'dmr'] },
  extmag: { kind: 'extmag', label: 'Băng đạn mở rộng', slot: 'mag', mag: 1.3, classes: ['pistol', 'smg', 'ar', 'br', 'dmr', 'sniper'] },
};
export const isPackKind = (value: unknown): value is PackKind => typeof value === 'string' && Object.hasOwn(PACKS, value);
export const isAttachKind = (value: unknown): value is AttachKind => typeof value === 'string' && Object.hasOwn(ATTACH, value);

export function emptyParts(): Record<AttachKind, number> {
  return Object.fromEntries(ATTACH_ORDER.map(kind => [kind, 0])) as Record<AttachKind, number>;
}

/** Can this attachment go on this gun? */
export function fits(kind: AttachKind, weapon: WeaponType): boolean {
  const config = WEAPONS[weapon];
  return !!config && ATTACH[kind].classes.includes(config.kind);
}

export const attachmentsOf = (actor: Actor, weapon: WeaponType): Attachments => actor.attach?.[weapon] ?? {};

/** A gun's behaviour with what is bolted to it. */
export interface RigStats { zoom: number; loud: number; spread: number; recoil: number; magazine: number; silenced: boolean }
export function rigStats(actor: Actor, weapon: WeaponType): RigStats {
  const config = WEAPONS[weapon], attachments = attachmentsOf(actor, weapon);
  let zoom = config.zoom, loud = 1, spread = 1, recoil = 1, magazine = config.magazine;
  for (const slot of ATTACH_SLOTS) {
    const kind = attachments[slot];
    if (!kind) continue;
    const part = ATTACH[kind];
    if (part.zoom) zoom = Math.max(zoom, part.zoom);
    if (part.loud) loud *= part.loud;
    if (part.spread) spread *= part.spread;
    if (part.recoil) recoil *= part.recoil;
    if (part.mag) magazine = Math.max(config.magazine + 2, Math.round(config.magazine * part.mag));
  }
  return { zoom, loud, spread, recoil, magazine, silenced: loud < 0.7 };
}
export const magazineOf = (actor: Actor, weapon: WeaponType): number => rigStats(actor, weapon).magazine;

/** The four slots of a gun as one number for the network: a digit per slot, 0 empty, else 1 + position in ATTACH_ORDER. */
export function attachCode(attachments: Attachments): number {
  const digit = (slot: AttachSlot) => { const kind = attachments[slot]; return kind ? ATTACH_ORDER.indexOf(kind) + 1 : 0; };
  return digit('scope') * 1000 + digit('muzzle') * 100 + digit('grip') * 10 + digit('mag');
}
export function attachFromCode(code: number): Attachments {
  const result: Attachments = {};
  const digits: Array<[AttachSlot, number]> = [['scope', Math.floor(code / 1000) % 10], ['muzzle', Math.floor(code / 100) % 10], ['grip', Math.floor(code / 10) % 10], ['mag', code % 10]];
  for (const [slot, digit] of digits) { const kind = digit > 0 ? ATTACH_ORDER[digit - 1] : undefined; if (kind && ATTACH[kind].slot === slot) result[slot] = kind; }
  return result;
}

/** Space each carried thing takes: a round, an item. */
const AMMO_SPACE: Record<AmmoType, number> = { '9mm': 0.1, '45acp': 0.12, '357': 0.2, '556': 0.12, '762': 0.15, '12g': 0.3, '300': 0.3, '50cal': 0.5, bolt: 0.4, '40mm': 1.5, rocket: 6 };
const ITEM_SPACE: Record<'medkit' | SupplyKind | AttachKind, number> = {
  medkit: 8, bandage: 1, firstaid: 6, painkiller: 2, energy: 2, frag: 3, smoke: 3, flash: 3, molotov: 3,
  scope2: 2, scope3: 2, scope4: 3, scope6: 3, suppressor: 2, compensator: 2, vgrip: 2, agrip: 2, extmag: 2,
};
export function spaceOf(kind: LootKind | 'medkit', ammo?: AmmoType): number {
  if (ammo) return AMMO_SPACE[ammo] ?? 0.15;
  return (ITEM_SPACE as Record<string, number>)[kind] ?? 0;
}
export const capacityOf = (actor: Actor): number => PACK_BASE + (actor.pack ? PACKS[PACK_ORDER[actor.pack - 1]].bonus : 0);
export function usedSpace(actor: Actor): number {
  let used = actor.medkits * ITEM_SPACE.medkit;
  for (const kind of Object.keys(actor.supplies) as SupplyKind[]) used += (actor.supplies[kind] ?? 0) * ITEM_SPACE[kind];
  for (const kind of ATTACH_ORDER) used += (actor.parts?.[kind] ?? 0) * ITEM_SPACE[kind];
  for (const ammo of Object.keys(actor.reserve) as AmmoType[]) used += actor.reserve[ammo] * AMMO_SPACE[ammo];
  return used;
}
