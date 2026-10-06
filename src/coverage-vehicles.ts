import type { Scene } from '@babylonjs/core/scene.js';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import type { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import type { Vehicle } from './types';
import { HULLS, kindOf } from './game/vehicles';
import type { VehicleKind } from './game/vehicles';
import { coverageParts } from './coverage-assets';
import type { CoverageModel } from './coverage-assets';

export const VEHICLE_ASSETS: Partial<Record<VehicleKind, CoverageModel>> = {
  car: 'k-sedan', coupe: 'k-sedan-sports', pickup: 'k-truck', van: 'k-van', minibus: 'minibus',
  bike: 'motorcycle', scooter: 'scooter', buggy: 'buggy', jeep: 'jeep',
};
export function createCoverageVehicle(v: Vehicle, scene: Scene, shadows: ShadowGenerator): { root: TransformNode; wheels: TransformNode[]; bodies: Mesh[]; wrecked: boolean; asset: boolean; lastYaw?: number } | null {
  const key = VEHICLE_ASSETS[kindOf(v)];
  if (!key) return null;
  const root = new TransformNode(`car-${v.id}`, scene), model = new TransformNode(`vehicle-asset-${v.id}`, scene); model.parent = root;
  const parts = coverageParts(scene, key, model, [1, 1, 1], `vehicle-${v.id}`);
  if (!parts) { root.dispose(); return null; }
  const hull = HULLS[kindOf(v)];
  // The Poly bikes use a lateral forward axis; all models are aligned to the chassis forward axis.
  const sourceExtent = parts[0].metadata.sourceExtent as number[] | undefined;
  const sideways = !!sourceExtent && sourceExtent[0] > sourceExtent[2] * 1.3;
  model.scaling.set(sideways ? hull.length * 2 : hull.half * 2, hull.high, sideways ? hull.half * 2 : hull.length * 2);
  if (sideways) model.rotation.y = Math.PI / 2;
  const wheels: TransformNode[] = [];
  for (const part of parts) {
    if (/wheel/i.test(part.metadata.sourceName)) {
      const centre = part.getBoundingInfo().boundingBox.center.clone();
      const pivot = new TransformNode(`asset-wheel-${v.id}`, scene); pivot.parent = model; pivot.position.copyFrom(centre);
      part.parent = pivot; part.position.copyFrom(centre.negate()); wheels.push(pivot);
    }
    part.metadata = { ...part.metadata, solid: true, car: true, vehicleId: v.id };
    part.isPickable = !/wheel/i.test(part.metadata.sourceName); part.receiveShadows = true; shadows.addShadowCaster(part);
  }
  return { root, wheels, bodies: parts, wrecked: false, asset: true };
}
