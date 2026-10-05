import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameSimulation } from '../src/game/simulation.ts';
import { movementSpread, STANCE } from '../src/game/stance.ts';
import type { PlayerInput, Stance } from '../src/types.ts';

const idle: PlayerInput = { moveX: 0, moveZ: 0, sprint: false, jump: false };
const forward: PlayerInput = { ...idle, moveZ: 1 };

function arena() {
  const game = new GameSimulation({ seed: 7, botCount: 2, map: 'arena' });
  game.start();
  game.botsFrozen = true;
  // An empty patch of the arena: no cover within sight.
  game.player.position = { x: -60, y: 0, z: -20 };
  return game;
}
const run = (game: GameSimulation, seconds: number, input: PlayerInput) => { for (let i = 0; i < seconds * 30; i++) game.update(1 / 30, input); };
const walked = (game: GameSimulation, input: PlayerInput, seconds = 1) => {
  const from = { ...game.player.position };
  run(game, seconds, input);
  return Math.hypot(game.player.position.x - from.x, game.player.position.z - from.z);
};

test('crouching and lying down slow the player: stand 5.2 m/s, crouch 2.9, prone 1.3, sprint only on foot', () => {
  const speeds = {} as Record<Stance, number>;
  for (const stance of ['stand', 'crouch', 'prone'] as const) {
    const game = arena();
    assert.ok(game.setStance(stance));
    speeds[stance] = walked(game, forward);
  }
  assert.ok(Math.abs(speeds.stand - 5.2) < 0.3, `${speeds.stand}`);
  assert.ok(Math.abs(speeds.crouch - 2.9) < 0.3, `${speeds.crouch}`);
  assert.ok(Math.abs(speeds.prone - 1.3) < 0.2, `${speeds.prone}`);
  // Sprinting from a crouch stands you up first and then you run.
  const game = arena();
  game.setStance('crouch');
  const sprint = walked(game, { ...forward, sprint: true });
  assert.equal(game.player.stance, 'stand');
  assert.ok(sprint > 6.5, `${sprint}`);
});

test('jumping from a crouch or lying down gets you up instead of jumping', () => {
  const game = arena();
  game.setStance('prone');
  game.update(1 / 30, { ...idle, jump: true });
  assert.equal(game.player.stance, 'stand');
  assert.ok(game.player.position.y < 0.01, 'no jump on the same press');
  game.update(1 / 30, idle);
  game.update(1 / 30, { ...idle, jump: true });
  assert.ok(game.player.position.y > 0.01, 'the next press jumps');
});

test('you cannot stand up under a low ceiling, but you can crouch or crawl under it', () => {
  const game = arena();
  game.world.obstacles.push({ id: 'beam', x: -60, z: -17, width: 8, depth: 6, height: 3, bottom: 1.5, kind: 'wall' });
  assert.equal(game.setStance('crouch'), true, 'a crouch fits under 1.5 m');
  // Walk in under the beam.
  run(game, 2, forward);
  assert.ok(game.player.position.z > -16, `walked under it: ${game.player.position.z}`);
  assert.equal(game.setStance('stand'), false, 'there is no room to stand');
  assert.equal(game.player.stance, 'crouch');
  // Prone fits even better; and once out in the open you can stand.
  run(game, 6, forward);
  assert.equal(game.setStance('stand'), true);
});

test('a shot at standing height flies over someone lying down, and one at their body hits', () => {
  const game = arena();
  game.player.weapon = 'rifle'; game.player.ownedWeapons = ['rifle']; game.player.ammo.rifle = 30;
  const bot = game.state.actors[1];
  bot.position = { x: -60, y: 0, z: 10 };
  bot.stance = 'prone';
  const shoot = (aimY: number) => {
    game.drainEvents();
    game.player.ammo.rifle = 30;
    (game as unknown as { runtimes: Map<string, { weaponCooldowns: Record<string, number>; cooldown: number }> }).runtimes.get('player')!.weaponCooldowns.rifle = 0;
    (game as unknown as { runtimes: Map<string, { cooldown: number }> }).runtimes.get('player')!.cooldown = 0;
    game.shootPlayer({ x: bot.position.x, y: aimY, z: bot.position.z }, true);
    return game.drainEvents().find(e => e.type === 'shot') as { hitId?: string } | undefined;
  };
  assert.equal(shoot(1.15)?.hitId, undefined, 'over the back of a prone player');
  assert.equal(shoot(0.3)?.hitId, bot.id, 'at the low body');
  bot.stance = 'stand';
  assert.equal(shoot(1.15)?.hitId, bot.id, 'standing: hit at chest height');
  bot.stance = 'crouch';
  assert.equal(shoot(1.7)?.hitId, undefined, 'over a crouching head');
  assert.equal(shoot(0.9)?.hitId, bot.id);
});

