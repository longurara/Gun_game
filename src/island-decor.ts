import type { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder.js';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder.js';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder.js';
import { Constants } from '@babylonjs/core/Engines/constants.js';
import '@babylonjs/core/Meshes/thinInstanceMesh.js';
import type { WorldConfig } from './types';
import { groundNoise } from './game/world';
import { ATLAS } from './island-foliage';
import { GrassWind } from './foliage-wind';
import { SpatialGrid } from './game/spatial';

const SUN_DIRECTION = [-0.5, -1, 0.65] as const;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
type GrassExclusion = { ax: number; az: number; bx: number; bz: number; pad: number };

/** Periodic noise texture: tileable, so it repeats without visible seams. */
function noiseTexture(scene: Scene, name: string, size: number, draw: (x: number, y: number, size: number) => [number, number, number, number]): DynamicTexture {
  const texture = new DynamicTexture(name, size, scene, true);
  const context = texture.getContext() as unknown as CanvasRenderingContext2D;
  const image = context.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = draw(x, y, size);
      const i = (y * size + x) * 4;
      image.data[i] = r; image.data[i + 1] = g; image.data[i + 2] = b; image.data[i + 3] = a;
    }
  }
  context.putImageData(image, 0, 0);
  texture.update(true);
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  texture.anisotropicFilteringLevel = 8;
  return texture;
}

/**
 * Periodic fractal noise in [-1, 1]: layers of whole-number sine frequencies, so the texture tiles without seams.
 * Each layer warps the next, which breaks the regular look of plain sine sums.
 */
function periodicNoise(x: number, y: number, size: number): number {
  const u = (x / size) * Math.PI * 2, v = (y / size) * Math.PI * 2;
  let total = 0, amplitude = 1, norm = 0;
  for (const [fu, fv] of [[2, 3], [5, 4], [9, 7], [16, 13], [29, 23], [47, 41]]) {
    const warp = Math.sin(v * fv + total * 1.7) * 0.9;
    total += Math.sin(u * fu + warp) * Math.cos(v * fv - warp * 0.7) * amplitude;
    norm += amplitude;
    amplitude *= 0.62;
  }
  return total / norm;
}

/** Ground colour modulation: broad mottling plus fine grain, multiplied into the vertex colours. Tiles every ~16 m. */
export function groundDetailTexture(scene: Scene): DynamicTexture {
  return noiseTexture(scene, 'ground-detail', 512, (x, y, size) => {
    const mottling = periodicNoise(x, y, size);
    const grain = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453 % 1;
    const value = 0.93 + mottling * 0.17 + (grain - 0.5) * 0.09;
    const c = Math.max(0, Math.min(255, value * 255));
    // A faint warm/cool shift so the tint is not one flat green.
    return [Math.min(255, c * (1 + mottling * 0.05)), c, Math.min(255, c * (1 - mottling * 0.07)), 255];
  });
}

/** Fine relief for the ground (pebbles and tussocks), sampled at a tighter scale than the colour texture. */
export function groundBumpTexture(scene: Scene): DynamicTexture {
  const size = 256;
  const height = (x: number, y: number) => periodicNoise(((x % size) + size) % size, ((y % size) + size) % size, size);
  return noiseTexture(scene, 'ground-bump', size, (x, y) => {
    const dx = (height(x + 1, y) - height(x - 1, y)) * 3.2, dy = (height(x, y + 1) - height(x, y - 1)) * 3.2;
    const length = Math.hypot(dx, dy, 1);
    return [(-dx / length * 0.5 + 0.5) * 255, (-dy / length * 0.5 + 0.5) * 255, (1 / length * 0.5 + 0.5) * 255, 255];
  });
}

