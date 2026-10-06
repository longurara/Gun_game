import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

test('shipped aircraft matches its attributed source and includes its texture in the GLB', () => {
  const directory = new URL('../public/assets/aircraft/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8'));
  const data = readFileSync(new URL(manifest.file, directory));
  assert.equal(manifest.author, 'Poly by Google');
  assert.equal(manifest.license, 'CC-BY 3.0');
  assert.equal(createHash('sha256').update(data).digest('hex'), manifest.sha256);
  assert.equal(data.length, manifest.bytes);
  assert.ok(data.length < 200000);
  assert.equal(data.subarray(0, 4).toString(), 'glTF');
  assert.equal(data.readUInt32LE(8), data.length);
  const doc = JSON.parse(data.toString('utf8', 20, 20 + data.readUInt32LE(12)));
  const triangles = doc.meshes.flatMap((mesh: any) => mesh.primitives).reduce((count: number, primitive: any) => count + doc.accessors[primitive.indices].count / 3, 0);
  assert.equal(triangles, 1426);
  assert.ok(doc.images.length > 0);
  assert.ok(doc.images.every((image: any) => image.bufferView !== undefined && !image.uri));
  assert.match(readFileSync(new URL('CREDITS.md', directory), 'utf8'), /Poly by Google[\s\S]*CC BY 3.0/);
});
