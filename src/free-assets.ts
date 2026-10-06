import type { Scene } from '@babylonjs/core/scene.js';
import type { AssetContainer } from '@babylonjs/core/assetContainer.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import type { WeaponClass } from './types';

/** Local, CC0 assets. Containers and baked gun meshes belong to one scene, never to an actor. */
export interface AssetGun { meshes: Mesh[]; muzzle: [number, number, number]; grip: [number, number, number]; fore: [number, number, number] }
interface AssetSet { guns: Map<number, AssetGun>; swat: AssetContainer | null; ready: Promise<void> }
const assets = new WeakMap<Scene, AssetSet>();
const files = [3, 5, 6, 7, 9, 14, 17, 18, 19, 20, 22, 23, 24];
const lengths: Record<number, number> = { 3: .85, 5: 1.05, 6: 1, 7: .32, 9: .4, 14: .9, 17: .65, 18: 1.25, 19: 1.2, 20: 1.2, 22: .6, 23: .8, 24: 1.05 };

/** Use the authored colours with our existing lighting; these older FBX exports have no environment map. */
export function litMaterials(container: AssetContainer, scene: Scene): void {
  const replacements = new Map<object, StandardMaterial>();
  for (const mesh of container.meshes) {
    if (!mesh.material) continue;
    const source = mesh.material as typeof mesh.material & { albedoColor?: Color3 };
    let material = replacements.get(source);
    if (!material) {
      material = new StandardMaterial(`free-${source.name}`, scene);
      material.diffuseColor = source.albedoColor?.toGammaSpace() ?? new Color3(.3, .35, .4);
      material.specularColor = new Color3(.12, .12, .12);
      material.specularPower = 32;
      material.emissiveColor = material.diffuseColor.scale(.13);
      replacements.set(source, material);
    }
    mesh.material = material;
  }
  for (const material of container.materials) material.dispose();
  container.materials = [...replacements.values()];
}

function bakeGun(container: AssetContainer, id: number, scene: Scene): AssetGun {
  litMaterials(container, scene);
  const meshes = container.meshes.filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0);
  let minX = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const mesh of meshes) {
    mesh.computeWorldMatrix(true);
    const box = mesh.getBoundingInfo().boundingBox;
    minX = Math.min(minX, box.minimumWorld.x); maxX = Math.max(maxX, box.maximumWorld.x);
    maxY = Math.max(maxY, box.maximumWorld.y);
  }
  const scale = lengths[id] / (maxX - minX);
  // The imported FBX guns face -X in Babylon's left-handed scene. Bake them along +Z, in metres.
  const alignment = Matrix.RotationY(Math.PI / 2).multiply(Matrix.Scaling(scale, scale, scale));
  for (const mesh of meshes) {
    const world = mesh.getWorldMatrix().clone();
    mesh.parent = null;
    mesh.bakeTransformIntoVertices(world.multiply(alignment));
    if (mesh.sideOrientation !== 1) { mesh.flipFaces(); mesh.sideOrientation = 1; }
    mesh.setVerticesData(VertexBuffer.ColorKind, new Array(mesh.getTotalVertices() * 4).fill(1));
    if (!mesh.isVerticesDataPresent(VertexBuffer.UVKind)) mesh.setVerticesData(VertexBuffer.UVKind, new Array(mesh.getTotalVertices() * 2).fill(0));
    mesh.position.setAll(0); mesh.scaling.setAll(1); mesh.rotationQuaternion = null; mesh.rotation.setAll(0);
    mesh.name = `free-gun-${id}-${mesh.name}`;
    mesh.isPickable = false; mesh.setEnabled(false);
    scene.addMesh(mesh);
  }
  for (const mesh of container.meshes) if (!meshes.includes(mesh as Mesh)) mesh.dispose(false, false);
  for (const node of container.transformNodes) node.dispose(false, false);
  return { meshes, muzzle: [0, maxY * scale * .85, -minX * scale], grip: [0, -.1, 0], fore: [0, -.04, id === 7 || id === 9 ? .04 : .28] };
}

export function preloadFreeAssets(scene: Scene): Promise<void> {
  const cached = assets.get(scene);
  if (cached) return cached.ready;
  const set: AssetSet = { guns: new Map(), swat: null, ready: Promise.resolve() };
  assets.set(scene, set);
  scene.onDisposeObservable.add(() => { set.swat?.dispose(); assets.delete(scene); });
  set.ready = (async () => {
    const [{ LoadAssetContainerAsync }] = await Promise.all([
      import('@babylonjs/core/Loading/sceneLoader.js'), import('@babylonjs/loaders/glTF/index.js'),
    ]);
    await Promise.all(['swat', ...files.map(id => `gun-${id}`)].map(async name => {
      try {
        const response = await fetch(`${import.meta.env?.BASE_URL ?? '/'}assets/free/${name}.glb`, { signal: AbortSignal.timeout(12000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (scene.isDisposed) return;
        const container = await LoadAssetContainerAsync(bytes, scene, { pluginExtension: '.glb', name });
        if (scene.isDisposed) { container.dispose(); return; }
        if (name === 'swat') { litMaterials(container, scene); set.swat = container; }
        else set.guns.set(Number(name.slice(4)), bakeGun(container, Number(name.slice(4)), scene));
      } catch (error) {
        if (!scene.isDisposed) console.warn(`Không tải được ${name}; dùng mô hình dự phòng.`, error);
      }
    }));
  })().catch(error => { console.warn('Dùng mô hình dự phòng vì không tải được thư viện GLB.', error); });
  return set.ready;
}

export function freeGun(scene: Scene, kind: WeaponClass, look: string): AssetGun | undefined {
  let id: number;
  if (kind === 'pistol') id = look.includes('revolver') ? 9 : 7;
  else if (kind === 'shotgun') id = look.startsWith('pump') ? 14 : 3;
  else if (kind === 'smg') id = look.includes('fold') ? 17 : 22;
  else if (kind === 'sniper') id = 19;
  else if (kind === 'amr') id = 18;
  else if (kind === 'dmr') id = 20;
  else if (kind === 'br') id = 5;
  else if (kind === 'lmg') id = 24;
  else if (kind === 'ar') id = look.includes('bullpup') ? 23 : look.includes('wood') ? 5 : 6;
  else return undefined;
  return assets.get(scene)?.guns.get(id);
}

export function instantiateSwat(scene: Scene, parent: TransformNode, id: string) {
  const container = assets.get(scene)?.swat;
  if (!container) return null;
  const entries = container.instantiateModelsToScene(name => `${id}-swat-${name}`, false, { doNotInstantiate: true });
  for (const node of entries.rootNodes) { node.parent = parent; node.setEnabled(true); }
  const nodes = parent.getChildTransformNodes(false).filter(n => n.name.includes('-swat-'));
  const nodeFor = (name: string) => nodes.find(n => n.name.endsWith(`-${name}`));
  const arms = ['L', 'R'].map(side => ({ upper: nodeFor(`UpperArm.${side}`), lower: nodeFor(`LowerArm.${side}`), end: nodeFor(`Wrist.${side}`) }));
  const legs = ['L', 'R'].map(side => ({ upper: nodeFor(`UpperLeg.${side}`), lower: nodeFor(`LowerLeg.${side}`), end: nodeFor(`LowerLeg.${side}_end`), foot: nodeFor(`Foot.${side}`) }));
  const rest = nodes.map(node => ({ node, position: node.position.clone(), rotation: node.rotationQuaternion?.clone() }));
  return { entries, arms, legs, rest, inverse: Matrix.Identity() };
}
