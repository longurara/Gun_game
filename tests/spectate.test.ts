import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameSimulation } from '../src/game/simulation.ts';
import type { PlayerInput } from '../src/types.ts';

const idle: PlayerInput = { moveX: 0, moveZ: 0, sprint: false, jump: false };
/** Kill the player, then let one step run so the match notices. */
function kill(game: GameSimulation, by = 'bot-1'): void {
  (game as unknown as { damage(a: unknown, n: number, s?: string): void }).damage(game.player, 999, by);
  game.update(1 / 30, idle);
}

test('dying records the place and time, and the player can keep watching until at most one opponent is left', () => {
  const game = new GameSimulation({ seed: 5, botCount: 12, map: 'valley' });
  game.start();
  for (let i = 0; i < 30 * 5; i++) game.update(1 / 30, idle);
  kill(game);
  assert.equal(game.state.phase, 'lost');
  const rank = game.state.playerRank!, diedAt = game.state.diedAt!;
  assert.equal(rank, 13, 'twelve opponents were alive');
  assert.ok(diedAt > 4.9 && diedAt < 6);
  assert.equal(game.continueAsSpectator(), true);
  assert.equal(game.state.phase, 'playing');
  assert.equal(game.continueAsSpectator(), false, 'only once');
  // The dead player cannot act while watching.
  assert.equal(game.lootInReach, null);
  assert.equal(game.shootPlayer({ x: 0, y: 1, z: 10 }), false);
  assert.equal(game.useVehicle(), false);
  // The match continues until one opponent is left; then the results come back with the original place and time.
  for (let i = 0; i < 30 * 60 * 15 && game.state.phase === 'playing'; i++) {
    game.player.health = 0;
    game.update(1 / 30, idle);
  }
  assert.equal(game.state.phase, 'lost');
  assert.ok(game.state.actors.filter(a => a.alive).length <= 1);
  assert.equal(game.state.playerRank, rank, 'the place does not change while watching');
  assert.equal(game.state.diedAt, diedAt);
  assert.equal(game.continueAsSpectator(), false, 'nothing left to watch');
});

test('a spectator can stop watching early, and a winner cannot spectate', () => {
  const game = new GameSimulation({ seed: 4, botCount: 6, map: 'arena' });
  game.start();
  kill(game);
  assert.ok(game.continueAsSpectator());
  game.endSpectating();
  assert.equal(game.state.phase, 'lost');
  const won = new GameSimulation({ seed: 4, botCount: 2, map: 'arena' });
  won.start();
  for (const a of won.state.actors) if (!a.isPlayer) a.alive = false;
  won.update(1 / 30, idle);
  assert.equal(won.state.phase, 'won');
  assert.equal(won.continueAsSpectator(), false);
});

test('with one opponent left there is nothing to watch', () => {
  const game = new GameSimulation({ seed: 4, botCount: 3, map: 'arena' });
  game.start();
  game.state.actors.filter(a => !a.isPlayer).slice(1).forEach(a => { a.alive = false; });
  kill(game);
  assert.equal(game.state.phase, 'lost');
  assert.equal(game.continueAsSpectator(), false);
});
