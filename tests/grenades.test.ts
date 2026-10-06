import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameSimulation } from '../src/game/simulation.ts';
import { applySnapshot, SnapshotBuilder } from '../src/net/protocol.ts';

const idle = { moveX: 0, moveZ: 0, sprint: false, jump: false };
type Hidden = {
  damage(a: unknown, n: number, s?: string): void;
  canSee(a: unknown, b: unknown): boolean;
  runtimes: Map<string, { targetId: string | null; throwCooldown: number }>;
};

/** An arena with the player and one bot placed on open ground, bots standing still. */
function setup(distance = 12) {
  const game = new GameSimulation({ seed: 3, botCount: 2, map: 'arena' });
  game.start();
  game.botsFrozen = true;
  const me = game.player;
  const bot = game.state.actors.find(a => !a.isPlayer)!;
  // The middle of the arena, away from walls and cover.
  me.position = { x: 0, y: 0, z: 0 };
  bot.position = { x: 0, y: 0, z: distance };
  for (const other of game.state.actors) if (other !== me && other !== bot) other.position = { x: 90, y: 0, z: 90 };
  me.health = 100; bot.health = 100; bot.helmet = 0; bot.vest = 0; me.vest = 0; me.helmet = 0;
  return { game, me, bot, hidden: game as unknown as Hidden };
}
const run = (game: GameSimulation, seconds: number, hold?: () => void) => { for (let i = 0; i < seconds * 30; i++) { hold?.(); game.update(1 / 30, idle); } };

test('a thrown grenade flies in an arc and lands near the aim point, then bursts when its fuse runs out', () => {
  const { game, me } = setup();
  me.supplies.frag = 2; me.throwKind = 'frag';
  assert.ok(game.throwGrenade(me, 'frag', { x: 0, y: 0, z: 20 }));
  assert.equal(me.supplies.frag, 1);
  const shell = game.state.projectiles![0];
  assert.ok(shell.vy > 0, 'it is thrown upwards');
  let top = shell.y;
  for (let i = 0; i < 30; i++) { game.update(1 / 30, idle); top = Math.max(top, shell.y); }
  assert.ok(top > 2, `it rose to ${top.toFixed(1)} m`);
  run(game, 1.4);
  const landed = game.state.projectiles![0];
  assert.ok(landed && Math.abs(landed.z - 20) < 7, `it came to rest ${landed ? landed.z.toFixed(1) : '?'} m out (aimed at 20)`);
  game.drainEvents();
  run(game, 3);
  assert.equal(game.state.projectiles!.length, 0, 'the grenade is gone');
  assert.ok(game.drainEvents().length >= 0);
});

test('a frag grenade hurts most at the centre, less further out, and nothing beyond its radius or behind a wall', () => {
  const { game, me, bot } = setup();
  me.position = { x: 0, y: 0, z: -30 };
  bot.position = { x: 0, y: 0, z: 0 };
  const burst = (x: number, z: number) => {
    game.state.projectiles!.push({ id: 999, kind: 'frag', x, y: 0.4, z, vx: 0, vy: 0, vz: 0, fuse: 0.01, owner: me.id });
    run(game, 0.1);
  };
  burst(0, 1);
  const close = 100 - bot.health;
  assert.ok(close > 90, `${close.toFixed(0)} damage at 1 m`);
  bot.health = 100;
  burst(0, 6.5);
  const far = 100 - bot.health;
  assert.ok(far > 5 && far < close, `${far.toFixed(0)} damage at 6.5 m`);
  bot.health = 100;
  burst(0, 14);
  assert.equal(bot.health, 100, 'nothing beyond the radius');
  // A wall between the blast and the target shields it.
  bot.health = 100;
  game.world.obstacles.push({ id: 'shield', x: 0, z: 3, width: 8, depth: 0.6, height: 4, kind: 'wall' });
  burst(0, 6);
  assert.equal(bot.health, 100, 'cover protects');
  // Armour takes part of the blast.
  game.world.obstacles.pop();
  bot.health = 100; bot.vest = 3; bot.vestHp = 200;
  burst(0, 3);
  assert.ok(100 - bot.health < (115 * Math.pow(1 - 3 / 9, 1.15)) - 1, 'the vest absorbed some of it');
});

