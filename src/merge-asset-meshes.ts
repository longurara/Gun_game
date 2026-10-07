import { Mesh } from '@babylonjs/core/Meshes/mesh.js';

/** Batch temporary asset clones without modifying the geometry owned by their cached templates. */
export function mergeAssetMeshes(parts: Mesh[], multiMaterials = true): Mesh | null {
  if (!parts.length) return null;
  // Babylon may append to the first mesh's shared JS index array when disposeSource=true.
  // Keeping sources during the merge forces an index copy; release only the temporary meshes afterwards.
  const merged = Mesh.MergeMeshes(parts, false, true, undefined, false, multiMaterials);
  if (merged) for (const part of parts) part.dispose();
  return merged;
}