/** A tileable normal map for rippling water. */
function waterNormals(scene: Scene): DynamicTexture {
  const size = 128;
  const height = (x: number, y: number) => {
    const u = (x / size) * Math.PI * 2, v = (y / size) * Math.PI * 2;
    return Math.sin(u * 2 + Math.sin(v * 3) * 1.4) * 0.5 + Math.sin(v * 4 - u * 3) * 0.35 + Math.sin(u * 7 + v * 5) * 0.15;
  };
  return noiseTexture(scene, 'water-normals', size, (x, y) => {
    const dx = (height(x + 1, y) - height(x - 1, y)) * 2.2, dy = (height(x, y + 1) - height(x, y - 1)) * 2.2;
    const length = Math.hypot(dx, dy, 1);
    return [(-dx / length * 0.5 + 0.5) * 255, (-dy / length * 0.5 + 0.5) * 255, (1 / length * 0.5 + 0.5) * 255, 255];
  });
}

type CanvasRenderContext = CanvasRenderingContext2D;
interface Cloud { mesh: Mesh; speed: number }

/**
 * Everything on the island that is not ground or buildings: open sea, lakes and rivers, the sky dome, sun,
 * drifting clouds and grass that grows in a ring around the player.
 */
export class IslandDecor {
  private readonly meshes: Mesh[] = [];
  private readonly water: StandardMaterial;
  private readonly sea: Mesh;
  private readonly sky: Mesh;
  private readonly sun: Mesh;
  private readonly clouds: Cloud[] = [];
  private readonly grass: Mesh | null;
  private grassAt = { x: 1e9, z: 1e9 };
  private grassMatrices = new Float32Array(0);
  private grassColors = new Float32Array(0);
  private readonly grassWind: GrassWind;
  private readonly grassExclusions = new SpatialGrid<GrassExclusion>(64);
  private scroll = 0;

  constructor(private readonly scene: Scene, private readonly world: WorldConfig, touch: boolean, private readonly foliage: StandardMaterial) {
    this.grassWind = new GrassWind(foliage);
    this.grassWind.radius = touch ? 24 : 34;
    const addRibbon = (ax: number, az: number, bx: number, bz: number, width: number) => {
      const pad = width / 2 + 1.2;
      this.grassExclusions.insertBox({ ax, az, bx, bz, pad }, Math.min(ax, bx) - pad, Math.min(az, bz) - pad,
        Math.max(ax, bx) + pad, Math.max(az, bz) + pad);
    };
    for (const road of world.roads) addRibbon(road.a.x, road.a.z, road.b.x, road.b.z, road.width);
    for (const river of world.water?.rivers ?? []) {
      for (let i = 0; i + 1 < river.points.length; i++) {
        const a = river.points[i], b = river.points[i + 1];
        addRibbon(a.x, a.z, b.x, b.z, river.width);
      }
    }
    const normals = waterNormals(scene);
    normals.uScale = normals.vScale = 1;
    this.water = new StandardMaterial('island-water', scene);
    this.water.diffuseColor = new Color3(0.07, 0.27, 0.33);
    this.water.emissiveColor = new Color3(0.02, 0.07, 0.09);
    this.water.specularColor = new Color3(0.85, 0.92, 1);
    this.water.specularPower = 140;
    this.water.alpha = 0.8;
    this.water.backFaceCulling = false;
    this.water.bumpTexture = normals;
    this.water.bumpTexture.level = 0.5;

    this.sea = CreateGround('sea', { width: 16000, height: 16000, subdivisions: 1 }, scene);
    this.sea.material = this.water;
    this.sea.isPickable = false;
    const uvs = this.sea.getVerticesData('uv');
    if (uvs) this.sea.setVerticesData('uv', uvs.map(value => value * 1300));
    this.sea.position.y = (world.water?.seaLevel ?? 0) - 0.02;
    this.meshes.push(this.sea);
    this.buildInlandWater();

    this.sky = this.buildSky();
    this.sun = this.buildSun();
    this.buildClouds();
    this.grass = this.buildGrass(touch ? 2600 : 6000);
  }

