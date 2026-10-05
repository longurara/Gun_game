import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookScale, pickAssist, pullStep } from '../src/aim-assist.ts';

const DEG = Math.PI / 180;
const target = (id: string, yawDeg: number, pitchDeg = 0, distance = 40) => ({ id, yaw: yawDeg * DEG, pitch: pitchDeg * DEG, distance });

test('only an enemy inside the cone counts, and the closest one to the crosshair wins', () => {
  const targets = [target('far', 20), target('near', 2), target('nearer', -1)];
  const hit = pickAssist(0, 0, targets, 'low')!;
  assert.equal(hit.id, 'nearer');
  assert.ok(Math.abs(hit.dYaw + 1 * DEG) < 1e-9);
  assert.equal(pickAssist(0, 0, [target('x', 5)], 'low'), null, 'outside the low cone (3.5 degrees)');
  assert.equal(pickAssist(0, 0, [target('x', 5)], 'high')?.id, 'x', 'inside the high cone (6 degrees)');
  assert.equal(pickAssist(0, 0, targets, 'off'), null);
});

test('the cone is round on screen and yaw wraps around the compass', () => {
  assert.equal(pickAssist(179.5 * DEG, 0, [target('t', -179.5)], 'low')?.id, 't', 'one degree apart across the 180 degree seam');
  // Looking steeply up, a big yaw difference is a small distance on screen.
  assert.equal(pickAssist(0, 80 * DEG, [target('t', 10, 80)], 'low')?.id, 't');
});

test('look speed is slowest right on the target and back to normal at the edge of the cone', () => {
  const onTarget = pickAssist(0, 0, [target('t', 0)], 'high');
  assert.ok(Math.abs(lookScale(onTarget, 'high') - 0.5) < 1e-9);
  const edge = pickAssist(0, 0, [target('t', 5.9)], 'high');
  assert.ok(lookScale(edge, 'high') > 0.9);
  assert.equal(lookScale(null, 'high'), 1);
  assert.equal(lookScale(onTarget, 'off'), 1);
  assert.ok(lookScale(pickAssist(0, 0, [target('t', 0)], 'low'), 'low') > lookScale(onTarget, 'high'), 'low assist slows less');
});

test('the pull toward the body only happens while shooting or aiming and fades toward the edge', () => {
  const hit = pickAssist(0, 0, [target('t', 2, -1)], 'high');
  assert.deepEqual(pullStep(hit, 'high', 0.016, false), { yaw: 0, pitch: 0 }, 'idle: no pull');
  assert.deepEqual(pullStep(null, 'high', 0.016, true), { yaw: 0, pitch: 0 });
  assert.deepEqual(pullStep(hit, 'off', 0.016, true), { yaw: 0, pitch: 0 });
  const step = pullStep(hit, 'high', 0.016, true);
  assert.ok(step.yaw > 0 && step.yaw < hit!.dYaw, 'moves toward the target without overshooting');
  assert.ok(step.pitch < 0 && step.pitch > hit!.dPitch);
  const nearEdge = pickAssist(0, 0, [target('t', 5.5)], 'high');
  const shareNear = pullStep(nearEdge, 'high', 0.016, true).yaw / nearEdge!.dYaw, shareOn = step.yaw / hit!.dYaw;
  assert.ok(shareNear < shareOn * 0.2, 'a small share of the remaining error near the edge');
  // Held long enough the aim converges on the target but never past it.
  let yaw = 0;
  for (let i = 0; i < 600; i++) {
    const h = pickAssist(yaw, 0, [target('t', 2.5)], 'high');
    yaw += pullStep(h, 'high', 1 / 60, true).yaw;
  }
  assert.ok(yaw <= 2.5 * DEG + 1e-9 && yaw > 2.2 * DEG, `settled at ${(yaw / DEG).toFixed(2)} degrees`);
});
