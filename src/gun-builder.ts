import type { WeaponClass } from './types';
import { Bag, hexColor, mixColor, rect, scaleColor, Shaper } from './geometry';
import type { RGB, V3 } from './geometry';

/**
 * Procedural gun modelling. A gun's `look` (see src/game/arsenal.ts) is a short list of part tokens; this file turns
 * it into geometry: every class has a body plan, and the tokens pick the stock, handguard, magazine, optic, muzzle
 * device, extras and finish. Different token mixes give visibly different silhouettes without any hand modelling.
 *
 * Grammar. Pistols and shotguns: first token is the frame. Sniper rifles: stock, magazine. Every other rifle class:
 * stock, handguard, magazine. All remaining tokens are order-free: optic, muzzle, extras, barrel tweaks, a metal
 * finish and a furniture finish.
 */
export type Finish = 'metal' | 'poly' | 'wood' | 'camoW' | 'camoD' | 'camoU' | 'camoS' | 'glass' | 'glow';

const FRAMES: Record<string, readonly string[]> = {
  pistol: ['std', 'compact', 'long', 'revolver', 'machine', 'hand'],
  shotgun: ['pump', 'auto', 'break', 'sawn', 'bull', 'lever'],
};
const STOCKS = ['fixed', 'fold', 'skel', 'wood', 'none', 'bullpup', 'thumb', 'adj', 'short'] as const;
const GUARDS = ['rail', 'slim', 'chunky', 'wood', 'quad', 'mlok', 'vent', 'short', 'none'] as const;
const MAGS = ['straight', 'curved', 'banana', 'box', 'ext', 'dual', 'drum', 'belt', 'stick', 'inner', 'none'] as const;
const OPTICS = ['irons', 'dot', 'holo', 'acog', 'x2', 'x3', 'x4', 'x6', 'x8', 'x10', 'thermal'] as const;
const MUZZLES = ['plain', 'flash', 'brake', 'supp', 'lsupp', 'comp', 'choke'] as const;
const EXTRAS = ['vgrip', 'agrip', 'laser', 'light', 'bipod', 'carry', 'rail', 'mlok'] as const;
const TWEAKS = ['short', 'long', 'ext', 'drum'] as const;
const METALS: Record<string, string> = { blk: '#6e7981', gry: '#98a4ac', slv: '#c8ced2', gld: '#ecc04a', blu: '#3d5472', ti: '#9aaab6', crm: '#e4eaed' };
const FURNITURE: Record<string, { finish: Finish; color: string }> = {
  poly: { finish: 'poly', color: '#686f74' }, tan: { finish: 'poly', color: '#bca377' }, od: { finish: 'poly', color: '#79885b' },
  red: { finish: 'poly', color: '#a83c34' }, wht: { finish: 'poly', color: '#e8ecee' },
  wood: { finish: 'wood', color: '#d49d62' }, dwood: { finish: 'wood', color: '#92603a' },
  camoW: { finish: 'camoW', color: '#ffffff' }, camoD: { finish: 'camoD', color: '#ffffff' }, camoU: { finish: 'camoU', color: '#ffffff' }, camoS: { finish: 'camoS', color: '#ffffff' },
};
const ACCENT = ['#8fa3ad', '#8fa3ad', '#4f9bd9', '#e8b23c'];

export interface Look {
  frame: string; stock: string; guard: string; mag: string; optic: string; muzzle: string;
  extras: Set<string>; tweaks: Set<string>; metal: string; furniture: string;
}

function pick<T extends string>(list: readonly T[], token: string | undefined): T | undefined { return token && (list as readonly string[]).includes(token) ? token as T : undefined; }

export function parseLook(cls: WeaponClass, text: string): Look {
  const tokens = text.split(/\s+/).filter(Boolean);
  const look: Look = { frame: '', stock: 'fixed', guard: 'rail', mag: 'curved', optic: 'irons', muzzle: 'plain', extras: new Set(), tweaks: new Set(), metal: 'blk', furniture: 'poly' };
  const bolt = cls === 'sniper' || cls === 'amr' || cls === 'bow' || cls === 'launcher';
  let positional: Array<'frame' | 'stock' | 'guard' | 'mag'> = [];
  if (cls === 'pistol' || cls === 'shotgun') positional = ['frame'];
  else if (bolt) positional = ['stock', 'mag'];
  else positional = ['stock', 'guard', 'mag'];
  const frames = FRAMES[cls] ?? [];
  const unknown: string[] = [];
  let metalSet = false, furnitureSet = false;
  tokens.forEach((token, index) => {
    if (index < positional.length) {
      const slot = positional[index];
      const ok = slot === 'frame' ? frames.includes(token) : slot === 'stock' ? !!pick(STOCKS, token) : slot === 'guard' ? !!pick(GUARDS, token) : !!pick(MAGS, token);
      if (!ok) unknown.push(`${slot}:${token}`); else look[slot] = token;
      return;
    }
    if (pick(OPTICS, token)) look.optic = token;
    else if (pick(MUZZLES, token)) look.muzzle = token;
    else if (pick(EXTRAS, token)) look.extras.add(token);
    else if (pick(TWEAKS, token)) look.tweaks.add(token);
    else if (METALS[token]) { if (!metalSet) { look.metal = token; metalSet = true; } }
    else if (FURNITURE[token]) { if (!furnitureSet) { look.furniture = token; furnitureSet = true; } }
    else unknown.push(token);
  });
  if (unknown.length) throw new Error(`unknown look token(s) ${unknown.join(', ')} in "${text}"`);
  return look;
}

export interface GunGeometry {
  bag: Bag; /** Where the muzzle flash appears. */ muzzle: V3;
  /** Where the firing hand and the supporting hand hold the gun. */ grip: V3; fore: V3; length: number;
}

interface Kit {
  s: Shaper; look: Look; tier: number;
  metal: RGB; steel: RGB; dark: RGB; accent: RGB; furnFinish: Finish; furnColor: RGB;
}

const lighten = (c: RGB, k: number): RGB => mixColor(c, [1, 1, 1], k);

function makeKit(look: Look, tier: number): Kit {
  const bag = new Bag();
  const s = new Shaper(bag, 2.2);
  const metal = hexColor(METALS[look.metal]);
  const furniture = FURNITURE[look.furniture];
  return {
    s, look, tier, metal, steel: lighten(metal, 0.3), dark: scaleColor(metal, 0.45),
    accent: hexColor(ACCENT[tier]), furnFinish: furniture.finish, furnColor: hexColor(furniture.color),
  };
}

// Finish switches ------------------------------------------------------------------------------------------------
const M = (k: Kit) => k.s.use('metal', k.metal);
const Ms = (k: Kit) => k.s.use('metal', k.steel);
const Md = (k: Kit) => k.s.use('metal', k.dark);
const F = (k: Kit, shade = 1) => k.s.use(k.furnFinish, scaleColor(k.furnColor, shade));
const Rubber = (k: Kit) => k.s.use('poly', [0.12, 0.12, 0.13]);
const A = (k: Kit) => k.s.use('poly', k.accent);
const Glass = (k: Kit) => k.s.use('glass', [0.55, 0.85, 0.88]);
const Glow = (k: Kit, color: RGB = [1, 0.15, 0.1]) => k.s.use('glow', color);

