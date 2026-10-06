import { isSupplyKind, SUPPLIES } from './supplies';
import type { Actor, LootKind, WeaponType } from '../types';
import { ammoTypeOf, isArmorKind, isSidearm, isWeaponKind, parseArmor, PRIMARY_SLOTS, WEAPONS } from './weapons';

/** How far a shot carries, in metres: bots inside this radius may investigate it. */
export const gunshotLoudness = (weapon: WeaponType): number => WEAPONS[weapon].loudness;

const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));

/** Rough value of a weapon when picked up fresh (class baseline plus a bonus for rarer guns). */
export const weaponValue = (weapon: WeaponType): number => WEAPONS[weapon].value;

/** Expected damage output at a given range: raw DPS (human-capped) scaled by how well the range suits the gun. */
export function weaponScore(weapon: WeaponType, distance: number): number {
  const config = WEAPONS[weapon];
  if (distance > config.range * 0.9) return 0;
  const dps = config.damage * config.pellets / Math.max(config.fireInterval, 0.2);
  const fit = clamp(1 - Math.abs(distance - config.preferredRange) / (config.range * 0.55), 0.1, 1);
  // A shotgun lands all its pellets at once up close, which raw DPS understates.
  const burst = config.kind === 'shotgun' && distance < 14 ? 1.6 : 1;
  return dps * fit * burst;
}

export function usable(actor: Actor, weapon: WeaponType): boolean {
  return actor.ownedWeapons.includes(weapon) && actor.ammo[weapon] + actor.reserve[WEAPONS[weapon].ammoType] > 0;
}

/**
 * Best owned weapon for the range. The current gun keeps a bonus so bots do not flip-flop,
 * and a gun with a loaded magazine beats one that needs reloading.
 */
export function chooseWeapon(actor: Actor, distance: number): WeaponType {
  let best = actor.weapon;
  let bestScore = -1;
  for (const weapon of actor.ownedWeapons) {
    if (!usable(actor, weapon)) continue;
    let score = weaponScore(weapon, distance);
    if (weapon === actor.weapon) score *= 1.3;
    if (actor.ammo[weapon] === 0) score *= 0.55;
    if (score > bestScore) { best = weapon; bestScore = score; }
  }
  return best;
}

/** The least useful weapon of a group: the one a bot gives up when it finds something better. */
export function weakestWeapon(group: readonly WeaponType[]): WeaponType {
  return group.reduce((worst, w) => (weaponValue(w) < weaponValue(worst) ? w : worst), group[0]);
}

/** How much a bot wants an item (0 = leave it). Used to rank pickups by value over distance. */
export function lootUtility(actor: Actor, kind: LootKind): number {
  if (kind === 'medkit') return actor.medkits >= 3 ? 0 : (actor.health < 70 ? 7 : 4) - actor.medkits;
  if (isSupplyKind(kind)) {
    const have = actor.supplies[kind], config = SUPPLIES[kind];
    if (have >= config.max) return 0;
    // Healing and boosts matter most when hurt; grenades are a modest extra.
    return config.group === 'heal' ? (actor.health < 70 ? 5 : 2.5) - have * 0.3 : config.group === 'boost' ? 2 - have * 0.4 : Math.max(0.5, 1.6 - have * 0.5);
  }
  if (isArmorKind(kind)) {
    const { slot, level } = parseArmor(kind);
    return level > actor[slot] ? 3 + level * 1.5 - actor[slot] : 0;
  }
  if (isWeaponKind(kind)) {
    if (actor.ownedWeapons.includes(kind)) return actor.reserve[WEAPONS[kind].ammoType] < WEAPONS[kind].magazine ? 2 : 0;
    const group = actor.ownedWeapons.filter(w => isSidearm(w) === isSidearm(kind));
    if (group.length < (isSidearm(kind) ? 1 : PRIMARY_SLOTS)) return weaponValue(kind);
    // Slots are full: only worth a detour when it clearly beats the weakest gun carried.
    const gain = weaponValue(kind) - weaponValue(weakestWeapon(group));
    return gain >= 2 ? gain : 0;
  }
  const ammo = ammoTypeOf(kind);
  if (!ammo) return 0;
  // Ammunition is worth taking only for a calibre one of the carried guns eats; the biggest magazine sets how much is wanted.
  const guns = actor.ownedWeapons.filter(w => WEAPONS[w].ammoType === ammo);
  if (!guns.length) return 0;
  const magazine = Math.max(...guns.map(w => WEAPONS[w].magazine));
  const want = magazine * 4 - actor.reserve[ammo];
  if (want < magazine * 0.5) return 0;
  const current = guns.includes(actor.weapon) ? 1.4 : 1;
  return 4 * current * clamp(want / (magazine * 4), 0.2, 1);
}

/** Weight of a bot in an off-screen duel (abstract simulation): best usable gun at that range, scaled by health. */
export function duelPower(actor: Actor, distance: number): number {
  let best = 0;
  for (const weapon of actor.ownedWeapons) if (usable(actor, weapon)) best = Math.max(best, weaponScore(weapon, distance));
  // Armour tilts a duel: the vest and helmet each soak part of the damage.
  const armor = 1 + actor.vest * 0.12 + actor.helmet * 0.08;
  return Math.max(8, best) * (0.35 + actor.health / 100 * 0.65) * armor;
}
