import type { Scene } from '@babylonjs/core/scene.js';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { MultiMaterial } from '@babylonjs/core/Materials/multiMaterial.js';
import { SubMesh } from '@babylonjs/core/Meshes/subMesh.js';
import { GENERATED_TEXTURES, useGeneratedAlbedo } from './generated-textures';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import type { Field, Obstacle, WorldConfig } from './types';
import { DOOR_HEIGHT, forestNoise, groundNoise, HOUSE_HEIGHT, obstacleBase } from './game/world';
import { groundBumpTexture, groundDetailTexture, IslandDecor } from './island-decor';
import { ATLAS, CardBatch, createFacadeMaterial, createFoliageMaterial } from './island-foliage';

/** World is split into square chunks; terrain detail and props stream in around the player. */
export const CHUNK = 125;
type Rgb = [number, number, number];

const hex = (value: string): Rgb => [parseInt(value.slice(1, 3), 16) / 255, parseInt(value.slice(3, 5), 16) / 255, parseInt(value.slice(5, 7), 16) / 255];
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (c: Rgb, k: number): Rgb => [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (t: number) => t * t * (3 - 2 * t);
function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}
/** Stable pseudo-random number for a grid cell. */
const cellHash = (x: number, z: number, salt = 0): number => Math.abs(Math.sin(x * 127.1 + z * 311.7 + salt * 74.7) * 43758.5453) % 1;

const PALETTE = {
  grassLow: hex('#788752'), grassHigh: hex('#a29a69'), meadow: hex('#86985e'), forestFloor: hex('#596c43'),
  dryGrass: hex('#b0a373'), moss: hex('#64774b'),
  dirt: hex('#8c7550'), rock: hex('#8d8e85'), peak: hex('#c9cabf'), sand: hex('#d8c897'), wet: hex('#70694a'),
  concrete: hex('#8d9087'), road: hex('#474b44'),
  crop: [hex('#bda55a'), hex('#6f9440'), hex('#7a5d40')], hedge: hex('#3d5a2e'),
  plaster: [hex('#c1bfae'), hex('#c4b08f'), hex('#a9b5a8'), hex('#cdbd9d'), hex('#b0a99a')],
  roof: [hex('#8a4a3d'), hex('#5e5b52'), hex('#4f6270'), hex('#74503e'), hex('#615c4a')],
  block: [hex('#a9aca4'), hex('#9aa6a9'), hex('#b4ae9f')],
  crate: hex('#927758'), stone: hex('#787f73'), trunk: hex('#6a5443'),
  pine: [hex('#35563f'), hex('#42603f'), hex('#2d4b3a'), hex('#3d5d3b'), hex('#4a6a45')],
  leaf: [hex('#4f7f36'), hex('#5b8a3a'), hex('#45753a'), hex('#66903c'), hex('#7a9440'), hex('#6f9a44')],
  autumn: [hex('#c0702a'), hex('#b8962f'), hex('#a8532a')],
  bush: [hex('#486e35'), hex('#557a38'), hex('#3f6232'), hex('#5f8238')],
  trim: hex('#eae5d6'), door: hex('#5a4030'), shadowStone: hex('#6a6c64'), warmStone: hex('#8a7b66'),
};

/** Batched props with plain, sawn-wood and bark finishes. */
class Geometry {
  positions: number[] = [];
  normals: number[] = [];
  colors: number[] = [];
  indices: number[] = [];
  uvs: number[] = [];
  wood = false;
  bark = false;
  private readonly woodIndices: number[] = [];
  private readonly barkIndices: number[] = [];
  private uvOverride: Map<number[], [number, number]> | null = null;

  /** One triangle with a colour at each corner; winding is corrected so the face points along `outward` (Babylon is left-handed). */
  triC(a: number[], b: number[], c: number[], outward: number[], ca: Rgb, cb: Rgb, cc: Rgb): void {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length; ny /= length; nz /= length;
    const flip = nx * outward[0] + ny * outward[1] + nz * outward[2] < 0;
    const base = this.positions.length / 3;
    const order: Array<[number[], Rgb]> = flip ? [[a, ca], [c, cc], [b, cb]] : [[a, ca], [b, cb], [c, cc]];
    const sign = flip ? -1 : 1;
    for (const [p, color] of order) {
      this.positions.push(p[0], p[1], p[2]);
      this.normals.push(nx * sign, ny * sign, nz * sign);
      this.colors.push(color[0], color[1], color[2], 1);
      const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
      // U follows the horizontal grain on wood; each tile covers two metres.
      const [u, v] = ax >= ay && ax >= az ? [p[2], p[1]] : ay >= az ? [p[0], p[2]] : [p[0], p[1]];
      this.uvs.push(...(this.uvOverride?.get(p) ?? [u / 2, v / 2]));
    }
    (this.bark ? this.barkIndices : this.wood ? this.woodIndices : this.indices).push(base, base + 1, base + 2);
  }

  tri(a: number[], b: number[], c: number[], outward: number[], color: Rgb): void { this.triC(a, b, c, outward, color, color, color); }

  quadC(a: number[], b: number[], c: number[], d: number[], outward: number[], ca: Rgb, cb: Rgb, cc: Rgb, cd: Rgb): void {
    this.triC(a, b, c, outward, ca, cb, cc);
    this.triC(a, c, d, outward, ca, cc, cd);
  }

  quad(a: number[], b: number[], c: number[], d: number[], outward: number[], color: Rgb): void { this.quadC(a, b, c, d, outward, color, color, color, color); }

