import type { AssetContainer } from '@babylonjs/core/assetContainer.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';

/** Split the authored helmet shell from the mask/straps without changing its skin weights.
 * The SWAT export uses Z as its vertical vertex axis. Its highest connected surface is
 * the helmet; welding positions also joins vertices split at hard normal/UV seams.
 */
export function separateSwatHelmet(container: AssetContainer): void {
  const head = container.meshes.find((mesh): mesh is Mesh => mesh instanceof Mesh
    && mesh.name.startsWith('Swat_Head') && mesh.material?.name === 'free-Swat_Black');
  const positions = head?.getVerticesData(VertexBuffer.PositionKind);
  const indices = head?.getIndices();
  if (!head || !positions || !indices?.length) return;
  const keys: string[] = [], neighbours = new Map<string, Set<string>>();
  let top = '', height = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const key = [positions[i], positions[i + 1], positions[i + 2]].map(v => Math.round(v * 1e7)).join(':');
    keys.push(key);
    if (positions[i + 2] > height) { height = positions[i + 2]; top = key; }
  }
  for (let i = 0; i < indices.length; i += 3) {
    const triangle = [keys[indices[i]], keys[indices[i + 1]], keys[indices[i + 2]]];
    for (const key of triangle) {
      let adjacent = neighbours.get(key);
      if (!adjacent) { adjacent = new Set(); neighbours.set(key, adjacent); }
      for (const other of triangle) adjacent.add(other);
    }
  }
  const shell = new Set([top]), pending = [top];
  while (pending.length) for (const next of neighbours.get(pending.pop()!) ?? []) {
    if (!shell.has(next)) { shell.add(next); pending.push(next); }
  }
  const helmetIndices: number[] = [], faceIndices: number[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    const target = shell.has(keys[indices[i]]) ? helmetIndices : faceIndices;
    target.push(indices[i], indices[i + 1], indices[i + 2]);
  }
  if (!helmetIndices.length || !faceIndices.length) return;
  // Prepare once per scene. Actor clones share these two immutable geometries and
  // the same head bone, rather than overlaying a second helmet in actor-root space.
  const helmet = head.clone('Swat_Helmet', head.parent, true)!;
  helmet.makeGeometryUnique(); helmet.setIndices(helmetIndices);
  head.makeGeometryUnique(); head.setIndices(faceIndices);
  container.scene.removeMesh(helmet);
  container.meshes.push(helmet);
}