test('a grenade bounces off a wall instead of passing through it', () => {
  const { game, me } = setup();
  // A tall wall: the lob rises to about 6 m, so a low one would simply be thrown over.
  game.world.obstacles.push({ id: 'wall', x: 0, z: 10, width: 14, depth: 0.6, height: 14, kind: 'wall' });
  me.supplies.smoke = 1;
  assert.ok(game.throwGrenade(me, 'smoke', { x: 0, y: 1, z: 25 }));
  run(game, 2.5);
  const cloud = game.state.smokes![0];
  assert.ok(cloud, 'the smoke came out');
  assert.ok(cloud.z < 10, `it burst on this side of the wall (z ${cloud.z.toFixed(1)})`);
});

test('smoke hides people from each other for its lifetime, then clears', () => {
  const { game, me, bot, hidden } = setup(24);
  assert.equal(hidden.canSee(bot, me), true, 'in the open they see each other');
  game.state.smokes!.push({ id: 1, x: 0, y: 0, z: 12, radius: 6.5, born: game.state.elapsed - 3, until: game.state.elapsed + 10 });
  assert.equal(hidden.canSee(bot, me), false, 'a cloud between them blocks the view');
  // Bullets are not stopped by it: only sight is.
  run(game, 11);
  assert.equal(game.state.smokes!.length, 0, 'it thins away');
  assert.equal(hidden.canSee(bot, me), true);
});

test('a flash blinds people looking at it far more than people looking away, and a blinded bot loses its target', () => {
  const { game, me, bot, hidden } = setup(16);
  me.yaw = 0; // facing +z, towards the bot and the blast
  bot.yaw = Math.PI; // the bot faces the player: also towards the blast placed between them
  hidden.runtimes.get(bot.id)!.targetId = me.id;
  game.state.projectiles!.push({ id: 5, kind: 'flash', x: 0, y: 1, z: 8, vx: 0, vy: 0, vz: 0, fuse: 0.01, owner: me.id });
  run(game, 0.1);
  assert.ok((me.blind ?? 0) > 2, `the thrower looking at it is blind for ${(me.blind ?? 0).toFixed(1)} s`);
  assert.ok((bot.blind ?? 0) > 2);
  assert.equal(hidden.runtimes.get(bot.id)!.targetId, null, 'the bot dropped its target');
  assert.equal(hidden.canSee(bot, me), false, 'a blind bot sees nothing');
  run(game, 8);
  assert.equal(me.blind, 0, 'sight comes back');
  // The same flash seen from behind is much milder.
  me.yaw = Math.PI;
  game.state.projectiles!.push({ id: 6, kind: 'flash', x: 0, y: 1, z: 8, vx: 0, vy: 0, vz: 0, fuse: 0.01, owner: me.id });
  run(game, 0.1);
  assert.ok((me.blind ?? 0) < 3.2, `looking away: ${(me.blind ?? 0).toFixed(1)} s`);
});

test('a molotov sets the ground alight: whoever stands in it burns, and it dies down', () => {
  const { game, me, bot } = setup(14);
  me.supplies.molotov = 1;
  game.throwGrenade(me, 'molotov', { x: 0, y: 0, z: 14 });
  run(game, 4);
  const fire = game.state.fires![0];
  assert.ok(fire, 'a fire is burning');
  bot.position = { x: fire.x, y: 0, z: fire.z };
  const before = bot.health;
  run(game, 3);
  assert.ok(before - bot.health > 20, `the bot burned for ${(before - bot.health).toFixed(0)}`);
  // Outside the patch nothing happens.
  bot.position = { x: fire.x + 10, y: 0, z: fire.z };
  const safe = bot.health;
  run(game, 2);
  assert.equal(bot.health, safe);
  run(game, 12);
  assert.equal(game.state.fires!.length, 0, 'the fire burns out');
});

