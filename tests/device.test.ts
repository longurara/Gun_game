import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBudgetFor, touchLookSensitivity } from '../src/device.ts';

const renderedPixels = (width: number, height: number, scaling: number) => (width / scaling) * (height / scaling);

test('touch swipe turn is consistent across phone sizes and orientations', () => {
  const turn = 390 * touchLookSensitivity(844, 390);
  assert.equal(touchLookSensitivity(844, 390), touchLookSensitivity(390, 844));
  assert.ok(Math.abs(375 * touchLookSensitivity(667, 375) - turn) < 1e-10);
  assert.ok(Math.abs(412 * touchLookSensitivity(915, 412) - turn) < 1e-10);
  assert.equal(touchLookSensitivity(844, 390, 2), touchLookSensitivity(844, 390) * 2);
});

test('touch aim slows high zoom optics and invalid screen values remain usable', () => {
  const normal = touchLookSensitivity(844, 390);
  const aim = touchLookSensitivity(844, 390, 1, 8);
  assert.ok(aim < touchLookSensitivity(844, 390, 1, 2));
  assert.ok(Math.abs(aim / normal - 0.72 / Math.sqrt(8)) < 1e-10);
  for (const [width, height] of [[0, 0], [NaN, 390], [844, Infinity]]) {
    assert.equal(touchLookSensitivity(width, height, NaN), normal);
  }
  assert.ok(touchLookSensitivity(1, 1) <= 0.005);
  assert.ok(touchLookSensitivity(4000, 2000) > 0);
});

test('phones and tablets render at native device resolution without a pixel cap', () => {
  for (const [width, height] of [[360, 800], [844, 390], [1024, 768], [2560, 1600], [3840, 2160]]) {
    for (const quality of ['low', 'high'] as const) {
      for (const dpr of [1, 2, 3, 4]) {
        const profile = renderBudgetFor(quality, true, width, height, dpr);
        assert.ok(Math.abs(width / profile.scaling - width * dpr) < 0.00001);
        assert.ok(Math.abs(height / profile.scaling - height * dpr) < 0.00001);
        assert.equal(profile.shadows, false, 'mobile high quality must also keep costly shadows disabled');
      }
      const low = renderBudgetFor('low', true, width, height, 3);
      const high = renderBudgetFor('high', true, width, height, 3);
      assert.equal(low.scaling, high.scaling, 'both mobile quality levels must keep full resolution');
    }
  }
});

test('large tablets and rotated phones keep every device pixel', () => {
  for (const quality of ['low', 'high'] as const) {
    const width = 2560, height = 1600;
    const profile = renderBudgetFor(quality, true, width, height, 3);
    const expectedBudget = width * height * 3 * 3;
    assert.ok(Math.abs(renderedPixels(width, height, profile.scaling) - expectedBudget) < 0.001);
  }
  const phone = renderBudgetFor('high', true, 844, 390, 3);
  assert.equal(renderedPixels(844, 390, phone.scaling), 844 * 390 * 9);
  assert.equal(renderBudgetFor('high', true, 390, 844, 3).scaling, phone.scaling);
});

test('desktop quality and shadow behavior remain compatible with the previous renderer', () => {
  const expected = [
    { dpr: 1, low: 1.4, high: 1 },
    { dpr: 2, low: 2, high: 1.5 },
    { dpr: 3, low: 3, high: 2.25 },
  ];
  for (const { dpr, low, high } of expected) {
    assert.deepEqual(renderBudgetFor('low', false, 1920, 1080, dpr), { scaling: low, shadows: false });
    assert.deepEqual(renderBudgetFor('high', false, 1920, 1080, dpr), { scaling: high, shadows: true });
  }
});

test('a hidden or not-yet-sized canvas gets a finite valid render scale', () => {
  for (const quality of ['low', 'high'] as const) {
    for (const [width, height] of [[0, 0], [0, 390], [844, 0]]) {
      const profile = renderBudgetFor(quality, true, width, height, 3);
      assert.ok(Number.isFinite(profile.scaling) && profile.scaling > 0);
      assert.equal(renderedPixels(width, height, profile.scaling), 0);
    }
  }
  for (const dpr of [0, -1, NaN, Infinity]) {
    assert.equal(renderBudgetFor('low', true, 844, 390, dpr).scaling, 1);
  }
});
