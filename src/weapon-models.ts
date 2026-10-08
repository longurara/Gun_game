import type { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { vfxCard, vfxMaterial } from './coverage-vfx';
import { coverageParts, hasCoverageModel } from './coverage-assets';
import type { CoverageModel } from './coverage-assets';
import { WEAPONS } from './game/weapons';
import { buildGun } from './gun-builder';
import type { GunGeometry } from './gun-builder';
import { surfaceMaterial } from './surface-materials';
import type { SurfaceFinish } from './surface-materials';
import type { WeaponType } from './types';
import { freeGun } from './free-assets';

export interface WeaponModel {
  root: TransformNode; flash: AbstractMesh;
  /** Hand positions in the weapon's local space: the firing hand's grip and the supporting hand's hold. */
  grip: Vector3; fore: Vector3;
}

export function weaponCoverageKey(weapon: WeaponType): CoverageModel | null {
  const config = WEAPONS[weapon];
  return config.kind === 'bow' ? 'crossbow' : config.kind === 'launcher' ? config.ammoType === 'rocket' ? 'rocketLauncher' : 'grenadeLauncher' : null;
}

interface Template { meshes: Mesh[]; geometry: Pick<GunGeometry, 'muzzle' | 'grip' | 'fore'> }
const templates = new WeakMap<Scene, Map<WeaponType, Template>>();
const flashes = new WeakMap<Scene, Mesh>();

/** One merged mesh per finish, built once per gun and scene; every gun in the world is an instance or clone of these. */
function templateFor(weapon: WeaponType, scene: Scene): Template {
  let byWeapon = templates.get(scene);
  if (!byWeapon) { byWeapon = new Map(); templates.set(scene, byWeapon); scene.onDisposeObservable.add(() => templates.delete(scene)); }
  const config = WEAPONS[weapon];
  const key = weaponCoverageKey(weapon);
  const existing = byWeapon.get(weapon);
  if (key && hasCoverageModel(scene, key) && existing?.meshes[0]?.metadata?.coverageAsset !== key) {
    const size = config.kind === 'bow' ? [.68, .24, .80] : [.20, .28, 1.05];
    const parts = coverageParts(scene, key, null, [1, 1, 1], `gun-${weapon}`)!;
    const extent = parts[0].metadata.sourceExtent;
    const sideways = extent[0] > extent[2] * 1.3;
    for (const part of parts) {
      part.makeGeometryUnique();
      part.scaling.set(sideways ? size[2] : size[0], size[1], sideways ? size[0] : size[2]);
      if (sideways) part.rotation.y = -Math.PI / 2;
      part.position.set(0, -.10, -.25); part.bakeCurrentTransformIntoVertices();
      part.position.setAll(0); part.scaling.setAll(1); part.rotation.setAll(0); part.setEnabled(false);
    }
    const template = { meshes: parts, geometry: { muzzle: [0, .04, size[2] / 2 - .25] as [number, number, number], grip: [0, -.12, -.1] as [number, number, number], fore: [0, -.04, .18] as [number, number, number] } };
    byWeapon.set(weapon, template); return template;
  }
  if (existing && existing.meshes.every(mesh => !mesh.isDisposed())) return existing;
  const imported = freeGun(scene, config.kind, config.look);
  if (imported && imported.meshes.every(mesh => !mesh.isDisposed())) {
    const template = { meshes: imported.meshes, geometry: imported };
    byWeapon.set(weapon, template);
    return template;
  }
  const geometry = buildGun(config.kind, config.look, config.tier);
  const meshes: Mesh[] = [];
  for (const [finish, data] of geometry.bag.groups) {
    if (!data.indices.length) continue;
    const mesh = new Mesh(`gun-${weapon}-${finish}`, scene);
    const vertexData = new VertexData();
    vertexData.positions = data.positions; vertexData.normals = data.normals; vertexData.colors = data.colors; vertexData.uvs = data.uvs; vertexData.indices = data.indices;
    vertexData.applyToMesh(mesh);
    mesh.material = surfaceMaterial(scene, finish as SurfaceFinish);
    mesh.isPickable = false;
    mesh.setEnabled(false);
    meshes.push(mesh);
  }
  const template = { meshes, geometry };
  byWeapon.set(weapon, template);
  return template;
}

/** Loot with the same loaded asset can share a merged mesh even when its gameplay weapon differs. */
export function weaponModelKey(weapon: WeaponType, scene: Scene): string {
  return templateFor(weapon, scene).meshes.map(mesh => mesh.uniqueId).join(',');
}

function flashTemplate(scene: Scene): Mesh {
  let flash = flashes.get(scene);
  if (flash && !flash.isDisposed()) return flash;
  const material = vfxMaterial(scene, 'flash', '#ffd695');
  flash = vfxCard(scene, 'muzzle-flash-template', .35, material);
  material.diffuseColor = Color3.FromHexString('#ffd695'); material.emissiveColor = Color3.FromHexString('#ffd695');
  material.disableLighting = true;
  flash.material = material; flash.isPickable = false; flash.setEnabled(false);
  flashes.set(scene, flash);
  return flash;
}

let modelIndex = 0;

/**
 * A gun parented to `parent`, pointing along +Z. Held guns (`actorId` given) are cheap instances of shared meshes that
 * can be hit-tested; display guns (loot) are plain clones so they can be merged into one pickup mesh.
 */
export function createWeaponModel(weapon: WeaponType, scene: Scene, parent: TransformNode, actorId?: string): WeaponModel {
  const prefix = `${actorId ?? 'loot'}-${weapon}-${modelIndex++}`;
  const config = WEAPONS[weapon];
  const template = templateFor(weapon, scene);
  const root = new TransformNode(`${prefix}-weapon`, scene);
  root.parent = parent;
  root.metadata = { weapon, label: config.label, category: config.category, zoom: config.zoom, coverageAsset: template.meshes[0]?.metadata?.coverageAsset };
  for (const source of template.meshes) {
    const part = actorId ? source.createInstance(`${prefix}-${source.name}`) : source.clone(`${prefix}-${source.name}`);
    part.parent = root;
    part.setEnabled(true);
    part.isPickable = actorId !== undefined;
    if (actorId) part.metadata = { actorId };
  }
  const g = template.geometry;
  let flash: AbstractMesh;
  if (actorId) {
    const instance = flashTemplate(scene).createInstance(`${prefix}-muzzle-flash`);
    instance.parent = root;
    instance.position.set(g.muzzle[0], g.muzzle[1], g.muzzle[2] + 0.04);
    instance.scaling.set(0.7, 0.7, config.kind === 'amr' ? 2.2 : 1.4);
    instance.isPickable = false;
    instance.setEnabled(false);
    flash = instance;
  } else {
    // Display guns have no muzzle flash; hand back an inert stand-in so the shape stays uniform.
    flash = new Mesh(`${prefix}-no-flash`, scene);
    flash.setEnabled(false);
    flash.dispose();
  }
  return { root, flash, grip: new Vector3(...g.grip), fore: new Vector3(...g.fore) };
}
