import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ENEMY_MODELS, enemyModelFor, enemyDetailBudget } from '../src/enemy-catalog.ts';

test('cosmetic bot choices are stable, cover every model and exclude shooting-range dummies', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const model = enemyModelFor(`bot-${i}`)!;
    assert.equal(enemyModelFor(`bot-${i}`), model);
    seen.add(model.id);
  }
  assert.deepEqual([...seen].sort(), ENEMY_MODELS.map(model => model.id).sort());
  assert.equal(enemyModelFor('dummy-0'), null);
  assert.equal(new Set(ENEMY_MODELS.map(model => model.id)).size, 12);
  assert.equal(ENEMY_MODELS.filter(model => model.rig === 'kenney').length, 4);
});

test('touch and low quality have smaller limits for detailed enemies', () => {
  assert.deepEqual(enemyDetailBudget(false, false), { distance: 65, count: 16 });
  assert.deepEqual(enemyDetailBudget(true, false), { distance: 35, count: 8 });
  assert.deepEqual(enemyDetailBudget(false, true), { distance: 35, count: 8 });
});

test('all local enemy files match provenance hashes and have valid rigs and animation targets', () => {
  const directory = new URL('../public/assets/enemies/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8'));
  const files = new Set(ENEMY_MODELS.filter(model => model.id !== 'swat').map(model => model.file.split('/').at(-1)));
  let bytes = 0;
  for (const entry of manifest) {
    const data = readFileSync(new URL(entry.file, directory)); bytes += data.length;
    assert.equal(createHash('sha256').update(data).digest('hex'), entry.sha256, entry.file);
    assert.equal(data.length, entry.bytes);
    if (!entry.file.endsWith('.glb')) continue;
    assert.ok(files.delete(entry.file), entry.file);
    assert.equal(data.subarray(0, 4).toString(), 'glTF');
    assert.equal(data.readUInt32LE(8), data.length);
    const doc = JSON.parse(data.toString('utf8', 20, 20 + data.readUInt32LE(12)));
    assert.ok(doc.skins.length >= 1);
    // Every joint must descend from the declared skeleton root. FBX2glTF's
    // original Kenney export incorrectly declared the left foot control.
    for (const skin of doc.skins) {
      const descendants = new Set<number>();
      const visit = (index: number) => { descendants.add(index); (doc.nodes[index].children ?? []).forEach(visit); };
      visit(skin.skeleton);
      assert.ok(skin.joints.every((index: number) => descendants.has(index)), entry.file);
    }
    assert.ok(doc.animations.length >= 2);
    for (const animation of doc.animations) for (const channel of animation.channels) {
      assert.ok(doc.nodes[channel.target.node]);
      assert.ok(animation.samplers[channel.sampler]);
    }
    for (const accessor of doc.accessors) {
      assert.ok(doc.bufferViews[accessor.bufferView]);
      const view = doc.bufferViews[accessor.bufferView];
      assert.ok((view.byteOffset ?? 0) + view.byteLength <= doc.buffers[0].byteLength);
    }
    if (entry.file.startsWith('toon-')) {
      const embedded = ['AK', 'SMG', 'Revolver', 'Pistol', 'Sniper', 'Shotgun', 'RocketLauncher'];
      assert.ok(doc.nodes.filter((node: any) => node.mesh !== undefined).every((node: any) => !embedded.includes(node.name)));
    }
    assert.ok(['CC0 1.0', 'CC-BY 3.0'].includes(entry.license));
    assert.ok(entry.author && entry.page.startsWith('https://'));
  }
  assert.equal(files.size, 0);
  assert.ok(bytes < 6_000_000, 'only compact selected models and original textures ship');
  assert.equal(manifest.find((entry: any) => entry.file === 'woman-soldier.glb').license, 'CC-BY 3.0');
});
