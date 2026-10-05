import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import groundUrl from './assets/textures/ground-detail-v1.png?url';
import woodUrl from './assets/textures/wood-grain-v1.png?url';
import foliageUrl from './assets/textures/foliage-atlas-v2.png?url';
import barkUrl from './assets/textures/bark-v1.png?url';
import plasterUrl from './assets/textures/plaster-v1.webp?url';
import roofUrl from './assets/textures/roof-tiles-v1.webp?url';
import rockUrl from './assets/textures/rock-v1.webp?url';
import asphaltUrl from './assets/textures/asphalt-v1.webp?url';
import facadeUrl from './assets/textures/facade-v1.webp?url';

export const GENERATED_TEXTURES = { ground: groundUrl, wood: woodUrl, foliage: foliageUrl, bark: barkUrl, plaster: plasterUrl, roof: roofUrl, rock: rockUrl, asphalt: asphaltUrl, facade: facadeUrl } as const;

/** Keep the existing finish visible while an ImageGen albedo loads; cancel work when its owner is disposed. */
export function useGeneratedAlbedo(material: StandardMaterial, url: string, repeat = 1, level = 1): Texture {
  const fallback = material.diffuseTexture;
  let disposed = false;
  const candidate = new Texture(url, material.getScene(), false, true, Texture.TRILINEAR_SAMPLINGMODE,
    () => {
      if (disposed) { candidate.dispose(); return; }
      material.diffuseTexture = candidate;
      fallback?.dispose();
    },
    () => {
      // The original procedural texture (or flat colour) remains usable after a failed request.
      candidate.dispose();
    });
  candidate.name = 'imagegen-' + Object.keys(GENERATED_TEXTURES).find(key => GENERATED_TEXTURES[key as keyof typeof GENERATED_TEXTURES] === url);
  candidate.wrapU = candidate.wrapV = Texture.WRAP_ADDRESSMODE;
  candidate.uScale = candidate.vScale = repeat;
  candidate.level = level;
  candidate.anisotropicFilteringLevel = 8;
  material.onDisposeObservable.addOnce(() => { disposed = true; candidate.dispose(); });
  return candidate;
}
