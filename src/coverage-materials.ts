import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import { GENERATED_TEXTURES, useGeneratedAlbedo } from './generated-textures';

/** Palette stays intact; neutral textures add surface detail to the previously flat fallback meshes. */
export function applyCoverageSurface(material: StandardMaterial, name: string): void {
  let key: keyof typeof GENERATED_TEXTURES | undefined;
  if (/wood|crate|door$/.test(name)) key = 'wood';
  else if (/canopy|cloth|canvas|seat|loot-(vest|pack)|vest-strap/.test(name)) key = 'weave';
  else if (/tyre|rubber|gear-dark|melee-dark/.test(name)) key = 'poly';
  else if (/plaster|concrete/.test(name)) key = 'plaster';
  else if (/roof/.test(name)) key = 'roof';
  else if (/asphalt|^road$/.test(name)) key = 'asphalt';
  else if (/grass|hills/.test(name)) key = 'terrainGrass';
  else if (/earth/.test(name)) key = 'terrainDirt';
  else if (/stone|rock/.test(name)) key = 'rock';
  else if (/trunk/.test(name)) key = 'bark';
  else if (/metal|chrome|cage|fence|trim|burnt|paint|helmet-rim|grenade-(shell|rocket|frag|smoke|flash)|loot-helmet|loot-(scope|suppressor|compensator|vgrip|agrip|extmag|pan|machete|crowbar|sickle)/.test(name)) key = 'metal';
  if (key) useGeneratedAlbedo(material, GENERATED_TEXTURES[key], /grass|earth|asphalt|^road$/.test(name) ? 12 : 1, 1.05);
  else if (/^loot-/.test(name) && !name.includes('ring')) {
    const texture = new DynamicTexture(`label-${name}`, { width: 256, height: 256 }, material.getScene(), false);
    const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
    ctx.fillStyle = '#e4e0d1'; ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#555b53'; ctx.fillRect(0, 18, 256, 22); ctx.fillRect(0, 216, 256, 22);
    ctx.font = 'bold 26px sans-serif'; ctx.textAlign = 'center';
    const label = name.slice(5).replace('Ammo', '').toUpperCase();
    ctx.fillText(label, 128, 122, 232); ctx.font = '14px sans-serif'; ctx.fillText('LASTLIGHT • FIELD KIT', 128, 151);
    if (/medkit|firstaid/.test(name)) { ctx.fillStyle = '#bb3b32'; ctx.fillRect(108, 48, 40, 60); ctx.fillRect(98, 68, 60, 20); }
    texture.update(); material.diffuseTexture = texture;
  }
}
