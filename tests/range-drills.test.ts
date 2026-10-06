import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameSimulation } from '../src/game/simulation.ts';
import { createRangeWorld, FIRING_Z, MOTOR_POOL, popUp, RANGE_HALF, runState, SLALOM } from '../src/game/range.ts';
import { COMBO_MAX, comboMultiplier, DRILL_ORDER, DRILLS, drillGrade, groupOf, hitPoints, isDrillId } from '../src/game/drills.ts';
import { VEHICLES } from '../src/game/vehicles.ts';
import type { Actor, RangeDummySpec } from '../src/types.ts';

const still = { moveX: 0, moveZ: 0, sprint: false, jump: false };
const range = (botCount = 0) => { const game = new GameSimulation({ seed: 4, botCount, map: 'range' }); game.start(); game.drainEvents(); return game; };
const run = (game: GameSimulation, seconds: number) => { for (let i = 0; i < seconds * 30; i++) game.update(1 / 30, still); game.drainEvents(); };
const dummy = (game: GameSimulation, id: string) => game.state.actors.find(a => a.id === id)!;
const spec = (game: GameSimulation, id: string): RangeDummySpec => game.world.range!.dummies.find(d => d.id === id)!;

/** Stand square to a target a few metres off its line and shoot it in the chest until it falls (or a few shots have been spent). */
function shoot(game: GameSimulation, target: Actor, height = 1.1, shots = 1): number {
  const p = game.player;
  let fired = 0;
  for (let i = 0; i < shots && target.alive; i++) {
    p.yaw = Math.atan2(target.position.x - p.position.x, target.position.z - p.position.z);
    if (game.shootPlayer({ x: target.position.x, y: height, z: target.position.z }, true)) fired++;
    game.update(0.2, still);
  }
  return fired;
}
const closeTo = (game: GameSimulation, a: Actor, metres = 14) => { game.player.position = { x: a.position.x, y: 0, z: a.position.z - metres }; game.player.yaw = 0; };

test('a runner goes across and back with a pause at each end, and a pop-up stands for its time and ducks for its', () => {
  const m = { kind: 'run' as const, from: -100, to: 100, speed: 10, pause: 1, phase: 0 };
  assert.deepEqual(runState(m, 0), { x: -100, dir: 1 });
  assert.equal(Math.round(runState(m, 10).x), 0);
  assert.deepEqual(runState(m, 20.5), { x: 100, dir: 0 }, 'it waits at the far end');
  assert.equal(runState(m, 21.5).dir, -1);
  assert.equal(Math.round(runState(m, 31).x), 0, 'and runs back');
  assert.deepEqual(runState(m, 42), { x: -100, dir: 1 }, 'a new lap');
  assert.equal(runState(m, 41.5).x, -100);
  assert.equal(runState(m, 42 * 3 + 10).x, runState(m, 10).x, 'the same every lap');
  assert.equal(runState({ ...m, phase: 0.5 }, 0).x, 100, 'the phase starts it elsewhere');
  const p = { kind: 'pop' as const, up: 2, down: 1, phase: 0 };
  assert.deepEqual([0, 1.9, 2.1, 2.9, 3.1].map(t => popUp(p, t)), [true, true, false, false, true]);
  assert.equal(popUp({ ...p, phase: 2 }, 0), false, 'the phase shifts the rhythm');
});

test('the range has runners and pop-ups that really move, and runners face the way they run', () => {
  const game = range();
  const runner = dummy(game, 'dummy-r1'), sprinter = dummy(game, 'dummy-r3');
  const seen: number[] = [], yaws = new Set<number>();
  for (let i = 0; i < 30 * 70; i++) {
    game.update(1 / 30, still);
    if (i % 15 === 0) { seen.push(runner.position.x); yaws.add(Math.sign(Math.sin(runner.yaw))); }
    assert.ok(runner.position.x >= -95.01 && runner.position.x <= 95.01 && sprinter.position.x >= -95.01 && sprinter.position.x <= 95.01, 'they stay on the field');
  }
  assert.ok(Math.max(...seen) > 80 && Math.min(...seen) < -80, 'it crosses the whole field');
  assert.ok(yaws.has(1) && yaws.has(-1), 'it turns round at the ends');
  const speedOf = (id: string) => { const m = spec(game, id).motion as { kind: 'run'; from: number; to: number; speed: number; pause: number; phase: number }; return Math.abs(runState(m, 3).x - runState(m, 2).x); };
  assert.ok(speedOf('dummy-r3') > 2 * speedOf('dummy-r1'), 'the sprinter is much quicker than the walker');
  assert.ok(sprinter.alive && runner.alive);
  const ducked = new Set<boolean>();
  const pop = dummy(game, 'dummy-p1');
  for (let i = 0; i < 30 * 12; i++) { game.update(1 / 30, still); ducked.add(!!pop.hidden); }
  assert.ok(ducked.has(true) && ducked.has(false), 'it goes up and down');
});