// Shared parts ---------------------------------------------------------------------------------------------------
/** Pistol grip with an open trigger guard; `z` is the grip's centre at the receiver. */
function pistolGrip(k: Kit, z: number, height = 0.2, topY = -0.07): void {
  F(k).box(0.062, height, 0.09, { at: [0, topY - height / 2 - 0.01, z - height * 0.12], rot: [-0.32, 0, 0] });
  Rubber(k).box(0.066, height * 0.5, 0.094, { at: [0, topY - height * 0.72, z - height * 0.2], rot: [-0.32, 0, 0] });
  M(k).box(0.018, 0.085, 0.018, { at: [0, topY - 0.03, z + 0.115] });
  M(k).box(0.018, 0.018, 0.12, { at: [0, topY - 0.07, z + 0.06] });
  Md(k).box(0.014, 0.04, 0.014, { at: [0, topY - 0.035, z + 0.065], rot: [0.25, 0, 0] });
}

function stock(k: Kit, type: string, zRear: number, width = 0.1): void {
  const hw = width / 2;
  switch (type) {
    case 'fixed':
      F(k).loft(zRear - 0.30, zRear, rect(hw * 0.95, 0.085, 0, -0.045), rect(hw * 0.9, 0.065, 0, -0.01));
      Rubber(k).box(width * 1.02, 0.18, 0.034, { at: [0, -0.045, zRear - 0.315] });
      M(k).box(0.03, 0.03, 0.05, { at: [0, 0.045, zRear - 0.02] });
      break;
    case 'fold':
      Ms(k).box(0.03, 0.026, 0.28, { at: [0, 0.012, zRear - 0.14] });
      Ms(k).box(0.03, 0.026, 0.26, { at: [0, -0.085, zRear - 0.13] });
      Ms(k).box(0.03, 0.12, 0.03, { at: [0, -0.037, zRear - 0.265] });
      Rubber(k).box(width, 0.15, 0.036, { at: [0, -0.037, zRear - 0.30] });
      M(k).box(0.05, 0.07, 0.04, { at: [0, -0.037, zRear - 0.01] });
      break;
    case 'skel':
      F(k).loft(zRear - 0.3, zRear, rect(0.026, 0.024, 0, 0.03), rect(0.03, 0.03, 0, 0.03));
      F(k).loft(zRear - 0.3, zRear, rect(0.026, 0.024, 0, -0.14), rect(0.03, 0.03, 0, -0.045));
      F(k).box(width * 0.9, 0.2, 0.04, { at: [0, -0.055, zRear - 0.31] });
      A(k).box(width * 0.92, 0.02, 0.042, { at: [0, 0.052, zRear - 0.31] });
      break;
    case 'wood':
      F(k).loft(zRear - 0.4, zRear, rect(hw * 1.05, 0.09, 0, -0.075), rect(hw * 0.9, 0.07, 0, -0.01));
      Rubber(k).box(width * 1.1, 0.2, 0.034, { at: [0, -0.075, zRear - 0.415] });
      break;
    case 'thumb':
      F(k).loft(zRear - 0.38, zRear - 0.1, rect(hw, 0.028, 0, 0.04), rect(hw * 0.92, 0.03, 0, 0.034));
      F(k).loft(zRear - 0.38, zRear - 0.02, rect(hw, 0.03, 0, -0.13), rect(hw * 0.9, 0.03, 0, -0.065));
      F(k).box(width, 0.22, 0.05, { at: [0, -0.045, zRear - 0.36] });
      F(k).box(width * 0.9, 0.16, 0.05, { at: [0, -0.03, zRear - 0.08], rot: [-0.3, 0, 0] });
      Rubber(k).box(width * 1.05, 0.22, 0.03, { at: [0, -0.045, zRear - 0.385] });
      break;
    case 'adj':
      Md(k).cyl(0.021, 0.021, 0.2, 'z', { at: [0, -0.02, zRear - 0.09] }, 8);
      F(k).loft(zRear - 0.3, zRear - 0.04, rect(hw * 0.9, 0.055, 0, -0.01), rect(hw * 0.8, 0.045, 0, -0.02));
      F(k).loft(zRear - 0.28, zRear - 0.1, rect(hw * 0.7, 0.05, 0, 0.05), rect(hw * 0.7, 0.04, 0, 0.045));
      Rubber(k).box(width, 0.19, 0.036, { at: [0, -0.04, zRear - 0.31] });
      Ms(k).box(0.03, 0.05, 0.1, { at: [0, -0.1, zRear - 0.16] });
      break;
    case 'short':
      F(k).loft(zRear - 0.14, zRear, rect(hw * 0.8, 0.06, 0, -0.03), rect(hw * 0.8, 0.055, 0, -0.01));
      Rubber(k).box(width * 0.9, 0.13, 0.03, { at: [0, -0.03, zRear - 0.155] });
      break;
    default: // none
      Rubber(k).box(0.06, 0.09, 0.03, { at: [0, -0.01, zRear - 0.015] });
  }
}

function magazine(k: Kit, type: string, z: number, topY: number, w = 0.065, d = 0.1): void {
  const curve = (len: number, bend: number, segments: number, depth = d, width = w) => {
    const segLen = len / segments;
    let y = topY, zz = z, theta = 0;
    for (let i = 0; i < segments; i++) {
      const cy = y - Math.cos(theta) * segLen / 2, cz = zz + Math.sin(theta) * segLen / 2;
      Ms(k).box(width, segLen * 1.06, depth, { at: [0, cy, cz], rot: [-theta, 0, 0] });
      y -= Math.cos(theta) * segLen; zz += Math.sin(theta) * segLen; theta += bend;
    }
    return { y, z: zz };
  };
  switch (type) {
    case 'straight': { Ms(k).box(w, 0.22, d, { at: [0, topY - 0.11, z] }); Md(k).box(w * 1.06, 0.02, d * 1.06, { at: [0, topY - 0.225, z] }); break; }
    case 'curved': { const end = curve(0.3, 0.1, 4); Md(k).box(w * 1.06, 0.02, d * 1.06, { at: [0, end.y - 0.005, end.z], rot: [-0.4, 0, 0] }); break; }
    case 'banana': { const end = curve(0.36, 0.17, 6, d * 1.05); Md(k).box(w * 1.06, 0.02, d * 1.1, { at: [0, end.y - 0.005, end.z], rot: [-0.85, 0, 0] }); break; }
    case 'box': Ms(k).box(0.115, 0.19, 0.15, { at: [0, topY - 0.095, z] }); Md(k).box(0.12, 0.022, 0.155, { at: [0, topY - 0.2, z] }); A(k).box(0.118, 0.02, 0.05, { at: [0, topY - 0.06, z + 0.02] }); break;
    case 'ext': Ms(k).box(w, 0.36, d, { at: [0, topY - 0.18, z] }); Md(k).box(w * 1.08, 0.025, d * 1.08, { at: [0, topY - 0.37, z] }); A(k).box(w * 1.04, 0.02, d * 1.04, { at: [0, topY - 0.1, z] }); break;
    case 'dual': {
      curve(0.28, 0.09, 4);
      const saved = z;
      z = saved + d * 1.05;
      curve(0.28, 0.09, 4);
      A(k).box(w * 1.1, 0.03, d * 2.3, { at: [0, topY - 0.1, saved + d * 0.52] });
      break;
    }
    case 'drum':
      Md(k).box(0.06, 0.06, 0.1, { at: [0, topY - 0.03, z] });
      F(k, 0.9).cyl(0.17, 0.17, 0.15, 'x', { at: [0, topY - 0.19, z + 0.02] }, 14);
      Ms(k).cyl(0.14, 0.14, 0.176, 'x', { at: [0, topY - 0.19, z + 0.02] }, 14);
      A(k).cyl(0.045, 0.045, 0.19, 'x', { at: [0, topY - 0.19, z + 0.02] }, 8);
      break;
    case 'belt':
      Ms(k).box(0.15, 0.17, 0.19, { at: [0, topY - 0.085, z + 0.03] });
      Md(k).box(0.156, 0.02, 0.196, { at: [0, topY - 0.175, z + 0.03] });
      A(k).box(0.152, 0.03, 0.06, { at: [0, topY - 0.06, z + 0.03] });
      for (let i = 0; i < 4; i++) M(k).box(0.03, 0.026, 0.026, { at: [-0.09 - i * 0.012, topY - 0.02 - i * 0.04, z + 0.05 - i * 0.014] });
      break;
    case 'stick': Ms(k).box(0.055, 0.32, 0.075, { at: [0, topY - 0.16, z] }); Md(k).box(0.06, 0.02, 0.08, { at: [0, topY - 0.325, z] }); break;
    case 'inner': Md(k).box(0.09, 0.045, 0.16, { at: [0, topY - 0.022, z + 0.02] }); break;
    default: break;
  }
}

