import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stereoPan } from '../src/audio.ts';

const origin = { x: 0, z: 0 };

test('a sound ahead is centred, to the right is right, to the left is left, behind is centred again', () => {
  assert.ok(Math.abs(stereoPan({ x: 0, z: 30 }, origin, 0)) < 1e-9, 'ahead');
  assert.ok(Math.abs(stereoPan({ x: 0, z: -30 }, origin, 0)) < 1e-9, 'behind');
  assert.ok(Math.abs(stereoPan({ x: 30, z: 0 }, origin, 0) - 1) < 1e-9, 'right');
  assert.ok(Math.abs(stereoPan({ x: -30, z: 0 }, origin, 0) + 1) < 1e-9, 'left');
});

test('turning the listener moves the sound across the stereo field', () => {
  const east = { x: 30, z: 0 };
  assert.ok(stereoPan(east, origin, 0) > 0.99, 'facing north, east is on the right');
  assert.ok(Math.abs(stereoPan(east, origin, Math.PI / 2)) < 1e-9, 'facing east, it is dead ahead');
  assert.ok(stereoPan(east, origin, Math.PI) < -0.99, 'facing south, east is on the left');
});

test('very close sounds stay near the centre and bad input is silent', () => {
  assert.ok(Math.abs(stereoPan({ x: 2, z: 0 }, origin, 0)) < 0.4);
  assert.equal(stereoPan(origin, origin, 0), 0);
  assert.equal(stereoPan({ x: NaN, z: 0 }, origin, 0), 0);
});
