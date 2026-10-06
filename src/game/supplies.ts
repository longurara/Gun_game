/**
 * Consumables and throwables carried in the pack: healing items (bandage, first aid kit), boosts (painkillers, energy
 * drinks) and grenades. The old medkit stays a field of its own on the actor; everything new lives in `supplies`.
 */
export type SupplyKind = 'bandage' | 'firstaid' | 'painkiller' | 'energy' | 'frag' | 'smoke' | 'flash' | 'molotov';
export type SupplyGroup = 'heal' | 'boost' | 'throw';
/** Something a person uses over a few seconds: the medkit, healing items and boosts. */
export type UseKind = 'medkit' | 'bandage' | 'firstaid' | 'painkiller' | 'energy';
export type ThrowKind = 'frag' | 'smoke' | 'flash' | 'molotov';

export interface SupplyConfig {
  kind: SupplyKind; label: string; group: SupplyGroup;
  /** How many come in one pickup, and the most that can be carried. */
  stack: number; max: number;
  /** Seconds to use it. */
  time: number;
  /** Healing: health restored, and the health it cannot lift you past. */
  heal: number; cap: number;
  /** Boost: how much it adds to the boost gauge (0-100). */
  boost: number;
}

export const SUPPLIES: Record<SupplyKind, SupplyConfig> = {
  bandage: { kind: 'bandage', label: 'Băng gạc', group: 'heal', stack: 4, max: 12, time: 2, heal: 12, cap: 75, boost: 0 },
  firstaid: { kind: 'firstaid', label: 'Hộp sơ cứu', group: 'heal', stack: 1, max: 4, time: 4, heal: 45, cap: 90, boost: 0 },
  painkiller: { kind: 'painkiller', label: 'Thuốc giảm đau', group: 'boost', stack: 1, max: 4, time: 4, heal: 0, cap: 0, boost: 60 },
  energy: { kind: 'energy', label: 'Nước tăng lực', group: 'boost', stack: 1, max: 5, time: 3, heal: 0, cap: 0, boost: 40 },
  frag: { kind: 'frag', label: 'Lựu đạn', group: 'throw', stack: 1, max: 5, time: 0, heal: 0, cap: 0, boost: 0 },
  smoke: { kind: 'smoke', label: 'Lựu đạn khói', group: 'throw', stack: 1, max: 5, time: 0, heal: 0, cap: 0, boost: 0 },
  flash: { kind: 'flash', label: 'Lựu đạn chớp sáng', group: 'throw', stack: 1, max: 5, time: 0, heal: 0, cap: 0, boost: 0 },
  molotov: { kind: 'molotov', label: 'Bình cháy', group: 'throw', stack: 1, max: 5, time: 0, heal: 0, cap: 0, boost: 0 },
};
export const SUPPLY_ORDER: SupplyKind[] = ['bandage', 'firstaid', 'painkiller', 'energy', 'frag', 'smoke', 'flash', 'molotov'];
export const THROW_ORDER: ThrowKind[] = ['frag', 'smoke', 'flash', 'molotov'];
export const isSupplyKind = (value: unknown): value is SupplyKind => typeof value === 'string' && value in SUPPLIES;
export const isThrowKind = (value: unknown): value is ThrowKind => typeof value === 'string' && THROW_ORDER.includes(value as ThrowKind);
export const isUseKind = (value: unknown): value is UseKind => value === 'medkit' || (isSupplyKind(value) && SUPPLIES[value].group !== 'throw');

export function emptySupplies(): Record<SupplyKind, number> {
  return Object.fromEntries(SUPPLY_ORDER.map(kind => [kind, 0])) as Record<SupplyKind, number>;
}

/** The medkit is the strongest healer; the new items cap what they can restore. */
export const HEAL_CAP: Record<'medkit' | 'bandage' | 'firstaid', number> = { medkit: 100, firstaid: SUPPLIES.firstaid.cap, bandage: SUPPLIES.bandage.cap };
/** The boost gauge's top value and how fast it runs down (per second). */
export const BOOST_MAX = 100;
export const BOOST_DRAIN = 1;
/** Health regained per second while boosted: more at a fuller gauge. */
export const boostRegen = (boost: number): number => boost <= 0 ? 0 : boost < 30 ? 0.5 : boost < 60 ? 1 : boost < 90 ? 1.5 : 2;
/** A boosted runner is a little faster. */
export const boostSpeed = (boost: number): number => boost >= 60 ? 1.06 : boost > 0 ? 1.03 : 1;

/** Codes for the network: 0 = nothing, then the things a person can be using. */
export const USE_CODES: Array<UseKind | null> = [null, 'medkit', 'bandage', 'firstaid', 'painkiller', 'energy'];