  /** Flat lake discs and river ribbons sitting at their own water level. */
  private buildInlandWater(): void {
    const water = this.world.water;
    if (!water) return;
    const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
    const vertex = (x: number, y: number, z: number) => { positions.push(x, y, z); normals.push(0, 1, 0); uvs.push(x / 14, z / 14); return positions.length / 3 - 1; };
    for (const lake of water.lakes) {
      const center = vertex(lake.x, lake.level, lake.z);
      const sides = 40;
      const ring: number[] = [];
      for (let i = 0; i < sides; i++) ring.push(vertex(lake.x + Math.cos((i / sides) * Math.PI * 2) * lake.r * 1.02, lake.level, lake.z + Math.sin((i / sides) * Math.PI * 2) * lake.r * 1.02));
      for (let i = 0; i < sides; i++) indices.push(center, ring[(i + 1) % sides], ring[i]);
    }
    for (const river of water.rivers) {
      let previous: [number, number] | null = null;
      for (let i = 0; i < river.points.length; i++) {
        const p = river.points[i], q = river.points[Math.min(river.points.length - 1, i + 1)], o = river.points[Math.max(0, i - 1)];
        const dx = q.x - o.x, dz = q.z - o.z, length = Math.hypot(dx, dz) || 1;
        const half = river.width * 0.55;
        const left = vertex(p.x - dz / length * half, p.level, p.z + dx / length * half);
        const right = vertex(p.x + dz / length * half, p.level, p.z - dx / length * half);
        if (previous) indices.push(previous[0], left, previous[1], previous[1], left, right);
        previous = [left, right];
      }
    }
    if (!indices.length) return;
    const mesh = new Mesh('inland-water', this.scene);
    const data = new VertexData();
    data.positions = positions; data.normals = normals; data.uvs = uvs; data.indices = indices;
    data.applyToMesh(mesh);
    mesh.material = this.water;
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    this.meshes.push(mesh);
  }

  private buildSky(): Mesh {
    const dome = CreateSphere('sky', { diameter: 1500, segments: 16, sideOrientation: Mesh.BACKSIDE }, this.scene);
    const positions = dome.getVerticesData('position')!;
    const colors: number[] = [];
    const horizon = [0.78, 0.85, 0.88], zenith = [0.28, 0.5, 0.82], haze = [0.9, 0.9, 0.86];
    for (let i = 0; i < positions.length; i += 3) {
      const up = Math.max(0, positions[i + 1] / 750);
      const t = Math.pow(up, 0.55);
      // Warm haze hugging the horizon, deepening to blue overhead.
      const base = horizon.map((h, k) => h + (zenith[k] - h) * t);
      const glow = Math.max(0, 1 - up * 6) * 0.35;
      colors.push(base[0] + (haze[0] - base[0]) * glow, base[1] + (haze[1] - base[1]) * glow, base[2] + (haze[2] - base[2]) * glow, 1);
    }
    dome.setVerticesData('color', colors);
    const material = new StandardMaterial('sky', this.scene);
    material.disableLighting = true;
    material.emissiveColor = Color3.White();
    material.diffuseColor = Color3.Black();
    material.specularColor = Color3.Black();
    material.fogEnabled = false;
    material.backFaceCulling = false;
    dome.material = material;
    dome.infiniteDistance = true;
    dome.isPickable = false;
    dome.renderingGroupId = 0;
    dome.applyFog = false;
    this.meshes.push(dome);
    return dome;
  }

  private buildSun(): Mesh {
    const sun = CreateSphere('sun', { diameter: 60, segments: 8 }, this.scene);
    const material = new StandardMaterial('sun', this.scene);
    material.disableLighting = true;
    material.emissiveColor = new Color3(1, 0.93, 0.74);
    material.diffuseColor = Color3.Black();
    material.fogEnabled = false;
    sun.material = material;
    sun.infiniteDistance = true;
    sun.isPickable = false;
    sun.applyFog = false;
    const length = Math.hypot(...SUN_DIRECTION);
    sun.position.set(-SUN_DIRECTION[0] / length * 640, -SUN_DIRECTION[1] / length * 640, -SUN_DIRECTION[2] / length * 640);
    this.meshes.push(sun);
    return sun;
  }

