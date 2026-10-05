import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBudgetFor } from '../src/device.ts';

const renderedPixels = (width: number, height: number, scaling: number) => (width / scaling) * (height / scaling);

test('phone and tablet render cost stays under the mobile pixel budget at every device pixel ratio', () => {
  for (const [width, height] of [[360, 800], [844, 390], [1024, 768], [2560, 1600], [3840, 2160]]) {
    for (const quality of ['low', 'high'] as const) {
      const budget = quality === 'low' ? 550000 : 900000;
      const normalDensity = renderBudgetFor(quality, true, width, height, 1);
      for (const dpr of [1, 2, 3]) {
        const profile = renderBudgetFor(quality, true, width, height, dpr);
        assert.ok(renderedPixels(width, height, profile.scaling) <= budget + 0.001, `${quality} ${width}x${height} DPR${dpr} exceeded its GPU budget`);
        assert.equal(profile.scaling, normalDensity.scaling, 'mobile render cost must not increase or blur further just because DPR changes');
        assert.equal(profile.shadows, false, 'mobile high quality must also keep costly shadows disabled');
      }
      const low = renderBudgetFor('low', true, width, height, 3);
      const high = renderBudgetFor('high', true, width, height, 3);
      assert.ok(renderedPixels(width, height, low.scaling) < renderedPixels(width, height, high.scaling), 'low should reduce actual GPU pixel cost');
    }
  }
});

test('large tablet frames use the budget while a small high-quality phone keeps CSS-pixel clarity', () => {
  for (const quality of ['low', 'high'] as const) {
    const width = 2560, height = 1600;
    const profile = renderBudgetFor(quality, true, width, height, 3);
    const expectedBudget = quality === 'low' ? 550000 : 900000;
    assert.ok(Math.abs(renderedPixels(width, height, profile.scaling) - expectedBudget) < 0.001);
  }
  const phone = renderBudgetFor('high', true, 844, 390, 3);
  assert.equal(renderedPixels(844, 390, phone.scaling), 844 * 390, 'a small phone should not render at one third of CSS resolution on DPR3');
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
      assert.ok(Number.isFinite(profile.scaling) && profile.scaling >= 1);
      assert.equal(renderedPixels(width, height, profile.scaling), 0);
    }
  }
});