test('the bullet cone grows when moving, sprinting and jumping, shrinks when aiming, crouching or lying down', () => {
  const game = arena();
  const still = game.currentSpread(false);
  assert.ok(game.currentSpread(true) < still, 'aiming steadies');
  game.setStance('crouch');
  const crouched = game.currentSpread(false);
  assert.ok(Math.abs(crouched - still * STANCE.crouch.spread) < 1e-9);
  game.setStance('prone');
  assert.ok(game.currentSpread(false) < crouched);
  game.setStance('stand');
  run(game, 1, forward);
  const walking = game.currentSpread(false);
  assert.ok(walking > still * 1.5, 'walking spreads the shots');
  run(game, 1, { ...forward, sprint: true });
  assert.ok(game.currentSpread(false) > walking, 'sprinting spreads them more');
  assert.ok(game.currentSpread(true) < game.currentSpread(false), 'but aiming still helps');
  run(game, 1, idle);
  assert.ok(Math.abs(game.currentSpread(false) - still) < 1e-6, 'standing still returns to the base cone');
  assert.equal(movementSpread(0, false, false), 0);
  assert.ok(movementSpread(0, true, false) > movementSpread(5, false, false), 'jumping is the worst');
  assert.ok(movementSpread(5, false, true) < movementSpread(5, false, false));
});

test('a bot notices a standing player from further away than a crouching one, and a lying one least of all', () => {
  const noticed = (stance: Stance, distance: number) => {
    const game = new GameSimulation({ seed: 7, botCount: 2, map: 'arena' });
    game.start();
    const bot = game.state.actors[1];
    bot.weapon = 'rifle';
    bot.position = { x: -60, y: 0, z: -20 };
    bot.yaw = Math.PI / 2;
    game.player.position = { x: -60 + distance, y: 0, z: -20 };
    game.player.stance = stance;
    game.state.actors.slice(2).forEach(a => { a.alive = false; });
    (game as unknown as { rebuildActorGrid(): void }).rebuildActorGrid();
    const runtime = (game as unknown as { runtime(a: unknown): { targetId: string | null } }).runtime(bot);
    (game as unknown as { perceive(a: unknown, r: unknown, easy: boolean): void }).perceive(bot, runtime, false);
    return runtime.targetId === 'player';
  };
  // Detection range is 34 m for this gun: crouching shrinks it to about 26 m, lying down to about 19 m.
  assert.equal(noticed('stand', 30), true, 'standing at 30 m is seen');
  assert.equal(noticed('crouch', 30), false, 'crouching at 30 m is not');
  assert.equal(noticed('crouch', 24), true, 'crouching at 24 m is');
  assert.equal(noticed('prone', 24), false, 'lying down at 24 m is not');
  assert.equal(noticed('prone', 17), true, 'lying down at 17 m is');
});

test('stance is dropped when getting into a car and cannot change while driving or falling', () => {
  const game = new GameSimulation({ seed: 3, botCount: 1, map: 'island' });
  game.start();
  const car = game.state.vehicles[0];
  game.player.position = { x: car.position.x + 2.5, y: car.position.y, z: car.position.z };
  game.setStance('crouch');
  assert.ok(game.useVehicle());
  assert.equal(game.player.stance, 'stand');
  assert.equal(game.setStance('prone'), false);
  const falling = new GameSimulation({ seed: 3, botCount: 1, map: 'island', drop: true });
  falling.start();
  assert.equal(falling.setStance('crouch'), false, 'not from the plane');
});