test('a ducked target cannot be hit, a standing one can, and one that is knocked down comes back with its next rise', () => {
  const game = range();
  const pop = dummy(game, 'dummy-p3'), motion = spec(game, 'dummy-p3').motion!;
  assert.equal(motion.kind, 'pop');
  const wait = (want: boolean) => { for (let i = 0; i < 30 * 12 && !!pop.hidden !== !want; i++) game.update(1 / 30, still); };
  wait(false);
  assert.equal(pop.hidden, true);
  closeTo(game, pop);
  const before = pop.health;
  shoot(game, pop, 1.1, 3);
  assert.equal(pop.health, before, 'bullets pass a ducked target');
  wait(true);
  assert.equal(!!pop.hidden, false);
  closeTo(game, pop);
  for (let i = 0; i < 6 && pop.alive; i++) { const p = game.player; p.yaw = 0; game.shootPlayer({ x: pop.position.x, y: 1.1, z: pop.position.z }, true); game.update(0.05, still); }
  if (!pop.alive) {
    wait(false);
    assert.equal(pop.alive, false, 'down while it is ducked');
    wait(true);
    assert.equal(pop.alive, true, 'and up again, whole');
    assert.equal(pop.health, 100);
  }
});

test('scoring: distance, moving targets, the head, the kill and the combo all add up', () => {
  const lane: RangeDummySpec = { id: 'a', x: 0, z: 0, distance: 100 };
  const sway: RangeDummySpec = { ...lane, sway: { amp: 10, period: 5, phase: 0 } };
  const pop: RangeDummySpec = { ...lane, motion: { kind: 'pop', up: 1, down: 1, phase: 0 } };
  assert.equal(hitPoints(lane, 100, false, false, 0), 20, '10 and 10 for the 100 m');
  assert.equal(hitPoints(lane, 250, false, false, 0), 35);
  assert.equal(hitPoints(lane, 100, true, false, 0), 40, 'the head doubles');
  assert.equal(hitPoints(lane, 100, false, true, 0), 35, 'a kill adds 15');
  assert.equal(hitPoints(sway, 100, false, false, 0), 30, 'a moving target is worth half as much again');
  assert.equal(hitPoints(pop, 100, false, false, 0), 28);
  assert.ok(hitPoints(lane, 100, false, false, 5) > hitPoints(lane, 100, false, false, 0));
  assert.equal(comboMultiplier(99), 1 + COMBO_MAX * 0.1, 'the multiplier tops out');
  assert.equal(comboMultiplier(-3), 1);
  assert.deepEqual(['lane', 'sway', 'pop'], [groupOf(lane), groupOf(sway), groupOf(pop)]);
  assert.deepEqual(DRILL_ORDER.map(id => isDrillId(id)), [true, true, true, true, true]);
  assert.equal(isDrillId('constructor'), false);
  assert.equal(isDrillId(undefined), false);
  assert.equal(drillGrade('warm', 0), 'D');
  assert.equal(drillGrade('warm', 450), 'B');
  assert.equal(drillGrade('warm', 900), 'S');
});

test('each drill counts only its own targets', () => {
  const all = createRangeWorld().range!.dummies;
  const counted = (id: keyof typeof DRILLS) => all.filter(d => DRILLS[id].counts(d));
  assert.ok(counted('warm').length === 15 && counted('warm').every(d => d.distance <= 50 && !d.sway && !d.motion), 'near lane targets');
  assert.ok(counted('far').length === 20 && counted('far').every(d => d.distance >= 100), 'the far ones');
  assert.equal(counted('moving').length, 9, 'slide and run');
  assert.equal(counted('pop').length, 6);
  assert.equal(counted('mixed').length, all.length);
  for (const id of DRILL_ORDER) assert.ok(DRILLS[id].seconds >= 30 && DRILLS[id].name && DRILLS[id].blurb);
});

test('a drill runs on the clock: hits on its targets score, others do not, and it ends by itself', () => {
  const game = range();
  assert.equal(game.startDrill('nonsense'), false);
  assert.equal(game.startDrill('constructor'), false);
  assert.equal(game.state.drill ?? null, null);
  assert.ok(game.startDrill('warm'));
  const drill = game.state.drill!;
  assert.equal(drill.done, false);
  assert.equal(drill.endsAt - drill.startedAt, DRILLS.warm.seconds);
  // A far target is not part of this drill.
  const far = dummy(game, 'dummy-3-200');
  closeTo(game, far, 30);
  const wasted = shoot(game, far, 1.1, 2);
  assert.equal(drill.score, 0, 'no points for a target the drill is not about');
  // A near one is.
  const near = dummy(game, 'dummy-3-25');
  closeTo(game, near, 12);
  const fired = shoot(game, near, 1.1, 6);
  assert.ok(fired > 0 && drill.hits > 0 && drill.score > 0, `${drill.hits} hits for ${drill.score}`);
  assert.equal(drill.shots, wasted + fired, 'every shot is counted, on target or not');
  const score = drill.score;
  assert.ok(drill.kills <= 1);
  const told: string[] = [];
  for (let i = 0; i < 30 * (DRILLS.warm.seconds + 1); i++) { game.update(1 / 30, still); for (const e of game.drainEvents()) if (e.type === 'message') told.push(e.text); }
  assert.equal(drill.done, true, 'time is up');
  assert.ok(told.some(t => t.includes('Hết giờ')), 'the end is announced');
  game.player.position = { x: near.position.x, y: 0, z: near.position.z - 12 };
  shoot(game, dummy(game, 'dummy-3-25'), 1.1, 3);
  assert.equal(drill.score, score, 'nothing counts after the end');
  assert.ok(game.stopDrill(), 'clearing a finished drill');
  assert.equal(game.state.drill, null);
});

