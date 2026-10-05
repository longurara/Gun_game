import type { Scene } from '@babylonjs/core/scene.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { paintSurface } from './surface-textures';
import type { SurfaceKind } from './surface-textures';
import { GENERATED_TEXTURES, useGeneratedAlbedo } from './generated-textures';

/** Every finish a procedural model can ask for. Textured finishes share one material (and one texture) per scene. */
export type SurfaceFinish = SurfaceKind | 'glass' | 'glow' | 'skin' | 'plain';

interface Spec { size: number; specular: number; power: number; bump: number; lift: number }
const TEXTURED: Record<SurfaceKind, Spec> = {
  metal: { size: 512, specular: 0.62, power: 52, bump: 0.55, lift: 0.27 },
  poly: { size: 256, specular: 0.16, power: 18, bump: 1.0, lift: 0.22 },
  wood: { size: 512, specular: 0.17, power: 32, bump: 0.18, lift: 0.035 },
  camoW: { size: 512, specular: 0.08, power: 10, bump: 0.6, lift: 0.17 }, camoD: { size: 512, specular: 0.08, power: 10, bump: 0.6, lift: 0.17 },
  camoU: { size: 512, specular: 0.08, power: 10, bump: 0.6, lift: 0.17 }, camoS: { size: 512, specular: 0.08, power: 10, bump: 0.6, lift: 0.17 },
  camoMono: { size: 512, specular: 0.05, power: 8, bump: 0.7, lift: 0.13 },
  weave: { size: 256, specular: 0.04, power: 6, bump: 0.9, lift: 0.13 },
};

const cache = new WeakMap<Scene, Map<string, StandardMaterial>>();

function texture(scene: Scene, name: string, size: number, data: Uint8ClampedArray): DynamicTexture {
  const t = new DynamicTexture(name, { width: size, height: size }, scene, true);
  const context = t.getContext() as unknown as CanvasRenderingContext2D;
  context.putImageData(new ImageData(new Uint8ClampedArray(data), size, size), 0, 0);
  t.update(true);
  t.wrapU = Texture.WRAP_ADDRESSMODE; t.wrapV = Texture.WRAP_ADDRESSMODE;
  t.anisotropicFilteringLevel = 8;
  return t;
}

/** The scene-wide material for a finish; vertex colours (and instance colours) tint it. */
export function surfaceMaterial(scene: Scene, finish: SurfaceFinish): StandardMaterial {
  let materials = cache.get(scene);
  if (!materials) { materials = new Map(); cache.set(scene, materials); scene.onDisposeObservable.add(() => cache.delete(scene)); }
  const existing = materials.get(finish);
  if (existing && scene.materials.includes(existing)) return existing;
  const material = new StandardMaterial(`surface-${finish}`, scene);
  material.diffuseColor = new Color3(1, 1, 1);
  if (finish in TEXTURED) {
    const spec = TEXTURED[finish as SurfaceKind];
    const surface = paintSurface(finish as SurfaceKind, spec.size);
    material.diffuseTexture = texture(scene, `surface-${finish}-albedo`, spec.size, surface.albedo);
    const bump = texture(scene, `surface-${finish}-normal`, spec.size, surface.normal);
    bump.gammaSpace = false;
    bump.level = spec.bump;
    material.bumpTexture = bump;
    material.specularColor = new Color3(spec.specular, spec.specular, spec.specular * 1.02);
    material.specularPower = spec.power;
    // Lifts the shaded side so dark finishes stay readable outdoors.
    material.emissiveColor = new Color3(spec.lift, spec.lift, spec.lift * 1.03);
    if (finish === 'wood') useGeneratedAlbedo(material, GENERATED_TEXTURES.wood, 1, 1.12);
  } else if (finish === 'glass') {
    material.specularColor = new Color3(1, 1, 1); material.specularPower = 120;
    material.emissiveColor = new Color3(0.2, 0.34, 0.36);
  } else if (finish === 'glow') {
    material.disableLighting = true; material.emissiveColor = new Color3(1, 1, 1); material.specularColor = Color3.Black();
  } else {
    // skin / plain: smooth, slightly waxy.
    material.specularColor = new Color3(finish === 'skin' ? 0.1 : 0.05, finish === 'skin' ? 0.08 : 0.05, 0.05); material.specularPower = finish === 'skin' ? 14 : 8;
    material.emissiveColor = new Color3(0.12, 0.12, 0.12);
  }
  materials.set(finish, material);
  return material;
}
