import type { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { GENERATED_TEXTURES, useGeneratedAlbedo } from './generated-textures';

/**
 * Foliage is drawn as alpha-tested cards carrying painted textures (conifer boughs, leaf clusters, grass blades),
 * the way most real-time games do it: far more natural than faceted solids, and cheaper to render.
 * ImageGen cutouts share one atlas and material; the painted atlas remains a loading fallback.
 */
export type UvRect = { u0: number; v0: number; u1: number; v1: number };

/** Four atlas quadrants with a gutter (v runs bottom to top). */
export const ATLAS = {
  conifer: { u0: 0.01, v0: 0.51, u1: 0.49, v1: 0.99 } as UvRect,
  needles: { u0: 0.01, v0: 0.01, u1: 0.49, v1: 0.49 } as UvRect,
  leaves: { u0: 0.51, v0: 0.51, u1: 0.99, v1: 0.99 } as UvRect,
  grass: { u0: 0.51, v0: 0.01, u1: 0.99, v1: 0.49 } as UvRect,
};

function random(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
const rgb = (r: number, g: number, b: number, a = 1) => `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;

/** A conifer: layered, drooping boughs of needle sprays inside a ragged triangular silhouette. */
function paintConifer(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number): void {
  const rand = random(7);
  const cx = x0 + w / 2;
  const tiers = 9;
  // Dark undercoat so the silhouette reads as solid when the needles overlap.
  for (let i = 0; i < 520; i++) {
    const y = rand() * h * 0.96 + h * 0.02;
    const half = (y / h) * w * 0.42 + 4;
    const x = cx + (rand() - 0.5) * 2 * half * 0.8;
    ctx.fillStyle = rgb(24, 46, 30);
    ctx.beginPath(); ctx.ellipse(x, y0 + y, 9 + rand() * 7, 5 + rand() * 4, 0, 0, Math.PI * 2); ctx.fill();
  }
  for (let i = 0; i < 2600; i++) {
    const y = Math.pow(rand(), 0.85) * h * 0.97 + h * 0.015;
    const tierPhase = (y / h) * tiers;
    const inTier = tierPhase - Math.floor(tierPhase);          // 0 at the top of a bough layer, 1 at its drooping tip
    const half = ((Math.floor(tierPhase) + 1) / tiers) * w * 0.47 + 5;
    const reach = 1 - Math.pow(rand(), 1.8) * 0.9;
    const side = rand() < 0.5 ? -1 : 1;
    const x = cx + side * half * reach * (0.25 + inTier * 0.75);
    const py = y0 + y + inTier * 8;
    const light = 0.62 + (1 - inTier) * 0.32 + (rand() - 0.5) * 0.18 + (1 - reach) * 0.1;
    const length = 9 + rand() * 11;
    const angle = Math.PI / 2 + side * (0.5 + rand() * 0.7);
    ctx.strokeStyle = rgb(38 * light + 14, 84 * light + 20, 50 * light + 10, 0.95);
    ctx.lineWidth = 1.2 + rand() * 1.1;
    ctx.lineCap = 'round';
    // A needle fan: a few short strokes spreading from one point.
    for (let n = -2; n <= 2; n++) {
      ctx.beginPath();
      ctx.moveTo(x, py);
      ctx.lineTo(x + Math.cos(angle + n * 0.32) * length, py + Math.sin(angle + n * 0.32) * length * 0.8);
      ctx.stroke();
    }
  }
}

/** A cluster of broad leaves: dense in the middle, ragged and sunlit toward the top and edges. */
function paintLeaves(ctx: CanvasRenderingContext2D, x0: number, y0: number, size: number): void {
  const rand = random(19);
  const cx = x0 + size / 2, cy = y0 + size / 2, radius = size * 0.46;
  ctx.fillStyle = rgb(30, 58, 28);
  for (let i = 0; i < 90; i++) {
    const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * radius * 0.82;
    ctx.beginPath(); ctx.ellipse(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 16 + rand() * 12, 11 + rand() * 8, rand() * Math.PI, 0, Math.PI * 2); ctx.fill();
  }
  for (let i = 0; i < 1500; i++) {
    const a = rand() * Math.PI * 2, r = Math.pow(rand(), 0.55) * radius;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.92;
    const lit = clamp((cy - y) / radius * 0.5 + 0.5 + (rand() - 0.5) * 0.3, 0, 1);
    const hue = rand();
    ctx.fillStyle = rgb(48 + lit * 70 + hue * 16, 92 + lit * 82 + hue * 10, 34 + lit * 26, 0.97);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rand() * Math.PI * 2);
    ctx.beginPath(); ctx.ellipse(0, 0, 7 + rand() * 6, 3.6 + rand() * 2.6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

/** A tuft of grass blades: thin, curved, dark at the root and pale at the tip. */
function paintGrass(ctx: CanvasRenderingContext2D, x0: number, y0: number, size: number): void {
  const rand = random(31);
  for (let i = 0; i < 70; i++) {
    const rootX = x0 + 18 + rand() * (size - 36), rootY = y0 + size - 2;
    const height = size * (0.38 + rand() * 0.55);
    const lean = (rand() - 0.5) * size * 0.4;
    const width = 3.2 + rand() * 4.8;
    const tipX = rootX + lean, tipY = rootY - height;
    const bendX = rootX + lean * 0.25 + (rand() - 0.5) * 8, bendY = rootY - height * 0.55;
    const gradient = ctx.createLinearGradient(rootX, rootY, tipX, tipY);
    const warm = rand();
    gradient.addColorStop(0, rgb(40 + warm * 14, 66 + warm * 10, 28));
    gradient.addColorStop(0.55, rgb(92 + warm * 30, 138 + warm * 14, 52));
    gradient.addColorStop(1, rgb(176 + warm * 30, 196 + warm * 12, 96));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(rootX - width / 2, rootY);
    ctx.quadraticCurveTo(bendX - width * 0.35, bendY, tipX, tipY);
    ctx.quadraticCurveTo(bendX + width * 0.45, bendY, rootX + width / 2, rootY);
    ctx.closePath();
    ctx.fill();
  }
}

const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));

/** Build the shared foliage material. Pass the result to every card mesh. */
export function createFoliageMaterial(scene: Scene): StandardMaterial {
  const texture = new DynamicTexture('foliage-atlas', { width: 512, height: 512 }, scene, true);
  const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 512, 512);
  paintConifer(ctx, 0, 0, 256, 256);
  paintConifer(ctx, 0, 256, 256, 256);
  paintLeaves(ctx, 256, 0, 256);
  paintGrass(ctx, 256, 256, 256);
  texture.update(true);
  texture.hasAlpha = true;
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  texture.anisotropicFilteringLevel = 4;
  const material = new StandardMaterial('island-foliage', scene);
  material.diffuseTexture = texture;
  material.diffuseColor = Color3.White();
  material.specularColor = Color3.Black();
  material.useAlphaFromDiffuseTexture = true;
  material.alphaCutOff = 0.36;
  material.transparencyMode = StandardMaterial.MATERIAL_ALPHATEST;
  material.backFaceCulling = false;
  // Upward-biased canopy normals shade both sides alike; flipping them makes thin grass backs pitch black.
  material.twoSidedLighting = false;
  const generated = useGeneratedAlbedo(material, GENERATED_TEXTURES.foliage);
  generated.hasAlpha = true;
  generated.wrapU = generated.wrapV = Texture.CLAMP_ADDRESSMODE;
  return material;
}

/** One window bay of an apartment or warehouse facade: concrete, a framed window, a little grime near the base. */
export function createFacadeMaterial(scene: Scene): StandardMaterial {
  const size = 256;
  const texture = new DynamicTexture('facade', { width: size, height: size }, scene, true);
  const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
  const rand = random(53);
  ctx.fillStyle = rgb(206, 204, 196);
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 900; i++) {
    const v = 190 + rand() * 40;
    ctx.fillStyle = rgb(v, v - 2, v - 8, 0.45);
    ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 5, 1 + rand() * 3);
  }
  // Floor slab line and window.
  ctx.fillStyle = rgb(168, 166, 158); ctx.fillRect(0, size - 22, size, 22);
  ctx.fillStyle = rgb(120, 118, 112); ctx.fillRect(0, size - 22, size, 3);
  const wx = 62, wy = 50, ww = 132, wh = 128;
  ctx.fillStyle = rgb(236, 232, 220); ctx.fillRect(wx - 10, wy - 10, ww + 20, wh + 20);
  const glass = ctx.createLinearGradient(wx, wy, wx + ww, wy + wh);
  glass.addColorStop(0, rgb(112, 138, 156)); glass.addColorStop(0.45, rgb(52, 70, 86)); glass.addColorStop(1, rgb(34, 46, 58));
  ctx.fillStyle = glass; ctx.fillRect(wx, wy, ww, wh);
  ctx.fillStyle = rgb(236, 232, 220); ctx.fillRect(wx + ww / 2 - 3, wy, 6, wh); ctx.fillRect(wx, wy + wh * 0.42, ww, 5);
  ctx.fillStyle = rgb(255, 255, 255, 0.16); ctx.beginPath(); ctx.moveTo(wx + 8, wy + wh - 6); ctx.lineTo(wx + 52, wy + 6); ctx.lineTo(wx + 82, wy + 6); ctx.lineTo(wx + 38, wy + wh - 6); ctx.fill();
  ctx.fillStyle = rgb(150, 148, 140); ctx.fillRect(wx - 14, wy + wh + 8, ww + 28, 9);
  const grime = ctx.createLinearGradient(0, size * 0.6, 0, size);
  grime.addColorStop(0, rgb(70, 66, 56, 0)); grime.addColorStop(1, rgb(70, 66, 56, 0.28));
  ctx.fillStyle = grime; ctx.fillRect(0, size * 0.6, size, size * 0.4);
  texture.update(true);
  texture.anisotropicFilteringLevel = 4;
  const material = new StandardMaterial('island-facade', scene);
  material.diffuseTexture = texture;
  material.diffuseColor = Color3.White();
  material.specularColor = Color3.Black();
  material.backFaceCulling = false;
  return material;
}

/** Accumulates textured cards (flat quads) into one mesh; colour per corner gives each a dark base and a lit top. */
export class CardBatch {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly colors: number[] = [];
  private readonly uvs: number[] = [];
  private readonly indices: number[] = [];

  get count(): number { return this.indices.length / 6; }

  /**
   * A card centred on (cx, cy, cz), \`width\` wide and \`height\` tall, turned by \`yaw\` about the vertical and leaned
   * back by \`tilt\` (radians). Lighting normals lean upward so a card is lit like foliage rather than like a wall.
   */
  card(cx: number, cy: number, cz: number, yaw: number, tilt: number, width: number, height: number, uv: UvRect, tint: [number, number, number], base = 0.62): void {
    const rx = Math.cos(yaw) * width / 2, rz = Math.sin(yaw) * width / 2;
    const fx = -Math.sin(yaw), fz = Math.cos(yaw);
    const ux = fx * Math.sin(tilt) * height / 2, uy = Math.cos(tilt) * height / 2, uz = fz * Math.sin(tilt) * height / 2;
    const corners: Array<[number, number, number, number, number]> = [
      [cx - rx - ux, cy - uy, cz - rz - uz, uv.u0, uv.v0],
      [cx + rx - ux, cy - uy, cz + rz - uz, uv.u1, uv.v0],
      [cx + rx + ux, cy + uy, cz + rz + uz, uv.u1, uv.v1],
      [cx - rx + ux, cy + uy, cz - rz + uz, uv.u0, uv.v1],
    ];
    const start = this.positions.length / 3;
    corners.forEach(([x, y, z, u, v], index) => {
      this.positions.push(x, y, z);
      const outwardX = fx * Math.cos(tilt) * 0.65, outwardZ = fz * Math.cos(tilt) * 0.65;
      const up = 0.55 - Math.sin(tilt) * 0.2;
      const length = Math.hypot(outwardX, up, outwardZ);
      this.normals.push(outwardX / length, up / length, outwardZ / length);
      const k = index < 2 ? base : 1;
      this.colors.push(Math.min(1, tint[0] * k), Math.min(1, tint[1] * k), Math.min(1, tint[2] * k), 1);
      this.uvs.push(u, v);
    });
    this.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }

  /** A vertical rectangle from (x0, z0) to (x1, z1) between heights `y0` and `y1`, facing along the horizontal normal (nx, nz). */
  panel(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, nx: number, nz: number, tint: [number, number, number], shadeBottom = 0.85): void {
    const start = this.positions.length / 3;
    const corners: Array<[number, number, number, number, number]> = [[x0, y0, z0, 0, 0], [x1, y0, z1, 1, 0], [x1, y1, z1, 1, 1], [x0, y1, z0, 0, 1]];
    corners.forEach(([x, y, z, u, v], index) => {
      this.positions.push(x, y, z);
      this.normals.push(nx, 0, nz);
      const k = index < 2 ? shadeBottom : 1;
      this.colors.push(tint[0] * k, tint[1] * k, tint[2] * k, 1);
      this.uvs.push(u, v);
    });
    this.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }

  build(name: string, scene: Scene, material: StandardMaterial): Mesh | null {
    if (!this.indices.length) return null;
    const mesh = new Mesh(name, scene);
    const data = new VertexData();
    data.positions = this.positions; data.normals = this.normals; data.colors = this.colors; data.uvs = this.uvs; data.indices = this.indices;
    data.applyToMesh(mesh);
    mesh.material = material;
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    mesh.doNotSyncBoundingInfo = true;
    return mesh;
  }
}