  /** Soft cumulus: many translucent puffs, bright on top and grey underneath. */
  private cloudTexture(): DynamicTexture {
    const texture = new DynamicTexture('cloud', { width: 512, height: 256 }, this.scene, true);
    const ctx = texture.getContext() as unknown as CanvasRenderContext;
    let seed = 11;
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    ctx.clearRect(0, 0, 512, 256);
    for (let layer = 0; layer < 2; layer++) {
      for (let i = 0; i < 46; i++) {
        const x = 70 + rand() * 372, y = 105 + rand() * 60 - layer * 26 + (rand() - 0.5) * 20, r = 28 + rand() * 46;
        const gradient = ctx.createRadialGradient(x, y - r * 0.2, r * 0.1, x, y, r);
        const lit = layer === 0 ? 0.74 : 1;
        gradient.addColorStop(0, 'rgba(' + Math.round(255 * lit) + ',' + Math.round(255 * lit) + ',' + Math.round(255 * (lit * 0.04 + 0.96)) + ',0.85)');
        gradient.addColorStop(0.6, 'rgba(' + Math.round(240 * lit) + ',' + Math.round(244 * lit) + ',' + Math.round(250 * lit) + ',0.35)');
        gradient.addColorStop(1, 'rgba(235,240,248,0)');
        ctx.fillStyle = gradient;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
    }
    texture.update(true);
    texture.hasAlpha = true;
    texture.wrapU = texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    return texture;
  }

  private buildClouds(): void {
    const texture = this.cloudTexture();
    const material = new StandardMaterial('cloud', this.scene);
    material.disableLighting = true;
    material.emissiveTexture = texture;
    material.opacityTexture = texture;
    material.diffuseColor = Color3.Black();
    material.specularColor = Color3.Black();
    material.fogEnabled = false;
    material.backFaceCulling = false;
    let seed = 7;
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 14; i++) {
      const mesh = CreateGround(`cloud-${i}`, { width: 1, height: 1 }, this.scene);
      mesh.material = material;
      mesh.scaling.set(520 + random() * 620, 1, 260 + random() * 300);
      mesh.rotation.y = random() * Math.PI;
      mesh.position.set((random() - 0.5) * 3200, 260 + random() * 110, (random() - 0.5) * 3200);
      mesh.isPickable = false;
      mesh.applyFog = false;
      this.clouds.push({ mesh, speed: 1.5 + random() * 2.5 });
      this.meshes.push(mesh);
    }
    // A soft glow around the sun, additively blended and always facing the camera.
    const glowTexture = new DynamicTexture('sun-glow', { width: 256, height: 256 }, this.scene, true);
    const glow = glowTexture.getContext() as unknown as CanvasRenderContext;
    const radial = glow.createRadialGradient(128, 128, 4, 128, 128, 128);
    radial.addColorStop(0, 'rgba(255,244,214,0.95)'); radial.addColorStop(0.18, 'rgba(255,226,170,0.5)'); radial.addColorStop(0.5, 'rgba(255,214,150,0.12)'); radial.addColorStop(1, 'rgba(255,210,140,0)');
    glow.fillStyle = radial; glow.fillRect(0, 0, 256, 256);
    glowTexture.update(true);
    glowTexture.hasAlpha = true;
    const glowMaterial = new StandardMaterial('sun-glow', this.scene);
    glowMaterial.disableLighting = true;
    glowMaterial.emissiveTexture = glowTexture;
    glowMaterial.opacityTexture = glowTexture;
    glowMaterial.diffuseColor = Color3.Black();
    glowMaterial.fogEnabled = false;
    glowMaterial.backFaceCulling = false;
    glowMaterial.alphaMode = Constants.ALPHA_ADD;
    const halo = CreatePlane('sun-halo', { size: 560 }, this.scene);
    halo.material = glowMaterial;
    halo.billboardMode = Mesh.BILLBOARDMODE_ALL;
    halo.infiniteDistance = true;
    halo.isPickable = false;
    halo.applyFog = false;
    const length = Math.hypot(...SUN_DIRECTION);
    halo.position.set(-SUN_DIRECTION[0] / length * 650, -SUN_DIRECTION[1] / length * 650, -SUN_DIRECTION[2] / length * 650);
    this.meshes.push(halo);
  }

