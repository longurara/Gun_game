import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameSimulation } from '../src/game/simulation.ts';
import { WEAPONS } from '../src/game/config.ts';
import { emptyAmmo, emptyReserve } from '../src/game/weapons.ts';
import type { Actor, PlayerInput } from '../src/types.ts';

const idle: PlayerInput = { moveX: 0, moveZ: 0, sprint: false, jump: false };

/** A two-actor range. Bots are frozen unless the test is about their behaviour (`ai = true`). */
function range(ai = false): { game: GameSimulation; target: Actor } {
  const game = new GameSimulation({ seed: 41, botCount: 5, difficulty: 'easy' });
  game.start();
  game.botsFrozen = !ai;
  game.world.obstacles = [];
  game.player.position = { x: 0, y: 0, z: 0 };
  const target = game.state.actors[1];
  target.position = { x: 0, y: 0, z: 8 };
  target.yaw = Math.PI;
  target.ammo = emptyAmmo();
  target.reserve = emptyReserve();
  game.state.actors = [game.player, target];
  game.drainEvents();
  return { game, target };
}

test('menu is inert; start produces the selected bot count and useful nearby supplies', () => {
  const game = new GameSimulation({ seed: 42 });
  const initial = structuredClone(game.state);
  game.update(5, idle);
  assert.deepEqual(game.state, initial);
  assert.equal(game.shootPlayer({ x: 0, y: 1.2, z: 10 }), false);
  assert.equal(game.lootInReach, null);
  game.start({ botCount: 7 });
  assert.equal(game.state.actors.length, 8);
  assert.equal(game.state.phase, 'playing');
  assert.deepEqual(game.player.position, { x: 0, y: 0, z: -65 });
  for (const kind of ['shotgun', '556Ammo', 'medkit']) {
    assert.ok(game.state.loot.some(loot => loot.kind === kind && Math.hypot(loot.position.x, loot.position.z + 65) < 2.8));
  }
});

test('rifle fire uses cadence, consumes one round, damages the nearest body and records stats', () => {
  const { game, target } = range();
  assert.equal(game.shootPlayer({ x: 0, y: 1.1, z: 8 }), true);
  assert.equal(target.health, 100 - WEAPONS.rifle.damage);
  assert.equal(game.player.ammo.rifle, 29);
  assert.equal(game.shootPlayer({ x: 0, y: 1.1, z: 8 }), false);
  assert.equal(game.state.shots, 1);
  assert.equal(game.state.hits, 1);
  const events = game.drainEvents();
  assert.equal(events.filter(event => event.type === 'shot').length, 1);
  assert.equal(events.filter(event => event.type === 'damage').length, 1);
  game.update(0.16, idle);
  assert.equal(game.shootPlayer({ x: 0, y: 1.1, z: 8 }), true);
  assert.equal(game.state.shots, 2);
});

test('solid walls stop bullets and their tracer at the wall surface', () => {
  const { game, target } = range();
  game.world.obstacles = [{ id: 'wall', x: 0, z: 4, width: 6, depth: 2, height: 3, kind: 'building' }];
  game.shootPlayer({ x: 0, y: 1.1, z: 8 });
  assert.equal(target.health, 100);
  assert.equal(game.state.hits, 0);
  const shot = game.drainEvents().find(event => event.type === 'shot');
  assert.ok(shot && shot.type === 'shot');
  assert.ok(Math.abs(shot.to.z - 3) < 0.01);
  assert.equal(shot.hitId, undefined);
});

test('headshots deal more damage, while elevated hitboxes are not hit by a ground-level ray', () => {
  const headshot = range();
  headshot.game.shootPlayer({ x: 0, y: 1.65, z: 8 });
  assert.ok(headshot.target.health < 100 - WEAPONS.rifle.damage);
  const elevated = range();
  elevated.target.position.y = 2;
  elevated.game.shootPlayer({ x: 0, y: 1.1, z: 8 });
  assert.equal(elevated.target.health, 100);
  elevated.game.update(0.16, idle);
  elevated.game.shootPlayer({ x: 0, y: 3.1, z: 8 });
  assert.equal(elevated.target.health, 75);
});

test('shotgun pellets aggregate damage but count as one shot and one successful hit', () => {
  const { game, target } = range();
  target.position.z = 3;
  game.player.ownedWeapons.push('shotgun');
  game.player.ammo.shotgun = 6;
  assert.equal(game.switchWeapon('shotgun'), true);
  game.update(0.3, idle);
  assert.equal(game.shootPlayer({ x: 0, y: 1.1, z: 3 }), true);
  assert.ok(target.health < 40);
  assert.equal(game.player.ammo.shotgun, 5);
  assert.equal(game.state.shots, 1);
  assert.equal(game.state.hits, 1);
  assert.equal(game.drainEvents().filter(event => event.type === 'shot').length, 1);
});