  /** Axis-aligned box standing on `y0`. Sides darken toward the ground (`ao`), faking the light lost near the base. */
  box(cx: number, y0: number, cz: number, w: number, h: number, d: number, color: Rgb, ao = 0.72): void {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2, y1 = y0 + h;
    this.quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0], shade(color, 1.08));
    const side = (a: number[], b: number[], c: number[], e: number[], out: number[], k: number) => {
      const top = shade(color, k), bottom = shade(color, k * ao);
      this.quadC(a, b, c, e, out, bottom, bottom, top, top);
    };
    side([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], 1);
    side([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], 0.86);
    side([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], 0.94);
    side([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], 0.8);
  }

  /** A tapering, optionally leaning trunk. */
  trunk(cx: number, y0: number, cz: number, r0: number, r1: number, h: number, sides: number, color: Rgb, leanX = 0, leanZ = 0): void {
    const dark = shade(color, 0.7);
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
      const b0 = [cx + Math.cos(a0) * r0, y0, cz + Math.sin(a0) * r0], b1 = [cx + Math.cos(a1) * r0, y0, cz + Math.sin(a1) * r0];
      const t0 = [cx + leanX + Math.cos(a0) * r1, y0 + h, cz + leanZ + Math.sin(a0) * r1], t1 = [cx + leanX + Math.cos(a1) * r1, y0 + h, cz + leanZ + Math.sin(a1) * r1];
      const mid = (a0 + a1) / 2;
      const lit = shade(color, 0.85 + 0.25 * Math.max(0, Math.cos(mid - 0.8)));
      // Cylindrical U unwraps the last face; V follows the branch rather than world axes.
      const wraps = Math.max(1, Math.round(Math.PI * 2 * r0 / 1.5)), length = Math.hypot(h, leanX, leanZ) / 2;
      this.uvOverride = new Map([[b0, [i / sides * wraps, 0]], [b1, [(i + 1) / sides * wraps, 0]],
        [t0, [i / sides * wraps, length]], [t1, [(i + 1) / sides * wraps, length]]]);
      this.quadC(b0, b1, t1, t0, [Math.cos(mid), 0.05, Math.sin(mid)], dark, dark, lit, lit);
      this.uvOverride = null;
    }
  }

  /** A cone with a dark base and a lit tip. */
  cone(cx: number, y0: number, cz: number, radius: number, height: number, sides: number, color: Rgb, twist = 0): void {
    const apex = [cx, y0 + height, cz];
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2 + twist, a1 = ((i + 1) / sides) * Math.PI * 2 + twist;
      const p0 = [cx + Math.cos(a0) * radius, y0, cz + Math.sin(a0) * radius];
      const p1 = [cx + Math.cos(a1) * radius, y0, cz + Math.sin(a1) * radius];
      const mid = (a0 + a1) / 2;
      const lit = shade(color, 0.9 + 0.22 * Math.max(0, Math.cos(mid - 0.8)));
      this.triC(p0, p1, apex, [Math.cos(mid), radius / height, Math.sin(mid)], shade(lit, 0.72), shade(lit, 0.72), shade(lit, 1.08));
    }
  }

  /** A faceted ellipsoid: foliage, bushes and boulders. `jitter` roughens the silhouette. */
  blob(cx: number, y0: number, cz: number, rx: number, ry: number, rz: number, color: Rgb, sides = 6, twist = 0, jitter = 0, seed = 0): void {
    const ring = (y: number, scale: number, offset: number, r: number) => Array.from({ length: sides }, (_, i) => {
      const a = (i / sides) * Math.PI * 2 + offset + twist;
      const wobble = 1 + (cellHash(i * 7 + r * 13, seed * 97, 5) - 0.5) * 2 * jitter;
      const lift = jitter ? (cellHash(i * 3 + r, seed * 53, 9) - 0.5) * jitter * ry * 0.35 : 0;
      return [cx + Math.cos(a) * rx * scale * wobble, y0 + y * ry + lift, cz + Math.sin(a) * rz * scale * wobble];
    });
    const rings = [ring(0.08, 0.42, 0, 0), ring(0.36, 0.92, Math.PI / sides, 1), ring(0.66, 0.9, 0, 2), ring(0.9, 0.5, Math.PI / sides, 3)];
    const top = [cx, y0 + ry * (1 + (jitter ? (cellHash(1, seed * 31, 3) - 0.5) * jitter * 0.4 : 0)), cz];
    const centre = [cx, y0 + ry * 0.5, cz];
    const faceColor = (p: number[], base: Rgb) => shade(base, 0.72 + 0.4 * clamp01((p[1] - y0) / ry));
    const outward = (p: number[]) => [p[0] - centre[0], p[1] - centre[1] + 0.15, p[2] - centre[2]];
    for (let r = 0; r < 3; r++) {
      for (let i = 0; i < sides; i++) {
        const a = rings[r][i], b = rings[r][(i + 1) % sides], c = rings[r + 1][(i + 1) % sides], d = rings[r + 1][i];
        const mid = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2];
        this.quad(a, b, c, d, outward(mid), faceColor(mid, color));
      }
    }
    for (let i = 0; i < sides; i++) {
      const a = rings[3][i], b = rings[3][(i + 1) % sides];
      const mid = [(a[0] + b[0] + top[0]) / 3, (a[1] + b[1] + top[1]) / 3, (a[2] + b[2] + top[2]) / 3];
      this.tri(a, b, top, outward(mid), faceColor(mid, color));
    }
  }

  /** Two-pitch roof: eaves at `y0`, ridge `rise` above, running along the longer side. */
  gable(cx: number, y0: number, cz: number, w: number, d: number, rise: number, color: Rgb): void {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2, ry = y0 + rise;
    const eave = shade(color, 0.84), ridge = shade(color, 1.1);
    if (w >= d) {
      this.quadC([x0, y0, z0], [x1, y0, z0], [x1, ry, cz], [x0, ry, cz], [0, 1, -d / (2 * rise)], eave, eave, ridge, ridge);
      this.quadC([x1, y0, z1], [x0, y0, z1], [x0, ry, cz], [x1, ry, cz], [0, 1, d / (2 * rise)], shade(eave, 0.82), shade(eave, 0.82), shade(ridge, 0.82), shade(ridge, 0.82));
      this.tri([x0, y0, z0], [x0, y0, z1], [x0, ry, cz], [-1, 0, 0], shade(color, 0.7));
      this.tri([x1, y0, z1], [x1, y0, z0], [x1, ry, cz], [1, 0, 0], shade(color, 0.7));
    } else {
      this.quadC([x0, y0, z1], [x0, y0, z0], [cx, ry, z0], [cx, ry, z1], [-w / (2 * rise), 1, 0], shade(eave, 0.82), shade(eave, 0.82), shade(ridge, 0.82), shade(ridge, 0.82));
      this.quadC([x1, y0, z0], [x1, y0, z1], [cx, ry, z1], [cx, ry, z0], [w / (2 * rise), 1, 0], eave, eave, ridge, ridge);
      this.tri([x1, y0, z0], [x0, y0, z0], [cx, ry, z0], [0, 0, -1], shade(color, 0.7));
      this.tri([x0, y0, z1], [x1, y0, z1], [cx, ry, z1], [0, 0, 1], shade(color, 0.7));
    }
  }

  build(name: string, scene: Scene, material: StandardMaterial | MultiMaterial): Mesh | null {
    if (!this.indices.length && !this.woodIndices.length && !this.barkIndices.length) return null;
    const mesh = new Mesh(name, scene);
    const data = new VertexData();
    data.positions = this.positions; data.normals = this.normals; data.colors = this.colors;
    data.uvs = this.uvs; data.indices = [...this.indices, ...this.woodIndices, ...this.barkIndices];
    data.applyToMesh(mesh);
    mesh.material = material;
    if (material instanceof MultiMaterial) {
      mesh.releaseSubMeshes();
      if (this.indices.length) SubMesh.CreateFromIndices(0, 0, this.indices.length, mesh);
      if (this.woodIndices.length) SubMesh.CreateFromIndices(1, this.indices.length, this.woodIndices.length, mesh);
      if (this.barkIndices.length) SubMesh.CreateFromIndices(2, this.indices.length + this.woodIndices.length, this.barkIndices.length, mesh);
    }
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    mesh.doNotSyncBoundingInfo = true;
    return mesh;
  }
}

