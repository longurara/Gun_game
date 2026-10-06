import type { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder.js';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { coverageUrl } from './coverage-assets';

/** Billboards have real alpha textures and share one immutable material per scene/style. */
const cache = new WeakMap<Scene, Map<string, StandardMaterial>>();
export function vfxMaterial(scene: Scene, kind: 'smoke' | 'flame' | 'flash' | 'fire' | 'puff', color = '#ffffff'): StandardMaterial {
  let byKind = cache.get(scene);
  if (!byKind) { byKind = new Map(); cache.set(scene, byKind); scene.onDisposeObservable.addOnce(() => cache.delete(scene)); }
  const key = `${kind}-${color}`;
  let material = byKind.get(key);
  if (!material) {
    material = new StandardMaterial(`coverage-vfx-${key}`, scene);
    const texture = new Texture(coverageUrl(`${kind}.png`), scene);
    texture.hasAlpha = true; material.diffuseTexture = texture; material.useAlphaFromDiffuseTexture = true;
    material.diffuseColor = Color3.FromHexString(color); material.emissiveColor = material.diffuseColor.scale(kind === 'smoke' || kind === 'puff' ? .4 : 1);
    material.specularColor = Color3.Black(); material.backFaceCulling = false;
    material.disableLighting = kind !== 'smoke' && kind !== 'puff';
    material.alphaMode = kind === 'flash' || kind === 'fire' ? 1 : 2;
    byKind.set(key, material);
  }
  return material;
}
export function vfxCard(scene: Scene, name: string, size: number, material: StandardMaterial): Mesh {
  const card = CreatePlane(name, { size, sideOrientation: Mesh.DOUBLESIDE }, scene);
  card.billboardMode = Mesh.BILLBOARDMODE_ALL; card.material = material; card.isPickable = false;
  card.metadata = { coverageVfx: true };
  return card;
}

export function coverageSky(scene: Scene): Mesh {
  const sky = CreateSphere('flat-map-sky', { diameter: 500, segments: 24, sideOrientation: Mesh.BACKSIDE }, scene);
  const material = new StandardMaterial('flat-map-sky', scene);
  material.disableLighting = true; material.emissiveColor = new Color3(.68, .78, .88);
  material.diffuseColor = Color3.Black(); material.fogEnabled = false; material.disableDepthWrite = true;
  const texture = new Texture(coverageUrl('sky-day.png'), scene, false, false, Texture.BILINEAR_SAMPLINGMODE,
    () => { if (!sky.isDisposed()) { material.emissiveTexture = texture; material.emissiveColor = Color3.White(); } }, () => texture.dispose());
  sky.material = material; sky.infiniteDistance = true; sky.isPickable = false;
  return sky;
}