function guardPart(k: Kit, type: string, z0: number, z1: number, width: number, height: number): void {
  const len = z1 - z0, mid = (z0 + z1) / 2, hw = width / 2, hh = height / 2;
  switch (type) {
    case 'slim': F(k).box(width * 0.8, height * 0.8, len, { at: [0, 0, mid] }); break;
    case 'rail':
      F(k).box(width, height, len, { at: [0, 0, mid] });
      M(k).box(0.04, 0.012, len, { at: [0, hh + 0.006, mid] });
      for (let z = z0 + 0.02; z < z1 - 0.01; z += 0.034) M(k).box(0.046, 0.01, 0.014, { at: [0, hh + 0.012, z] });
      break;
    case 'chunky':
      F(k).loft(z0, z1, rect(hw * 1.15, hh * 1.1), rect(hw, hh));
      Md(k).box(width * 0.4, 0.014, len * 0.8, { at: [0, hh * 1.1 + 0.007, mid] });
      break;
    case 'wood':
      F(k).loft(z0, z1, rect(hw * 0.95, hh * 0.85, 0, -0.01), rect(hw * 0.8, hh * 0.78, 0, -0.01));
      Ms(k).box(width * 0.8, 0.012, len * 0.85, { at: [0, hh * 0.85, mid] });
      break;
    case 'quad':
      Ms(k).box(width * 0.9, height * 0.9, len, { at: [0, 0, mid] });
      for (const [x, y, w, h] of [[0, hh + 0.007, 0.04, 0.014], [0, -hh - 0.007, 0.04, 0.014], [hw * 0.95 + 0.007, 0, 0.014, 0.04], [-hw * 0.95 - 0.007, 0, 0.014, 0.04]] as const) {
        for (let z = z0 + 0.025; z < z1 - 0.01; z += 0.04) M(k).box(w, h, 0.018, { at: [x, y, z] });
      }
      break;
    case 'mlok':
      Ms(k).loft(z0, z1, rect(hw * 0.95, hh * 0.95), rect(hw * 0.85, hh * 0.85));
      M(k).box(0.04, 0.012, len, { at: [0, hh * 0.95 + 0.006, mid] });
      for (const side of [-1, 1]) for (let z = z0 + 0.03; z < z1 - 0.025; z += 0.05) Md(k).box(0.006, 0.014, 0.034, { at: [side * (hw * 0.9 + 0.002), -0.005, z] });
      break;
    case 'vent':
      F(k).cyl(hh * 1.05, hh * 0.95, len, 'z', { at: [0, 0, mid] }, 12);
      for (let i = 0; i < 5; i++) for (const a of [0.9, -0.9, 2.2, -2.2, 1.57, -1.57]) {
        Md(k).box(0.016, 0.016, len * 0.08, { at: [Math.sin(a) * hh * 1.0, Math.cos(a) * hh * 1.0, z0 + len * (0.14 + i * 0.17)], rot: [0, 0, -a] });
      }
      break;
    case 'short': F(k).box(width * 0.85, height * 0.85, len * 0.7, { at: [0, 0, z0 + len * 0.35] }); break;
    default: break;
  }
}

function muzzleDevice(k: Kit, type: string, z: number, y: number, r = 0.026): number {
  switch (type) {
    case 'flash':
      Ms(k).cyl(r * 1.25, r * 1.2, 0.07, 'z', { at: [0, y, z + 0.035] }, 8);
      for (const a of [0, 2.1, 4.2]) Md(k).box(0.012, 0.012, 0.045, { at: [Math.sin(a) * r * 1.2, y + Math.cos(a) * r * 1.2, z + 0.045] });
      return z + 0.07;
    case 'brake':
      Ms(k).box(r * 2.6, r * 2.2, 0.1, { at: [0, y, z + 0.05] });
      for (let i = 0; i < 3; i++) for (const side of [-1, 1]) Md(k).box(0.01, r * 1.7, 0.016, { at: [side * r * 1.32, y, z + 0.03 + i * 0.026] });
      return z + 0.1;
    case 'comp':
      Ms(k).cyl(r * 1.4, r * 1.4, 0.07, 'z', { at: [0, y, z + 0.035] }, 8);
      for (const side of [-1, 1]) for (let i = 0; i < 2; i++) Md(k).box(0.008, r * 1.5, 0.014, { at: [side * r * 1.42, y, z + 0.025 + i * 0.026] });
      Md(k).box(r * 1.5, 0.008, 0.016, { at: [0, y + r * 1.42, z + 0.04] });
      return z + 0.07;
    case 'supp':
      Md(k).cyl(r * 1.45, r * 1.45, 0.25, 'z', { at: [0, y, z + 0.125] }, 10);
      Ms(k).cyl(r * 1.5, r * 1.5, 0.02, 'z', { at: [0, y, z + 0.01] }, 10);
      A(k).cyl(r * 1.47, r * 1.47, 0.012, 'z', { at: [0, y, z + 0.2] }, 10);
      return z + 0.25;
    case 'lsupp':
      Md(k).cyl(r * 1.6, r * 1.6, 0.36, 'z', { at: [0, y, z + 0.18] }, 10);
      Ms(k).cyl(r * 1.66, r * 1.66, 0.02, 'z', { at: [0, y, z + 0.01] }, 10);
      Ms(k).cyl(r * 1.66, r * 1.66, 0.016, 'z', { at: [0, y, z + 0.12] }, 10);
      A(k).cyl(r * 1.63, r * 1.63, 0.012, 'z', { at: [0, y, z + 0.3] }, 10);
      return z + 0.36;
    case 'choke':
      Ms(k).cyl(r * 1.15, r * 1.3, 0.05, 'z', { at: [0, y, z + 0.025] }, 10);
      return z + 0.05;
    default:
      Ms(k).cyl(r * 1.15, r * 1.15, 0.035, 'z', { at: [0, y, z + 0.0175] }, 8);
      return z + 0.035;
  }
}

