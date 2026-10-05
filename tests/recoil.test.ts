import { test } from 'node:test';
import assert from 'node:assert/strict';
import { burstReset, counter, kick, newBank, recover } from '../src/game/recoil.ts';
import type { RecoilContext, RecoilGun } from '../src/game/recoil.ts';
import { WEAPONS } from '../src/game/weapons.ts';

const half = () => 0.5;
const standing: RecoilContext = { aiming: false, stance: 'stand', moving: 0, scale: 1 };
const gun = (id: string): RecoilGun => WEAPONS[id];
const spray = (id: string, shots: number, context = standing) => {
  const bank = newBank();
  const kicks = [] as Array<{ pitch: number; yaw: number }>;
  for (let i = 0; i < shots; i++) { kicks.push(kick(bank, gun(id), context, half)); bank.idle = 0.05; }
  return { bank, kicks };
};

test('every shot kicks the aim up and the kick grows as a burst goes on, then stops growing', () => {
  const { kicks } = spray('rifle', 20);
  assert.ok(kicks[0].pitch > 0, 'the first shot kicks too (after the bullet has left)');
  assert.ok(kicks[10].pitch > kicks[0].pitch * 1.4, 'later shots climb harder');
  assert.ok(Math.abs(kicks[13].pitch - kicks[12].pitch) < 1e-9, 'the climb levels off after about twelve shots');
});

test('a gun has the same pattern every time, and different guns sway differently', () => {
  const a = spray('rifle', 12).kicks.map(k => k.yaw);
  const b = spray('rifle', 12).kicks.map(k => k.yaw);
  assert.deepEqual(a, b);
  const other = spray('smg', 12).kicks.map(k => k.yaw / WEAPONS.smg.recoil);
  const rifle = a.map(y => y / WEAPONS.rifle.recoil);
  assert.ok(rifle.some((v, i) => Math.abs(v - other[i]) > 0.2), 'patterns differ between guns');
  assert.ok(a.some(y => y > 0) && a.some(y => y < 0), 'the muzzle sways both ways');
});

test('a spray of an assault rifle lifts the aim by many degrees, a sniper rifle kicks hard once', () => {
  const rifle = spray('rifle', 20).bank.pitch * 180 / Math.PI;
  assert.ok(rifle > 15 && rifle < 29, `${rifle.toFixed(1)}° after 20 rounds`);
  const sniper = spray('sniper', 1).bank.pitch * 180 / Math.PI;
  assert.ok(sniper > 3 && sniper < 8, `${sniper.toFixed(1)}° from one sniper shot`);
  assert.ok(spray('smg', 20).bank.pitch < spray('rifle', 20).bank.pitch, 'a sub-machine gun is gentler per shot');
});

test('looking down the sights, crouching, lying down and the strength setting all reduce the kick', () => {
  const full = spray('rifle', 10).bank.pitch;
  assert.ok(spray('rifle', 10, { ...standing, aiming: true }).bank.pitch < full * 0.75);
  assert.ok(spray('rifle', 10, { ...standing, stance: 'crouch' }).bank.pitch < full * 0.85);
  assert.ok(spray('rifle', 10, { ...standing, stance: 'prone' }).bank.pitch < full * 0.65);
  assert.ok(spray('rifle', 10, { ...standing, scale: 0.5 }).bank.pitch < full * 0.55);
  assert.ok(spray('rifle', 10, { ...standing, moving: 1 }).bank.pitch > full, 'shooting on the move shakes more');
  assert.equal(spray('rifle', 10, { ...standing, scale: 0 }).bank.pitch, 0);
});

test('the total kick is capped', () => {
  const { bank } = spray('lmg', 200);
  assert.ok(bank.pitch <= 0.5 + 1e-9 && Math.abs(bank.yaw) <= 0.26 + 1e-9);
});

test('after the burst ends the aim drifts back to where it was; during the burst it barely moves', () => {
  const rifle = gun('rifle');
  const { bank } = spray('rifle', 10);
  const before = bank.pitch;
  // Still bursting: slow recovery.
  const slow = recover(bank, rifle, 0.1);
  assert.ok(-slow.pitch < before * 0.1, 'barely recovers mid-burst');
  bank.idle = burstReset(rifle) + 0.01;
  let total = slow.pitch;
  for (let i = 0; i < 60; i++) total += recover(bank, rifle, 1 / 60).pitch;
  assert.ok(bank.pitch < 0.03 * before, 'back to the start within a second');
  assert.ok(Math.abs(-total - before) < 0.05 * before, 'the view moved back by what the kick had added');
});

test('pulling the mouse down against the kick is counted, so the aim stays where you put it', () => {
  const rifle = gun('rifle');
  const { bank } = spray('rifle', 8);
  const kicked = bank.pitch;
  counter(bank, -kicked * 0.6, 0);
  assert.ok(Math.abs(bank.pitch - kicked * 0.4) < 1e-9, 'the pulled-down part no longer needs recovering');
  counter(bank, +0.2, 0);
  assert.ok(Math.abs(bank.pitch - kicked * 0.4) < 1e-9, 'moving the aim up does not undo it');
  counter(bank, -1, 0);
  assert.equal(bank.pitch, 0, 'pulling down more than the kick leaves nothing to recover');
  bank.idle = 5;
  assert.ok(Math.abs(recover(bank, rifle, 1).pitch) < 1e-12);
});

test('a pause longer than the burst window starts a fresh clean burst', () => {
  const bank = newBank();
  const first = kick(bank, gun('rifle'), standing, half);
  for (let i = 0; i < 10; i++) { bank.idle = 0.05; kick(bank, gun('rifle'), standing, half); }
  bank.idle = 2;
  const fresh = kick(bank, gun('rifle'), standing, half);
  assert.ok(Math.abs(fresh.pitch - first.pitch) < 1e-9);
});
