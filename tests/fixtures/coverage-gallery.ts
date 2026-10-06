import '@babylonjs/core/Meshes/instancedMesh.js';
import { Engine } from '@babylonjs/core/Engines/engine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Soldier } from '../../src/soldier';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import { Color4 } from '@babylonjs/core/Maths/math.color.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { coverageParts, prepareCoverageAssets, COVERAGE_MODELS } from '../../src/coverage-assets';
import type { CoverageModel } from '../../src/coverage-assets';
import { createWeaponModel } from '../../src/weapon-models';
import type { WeaponType } from '../../src/types';
import { vfxCard, vfxMaterial } from '../../src/coverage-vfx';

const engine = new Engine(document.querySelector('canvas')!, true), scene = new Scene(engine);
scene.clearColor = new Color4(.23, .29, .33, 1);
const camera = new FreeCamera('gallery-camera', new Vector3(0, 12, -16), scene);
camera.setTarget(new Vector3(0, .5, 3));
new HemisphericLight('light', new Vector3(0, 1, 0), scene).intensity = 1.2;
engine.runRenderLoop(() => scene.render());
const loading = prepareCoverageAssets(scene);
const roots: TransformNode[] = [];
function clear() { for (const root of roots.splice(0)) root.dispose(false, false); }
function show(keys: CoverageModel[]) {
  clear(); document.querySelector('#labels')!.textContent = keys.join(' · ');
  keys.forEach((key, i) => {
    const root = new TransformNode(`display-${key}`, scene); roots.push(root);
    root.position.set((i % 4 - 1.5) * 3.2, 0, Math.floor(i / 4) * 3.2);
    const source = scene.meshes.find(mesh => mesh.metadata?.template && mesh.metadata?.coverageAsset === key)!;
    const extent = source.metadata.sourceExtent as number[], scale = 2 / Math.max(...extent);
    coverageParts(scene, key, root, extent.map(n => n * scale), `display-${key}`);
  });
}
function weapons(ids: WeaponType[]) {
  document.querySelector('#labels')!.textContent = ids.join(' · ');
  clear(); ids.forEach((id, i) => {
    const root = new TransformNode(`weapon-display-${id}`, scene); roots.push(root);
    root.position.set((i - 1) * 3, 0, 1); root.scaling.setAll(3);
    createWeaponModel(id, scene, root, 'gallery');
  });
}
function effects() {
  document.querySelector('#labels')!.textContent = 'Smoke · Flame · Muzzle flash · Explosion · Airdrop flare';
  clear(); ['smoke','flame','flash','fire','puff'].forEach((kind, i) => {
    const root = new TransformNode(`effect-display-${kind}`, scene); roots.push(root); root.position.set((i % 4 - 1.5) * 3, 1, Math.floor(i / 4) * 3);
    vfxCard(scene, kind, 2, vfxMaterial(scene, kind as 'smoke')).parent = root;
  });
}
(window as any).__COVERAGE_GALLERY__ = { engine, scene, loading, show, weapons, effects, makeSoldier: () => new Soldier(scene, 'late-test', false, { addShadowCaster() {}, removeShadowCaster() {} } as unknown as ShadowGenerator), keys: COVERAGE_MODELS };
await loading;
show(['crossbow','grenadeLauncher','rocketLauncher','parachute','k-crate-wide']);