/** Optic or iron sights over a rail. `top` is the rail's top y, `z` the mount; returns the sight line height. */
function optic(k: Kit, type: string, z: number, top: number, barrelZ: number, barrelTop: number): void {
  const mounts = (len: number, h: number) => { for (const m of [-1, 1]) Ms(k).box(0.07, h, 0.04, { at: [0, top + h / 2, z + m * len * 0.28] }); };
  const scope = (len: number, r: number) => {
    const height = top + 0.05 + r * 0.8;
    mounts(len, height - top);
    M(k).cyl(r * 0.78, r * 0.78, len, 'z', { at: [0, height, z] }, 10);
    M(k).cyl(r * 1.0, r * 1.2, len * 0.24, 'z', { at: [0, height, z + len * 0.4] }, 10);
    M(k).cyl(r * 0.95, r * 0.8, len * 0.18, 'z', { at: [0, height, z - len * 0.4] }, 10);
    Glass(k).cyl(r * 1.1, r * 1.1, 0.008, 'z', { at: [0, height, z + len * 0.52 + 0.002] }, 10);
    Glass(k).cyl(r * 0.78, r * 0.78, 0.008, 'z', { at: [0, height, z - len * 0.49] }, 10);
    Ms(k).cyl(r * 0.28, r * 0.28, r * 0.5, 'y', { at: [0, height + r * 0.92, z] }, 6);
    Ms(k).cyl(r * 0.28, r * 0.28, r * 0.5, 'x', { at: [r * 0.92, height, z] }, 6);
    if (len > 0.3) A(k).cyl(r * 0.84, r * 0.84, 0.014, 'z', { at: [0, height, z + len * 0.2] }, 10);
  };
  switch (type) {
    case 'irons': {
      Ms(k).box(0.016, 0.075, 0.016, { at: [0, barrelTop + 0.035, barrelZ] });
      Ms(k).box(0.05, 0.024, 0.04, { at: [0, barrelTop + 0.004, barrelZ] });
      Ms(k).box(0.012, 0.05, 0.02, { at: [-0.022, top + 0.027, z - 0.08] });
      Ms(k).box(0.012, 0.05, 0.02, { at: [0.022, top + 0.027, z - 0.08] });
      Ms(k).box(0.058, 0.012, 0.022, { at: [0, top + 0.012, z - 0.08] });
      break;
    }
    case 'dot':
      Ms(k).box(0.07, 0.026, 0.1, { at: [0, top + 0.013, z] });
      M(k).box(0.074, 0.05, 0.016, { at: [0, top + 0.05, z - 0.04] });
      for (const side of [-1, 1]) M(k).box(0.012, 0.055, 0.1, { at: [side * 0.035, top + 0.055, z] });
      M(k).box(0.074, 0.012, 0.1, { at: [0, top + 0.088, z] });
      Glass(k).box(0.058, 0.045, 0.008, { at: [0, top + 0.055, z + 0.045] });
      Glow(k).box(0.01, 0.01, 0.006, { at: [0, top + 0.056, z + 0.05] });
      break;
    case 'holo':
      Ms(k).box(0.08, 0.026, 0.13, { at: [0, top + 0.013, z] });
      M(k).box(0.082, 0.085, 0.13, { at: [0, top + 0.07, z] });
      Glass(k).box(0.064, 0.06, 0.134, { at: [0, top + 0.072, z] });
      M(k).box(0.07, 0.068, 0.07, { at: [0, top + 0.07, z] });
      Glass(k).box(0.062, 0.058, 0.074, { at: [0, top + 0.07, z] });
      Glow(k, [1, 0.2, 0.15]).box(0.012, 0.012, 0.076, { at: [0, top + 0.07, z] });
      break;
    case 'acog': {
      const height = top + 0.07;
      Ms(k).box(0.05, 0.03, 0.12, { at: [0, top + 0.015, z] });
      M(k).cyl(0.027, 0.027, 0.18, 'z', { at: [0, height, z] }, 10);
      M(k).cyl(0.036, 0.04, 0.05, 'z', { at: [0, height, z + 0.1] }, 10);
      M(k).cyl(0.03, 0.027, 0.04, 'z', { at: [0, height, z - 0.1] }, 10);
      Glass(k).cyl(0.036, 0.036, 0.008, 'z', { at: [0, height, z + 0.126] }, 10);
      Glass(k).cyl(0.024, 0.024, 0.008, 'z', { at: [0, height, z - 0.121] }, 10);
      Ms(k).loft(z - 0.07, z + 0.07, rect(0.012, 0.012, 0, height + 0.04), rect(0.012, 0.012, 0, height + 0.04));
      Glow(k, [1, 0.62, 0.1]).box(0.008, 0.008, 0.12, { at: [0, height + 0.034, z] });
      break;
    }
    case 'x2': scope(0.2, 0.03); break;
    case 'x3': scope(0.24, 0.032); break;
    case 'x4': scope(0.3, 0.035); break;
    case 'x6': scope(0.38, 0.04); break;
    case 'x8': scope(0.42, 0.044); break;
    case 'x10': scope(0.48, 0.048); break;
    case 'thermal': {
      const height = top + 0.09;
      Ms(k).box(0.06, 0.04, 0.14, { at: [0, top + 0.02, z] });
      M(k).box(0.1, 0.1, 0.22, { at: [0, height, z] });
      M(k).cyl(0.06, 0.056, 0.07, 'z', { at: [0, height, z + 0.14] }, 12);
      Glass(k).cyl(0.052, 0.052, 0.008, 'z', { at: [0, height, z + 0.178] }, 12);
      M(k).box(0.07, 0.07, 0.05, { at: [0, height, z - 0.135] });
      Glow(k, [0.3, 1, 0.5]).box(0.05, 0.04, 0.006, { at: [0, height, z - 0.162] });
      A(k).box(0.102, 0.016, 0.1, { at: [0, height + 0.05, z - 0.02] });
      break;
    }
    default: break;
  }
}

function extras(k: Kit, guardZ0: number, guardZ1: number, guardW: number, guardH: number): void {
  const mid = (guardZ0 + guardZ1) / 2, bottom = -guardH / 2;
  const has = (e: string) => k.look.extras.has(e);
  if (has('vgrip')) {
    const z = guardZ0 + (guardZ1 - guardZ0) * 0.55;
    Ms(k).box(0.05, 0.02, 0.07, { at: [0, bottom - 0.008, z] });
    Rubber(k).cyl(0.021, 0.023, 0.13, 'y', { at: [0, bottom - 0.075, z] }, 8);
    Ms(k).cyl(0.022, 0.022, 0.015, 'y', { at: [0, bottom - 0.147, z] }, 8);
  }
  if (has('agrip')) {
    const z = guardZ0 + (guardZ1 - guardZ0) * 0.5;
    Ms(k).box(0.05, 0.016, 0.07, { at: [0, bottom - 0.006, z - 0.02] });
    Rubber(k).box(0.034, 0.12, 0.05, { at: [0, bottom - 0.065, z + 0.018], rot: [0.9, 0, 0] });
  }
  if (has('laser')) {
    Md(k).box(0.034, 0.034, 0.09, { at: [guardW / 2 + 0.02, 0, mid + 0.04] });
    Glow(k, [1, 0.1, 0.1]).box(0.016, 0.016, 0.01, { at: [guardW / 2 + 0.02, 0, mid + 0.09] });
    A(k).box(0.036, 0.01, 0.03, { at: [guardW / 2 + 0.02, 0.022, mid + 0.04] });
  }
  if (has('light')) {
    Md(k).cyl(0.022, 0.024, 0.1, 'z', { at: [0, bottom - 0.03, guardZ1 - 0.07] }, 8);
    Ms(k).cyl(0.03, 0.03, 0.02, 'z', { at: [0, bottom - 0.03, guardZ1 - 0.012] }, 8);
    Glow(k, [1, 0.97, 0.8]).cyl(0.02, 0.02, 0.006, 'z', { at: [0, bottom - 0.03, guardZ1 - 0.0] }, 8);
  }
  if (has('bipod')) for (const side of [-1, 1]) {
    Ms(k).box(0.026, 0.2, 0.03, { at: [side * 0.07, bottom - 0.09, guardZ1 - 0.04], rot: [0, 0, side * -0.28] });
    Md(k).box(0.03, 0.02, 0.05, { at: [side * 0.098, bottom - 0.185, guardZ1 - 0.04] });
  }
}