interface Chunk { terrain: Mesh | null; detail: number; props: Mesh | null; foliage: Mesh | null; facade: Mesh | null; casting?: boolean }
interface Bank { ax: number; az: number; bx: number; bz: number; half: number }

/**
 * Streams the island around a focus point: terrain at three levels of detail, plus props (houses, rocks, crates,
 * trees, bushes) baked per chunk. Everything is generated from the world data, so the simulation and the picture agree.
 */
export class IslandRenderer {
  private readonly chunks = new Map<number, Chunk>();
  private readonly byChunk = new Map<number, Obstacle[]>();
  private readonly fieldsByChunk = new Map<number, Field[]>();
  private readonly banksByChunk = new Map<number, Bank[]>();
  /** 1 = distant silhouette, 2 = full detail. */
  private readonly propLevel = new Map<number, number>();
  private readonly terrainMaterial: StandardMaterial;
  private readonly propMaterial: MultiMaterial;
  private readonly roadMaterial: StandardMaterial;
  private readonly foliageMaterial: StandardMaterial;
  private readonly facadeMaterial: StandardMaterial;
  private readonly decor: IslandDecor;
  private roads: Mesh | null = null;
  private readonly height: (x: number, z: number) => number;
  /** Chunks per side: 32 for the 4 km island, 8 for the 1 km valley. */
  private readonly grid: number;

  constructor(private readonly scene: Scene, private readonly world: WorldConfig, readonly viewChunks = 6, touch = false, private readonly shadows: ShadowGenerator | null = null) {
    this.height = world.terrain ?? (() => 0);
    this.grid = Math.ceil(world.halfSize * 2 / CHUNK);
    const make = (name: string) => {
      const material = new StandardMaterial(name, scene);
      material.diffuseColor = Color3.White();
      material.specularColor = Color3.Black();
      // Skirts and ribbons are one-sided shells; render both faces so winding never hides them.
      material.backFaceCulling = false;
      return material;
    };
    this.terrainMaterial = make('island-terrain');
    this.terrainMaterial.diffuseTexture = groundDetailTexture(scene);
    useGeneratedAlbedo(this.terrainMaterial, GENERATED_TEXTURES.ground, 4, 1.25);
    // Relief lives on the second UV set so it can repeat much tighter than the colour texture.
    const bump = groundBumpTexture(scene);
    bump.coordinatesIndex = 1;
    bump.gammaSpace = false;
    bump.level = 0.22;
    this.terrainMaterial.bumpTexture = bump;
    const plainProps = make('island-props-plain'), woodProps = make('island-props-wood'), barkProps = make('island-props-bark');
    woodProps.specularColor = new Color3(0.10, 0.10, 0.10); woodProps.specularPower = 28;
    useGeneratedAlbedo(woodProps, GENERATED_TEXTURES.wood, 1, 1.12);
    useGeneratedAlbedo(barkProps, GENERATED_TEXTURES.bark);
    this.propMaterial = new MultiMaterial('island-props', scene);
    this.propMaterial.subMaterials = [plainProps, woodProps, barkProps];
    this.roadMaterial = make('island-roads');
    useGeneratedAlbedo(this.roadMaterial, GENERATED_TEXTURES.ground, 0.5, 1.25);
    this.foliageMaterial = createFoliageMaterial(scene);
    this.facadeMaterial = createFacadeMaterial(scene);
    for (const obstacle of world.obstacles) this.bucket(this.byChunk, this.keyAt(obstacle.x, obstacle.z), obstacle);
    for (const field of world.fields ?? []) {
      for (const key of this.keysCovering(field.x - field.w / 2, field.z - field.d / 2, field.x + field.w / 2, field.z + field.d / 2)) this.bucket(this.fieldsByChunk, key, field);
    }
    for (const river of world.water?.rivers ?? []) {
      for (let i = 0; i + 1 < river.points.length; i++) {
        const a = river.points[i], b = river.points[i + 1], half = river.width / 2;
        const bank: Bank = { ax: a.x, az: a.z, bx: b.x, bz: b.z, half };
        for (const key of this.keysCovering(Math.min(a.x, b.x) - half - 8, Math.min(a.z, b.z) - half - 8, Math.max(a.x, b.x) + half + 8, Math.max(a.z, b.z) + half + 8)) this.bucket(this.banksByChunk, key, bank);
      }
    }
    this.buildRoads();
    this.decor = new IslandDecor(scene, world, touch, this.foliageMaterial);
  }

  private bucket<T>(map: Map<number, T[]>, key: number, item: T): void {
    const list = map.get(key);
    if (list) list.push(item); else map.set(key, [item]);
  }

  private chunkIndex(v: number): number {
    return Math.min(this.grid - 1, Math.max(0, Math.floor((v + this.world.halfSize) / CHUNK)));
  }

