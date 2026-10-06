import type { Scene } from '@babylonjs/core/scene.js';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import type { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Vehicle } from './types';
import { HULLS, kindOf } from './game/vehicles';
import type { VehicleKind } from './game/vehicles';
import { coverageParts } from './coverage-assets';
import type { CoverageModel } from './coverage-assets';

type Axis = 'x' | 'y' | 'z';
const AXES: Axis[] = ['x', 'y', 'z'];
interface Wheel { centre: Vector3; axis: Axis; radius: number }
interface Template { parts: Mesh[]; wheels: Map<number, Wheel> }
interface Templates { vehicles: Map<VehicleKind, Template>; wheels: Map<CoverageModel, Mesh[]> }
const cache = new WeakMap<Scene, Templates>();
function store(scene: Scene): Templates {
  let state = cache.get(scene);
  if (!state) {
    state = { vehicles: new Map(), wheels: new Map() }; cache.set(scene, state);
    scene.onDisposeObservable.addOnce(() => cache.delete(scene));
  }
  return state;
}
const axleOf = (size: Vector3): Axis => AXES.reduce((axis, candidate) => size[candidate] < size[axis] ? candidate : axis, 'x');
const isWheel = (mesh: Mesh): boolean => /wheel/i.test(mesh.metadata.sourceName) && !/steer/i.test(mesh.metadata.sourceName);

export const VEHICLE_ASSETS: Partial<Record<VehicleKind, CoverageModel>> = {
  car: 'k-sedan', coupe: 'k-sedan-sports', pickup: 'k-truck', van: 'k-van', minibus: 'minibus',
  bike: 'motorcycle', scooter: 'scooter', buggy: 'buggy', jeep: 'jeep',
};

/** Fit once per kind. Wheel pivots rotate under unit scale, never under the body's nonuniform fit. */
function vehicleTemplate(scene: Scene, kind: VehicleKind, key: CoverageModel): Template | null {
  const state = store(scene), existing = state.vehicles.get(kind);
  if (existing) return existing;
  const parts = coverageParts(scene, key, null, [1, 1, 1], `vehicle-template-${kind}`);
  if (!parts) return null;
  const hull = HULLS[kind], extent = Vector3.FromArray(parts[0].metadata.sourceExtent);
  const sideways = extent.x > extent.z * 1.3;
  const fit = Matrix.Scaling(sideways ? hull.length * 2 : hull.half * 2, hull.high, sideways ? hull.half * 2 : hull.length * 2)
    .multiply(Matrix.RotationY(sideways ? Math.PI / 2 : 0));
  const wheels = new Map<number, Wheel>();
  parts.forEach((part, index) => {
    const wheel = isWheel(part);
    const rawSize = part.getBoundingInfo().boundingBox.extendSize.scale(2).multiply(extent);
    let axis = axleOf(rawSize);
    if (sideways && axis !== 'y') axis = axis === 'x' ? 'z' : 'x';
    // Do not modify the unit-box source geometry shared with pickups and other vehicles.
    part.makeGeometryUnique(); part.bakeTransformIntoVertices(fit);
    if (wheel) {
      part.refreshBoundingInfo(); const box = part.getBoundingInfo().boundingBox;
      const centre = box.center.clone(), size = box.extendSize.scale(2);
      const radial = AXES.filter(candidate => candidate !== axis);
      // Keep the vertical diameter/contact height; correct the other radial axis to a circle.
      const diameter = axis !== 'y' ? size.y : Math.min(...radial.map(candidate => size[candidate]));
      const scale = Vector3.One();
      for (const candidate of radial) scale[candidate] = diameter / Math.max(.001, size[candidate]);
      part.bakeTransformIntoVertices(Matrix.Translation(-centre.x, -centre.y, -centre.z).multiply(Matrix.Scaling(scale.x, scale.y, scale.z)));
      wheels.set(index, { centre, axis, radius: diameter / 2 });
    }
    part.setEnabled(false);
  });
  const template = { parts, wheels }; state.vehicles.set(kind, template); return template;
}

export function createCoverageVehicle(v: Vehicle, scene: Scene, shadows: ShadowGenerator): { root: TransformNode; wheels: TransformNode[]; bodies: Mesh[]; wrecked: boolean; asset: boolean; lastYaw?: number } | null {
  const kind = kindOf(v), key = VEHICLE_ASSETS[kind];
  if (!key) return null;
  const template = vehicleTemplate(scene, kind, key);
  if (!template) return null;
  const root = new TransformNode(`car-${v.id}`, scene), model = new TransformNode(`vehicle-asset-${v.id}`, scene); model.parent = root;
  const wheels: TransformNode[] = [], bodies: Mesh[] = [];
  template.parts.forEach((source, index) => {
    const part = source.clone(`vehicle-${v.id}-${index}`)!; part.parent = model; part.setEnabled(true);
    const wheel = template.wheels.get(index);
    if (wheel) {
      const pivot = new TransformNode(`asset-wheel-${v.id}-${index}`, scene); pivot.parent = model; pivot.position.copyFrom(wheel.centre);
      pivot.metadata = { spinAxis: wheel.axis, radius: wheel.radius }; part.parent = pivot; wheels.push(pivot);
    }
    part.metadata = { ...source.metadata, solid: true, car: true, vehicleId: v.id };
    part.isPickable = !wheel; part.receiveShadows = true; shadows.addShadowCaster(part); bodies.push(part);
  });
  return { root, wheels, bodies, wrecked: false, asset: true };
}

/** Standalone authored wheels are centred and aligned to the procedural chassis' X axle before animation. */
export function createCoverageWheels(scene: Scene, key: 'k-wheel-default' | 'k-wheel-racing', parent: TransformNode, name: string): Mesh[] | null {
  const state = store(scene);
  let source = state.wheels.get(key);
  if (!source) {
    const parts = coverageParts(scene, key, null, [1, 1, 1], `wheel-template-${key}`);
    if (!parts) return null;
    const extent = Vector3.FromArray(parts[0].metadata.sourceExtent), axis = axleOf(extent);
    const size = new Vector3(.84, .84, .84); size[axis] = .32;
    const alignment = axis === 'z' ? Matrix.RotationY(Math.PI / 2) : axis === 'y' ? Matrix.RotationZ(-Math.PI / 2) : Matrix.Identity();
    const transform = Matrix.Translation(0, -.5, 0).multiply(Matrix.Scaling(size.x, size.y, size.z)).multiply(alignment);
    for (const part of parts) { part.makeGeometryUnique(); part.bakeTransformIntoVertices(transform); part.setEnabled(false); }
    source = parts; state.wheels.set(key, source);
  }
  return source.map((mesh, index) => {
    const part = mesh.clone(`${name}-${index}`)!; part.parent = parent; part.setEnabled(true);
    part.metadata = { ...mesh.metadata, solid: true, car: true }; return part;
  });
}

export function spinVehicleWheel(wheel: TransformNode, distance: number): void {
  const axis = (wheel.metadata?.spinAxis ?? 'x') as Axis;
  wheel.rotation[axis] += distance / Math.max(.01, wheel.metadata?.radius ?? .42);
}
