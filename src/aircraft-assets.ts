import type { Scene } from '@babylonjs/core/scene.js';
import type { AssetContainer } from '@babylonjs/core/assetContainer.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';

interface AircraftSet { container: AssetContainer | null; ready: Promise<void> }
const assets = new WeakMap<Scene, AircraftSet>();

/** One local aircraft per match scene; inventory previews do not request it. */
export function preloadAircraftAssets(scene: Scene): Promise<void> {
  const cached = assets.get(scene);
  if (cached) return cached.ready;
  const set: AircraftSet = { container: null, ready: Promise.resolve() };
  assets.set(scene, set);
  scene.onDisposeObservable.add(() => { set.container?.dispose(); assets.delete(scene); });
  set.ready = (async () => {
    const [{ LoadAssetContainerAsync }] = await Promise.all([import('@babylonjs/core/Loading/sceneLoader.js'), import('@babylonjs/loaders/glTF/index.js')]);
    const response = await fetch(`${import.meta.env?.BASE_URL ?? '/'}assets/aircraft/airplane.glb`, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (scene.isDisposed) return;
    const container = await LoadAssetContainerAsync(bytes, scene, { pluginExtension: '.glb', name: 'airplane' });
    if (scene.isDisposed) { container.dispose(); return; }
    // Keep the embedded authored texture. The game's lights use StandardMaterial
    // without a PBR environment map, so convert the surface, not its colour map.
    const replacements = new Map<object, StandardMaterial>();
    for (const mesh of container.meshes) {
      if (!mesh.material) continue;
      const source = mesh.material as typeof mesh.material & { albedoColor?: Color3; albedoTexture?: StandardMaterial['diffuseTexture'] };
      let material = replacements.get(source);
      if (!material) {
        material = new StandardMaterial(`aircraft-${source.name}`, scene);
        material.diffuseColor = source.albedoColor?.toGammaSpace() ?? Color3.White();
        material.diffuseTexture = source.albedoTexture ?? null;
        material.specularColor.set(.12, .12, .12);
        material.emissiveColor.set(.08, .08, .08);
        material.backFaceCulling = source.backFaceCulling;
        replacements.set(source, material);
      }
      mesh.material = material;
    }
    container.materials.forEach(material => material.dispose(false, false));
    container.materials = [...replacements.values()];
    set.container = container;
  })().catch(error => { if (!scene.isDisposed) console.warn('Không tải được máy bay; dùng model dự phòng.', error); });
  return set.ready;
}

export function instantiateAircraft(scene: Scene, parent: TransformNode) {
  const container = assets.get(scene)?.container;
  if (!container) return null;
  const wrapper = new TransformNode('aircraft-asset', scene);
  const entries = container.instantiateModelsToScene(name => `aircraft-${name}`, false, { doNotInstantiate: true });
  entries.rootNodes.forEach(node => { node.parent = wrapper; node.setEnabled(true); });
  const bounds = wrapper.getHierarchyBoundingVectors(true);
  const width = bounds.max.x - bounds.min.x;
  if (!Number.isFinite(width) || width < .01) { entries.dispose(); wrapper.dispose(); return null; }
  // This model's nose already points +Z in Babylon. Normalize at the origin,
  // then inherit the gameplay route's yaw and altitude from the parent.
  const scale = 34 / width;
  const centerX = (bounds.min.x + bounds.max.x) / 2, centerZ = (bounds.min.z + bounds.max.z) / 2;
  const lights = { left: new Vector3(Infinity, 0, 0), right: new Vector3(-Infinity, 0, 0), tail: new Vector3(0, -Infinity, 0) };
  const meshes = wrapper.getChildMeshes();
  for (const mesh of meshes) {
    const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
    if (!positions) continue;
    const matrix = mesh.computeWorldMatrix(true);
    for (let i = 0; i < positions.length; i += 3) {
      const point = Vector3.TransformCoordinates(Vector3.FromArray(positions, i), matrix);
      if (point.x < lights.left.x) lights.left.copyFrom(point);
      if (point.x > lights.right.x) lights.right.copyFrom(point);
      if (point.y > lights.tail.y) lights.tail.copyFrom(point);
    }
    mesh.isPickable = false; mesh.receiveShadows = false;
    mesh.metadata = { freeAsset: 'airplane' };
  }
  for (const point of Object.values(lights)) { point.x = (point.x - centerX) * scale; point.y = point.y * scale + .25; point.z = (point.z - centerZ) * scale; }
  wrapper.scaling.setAll(scale);
  wrapper.position.set(-centerX * scale, 0, -centerZ * scale);
  wrapper.parent = parent;
  return { wrapper, entries, lights };
}
