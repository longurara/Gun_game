import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getJoystickInput } from '../src/mobile-controls';

const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test('joystick dead zone prevents drift while the thumb still tracks a small touch', () => {
  const input = getJoystickInput(2, -3, 40);
  close(input.side, 0);
  close(input.forward, 0);
  close(input.stickX, 2);
  close(input.stickY, -3);
  assert.equal(input.sprint, false);
});

test('joystick remaps analog travel smoothly outside its radial dead zone', () => {
  const input = getJoystickInput(0, -22.4, 40);
  close(input.side, 0);
  close(input.forward, 0.5);
  assert.equal(input.sprint, false);
  assert.ok(getJoystickInput(0, -5, 40).forward > 0);
  assert.ok(getJoystickInput(0, -4.8, 40).forward === 0);
});

test('diagonal and off-pad drags preserve direction and cap movement and thumb travel', () => {
  const input = getJoystickInput(300, -400, 40);
  close(input.side, 0.6);
  close(input.forward, 0.8);
  close(Math.hypot(input.side, input.forward), 1);
  close(Math.hypot(input.stickX, input.stickY), 40);
  assert.equal(input.sprint, true);
});

test('sprint requires nearly full joystick travel and backward travel retains its sign', () => {
  assert.equal(getJoystickInput(0, -37, 40).sprint, false);
  assert.equal(getJoystickInput(0, -38, 40).sprint, true);
  close(getJoystickInput(-40, 0, 40).side, -1);
  close(getJoystickInput(0, 40, 40).forward, -1);
});

test('invalid coordinates or zero-size controls cannot produce NaN movement', () => {
  for (const values of [[NaN, 0, 40], [0, Infinity, 40], [0, 0, 0], [1, 1, -1], [1, 1, Infinity]]) {
    assert.deepEqual(getJoystickInput(...values as [number, number, number]), { side: 0, forward: 0, sprint: false, stickX: 0, stickY: 0 });
  }
});

test('custom dead zones are bounded and malformed preferences use the default', () => {
  close(getJoystickInput(20, 0, 40, -1).side, 0.5);
  close(getJoystickInput(20, 0, 40, NaN).side, getJoystickInput(20, 0, 40).side);
  assert.equal(getJoystickInput(20, 0, 40, 5).side, 0);
});