// Rifle-family body plans -----------------------------------------------------------------------------------------
interface Plan { width: number; height: number; recvLen: number; guardLen: number; barrelR: number; barrelLen: number; guardW: number; guardH: number }
const PLANS: Partial<Record<WeaponClass, Plan>> = {
  ar: { width: 0.13, height: 0.15, recvLen: 0.4, guardLen: 0.3, barrelR: 0.024, barrelLen: 0.1, guardW: 0.11, guardH: 0.1 },
  br: { width: 0.14, height: 0.155, recvLen: 0.42, guardLen: 0.34, barrelR: 0.027, barrelLen: 0.1, guardW: 0.115, guardH: 0.105 },
  dmr: { width: 0.14, height: 0.15, recvLen: 0.4, guardLen: 0.42, barrelR: 0.028, barrelLen: 0.14, guardW: 0.11, guardH: 0.1 },
  lmg: { width: 0.19, height: 0.2, recvLen: 0.46, guardLen: 0.32, barrelR: 0.034, barrelLen: 0.16, guardW: 0.15, guardH: 0.15 },
  smg: { width: 0.12, height: 0.14, recvLen: 0.32, guardLen: 0.16, barrelR: 0.022, barrelLen: 0.08, guardW: 0.1, guardH: 0.095 },
};

function buildRifle(k: Kit, cls: WeaponClass): { muzzle: V3; grip: V3; fore: V3; length: number } {
  const plan = PLANS[cls]!, look = k.look;
  const bullpup = look.stock === 'bullpup';
  const recvStart = bullpup ? -0.34 : 0;
  const recvEnd = bullpup ? 0.46 : plan.recvLen;
  const guardLen = look.guard === 'none' ? 0 : look.guard === 'short' ? plan.guardLen * 0.55 : plan.guardLen;
  const bodyH = plan.height;
  const topY = bodyH * 0.5 - 0.01 + 0.012;
  const barrelY = 0.02;

  // Receiver: upper and lower halves, ejection port and charging handle.
  M(k).box(plan.width, bodyH * 0.62, recvEnd - recvStart, { at: [0, bodyH * 0.18 - 0.01, (recvStart + recvEnd) / 2] });
  Ms(k).box(plan.width * 0.94, bodyH * 0.44, (recvEnd - recvStart) * 0.88, { at: [0, -bodyH * 0.27 - 0.005, (recvStart + recvEnd) / 2 - 0.01] });
  Md(k).box(plan.width + 0.004, 0.04, 0.09, { at: [0, 0.035, recvStart + (recvEnd - recvStart) * 0.55] });
  M(k).box(0.018, 0.02, 0.07, { at: [plan.width / 2 + 0.006, 0.03, recvStart + (recvEnd - recvStart) * 0.45] });
  Ms(k).box(0.04, 0.026, 0.05, { at: [0, topY + 0.004, recvStart + 0.05] });
  if (k.tier >= 2) A(k).box(plan.width + 0.006, 0.016, (recvEnd - recvStart) * 0.3, { at: [0, bodyH * 0.12, recvStart + (recvEnd - recvStart) * 0.7] });
  // Top rail along the receiver.
  M(k).box(0.04, 0.012, (recvEnd - recvStart) * 0.95, { at: [0, topY, (recvStart + recvEnd) / 2] });
  for (let z = recvStart + 0.04; z < recvEnd - 0.03; z += 0.036) M(k).box(0.046, 0.01, 0.014, { at: [0, topY + 0.006, z] });

  // Stock (or bullpup pad), grip, magazine.
  const stockZ = bullpup ? recvStart : 0;
  if (bullpup) { Rubber(k).box(plan.width * 0.92, bodyH * 1.05, 0.04, { at: [0, 0, recvStart - 0.02] }); F(k).box(plan.width * 0.9, 0.04, recvEnd - recvStart - 0.1, { at: [0, bodyH * 0.38, (recvStart + recvEnd) / 2 - 0.05] }); }
  else if (look.stock !== 'thumb') stock(k, look.stock, stockZ, plan.width * 0.78);
  const gripZ = bullpup ? 0.14 : plan.recvLen * 0.3 + 0.02;
  const gripTop = -bodyH * 0.45 + 0.005;
  if (look.stock === 'thumb') stock(k, 'thumb', stockZ, plan.width * 0.78);
  else pistolGrip(k, gripZ, 0.2, gripTop);
  const magZ = bullpup ? -0.06 : plan.recvLen * (cls === 'lmg' ? 0.62 : 0.66);
  magazine(k, look.mag, magZ, -bodyH * 0.5 + 0.015, cls === 'lmg' ? 0.08 : cls === 'smg' ? 0.06 : 0.068, cls === 'lmg' ? 0.12 : cls === 'smg' ? 0.09 : 0.105);

  // Handguard, barrel, muzzle.
  const guardZ0 = recvEnd - 0.02;
  const guardZ1 = guardZ0 + guardLen;
  guardPart(k, look.guard, guardZ0, guardZ1, plan.guardW, plan.guardH);
  const barrelStart = Math.max(recvEnd - 0.03, guardZ0);
  const barrelEnd = guardZ1 + plan.barrelLen + (bullpup ? 0.22 : 0) + (look.guard === 'none' ? 0.18 : 0);
  M(k).cyl(plan.barrelR, plan.barrelR, barrelEnd - barrelStart, 'z', { at: [0, barrelY, (barrelStart + barrelEnd) / 2] }, 8);
  Md(k).cyl(plan.barrelR * 1.35, plan.barrelR * 1.35, 0.03, 'z', { at: [0, barrelY, guardZ1 - 0.02] }, 8);
  if (guardLen > 0) Ms(k).box(0.022, 0.03, 0.04, { at: [0, barrelY + plan.barrelR + 0.012, guardZ1 - 0.04] });
  const tip = muzzleDevice(k, look.muzzle, barrelEnd, barrelY, plan.barrelR);

  // Sights, optic and rail furniture.
  const mount = bullpup ? 0.05 : recvStart + (recvEnd - recvStart) * 0.5;
  optic(k, look.optic, mount, topY + 0.006, guardZ1 - 0.04, barrelY + plan.barrelR);
  extras(k, guardZ0, Math.max(guardZ1, guardZ0 + 0.18), plan.guardW, plan.guardH);
  if (look.extras.has('carry')) {
    const y = topY + 0.1;
    for (const z of [recvStart + 0.2, recvStart + 0.46]) M(k).box(0.05, y - topY, 0.04, { at: [0, topY + (y - topY) / 2, z] });
    M(k).box(0.05, 0.03, 0.34, { at: [0, y, recvStart + 0.33] });
    Rubber(k).box(0.06, 0.026, 0.2, { at: [0, y + 0.002, recvStart + 0.33] });
  }
  const foreZ = look.extras.has('vgrip') ? guardZ0 + guardLen * 0.55 : guardLen > 0.05 ? guardZ0 + guardLen * 0.55 : recvEnd - 0.04;
  const foreY = look.extras.has('vgrip') ? -plan.guardH / 2 - 0.1 : look.extras.has('agrip') ? -plan.guardH / 2 - 0.07 : -plan.guardH / 2 + 0.005;
  return { muzzle: [0, barrelY, tip], grip: [0, gripTop - 0.07, gripZ - 0.02], fore: [0, foreY, foreZ], length: tip - (bullpup ? recvStart - 0.04 : -0.32) };
}

