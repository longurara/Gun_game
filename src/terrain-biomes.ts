/** Smooth, ordered biome layers shared by every streamed terrain chunk. */
export type TerrainWeights = [number, number, number, number]; // grass, dirt, sand, rock
export interface TerrainSample {
  height: number; seaLevel: number; slope: number; noise: number; forest: number;
  town: number; lakeSand: number; riverWet: number; field?: 0 | 1 | 2;
  /** 0..1: how much of the open ground is bare sand on this map (a desert), 0 on the others. */
  sand?: number;
}
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t); };

export function terrainWeights(sample: TerrainSample): TerrainWeights {
  const weights: TerrainWeights = [1, 0, 0, 0];
  const layer = (channel: number, amount: number) => {
    const t = clamp(amount);
    for (let i = 0; i < 4; i++) weights[i] = weights[i] * (1 - t) + (i === channel ? t : 0);
  };
  // Forest litter and bare patches gradually replace meadow turf.
  layer(1, smooth((sample.forest - 0.5) * 4) * 0.7);
  layer(1, clamp((sample.noise - 0.66) * 3) * 0.6);
  layer(3, smooth((sample.slope - 0.34) / 0.26));
  layer(3, smooth((sample.height - 100) / 40) * 0.8);
  // A desert's open ground is sand; forest litter and rock still show through.
  if (sample.sand) layer(2, sample.sand * (1 - smooth((sample.slope - 0.34) / 0.26)));
  // Settlements have packed earth; coast/lake shores and wet banks take priority.
  layer(1, sample.town * 0.85);
  layer(2, smooth((sample.seaLevel + 3.8 - sample.height) / 2.4) * 0.95);
  layer(2, sample.lakeSand);
  layer(1, sample.riverWet);
  if (sample.field !== undefined) layer(sample.field === 1 ? 0 : 1, 0.92);
  return weights;
}