test('reload transfers only available reserve rounds and cannot shoot while reloading', () => {
  const { game } = range();
  game.player.ammo.rifle = 1;
  game.player.reserve['556'] = 2;
  assert.equal(game.reload(), true);
  assert.equal(game.reload(), false);
  assert.equal(game.shootPlayer({ x: 0, y: 1.1, z: 8 }), false);
  game.update(WEAPONS.rifle.reloadTime + 0.01, idle);
  assert.equal(game.player.ammo.rifle, 3);
  assert.equal(game.player.reserve['556'], 0);
  assert.equal(game.player.reloading, 0);
  assert.equal(game.reload(), false);
});

test('pause freezes zone, movement, AI, healing and reloading; resume finishes timers', () => {
  const { game } = range();
  game.player.ammo.rifle = 3;
  game.reload();
  game.setPaused(true);
  const snapshot = structuredClone(game.state);
  game.update(20, { ...idle, moveX: 1, jump: true });
  assert.deepEqual(game.state, snapshot);
  assert.equal(game.interact(), false);
  assert.equal(game.heal(), false);
  game.togglePause();
  game.update(2, idle);
  assert.equal(game.state.phase, 'playing');
  assert.equal(game.player.ammo.rifle, WEAPONS.rifle.magazine);
  assert.ok(game.state.elapsed >= 1.99);
});

test('jump is edge-triggered, lands on the ground, and held jump does not bounce', () => {
  const { game } = range();
  game.update(0.2, { ...idle, jump: true });
  assert.ok(game.player.position.y > 0.6);
  game.update(1.5, { ...idle, jump: true });
  assert.equal(game.player.position.y, 0);
  game.update(0.01, idle);
  game.update(0.2, { ...idle, jump: true });
  assert.ok(game.player.position.y > 0.6);
});

test('movement collides with solid cover and is bounded by the world', () => {
  const { game } = range();
  game.world.obstacles = [{ id: 'wall', x: 0, z: 3, width: 20, depth: 2, height: 4, kind: 'building' }];
  game.update(2, { ...idle, moveZ: 1, sprint: true });
  assert.ok(game.player.position.z <= 2 - 0.42);
  game.player.position.x = 99;
  game.update(1, { ...idle, moveX: 1 });
  assert.ok(game.player.position.x <= 99.58);
});

test('healing is a stationary channel; cancelling does not consume the medkit', () => {
  const { game } = range();
  game.player.health = 30;
  assert.equal(game.heal(), true);
  game.update(1, idle);
  assert.equal(game.player.health, 30);
  game.update(0.1, { ...idle, moveX: 1 });
  assert.equal(game.player.healing, 0);
  assert.equal(game.player.medkits, 1);
  assert.equal(game.heal(), true);
  game.update(3.05, idle);
  assert.equal(game.player.health, 90);
  assert.equal(game.player.medkits, 0);
  assert.equal(game.heal(), false);
});

test('loot can be collected once, unlocks a loaded shotgun and emits feedback', () => {
  const game = new GameSimulation();
  game.start();
  const shotgun = game.state.loot.find(loot => loot.kind === 'shotgun')!;
  game.player.position = { ...shotgun.position };
  assert.equal(game.lootInReach?.id, shotgun.id);
  assert.equal(game.interact(), true);
  assert.equal(shotgun.active, false);
  assert.ok(game.player.ownedWeapons.includes('shotgun'));
  assert.equal(game.player.ammo.shotgun, WEAPONS.shotgun.magazine);
  assert.ok(game.drainEvents().some(event => event.type === 'pickup' && event.kind === 'shotgun'));
});

test('last bot death produces one victory event; a restart resets stats, actors, loot and timers', () => {
  const { game, target } = range();
  target.health = 20;
  game.shootPlayer({ x: 0, y: 1.1, z: 8 });
  assert.equal(game.state.phase, 'won');
  assert.equal(game.state.kills, 1);
  assert.equal(target.alive, false);
  assert.equal(game.drainEvents().filter(event => event.type === 'end').length, 1);
  game.update(30, idle);
  assert.equal(game.drainEvents().length, 0);
  game.start({ seed: 41 });
  assert.equal(game.state.phase, 'playing');
  assert.equal(game.state.elapsed, 0);
  assert.equal(game.state.shots, 0);
  assert.equal(game.state.hits, 0);
  assert.equal(game.state.kills, 0);
  assert.equal(game.state.actors.length, 6);
  assert.ok(game.state.actors.every(actor => actor.alive && actor.health === 100));
  assert.ok(game.state.loot.every(loot => loot.active));
  assert.equal(game.player.reloading, 0);
  assert.equal(game.player.healing, 0);
  game.returnToMenu();
  assert.equal(game.state.phase, 'menu');
});

test('outside-zone damage ends the match on player death exactly once', () => {
  const { game } = range();
  game.player.position.x = 99;
  game.player.health = 1;
  game.update(1, idle);
  assert.equal(game.state.phase, 'lost');
  assert.equal(game.player.health, 0);
  assert.equal(game.drainEvents().filter(event => event.type === 'end').length, 1);
  const elapsed = game.state.elapsed;
  game.update(10, idle);
  assert.equal(game.state.elapsed, elapsed);
});

