import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REPLAY_SECONDS, ReplayRecorder, sampleReplay, shotsBetween } from '../src/replay.ts';
import type { ReplayActor } from '../src/replay.ts';

const actor = (id: string, x: number, extra: Partial<ReplayActor> = {}): ReplayActor => ({ id, x, y: 0, z: 0, yaw: 0, weapon: 'rifle', ...extra });
const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

/** Record `seconds` of a killer walking east and a victim standing still, ticking at 30 Hz. */
function record(seconds: number): ReplayRecorder {
  const recorder = new ReplayRecorder();
  for (let i = 0; i <= seconds * 30; i++) {
    const t = i / 30;
    recorder.frame(t, () => [actor('bot-1', t * 4), actor('player', 20)]);
  }
  return recorder;
}

test('the recorder keeps one frame per tenth of a second and only the last eight seconds', () => {
  const recorder = record(20);
  // Ticks arrive every 1/30 s, so a frame lands every 0.1 to 0.13 s.
  assert.ok(recorder.frames.length >= 55 && recorder.frames.length <= 82, `${recorder.frames.length} frames`);
  near(recorder.duration, REPLAY_SECONDS, 0.3);
  assert.ok(recorder.frames[0].t > 11.6, 'the oldest frame is about eight seconds old');
  // The snapshot is only taken when a frame is due.
  let taken = 0;
  const quick = new ReplayRecorder();
  for (let i = 0; i < 90; i++) quick.frame(i / 30, () => { taken++; return []; });
  assert.ok(taken >= 21 && taken <= 31, `${taken} snapshots in 3 seconds`);
});

test('sampling between two frames blends positions, wraps yaw the short way and clamps to the recording', () => {
  const frames = [
    { t: 10, actors: [actor('a', 0, { yaw: 3.0, stance: 'stand' })] },
    { t: 10.1, actors: [actor('a', 10, { yaw: -3.0, stance: 'prone', weapon: 'sniper' })] },
  ];
  const mid = sampleReplay(frames, 0.05)[0];
  near(mid.x, 5);
  assert.ok(Math.abs(mid.yaw) > 3.0, `yaw went through pi, not through zero: ${mid.yaw}`);
  assert.equal(sampleReplay(frames, 0.02)[0].stance, 'stand');
  assert.equal(sampleReplay(frames, 0.08)[0].stance, 'prone');
  assert.equal(sampleReplay(frames, 0.08)[0].weapon, 'sniper');
  near(sampleReplay(frames, -5)[0].x, 0);
  near(sampleReplay(frames, 99)[0].x, 10);
  assert.deepEqual(sampleReplay([], 1), []);
});

test('an actor that is missing from the next frame keeps its last pose instead of vanishing', () => {
  const frames = [{ t: 0, actors: [actor('a', 1), actor('b', 2)] }, { t: 0.1, actors: [actor('a', 3)] }];
  const poses = sampleReplay(frames, 0.05);
  assert.equal(poses.length, 2);
  near(poses.find(p => p.id === 'b')!.x, 2);
});

test('each shot is replayed exactly once as the replay time moves forward', () => {
  const recorder = record(5);
  const start = recorder.frames[0].t;
  for (const t of [start + 0.5, start + 1.5, start + 1.5001, start + 3]) recorder.shot({ t, actorId: 'bot-1', from: { x: 0, y: 1, z: 0 }, to: { x: 5, y: 1, z: 0 } });
  const fired: number[] = [];
  let previous = 0;
  for (let time = 0; time <= recorder.duration + 0.2; time += 1 / 60) {
    for (const shot of shotsBetween(recorder.shots, recorder.frames, previous, time)) fired.push(shot.t);
    previous = time;
  }
  assert.equal(fired.length, 4, 'every shot once');
  assert.deepEqual([...fired].sort((a, b) => a - b), fired, 'in order');
});

test('a recording is worth playing only with at least two seconds and the killer in the last frame', () => {
  assert.equal(record(1).playable('bot-1'), false, 'too short');
  assert.equal(record(5).playable('bot-1'), true);
  assert.equal(record(5).playable('bot-9'), false, 'the killer was out of range');
  assert.equal(record(5).playable(null), false, 'killed by the circle');
  const cleared = record(5);
  cleared.clear();
  assert.equal(cleared.playable('bot-1'), false);
  assert.equal(cleared.duration, 0);
});
