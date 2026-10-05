/**
 * Procedural, seamlessly tiling surface textures painted into plain byte arrays (no canvas, so they can be tested in
 * Node). Each kind yields an albedo map and a matching tangent-space normal map derived from the same height field.
 * They are deliberately close to neutral grey so vertex colours can tint one texture into many finishes.
 */
export type SurfaceKind = 'metal' | 'poly' | 'wood' | 'camoW' | 'camoD' | 'camoU' | 'camoS' | 'camoMono' | 'weave';
export interface Surface { size: number; albedo: Uint8ClampedArray; normal: Uint8ClampedArray }

function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Value noise on an integer lattice that wraps every `px` × `py` cells, so the result tiles. */
export function tileNoise(x: number, y: number, px: number, py: number, seed = 0): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = smooth(x - ix), fy = smooth(y - iy);
  const wx = (n: number) => ((n % px) + px) % px, wy = (n: number) => ((n % py) + py) % py;
  const a = hash(wx(ix), wy(iy), seed), b = hash(wx(ix + 1), wy(iy), seed), c = hash(wx(ix), wy(iy + 1), seed), d = hash(wx(ix + 1), wy(iy + 1), seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Tiling fractal noise with `octaves` doublings of frequency. */
function fbm(u: number, v: number, base: number, octaves: number, seed: number): number {
  let sum = 0, amp = 0.5, norm = 0, f = base;
  for (let i = 0; i < octaves; i++) { sum += amp * tileNoise(u * f, v * f, f, f, seed + i * 17); norm += amp; amp *= 0.5; f *= 2; }
  return sum / norm;
}

const CAMO: Record<string, string[]> = {
  camoW: ['#5d6e3e', '#3f4e2b', '#7b6b45', '#222d1d'],
  camoD: ['#c9ac78', '#a68752', '#8a6f45', '#e2d2a6'],
  camoU: ['#8f959c', '#6c727a', '#4a4f56', '#b9bec4'],
  camoS: ['#f0f4f6', '#cbd5db', '#a2b3bd', '#e1e9ed'],
  camoMono: ['#a8a8a8', '#d4d4d4', '#6a6a6a', '#3e3e3e'],
};
const rgb = (hex: string): [number, number, number] => { const v = parseInt(hex.slice(1), 16); return [v >> 16 & 255, v >> 8 & 255, v & 255]; };

/** Draw wrapped line segments into a height layer (scratches). */
function scratches(size: number, count: number, seed: number): Float32Array {
  const layer = new Float32Array(size * size);
  for (let i = 0; i < count; i++) {
    let x = hash(i, 1, seed) * size, y = hash(i, 2, seed) * size;
    const angle = (hash(i, 3, seed) - 0.5) * 0.5 + (hash(i, 4, seed) < 0.3 ? 1.2 : 0), len = 12 + hash(i, 5, seed) * 70, strength = 0.35 + hash(i, 6, seed) * 0.5;
    for (let t = 0; t < len; t++) {
      const px = Math.floor(x) & (size - 1), py = Math.floor(y) & (size - 1);
      layer[py * size + px] = Math.max(layer[py * size + px], strength * (1 - t / len));
      x += Math.cos(angle); y += Math.sin(angle);
    }
  }
  return layer;
}

export function paintSurface(kind: SurfaceKind, size = 256): Surface {
  const albedo = new Uint8ClampedArray(size * size * 4), normal = new Uint8ClampedArray(size * size * 4);
  const height = new Float32Array(size * size);
  const shade = new Float32Array(size * size * 3);
  const palette = CAMO[kind]?.map(rgb);
  const scratch = kind === 'metal' ? scratches(size, Math.round(size / 18), 3) : null;
  // Pebble cells for polymer grip texture.
  const cells = 64;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, o = y * size + x;
    let h = 0.5, r = 0.8, g = 0.8, b = 0.8;
    switch (kind) {
      case 'metal': {
        // Brushed metal: long streaks along u, fine speckle, hairline scratches.
        const streak = tileNoise(u * 3, v * Math.round(size * 0.7), 3, Math.round(size * 0.7), 5);
        const fine = tileNoise(u * 96, v * 96, 96, 96, 9);
        h = 0.55 * streak + 0.3 * fine + 0.15 * fbm(u, v, 6, 2, 11);
        const s = scratch![o];
        r = g = b = Math.min(1, 0.7 + 0.26 * h + 0.3 * s);
        h = h + s * 0.4;
        break;
      }
      case 'poly': {
        // Pebble grain: distance to the nearest jittered point in a wrapped grid.
        const gx = u * cells, gy = v * cells, cx = Math.floor(gx), cy = Math.floor(gy);
        let best = 9;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx, ny = cy + dy, wx = ((nx % cells) + cells) % cells, wy = ((ny % cells) + cells) % cells;
          const px = nx + hash(wx, wy, 21), py = ny + hash(wx, wy, 22);
          best = Math.min(best, Math.hypot(gx - px, gy - py));
        }
        h = 1 - smooth(Math.min(1, best / 0.75));
        r = g = b = 0.8 + 0.2 * (1 - h * 0.7) - 0.06 * fbm(u, v, 4, 2, 31);
        break;
      }
      case 'wood': {
        // Straight grain along u with warped growth rings and fibres.
        const warp = fbm(u, v, 2, 3, 41) * 2.4;
        const ring = 0.5 + 0.5 * Math.sin((v * 16 + warp) * Math.PI * 2);
        const fibre = tileNoise(u * 5, v * Math.round(size * 0.9), 5, Math.round(size * 0.9), 43);
        const knot = tileNoise(u * 2, v * 6, 2, 6, 47);
        h = 0.35 * ring + 0.45 * fibre + 0.2 * knot;
        const tone = 0.52 + 0.48 * (0.55 * ring + 0.35 * fibre + 0.1 * knot);
        r = tone; g = tone * 0.97; b = tone * 0.94;
        break;
      }
      case 'weave': {
        const n = 56, wx = Math.sin(u * n * Math.PI * 2), wy = Math.sin(v * n * Math.PI * 2);
        const over = (Math.floor(u * n) + Math.floor(v * n)) % 2 === 0;
        h = 0.5 + 0.28 * (over ? wx : wy) * 0.9 + 0.12 * fbm(u, v, 8, 2, 51);
        r = g = b = 0.72 + 0.28 * h;
        break;
      }
      default: {
        // Camouflage: three overlapping blotch layers over a base colour, plus a fine fabric grain.
        const p = palette!;
        const warpU = u + (fbm(u, v, 3, 2, 61) - 0.5) * 0.08;
        const n1 = fbm(warpU, v, 4, 3, 63), n2 = fbm(u, v, 6, 3, 67), n3 = fbm(u, v, 11, 2, 71);
        let c = p[0];
        if (n1 > 0.52) c = p[1];
        if (n2 > 0.58 && n1 < 0.52) c = p[2];
        if (n3 > 0.66) c = p[3];
        const grain = 0.93 + 0.14 * tileNoise(u * 120, v * 120, 120, 120, 73);
        r = c[0] / 255 * grain; g = c[1] / 255 * grain; b = c[2] / 255 * grain;
        h = 0.5 + 0.2 * tileNoise(u * 120, v * 120, 120, 120, 73) + (c === p[0] ? 0 : 0.05);
      }
    }
    height[o] = h;
    shade[o * 3] = r; shade[o * 3 + 1] = g; shade[o * 3 + 2] = b;
  }
  const strength = kind === 'poly' ? 2.0 : kind === 'metal' ? 1.4 : kind === 'wood' ? 1.6 : kind === 'weave' ? 3 : 1.8;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const o = y * size + x, l = height[y * size + ((x + size - 1) & (size - 1))], rgt = height[y * size + ((x + 1) & (size - 1))];
    const up = height[((y + size - 1) & (size - 1)) * size + x], dn = height[((y + 1) & (size - 1)) * size + x];
    let nx = (l - rgt) * strength, ny = (up - dn) * strength, nz = 1;
    const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
    normal[o * 4] = (nx * 0.5 + 0.5) * 255; normal[o * 4 + 1] = (ny * 0.5 + 0.5) * 255; normal[o * 4 + 2] = (nz * 0.5 + 0.5) * 255; normal[o * 4 + 3] = 255;
    albedo[o * 4] = shade[o * 3] * 255; albedo[o * 4 + 1] = shade[o * 3 + 1] * 255; albedo[o * 4 + 2] = shade[o * 3 + 2] * 255; albedo[o * 4 + 3] = 255;
  }
  return { size, albedo, normal };
}