  private keyAt(x: number, z: number): number { return this.chunkIndex(z) * this.grid + this.chunkIndex(x); }

  private keysCovering(x0: number, z0: number, x1: number, z1: number): number[] {
    const keys: number[] = [];
    for (let cz = this.chunkIndex(z0); cz <= this.chunkIndex(z1); cz++) for (let cx = this.chunkIndex(x0); cx <= this.chunkIndex(x1); cx++) keys.push(cz * this.grid + cx);
    return keys;
  }

  private townWeight(x: number, z: number): number {
    let weight = 0;
    for (const town of this.world.towns) {
      const d = Math.hypot(x - town.x, z - town.z);
      weight = Math.max(weight, 1 - smooth(clamp01((d - town.radius * 0.9) / (town.radius * 0.7))));
    }
    return weight;
  }

  private groundColor(x: number, z: number, h: number, slope: number, key: number, hollow = 0): Rgb {
    const noise = groundNoise(x, z);
    const forest = forestNoise(x, z);
    // Very broad patches: sun-dried grass on some slopes, lush moss in damp hollows.
    const patch = groundNoise(x * 0.22 + 91, z * 0.22 - 37);
    let color = mix(PALETTE.grassLow, PALETTE.grassHigh, clamp01((h - 28) / 75 + (noise - 0.5) * 0.7));
    color = mix(color, PALETTE.meadow, clamp01((noise - 0.45) * 2.2) * 0.55 * (1 - clamp01((h - 60) / 50)));
    color = mix(color, PALETTE.dryGrass, smooth(clamp01((patch - 0.52) * 4)) * 0.6 * (1 - clamp01(hollow * 8)));
    color = mix(color, PALETTE.moss, smooth(clamp01((0.46 - patch) * 4)) * 0.45 + clamp01(hollow * 6) * 0.3);
    color = mix(color, PALETTE.forestFloor, smooth(clamp01((forest - 0.5) * 4)) * 0.7);
    color = mix(color, PALETTE.dirt, clamp01((noise - 0.66) * 3) * 0.6);
    color = mix(color, PALETTE.rock, smooth(clamp01((slope - 0.34) / 0.26)));
    color = mix(color, PALETTE.peak, smooth(clamp01((h - 100) / 40)) * 0.8);
    color = mix(color, PALETTE.concrete, this.townWeight(x, z) * 0.85);
    // Beaches around the sea and shallows on the lake shores.
    color = mix(color, PALETTE.sand, smooth(clamp01((3.8 - h) / 2.4)) * 0.95);
    for (const lake of this.world.water?.lakes ?? []) {
      const d = Math.hypot(x - lake.x, z - lake.z);
      if (d > lake.r * 0.85 && d < lake.r * 1.35) color = mix(color, PALETTE.sand, 0.75 * (1 - smooth(clamp01((d - lake.r * 1.0) / (lake.r * 0.3)))));
    }
    for (const bank of this.banksByChunk.get(key) ?? []) {
      const dx = bank.bx - bank.ax, dz = bank.bz - bank.az;
      const t = clamp01(((x - bank.ax) * dx + (z - bank.az) * dz) / (dx * dx + dz * dz || 1));
      const d = Math.hypot(x - bank.ax - dx * t, z - bank.az - dz * t);
      if (d < bank.half + 5) color = mix(color, PALETTE.wet, 0.85 * (1 - smooth(clamp01((d - bank.half) / 5))));
    }
    for (const field of this.fieldsByChunk.get(key) ?? []) {
      const ex = field.w / 2 - Math.abs(x - field.x), ez = field.d / 2 - Math.abs(z - field.z);
      if (ex < 0 || ez < 0) continue;
      const crop = shade(PALETTE.crop[field.crop], 0.9 + noise * 0.2);
      // A darker hedge row around the edge, as in real farmland.
      color = mix(color, Math.min(ex, ez) < 2.2 ? PALETTE.hedge : crop, 0.92);
    }
    return color;
  }

  /** Curvature occlusion: hollows read darker and crests lighter, which makes the relief legible under flat light. */
  private relief(hollow: number): number { return Math.max(0.74, Math.min(1.16, 1 - hollow * 16)); }

