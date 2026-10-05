/**
 * Tiny low-poly mesh builder with no engine dependency: boxes, tapered lofts, cylinders and spheres written into
 * per-finish vertex buffers (positions, normals, vertex colours, planar UVs). Guns and soldiers are assembled from
 * these, then handed to Babylon as a handful of merged meshes instead of dozens of primitives.
 */
export type V3 = [number, number, number];
export type RGB = [number, number, number];

export interface MeshData { positions: number[]; normals: number[]; colors: number[]; uvs: number[]; indices: number[] }
export const emptyMesh = (): MeshData => ({ positions: [], normals: [], colors: [], uvs: [], indices: [] });

/** A rectangle in the XY plane: the cross-section of a loft at one end. */
export interface Rect { cx: number; cy: number; hw: number; hh: number }
export interface Placement { at?: V3; rot?: V3 }

export function hexColor(hex: string): RGB {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16 & 255) / 255, (value >> 8 & 255) / 255, (value & 255) / 255];
}
export const mixColor = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const scaleColor = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

type Matrix = [number, number, number, number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Rotation matrix for Euler angles applied as Z, then X, then Y (the order Babylon uses). */
export function rotation(rx = 0, ry = 0, rz = 0): Matrix {
  const [sx, cx, sy, cy, sz, cz] = [Math.sin(rx), Math.cos(rx), Math.sin(ry), Math.cos(ry), Math.sin(rz), Math.cos(rz)];
  return [
    cy * cz + sy * sx * sz, -cy * sz + sy * sx * cz, sy * cx,
    cx * sz, cx * cz, -sx,
    -sy * cz + cy * sx * sz, sy * sz + cy * sx * cz, cy * cx,
  ];
}
const mul = (a: Matrix, b: Matrix): Matrix => {
  const out = new Array(9) as Matrix;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return out;
};
const turn = (m: Matrix, v: V3): V3 => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

/** Output of a builder: one buffer per finish, so each finish becomes one mesh with one texture. */
export class Bag {
  readonly groups = new Map<string, MeshData>();
  data(finish: string): MeshData {
    let data = this.groups.get(finish);
    if (!data) { data = emptyMesh(); this.groups.set(finish, data); }
    return data;
  }
  bounds(): { min: V3; max: V3 } {
    const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
    for (const data of this.groups.values()) for (let i = 0; i < data.positions.length; i += 3) for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], data.positions[i + k]); max[k] = Math.max(max[k], data.positions[i + k]);
    }
    return { min, max };
  }
  vertexCount(): number { let n = 0; for (const d of this.groups.values()) n += d.positions.length / 3; return n; }
}

export class Shaper {
  finish = 'metal';
  tint: RGB = [1, 1, 1];
  /** Texture repeats per metre. */
  constructor(readonly bag: Bag, public uvScale = 3) {}

  use(finish: string, tint: RGB = [1, 1, 1]): this { this.finish = finish; this.tint = tint; return this; }

  private matrix(place: Placement): Matrix {
    const [rx, ry, rz] = place.rot ?? [0, 0, 0];
    return rx || ry || rz ? rotation(rx, ry, rz) : IDENTITY;
  }

