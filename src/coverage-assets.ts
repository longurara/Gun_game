import type { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';

export const COVERAGE_MODELS = [
  'motorcycle', 'scooter', 'buggy', 'jeep', 'minibus', 'backpack', 'firstaid', 'molotov', 'pan', 'machete', 'crowbar', 'sickle',
  'crossbow', 'grenadeLauncher', 'rocketLauncher', 'bandage', 'energy', 'painkiller', 'parachute',
  'k-sedan', 'k-sedan-sports', 'k-truck', 'k-van', 'k-wheel-default', 'k-wheel-racing', 'k-box',
  'k-scope-small', 'k-scope-large-a', 'k-silencer-small', 'k-grenade-a', 'k-grenade-b', 'k-crate-wide',
  'k-wall', 'k-floor', 'k-bedBunk', 'k-bedSingle', 'k-desk', 'k-chair', 'k-bookcaseOpen',
  'k-shipping-container-a', 'k-detail-tank-large', 'k-chimney-large', 'k-pipe-large-long', 'k-box-large',
  'k-barrel', 'k-chest', 'k-tree_pineDefaultA', 'k-tree_oak', 'k-rock_largeA',
] as const;
export type CoverageModel = typeof COVERAGE_MODELS[number];
interface Templates { models: Map<CoverageModel, Mesh[]>; loads: Map<CoverageModel, Promise<void>>; revision: number }
const cache = new WeakMap<Scene, Templates>();
export const coverageUrl = (file: string): string => `${import.meta.env?.BASE_URL ?? '/'}assets/coverage/${file}`;
function store(scene: Scene): Templates {
  let value = cache.get(scene);
  if (!value) { value = { models: new Map(), loads: new Map(), revision: 0 }; cache.set(scene, value); scene.onDisposeObservable.addOnce(() => cache.delete(scene)); }
  return value;
}
export const coverageRevision = (scene: Scene): number => store(scene).revision;
export const hasCoverageModel = (scene: Scene, key: CoverageModel): boolean => store(scene).models.has(key);

/** Each source is baked once into a unit bounding box, with its feet on y=0 and centre at x=z=0. */
async function load(scene: Scene, key: CoverageModel): Promise<void> {
  const state = store(scene);
  try {
    const response = await fetch(coverageUrl(`${key}.glb`), { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const [{ LoadAssetContainerAsync }] = await Promise.all([import('@babylonjs/core/Loading/sceneLoader.js'), import('@babylonjs/loaders/glTF/index.js')]);
    if (scene.isDisposed) return;
    const container = await LoadAssetContainerAsync(bytes, scene, { pluginExtension: '.glb', name: key });
    if (scene.isDisposed) { container.dispose(); return; }
    const materials = new Map<object, StandardMaterial>();
    const meshes = container.meshes.filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0);
    for (const mesh of meshes) {
      const source = mesh.material as StandardMaterial & { albedoColor?: Color3; albedoTexture?: StandardMaterial['diffuseTexture']; metallic?: number };
      if (source) {
        let mat = materials.get(source);
        if (!mat) {
          mat = new StandardMaterial(`coverage-${key}-${source.name}`, scene);
          mat.diffuseColor = source.albedoColor?.toGammaSpace() ?? source.diffuseColor ?? Color3.White();
          mat.diffuseTexture = source.albedoTexture ?? source.diffuseTexture;
          mat.bumpTexture = source.bumpTexture;
          mat.alpha = source.alpha; mat.backFaceCulling = source.backFaceCulling;
          mat.specularColor = new Color3(.12, .12, .12); mat.emissiveColor = new Color3(.07, .07, .07);
          if (mat.diffuseTexture?.hasAlpha) mat.useAlphaFromDiffuseTexture = true;
          materials.set(source, mat);
        }
        mesh.material = mat;
      }
      const transform = mesh.computeWorldMatrix(true).clone();
      mesh.parent = null; mesh.skeleton = null;
      mesh.bakeTransformIntoVertices(transform);
      if (mesh.sideOrientation !== 1) { mesh.flipFaces(); mesh.sideOrientation = 1; }
      mesh.position.setAll(0); mesh.scaling.setAll(1); mesh.rotationQuaternion = null; mesh.rotation.setAll(0);
    }
    const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const mesh of meshes) {
      mesh.refreshBoundingInfo(); const bounds = mesh.getBoundingInfo().boundingBox;
      min.minimizeInPlace(bounds.minimum); max.maximizeInPlace(bounds.maximum);
    }
    const extent = max.subtract(min), centre = min.add(max).scale(.5); centre.y = min.y;
    const normalise = Matrix.Translation(-centre.x, -centre.y, -centre.z).multiply(Matrix.Scaling(1 / Math.max(.001, extent.x), 1 / Math.max(.001, extent.y), 1 / Math.max(.001, extent.z)));
    for (const mesh of meshes) {
      mesh.bakeTransformIntoVertices(normalise);
      if (!mesh.isVerticesDataPresent(VertexBuffer.NormalKind)) {
        const normals: number[] = [];
        VertexData.ComputeNormals(mesh.getVerticesData(VertexBuffer.PositionKind)!, mesh.getIndices()!, normals);
        mesh.setVerticesData(VertexBuffer.NormalKind, normals);
      }
      if (!mesh.isVerticesDataPresent(VertexBuffer.ColorKind)) mesh.setVerticesData(VertexBuffer.ColorKind, new Array(mesh.getTotalVertices() * 4).fill(1));
      if (!mesh.isVerticesDataPresent(VertexBuffer.UVKind)) mesh.setVerticesData(VertexBuffer.UVKind, new Array(mesh.getTotalVertices() * 2).fill(0));
      mesh.name = `coverage-template-${key}-${mesh.name}`;
      mesh.metadata = { coverageAsset: key, template: true, sourceExtent: extent.asArray() };
      mesh.isPickable = false; mesh.setEnabled(false); scene.addMesh(mesh);
      for (const kind of mesh.getVerticesDataKinds()) if (!['position', 'normal', 'uv', 'color'].includes(kind)) mesh.removeVerticesData(kind);
    }
    for (const mesh of container.meshes) if (!meshes.includes(mesh as Mesh)) mesh.dispose();
    for (const node of container.transformNodes) node.dispose();
    for (const mat of container.materials) mat.dispose(false, false);
    // Some source cars contain hundreds of tiny pieces. Batch bodies by material; retain separately named wheels.
    const groups = new Map<string, Mesh[]>();
    for (const mesh of meshes) {
      const group = /wheel/i.test(mesh.name) ? mesh.name : `${mesh.material?.uniqueId}`;
      const parts = groups.get(group) ?? []; parts.push(mesh); groups.set(group, parts);
    }
    const batched: Mesh[] = [];
    for (const parts of groups.values()) {
      if (parts.length === 1) { batched.push(parts[0]); continue; }
      const merged = Mesh.MergeMeshes(parts, true, true)!;
      merged.name = `coverage-template-${key}-body-${batched.length}`;
      merged.metadata = { coverageAsset: key, template: true, sourceExtent: extent.asArray() };
      merged.isPickable = false; merged.setEnabled(false); batched.push(merged);
    }
    state.models.set(key, batched); state.revision++;
  } catch (error) { if (!scene.isDisposed) console.warn(`Asset ${key}: dùng hình dự phòng.`, error); }
}

/** Four concurrent downloads; cache is scene-owned, failures leave all procedural fallbacks playable. */
export async function prepareCoverageAssets(scene: Scene, keys: readonly CoverageModel[] = COVERAGE_MODELS): Promise<void> {
  const state = store(scene), pending = [...keys];
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (pending.length && !scene.isDisposed) {
      const key = pending.shift()!;
      if (!state.loads.has(key)) state.loads.set(key, load(scene, key));
      await state.loads.get(key);
    }
  }));
}

/** Clones share geometry/materials and can be merged per chunk or pickup kind. Never dispose their shared materials. */
export function coverageParts(scene: Scene, key: CoverageModel, parent: TransformNode | null, size: readonly number[], name: string): Mesh[] | null {
  const source = store(scene).models.get(key);
  if (!source) return null;
  return source.map((mesh, i) => {
    const part = mesh.clone(`${name}-${i}`)!;
    part.parent = parent; part.scaling.set(size[0], size[1], size[2]);
    part.isPickable = false; part.setEnabled(true);
    part.metadata = { coverageAsset: key, sourceName: mesh.name, sourceExtent: mesh.metadata.sourceExtent };
    return part;
  });
}