  private buildTerrain(cx: number, cz: number, segments: number): Mesh {
    const origin = { x: -this.world.halfSize + cx * CHUNK, z: -this.world.halfSize + cz * CHUNK };
    const key = cz * this.grid + cx;
    const step = CHUNK / segments;
    const n = segments + 1;
    const stride = n + 2;
    // One extra ring of samples lets normals be computed by central differences without seams.
    const heights = new Float32Array(stride * stride);
    for (let j = 0; j < stride; j++) for (let i = 0; i < stride; i++) heights[j * stride + i] = this.height(origin.x + (i - 1) * step, origin.z + (j - 1) * step);
    const positions: number[] = [], normals: number[] = [], colors: number[] = [], uvs: number[] = [], uvs2: number[] = [], indices: number[] = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const h = heights[(j + 1) * stride + i + 1];
        const dx = (heights[(j + 1) * stride + i + 2] - heights[(j + 1) * stride + i]) / (2 * step);
        const dz = (heights[(j + 2) * stride + i + 1] - heights[j * stride + i + 1]) / (2 * step);
        const length = Math.hypot(dx, 1, dz);
        const x = origin.x + i * step, z = origin.z + j * step;
        // Laplacian of the height field: positive in hollows, negative on crests.
        const hollow = (heights[(j + 1) * stride + i] + heights[(j + 1) * stride + i + 2] + heights[j * stride + i + 1] + heights[(j + 2) * stride + i + 1] - 4 * h) / (step * step);
        const base = this.groundColor(x, z, h, Math.hypot(dx, dz), key, hollow);
        const color = shade(base, this.relief(hollow));
        positions.push(x, h, z);
        normals.push(-dx / length, 1 / length, -dz / length);
        colors.push(color[0], color[1], color[2], 1);
        uvs.push(x / 16, z / 16);
        uvs2.push(x / 2.6, z / 2.6);
      }
    }
    for (let j = 0; j < segments; j++) {
      for (let i = 0; i < segments; i++) {
        const a = j * n + i, b = a + n, c = a + 1, d = b + 1;
        indices.push(a, b, c, c, b, d);
      }
    }
    // Skirts hide cracks where neighbouring chunks use different levels of detail.
    const skirt = 7;
    const edge: number[] = [];
    for (let i = 0; i < n; i++) edge.push(i);
    for (let j = 1; j < n; j++) edge.push(j * n + n - 1);
    for (let i = n - 2; i >= 0; i--) edge.push((n - 1) * n + i);
    for (let j = n - 2; j > 0; j--) edge.push(j * n);
    for (let k = 0; k < edge.length; k++) {
      const a = edge[k], b = edge[(k + 1) % edge.length];
      const base = positions.length / 3;
      for (const vertex of [a, b]) {
        positions.push(positions[vertex * 3], positions[vertex * 3 + 1] - skirt, positions[vertex * 3 + 2]);
        normals.push(normals[vertex * 3], normals[vertex * 3 + 1], normals[vertex * 3 + 2]);
        colors.push(colors[vertex * 4], colors[vertex * 4 + 1], colors[vertex * 4 + 2], 1);
        uvs.push(uvs[vertex * 2], uvs[vertex * 2 + 1]);
        uvs2.push(uvs2[vertex * 2], uvs2[vertex * 2 + 1]);
      }
      indices.push(a, base, b, b, base, base + 1);
    }
    const mesh = new Mesh(`terrain-${cx}-${cz}`, this.scene);
    const data = new VertexData();
    data.positions = positions; data.normals = normals; data.colors = colors; data.uvs = uvs; data.uvs2 = uvs2; data.indices = indices;
    data.applyToMesh(mesh);
    mesh.material = this.terrainMaterial;
    mesh.receiveShadows = true;
    mesh.isPickable = false;
    mesh.metadata = { solid: true };
    mesh.freezeWorldMatrix();
    mesh.doNotSyncBoundingInfo = true;
    return mesh;
  }

  private lakeNear(x: number, z: number, margin: number): boolean {
    return (this.world.water?.lakes ?? []).some(l => Math.hypot(x - l.x, z - l.z) < l.r * 1.2 + margin);
  }

  /** Non-colliding scenery: bushes that thicken the undergrowth. They conceal but never stop a bullet. */
  private scatterBushes(cx: number, cz: number, cards: CardBatch, key: number): void {
    const x0 = -this.world.halfSize + cx * CHUNK, z0 = -this.world.halfSize + cz * CHUNK;
    const spacing = 9;
    const blocked = this.byChunk.get(key) ?? [];
    for (let gx = 0; gx < CHUNK / spacing; gx++) {
      for (let gz = 0; gz < CHUNK / spacing; gz++) {
        const hx = cellHash(cx * 64 + gx, cz * 64 + gz, 1), hz = cellHash(cx * 64 + gx, cz * 64 + gz, 2), hs = cellHash(cx * 64 + gx, cz * 64 + gz, 3);
        const x = x0 + (gx + hx) * spacing, z = z0 + (gz + hz) * spacing;
        const forest = forestNoise(x, z), noise = groundNoise(x, z);
        if (hs > 0.2 + forest * 0.5 + noise * 0.1) continue;
        const y = this.height(x, z);
        if (y < 3 || this.townWeight(x, z) > 0.2 || this.lakeNear(x, z, 4)) continue;
        if (blocked.some(o => Math.abs(x - o.x) < o.width / 2 + 1.5 && Math.abs(z - o.z) < o.depth / 2 + 1.5)) continue;
        const r = 0.6 + hs * 1.1, v = 0.82 + hx * 0.14;
        // A bush is a handful of leaf cards leaning outward from a low centre.
        for (let k = 0; k < 4; k++) {
          const a = hz * 6 + k * 2.39996;
          cards.card(x + Math.cos(a) * r * 0.35, y + r * (0.55 + (k % 2) * 0.18), z + Math.sin(a) * r * 0.35,
            a, 0.3 + (k % 2) * 0.5, r * 1.55, r * 1.4, ATLAS.leaves, [v * 0.97, v, v * 0.95], 0.75);
        }
      }
    }
  }

  private pine(g: Geometry, cards: CardBatch, x: number, base: number, z: number, h: number, seed: number): void {
    const lean = (seed - 0.5) * h * 0.07;
    g.trunk(x, base, z, 0.34, 0.06, h * 0.9, 7, [0.86, 0.83, 0.78], lean * 0.4, lean * 0.4);
    const v = 0.85 + cellHash(seed * 91, 3, 7) * 0.12;
    const cx = x + lean * 0.4, cz = z + lean * 0.4;
    // Separate bough tiers taper upwards; no repeated full-tree images in the near crown.
    for (let tier = 0; tier < 4; tier++) {
      const width = h * (0.64 - tier * 0.145), cy = base + h * (0.34 + tier * 0.17);
      for (let k = 0; k < 3; k++) {
        const a = seed * 6 + k * Math.PI * 2 / 3 + tier * 0.57;
        cards.card(cx + Math.cos(a) * width * 0.17, cy, cz + Math.sin(a) * width * 0.17,
          a, 0.55 + tier * 0.12, width, width * 0.68, ATLAS.needles, [v * 0.97, v, v * 0.96], 0.78);
      }
    }
  }

  private broadleaf(g: Geometry, cards: CardBatch, x: number, base: number, z: number, h: number, seed: number): void {
    const lean = (seed - 0.5) * h * 0.1;
    g.trunk(x, base, z, 0.42, 0.13, h * 0.69, 8, [0.88, 0.85, 0.8], lean, lean * 0.6);
    const r = h * 0.38, cx = x + lean, cz = z + lean * 0.6;
    const autumn = seed > 0.94;
    const v = 0.86 + cellHash(seed * 57, 11, 3) * 0.12;
    const tint: Rgb = autumn ? [v, v * 0.84, v * 0.67] : [v * 0.98, v, v * 0.95];
    for (let k = 0; k < 3; k++) {
      const a = seed * 6 + k * Math.PI * 2 / 3;
      g.trunk(x + lean * 0.6, base + h * 0.36, z + lean * 0.36, 0.16, 0.04, h * (0.24 + k * 0.035), 5,
        [0.86, 0.83, 0.78], Math.cos(a) * h * 0.2, Math.sin(a) * h * 0.2);
    }
    // Smaller leaf-bearing branches spread over three crown levels.
    for (let k = 0; k < 12; k++) {
      const hk = (salt: number) => cellHash(seed * 131 + k * 17, salt, 5);
      const layer = Math.floor(k / 4), angle = k * 2.39996 + seed * 6 + hk(1) * 0.4;
      const spread = r * (0.38 + hk(2) * 0.46) * (layer === 2 ? 0.65 : 1);
      const size = r * (0.9 + hk(3) * 0.45), cy = base + h * (0.53 + layer * 0.15) + (hk(5) - 0.5) * r * 0.18;
      const shadeK = 0.88 + hk(4) * 0.1;
      cards.card(cx + Math.cos(angle) * spread, cy, cz + Math.sin(angle) * spread, angle + hk(6) * 0.8,
        (hk(7) - 0.5) * 1.4, size, size * 0.85, ATLAS.leaves, shade(tint, shadeK), 0.77);
    }
  }

  private boulder(g: Geometry, o: Obstacle, bottom: number, height: number, seed: number): void {
    const tint = mix(PALETTE.stone, PALETTE.warmStone, seed * 0.5), w = o.width, d = o.depth;
    g.blob(o.x, bottom, o.z, w * 0.6, height * 1.05, d * 0.6, shade(tint, 0.9), 7, seed * 6, 0.2, seed);
    g.blob(o.x + w * 0.22, bottom, o.z - d * 0.16, w * 0.4, height * 0.72, d * 0.38, tint, 6, seed * 3, 0.24, seed + 0.3);
    g.blob(o.x - w * 0.24, bottom, o.z + d * 0.2, w * 0.32, height * 0.52, d * 0.32, shade(tint, 1.1), 6, seed * 5, 0.24, seed + 0.6);
  }

  /** A tall solid block: concrete shell, a window on every bay of every floor, a parapet and rooftop units. */
  private block(g: Geometry, panels: CardBatch, o: Obstacle, bottom: number, height: number, seed: number): void {
    const color = PALETTE.block[Math.floor(seed * 3)];
    g.box(o.x, bottom, o.z, o.width, height, o.depth, shade(color, 0.92), 0.8);
    const top = bottom + height, w = o.width, d = o.depth;
    const parapet = shade(color, 0.78);
    g.box(o.x, top, o.z - d / 2 + 0.2, w, 0.7, 0.4, parapet, 1);
    g.box(o.x, top, o.z + d / 2 - 0.2, w, 0.7, 0.4, parapet, 1);
    g.box(o.x - w / 2 + 0.2, top, o.z, 0.4, 0.7, d, parapet, 1);
    g.box(o.x + w / 2 - 0.2, top, o.z, 0.4, 0.7, d, parapet, 1);
    g.box(o.x + (seed - 0.5) * w * 0.4, top, o.z + (seed * 7 % 1 - 0.5) * d * 0.4, 2.4, 1.5, 2.0, hex('#8d9189'), 0.8);
    if (seed > 0.45) g.box(o.x - w * 0.22, top, o.z - d * 0.18, 1.2, 1.0, 1.2, hex('#a09a8e'), 0.8);
    const floors = Math.max(2, Math.round(height / 3.2)), floorHeight = height / floors;
    const tint: [number, number, number] = [shade(color, 1.02)[0] * 1.05, shade(color, 1.02)[1] * 1.05, shade(color, 1.02)[2] * 1.05];
    const face = (x0: number, z0: number, x1: number, z1: number, nx: number, nz: number) => {
      const length = Math.hypot(x1 - x0, z1 - z0), bays = Math.max(2, Math.round(length / 3.6));
      for (let b = 0; b < bays; b++) {
        const t0 = b / bays, t1 = (b + 1) / bays;
        for (let f = 0; f < floors; f++) {
          panels.panel(x0 + (x1 - x0) * t0 + nx * 0.04, z0 + (z1 - z0) * t0 + nz * 0.04, x0 + (x1 - x0) * t1 + nx * 0.04, z0 + (z1 - z0) * t1 + nz * 0.04, bottom + f * floorHeight, bottom + (f + 1) * floorHeight, nx, nz, tint, 0.9);
        }
      }
    };
    face(o.x - w / 2, o.z - d / 2 - 0, o.x + w / 2, o.z - d / 2, 0, -1);
    face(o.x + w / 2, o.z + d / 2, o.x - w / 2, o.z + d / 2, 0, 1);
    face(o.x - w / 2, o.z + d / 2, o.x - w / 2, o.z - d / 2, -1, 0);
    face(o.x + w / 2, o.z - d / 2, o.x + w / 2, o.z + d / 2, 1, 0);
  }

  /** Door and window trim, derived from the wall pieces that frame each opening. */
  private trim(g: Geometry, o: Obstacle, bottom: number): void {
    g.wood = true;
    const alongX = o.width >= o.depth;
    const length = alongX ? o.width : o.depth, thick = (alongX ? o.depth : o.width) + 0.12;
    const frame = (offset: number, y: number, h: number, w: number, color: Rgb, t = thick) => {
      if (alongX) g.box(o.x + offset, y, o.z, w, h, t, color, 1); else g.box(o.x, y, o.z + offset, t, h, w, color, 1);
    };
    const id = o.id;
    if (o.bottom !== undefined && Math.abs(o.bottom - DOOR_HEIGHT) < 0.01 && id.includes('-h')) {
      // Door: two posts and a lintel board.
      const base = bottom - DOOR_HEIGHT;
      frame(-length / 2, base, DOOR_HEIGHT, 0.2, PALETTE.door, thick + 0.1);
      frame(length / 2, base, DOOR_HEIGHT, 0.2, PALETTE.door, thick + 0.1);
      frame(0, bottom - 0.14, 0.2, length + 0.3, PALETTE.door, thick + 0.1);
    } else if (o.bottom !== undefined && Math.abs(o.bottom - 2.15) < 0.01) {
      // Window head.
      frame(0, bottom - 0.1, 0.14, length + 0.3, PALETTE.trim, thick + 0.1);
    } else if (!o.bottom && Math.abs(o.height - 1.0 - (o.base ?? 0) + (o.base ?? 0)) < 0.01 && id.includes('-l')) {
      // Window sill and jambs.
      frame(0, bottom + 1.0, 0.1, length + 0.3, PALETTE.trim, thick + 0.28);
      frame(-length / 2, bottom + 1.0, 1.15, 0.12, PALETTE.trim, thick + 0.08);
      frame(length / 2, bottom + 1.0, 1.15, 0.12, PALETTE.trim, thick + 0.08);
    }
  }

  /** `far` builds a cheap silhouette (house boxes and one-piece trees) for chunks at the edge of view. */
  private buildProps(cx: number, cz: number, far = false): { props: Mesh | null; foliage: Mesh | null; facade: Mesh | null } {
    const geometry = new Geometry();
    const cards = new CardBatch();
    const panels = new CardBatch();
    const key = cz * this.grid + cx;
    for (const obstacle of this.byChunk.get(key) ?? []) {
      geometry.wood = obstacle.kind === 'crate';
      geometry.bark = obstacle.kind === 'tree';
      const base = obstacleBase(obstacle);
      const bottom = base + (obstacle.bottom ?? 0);
      const height = base + obstacle.height - bottom;
      const seed = hashString(obstacle.id.replace(/-(?:[nsew]-[a-z]\d?|roof|crate)$/, ''));
      if (far) {
        if (obstacle.kind === 'tree') {
          // Distant trees are just two crossed cards.
          const v = 0.86 + cellHash(seed * 91, 3, 7) * 0.12;
          if (seed < 0.38) {
            geometry.trunk(obstacle.x, bottom, obstacle.z, 0.35, 0.12, height * 0.6, 5, [0.86, 0.83, 0.78]);
            for (let k = 0; k < 2; k++) cards.card(obstacle.x, bottom + height * 0.68, obstacle.z, k * Math.PI / 2 + seed,
              0, height * 0.76, height * 0.6, ATLAS.leaves, [v * 0.98, v, v * 0.95], 0.77);
          } else for (let k = 0; k < 2; k++) cards.card(obstacle.x, bottom + height * 0.5, obstacle.z, k * Math.PI / 2 + seed * 3,
            0, height * 0.9, height, ATLAS.conifer, [v * 0.98, v, v * 0.96], 0.85);
        } else if (obstacle.kind === 'roof') {
          const rise = Math.max(0.9, Math.min(obstacle.width, obstacle.depth) * 0.3);
          geometry.box(obstacle.x, base, obstacle.z, obstacle.width - 0.6, HOUSE_HEIGHT, obstacle.depth - 0.6, PALETTE.plaster[Math.floor(seed * 5)], 0.85);
          geometry.gable(obstacle.x, bottom, obstacle.z, obstacle.width, obstacle.depth, rise, PALETTE.roof[Math.floor(seed * 5)]);
        } else if (obstacle.kind === 'building') geometry.box(obstacle.x, bottom, obstacle.z, obstacle.width, height, obstacle.depth, PALETTE.block[Math.floor(seed * 3)]);
        continue;
      }
      switch (obstacle.kind) {
        case 'wall':
          geometry.box(obstacle.x, bottom, obstacle.z, obstacle.width, height, obstacle.depth, shade(PALETTE.plaster[Math.floor(seed * 5)], 0.96 + cellHash(obstacle.x, obstacle.z) * 0.08), obstacle.bottom ? 0.9 : 0.68);
          this.trim(geometry, obstacle, bottom);
          break;
        case 'roof': {
          const color = PALETTE.roof[Math.floor(seed * 5)];
          const rise = Math.max(0.9, Math.min(obstacle.width, obstacle.depth) * 0.3);
          geometry.gable(obstacle.x, bottom, obstacle.z, obstacle.width, obstacle.depth, rise, color);
          // A slim ridge cap, and on some houses a chimney.
          if (obstacle.width >= obstacle.depth) geometry.box(obstacle.x, bottom + rise - 0.05, obstacle.z, obstacle.width, 0.16, 0.34, shade(color, 0.7), 1);
          else geometry.box(obstacle.x, bottom + rise - 0.05, obstacle.z, 0.34, 0.16, obstacle.depth, shade(color, 0.7), 1);
          if (seed > 0.55) geometry.box(obstacle.x + (seed - 0.55) * obstacle.width * 0.6, bottom + rise * 0.45, obstacle.z, 0.7, rise * 0.9 + 0.6, 0.7, hex('#76706a'), 0.85);
          break;
        }
        case 'building': this.block(geometry, panels, obstacle, bottom, height, seed); break;
        case 'crate': geometry.box(obstacle.x, bottom, obstacle.z, obstacle.width, height, obstacle.depth, shade(PALETTE.crate, 0.9 + seed * 0.2), 0.7); break;
        case 'rock': this.boulder(geometry, obstacle, bottom, height, seed); break;
        case 'tree':
          if (seed < 0.38) this.broadleaf(geometry, cards, obstacle.x, bottom, obstacle.z, height, seed);
          else this.pine(geometry, cards, obstacle.x, bottom, obstacle.z, height, seed);
          break;
        default: geometry.box(obstacle.x, bottom, obstacle.z, obstacle.width, height, obstacle.depth, PALETTE.stone);
      }
    }
    if (!far) this.scatterBushes(cx, cz, cards, key);
    const mesh = geometry.build(`props-${cx}-${cz}`, this.scene, this.propMaterial);
    if (mesh) { mesh.metadata = { solid: true }; mesh.receiveShadows = true; }
    const foliage = cards.build(`foliage-${cx}-${cz}`, this.scene, this.foliageMaterial);
    if (foliage) foliage.receiveShadows = true;
    const facade = panels.build(`facade-${cx}-${cz}`, this.scene, this.facadeMaterial);
    if (facade) facade.receiveShadows = true;
    return { props: mesh, foliage, facade };
  }

  /** Roads draped over the terrain: asphalt with dusty shoulders and a dashed centre line, one mesh for the island. */
  private buildRoads(): void {
    const geometry = new Geometry();
    const asphalt = PALETTE.road, shoulder = mix(PALETTE.road, PALETTE.dirt, 0.55), verge = mix(PALETTE.dirt, PALETTE.grassLow, 0.45);
    for (const road of this.world.roads) {
      const dx = road.b.x - road.a.x, dz = road.b.z - road.a.z;
      const length = Math.hypot(dx, dz);
      if (length < 1) continue;
      const nx = -dz / length, nz = dx / length, half = road.width / 2;
      const steps = Math.max(1, Math.ceil(length / 7));
      const lateral = (x: number, z: number, offset: number, lift: number) => {
        const px = x + nx * offset, pz = z + nz * offset;
        return [px, this.height(px, pz) + lift, pz];
      };
      let previous: number[][] | null = null;
      for (let s = 0; s <= steps; s++) {
        const x = road.a.x + dx * s / steps, z = road.a.z + dz * s / steps;
        const row = [lateral(x, z, -half - 1.8, 0.07), lateral(x, z, -half, 0.1), lateral(x, z, half, 0.1), lateral(x, z, half + 1.8, 0.07)];
        if (previous) {
          const shade2 = s % 2 ? 1 : 1.05;
          geometry.quadC(previous[0], row[0], row[1], previous[1], [0, 1, 0], verge, verge, shoulder, shoulder);
          geometry.quad(previous[1], row[1], row[2], previous[2], [0, 1, 0], shade(asphalt, shade2));
          geometry.quadC(previous[2], row[2], row[3], previous[3], [0, 1, 0], shoulder, shoulder, verge, verge);
          if (s % 2 === 0) {
            // Dashed centre line: a short, slightly raised strip on every other segment.
            const a = lateral(x - dx / steps * 0.9, z - dz / steps * 0.9, 0, 0.13), b = lateral(x, z, 0, 0.13);
            const ax = nx * 0.12, az = nz * 0.12;
            geometry.quad([a[0] - ax, a[1], a[2] - az], [b[0] - ax, b[1], b[2] - az], [b[0] + ax, b[1], b[2] + az], [a[0] + ax, a[1], a[2] + az], [0, 1, 0], hex('#cfcab0'));
          }
        }
        previous = row;
      }
    }
    this.roads = geometry.build('island-roads', this.scene, this.roadMaterial);
    if (this.roads) this.roads.receiveShadows = true;
  }

  private dropProps(chunk: Chunk): void {
    for (const mesh of [chunk.props, chunk.foliage, chunk.facade]) {
      if (!mesh) continue;
      if (chunk.casting) this.shadows?.removeShadowCaster(mesh);
      mesh.dispose();
    }
    chunk.props = null;
    chunk.foliage = null;
    chunk.facade = null;
    chunk.casting = false;
  }

  private detailFor(ring: number): number { return ring <= 1 ? 64 : ring <= 2 ? 32 : ring <= 4 ? 16 : 8; }

  /**
   * Bring the chunk set in line with the focus. Pass a large `budget` to build everything at once (match start);
   * during play a small budget spreads the work over frames.
   */
  /** Switch the sky for a view from high above the island (the parachute drop). */
  setHighView(high: boolean): void { this.decor.setHighView(high); }

  update(x: number, z: number, budget = 3, dt = 0): void {
    this.decor.update(dt, x, z);
    const ccx = Math.floor((x + this.world.halfSize) / CHUNK), ccz = Math.floor((z + this.world.halfSize) / CHUNK);
    const wanted: Array<{ cx: number; cz: number; ring: number }> = [];
    for (let dz = -this.viewChunks; dz <= this.viewChunks; dz++) {
      for (let dx = -this.viewChunks; dx <= this.viewChunks; dx++) {
        const cx = ccx + dx, cz = ccz + dz;
        if (cx < 0 || cz < 0 || cx >= this.grid || cz >= this.grid) continue;
        wanted.push({ cx, cz, ring: Math.max(Math.abs(dx), Math.abs(dz)) });
      }
    }
    wanted.sort((a, b) => a.ring - b.ring);
    let built = 0;
    const keep = new Set<number>();
    for (const { cx, cz, ring } of wanted) {
      const key = cz * this.grid + cx;
      keep.add(key);
      let chunk = this.chunks.get(key);
      if (!chunk) { chunk = { terrain: null, detail: 0, props: null, foliage: null, facade: null }; this.chunks.set(key, chunk); }
      const detail = this.detailFor(ring);
      if (chunk.detail !== detail && built < budget) {
        chunk.terrain?.dispose();
        chunk.terrain = this.buildTerrain(cx, cz, detail);
        chunk.terrain.isPickable = ring <= 3;
        chunk.detail = detail;
        built++;
      }
      const level = ring <= 4 ? 2 : 1;
      if (chunk.detail && this.propLevel.get(key) !== level && built < budget + 2) {
        this.dropProps(chunk);
        const built2 = this.buildProps(cx, cz, level === 1);
        chunk.props = built2.props;
        chunk.foliage = built2.foliage;
        chunk.facade = built2.facade;
        this.propLevel.set(key, level);
        built++;
      }
      if (chunk.props || chunk.foliage) {
        if (chunk.props) chunk.props.isPickable = ring <= 2;
        const casting = ring <= 1;
        if (casting !== chunk.casting) {
          for (const mesh of [chunk.props, chunk.foliage]) {
            if (!mesh) continue;
            if (casting) this.shadows?.addShadowCaster(mesh); else this.shadows?.removeShadowCaster(mesh);
          }
          chunk.casting = casting;
        }
      }
    }
    for (const [key, chunk] of this.chunks) {
      if (keep.has(key)) continue;
      this.dropProps(chunk);
      chunk.terrain?.dispose();
      this.chunks.delete(key); this.propLevel.delete(key);
    }
  }

  dispose(): void {
    for (const chunk of this.chunks.values()) {
      this.dropProps(chunk);
      chunk.terrain?.dispose();
    }
    this.chunks.clear();
    this.propLevel.clear();
    this.roads?.dispose();
    this.decor.dispose();
    this.terrainMaterial.diffuseTexture?.dispose();
    this.terrainMaterial.bumpTexture?.dispose();
    this.terrainMaterial.dispose();
    this.propMaterial.dispose(false, true, true);
    this.roadMaterial.dispose(false, true);
    this.foliageMaterial.diffuseTexture?.dispose();
    this.foliageMaterial.dispose();
    this.facadeMaterial.diffuseTexture?.dispose();
    this.facadeMaterial.dispose();
  }
}
