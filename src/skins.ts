/**
 * Outfits for the player's soldier. Each is free or earned with wins and kills (taken from this browser's record or the
 * signed-in account, whichever is higher). Only the look changes; nothing here affects play.
 */
import type { Outfit } from './outfits';

export interface PlayerStats { wins: number; kills: number }
export type Unlock = { kind: 'free' } | { kind: 'kills'; n: number } | { kind: 'wins'; n: number };
export interface SkinDef {
  id: string; name: string; blurb: string; unlock: Unlock;
  /** Swatch colours for the picker: the uniform and the cap. */
  swatch: [string, string];
  outfit: Omit<Outfit, 'pack'> & { pack?: Outfit['pack'] };
}

export const SKINS: readonly SkinDef[] = [
  { id: 'default', name: 'Sinh tồn', blurb: 'Bộ đồ xanh ngọc quen thuộc.', unlock: { kind: 'free' }, swatch: ['#5cae9e', '#f2b84d'],
    outfit: { camo: false, fabric: [0.36, 0.68, 0.62], skin: [0.92, 0.72, 0.56], hair: [0.32, 0.2, 0.12], hat: [0.95, 0.72, 0.3], headgear: 'cap' } },
  { id: 'jungle', name: 'Rừng xanh', blurb: 'Rằn ri rừng nhiệt đới. Mở khóa khi hạ gục 1 đối thủ.', unlock: { kind: 'kills', n: 1 }, swatch: ['#7a9a52', '#3d4a2e'],
    outfit: { camo: true, fabric: [0.62, 0.8, 0.48], skin: [0.92, 0.72, 0.56], hair: [0.1, 0.08, 0.07], hat: [0.25, 0.3, 0.22], headgear: 'beanie' } },
  { id: 'desert', name: 'Sa mạc', blurb: 'Rằn ri cát. Mở khóa khi hạ gục 10 đối thủ.', unlock: { kind: 'kills', n: 10 }, swatch: ['#d6b878', '#8a6f43'],
    outfit: { camo: true, fabric: [1, 0.86, 0.58], skin: [0.78, 0.58, 0.42], hair: [0.32, 0.2, 0.12], hat: [0.55, 0.45, 0.3], headgear: 'cap' } },
  { id: 'arctic', name: 'Băng giá', blurb: 'Rằn ri tuyết. Mở khóa khi thắng 1 trận.', unlock: { kind: 'wins', n: 1 }, swatch: ['#dfe9ef', '#7d93a8'],
    outfit: { camo: true, fabric: [0.85, 0.9, 0.95], skin: [1, 0.84, 0.7], hair: [0.62, 0.62, 0.62], hat: [0.9, 0.93, 0.96], headgear: 'beanie' } },
  { id: 'midnight', name: 'Nửa đêm', blurb: 'Đen tuyền, khó thấy. Mở khóa khi hạ gục 30 đối thủ.', unlock: { kind: 'kills', n: 30 }, swatch: ['#2a2d33', '#8f98a6'],
    outfit: { camo: false, fabric: [0.16, 0.17, 0.2], skin: [0.58, 0.4, 0.28], hair: [0.1, 0.08, 0.07], hat: [0.12, 0.12, 0.14], headgear: 'cap' } },
  { id: 'crimson', name: 'Đỏ thẫm', blurb: 'Nổi bật giữa chiến trường. Mở khóa khi thắng 3 trận.', unlock: { kind: 'wins', n: 3 }, swatch: ['#b9473d', '#f3e2d2'],
    outfit: { camo: false, fabric: [0.74, 0.28, 0.24], skin: [0.92, 0.72, 0.56], hair: [0.1, 0.08, 0.07], hat: [0.95, 0.9, 0.85], headgear: 'cap' } },
  { id: 'ghost', name: 'Bóng ma', blurb: 'Xám xanh lặng lẽ. Mở khóa khi hạ gục 60 đối thủ.', unlock: { kind: 'kills', n: 60 }, swatch: ['#8d98a6', '#3a4350'],
    outfit: { camo: true, fabric: [0.7, 0.76, 0.88], skin: [0.4, 0.27, 0.2], hair: [0.1, 0.08, 0.07], hat: [0.2, 0.28, 0.4], headgear: 'beanie' } },
  { id: 'gold', name: 'Vàng kim', blurb: 'Dành cho nhà vô địch. Mở khóa khi thắng 10 trận.', unlock: { kind: 'wins', n: 10 }, swatch: ['#e8b93a', '#fff3c6'],
    outfit: { camo: false, fabric: [0.92, 0.72, 0.22], skin: [0.92, 0.72, 0.56], hair: [0.75, 0.6, 0.3], hat: [1, 0.95, 0.75], headgear: 'cap' } },
];


export const DEFAULT_SKIN = 'default';
export const skinById = (id: unknown): SkinDef | undefined => typeof id === 'string' ? SKINS.find(skin => skin.id === id) : undefined;

export function isUnlocked(skin: SkinDef, stats: PlayerStats): boolean {
  const need = skin.unlock;
  return need.kind === 'free' || (need.kind === 'kills' ? stats.kills >= need.n : stats.wins >= need.n);
}

/** What is left to do to earn it, for the locked card. */
export function lockText(skin: SkinDef, stats: PlayerStats): string {
  const need = skin.unlock;
  if (need.kind === 'free') return '';
  return need.kind === 'kills' ? `Hạ gục ${Math.min(stats.kills, need.n)} / ${need.n}` : `Thắng ${Math.min(stats.wins, need.n)} / ${need.n} trận`;
}

/** A skin id that is known and earned, otherwise the default (a saved choice may outlive its record, or come from outside). */
export function usableSkin(id: unknown, stats: PlayerStats): string {
  const skin = skinById(id);
  return skin && isUnlocked(skin, stats) ? skin.id : DEFAULT_SKIN;
}
