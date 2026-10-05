import type { AmmoType, WeaponClass, WeaponConfig } from '../types';

/**
 * The whole armoury as data. Every gun is a class (which sets the baseline handling), a calibre (which ammunition it
 * eats), a loot tier and a handful of multipliers that make it feel different from its siblings. `look` is a list of
 * part tokens read by the model builder (src/weapon-models.ts); it never influences gameplay.
 */
export interface ClassBase {
  label: string; magazine: number; damage: number; pellets: number; fireInterval: number; reloadTime: number;
  range: number; spread: number; aimSpread: number; recoil: number; preferredRange: number; zoom: number;
  fireMode: WeaponConfig['fireMode']; loudness: number; value: number; sidearm: boolean;
}

export const CLASS_BASE: Record<WeaponClass, ClassBase> = {
  pistol: { label: 'Súng lục', magazine: 15, damage: 32, pellets: 1, fireInterval: 0.28, reloadTime: 1.25, range: 65, spread: 0.02, aimSpread: 0.006, recoil: 0.012, preferredRange: 12, zoom: 1.3, fireMode: 'semi', loudness: 60, value: 3, sidearm: true },
  smg: { label: 'Tiểu liên', magazine: 32, damage: 18, pellets: 1, fireInterval: 0.075, reloadTime: 1.65, range: 75, spread: 0.018, aimSpread: 0.007, recoil: 0.006, preferredRange: 16, zoom: 1.5, fireMode: 'auto', loudness: 75, value: 6, sidearm: false },
  ar: { label: 'Súng trường', magazine: 30, damage: 25, pellets: 1, fireInterval: 0.15, reloadTime: 1.9, range: 135, spread: 0.006, aimSpread: 0.002, recoil: 0.010, preferredRange: 24, zoom: 1.4, fireMode: 'auto', loudness: 120, value: 8, sidearm: false },
  br: { label: 'Súng trường chiến đấu', magazine: 20, damage: 35, pellets: 1, fireInterval: 0.21, reloadTime: 2.1, range: 150, spread: 0.008, aimSpread: 0.0015, recoil: 0.016, preferredRange: 28, zoom: 1.6, fireMode: 'auto', loudness: 128, value: 8, sidearm: false },
  lmg: { label: 'Súng máy', magazine: 75, damage: 23, pellets: 1, fireInterval: 0.105, reloadTime: 4.6, range: 145, spread: 0.017, aimSpread: 0.006, recoil: 0.014, preferredRange: 28, zoom: 2, fireMode: 'auto', loudness: 130, value: 7, sidearm: false },
  shotgun: { label: 'Shotgun', magazine: 6, damage: 11, pellets: 8, fireInterval: 0.85, reloadTime: 2.65, range: 38, spread: 0.07, aimSpread: 0.06, recoil: 0.026, preferredRange: 10, zoom: 1.2, fireMode: 'semi', loudness: 95, value: 6, sidearm: false },
  dmr: { label: 'Súng thiện xạ', magazine: 12, damage: 43, pellets: 1, fireInterval: 0.4, reloadTime: 2.25, range: 175, spread: 0.022, aimSpread: 0.001, recoil: 0.020, preferredRange: 32, zoom: 4, fireMode: 'semi', loudness: 135, value: 8, sidearm: false },
  sniper: { label: 'Súng ngắm', magazine: 5, damage: 70, pellets: 1, fireInterval: 1.35, reloadTime: 2.9, range: 210, spread: 0.045, aimSpread: 0.0006, recoil: 0.036, preferredRange: 38, zoom: 6, fireMode: 'bolt', loudness: 175, value: 7, sidearm: false },
  amr: { label: 'Súng ngắm hạng nặng', magazine: 4, damage: 85, pellets: 1, fireInterval: 1.85, reloadTime: 3.7, range: 250, spread: 0.065, aimSpread: 0.0004, recoil: 0.05, preferredRange: 42, zoom: 8, fireMode: 'bolt', loudness: 230, value: 6, sidearm: false },
};

