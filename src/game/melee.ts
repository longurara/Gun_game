/** Close-combat weapons: one can be carried; with none, a punch will do. Swung with X. */
export type MeleeKind = 'pan' | 'machete' | 'crowbar' | 'sickle';
export interface MeleeConfig { label: string; damage: number; /** Reach in metres. */ range: number; /** Seconds between swings. */ interval: number }
export const MELEE: Record<MeleeKind, MeleeConfig> = {
  pan: { label: 'Chảo', damage: 38, range: 2.2, interval: 0.85 },
  machete: { label: 'Dao rựa', damage: 55, range: 2.4, interval: 0.7 },
  crowbar: { label: 'Xà beng', damage: 46, range: 2.4, interval: 0.75 },
  sickle: { label: 'Liềm', damage: 42, range: 2.3, interval: 0.55 },
};
export const FISTS: MeleeConfig = { label: 'Nắm đấm', damage: 14, range: 1.8, interval: 0.5 };
export const MELEE_ORDER: MeleeKind[] = ['pan', 'machete', 'crowbar', 'sickle'];
export const isMeleeKind = (value: unknown): value is MeleeKind => typeof value === 'string' && Object.hasOwn(MELEE, value);
