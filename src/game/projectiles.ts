import type { Projectile } from '../types';

export const GRENADE_GRAVITY = 16;

/** Host physics and client projection must use the same acceleration for each projectile class. */
export function projectileGravity(kind: Projectile['kind']): number {
  return GRENADE_GRAVITY * (kind === 'rocket' ? .06 : kind === 'shell' ? .3 : 1);
}