test('quick hits build a combo and a pause breaks it; a drill can be stopped early and keeps its score', () => {
  const game = range();
  game.rangeEquip('pistol');
  game.startDrill('mixed');
  const target = dummy(game, 'dummy-3-15');
  closeTo(game, target, 10);
  const hit = () => { game.player.yaw = 0; assert.ok(game.shootPlayer({ x: target.position.x, y: 1.1, z: target.position.z }, true)); game.update(0.6, still); };
  hit();
  assert.equal(game.state.drill!.combo, 0, 'the first hit starts a chain');
  hit();
  assert.equal(game.state.drill!.combo, 1);
  assert.ok(target.alive, 'a pistol does not drop it in two shots');
  const scored = game.state.drill!.score;
  game.update(3, still);
  hit();
  assert.equal(game.state.drill!.combo, 0, 'a long pause breaks the chain');
  assert.ok(game.state.drill!.score > scored);
  assert.ok(game.stopDrill());
  assert.equal(game.state.drill!.done, true);
  const kept = game.state.drill!.score;
  game.update(1, still);
  hit();
  assert.equal(game.state.drill!.score, kept, 'it counts nothing once stopped');
  // Only on the range.
  const arena = new GameSimulation({ seed: 4, botCount: 2, map: 'arena' });
  arena.start();
  assert.equal(arena.startDrill('warm'), false);
  assert.equal(arena.rangeResetVehicles(), false);
});

test('the motor pool has one of every kind of vehicle, a wreck is replaced, and the L key puts them all back', () => {
  const game = range();
  const kinds = game.state.vehicles.map(v => v.kind);
  assert.deepEqual(kinds, MOTOR_POOL.map(p => p.kind));
  assert.equal(new Set(kinds).size, Object.keys(VEHICLES).length, 'all twelve kinds');
  for (const v of game.state.vehicles) assert.ok(v.health === VEHICLES[v.kind!].health && Math.abs(v.position.x) < RANGE_HALF && v.position.x < -100, 'in the west, whole');
  const car = game.state.vehicles[0], home = { ...car.position };
  car.health = 0;
  run(game, 3);
  assert.equal(car.health, 0, 'a wreck stays a few seconds');
  run(game, 4);
  assert.equal(car.health, VEHICLES[car.kind!].health);
  assert.deepEqual([car.position.x, car.position.z], [home.x, home.z]);
  // Drive one off, then reset.
  const bike = game.state.vehicles.find(v => v.kind === 'bike')!;
  game.player.position = { x: bike.position.x + 1, y: 0, z: bike.position.z };
  assert.ok(game.useVehicle());
  assert.equal(game.player.vehicleId, bike.id);
  for (let i = 0; i < 60; i++) game.update(1 / 30, { ...still, throttle: 1 });
  assert.ok(bike.speed > 3, 'it drives');
  assert.ok(game.rangeResetVehicles());
  assert.equal(game.player.vehicleId ?? null, null, 'the driver is out');
  assert.equal(bike.speed, 0);
  assert.ok(Math.hypot(bike.position.x - MOTOR_POOL.find(p => p.kind === 'bike')!.x, bike.position.z - MOTOR_POOL.find(p => p.kind === 'bike')!.z) < 1e-6);
});

test('the slalom cones are on the north strip, with room between them for the widest vehicle', () => {
  const world = createRangeWorld();
  const cones = world.obstacles.filter(o => o.id.startsWith('cone-')).sort((a, b) => a.x - b.x);
  assert.ok(cones.length >= 15, `${cones.length} cones`);
  for (let i = 1; i < cones.length; i++) {
    assert.ok(Math.hypot(cones[i].x - cones[i - 1].x, cones[i].z - cones[i - 1].z) > 2 * VEHICLES.minibus.radius + 3, 'a bus fits through the gaps');
    assert.equal(Math.round(Math.abs(cones[i].z - SLALOM.z) * 10), Math.round(SLALOM.offset * 10), 'alternate sides of the line');
  }
  assert.ok(cones.every(c => c.z > FIRING_Z + 250 + 8), 'beyond the far end of the lanes');
  for (const p of MOTOR_POOL) assert.ok(!world.obstacles.some(o => Math.abs(p.x - o.x) < o.width / 2 + 2.5 && Math.abs(p.z - o.z) < o.depth / 2 + 4), `the ${p.kind} is not parked in cover`);
});
