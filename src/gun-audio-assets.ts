import type { GunSoundBank } from './gun-sounds';
import pistol from './assets/audio/guns/pistol.ogg';
import rifle556 from './assets/audio/guns/rifle-556.ogg';
import rifle762 from './assets/audio/guns/rifle-762.ogg';
import dmr from './assets/audio/guns/dmr.ogg';
import sniper from './assets/audio/guns/sniper.ogg';
import shotgun from './assets/audio/guns/shotgun.ogg';
import lmg from './assets/audio/guns/lmg.ogg';
import suppressed from './assets/audio/guns/suppressed.ogg';

/** Vite fingerprints local samples; gameplay and Node tests receive plain URLs. */
export const GUN_SOUND_ASSETS: GunSoundBank = { pistol, rifle556, rifle762, dmr, sniper, shotgun, lmg, suppressed };