/** Rounds in one ammunition pickup, per calibre. */
export const AMMO_PICKUP: Record<AmmoType, number> = { '9mm': 40, '45acp': 32, '357': 18, '556': 45, '762': 40, '12g': 12, '300': 10, '50cal': 8 };
export const AMMO_LABEL: Record<AmmoType, string> = { '9mm': '9mm', '45acp': '.45 ACP', '357': '.357 Magnum', '556': '5.56mm', '762': '7.62mm', '12g': '12 Gauge', '300': '.300 Mag', '50cal': '.50 BMG' };
export const AMMO_ORDER: readonly AmmoType[] = ['9mm', '45acp', '357', '556', '762', '12g', '300', '50cal'];

/** Multipliers over the class baseline; `mag`, `zoom`, `pellets` and `mode` are absolute. */
export interface Mods {
  dmg?: number; rate?: number; mag?: number; reload?: number; range?: number; spread?: number; rec?: number;
  zoom?: number; pellets?: number; mode?: WeaponConfig['fireMode']; loud?: number;
}

export interface ArsenalEntry {
  id: string; label: string; cls: WeaponClass; tier: 1 | 2 | 3; ammo: AmmoType; mods: Mods; look: string; category?: string;
}

type Row = [id: string, label: string, tier: 1 | 2 | 3, ammo: AmmoType, mods: Mods, look: string, category?: string];
const rows = (cls: WeaponClass, list: Row[]): ArsenalEntry[] =>
  list.map(([id, label, tier, ammo, mods, look, category]) => ({ id, label, cls, tier, ammo, mods, look, category }));

const REVOLVER = 'Súng lục ổ xoay';
const MACHINE_PISTOL = 'Súng lục tự động';
const BULLPUP = 'Súng trường bullpup';
const PUMP = 'Shotgun nòng trượt';
const AUTO_SHOTGUN = 'Shotgun bán tự động';
const BREAK = 'Shotgun hai nòng';
const SAWN = 'Shotgun nòng cụt';
const LEVER = 'Shotgun cần gạt';
const CARBINE = 'Carbine';
const BOLT = 'Súng ngắm nòng trượt';

