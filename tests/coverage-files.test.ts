import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { COVERAGE_MODELS } from '../src/coverage-assets.ts';
import { FOLEY_ASSETS } from '../src/foley-assets.ts';

test('every runtime coverage model/sound has a verified local file, source and free license', () => {
  const base = new URL('../public/assets/coverage/', import.meta.url);
  const entries = ['poly', 'kenney', 'audio'].flatMap(name => JSON.parse(readFileSync(new URL(`${name}-manifest.json`, base), 'utf8')));
  const files = new Set(entries.map(entry => entry.file));
  for (const name of COVERAGE_MODELS) assert.ok(files.has(`${name}.glb`), name);
  for (const url of Object.values(FOLEY_ASSETS)) assert.ok(files.has(url.split('/').at(-1)));
  for (const entry of entries) {
    assert.match(entry.license, /^(CC0[- ]1\.0|CC-BY 3\.0)$/);
    assert.match(entry.page, /^https:\/\/(poly\.pizza|kenney\.nl|opengameart\.org)\//);
    const data = readFileSync(new URL(entry.file, base));
    assert.equal(data.length, entry.bytes, entry.file);
    assert.equal(createHash('sha256').update(data).digest('hex'), entry.sha256, entry.file);
    if (entry.file.endsWith('.glb')) {
      assert.equal(data.toString('ascii', 0, 4), 'glTF');
      assert.equal(data.readUInt32LE(8), data.length);
      const gltf = JSON.parse(data.toString('utf8', 20, 20 + data.readUInt32LE(12)));
      assert.ok(gltf.meshes.length > 0);
      assert.ok((gltf.images ?? []).every((image: { uri?: string }) => !image.uri || image.uri.startsWith('data:')), `${entry.file} must not depend on missing textures`);
    } else if (entry.file.endsWith('.ogg')) {
      assert.equal(data.toString('ascii', 0, 4), 'OggS');
      assert.ok(data.includes(Buffer.from('vorbis')), entry.file);
    } else if (entry.file.endsWith('.png')) assert.equal(data.toString('ascii', 1, 4), 'PNG');
  }
});