// Bolt-action rifles ----------------------------------------------------------------------------------------------
function buildBolt(k: Kit, cls: WeaponClass): { muzzle: V3; grip: V3; fore: V3; length: number } {
  const look = k.look, heavy = cls === 'amr', sc = heavy ? 1.3 : 1;
  const chassis = look.stock === 'adj' || look.stock === 'skel' || look.stock === 'bullpup';
  const recvEnd = 0.34 * sc;
  const topY = 0.05 * sc + 0.03;

  // Receiver, bolt, ejection port.
  M(k).cyl(0.05 * sc, 0.05 * sc, recvEnd + 0.04, 'z', { at: [0, 0.03, recvEnd / 2 - 0.01] }, 10);
  M(k).box(0.1 * sc, 0.07 * sc, recvEnd * 0.95, { at: [0, -0.02, recvEnd / 2] });
  Md(k).box(0.054 * sc, 0.03, 0.1 * sc, { at: [0.03 * sc, 0.045, 0.1] });
  Ms(k).cyl(0.026, 0.026, 0.07, 'z', { at: [0, 0.03, -0.045] }, 8);
  Ms(k).box(0.12 * sc, 0.028, 0.03, { at: [0.07 * sc, 0.0, 0.07], rot: [0, 0, -0.3] });
  Ms(k).sphere([0.07, 0.07, 0.07], { at: [0.14 * sc, -0.03, 0.07] }, 5);
  // Stock / chassis.
  const bullpup = look.stock === 'bullpup';
  const bedEnd = chassis ? 0.5 : 0.78 * sc;
  if (bullpup) {
    M(k).box(0.11 * sc, 0.17 * sc, 0.5 * sc, { at: [0, -0.01, -0.18] });
    F(k).box(0.1 * sc, 0.04, 0.46 * sc, { at: [0, 0.095 * sc, -0.17] });
    Rubber(k).box(0.11 * sc, 0.2 * sc, 0.04, { at: [0, -0.01, -0.45 * sc] });
  } else if (look.stock === 'wood' || look.stock === 'thumb') {
    F(k).loft(-0.05, bedEnd, rect(0.058 * sc, 0.052 * sc, 0, -0.065), rect(0.052 * sc, 0.042 * sc, 0, -0.05));
    stock(k, look.stock === 'thumb' ? 'thumb' : 'wood', -0.05, 0.11 * sc);
  } else {
    // Chassis: aluminium spine with a polymer stock.
    Ms(k).box(0.085 * sc, 0.075 * sc, 0.62 * sc, { at: [0, -0.03, 0.17] });
    stock(k, look.stock, -0.12, 0.1 * sc);
    F(k).box(0.07, 0.034, 0.18, { at: [0, topY - 0.015, -0.2 * sc] });
  }
  if (look.stock !== 'thumb') pistolGrip(k, bullpup ? 0.04 : -0.06, 0.17 * sc, -0.07);
  magazine(k, look.mag, 0.2 * sc, -0.06, heavy ? 0.11 : 0.07, heavy ? 0.17 : 0.11);
  if (look.mag === 'inner') Md(k).box(0.08, 0.02, 0.2, { at: [0, -0.1, 0.2 * sc] });

  // Barrel and muzzle.
  const barrelR = heavy ? 0.04 : look.tweaks.has('heavy') ? 0.034 : 0.027;
  const barrelEnd = (heavy ? 1.12 : 1.02) + (look.muzzle === 'lsupp' ? 0 : 0);
  M(k).cyl(barrelR, barrelR * 0.92, barrelEnd - recvEnd + 0.05, 'z', { at: [0, 0.03, (recvEnd + barrelEnd) / 2 - 0.02] }, 10);
  if (heavy) for (let z = 0.5; z < 0.95; z += 0.07) Md(k).box(barrelR * 2.1, 0.012, 0.022, { at: [0, 0.03 + barrelR - 0.002, z] });
  if (chassis || heavy) guardPart(k, 'mlok', recvEnd - 0.02, recvEnd + 0.34, 0.1 * sc, 0.085 * sc);
  const tip = muzzleDevice(k, look.muzzle === 'plain' && heavy ? 'brake' : look.muzzle, barrelEnd, 0.03, barrelR);
  optic(k, look.optic === 'irons' ? 'x6' : look.optic, 0.1, topY - 0.01, barrelEnd - 0.1, 0.03 + barrelR);
  // Optic mounting rail.
  M(k).box(0.04, 0.012, 0.5 * sc, { at: [0, topY - 0.012, 0.15] });
  const guardZ0 = recvEnd, guardZ1 = Math.min(bedEnd, recvEnd + 0.4);
  extras(k, guardZ0, guardZ1, 0.1 * sc, 0.09 * sc);
  const foreZ = (guardZ0 + guardZ1) / 2 + 0.05;
  return { muzzle: [0, 0.03, tip], grip: [0, -0.15, bullpup ? 0.0 : -0.1], fore: [0, -0.08, foreZ], length: tip + 0.5 };
}

