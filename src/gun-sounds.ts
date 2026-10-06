import type { WeaponType } from './types';
import { WEAPONS } from './game/weapons';

export type GunSoundKey = 'pistol' | 'rifle556' | 'rifle762' | 'dmr' | 'sniper' | 'shotgun' | 'lmg' | 'suppressed';
export type GunSoundBank = Partial<Record<GunSoundKey, string>>;

/** Shared recordings by weapon family/calibre; special weapons keep their procedural effects. */
export function gunSoundFor(weapon: WeaponType, suppressed: boolean): { key: GunSoundKey; gain: number; rate: number } | null {
  const config = WEAPONS[weapon];
  if (config.kind === 'bow' || config.kind === 'launcher' || config.kind === 'amr') return null;
  if (suppressed) return { key: 'suppressed', gain: 0.55, rate: 1 };
  switch (config.voice) {
    case 'pistol': return { key: 'pistol', gain: 0.65, rate: 1 };
    case 'smg': return { key: 'pistol', gain: 0.48, rate: 1.06 };
    case 'rifle': return { key: config.ammoType === '762' ? 'rifle762' : 'rifle556', gain: 0.72, rate: 1 };
    case 'dmr': return { key: 'dmr', gain: 0.8, rate: 1 };
    case 'sniper': return { key: 'sniper', gain: 0.9, rate: 1 };
    case 'shotgun': return { key: 'shotgun', gain: 0.85, rate: 1 };
    case 'lmg': return { key: 'lmg', gain: 0.68, rate: 1 };
    default: return null;
  }
}
