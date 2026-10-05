import type { Scene } from '@babylonjs/core/scene.js';
import type { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder.js';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder.js';
import { WEAPONS } from './game/weapons';
import type { WeaponType } from './types';

export interface WeaponModel { root: TransformNode; flash: Mesh }

let modelIndex = 0;

/** All dimensions are local meters. Weapons point along +Z and own their materials. */
export function createWeaponModel(
  weapon: WeaponType,
  scene: Scene,
  parent: TransformNode,
  actorId?: string,
): WeaponModel {
  const prefix = `${actorId ?? 'loot'}-${weapon}-${modelIndex++}`;
  const root = new TransformNode(`${prefix}-weapon`, scene);
  root.parent = parent;
  root.metadata = { weapon, label: WEAPONS[weapon].label, category: WEAPONS[weapon].category, zoom: WEAPONS[weapon].zoom };
  const ownedMaterials: StandardMaterial[] = [];
  const makeMaterial = (name: string, color: string, emissive = 0) => {
    const material = new StandardMaterial(`${prefix}-${name}`, scene);
    material.diffuseColor = Color3.FromHexString(color);
    material.specularColor = new Color3(0.12, 0.14, 0.13);
    if (emissive > 0) material.emissiveColor = material.diffuseColor.scale(emissive);
    ownedMaterials.push(material);
    return material;
  };
  root.onDisposeObservable.add(() => {
    // Also collect palette materials unused by this particular silhouette.
    for (const material of ownedMaterials) if (scene.materials.includes(material)) material.dispose();
  });
  const metal = makeMaterial('metal', '#293633');
  const steel = makeMaterial('steel', '#64736d');
  const grip = makeMaterial('grip', weapon === 'sniper' ? '#a07848' : '#6b5943');
  const accent = makeMaterial('accent', WEAPONS[weapon].color);
  const glass = makeMaterial('optic-glass', '#57bec1', 0.35);
  const flashMaterial = makeMaterial('flash', '#ffd695', 1);
  flashMaterial.disableLighting = true;

  const configure = (mesh: Mesh, material: StandardMaterial): Mesh => {
    mesh.parent = root;
    mesh.material = material;
    mesh.receiveShadows = true;
    mesh.isPickable = actorId !== undefined;
    if (actorId) mesh.metadata = { actorId };
    return mesh;
  };
  const box = (
    name: string, width: number, height: number, depth: number,
    x: number, y: number, z: number, material = metal,
  ): Mesh => {
    const mesh = configure(CreateBox(`${prefix}-${name}`, { width, height, depth }, scene), material);
    mesh.position.set(x, y, z);
    return mesh;
  };
  const tube = (
    name: string, diameter: number, length: number,
    x: number, y: number, z: number, material = metal,
  ): Mesh => {
    const mesh = configure(CreateCylinder(`${prefix}-${name}`, {
      diameter, height: length, tessellation: 8,
    }, scene), material);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(x, y, z);
    return mesh;
  };
  const handle = (z = 0.08, height = 0.22, material = grip) => {
    const mesh = box('pistol-grip', 0.105, height, 0.12, 0, -height / 2 - 0.065, z, material);
    mesh.rotation.x = -0.20;
    // Open trigger guard is built from thin pieces rather than an opaque block.
    box('trigger-guard-front', 0.025, 0.12, 0.025, 0, -0.115, z + 0.13, steel);
    box('trigger-guard-bottom', 0.025, 0.025, 0.15, 0, -0.17, z + 0.065, steel);
  };
  const reflex = (z: number, scale = 1) => {
    box('optic-base', 0.14 * scale, 0.04, 0.14 * scale, 0, 0.12, z, steel);
    for (const side of [-1, 1]) {
      box('optic-frame', 0.024 * scale, 0.14 * scale, 0.035, side * 0.068 * scale, 0.19, z, metal);
    }
    box('optic-frame-top', 0.16 * scale, 0.025 * scale, 0.035, 0, 0.26, z, metal);
    box('optic-dot', 0.024, 0.024, 0.026, 0, 0.15, z, glass);
  };
  const scope = (z: number, length: number, diameter: number, height: number) => {
    for (const mount of [-1, 1]) {
      box('scope-mount', 0.08, height - 0.04, 0.06, 0, (height + 0.08) / 2, z + mount * length * 0.26, steel);
    }
    tube('scope-tube', diameter * 0.65, length, 0, height, z);
    tube('scope-objective', diameter, length * 0.22, 0, height, z + length * 0.43);
    tube('scope-eyepiece', diameter * 0.86, length * 0.18, 0, height, z - length * 0.42);
    tube('scope-lens-front', diameter * 0.80, 0.008, 0, height, z + length * 0.545, glass);
    tube('scope-lens-back', diameter * 0.67, 0.008, 0, height, z - length * 0.52, glass);
    const turret = configure(CreateCylinder(`${prefix}-scope-turret`, {
      diameter: diameter * 0.48, height: diameter * 0.55, tessellation: 8,
    }, scene), steel);
    turret.position.set(0, height + diameter * 0.48, z);
  };
  const ribbedForegrip = (start: number, count: number, spacing: number, width: number, height: number) => {
    for (let i = 0; i < count; i++) box('foregrip-rib', width, height, 0.016, 0, 0, start + i * spacing, steel);
  };
  const bipod = (z: number, spread: number) => {
    for (const side of [-1, 1]) {
      const leg = box('folded-bipod', 0.028, 0.23, 0.035, side * spread, -0.12, z, steel);
      leg.rotation.z = side * -0.35;
    }
  };

  let muzzle = 1;
  switch (weapon) {
    case 'rifle': {
      box('receiver', 0.145, 0.15, 0.43, 0, 0, 0.2);
      box('stock', 0.105, 0.17, 0.27, 0, -0.015, -0.16, grip);
      box('stock-pad', 0.12, 0.19, 0.04, 0, -0.015, -0.305);
      handle();
      const magazine = box('curved-magazine', 0.10, 0.28, 0.14, 0, -0.19, 0.27, steel);
      magazine.rotation.x = -0.13;
      box('foregrip', 0.15, 0.13, 0.27, 0, 0, 0.53, grip);
      ribbedForegrip(0.42, 4, 0.055, 0.16, 0.15);
      tube('barrel', 0.052, 0.38, 0, 0.015, 0.8);
      tube('flash-hider', 0.073, 0.065, 0, 0.015, 1.015, steel);
      box('selector-mark', 0.007, 0.035, 0.09, -0.076, 0.025, 0.23, accent);
      reflex(0.27);
      muzzle = 1.06;
      break;
    }
    case 'shotgun': {
      box('receiver', 0.155, 0.16, 0.34, 0, 0, 0.19);
      box('wood-stock', 0.13, 0.19, 0.37, 0, -0.04, -0.19, grip);
      box('stock-pad', 0.14, 0.21, 0.045, 0, -0.04, -0.40);
      handle(0.035, 0.16);
      tube('shotgun-barrel', 0.089, 0.80, 0, 0.05, 0.73, steel);
      tube('tube-magazine', 0.075, 0.61, 0, -0.066, 0.66);
      box('pump', 0.18, 0.14, 0.26, 0, -0.055, 0.61, grip);
      for (let i = 0; i < 5; i++) box('pump-rib', 0.192, 0.148, 0.015, 0, -0.055, 0.51 + i * 0.05, metal);
      box('bead-sight', 0.025, 0.035, 0.025, 0, 0.105, 1.04, accent);
      box('shell-port', 0.009, 0.06, 0.12, -0.08, 0.02, 0.22, steel);
      muzzle = 1.15;
      break;
    }
    case 'smg': {
      box('compact-receiver', 0.13, 0.15, 0.32, 0, 0, 0.25);
      box('folding-stock-top', 0.08, 0.04, 0.26, 0, 0.015, -0.02, steel);
      box('folding-stock-bottom', 0.075, 0.04, 0.25, 0, -0.085, -0.03, steel);
      box('stock-pad', 0.1, 0.15, 0.035, 0, -0.04, -0.17);
      handle(0.20, 0.25);
      box('straight-magazine', 0.065, 0.25, 0.105, 0, -0.24, 0.24);
      box('front-handguard', 0.145, 0.14, 0.18, 0, 0, 0.49, accent);
      tube('short-barrel', 0.06, 0.15, 0, 0.025, 0.64, steel);
      tube('compact-suppressor', 0.10, 0.20, 0, 0.025, 0.765);
      reflex(0.34, 0.8);
      muzzle = 0.89;
      break;
    }
    case 'pistol': {
      box('pistol-slide', 0.105, 0.12, 0.47, 0, 0.025, 0.46, steel);
      box('pistol-frame', 0.10, 0.055, 0.35, 0, -0.065, 0.40);
      handle(0.28, 0.28, metal);
      box('grip-panel', 0.108, 0.19, 0.095, 0, -0.21, 0.27, grip).rotation.x = -0.20;
      box('front-sight', 0.023, 0.035, 0.027, 0, 0.106, 0.65, accent);
      for (const side of [-1, 1]) box('rear-sight', 0.024, 0.035, 0.036, side * 0.034, 0.106, 0.25);
      tube('pistol-muzzle', 0.048, 0.10, 0, 0.025, 0.74);
      for (let i = 0; i < 3; i++) box('slide-serration', 0.114, 0.073, 0.012, 0, 0.025, 0.27 + i * 0.033, metal);
      muzzle = 0.81;
      break;
    }
    case 'dmr': {
      box('dmr-receiver', 0.15, 0.15, 0.40, 0, 0, 0.18);
      box('marksman-stock', 0.13, 0.19, 0.36, 0, -0.025, -0.23, grip);
      box('cheek-rest', 0.12, 0.07, 0.19, 0, 0.11, -0.23, steel);
      box('stock-pad', 0.15, 0.23, 0.04, 0, -0.025, -0.435);
      handle(0.04);
      box('box-magazine', 0.115, 0.18, 0.15, 0, -0.15, 0.25, steel);
      box('long-handguard', 0.14, 0.12, 0.38, 0, 0.005, 0.58, grip);
      tube('marksman-barrel', 0.059, 0.34, 0, 0.015, 0.88, steel);
      tube('muzzle-brake', 0.089, 0.085, 0, 0.015, 1.09);
      scope(0.21, 0.51, 0.14, 0.235);
      box('caliber-mark', 0.008, 0.04, 0.13, -0.078, 0.02, 0.15, accent);
      muzzle = 1.15;
      break;
    }
    case 'sniper': {
      box('wooden-rifle-bed', 0.13, 0.11, 0.91, 0, -0.05, 0.08, grip);
      box('long-wood-stock', 0.14, 0.20, 0.32, 0, -0.10, -0.50, grip);
      box('stock-pad', 0.15, 0.22, 0.035, 0, -0.10, -0.69);
      handle(-0.08, 0.16);
      tube('bolt-receiver', 0.13, 0.34, 0, 0.025, 0.15, steel);
      tube('long-thin-barrel', 0.057, 0.78, 0, 0.025, 0.72);
      box('bolt-stem', 0.14, 0.032, 0.032, 0.12, -0.01, 0.10, steel);
      const knob = configure(CreateSphere(`${prefix}-bolt-knob`, { diameter: 0.074, segments: 4 }, scene), metal);
      knob.position.set(0.19, -0.045, 0.10);
      box('internal-magazine', 0.10, 0.075, 0.18, 0, -0.13, 0.19, metal);
      scope(0.10, 0.64, 0.17, 0.255);
      muzzle = 1.14;
      break;
    }
    case 'heavySniper': {
      box('heavy-receiver', 0.21, 0.21, 0.44, 0, 0, 0.24);
      box('skeleton-stock-top', 0.11, 0.06, 0.40, 0, 0.035, -0.21, steel);
      box('skeleton-stock-bottom', 0.11, 0.055, 0.36, 0, -0.115, -0.19, steel);
      box('heavy-stock-pad', 0.18, 0.24, 0.06, 0, -0.04, -0.44);
      box('cheek-rest', 0.15, 0.055, 0.22, 0, 0.10, -0.24, grip);
      handle(0.075, 0.25);
      box('large-magazine', 0.135, 0.24, 0.19, 0, -0.23, 0.29, steel);
      box('heavy-handguard', 0.19, 0.16, 0.27, 0, 0, 0.56, grip);
      tube('heavy-fluted-barrel', 0.085, 0.34, 0, 0.025, 0.86, steel);
      box('large-muzzle-brake', 0.21, 0.12, 0.19, 0, 0.025, 1.12);
      for (const side of [-1, 1]) {
        for (let i = 0; i < 3; i++) box('muzzle-brake-port', 0.008, 0.065, 0.025, side * 0.108, 0.025, 1.055 + i * 0.05, steel);
      }
      box('receiver-accent', 0.008, 0.055, 0.18, -0.109, 0.035, 0.28, accent);
      scope(0.18, 0.71, 0.21, 0.29);
      bipod(0.84, 0.13);
      muzzle = 1.24;
      break;
    }
    case 'lmg': {
      box('machinegun-receiver', 0.22, 0.19, 0.46, 0, 0, 0.23);
      box('machinegun-stock', 0.14, 0.19, 0.28, 0, -0.015, -0.20, grip);
      box('stock-pad', 0.16, 0.21, 0.05, 0, -0.015, -0.36);
      handle(0.02);
      const drum = configure(CreateCylinder(`${prefix}-drum-magazine`, {
        diameter: 0.34, height: 0.29, tessellation: 12,
      }, scene), grip);
      drum.rotation.z = Math.PI / 2;
      drum.position.set(0, -0.22, 0.28);
      for (const side of [-1, 1]) {
        const lid = configure(CreateCylinder(`${prefix}-drum-lid`, {
          diameter: 0.29, height: 0.018, tessellation: 12,
        }, scene), steel);
        lid.rotation.z = Math.PI / 2;
        lid.position.set(side * 0.155, -0.22, 0.28);
      }
      box('barrel-shroud', 0.16, 0.16, 0.31, 0, 0.015, 0.63, grip);
      ribbedForegrip(0.52, 5, 0.055, 0.175, 0.17);
      tube('heavy-barrel', 0.076, 0.32, 0, 0.025, 0.95, steel);
      box('carry-handle', 0.07, 0.04, 0.28, 0.035, 0.24, 0.37, metal);
      for (const z of [0.25, 0.49]) box('handle-post', 0.07, 0.12, 0.045, 0.035, 0.18, z, steel);
      box('feed-cover-mark', 0.13, 0.015, 0.18, 0, 0.105, 0.26, accent);
      reflex(0.15, 0.8);
      bipod(0.96, 0.12);
      muzzle = 1.13;
      break;
    }
  }

  const flash = configure(CreateSphere(`${prefix}-muzzle-flash`, { diameter: 0.21, segments: 4 }, scene), flashMaterial);
  flash.position.set(0, weapon === 'shotgun' ? 0.05 : 0.025, muzzle);
  flash.scaling.set(0.70, 0.70, weapon === 'heavySniper' ? 2.2 : 1.4);
  flash.isPickable = false;
  flash.receiveShadows = false;
  flash.setEnabled(false);
  return { root, flash };
}