// Shotguns --------------------------------------------------------------------------------------------------------
function buildShotgun(k: Kit): { muzzle: V3; grip: V3; fore: V3; length: number } {
  const look = k.look, frame = look.frame;
  const short = look.tweaks.has('short');
  const drum = look.tweaks.has('drum');
  const ext = look.tweaks.has('ext');
  const hasRail = look.extras.has('rail');
  const barrelY = 0.045;
  let barrelEnd = short ? 0.82 : 1.04;
  let tubeEnd = short ? 0.62 : ext ? 0.84 : 0.7;
  let gripZ = 0.04, gripTop = -0.07, foreZ = 0.58, foreY = -0.06, topY = 0.085;

  if (frame === 'break' || frame === 'sawn') {
    const sawn = frame === 'sawn';
    barrelEnd = sawn ? 0.5 : 0.98;
    M(k).box(0.1, 0.1, 0.2, { at: [0, 0.02, 0.1] });
    Ms(k).box(0.11, 0.05, 0.12, { at: [0, 0.0, 0.14] });
    for (const side of [-1, 1]) M(k).cyl(0.027, 0.027, barrelEnd - 0.1, 'z', { at: [side * 0.028, barrelY, (0.1 + barrelEnd) / 2] }, 10);
    Ms(k).box(0.02, 0.016, barrelEnd - 0.1, { at: [0, barrelY + 0.034, (0.1 + barrelEnd) / 2] });
    Ms(k).box(0.012, 0.025, 0.012, { at: [0, barrelY + 0.045, barrelEnd - 0.02] });
    F(k).loft(0.2, sawn ? 0.42 : 0.62, rect(0.062, 0.03, 0, -0.01), rect(0.055, 0.028, 0, -0.012));
    Ms(k).box(0.09, 0.016, 0.03, { at: [0, -0.024, sawn ? 0.42 : 0.62] });
    Ms(k).box(0.03, 0.012, 0.06, { at: [0, 0.075, 0.06] });
    for (const side of [-1, 1]) Md(k).cyl(0.02, 0.02, 0.006, 'z', { at: [side * 0.028, barrelY, barrelEnd + 0.002] }, 8);
    if (sawn) { F(k).box(0.07, 0.17, 0.09, { at: [0, -0.1, -0.1], rot: [-0.45, 0, 0] }); F(k).box(0.07, 0.07, 0.2, { at: [0, 0.0, -0.06] }); gripZ = -0.08; }
    else { stock(k, 'wood', 0.0, 0.11); gripZ = -0.0; }
    topY = 0.075;
    foreZ = sawn ? 0.35 : 0.5;
    const tip = muzzleDevice(k, look.muzzle, barrelEnd, barrelY, 0.03);
    return { muzzle: [0, barrelY, tip], grip: [0, -0.13, gripZ - 0.03], fore: [0, -0.05, foreZ], length: tip + (sawn ? 0.22 : 0.42) };
  }

  if (frame === 'lever') {
    M(k).box(0.1, 0.13, 0.34, { at: [0, 0.0, 0.17] });
    Ms(k).box(0.104, 0.05, 0.14, { at: [0, 0.03, 0.22] });
    M(k).cyl(0.03, 0.03, barrelEnd - 0.3, 'z', { at: [0, barrelY, (0.3 + barrelEnd) / 2] }, 8);
    M(k).cyl(0.026, 0.026, tubeEnd - 0.3, 'z', { at: [0, -0.04, (0.3 + tubeEnd) / 2] }, 8);
    // Lever loop under the receiver.
    M(k).box(0.016, 0.014, 0.24, { at: [0, -0.158, 0.2] });
    M(k).box(0.016, 0.1, 0.014, { at: [0, -0.11, 0.322], rot: [-0.1, 0, 0] });
    M(k).box(0.016, 0.1, 0.014, { at: [0, -0.11, 0.08], rot: [0.2, 0, 0] });
    F(k).loft(0.3, tubeEnd, rect(0.045, 0.026, 0, -0.07), rect(0.04, 0.022, 0, -0.07));
    stock(k, 'wood', 0.0, 0.1);
    Ms(k).box(0.012, 0.03, 0.012, { at: [0, barrelY + 0.03, barrelEnd - 0.03] });
    Ms(k).box(0.016, 0.04, 0.03, { at: [0, 0.075, 0.28] });
    const tip = muzzleDevice(k, look.muzzle, barrelEnd, barrelY, 0.03);
    return { muzzle: [0, barrelY, tip], grip: [0, -0.13, 0.0], fore: [0, -0.07, 0.5], length: tip + 0.4 };
  }

  const bull = frame === 'bull';
  const auto = frame === 'auto' || bull;
  const recvEnd = bull ? 0.44 : auto ? 0.4 : 0.36;
  const recvStart = bull ? -0.32 : 0;
  // Receiver.
  M(k).box(0.14, 0.145, recvEnd - recvStart, { at: [0, 0.0, (recvStart + recvEnd) / 2] });
  Ms(k).box(0.132, 0.05, (recvEnd - recvStart) * 0.9, { at: [0, -0.05, (recvStart + recvEnd) / 2] });
  Md(k).box(0.146, 0.04, 0.1, { at: [0, 0.03, recvStart + (recvEnd - recvStart) * 0.62] });
  if (auto) { A(k).box(0.146, 0.016, 0.18, { at: [0, -0.03, recvEnd - 0.12] }); Md(k).box(0.05, 0.03, 0.07, { at: [0.0, -0.085, recvEnd - 0.2] }); }
  if (hasRail || bull) {
    M(k).box(0.04, 0.012, recvEnd - recvStart, { at: [0, 0.079, (recvStart + recvEnd) / 2] });
    for (let z = recvStart + 0.04; z < recvEnd - 0.02; z += 0.04) M(k).box(0.046, 0.01, 0.014, { at: [0, 0.086, z] });
    topY = 0.09;
  }
  // Barrel, magazine tube, fore-end.
  M(k).cyl(0.034, 0.034, barrelEnd - recvEnd + 0.03, 'z', { at: [0, barrelY, (recvEnd + barrelEnd) / 2 - 0.015] }, 10);
  if (!drum) M(k).cyl(0.03, 0.03, tubeEnd - recvEnd + 0.02, 'z', { at: [0, -0.052, (recvEnd + tubeEnd) / 2 - 0.01] }, 10);
  Ms(k).cyl(0.034, 0.034, 0.02, 'z', { at: [0, -0.052, tubeEnd] }, 10);
  if (frame === 'pump') {
    F(k).box(0.12, 0.1, 0.27, { at: [0, -0.052, recvEnd + 0.17] });
    for (let i = 0; i < 5; i++) Md(k).box(0.126, 0.106, 0.012, { at: [0, -0.052, recvEnd + 0.08 + i * 0.045] });
    foreZ = recvEnd + 0.17;
  } else {
    F(k).loft(recvEnd - 0.02, short ? 0.62 : 0.74, rect(0.062, 0.05, 0, -0.04), rect(0.056, 0.044, 0, -0.045));
    foreZ = recvEnd + 0.16;
  }
  if (drum) {
    Md(k).box(0.07, 0.06, 0.1, { at: [0, -0.1, recvEnd - 0.12] });
    F(k, 0.9).cyl(0.14, 0.14, 0.14, 'x', { at: [0, -0.22, recvEnd - 0.12] }, 14);
    Ms(k).cyl(0.115, 0.115, 0.16, 'x', { at: [0, -0.22, recvEnd - 0.12] }, 14);
    A(k).cyl(0.04, 0.04, 0.17, 'x', { at: [0, -0.22, recvEnd - 0.12] }, 8);
  }
  Ms(k).box(0.016, 0.03, 0.016, { at: [0, barrelY + 0.045, barrelEnd - 0.04] });
  M(k).box(0.02, 0.025, 0.06, { at: [0.0, 0.085, recvStart + 0.03] });
  if (look.extras.has('mlok')) for (const side of [-1, 1]) for (let z = recvEnd + 0.04; z < recvEnd + 0.3; z += 0.05) Md(k).box(0.006, 0.014, 0.034, { at: [side * 0.063, -0.045, z] });
  if (look.extras.has('light')) { Md(k).cyl(0.022, 0.024, 0.1, 'z', { at: [0, -0.115, tubeEnd - 0.06] }, 8); Glow(k, [1, 0.97, 0.8]).cyl(0.018, 0.018, 0.006, 'z', { at: [0, -0.115, tubeEnd - 0.005] }, 8); }
  const tip = muzzleDevice(k, look.muzzle, barrelEnd, barrelY, 0.034);
  // Stock and grip.
  if (bull) {
    Rubber(k).box(0.13, 0.2, 0.04, { at: [0, -0.01, recvStart - 0.02] });
    F(k).box(0.12, 0.04, recvEnd - recvStart - 0.06, { at: [0, 0.088, (recvStart + recvEnd) / 2 - 0.03] });
    pistolGrip(k, 0.12, 0.18, -0.07);
    gripZ = 0.12;
  } else {
    stock(k, 'wood', 0.0, 0.12);
    if (frame !== 'lever') pistolGrip(k, 0.04, 0.14, -0.07);
  }
  if (look.optic !== 'irons') optic(k, look.optic, bull ? 0.0 : recvEnd * 0.5, topY, barrelEnd, barrelY + 0.034);
  return { muzzle: [0, barrelY, tip], grip: [0, -0.15, gripZ - 0.02], fore: [0, foreY, foreZ], length: tip + (bull ? 0.36 : 0.42) };
}

