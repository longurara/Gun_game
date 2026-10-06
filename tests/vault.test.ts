import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameSimulation } from '../src/game/simulation.ts';

const forward = { moveX: 0, moveZ: 1, sprint: false, jump: false };

function yard() {
  const game = new GameSimulation({ seed: 3, botCount: 1, map: 'arena' });
  game.start();
  game.botsFrozen = true;
  game.world.obstacles = [];
  game.player.position = { x: 0, y: 0, z: 0 }; game.player.yaw = 0;
  return game;
}
/** Walk forward for a moment, then press jump (a fresh press), then keep walking. */
function runAndJump(game: GameSimulation, seconds: number) {
  for (let i = 0; i < 6; i++) game.update(1 / 30, forward);
  game.update(1 / 30, { ...forward, jump: true });
  for (let i = 0; i < seconds * 30; i++) game.update(1 / 30, { ...forward, jump: false });
}

test('running at a crate and pressing jump carries you over it', () => {
  const game = yard();
  game.world.obstacles.push({ id: 'crate', x: 0, z: 1.6, width: 1.2, depth: 1.0, height: 1.1, kind: 'crate' });
  runAndJump(game, 0.9);
  assert.ok(game.player.position.z > 2.4, `got to z ${game.player.position.z.toFixed(2)}`);
  assert.ok(Math.abs(game.player.position.y) < 0.05, 'back on the ground');
});

test('a window sill is climbed through', () => {
  const game = yard();
  game.world.obstacles.push(
    { id: 'sill', x: 0, z: 1.6, width: 1.6, depth: 0.4, height: 1.0, kind: 'wall' },
    { id: 'head', x: 0, z: 1.6, width: 1.6, depth: 0.4, height: 3.3, bottom: 2.15, kind: 'wall' },
    { id: 'left', x: -1.6, z: 1.6, width: 1.6, depth: 0.4, height: 3.3, kind: 'wall' },
    { id: 'right', x: 1.6, z: 1.6, width: 1.6, depth: 0.4, height: 3.3, kind: 'wall' },
  );
  runAndJump(game, 0.9);
  assert.ok(game.player.position.z > 2.2, `got through to z ${game.player.position.z.toFixed(2)}`);
});

test('a wall that is too tall is not vaulted: you just jump', () => {
  const game = yard();
  game.world.obstacles.push({ id: 'wall', x: 0, z: 1.6, width: 6, depth: 0.4, height: 2.4, kind: 'wall' });
  for (let i = 0; i < 6; i++) game.update(1 / 30, forward);
  game.update(1 / 30, { ...forward, jump: true });
  let high = 0;
  for (let i = 0; i < 20; i++) { game.update(1 / 30, { ...forward, jump: false }); high = Math.max(high, game.player.position.y); }
  assert.ok(game.player.position.z < 1.4, 'still on this side');
  assert.ok(high > 0.5, 'it was an ordinary jump');
});

test('no vault when there is nowhere to land on the other side', () => {
  const game = yard();
  game.world.obstacles.push({ id: 'crate', x: 0, z: 1.6, width: 3, depth: 1.0, height: 1.1, kind: 'crate' }, { id: 'block', x: 0, z: 5, width: 8, depth: 6, height: 5, kind: 'building' });
  for (let i = 0; i < 6; i++) game.update(1 / 30, forward);
  game.update(1 / 30, { ...forward, jump: true });
  game.update(1 / 30, { ...forward, jump: false });
  assert.ok(game.player.position.y >= 0, 'nothing odd');
  for (let i = 0; i < 30; i++) game.update(1 / 30, { ...forward, jump: false });
  assert.ok(game.player.position.z < 1.4, 'it stayed this side of the crate');
});

test('standing still and pressing jump is an ordinary jump, even beside a crate', () => {
  const game = yard();
  game.world.obstacles.push({ id: 'crate', x: 0, z: 1.2, width: 1.2, depth: 1.0, height: 1.1, kind: 'crate' });
  game.update(1 / 30, { moveX: 0, moveZ: 0, sprint: false, jump: true });
  let high = 0;
  for (let i = 0; i < 15; i++) { game.update(1 / 30, { moveX: 0, moveZ: 0, sprint: false, jump: false }); high = Math.max(high, game.player.position.y); }
  assert.ok(high > 0.5);
  assert.ok(Math.abs(game.player.position.z) < 0.2);
});

test('a client predicts the same vault as the host', () => {
  const options = { seed: 5, botCount: 1, map: 'arena', humans: 2, names: ['A', 'B'], drop: false } as const;
  const host = new GameSimulation({ ...options, localId: 'p0' });
  const mirror = new GameSimulation({ ...options, localId: 'p1', remote: true });
  for (const sim of [host, mirror]) { sim.start(); sim.world.obstacles = [{ id: 'crate', x: 0, z: 1.6, width: 1.2, depth: 1.0, height: 1.1, kind: 'crate' }]; }
  host.actorById('p1')!.position = { x: 0, y: 0, z: 0 }; mirror.player.position = { x: 0, y: 0, z: 0 };
  host.actorById('p0')!.position = { x: 40, y: 0, z: 40 };
  for (let i = 0; i < 6; i++) { host.setHumanInput('p1', forward); host.update(1 / 30); mirror.update(1 / 30, forward); }
  host.setHumanInput('p1', { ...forward, jump: true }, true); host.update(1 / 30); mirror.update(1 / 30, { ...forward, jump: true });
  for (let i = 0; i < 25; i++) { host.setHumanInput('p1', forward); host.update(1 / 30); mirror.update(1 / 30, forward); }
  assert.ok(Math.abs(host.actorById('p1')!.position.z - mirror.player.position.z) < 0.5, `host ${host.actorById('p1')!.position.z.toFixed(2)} vs mirror ${mirror.player.position.z.toFixed(2)}`);
  assert.ok(mirror.player.position.z > 2.4);
});