test('zone progresses through all stages to zero so a match cannot wait forever', () => {
  const { game, target } = range();
  game.player.health = 100000;
  target.health = 100000;
  game.update(431, idle);
  assert.equal(game.state.zone.stage, 6);
  assert.equal(game.state.zone.radius, 0);
  assert.equal(game.state.zone.nextRadius, 0);
  assert.equal(game.state.zone.timeRemaining, 0);
  const health = game.player.health;
  game.update(1, idle);
  assert.ok(game.player.health < health - 20);
  assert.ok(game.state.elapsed < 600);
});

test('bot routes around a blocking building to reach the safe zone without teleporting', () => {
  const { game, target: bot } = range(true);
  game.world.obstacles = [{ id: 'barrier', x: 0, z: 0, width: 18, depth: 4, height: 5, kind: 'building' }];
  bot.position = { x: 0, y: 0, z: -12 };
  bot.health = 10000;
  game.player.position = { x: 0, y: 0, z: 13 };
  game.player.health = 10000;
  game.state.zone = { center: { x: 0, z: 12 }, radius: 12, nextCenter: { x: 0, z: 12 }, nextRadius: 10, stage: 0, timeRemaining: 1000, isShrinking: false };
  let maximumSideDistance = 0;
  for (let i = 0; i < 160; i++) {
    const previous = { ...bot.position };
    game.update(0.1, idle);
    maximumSideDistance = Math.max(maximumSideDistance, Math.abs(bot.position.x));
    assert.ok(Math.hypot(bot.position.x - previous.x, bot.position.z - previous.z) <= 0.62);
    assert.ok(!(Math.abs(bot.position.x) < 9.42 && Math.abs(bot.position.z) < 2.42));
  }
  assert.ok(maximumSideDistance > 9.42, 'bot must walk around the side of the wall');
  assert.ok(bot.position.z > 4, `bot reached z=${bot.position.z}`);
});

test('same seed and settings recreate the same initial world and bot state', () => {
  const game = new GameSimulation({ seed: 107, botCount: 7 });
  game.start();
  const initial = structuredClone(game.state);
  game.update(5, idle);
  game.start();
  assert.deepEqual(game.state, initial);
});

test('bots respect line-of-sight, wait for a reaction and reload after firing the last round', () => {
  const hidden = range(true);
  hidden.target.ammo.rifle = 30;
  hidden.game.world.obstacles = [{ id: 'wall', x: 0, z: 4, width: 20, depth: 2, height: 4, kind: 'building' }];
  hidden.game.update(0.6, idle);
  assert.ok(!hidden.game.drainEvents().some(event => event.type === 'shot' && event.actorId === hidden.target.id));

  const visible = range(true);
  visible.target.ammo.rifle = 1;
  visible.target.reserve['556'] = 2;
  visible.game.player.health = 1000;
  visible.game.update(0.6, idle);
  assert.ok(!visible.game.drainEvents().some(event => event.type === 'shot'));
  let shot = false;
  for (let i = 0; i < 30 && !shot; i++) {
    visible.game.update(0.1, idle);
    shot = visible.game.drainEvents().some(event => event.type === 'shot' && event.actorId === visible.target.id);
  }
  assert.ok(shot, 'visible enemy is fired upon after a reaction delay');
  assert.equal(visible.target.ammo.rifle, 0);
  visible.game.update(0.05, idle);
  assert.ok(visible.target.reloading > 0);
  assert.equal(visible.target.reserve['556'], 2);
  visible.game.update(WEAPONS.rifle.reloadTime + 0.05, idle);
  assert.equal(visible.target.reserve['556'], 0);
  assert.ok(visible.target.ammo.rifle >= 1 && visible.target.ammo.rifle <= 2);
});

test('ten seeded bot-only rounds avoid an opening massacre and all finish before 10 minutes', () => {
  for (const seed of [1, 2, 3, 4, 5, 41, 107, 2026, 72341, 99991]) {
    const game = new GameSimulation({ seed, botCount: 7, difficulty: 'normal' });
    game.start();
    // Isolate bot pacing from human skill: the observer cannot be perceived or killed by the zone.
    game.player.position = { x: 999, y: 0, z: 999 };
    game.player.health = 100000;
    // Capable bots clash early on a 200 m arena, but the first twenty seconds must not wipe the room.
    game.update(20, idle);
    assert.ok(game.state.actors.filter(actor => !actor.isPlayer && actor.alive).length >= 2, `seed ${seed} wiped the room during the opening`);
    while (game.state.phase === 'playing' && game.state.elapsed < 600) {
      game.update(1, idle);
      game.drainEvents();
    }
    assert.equal(game.state.phase, 'won', `seed ${seed} failed to resolve the last bot`);
    assert.ok(game.state.elapsed < 600, `seed ${seed} exceeded the round time limit`);
  }
});
