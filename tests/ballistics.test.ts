import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropAt, holdover, MUZZLE_VELOCITY, pathOffset, ZERO_DISTANCE } from '../src/game/ballistics.ts';
import { GameSimulation } from '../src/game/simulation.ts';
import { WEAPONS } from '../src/game/weapons.ts';

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('the bullet path crosses the line of sight at the zero distance, is slightly above before it and falls below beyond it', () => {
  for (const kind of ['sniper', 'ar', 'pistol'] as const) {
    const v = MUZZLE_VELOCITY[kind], zero = ZERO_DISTANCE[kind];
    near(pathOffset(zero, v, zero), 0, 1e-12);
    assert.ok(pathOffset(zero / 2, v, zero) > 0, `${kind}: above the line of sight before the zero`);
    assert.ok(pathOffset(zero * 2, v, zero) < 0, `${kind}: below it beyond the zero`);
    assert.ok(pathOffset(zero * 2.5, v, zero) < pathOffset(zero * 2, v, zero), `${kind}: and falling faster and faster`);
  }
  assert.equal(pathOffset(0, 900, 100), 0);
  assert.equal(pathOffset(50, 0, 100), 0, 'bad input is a flat shot');
});

test('faster bullets drop less, and the drop at game ranges is noticeable but not absurd', () => {
  assert.ok(dropAt(200, MUZZLE_VELOCITY.sniper) < dropAt(200, MUZZLE_VELOCITY.pistol) / 5);
  const sniper = -pathOffset(WEAPONS.sniper.range, MUZZLE_VELOCITY.sniper, ZERO_DISTANCE.sniper);
  assert.ok(sniper > 0.25 && sniper < 0.8, `a sniper rifle at its maximum range lands ${sniper.toFixed(2)} m low`);
  const amr = -pathOffset(WEAPONS.heavySniper.range, MUZZLE_VELOCITY.amr, ZERO_DISTANCE.amr);
  assert.ok(amr > sniper, 'the heavy rifle at its longer range drops more');
  const rifle = -pathOffset(WEAPONS.rifle.range, MUZZLE_VELOCITY.ar, ZERO_DISTANCE.ar);
  assert.ok(rifle < 0.4, `an assault rifle at its range lands ${rifle.toFixed(2)} m low`);
  near(holdover(180, 920, 100), -pathOffset(180, 920, 100));
});

test('every gun carries its class velocity', () => {
  for (const weapon of Object.values(WEAPONS)) assert.equal(weapon.velocity, MUZZLE_VELOCITY[weapon.kind]);
});

/** A standing bot straight ahead of the player at `distance`, in the given world. */
function setup(map: 'island' | 'arena', distance: number) {
  const game = new GameSimulation({ seed: 5, botCount: 1, map });
  game.start();
  game.botsFrozen = true;
  const flat = (x: number, z: number) => game.heightAt(x, z);
  game.player.position = { x: 0, y: flat(0, 0), z: 0 };
  const origin = { x: 0, y: flat(0, 0) + 1.35, z: 0 };
  const bot = game.state.actors[1];
  bot.position = { x: 0, y: flat(0, distance), z: distance };
  // Remove anything that could block the line.
  game.world.obstacles.length = 0;
  const raycast = (aimY: number, arc: { velocity: number; zero: number } | undefined) => {
    const dx = 0, dy = aimY - origin.y, dz = distance, length = Math.hypot(dx, dy, dz);
    return (game as unknown as { raycast(o: unknown, d: unknown, r: number, id: string, a?: unknown): { actor?: { id: string }; head?: boolean; distance: number; point?: { y: number } } })
      .raycast(origin, { x: dx / length, y: dy / length, z: dz / length }, 400, 'player', arc);
  };
  return { game, bot, origin, raycast };
}

test('a shot at a distant head lands low on the body; holding over brings it back to the head; short shots are unchanged', () => {
  const { game, bot, raycast } = setup('island', 200);
  // Put the bot on level ground at sea-level-agnostic height by aiming relative to the bot's own feet.
  const arc = { velocity: MUZZLE_VELOCITY.amr, zero: ZERO_DISTANCE.amr };
  const headY = bot.position.y + 1.7;
  const flat = raycast(headY, undefined);
  assert.equal(flat.actor?.id, bot.id);
  assert.equal(flat.head, true, 'without drop the aimed head shot is a headshot');
  const dropped = raycast(headY, arc);
  const droppedBy = headY - (dropped.point?.y ?? 0);
  assert.equal(dropped.actor?.id, bot.id, 'the bullet still reaches the body');
  assert.equal(dropped.head, false, 'but it dropped below the head');
  assert.ok(droppedBy > 0.2, `${droppedBy.toFixed(2)} m low at 200 m`);
  const compensated = raycast(headY + holdover(200, arc.velocity, arc.zero), arc);
  assert.equal(compensated.head, true, 'aiming higher by the holdover restores the headshot');
  void game;
  // Under 45 m the shot is straight even with an arc.
  const close = setup('island', 30);
  const closeHit = close.raycast(close.bot.position.y + 1.7, { velocity: MUZZLE_VELOCITY.amr, zero: ZERO_DISTANCE.amr });
  assert.equal(closeHit.head, true);
});

test('a real shot with a sniper rifle at 190 m: aiming at the head hits the body, the small arena is flat, and bots hold over', () => {
  const run = (map: 'island' | 'arena', aimAboveHead: number) => {
    const { game, bot } = setup(map, map === 'island' ? 190 : 95);
    const shooter = game.player;
    shooter.weapon = 'sniper'; shooter.ownedWeapons = ['sniper']; shooter.ammo.sniper = 5;
    game.drainEvents();
    // Aim exactly at the top of the bot's head, from where the shot starts.
    const target = { x: bot.position.x, y: bot.position.y + 1.75 + aimAboveHead, z: bot.position.z };
    game.shootPlayer(target, true);
    const events = game.drainEvents();
    const shot = events.find(e => e.type === 'shot') as { hitId?: string; to: { y: number } } | undefined;
    const damage = events.find(e => e.type === 'damage') as { amount: number } | undefined;
    return { hit: shot?.hitId === bot.id, damage: damage?.amount ?? 0, endY: shot?.to.y ?? 0, headY: bot.position.y + 1.75 };
  };
  // Hitting a standing body at that distance still works either way; the difference is where it lands.
  const island = run('island', 0), arena = run('arena', 0);
  assert.ok(island.hit && arena.hit);
  assert.ok(arena.endY > arena.headY - 0.05, 'in the arena the bullet goes straight to where you aimed');
  assert.ok(island.endY < island.headY - 0.15, `on the island it lands ${(island.headY - island.endY).toFixed(2)} m below the aim point`);
});
