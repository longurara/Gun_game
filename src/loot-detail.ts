import { Bag, hexColor, Shaper } from './geometry';
import type { MeshData } from './geometry';
import type { WeaponClass } from './types';

/** Hysteresis keeps walking around a distance boundary from rebuilding the same pickup repeatedly. */
export function detailedRangeWeapon(distance: number, wasDetailed: boolean, lowQuality: boolean, touch: boolean, selected: boolean): boolean {
  if (selected) return true;
  const near = touch ? 10 : lowQuality ? 12 : 20;
  return distance < near + (wasDetailed ? 3 : 0);
}

/** A distant pickup silhouette and its tier ring, using one material and no textures. Held guns never use this. */
export function rangeWeaponSilhouette(kind: WeaponClass, tier: number): MeshData {
  const bag = new Bag(), s = new Shaper(bag);
  const metal = hexColor('#59656b'), furniture = hexColor('#3b4546');
  const long = kind === 'sniper' || kind === 'amr' || kind === 'dmr';
  const small = kind === 'pistol';
  s.use('plain', metal);
  if (kind === 'bow') {
    s.box(.07, .09, .55);
    s.box(.65, .045, .06, { at: [0, 0, .22] });
  } else if (kind === 'launcher') {
    s.cyl(.09, .09, .95, 'z', {}, 6);
    s.box(.06, .18, .10, { at: [0, -.14, -.18] });
  } else {
    const length = small ? .24 : kind === 'smg' ? .40 : .52;
    s.box(.075, .11, length);
    if (!small) {
      s.cyl(.017, .017, long ? .48 : .24, 'z', { at: [0, .02, length / 2 + (long ? .24 : .12)] }, 6);
      s.use('plain', furniture).box(.07, .13, .26, { at: [0, -.03, -length / 2 - .12] });
      if (kind !== 'shotgun') s.box(.05, .19, .10, { at: [0, -.14, .07], rot: [-.2, 0, 0] });
      if (long) s.use('plain', metal).cyl(.035, .035, .23, 'z', { at: [0, .12, -.02] }, 6);
      if (kind === 'lmg') s.box(.13, .17, .14, { at: [0, -.13, .06] });
    }
    s.use('plain', furniture).box(.06, .18, .08, { at: [0, -.13, small ? -.065 : -.16], rot: [-.3, 0, 0] });
  }
  const data = bag.data('plain');
  // Match the placement of the full pickup model.
  const sin = Math.sin(.12), cos = Math.cos(.12);
  for (let i = 0; i < data.positions.length; i += 3) {
    const x = data.positions[i], y = data.positions[i + 1];
    data.positions[i] = .72 * (x * cos - y * sin);
    data.positions[i + 1] = .72 * (x * sin + y * cos);
    data.positions[i + 2] = .72 * data.positions[i + 2] - .34;
    const nx = data.normals[i], ny = data.normals[i + 1];
    data.normals[i] = nx * cos - ny * sin;
    data.normals[i + 1] = nx * sin + ny * cos;
  }
  // A flat annulus is enough at this distance; a torus would cost hundreds of extra triangles.
  const ring = hexColor(['#d6ded9', '#d6ded9', '#4f9bd9', '#f0b43c'][tier] ?? '#d6ded9');
  for (let i = 0; i < 24; i++) {
    const a = i * Math.PI * 2 / 24, b = (i + 1) * Math.PI * 2 / 24;
    const base = data.positions.length / 3;
    for (const [angle, radius] of [[a, .4385], [a, .4615], [b, .4615], [b, .4385]]) {
      data.positions.push(Math.cos(angle) * radius, -.3, Math.sin(angle) * radius);
      data.normals.push(0, 1, 0); data.colors.push(...ring, 1); data.uvs.push(0, 0);
    }
    data.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  return data;
}
