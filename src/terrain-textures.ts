import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture.js';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import type { MaterialDefines } from '@babylonjs/core/Materials/materialDefines.js';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import { GENERATED_TEXTURES } from './generated-textures';

export const TERRAIN_WEIGHTS_ATTRIBUTE = 'terrainWeights';
const SAMPLERS = ['terrainGrassSampler', 'terrainDirtSampler', 'terrainSandSampler', 'terrainRockSampler'];
type BiomeDefines = MaterialDefines & { TERRAIN_BIOMES: boolean; TERRAIN_TRIPLANAR: boolean };

/** Add biome albedos to StandardMaterial, retaining its shadows, fog and lighting. */
export class TerrainTextureBlend extends MaterialPluginBase {
  readonly layers: Texture[];
  private failed = false;
  private disposed = false;

  constructor(material: StandardMaterial, private readonly triplanar = true) {
    super(material, 'terrain-biomes', 200, { TERRAIN_BIOMES: false, TERRAIN_TRIPLANAR: false }, true, true);
    this.doNotSerialize = true;
    this.layers = [GENERATED_TEXTURES.terrainGrass, GENERATED_TEXTURES.terrainDirt, GENERATED_TEXTURES.terrainSand, GENERATED_TEXTURES.terrainRock].map((url, i) => {
      const texture = new Texture(url, material.getScene(), false, true, Texture.TRILINEAR_SAMPLINGMODE,
        () => { if (!this.disposed) this.markAllDefinesAsDirty(); },
        () => { if (!this.disposed) { this.failed = true; this.markAllDefinesAsDirty(); } });
      texture.name = 'imagegen-terrain-' + ['grass', 'dirt', 'sand', 'rock'][i];
      texture.wrapU = texture.wrapV = Texture.WRAP_ADDRESSMODE;
      texture.anisotropicFilteringLevel = 8;
      return texture;
    });
  }

  prepareDefines(defines: MaterialDefines, _scene: Scene, mesh: AbstractMesh): void {
    const flags = defines as BiomeDefines;
    // Never hide the terrain while images are pending or unavailable.
    flags.TERRAIN_BIOMES = !this.failed && this.layers.every(texture => texture.isReady()) && mesh.isVerticesDataPresent(TERRAIN_WEIGHTS_ATTRIBUTE);
    flags.TERRAIN_TRIPLANAR = flags.TERRAIN_BIOMES && this.triplanar;
  }

  getAttributes(attributes: string[], _scene: Scene, mesh: AbstractMesh): void {
    if (mesh.isVerticesDataPresent(TERRAIN_WEIGHTS_ATTRIBUTE)) attributes.push(TERRAIN_WEIGHTS_ATTRIBUTE);
  }
  getSamplers(samplers: string[]): void { samplers.push(...SAMPLERS); }
  bindForSubMesh(buffer: UniformBuffer): void {
    this.layers.forEach((texture, i) => buffer.setTexture(SAMPLERS[i], texture));
  }
  getActiveTextures(textures: BaseTexture[]): void { textures.push(...this.layers); }
  hasTexture(texture: BaseTexture): boolean { return this.layers.includes(texture as Texture); }
  dispose(): void {
    this.disposed = true;
    this.layers.forEach(texture => texture.dispose());
  }

  getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType === 'vertex') return {
      CUSTOM_VERTEX_DEFINITIONS: `#ifdef TERRAIN_BIOMES
attribute vec4 terrainWeights;
varying vec4 vTerrainWeights;
#endif`,
      CUSTOM_VERTEX_MAIN_END: `#ifdef TERRAIN_BIOMES
vTerrainWeights = terrainWeights;
#endif`,
    };
    if (shaderType !== 'fragment') return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef TERRAIN_BIOMES
varying vec4 vTerrainWeights;
uniform sampler2D terrainGrassSampler;
uniform sampler2D terrainDirtSampler;
uniform sampler2D terrainSandSampler;
uniform sampler2D terrainRockSampler;
#endif`,
      CUSTOM_FRAGMENT_UPDATE_DIFFUSE: `#ifdef TERRAIN_BIOMES
vec4 biomeWeights = max(vTerrainWeights, vec4(0.0));
biomeWeights /= max(dot(biomeWeights, vec4(1.0)), 0.0001);
vec3 grassAlbedo = texture2D(terrainGrassSampler, vPositionW.xz / 2.5).rgb;
vec3 dirtAlbedo = texture2D(terrainDirtSampler, vPositionW.xz / 3.0).rgb;
vec3 sandAlbedo = texture2D(terrainSandSampler, vPositionW.xz / 3.0).rgb;
#ifdef TERRAIN_TRIPLANAR
// Project rock from three axes to avoid stretching on steep faces.
vec3 rockAxes = pow(max(abs(normalW), vec3(0.001)), vec3(4.0));
rockAxes /= dot(rockAxes, vec3(1.0));
vec3 rockAlbedo = texture2D(terrainRockSampler, vPositionW.yz / 4.0).rgb * rockAxes.x
  + texture2D(terrainRockSampler, vPositionW.xz / 4.0).rgb * rockAxes.y
  + texture2D(terrainRockSampler, vPositionW.xy / 4.0).rgb * rockAxes.z;
#else
vec3 rockAlbedo = texture2D(terrainRockSampler, vPositionW.xz / 4.0).rgb;
#endif
baseColor.rgb = (grassAlbedo * biomeWeights.x + dirtAlbedo * biomeWeights.y
  + sandAlbedo * biomeWeights.z + rockAlbedo * biomeWeights.w) * 1.25;
#ifdef VERTEXCOLOR
baseColor.rgb *= vColor.rgb;
#endif
#endif`,
    };
  }
}
