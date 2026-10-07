import type { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { mergeAssetMeshes } from './merge-asset-meshes';

export const COVERAGE_MODELS = [
  'motorcycle', 'scooter', 'buggy', 'jeep', 'minibus', 'backpack', 'firstaid', 'molotov', 'pan', 'machete', 'crowbar', 'sickle',
  'crossbow', 'grenadeLauncher', 'rocketLauncher', 'bandage', 'energy', 'painkiller', 'parachute',
  'k-sedan', 'k-sedan-sports', 'k-truck', 'k-van', 'k-wheel-default', 'k-wheel-racing', 'k-box',
  'k-scope-small', 'k-scope-large-a', 'k-silencer-small', 'k-grenade-a', 'k-grenade-b', 'k-crate-wide',
  'k-wall', 'k-floor', 'k-bedBunk', 'k-bedSingle', 'k-desk', 'k-chair', 'k-bookcaseOpen',
  'k-shipping-container-a', 'k-detail-tank-large', 'k-chimney-large', 'k-pipe-large-long', 'k-box-large',
  'k-column', 'k-gutter-vertical', 'k-roof-flat-awning-a', 'k-detail-ac-a', 'k-chimney-small',
  'k-barrel', 'k-chest', 'k-tree_pineDefaultA', 'k-tree_oak', 'k-rock_largeA',
  'k-urban-wall', 'k-urban-roof', 'k-scaffold', 'k-timber-wall', 'k-town-roof', 'k-hip-roof', 'k-mill-blades', 'k-town-fountain',
  'k-dungeon-wall',
  'k-crypt-small', 'k-crypt-roof', 'k-crypt-door', 'k-obelisk', 'k-castle-wall', 'k-fort-wall', 'k-water-tower',
] as const;
export type CoverageModel = typeof COVERAGE_MODELS[number];
/** Neutral finishes for architectural details; kit atlas colors otherwise clash with the house palette. */
const architectureColors: Partial<Record<CoverageModel, string>> = {
  'k-column': '#716b5b', 'k-gutter-vertical': '#586052', 'k-roof-flat-awning-a': '#4e584b',
  'k-detail-ac-a': '#a8ada1', 'k-chimney-small': '#787367',
  'k-town-roof': '#65634d', 'k-hip-roof': '#5d6554', 'k-crypt-small': '#929486', 'k-crypt-roof': '#646b5e',
  'k-crypt-door': '#69503b', 'k-obelisk': '#9d9d8c', 'k-fort-wall': '#838876', 'k-castle-wall': '#8a8b75', 'k-dungeon-wall': '#777b70',
};
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
    const roofFinish = key === 'k-town-roof' || key === 'k-hip-roof' ? await import('./generated-textures') : null;
    const materials = new Map<object, StandardMaterial>();
    const meshes = [...new Set(container.meshes)].filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0);
    // Capture every primitive before baking: glTF accessors may share raw arrays even across distinct geometries.
    const snapshots = meshes.map(mesh => ({
      mesh, transform: mesh.computeWorldMatrix(true).clone(),
      buffers: mesh.getVerticesDataKinds().map(kind => ({ kind, data: Array.from(mesh.getVerticesData(kind)!) })),
      indices: mesh.getIndices() ? Array.from(mesh.getIndices()!) : null,
    }));
    for (const { mesh, transform, buffers, indices } of snapshots) {
      const source = mesh.material as StandardMaterial & { albedoColor?: Color3; albedoTexture?: StandardMaterial['diffuseTexture']; metallic?: number };
      if (source) {
        let mat = materials.get(source);
        if (!mat) {
          mat = new StandardMaterial(`coverage-${key}-${source.name}`, scene);
          mat.diffuseColor = source.albedoColor?.toGammaSpace() ?? source.diffuseColor ?? Color3.White();
          mat.diffuseTexture = source.albedoTexture ?? source.diffuseTexture;
          mat.bumpTexture = source.bumpTexture;
          if (architectureColors[key]) {
            mat.diffuseTexture = null;
            mat.diffuseColor = Color3.FromHexString(architectureColors[key]!);
          }
          if (roofFinish) roofFinish.useGeneratedAlbedo(mat, roofFinish.GENERATED_TEXTURES.roof, 1, 1.1);
          if (key === 'k-timber-wall') mat.diffuseColor = mat.diffuseColor.multiply(new Color3(0.78, 0.72, 0.65));
          mat.alpha = source.alpha; mat.backFaceCulling = source.backFaceCulling;
          mat.specularColor = new Color3(.12, .12, .12); mat.emissiveColor = new Color3(.07, .07, .07);
          if (mat.diffuseTexture?.hasAlpha) mat.useAlphaFromDiffuseTexture = true;
          materials.set(source, mat);
        }
        mesh.material = mat;
      }
      mesh.makeGeometryUnique();
      for (const { kind, data } of buffers) mesh.setVerticesData(kind, data);
      if (indices) mesh.setIndices(indices);
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
      if (roofFinish) {
        const positions = mesh.getVerticesData(VertexBuffer.PositionKind)!, normals = mesh.getVerticesData(VertexBuffer.NormalKind)!, uvs: number[] = [];
        for (let i = 0; i < positions.length; i += 3) {
          const [x, y, z] = positions.slice(i, i + 3), [nx, ny, nz] = normals.slice(i, i + 3).map(Math.abs);
          if (ny >= nx && ny >= nz) uvs.push((x + 0.5) * 4, (z + 0.5) * 4);
          else if (nx > nz) uvs.push((z + 0.5) * 4, y * 2);
          else uvs.push((x + 0.5) * 4, y * 2);
        }
        mesh.setVerticesData(VertexBuffer.UVKind, uvs);
      }
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
      const merged = mergeAssetMeshes(parts, false)!;
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
