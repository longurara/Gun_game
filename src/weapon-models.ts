import type { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder.js';
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

interface Template { meshes: Mesh[]; geometry: Pick<GunGeometry, 'muzzle' | 'grip' | 'fore'> }
const templates = new WeakMap<Scene, Map<WeaponType, Template>>();
const flashes = new WeakMap<Scene, Mesh>();

/** One merged mesh per finish, built once per gun and scene; every gun in the world is an instance or clone of these. */
function templateFor(weapon: WeaponType, scene: Scene): Template {
  let byWeapon = templates.get(scene);
  if (!byWeapon) { byWeapon = new Map(); templates.set(scene, byWeapon); scene.onDisposeObservable.add(() => templates.delete(scene)); }
  const existing = byWeapon.get(weapon);
  if (existing && existing.meshes.every(mesh => !mesh.isDisposed())) return existing;
  const config = WEAPONS[weapon];
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

function flashTemplate(scene: Scene): Mesh {
  let flash = flashes.get(scene);
  if (flash && !flash.isDisposed()) return flash;
  flash = CreateSphere('muzzle-flash-template', { diameter: 0.21, segments: 4 }, scene);
  const material = new StandardMaterial('muzzle-flash', scene);
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
  root.metadata = { weapon, label: config.label, category: config.category, zoom: config.zoom };
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
