import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampZoom, fovFor, SCOPE_FROM, stepZoom, zoomLevels } from '../src/optics.ts';

test('a scope runs from 1x to its own maximum and a plain sight has one fixed level', () => {
  assert.deepEqual(zoomLevels(6), [1, 1.5, 2, 3, 4, 5, 6]);
  assert.deepEqual(zoomLevels(8), [1, 1.5, 2, 3, 4, 5, 6, 8]);
  assert.deepEqual(zoomLevels(10), [1, 1.5, 2, 3, 4, 5, 6, 8, 10]);
  assert.deepEqual(zoomLevels(4), [1, 1.5, 2, 3, 4]);
  assert.deepEqual(zoomLevels(1.4), [1.4]);
  assert.deepEqual(zoomLevels(3), [3]);
  assert.deepEqual(zoomLevels(7), [1, 1.5, 2, 3, 4, 5, 6, 7], 'a maximum between the usual steps is still reachable');
  assert.deepEqual(zoomLevels(NaN), [1]);
  assert.equal(SCOPE_FROM, 4);
});

test('stepping stays inside the levels and zoom is remembered within what the sight allows', () => {
  const levels = zoomLevels(8);
  assert.equal(stepZoom(levels, 8, 1), 8, 'no further than the maximum');
  assert.equal(stepZoom(levels, 8, -1), 6);
  assert.equal(stepZoom(levels, 1, -1), 1, 'no lower than 1x');
  assert.equal(stepZoom(levels, 1, 1), 1.5);
  assert.equal(stepZoom(levels, 3.4, 0), 3);
  assert.equal(clampZoom(levels, undefined), 8, 'the first look through a scope is at full zoom');
  assert.equal(clampZoom(zoomLevels(4), 8), 4, 'a smaller scope cannot hold a bigger remembered zoom');
  assert.equal(clampZoom(zoomLevels(1.4), 3), 1.4);
});

test('zooming in narrows the view and it is never wider than the normal one', () => {
  assert.ok(fovFor(1) > fovFor(2) && fovFor(2) > fovFor(8));
  assert.equal(fovFor(1), 0.92);
  assert.equal(fovFor(0.5), 0.92);
});