test('throwing takes time to recover, needs a grenade, and the selection moves through what is carried', () => {
  const { game, me } = setup();
  assert.equal(game.throwGrenade(me, 'frag', { x: 0, y: 0, z: 10 }), false, 'nothing to throw');
  me.supplies.frag = 1; me.supplies.smoke = 2; me.supplies.flash = 1;
  assert.equal(game.selectedThrow(me), 'frag');
  assert.equal(game.cycleThrow(me), 'smoke');
  assert.equal(game.cycleThrow(me), 'flash');
  assert.equal(game.cycleThrow(me), 'frag');
  assert.equal(game.cycleThrow(me, 'flash'), 'flash', 'a named kind is chosen directly');
  assert.equal(game.cycleThrow(me, 'molotov'), 'frag', 'a kind not carried is skipped');
  assert.ok(game.throwGrenade(me, 'smoke', { x: 0, y: 0, z: 10 }));
  assert.equal(game.throwGrenade(me, 'smoke', { x: 0, y: 0, z: 10 }), false, 'the second throw has to wait');
  run(game, 1);
  assert.ok(game.throwGrenade(me, 'smoke', { x: 0, y: 0, z: 10 }));
  assert.equal(me.supplies.smoke, 0);
  assert.notEqual(game.selectedThrow(me), 'smoke', 'the empty kind is no longer selected');
  assert.equal(game.throwGrenade(me, 'bogus', { x: 0, y: 0, z: 10 }), false);
  assert.equal(game.throwGrenade(me, 'frag', { x: NaN, y: 0, z: 10 }), false);
});

test('a client sees grenades in flight, smoke, fire, its own selection and its blindness', () => {
  const options = { seed: 77, botCount: 4, map: 'arena', humans: 2, names: ['A', 'B'], drop: false } as const;
  const host = new GameSimulation({ ...options, localId: 'p0' });
  const mirror = new GameSimulation({ ...options, localId: 'p1', remote: true });
  host.start(); mirror.start();
  const p0 = host.actorById('p0')!, p1 = host.actorById('p1')!;
  p0.position = { x: 0, y: 0, z: 0 }; p1.position = { x: 3, y: 0, z: 0 };
  p1.supplies.frag = 1; p1.supplies.smoke = 1; p1.throwKind = 'smoke'; p1.blind = 2.5;
  host.state.smokes!.push({ id: 7, x: 4, y: 0, z: 4, radius: 6.5, born: host.state.elapsed - 1, until: host.state.elapsed + 9 });
  host.state.fires!.push({ id: 8, x: -4, y: 0, z: 4, radius: 4.2, until: host.state.elapsed + 5, owner: 'p0', tick: 0 });
  host.state.projectiles!.push({ id: 9, kind: 'frag', x: 2, y: 2, z: 2, vx: 3, vy: 1, vz: 0, fuse: 3, owner: 'p0' });
  const builder = new SnapshotBuilder(host);
  const snap = JSON.parse(JSON.stringify(builder.build(host.drainEvents())));
  applySnapshot(mirror, snap, { writePositions: true });
  assert.equal(mirror.state.projectiles!.length, 1);
  assert.equal(mirror.state.projectiles![0].kind, 'frag');
  assert.equal(mirror.state.smokes!.length, 1);
  assert.equal(mirror.state.fires!.length, 1);
  const mine = mirror.actorById('p1')!;
  assert.equal(mine.throwKind, 'smoke');
  assert.ok(Math.abs((mine.blind ?? 0) - 2.5) < 0.05);
  assert.equal(mine.supplies.frag, 1);
  // The mirror only spends a grenade when it throws: the host makes the real one.
  mirror.start();
});

test('bots with a grenade in the pack sometimes throw it at an enemy they can see at middle range', () => {
  const { game, bot, me } = setup(20);
  game.botsFrozen = false;
  bot.supplies.frag = 3;
  bot.weapon = bot.ownedWeapons[0];
  let thrown = 0;
  for (let i = 0; i < 30 * 60 && thrown === 0; i++) {
    me.health = 100;
    game.update(1 / 30, idle);
    for (const event of game.drainEvents()) if (event.type === 'throw' && event.actorId === bot.id) thrown++;
  }
  assert.ok(thrown > 0, 'the bot threw a grenade');
  assert.ok(bot.supplies.frag < 3);
});
