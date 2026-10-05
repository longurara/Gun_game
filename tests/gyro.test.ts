import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gyroLook, upFromGravity } from '../src/gyro.ts';

const DEG = Math.PI / 180;
const rate = (alpha: number, beta: number, gamma: number) => ({ alpha, beta, gamma });
const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('landscape (screen rotated 90): turning the phone to the right turns the camera right, to the left turns left', () => {
  // Held upright in landscape, the world's "up" is along the device's x axis.
  const upright = { x: 9.8, y: 0, z: 0 };
  // Rotation about the vertical axis, counter-clockwise seen from above = a turn to the left: positive beta.
  const left = gyroLook(rate(0, 57.2958, 0), upright, 90, 1);
  const right = gyroLook(rate(0, -57.2958, 0), upright, 90, 1);
  near(left.yaw, -1, 1e-6);
  near(right.yaw, 1, 1e-6);
  assert.equal(left.pitch, 0, 'no pitch from a pure turn');
});

test('landscape: tilting the phone up looks up, down looks down', () => {
  // Rotation about the screen's right axis (-y at 90 degrees): negative gamma raises the view.
  near(gyroLook(rate(0, 0, -57.2958), { x: 9.8, y: 0, z: 0 }, 90, 1).pitch, 1, 1e-6);
  near(gyroLook(rate(0, 0, 57.2958), { x: 9.8, y: 0, z: 0 }, 90, 1).pitch, -1, 1e-6);
});

test('the other landscape direction and portrait mirror these mappings', () => {
  const upright270 = { x: -9.8, y: 0, z: 0 };
  near(gyroLook(rate(0, -57.2958, 0), upright270, 270, 1).yaw, -1, 1e-6);
  near(gyroLook(rate(0, 0, 57.2958), upright270, 270, 1).pitch, 1, 1e-6);
  const portrait = { x: 0, y: 9.8, z: 0 };
  near(gyroLook(rate(0, 0, -57.2958), portrait, 0, 1).yaw, 1, 1e-6);
  near(gyroLook(rate(0, 57.2958, 0), portrait, 0, 1).pitch, 1, 1e-6);
});

test('yaw follows gravity, so tilting the phone back does not change how a turn feels or leak into pitch', () => {
  for (const tilt of [0, 20, 40, 60]) {
    const t = tilt * DEG;
    const up = { x: Math.cos(t), y: 0, z: Math.sin(t) };
    // Clockwise about the true vertical: a turn to the right, expressed in device axes.
    const omega = { alpha: -up.z * 57.2958, beta: -up.x * 57.2958, gamma: -up.y * 57.2958 };
    const look = gyroLook(omega, { x: up.x * 9.8, y: 0, z: up.z * 9.8 }, 90, 1);
    near(look.yaw, 1, 1e-6);
    near(look.pitch, 0, 1e-6);
  }
});

test('an inverted accelerometer sign (some iOS versions) gives the same result', () => {
  const up = { x: 9.8, y: 0.4, z: 2 };
  const flipped = { x: -up.x, y: -up.y, z: -up.z };
  const a = gyroLook(rate(5, -30, 10), up, 90, 0.016);
  const b = gyroLook(rate(5, -30, 10), flipped, 90, 0.016);
  near(a.yaw, b.yaw); near(a.pitch, b.pitch);
  assert.deepEqual(upFromGravity(flipped, 90), upFromGravity(up, 90));
});

test('without a usable gravity reading the screen axes are used; garbage input does nothing', () => {
  near(gyroLook(rate(0, -57.2958, 0), null, 90, 1).yaw, 1, 1e-6);
  near(gyroLook(rate(0, -57.2958, 0), { x: 0, y: 0, z: 0 }, 90, 1).yaw, 1, 1e-6);
  assert.deepEqual(gyroLook(rate(NaN, 1, 1), null, 90, 1), { yaw: 0, pitch: 0 });
  assert.deepEqual(gyroLook(rate(0, 20, 20), null, 90, 0), { yaw: 0, pitch: 0 });
});

test('sensor noise below the dead zone is ignored, real movement passes', () => {
  assert.deepEqual(gyroLook(rate(0.1, 0.1, 0.1), { x: 9.8, y: 0, z: 0 }, 90, 0.016), { yaw: 0, pitch: 0 });
  assert.ok(gyroLook(rate(0, -20, 0), { x: 9.8, y: 0, z: 0 }, 90, 0.016).yaw > 0);
});

test('rotation scales with the time the rate was held', () => {
  const one = gyroLook(rate(0, -40, 0), null, 90, 0.01).yaw;
  const two = gyroLook(rate(0, -40, 0), null, 90, 0.02).yaw;
  near(two, one * 2);
});
