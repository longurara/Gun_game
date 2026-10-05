import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase.js';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine.js';
import type { SubMesh } from '@babylonjs/core/Meshes/subMesh.js';

/** Wind and distance fade on the GPU, restricted to thin-instanced grass on the shared atlas. */
export class GrassWind extends MaterialPluginBase {
  time = 0;
  x = 0;
  z = 0;
  radius = 34;

  constructor(material: StandardMaterial) {
    super(material, 'GrassWind', 200);
    this.registerForExtraEvents = true;
    this._enable(true);
  }

  override getUniforms() { return { externalUniforms: ['grassWind'] }; }

  override hardBindForSubMesh(_buffer: UniformBuffer, _scene: Scene, _engine: AbstractEngine, subMesh: SubMesh): void {
    subMesh.effect?.setFloat4('grassWind', this.time, this.x, this.z, this.radius);
  }

  override getCustomCode(shaderType: string) {
    if (shaderType !== 'vertex') return null;
    return {
      CUSTOM_VERTEX_DEFINITIONS: 'uniform vec4 grassWind;',
      CUSTOM_VERTEX_UPDATE_WORLDPOS: `
#ifdef THIN_INSTANCES
vec2 grassRoot = finalWorld[3].xz;
float grassFade = 1.0 - smoothstep(grassWind.w - 6.0, grassWind.w - 2.0, length(grassRoot - grassWind.yz));
float grassBend = pow(clamp(positionUpdated.y / 0.78, 0.0, 1.0), 2.0);
float grassPhase = dot(grassRoot, vec2(0.37, 0.21));
float grassSway = sin(grassWind.x * 1.7 + grassPhase) * 0.11 + sin(grassWind.x * 2.9 + grassPhase * 2.1) * 0.025;
worldPos.y = mix(finalWorld[3].y, worldPos.y, grassFade);
worldPos.xz += vec2(0.9, 0.35) * grassSway * grassBend * grassFade;
#endif`,
    };
  }
}