  /** Painted grass cards: three crossed quads per tuft, instanced thousands of times around the camera. */
  private buildGrass(count: number): Mesh | null {
    const positions: number[] = [], normals: number[] = [], colors: number[] = [], uvs: number[] = [], indices: number[] = [];
    const uv = ATLAS.grass;
    const width = 1.0, height = 0.78;
    for (let k = 0; k < 3; k++) {
      const angle = k * Math.PI / 3;
      const c = Math.cos(angle) * width / 2, s = Math.sin(angle) * width / 2, base = positions.length / 3;
      positions.push(-c, 0, -s, c, 0, s, c, height, s, -c, height, -s);
      normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
      colors.push(0.7, 0.7, 0.7, 1, 0.7, 0.7, 0.7, 1, 1, 1, 1, 1, 1, 1, 1, 1);
      uvs.push(uv.u0, uv.v0, uv.u1, uv.v0, uv.u1, uv.v1, uv.u0, uv.v1);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const mesh = new Mesh('grass', this.scene);
    const data = new VertexData();
    data.positions = positions; data.normals = normals; data.colors = colors; data.uvs = uvs; data.indices = indices;
    data.applyToMesh(mesh);
    mesh.material = this.foliage;
    mesh.receiveShadows = true;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    this.grassMatrices = new Float32Array(count * 16);
    this.grassColors = new Float32Array(count * 4);
    mesh.thinInstanceSetBuffer('matrix', this.grassMatrices, 16, false);
    mesh.thinInstanceSetBuffer('color', this.grassColors, 4, false);
    mesh.thinInstanceCount = 0;
    mesh.setEnabled(false);
    this.meshes.push(mesh);
    return mesh;
  }

  private onRoadOrRiver(x: number, z: number): boolean {
    let blocked = false;
    this.grassExclusions.queryBox(x, z, x, z, ribbon => {
      const dx = ribbon.bx - ribbon.ax, dz = ribbon.bz - ribbon.az;
      const t = clamp01(((x - ribbon.ax) * dx + (z - ribbon.az) * dz) / (dx * dx + dz * dz || 1));
      if (Math.hypot(x - ribbon.ax - dx * t, z - ribbon.az - dz * t) < ribbon.pad) { blocked = true; return true; }
    });
    return blocked;
  }

  private nearTown(x: number, z: number): boolean {
    return this.world.towns.some(town => Math.hypot(x - town.x, z - town.z) < town.radius * 1.05);
  }

  private rebuildGrass(cx: number, cz: number): void {
    const mesh = this.grass;
    if (!mesh) return;
    const matrices = this.grassMatrices, colors = this.grassColors;
    const max = colors.length / 4;
    matrices.fill(0);
    // A six-metre safety band stays outside the visible fade during each four-metre update.
    const radius = this.grassWind.radius + 6, spacing = 0.85, terrain = this.world.terrain ?? (() => 0);
    const lakes = this.world.water?.lakes ?? [];
    const hashAt = (gx: number, gz: number, salt: number) => Math.abs(Math.sin(gx * 127.1 + gz * 311.7 + salt * 74.7) * 43758.5453) % 1;
    const candidates: Array<{ x: number; z: number; gx: number; gz: number; d: number }> = [];
    for (let gx = Math.floor((cx - radius) / spacing); gx <= Math.floor((cx + radius) / spacing); gx++) {
      for (let gz = Math.floor((cz - radius) / spacing); gz <= Math.floor((cz + radius) / spacing); gz++) {
        const x = (gx + hashAt(gx, gz, 1)) * spacing, z = (gz + hashAt(gx, gz, 2)) * spacing;
        const d = Math.hypot(x - cx, z - cz);
        if (d < radius) candidates.push({ x, z, gx, gz, d });
      }
    }
    // Fill nearby cells first if the phone budget is reached, keeping grass on every side.
    candidates.sort((a, b) => a.d - b.d);
    let n = 0;
    for (const { x, z, gx, gz } of candidates) {
      if (n >= max) break;
      const hash = hashAt(gx, gz, 3), hash2 = hashAt(gx, gz, 4);
      // A stable patch distribution avoids selection/rotation correlation and moving density rings.
      const meadow = groundNoise(x, z);
      const density = 0.42 + meadow * 0.42;
      if (hashAt(gx, gz, 5) > density) continue;
      const y = terrain(x, z);
      if (y < 2.6 || this.nearTown(x, z) || this.onRoadOrRiver(x, z)) continue;
      if (lakes.some(l => Math.hypot(x - l.x, z - l.z) < l.r * 1.2)) continue;
      const slope = Math.hypot((terrain(x + 0.75, z) - terrain(x - 0.75, z)) / 1.5,
        (terrain(x, z + 0.75) - terrain(x, z - 0.75)) / 1.5);
      if (hashAt(gx, gz, 6) > 1 - clamp01((slope - 0.35) / 0.3)) continue;
      const scale = 0.48 + hash * 0.64, rotation = hash2 * Math.PI * 2, c = Math.cos(rotation), s = Math.sin(rotation);
      const m = n * 16;
      matrices[m] = c * scale; matrices[m + 2] = -s * scale;
      matrices[m + 5] = scale * (0.8 + hash2 * 0.5);
      matrices[m + 8] = s * scale; matrices[m + 10] = c * scale;
      matrices[m + 12] = x; matrices[m + 13] = y - 0.05; matrices[m + 14] = z; matrices[m + 15] = 1;
      // Tufts take the ground's own tint (dry on bare patches, lush in the meadow) so they melt into it.
      const tint = 0.86 + hashAt(gx, gz, 7) * 0.12;
      const dry = clamp01(groundNoise(x * 0.22 + 91, z * 0.22 - 37) * 2 - 0.9);
      const k = n * 4;
      colors[k] = tint * (0.98 + dry * 0.02); colors[k + 1] = tint * (1 - dry * 0.12); colors[k + 2] = tint * (0.94 - dry * 0.15); colors[k + 3] = 1;
      n++;
    }
    mesh.thinInstanceBufferUpdated('matrix');
    mesh.thinInstanceBufferUpdated('color');
    mesh.thinInstanceCount = n;
    // Do not draw a zero-count thin-instance mesh with stale instance-colour shader defines.
    mesh.setEnabled(n > 0);
    this.grassAt = { x: cx, z: cz };
  }

  /** Move the camera-relative pieces and animate water and clouds. */
  update(dt: number, x: number, z: number): void {
    this.sea.position.x = Math.round(x / 50) * 50;
    this.sea.position.z = Math.round(z / 50) * 50;
    this.scroll += dt;
    this.grassWind.time = this.scroll;
    this.grassWind.x = x;
    this.grassWind.z = z;
    const bump = this.water.bumpTexture as Texture;
    bump.uOffset = this.scroll * 0.012;
    bump.vOffset = this.scroll * 0.007;
    for (const cloud of this.clouds) {
      cloud.mesh.position.x += cloud.speed * dt;
      if (cloud.mesh.position.x > x + 1700) cloud.mesh.position.x -= 3400;
      if (cloud.mesh.position.x < x - 1700) cloud.mesh.position.x += 3400;
      cloud.mesh.position.z += (z - cloud.mesh.position.z > 1700 ? 3400 : z - cloud.mesh.position.z < -1700 ? -3400 : 0);
    }
    if (Math.hypot(x - this.grassAt.x, z - this.grassAt.z) > 4) this.rebuildGrass(x, z);
  }

  dispose(): void {
    // Grass shares its atlas material with every streamed tree; IslandRenderer owns that material.
    for (const mesh of this.meshes) mesh.dispose(false, mesh !== this.grass);
    this.meshes.length = 0;
    this.water.dispose(true, true);
  }
}
