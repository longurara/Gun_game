import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { mergeAssetMeshes } from '../src/merge-asset-meshes.ts';

test('repeated mixed-material batching leaves cached array indices and vertex buffers intact', t => {
  const engine = new NullEngine(), scene = new Scene(engine); t.after(() => engine.dispose());
  const make = (name: string) => {
    const mesh = new Mesh(name, scene), data = new VertexData();
    data.positions = [0, 0, 0, 1, 0, 0, 0, 1, 0]; data.normals = [0, 0, -1, 0, 0, -1, 0, 0, -1];
    data.indices = [0, 1, 2]; data.applyToMesh(mesh); mesh.material = new StandardMaterial(name, scene); mesh.setEnabled(false); return mesh;
  };
  const roof = make('roof'), trim = make('trim');
  const original = [roof, trim].map(mesh => ({ indices: Array.from(mesh.getIndices()!), positions: Array.from(mesh.getVerticesData('position')!), normals: Array.from(mesh.getVerticesData('normal')!) }));
  for (let pass = 0; pass < 12; pass++) {
    const parts = [roof.clone('roof-clone')!, trim.clone('trim-clone')!];
    parts[0].position.x = pass * 10; parts[0].scaling.set(12, 3, 8); parts[1].position.z = pass;
    parts.forEach(part => part.setEnabled(true));
    const merged = mergeAssetMeshes(parts)!;
    assert.ok(parts.every(part => part.isDisposed()), 'temporary clones are released');
    assert.equal(merged.getTotalVertices(), 6); assert.equal(merged.getTotalIndices(), 6);
    assert.ok(Array.from(merged.getIndices()!).every(index => index < merged.getTotalVertices()));
    assert.deepEqual(merged.getVerticesData('position')!.slice(0, 9), [pass * 10, 0, 0, pass * 10 + 12, 0, 0, pass * 10, 3, 0]);
    for (const [index, source] of [roof, trim].entries()) {
      assert.deepEqual(Array.from(source.getIndices()!), original[index].indices);
      assert.deepEqual(Array.from(source.getVerticesData('position')!), original[index].positions);
      assert.deepEqual(Array.from(source.getVerticesData('normal')!), original[index].normals);
      assert.equal(source.isDisposed(), false); assert.ok(scene.materials.includes(source.material!));
    }
    const multi = merged.material as any;
    assert.equal(multi.subMaterials.length, 2); assert.ok(multi.subMaterials.every((material: any) => scene.materials.includes(material)));
    multi.dispose(false, false); merged.dispose();
  }
  assert.equal(mergeAssetMeshes([]), null);
});
