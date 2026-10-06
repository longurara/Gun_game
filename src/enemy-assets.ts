import type { Scene } from '@babylonjs/core/scene.js';
import type { AssetContainer } from '@babylonjs/core/assetContainer.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { ENEMY_MODELS } from './enemy-catalog';
import type { EnemyModel } from './enemy-catalog';
import { instantiateSwat, litMaterials } from './free-assets';

interface EnemySet { containers: Map<string, AssetContainer>; textures: Map<string, Texture>; ready: Promise<void> }
const sets = new WeakMap<Scene, EnemySet>();
const base = () => import.meta.env?.BASE_URL ?? '/';

/** Match scene only; inventory previews do not download the enemy library again. */
export function preloadEnemyAssets(scene: Scene): Promise<void> {
  const cached = sets.get(scene);
  if (cached) return cached.ready;
  const set: EnemySet = { containers: new Map(), textures: new Map(), ready: Promise.resolve() };
  sets.set(scene, set);
  scene.onDisposeObservable.add(() => {
    set.containers.forEach(container => container.dispose());
    set.textures.forEach(texture => texture.dispose());
    sets.delete(scene);
  });
  set.ready = (async () => {
    const [{ LoadAssetContainerAsync }] = await Promise.all([import('@babylonjs/core/Loading/sceneLoader.js'), import('@babylonjs/loaders/glTF/index.js')]);
    const files = [...new Set(ENEMY_MODELS.filter(model => model.id !== 'swat').map(model => model.file))];
    // Limit concurrent network/decode work while the match is starting.
    let next = 0;
    await Promise.all(Array.from({ length: 2 }, async () => {
      while (next < files.length && !scene.isDisposed) {
        const file = files[next++];
        try {
          const response = await fetch(base() + file, { signal: AbortSignal.timeout(12000) });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (scene.isDisposed) return;
          const container = await LoadAssetContainerAsync(bytes, scene, { pluginExtension: '.glb', name: file });
          if (scene.isDisposed) { container.dispose(); return; }
          litMaterials(container, scene);
          set.containers.set(file, container);
        } catch (error) {
          if (!scene.isDisposed) console.warn(`Không tải được nhân vật ${file}; dùng model dự phòng.`, error);
        }
      }
    }));
  })().catch(error => { if (!scene.isDisposed) console.warn('Dùng model quân địch dự phòng.', error); });
  return set.ready;
}

export function instantiateEnemy(scene: Scene, parent: TransformNode, actorId: string, model: EnemyModel) {
  if (model.id === 'swat') {
    const avatar = instantiateSwat(scene, parent, actorId);
    return avatar ? { ...avatar, wrapper: null, ownedMaterials: [] as StandardMaterial[], key: model.id } : null;
  }
  const set = sets.get(scene), container = set?.containers.get(model.file);
  if (!container) return null;
  const prefix = `${actorId}-avatar-${model.id}-`;
  const wrapper = new TransformNode(`${prefix}wrapper`, scene);
  const entries = container.instantiateModelsToScene(name => prefix + name, false, { doNotInstantiate: true });
  for (const node of entries.rootNodes) { node.parent = wrapper; node.setEnabled(true); }
  // Match the existing soldier height without altering gameplay hitboxes or actor coordinates.
  wrapper.computeWorldMatrix(true);
  const bounds = wrapper.getHierarchyBoundingVectors(true);
  const height = bounds.max.y - bounds.min.y;
  if (!Number.isFinite(height) || height < .01) { entries.dispose(); wrapper.dispose(); return null; }
  const scale = 1.78 / height;
  wrapper.scaling.setAll(scale);
  wrapper.position.y = -bounds.min.y * scale;
  // Normalize at the origin: actor terrain height, yaw and death tilt must not
  // affect the size or foot offset when detail first becomes available.
  wrapper.parent = parent;
  const nodes = wrapper.getChildTransformNodes(false);
  const nodeFor = (name: string) => nodes.find(node => node.name === prefix + name);
  const kenney = model.rig === 'kenney';
  const arms = ['L', 'R'].map((side, index) => ({
    upper: nodeFor(kenney ? `${index ? 'Right' : 'Left'}Arm` : `UpperArm.${side}`),
    lower: nodeFor(kenney ? `${index ? 'Right' : 'Left'}ForeArm` : `LowerArm.${side}`),
    end: kenney ? nodeFor(`${index ? 'Right' : 'Left'}Hand`) : nodeFor(`Wrist.${side}`) ?? nodeFor(`Index1.${side}`),
  }));
  const legs = ['L', 'R'].map((side, index) => ({
    upper: nodeFor(kenney ? `${index ? 'Right' : 'Left'}UpLeg` : `UpperLeg.${side}`),
    lower: nodeFor(kenney ? `${index ? 'Right' : 'Left'}Leg` : `LowerLeg.${side}`),
    end: nodeFor(kenney ? `${index ? 'Right' : 'Left'}Foot` : `LowerLeg.${side}_end`),
    foot: nodeFor(kenney ? `${index ? 'Right' : 'Left'}FootCtrl` : `Foot.${side}`),
  }));
  if (arms.some(arm => !arm.upper || !arm.lower || !arm.end) || legs.some(leg => !leg.upper || !leg.lower || !leg.end || !leg.foot)) {
    entries.dispose(); wrapper.dispose(); return null;
  }
  const ownedMaterials: StandardMaterial[] = [];
  if ('texture' in model && set) {
    let texture = set.textures.get(model.texture);
    if (!texture) { texture = new Texture(`${base()}assets/enemies/${model.texture}`, scene, false, false); set.textures.set(model.texture, texture); }
    for (const mesh of wrapper.getChildMeshes()) if (mesh.material instanceof StandardMaterial) {
      const material = mesh.material.clone(prefix + 'skin')!;
      material.diffuseTexture = texture;
      material.diffuseColor = Color3.White();
      material.emissiveColor = new Color3(.08, .08, .08);
      mesh.material = material; ownedMaterials.push(material);
    }
  }
  const rest = nodes.map(node => ({ node, position: node.position.clone(), rotation: node.rotationQuaternion?.clone() }));
  return { entries, arms, legs, rest, inverse: Matrix.Identity(), wrapper, ownedMaterials, key: model.id };
}