  /** A quad with auto-corrected winding. Corners go around the outside; `outward` is the direction it faces. */
  private quad(a: V3, b: V3, c: V3, d: V3, outward: V3, shadeBoost = 1): void {
    const data = this.bag.data(this.finish);
    let normal = unit(cross(sub(b, a), sub(c, a)));
    if (dot(normal, outward) < 0) normal = [-normal[0], -normal[1], -normal[2]];
    const flip = dot(cross(sub(b, a), sub(c, a)), normal) > 0;
    const shade = Math.max(0.55, Math.min(1.05, (0.86 + 0.16 * normal[1]) * shadeBoost));
    const color = scaleColor(this.tint, shade);
    const base = data.positions.length / 3;
    for (const p of [a, b, c, d]) {
      data.positions.push(p[0], p[1], p[2]);
      data.normals.push(normal[0], normal[1], normal[2]);
      data.colors.push(color[0], color[1], color[2], 1);
      const [u, v] = this.planar(p, normal);
      data.uvs.push(u, v);
    }
    if (flip) data.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    else data.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Planar UVs along the dominant axis of the normal: grain runs along z (the barrel) on side faces. */
  private planar(p: V3, n: V3): [number, number] {
    const s = this.uvScale, ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
    if (ax >= ay && ax >= az) return [p[2] * s, p[1] * s];
    if (ay >= az) return [p[2] * s, p[0] * s];
    return [p[0] * s, p[1] * s];
  }

  /** A solid between two rectangles, `z0` and `z1` apart along z. Equal rectangles make a box. */
  loft(z0: number, z1: number, r0: Rect, r1: Rect, place: Placement = {}): this {
    const m = this.matrix(place), at = place.at ?? [0, 0, 0];
    const corner = (z: number, r: Rect, sx: number, sy: number): V3 => {
      const v = turn(m, [r.cx + sx * r.hw, r.cy + sy * r.hh, z]);
      return [v[0] + at[0], v[1] + at[1], v[2] + at[2]];
    };
    const a0 = corner(z0, r0, -1, -1), b0 = corner(z0, r0, 1, -1), c0 = corner(z0, r0, 1, 1), d0 = corner(z0, r0, -1, 1);
    const a1 = corner(z1, r1, -1, -1), b1 = corner(z1, r1, 1, -1), c1 = corner(z1, r1, 1, 1), d1 = corner(z1, r1, -1, 1);
    const centre: V3 = turn(m, [(r0.cx + r1.cx) / 2, (r0.cy + r1.cy) / 2, (z0 + z1) / 2]).map((v, i) => v + at[i]) as V3;
    const face = (p: V3, q: V3, r: V3, s: V3) => {
      const mid: V3 = [(p[0] + q[0] + r[0] + s[0]) / 4, (p[1] + q[1] + r[1] + s[1]) / 4, (p[2] + q[2] + r[2] + s[2]) / 4];
      if (Math.hypot(...cross(sub(q, p), sub(s, p))) < 1e-9 && Math.hypot(...cross(sub(r, q), sub(s, q))) < 1e-9) return;
      this.quad(p, q, r, s, sub(mid, centre));
    };
    face(a1, b1, c1, d1); face(a0, d0, c0, b0);
    face(a0, a1, d1, d0); face(b0, c0, c1, b1);
    face(d0, d1, c1, c0); face(a0, b0, b1, a1);
    return this;
  }

  /** Axis-aligned (before rotation) box centred on `at`. */
  box(w: number, h: number, d: number, place: Placement = {}): this {
    const r: Rect = { cx: 0, cy: 0, hw: w / 2, hh: h / 2 };
    return this.loft(-d / 2, d / 2, r, r, place);
  }

  /** Cylinder or cone frustum along an axis, centred on `at`; radius `r0` at the start, `r1` at the end. */
  cyl(r0: number, r1: number, length: number, axis: 'x' | 'y' | 'z', place: Placement = {}, sides = 10, caps: 'both' | 'start' | 'end' | 'none' = 'both'): this {
    const pre = axis === 'x' ? rotation(0, Math.PI / 2, 0) : axis === 'y' ? rotation(-Math.PI / 2, 0, 0) : IDENTITY;
    const m = mul(this.matrix(place), pre), at = place.at ?? [0, 0, 0];
    const data = this.bag.data(this.finish);
    const world = (v: V3): V3 => { const t = turn(m, v); return [t[0] + at[0], t[1] + at[1], t[2] + at[2]]; };
    const slope = (r0 - r1) / Math.max(length, 1e-6);
    const ring = (z: number, r: number, k: number) => {
      const base = data.positions.length / 3;
      for (let i = 0; i <= sides; i++) {
        const phi = i / sides * Math.PI * 2, c = Math.cos(phi), s = Math.sin(phi);
        const p = world([c * r, s * r, z]);
        const n = unit(turn(m, [c, s, slope]));
        const shade = Math.max(0.55, Math.min(1.05, 0.86 + 0.16 * n[1]));
        const color = scaleColor(this.tint, shade);
        data.positions.push(p[0], p[1], p[2]);
        data.normals.push(n[0], n[1], n[2]);
        data.colors.push(color[0], color[1], color[2], 1);
        data.uvs.push(k * length * this.uvScale, phi * Math.max(r0, r1) * this.uvScale);
      }
      return base;
    };
    const a = ring(-length / 2, r0, 0), b = ring(length / 2, r1, 1);
    for (let i = 0; i < sides; i++) data.indices.push(a + i, b + i, a + i + 1, a + i + 1, b + i, b + i + 1);
    // Make sure the side winding follows the same convention as the quads.
    this.fixSide(data, a, sides);
    const cap = (z: number, r: number, outward: number) => {
      if (r < 1e-5) return;
      const centre = world([0, 0, z]);
      const n = unit(turn(m, [0, 0, outward]));
      const color = scaleColor(this.tint, Math.max(0.55, 0.86 + 0.16 * n[1]));
      const base = data.positions.length / 3;
      data.positions.push(centre[0], centre[1], centre[2]); data.normals.push(n[0], n[1], n[2]); data.colors.push(color[0], color[1], color[2], 1);
      data.uvs.push(...this.planar(centre, n));
      for (let i = 0; i <= sides; i++) {
        const phi = i / sides * Math.PI * 2;
        const p = world([Math.cos(phi) * r, Math.sin(phi) * r, z]);
        data.positions.push(p[0], p[1], p[2]); data.normals.push(n[0], n[1], n[2]); data.colors.push(color[0], color[1], color[2], 1);
        data.uvs.push(...this.planar(p, n));
      }
      for (let i = 0; i < sides; i++) {
        const i0 = base, i1 = base + 1 + i, i2 = base + 2 + i;
        const tri = cross(sub(data3(data, i1), data3(data, i0)), sub(data3(data, i2), data3(data, i0)));
        if (dot(tri, n) > 0) data.indices.push(i0, i2, i1); else data.indices.push(i0, i1, i2);
      }
    };
    if (caps === 'both' || caps === 'start') cap(-length / 2, r0, -1);
    if (caps === 'both' || caps === 'end') cap(length / 2, r1, 1);
    return this;
  }

  /** The side indices were pushed in one fixed order; flip them if that order faces inward. */
  private fixSide(data: MeshData, base: number, sides: number): void {
    const end = data.indices.length, start = end - sides * 6;
    // Babylon's front faces have (b-a)x(c-a) pointing against the outward normal. Judge by whichever of the first two triangles has area.
    let verdict = 0;
    for (const t of [start, start + 3]) {
      const i0 = data.indices[t], i1 = data.indices[t + 1], i2 = data.indices[t + 2];
      const n: V3 = [data.normals[i0 * 3], data.normals[i0 * 3 + 1], data.normals[i0 * 3 + 2]];
      const tri = cross(sub(data3(data, i1), data3(data, i0)), sub(data3(data, i2), data3(data, i0)));
      if (Math.abs(dot(tri, n)) > Math.abs(verdict)) verdict = dot(tri, n);
    }
    if (verdict > 0) for (let i = start; i < end; i += 3) { const t = data.indices[i + 1]; data.indices[i + 1] = data.indices[i + 2]; data.indices[i + 2] = t; }
    void base;
  }

  /** Low-poly ellipsoid. `size` is the full extent on each axis. */
  sphere(size: V3, place: Placement = {}, segments = 7): this {
    const m = this.matrix(place), at = place.at ?? [0, 0, 0];
    const data = this.bag.data(this.finish);
    const rows = segments, cols = segments * 2, base = data.positions.length / 3;
    for (let i = 0; i <= rows; i++) {
      const theta = i / rows * Math.PI;
      for (let j = 0; j <= cols; j++) {
        const phi = j / cols * Math.PI * 2;
        const dir: V3 = [Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)];
        const local: V3 = [dir[0] * size[0] / 2, dir[1] * size[1] / 2, dir[2] * size[2] / 2];
        const p = turn(m, local);
        const n = unit(turn(m, [dir[0] / (size[0] / 2 || 1), dir[1] / (size[1] / 2 || 1), dir[2] / (size[2] / 2 || 1)]));
        const shade = Math.max(0.55, Math.min(1.05, 0.86 + 0.16 * n[1]));
        const color = scaleColor(this.tint, shade);
        data.positions.push(p[0] + at[0], p[1] + at[1], p[2] + at[2]);
        data.normals.push(n[0], n[1], n[2]);
        data.colors.push(color[0], color[1], color[2], 1);
        data.uvs.push(j / cols * Math.PI * (size[0] + size[2]) / 2 * this.uvScale * 0.5, i / rows * Math.PI * size[1] / 2 * this.uvScale * 0.5);
      }
    }
    const start = data.indices.length;
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const a = base + i * (cols + 1) + j, b = a + cols + 1;
      data.indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
    // Judge the winding on a triangle from the middle row, away from the degenerate pole triangles.
    const mid = start + Math.floor(rows / 2) * cols * 6;
    const i0 = data.indices[mid], i1 = data.indices[mid + 1], i2 = data.indices[mid + 2];
    const tri = cross(sub(data3(data, i1), data3(data, i0)), sub(data3(data, i2), data3(data, i0)));
    const n0: V3 = [data.normals[i0 * 3], data.normals[i0 * 3 + 1], data.normals[i0 * 3 + 2]];
    if (dot(tri, n0) > 0) for (let i = start; i < data.indices.length; i += 3) { const t = data.indices[i + 1]; data.indices[i + 1] = data.indices[i + 2]; data.indices[i + 2] = t; }
    return this;
  }
}

function data3(data: MeshData, index: number): V3 { return [data.positions[index * 3], data.positions[index * 3 + 1], data.positions[index * 3 + 2]]; }

/** A rectangle shorthand. */
export const rect = (hw: number, hh: number, cx = 0, cy = 0): Rect => ({ cx, cy, hw, hh });