/** The first eight are the original guns, unchanged; everything after them is new. */
export const ARSENAL: readonly ArsenalEntry[] = [
  // ---------------------------------------------------------------- original eight (ids are load-bearing)
  { id: 'rifle', label: 'AR-26', cls: 'ar', tier: 1, ammo: '556', mods: {}, look: 'fixed rail curved dot flash blk poly' },
  { id: 'shotgun', label: 'SG-8', cls: 'shotgun', tier: 1, ammo: '12g', mods: {}, look: 'pump wood blk' },
  { id: 'smg', label: 'VX-9', cls: 'smg', tier: 1, ammo: '9mm', mods: {}, look: 'fold slim straight dot supp blk poly' },
  { id: 'pistol', label: 'P-9', cls: 'pistol', tier: 1, ammo: '9mm', mods: {}, look: 'std gry poly' },
  { id: 'dmr', label: 'DMR-14', cls: 'dmr', tier: 1, ammo: '762', mods: {}, look: 'thumb vent box x4 brake blk wood' },
  { id: 'sniper', label: 'SR-98', cls: 'sniper', tier: 1, ammo: '300', mods: {}, look: 'wood inner x6 plain blu wood' },
  { id: 'heavySniper', label: 'AMR-50', cls: 'amr', tier: 1, ammo: '50cal', mods: {}, look: 'skel box x8 brake bipod gry poly' },
  { id: 'lmg', label: 'MG-60', cls: 'lmg', tier: 1, ammo: '762', mods: {}, look: 'fixed chunky drum dot bipod carry blk poly' },

  // ---------------------------------------------------------------- pistols (13 more)
  ...rows('pistol', [
    ['cp7', 'CP-7', 1, '9mm', { dmg: 0.88, rate: 1.15, mag: 12, reload: 0.9, range: 0.85, rec: 0.8 }, 'compact blk poly'],
    ['m45', 'M-45', 1, '45acp', { dmg: 1.12, rate: 0.9, mag: 8, reload: 1.05, rec: 1.15 }, 'std slv wood'],
    ['duo17', 'Duo-17', 1, '9mm', { dmg: 0.94, rate: 1.1, mag: 17 }, 'std ext blk poly'],
    ['tac45', 'TAC-45', 2, '45acp', { dmg: 1.18, rate: 1.0, mag: 12, spread: 0.85 }, 'std light blk tan'],
    ['viper', 'Viper X', 2, '9mm', { dmg: 1.05, rate: 1.1, mag: 15, spread: 0.7, range: 1.15 }, 'long dot blk gry'],
    ['spectre', 'Specter S', 2, '9mm', { dmg: 1.02, rate: 1.05, mag: 15, loud: 0.5, range: 1.05 }, 'long supp gry od'],
    ['snub38', 'Snub-38', 1, '357', { dmg: 1.2, rate: 0.82, mag: 5, reload: 1.4, range: 0.8 }, 'revolver short slv wood', REVOLVER],
    ['marshal', 'Marshal R', 1, '357', { dmg: 1.4, rate: 0.7, mag: 6, reload: 1.55, rec: 1.3 }, 'revolver slv dwood', REVOLVER],
    ['bulldog', 'Bulldog R-44', 2, '357', { dmg: 1.62, rate: 0.62, mag: 6, reload: 1.7, rec: 1.6, range: 1.15 }, 'revolver long blu dwood', REVOLVER],
    ['matador', 'Matador', 3, '357', { dmg: 1.85, rate: 0.66, mag: 6, reload: 1.6, rec: 1.8, range: 1.2, spread: 0.8 }, 'revolver long comp gld wood', REVOLVER],
    ['hawk50', 'Hawk H-50', 2, '357', { dmg: 1.7, rate: 0.6, mag: 7, reload: 1.5, rec: 1.7 }, 'hand blk poly'],
    ['gilded', 'Gilded Hawk', 3, '357', { dmg: 1.9, rate: 0.62, mag: 8, reload: 1.4, rec: 1.7, spread: 0.85 }, 'hand gld wood'],
    ['mp18', 'MP-18', 2, '9mm', { dmg: 0.62, rate: 2.4, mag: 20, reload: 1.3, spread: 1.4, range: 0.9, mode: 'auto' }, 'machine ext supp blk poly', MACHINE_PISTOL],
  ]),

  // ---------------------------------------------------------------- submachine guns (14 more)
  ...rows('smg', [
    ['hornet', 'Hornet-10', 1, '9mm', { dmg: 0.95, rate: 1.1, mag: 30, spread: 0.9 }, 'fold rail straight dot flash blk poly'],
    ['mamba', 'Mamba M5', 1, '9mm', { dmg: 1.0, rate: 1.05, mag: 30, rec: 1.1 }, 'fixed slim straight irons plain blk poly'],
    ['wasp', 'Wasp PDW', 1, '9mm', { dmg: 0.92, rate: 1.2, mag: 40, range: 0.9, rec: 0.9 }, 'bullpup slim curved dot plain blk od'],
    ['raptor45', 'Raptor-45', 2, '45acp', { dmg: 1.3, rate: 0.82, mag: 25, reload: 1.1, rec: 1.15, range: 1.05 }, 'fold rail straight holo comp blk tan'],
    ['gangster', 'Gangster T', 2, '45acp', { dmg: 1.22, rate: 0.78, mag: 50, reload: 1.35, rec: 1.2, spread: 1.15 }, 'wood chunky drum irons plain blk dwood'],
    ['vandal', 'Vandal V-9', 1, '9mm', { dmg: 1.04, rate: 1.0, mag: 32 }, 'skel mlok curved dot comp vgrip blk poly'],
    ['thunder', 'Thunder TX', 2, '9mm', { dmg: 1.0, rate: 1.15, mag: 50, reload: 1.15, range: 1.1, spread: 0.85 }, 'fold rail ext holo lsupp vgrip gry od'],
    ['cobra', 'Cobra C-9', 2, '9mm', { dmg: 1.05, rate: 1.1, mag: 32, loud: 0.5, spread: 0.8 }, 'short short straight dot lsupp blk poly'],
    ['imp', 'Imp Micro', 1, '9mm', { dmg: 0.8, rate: 1.4, mag: 20, range: 0.78, rec: 0.7, spread: 1.3 }, 'none slim stick irons plain blk poly'],
    ['badger', 'Badger B-9', 1, '9mm', { dmg: 1.1, rate: 0.9, mag: 32, reload: 1.1 }, 'fixed chunky straight acog flash blk poly'],
    ['lynx', 'Lynx L-5', 2, '45acp', { dmg: 1.28, rate: 0.9, mag: 30, rec: 1.0, spread: 0.85 }, 'adj mlok curved x2 brake agrip blk tan'],
    ['falconfs', 'Falcon FS', 3, '9mm', { dmg: 1.2, rate: 1.2, mag: 40, reload: 0.85, spread: 0.7, range: 1.15 }, 'fold quad ext holo comp vgrip laser ti camoD'],
    ['phantom', 'Phantom S', 3, '45acp', { dmg: 1.35, rate: 1.0, mag: 30, loud: 0.45, spread: 0.7, range: 1.12 }, 'fixed mlok curved holo lsupp agrip blk camoU'],
    ['maverick', 'Maverick', 3, '9mm', { dmg: 1.18, rate: 1.3, mag: 60, reload: 1.5, spread: 0.9 }, 'skel rail dual x2 comp vgrip crm camoS'],
  ]),

  // ---------------------------------------------------------------- assault rifles (23 more)
  ...rows('ar', [
    ['vanguard', 'Vanguard', 1, '556', { dmg: 1.04, rate: 0.96, mag: 30, rec: 0.95 }, 'fixed rail curved dot flash vgrip blk od'],
    ['warden', 'Warden W-16', 1, '556', { dmg: 0.96, rate: 1.1, mag: 30, range: 0.88, rec: 0.9 }, 'fold short curved irons plain gry blk', CARBINE],
    ['ranger', 'Ranger R-4', 1, '556', { dmg: 1.0, rate: 1.0, mag: 30 }, 'fixed quad curved holo flash blk tan'],
    ['sentinel', 'Sentinel S-5', 1, '556', { dmg: 1.02, rate: 1.0, mag: 30, spread: 0.9 }, 'adj mlok curved x2 brake agrip blk blk'],
    ['kodiak', 'Kodiak KD-47', 1, '762', { dmg: 1.4, rate: 0.82, mag: 30, rec: 1.3, range: 0.95 }, 'wood wood banana irons brake wood wood'],
    ['taiga', 'Taiga KD-74', 1, '556', { dmg: 1.08, rate: 0.95, mag: 30, rec: 1.0 }, 'fixed vent banana dot brake blk poly'],
    ['aurora', 'Aurora A-3', 2, '556', { dmg: 1.08, rate: 1.0, mag: 30, spread: 0.7, rec: 0.85 }, 'bullpup slim curved acog plain od od', BULLPUP],
    ['bastion', 'Bastion B-7', 2, '556', { dmg: 1.0, rate: 1.1, mag: 42, rec: 0.9, reload: 1.05 }, 'bullpup mlok ext holo flash blk blk', BULLPUP],
    ['ember', 'Ember E-12', 2, '556', { dmg: 1.12, rate: 1.0, mag: 30, spread: 0.8, range: 1.05 }, 'fixed mlok curved holo comp vgrip blk tan'],
    ['sable', 'Sable SB-9', 2, '762', { dmg: 1.45, rate: 0.84, mag: 30, rec: 1.2, spread: 0.9 }, 'fixed rail banana x2 brake agrip gry od'],
    ['stalker', 'Stalker', 2, '556', { dmg: 1.06, rate: 0.95, mag: 30, loud: 0.5, spread: 0.85 }, 'fold mlok curved dot lsupp agrip blk od'],
    ['carbine9', 'Cadet C-9', 1, '556', { dmg: 0.9, rate: 1.25, mag: 30, range: 0.8, rec: 0.8, spread: 1.1 }, 'fold short curved irons plain blk poly', CARBINE],
    ['titan', 'Titan T-70', 2, '762', { dmg: 1.5, rate: 0.78, mag: 25, rec: 1.45, range: 1.05 }, 'fixed chunky box x2 brake bipod gry od'],
    ['nomad', 'Nomad N-3', 1, '556', { dmg: 0.98, rate: 1.05, mag: 30 }, 'skel slim curved dot flash blk camoD'],
    ['tundra', 'Tundra TR', 2, '556', { dmg: 1.05, rate: 1.0, mag: 30, spread: 0.9 }, 'fixed rail curved holo flash vgrip blk camoS'],
    ['reaper', 'Reaper RX', 3, '556', { dmg: 1.2, rate: 1.12, mag: 40, rec: 0.8, spread: 0.65, range: 1.1 }, 'adj mlok ext holo comp agrip laser blk camoU'],
    ['iron', 'Ironclad', 2, '762', { dmg: 1.42, rate: 0.9, mag: 30, rec: 1.2, spread: 0.85 }, 'wood quad banana x2 plain agrip blk wood'],
    ['cyclone', 'Cyclone C-90', 3, '556', { dmg: 1.12, rate: 1.4, mag: 60, rec: 0.9, reload: 1.2, spread: 0.95 }, 'fixed rail dual holo flash vgrip ti camoW'],
    ['solstice', 'Solstice', 3, '556', { dmg: 1.25, rate: 1.0, mag: 35, spread: 0.55, rec: 0.75, range: 1.15 }, 'adj mlok curved x3 comp vgrip laser ti camoD'],
    ['havoc', 'Havoc H-5', 2, '556', { dmg: 1.1, rate: 1.0, mag: 30, spread: 0.85 }, 'fixed vent curved holo brake agrip blk od'],
    ['pioneer', 'Pioneer', 1, '556', { dmg: 1.0, rate: 0.98, mag: 30 }, 'wood slim curved irons flash blk wood'],
    ['ghost', 'Ghost G-6', 3, '556', { dmg: 1.2, rate: 1.05, mag: 30, loud: 0.45, spread: 0.6, rec: 0.8 }, 'fixed mlok curved x2 lsupp agrip blk camoS'],
    ['empire', 'Empire EM-1', 3, '762', { dmg: 1.62, rate: 0.9, mag: 30, rec: 1.1, spread: 0.7, range: 1.1 }, 'fixed quad ext holo comp vgrip gld wood'],
  ]),

  // ---------------------------------------------------------------- battle rifles (10)
  ...rows('br', [
    ['mk47', 'Mk-47', 1, '762', { dmg: 1.0, rate: 1.0, mag: 20 }, 'fixed rail box dot brake blk poly'],
    ['bolero', 'Bolero BR', 1, '762', { dmg: 1.05, rate: 0.9, mag: 20, rec: 1.1 }, 'wood wood box irons brake blk wood'],
    ['hammer', 'Hammer H-3', 2, '762', { dmg: 1.1, rate: 1.0, mag: 20, spread: 0.85, rec: 1.05 }, 'adj mlok box x4 brake bipod blk tan'],
    ['bruiser', 'Bruiser', 1, '762', { dmg: 1.12, rate: 0.82, mag: 20, rec: 1.2 }, 'thumb vent box dot comp blk wood'],
    ['regent', 'Regent RG', 2, '762', { dmg: 1.08, rate: 1.05, mag: 25, spread: 0.8 }, 'fixed quad ext holo comp agrip blk od'],
    ['sovereign', 'Sovereign', 3, '762', { dmg: 1.22, rate: 1.0, mag: 25, spread: 0.65, rec: 0.9, range: 1.1 }, 'adj mlok ext x4 brake vgrip laser ti camoD'],
    ['talon', 'Talon T-9', 2, '762', { dmg: 1.05, rate: 1.15, mag: 20, rec: 1.0 }, 'bullpup slim box acog plain blk od', BULLPUP],
    ['colossus', 'Colossus', 3, '762', { dmg: 1.3, rate: 0.9, mag: 20, rec: 1.0, spread: 0.7 }, 'skel chunky box x4 brake bipod gld camoW'],
    ['dragoon', 'Dragoon', 2, '762', { dmg: 1.0, rate: 1.0, mag: 20, loud: 0.5, spread: 0.85 }, 'fixed mlok box x2 lsupp agrip blk camoU'],
    ['goliath', 'Goliath GL', 3, '762', { dmg: 1.28, rate: 0.95, mag: 30, reload: 1.1, spread: 0.7 }, 'fixed quad dual holo comp vgrip crm camoD'],
  ]),

  // ---------------------------------------------------------------- light machine guns (9 more)
  ...rows('lmg', [
    ['mg42', 'Hailstorm', 1, '762', { dmg: 1.12, rate: 1.1, mag: 100, reload: 1.1, rec: 1.2, spread: 1.15 }, 'fixed vent belt irons plain bipod carry blk poly'],
    ['bulwark', 'Bulwark M-4', 1, '556', { dmg: 0.95, rate: 1.05, mag: 100, reload: 1.0, rec: 0.9 }, 'fixed rail belt dot flash bipod blk od'],
    ['ravager', 'Ravager', 2, '762', { dmg: 1.2, rate: 1.0, mag: 75, reload: 0.95, spread: 0.9 }, 'skel mlok drum x2 brake bipod vgrip blk tan'],
    ['juggernaut', 'Juggernaut', 2, '556', { dmg: 1.05, rate: 1.15, mag: 120, reload: 1.15, spread: 1.0 }, 'fixed chunky belt holo comp bipod carry gry od'],
    ['gatherer', 'Gatherer G-7', 1, '556', { dmg: 0.92, rate: 1.0, mag: 60, reload: 0.9, rec: 0.85 }, 'adj slim box dot flash vgrip blk poly'],
    ['sierra', 'Sierra SW', 2, '762', { dmg: 1.18, rate: 0.95, mag: 80, spread: 0.85, rec: 1.0 }, 'wood wood drum irons brake bipod blk wood'],
    ['tempest', 'Tempest', 3, '556', { dmg: 1.12, rate: 1.3, mag: 150, reload: 1.2, rec: 0.9, spread: 0.85 }, 'fixed mlok belt holo comp bipod vgrip ti camoD'],
    ['anvil', 'Anvil AV-60', 3, '762', { dmg: 1.35, rate: 1.05, mag: 100, reload: 1.1, spread: 0.8, range: 1.1 }, 'skel chunky belt x2 brake bipod carry blk camoW'],
    ['monsoon', 'Monsoon', 2, '556', { dmg: 1.0, rate: 1.1, mag: 90, loud: 0.5, spread: 0.9 }, 'fold mlok drum dot lsupp bipod blk camoU'],
  ]),

  // ---------------------------------------------------------------- shotguns (13 more)
  ...rows('shotgun', [
    ['m870', 'Bouncer 12', 1, '12g', { dmg: 1.08, rate: 0.95, mag: 6, pellets: 8, spread: 0.9 }, 'pump rail blk dwood', PUMP],
    ['trencher', 'Trencher', 1, '12g', { dmg: 1.0, rate: 1.05, mag: 7, pellets: 8, range: 0.95 }, 'pump short blk poly', PUMP],
    ['enforcer', 'Enforcer E-12', 2, '12g', { dmg: 1.05, rate: 1.0, mag: 8, pellets: 8, spread: 0.85, reload: 0.9 }, 'pump rail light blk tan', PUMP],
    ['breacher', 'Breacher', 2, '12g', { dmg: 1.0, rate: 1.0, mag: 6, pellets: 9, spread: 1.0, range: 0.9 }, 'pump short choke blk od', PUMP],
    ['hunter', 'Hunter H-20', 1, '12g', { dmg: 0.95, rate: 1.1, mag: 5, pellets: 8, spread: 0.8, range: 1.15 }, 'lever wood slv', LEVER],
    ['peacemaker', 'Peacemaker', 2, '12g', { dmg: 1.05, rate: 1.05, mag: 6, pellets: 8, spread: 0.85, range: 1.1 }, 'lever wood gld', LEVER],
    ['semi12', 'Auto-12', 1, '12g', { dmg: 0.82, rate: 1.45, mag: 8, pellets: 8, spread: 1.1, reload: 1.0 }, 'auto blk poly', AUTO_SHOTGUN],
    ['hurricane', 'Hurricane', 2, '12g', { dmg: 0.85, rate: 1.5, mag: 10, pellets: 8, spread: 1.05, reload: 1.05 }, 'auto rail ext blk tan', AUTO_SHOTGUN],
    ['storm', 'Storm S-12', 3, '12g', { dmg: 0.95, rate: 1.6, mag: 12, pellets: 9, spread: 0.85, reload: 0.9 }, 'auto mlok drum dot comp blk camoD', AUTO_SHOTGUN],
    ['twinbarrel', 'Twin-12', 1, '12g', { dmg: 1.45, rate: 0.9, mag: 2, pellets: 8, spread: 1.05, reload: 0.8, range: 0.95 }, 'break wood blu', BREAK],
    ['sawn', 'Sawn-Off', 1, '12g', { dmg: 1.5, rate: 0.9, mag: 2, pellets: 8, spread: 1.4, reload: 0.75, range: 0.7 }, 'sawn short wood blu', SAWN],
    ['bullshot', 'Bullpup SB', 2, '12g', { dmg: 1.0, rate: 1.4, mag: 10, pellets: 8, spread: 0.9 }, 'bull mlok x2 dot choke blk od', BULLPUP],
    ['judge', 'Judge J-12', 3, '12g', { dmg: 1.15, rate: 1.0, mag: 8, pellets: 10, spread: 0.8, range: 1.1, reload: 0.9 }, 'pump rail light choke ti camoU', PUMP],
  ]),

  // ---------------------------------------------------------------- designated marksman rifles (11 more)
  ...rows('dmr', [
    ['marksman', 'Marksman M-14', 1, '762', { dmg: 1.05, rate: 1.0, mag: 20, rec: 1.1 }, 'wood wood box x4 flash blk wood'],
    ['sparrow', 'Sparrow SP', 1, '556', { dmg: 0.85, rate: 1.25, mag: 20, rec: 0.75, spread: 0.9 }, 'fixed rail curved x4 flash blk poly'],
    ['harrier', 'Harrier', 2, '762', { dmg: 1.1, rate: 1.1, mag: 20, spread: 0.8 }, 'adj mlok box x4 brake bipod blk tan'],
    ['sentry', 'Sentry S-20', 1, '762', { dmg: 1.0, rate: 0.95, mag: 10, rec: 0.95 }, 'thumb vent box x4 plain blk poly'],
    ['osprey', 'Osprey', 2, '762', { dmg: 1.05, rate: 1.0, mag: 15, spread: 0.85, loud: 0.5 }, 'adj mlok box x4 lsupp agrip blk od'],
    ['vulture', 'Vulture V-6', 2, '556', { dmg: 0.95, rate: 1.4, mag: 25, spread: 0.7, rec: 0.8 }, 'fixed mlok ext x3 comp vgrip blk camoD'],
    ['judgement', 'Judgement', 3, '762', { dmg: 1.22, rate: 1.05, mag: 15, spread: 0.6, rec: 0.9, range: 1.1 }, 'skel mlok box x6 brake bipod ti camoU'],
    ['kestrel', 'Kestrel K-98', 2, '762', { dmg: 1.18, rate: 0.9, mag: 10, spread: 0.7, range: 1.1 }, 'bullpup slim box x4 plain blk od', BULLPUP],
    ['archer', 'Archer', 1, '762', { dmg: 1.0, rate: 1.0, mag: 10, spread: 1.0 }, 'wood wood box x3 flash blk dwood'],
    ['paladin', 'Paladin', 3, '762', { dmg: 1.28, rate: 1.0, mag: 20, spread: 0.55, rec: 0.9, range: 1.15 }, 'adj mlok ext x6 brake bipod laser gld camoW'],
    ['eclipse', 'Eclipse E-7', 3, '556', { dmg: 1.0, rate: 1.45, mag: 30, spread: 0.55, rec: 0.7, loud: 0.5 }, 'fold rail ext x4 lsupp vgrip blk camoS'],
  ]),

  // ---------------------------------------------------------------- bolt-action sniper rifles (11 more)
  ...rows('sniper', [
    ['hawkeye', 'Hawkeye', 1, '300', { dmg: 1.0, rate: 1.05, mag: 5, spread: 0.9 }, 'wood inner x6 plain blk wood', BOLT],
    ['lancer', 'Lancer L-96', 2, '300', { dmg: 1.08, rate: 1.1, mag: 5, spread: 0.7, range: 1.05 }, 'adj inner x8 brake bipod blk tan', BOLT],
    ['whisper', 'Whisper', 2, '300', { dmg: 1.0, rate: 1.05, mag: 5, loud: 0.4, spread: 0.7, range: 1.0 }, 'adj inner x8 lsupp bipod gry od', BOLT],
    ['mauser', 'Mauser M-98', 1, '300', { dmg: 0.95, rate: 1.15, mag: 5, range: 0.95 }, 'wood inner x4 plain blk wood', BOLT],
    ['ridgeback', 'Ridgeback', 1, '300', { dmg: 1.04, rate: 1.0, mag: 6, spread: 0.85 }, 'thumb inner x6 brake blk wood', BOLT],
    ['skylark', 'Skylark', 2, '300', { dmg: 1.05, rate: 1.0, mag: 5, spread: 0.65, zoom: 8 }, 'skel inner x8 brake bipod blk camoS', BOLT],
    ['nightjar', 'Nightjar', 3, '300', { dmg: 1.12, rate: 1.1, mag: 5, loud: 0.4, spread: 0.55, zoom: 8 }, 'skel inner x8 lsupp bipod ti camoU', BOLT],
    ['condor', 'Condor C-50', 3, '300', { dmg: 1.2, rate: 1.0, mag: 6, spread: 0.5, range: 1.1, zoom: 8 }, 'adj box x10 brake bipod laser gld camoD', BOLT],
    ['caracal', 'Caracal', 2, '300', { dmg: 1.0, rate: 1.2, mag: 5, spread: 0.8 }, 'bullpup inner x6 plain blk od', BULLPUP],
    ['outlaw', 'Outlaw', 1, '300', { dmg: 1.02, rate: 0.95, mag: 4, range: 1.05, spread: 0.9 }, 'wood inner x4 plain slv dwood', BOLT],
    ['bishop', 'Bishop B-3', 3, '300', { dmg: 1.18, rate: 1.1, mag: 5, spread: 0.55, zoom: 8 }, 'adj box x8 brake bipod crm camoW', BOLT],
  ]),

  // ---------------------------------------------------------------- anti-materiel rifles (5 more)
  ...rows('amr', [
    ['behemoth', 'Behemoth', 1, '50cal', { dmg: 1.05, rate: 1.0, mag: 5 }, 'skel box x8 brake bipod blk od'],
    ['leviathan', 'Leviathan', 2, '50cal', { dmg: 1.12, rate: 1.05, mag: 5, spread: 0.75, zoom: 10 }, 'adj box x10 brake bipod gry tan'],
    ['sunder', 'Sunder SX', 2, '50cal', { dmg: 1.0, rate: 1.15, mag: 6, loud: 0.5, spread: 0.85 }, 'bullpup box x8 supp bipod blk camoU'],
    ['colossus50', 'Titanfall', 3, '50cal', { dmg: 1.2, rate: 1.1, mag: 6, spread: 0.6, zoom: 10, range: 1.1 }, 'skel ext x10 brake bipod laser ti camoD'],
    ['doomsday', 'Doomsday', 3, '50cal', { dmg: 1.3, rate: 1.0, mag: 4, spread: 0.55, zoom: 10, range: 1.12 }, 'adj box x10 brake bipod gld camoW'],
  ]),
];
