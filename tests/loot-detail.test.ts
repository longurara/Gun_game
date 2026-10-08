import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detailedRangeWeapon, rangeWeaponSilhouette } from '../src/loot-detail.ts';
import { WEAPONS } from '../src/game/weapons.ts';
import type { WeaponClass } from '../src/types.ts';

test('range pickup detail has distance hysteresis and always restores the selected gun', () => {
  assert.equal(detailedRangeWeapon(11, false, true, false, false), true);
  assert.equal(detailedRangeWeapon(13, false, true, false, false), false);
  assert.equal(detailedRangeWeapon(13, true, true, false, false), true);
  assert.equal(detailedRangeWeapon(16, true, true, false, false), false);
  assert.equal(detailedRangeWeapon(18, false, false, false, false), true);
  assert.equal(detailedRangeWeapon(11, false, false, true, false), false);
  assert.equal(detailedRangeWeapon(100, false, true, true, true), true);
});

test('every arsenal class has a small, valid, single-buffer distant pickup with a tier ring', () => {
  const kinds = new Set(Object.values(WEAPONS).map(weapon => weapon.kind));
  for (const kind of kinds as Set<WeaponClass>) for (const tier of [1, 2, 3]) {
    const data = rangeWeaponSilhouette(kind, tier), vertices = data.positions.length / 3;
    assert.ok(vertices <= 300, `${kind} stays below the distant geometry budget`);
    assert.equal(data.normals.length, data.positions.length);
    assert.equal(data.colors.length, vertices * 4);
    assert.equal(data.uvs.length, vertices * 2);
    assert.ok(data.positions.every(Number.isFinite));
    assert.ok(data.indices.every(index => Number.isInteger(index) && index >= 0 && index < vertices));
    assert.equal(data.indices.length % 3, 0);
    const offset = data.positions.length - 24 * 4 * 3;
    for (let i = offset; i < data.positions.length; i += 3) {
      assert.equal(data.positions[i + 1], -.3);
      assert.ok(Math.hypot(data.positions[i], data.positions[i + 2]) >= .4384);
    }
  }
});