// Pistols and revolvers -------------------------------------------------------------------------------------------
function buildPistol(k: Kit): { muzzle: V3; grip: V3; fore: V3; length: number } {
  const look = k.look, frame = look.frame;
  const ext = look.tweaks.has('ext');
  if (frame === 'revolver') {
    const barrelLen = look.tweaks.has('short') ? 0.14 : look.tweaks.has('long') ? 0.42 : 0.26;
    const z0 = 0.16;
    const barrelEnd = z0 + 0.12 + barrelLen;
    M(k).box(0.075, 0.12, 0.14, { at: [0, 0.0, 0.2] });
    M(k).box(0.062, 0.03, 0.2, { at: [0, 0.07, 0.22] });
    Ms(k).cyl(0.066, 0.066, 0.1, 'z', { at: [0, 0.02, 0.22] }, 12);
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; Md(k).cyl(0.014, 0.014, 0.01, 'z', { at: [Math.cos(a) * 0.04, 0.02 + Math.sin(a) * 0.04, 0.275] }, 6); }
    M(k).cyl(0.026, 0.024, barrelEnd - 0.26, 'z', { at: [0, 0.035, (0.26 + barrelEnd) / 2] }, 8);
    Ms(k).box(0.03, 0.03, barrelEnd - 0.28, { at: [0, 0.0, (0.28 + barrelEnd) / 2] });
    Ms(k).box(0.014, 0.03, 0.024, { at: [0, 0.075, barrelEnd - 0.02] });
    Ms(k).box(0.02, 0.05, 0.03, { at: [0, 0.09, 0.08], rot: [-0.7, 0, 0] });
    F(k).box(0.07, 0.19, 0.1, { at: [0, -0.14, 0.12], rot: [-0.35, 0, 0] });
    M(k).box(0.018, 0.018, 0.1, { at: [0, -0.07, 0.19] });
    M(k).box(0.018, 0.075, 0.018, { at: [0, -0.045, 0.255] });
    M(k).box(0.018, 0.018, 0.075, { at: [0, -0.085, 0.222] });
    if (look.optic !== 'irons') optic(k, look.optic, 0.26, 0.085, barrelEnd, 0.06);
    const tip = muzzleDevice(k, look.muzzle, barrelEnd, 0.035, 0.026);
    return { muzzle: [0, 0.035, tip], grip: [0, -0.16, 0.06], fore: [0, -0.18, 0.1], length: tip + 0.12 };
  }

  const dims: Record<string, { len: number; h: number; w: number; grip: number }> = {
    std: { len: 0.47, h: 0.115, w: 0.1, grip: 0.24 }, compact: { len: 0.36, h: 0.105, w: 0.092, grip: 0.19 },
    long: { len: 0.58, h: 0.115, w: 0.1, grip: 0.24 }, hand: { len: 0.54, h: 0.14, w: 0.125, grip: 0.28 }, machine: { len: 0.42, h: 0.115, w: 0.1, grip: 0.24 },
  };
  const d = dims[frame] ?? dims.std;
  const sz0 = 0.26 - 0.02, sz1 = sz0 + d.len, mid = (sz0 + sz1) / 2;
  const slideY = 0.03;
  // Slide, frame, barrel.
  M(k).box(d.w, d.h, d.len, { at: [0, slideY, mid] });
  Ms(k).box(d.w * 0.5, 0.014, d.len, { at: [0, slideY + d.h / 2 + 0.005, mid] });
  M(k).box(d.w * 0.92, 0.05, d.len * 0.74, { at: [0, -0.052, sz0 + d.len * 0.37] });
  if (frame === 'hand') { Ms(k).loft(sz0 + d.len * 0.3, sz1, rect(d.w * 0.44, 0.03, 0, -0.04), rect(d.w * 0.4, 0.024, 0, -0.04)); Md(k).box(0.012, 0.03, d.len * 0.5, { at: [d.w / 2 + 0.002, 0.035, mid] }); }
  for (let i = 0; i < 4; i++) Md(k).box(d.w + 0.006, d.h * 0.62, 0.01, { at: [0, slideY, sz0 + 0.03 + i * 0.026] });
  if (frame === 'machine') for (let i = 0; i < 4; i++) Md(k).box(d.w + 0.004, 0.014, 0.018, { at: [0, slideY + d.h / 2 - 0.01, sz0 + 0.14 + i * 0.05] });
  Ms(k).box(0.02, 0.03, 0.026, { at: [0, slideY + d.h / 2 + 0.018, sz1 - 0.03] });
  Ms(k).box(0.05, 0.03, 0.03, { at: [0, slideY + d.h / 2 + 0.014, sz0 + 0.03] });
  if (k.tier >= 2) A(k).box(d.w + 0.004, 0.012, 0.06, { at: [0, slideY - 0.02, sz1 - 0.06] });
  if (look.optic === 'dot') { Ms(k).box(0.05, 0.02, 0.07, { at: [0, slideY + d.h / 2 + 0.014, mid + 0.02] }); Glass(k).box(0.04, 0.04, 0.006, { at: [0, slideY + d.h / 2 + 0.05, mid + 0.05] }); Glow(k).box(0.008, 0.008, 0.005, { at: [0, slideY + d.h / 2 + 0.05, mid + 0.054] }); }
  if (look.extras.has('light')) { Md(k).box(0.045, 0.04, 0.09, { at: [0, -0.1, sz1 - 0.12] }); Glow(k, [1, 0.97, 0.8]).box(0.03, 0.026, 0.006, { at: [0, -0.1, sz1 - 0.07] }); }
  if (look.extras.has('laser')) { Md(k).box(0.04, 0.04, 0.06, { at: [0, -0.1, sz1 - 0.1] }); Glow(k).box(0.012, 0.012, 0.006, { at: [0, -0.1, sz1 - 0.066] }); }
  let tip = sz1;
  const barrelBare = look.muzzle !== 'plain' || frame === 'long';
  if (barrelBare) M(k).cyl(0.022, 0.022, 0.06, 'z', { at: [0, slideY - 0.005, sz1 + 0.025] }, 8);
  tip = muzzleDevice(k, look.muzzle, sz1 + (barrelBare ? 0.045 : 0), slideY - 0.005, 0.022);
  if (look.muzzle === 'plain') { Md(k).cyl(0.017, 0.017, 0.012, 'z', { at: [0, slideY - 0.005, sz1 + 0.006] }, 8); tip = sz1 + 0.012; }
  // Grip, magazine.
  const gz = 0.27;
  F(k).box(0.07, d.grip, 0.1, { at: [0, -0.04 - d.grip / 2, gz - d.grip * 0.1], rot: [-0.2, 0, 0] });
  Rubber(k).box(0.074, d.grip * 0.45, 0.104, { at: [0, -0.04 - d.grip * 0.7, gz - d.grip * 0.14], rot: [-0.2, 0, 0] });
  M(k).box(0.018, 0.075, 0.018, { at: [0, -0.07, gz + 0.14] });
  M(k).box(0.018, 0.018, 0.12, { at: [0, -0.108, gz + 0.085] });
  Md(k).box(0.012, 0.04, 0.012, { at: [0, -0.07, gz + 0.09], rot: [0.25, 0, 0] });
  if (ext || frame === 'machine') { Ms(k).box(0.058, 0.18, 0.082, { at: [0, -0.04 - d.grip - 0.07, gz - d.grip * 0.2 - 0.03], rot: [-0.2, 0, 0] }); Md(k).box(0.062, 0.016, 0.086, { at: [0, -0.04 - d.grip - 0.16, gz - d.grip * 0.2 - 0.05], rot: [-0.2, 0, 0] }); }
  else Md(k).box(0.074, 0.014, 0.1, { at: [0, -0.04 - d.grip - 0.002, gz - d.grip * 0.2 - 0.03], rot: [-0.2, 0, 0] });
  if (frame === 'machine') {
    // Arm brace behind the grip.
    F(k).loft(-0.06, 0.2, rect(0.032, 0.05, 0, -0.01), rect(0.028, 0.034, 0, 0.0));
    Rubber(k).box(0.07, 0.11, 0.03, { at: [0, -0.01, -0.075] });
  }
  return { muzzle: [0, slideY - 0.005, tip], grip: [0, -0.15, gz - 0.04], fore: [0, -0.2, gz - 0.02], length: tip + 0.1 };
}

/** Build the geometry for one gun. */
export function buildGun(kind: WeaponClass, lookText: string, tier: 1 | 2 | 3): GunGeometry {
  // Crossbows and launchers are drawn on the frame of a bolt rifle and a heavy bolt gun.
  const cls: WeaponClass = kind === 'bow' ? 'sniper' : kind === 'launcher' ? 'amr' : kind;
  const look = parseLook(cls, lookText);
  const k = makeKit(look, tier);
  let result: { muzzle: V3; grip: V3; fore: V3; length: number };
  if (cls === 'pistol') result = buildPistol(k);
  else if (cls === 'shotgun') result = buildShotgun(k);
  else if (cls === 'sniper' || cls === 'amr') result = buildBolt(k, cls);
  else result = buildRifle(k, cls);
  return { bag: k.s.bag, ...result };
}
