/** Who wears what: the palettes and the rules that give every soldier a stable look. Plain data, so it can be tested without a renderer. */
import { skinById } from './skins';

export type Rgb = [number, number, number];
export interface Outfit { camo: boolean; fabric: Rgb; skin: Rgb; hair: Rgb; hat: Rgb; headgear: 'hair' | 'cap' | 'beanie'; pack: 0 | 1 | 2 }

const CAMO_TINTS: Rgb[] = [[0.62, 0.8, 0.48], [1, 0.86, 0.58], [0.7, 0.76, 0.88], [0.55, 0.62, 0.45], [0.85, 0.82, 0.7]];
const PLAIN_TINTS: Rgb[] = [[0.4, 0.5, 0.72], [0.36, 0.38, 0.42], [0.64, 0.72, 0.45], [0.9, 0.78, 0.55], [0.66, 0.68, 0.72], [0.74, 0.46, 0.4]];
const SKIN: Rgb[] = [[1, 0.84, 0.7], [0.92, 0.72, 0.56], [0.78, 0.58, 0.42], [0.58, 0.4, 0.28], [0.4, 0.27, 0.2]];
const HAIR: Rgb[] = [[0.1, 0.08, 0.07], [0.32, 0.2, 0.12], [0.75, 0.6, 0.3], [0.55, 0.22, 0.1], [0.62, 0.62, 0.62]];
const HATS: Rgb[] = [[0.25, 0.3, 0.22], [0.15, 0.15, 0.17], [0.55, 0.45, 0.3], [0.5, 0.2, 0.18], [0.2, 0.28, 0.4]];

function hash(text: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
}

/** A stable look for each soldier: the player is always the teal-and-amber one, bots vary. */
/** Jerseys for the other people in a multiplayer match, so friends are easy to tell from bots. */
const FRIEND_COLORS: Rgb[] = [[0.9, 0.35, 0.3], [0.3, 0.55, 0.95], [0.95, 0.75, 0.2], [0.65, 0.4, 0.9], [0.95, 0.5, 0.75], [0.95, 0.95, 0.95]];

export function outfitFor(id: string, isPlayer: boolean, friend = false, skinId?: string): Outfit {
  const def = skinById(skinId);
  if (def && isPlayer && !friend) return { pack: 0, ...def.outfit };
  if (friend) {
    const index = Number(/\d+/.exec(id)?.[0] ?? 0);
    // Friends keep their jersey colour (easy to tell from bots) but wear the cap, hair and skin they chose.
    if (def) return { camo: false, fabric: FRIEND_COLORS[index % FRIEND_COLORS.length], skin: def.outfit.skin, hair: def.outfit.hair, hat: def.outfit.hat, headgear: def.outfit.headgear, pack: 0 };
    return { camo: false, fabric: FRIEND_COLORS[index % FRIEND_COLORS.length], skin: SKIN[(index + 1) % SKIN.length], hair: HAIR[index % HAIR.length], hat: [0.97, 0.97, 0.97], headgear: 'cap', pack: 1 };
  }
  if (isPlayer) return { camo: false, fabric: [0.36, 0.68, 0.62], skin: SKIN[1], hair: HAIR[1], hat: [0.95, 0.72, 0.3], headgear: 'cap', pack: 0 };
  const r = hash(id);
  const camo = r() < 0.6;
  const pick = <T,>(list: T[]) => list[Math.floor(r() * list.length)];
  const headgearRoll = r();
  return {
    camo, fabric: pick(camo ? CAMO_TINTS : PLAIN_TINTS), skin: pick(SKIN), hair: pick(HAIR), hat: pick(HATS),
    headgear: headgearRoll < 0.45 ? 'hair' : headgearRoll < 0.75 ? 'cap' : 'beanie', pack: Math.floor(r() * 3) as 0 | 1 | 2,
  };
}

