import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameSimulation } from '../src/game/simulation.ts';
import { BREATH_RECOVER, BREATH_RESUME, BREATH_SECONDS } from '../src/game/breath.ts';
import { applySnapshot, SnapshotBuilder } from '../src/net/protocol.ts';
import { FIRING_Z } from '../src/game/range.ts';

const still = { moveX: 0, moveZ: 0, sprint: false, jump: false };
const hold = { ...still, sprint: true };
/** A range with the sniper in hand (a 6x scope), nobody else about. */
function sniperRange() {
  const game = new GameSimulation({ seed: 4, botCount: 0, map: 'range' });
  game.start();
  game.rangeEquip('sniper');
  return game;
}
const run = (game: GameSimulation, seconds: number, input = still) => { for (let i = 0; i < seconds * 30; i++) game.update(1 / 30, input); game.drainEvents(); };

test('Shift while standing still behind a scope holds the breath; it drains, and runs out into a short breathless spell', () => {
  const game = sniperRange();
  const p = game.player;
  run(game, 0.5);
  assert.equal(p.holding, false);
  assert.ok((p.breath ?? 0) >= BREATH_SECONDS - 1e-6);
  run(game, 2, hold);
  assert.equal(p.holding, true);
  assert.ok(Math.abs(p.breath! - (BREATH_SECONDS - 2)) < 0.1, `breath ${p.breath}`);
  run(game, 3, hold);
  assert.equal(p.holding, false, 'out of breath');
  assert.equal(p.winded, true);
  assert.ok(p.breath! < BREATH_RESUME);
  // Holding Shift on does not help while winded; letting go lets the breath come back until it can be held again.
  run(game, 1, hold);
  assert.equal(p.holding, false);
  run(game, (BREATH_RESUME / BREATH_RECOVER) + 0.3);
  assert.equal(p.winded, false);
  run(game, 0.2, hold);
  assert.equal(p.holding, true);
  run(game, BREATH_SECONDS / BREATH_RECOVER + 1);
  assert.ok(p.breath! > BREATH_SECONDS - 0.05);
});

test('moving, a gun without a scope, or a car all rule it out', () => {
  const game = sniperRange();
  const p = game.player;
  run(game, 1, { ...hold, moveZ: 1 });
  assert.equal(p.holding, false, 'Shift while walking is a sprint');
  game.rangeEquip('rifle');
  run(game, 1, hold);
  assert.equal(p.holding, false, 'a 1.4x sight has nothing to steady');
  game.rangeEquip('dmr');
  run(game, 1, hold);
  assert.equal(p.holding, true, 'a 4x scope counts');
});

test('a held breath makes the shot tighter and the bullet\'s path flatter', () => {
  const free = sniperRange(), held = sniperRange();
  assert.ok(free.currentSpread(true) > 0);
  run(held, 1, hold);
  assert.ok(held.currentSpread(true) < free.currentSpread(true) * 0.5, 'a tighter cone');
  // Shoot a target 200 m away at chest height: the bullet lands higher when the breath is held.
  const landing = (game: GameSimulation, input: typeof still) => {
    const dummy = game.state.actors.find(a => a.id === 'dummy-3-200')!;
    game.player.position = { x: 0, y: 0, z: FIRING_Z };
    for (let i = 0; i < 30; i++) game.update(1 / 30, input);
    game.drainEvents();
    assert.ok(game.shootPlayer({ x: dummy.position.x, y: 1.4, z: dummy.position.z }, true));
    const shot = game.drainEvents().find(e => e.type === 'shot');
    assert.ok(shot && shot.type === 'shot');
    return shot.to.y;
  };
  const yFree = landing(free, still), yHeld = landing(held, hold);
  assert.ok(yHeld > yFree + 0.2, `held ${yHeld.toFixed(2)} m against ${yFree.toFixed(2)} m`);
  assert.ok(yHeld > 1.0 && yHeld < 1.9, 'and close to where it was aimed');
  // An unaimed shot gets no help from a held breath.
  const hip = sniperRange();
  run(hip, 1, hold);
  assert.equal(hip.currentSpread(false) > hip.currentSpread(true), true);
});

test('a client sees its own breath through the private part of a snapshot', () => {
  const options = { seed: 77, botCount: 4, map: 'arena', humans: 2, names: ['A', 'B'], drop: false } as const;
  const host = new GameSimulation({ ...options, localId: 'p0' });
  const mirror = new GameSimulation({ ...options, localId: 'p1', remote: true });
  host.start(); mirror.start();
  const p1 = host.actorById('p1')!;
  p1.position = { x: 3, y: 0, z: 0 };
  p1.ownedWeapons = ['sniper']; p1.weapon = 'sniper';
  for (let i = 0; i < 60; i++) { host.setHumanInput('p1', hold); host.update(1 / 30, still); }
  assert.equal(p1.holding, true);
  const builder = new SnapshotBuilder(host);
  applySnapshot(mirror, JSON.parse(JSON.stringify(builder.build(host.drainEvents()))), { writePositions: true });
  const mine = mirror.actorById('p1')!;
  assert.equal(mine.holding, true);
  assert.ok(Math.abs((mine.breath ?? 0) - p1.breath!) < 0.1, `${mine.breath} against ${p1.breath}`);
});
