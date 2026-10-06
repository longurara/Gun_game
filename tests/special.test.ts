import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameSimulation } from '../src/game/simulation.ts';
import { applySnapshot, SnapshotBuilder } from '../src/net/protocol.ts';
import { WEAPONS } from '../src/game/weapons.ts';
import { FISTS, MELEE } from '../src/game/melee.ts';

const idle = { moveX: 0, moveZ: 0, sprint: false, jump: false };
const run = (game: GameSimulation, seconds: number) => { for (let i = 0; i < seconds * 30; i++) game.update(1 / 30, idle); };

function arena(distance = 20) {
  const game = new GameSimulation({ seed: 3, botCount: 2, map: 'arena' });
  game.start();
  game.botsFrozen = true;
  const me = game.player, bot = game.state.actors.find(a => !a.isPlayer)!;
  me.position = { x: 0, y: 0, z: 0 }; me.yaw = 0;
  bot.position = { x: 0, y: 0, z: distance };
  for (const other of game.state.actors) if (other !== me && other !== bot) other.position = { x: 90, y: 0, z: 90 };
  me.health = 100; bot.health = 100; bot.vest = 0; bot.helmet = 0;
  return { game, me, bot };
}
const arm = (game: GameSimulation, id: string) => {
  const me = game.player;
  me.ownedWeapons = [id, 'pistol']; me.weapon = id; me.ammo[id] = WEAPONS[id].magazine;
  me.reserve[WEAPONS[id].ammoType] = 10;
};
const lay = (game: GameSimulation, kind: string) => {
  game.state.loot.push({ id: `t-${game.state.loot.length}`, kind: kind as never, position: { ...game.player.position }, active: true });
  return game.state.loot[game.state.loot.length - 1];
};

test('the special arms exist with their own ammunition', () => {
  for (const id of ['xbow', 'xbowPro', 'm79', 'panzer']) assert.ok(WEAPONS[id], `${id} is in the armoury`);
  assert.equal(WEAPONS.xbow.ammoType, 'bolt');
  assert.equal(WEAPONS.m79.ammoType, '40mm');
  assert.equal(WEAPONS.panzer.ammoType, 'rocket');
  assert.ok(WEAPONS.xbow.loudness < WEAPONS.rifle.loudness / 3, 'a crossbow is quiet');
  assert.ok(WEAPONS.panzer.damage > WEAPONS.m79.damage, 'the rocket hits harder');
});

test('a crossbow bolt flies true and hits hard, almost silently', () => {
  const { game, me, bot } = arm0();
  function arm0() { const s = arena(30); arm(s.game, 'xbow'); return s; }
  assert.ok(game.shootPlayer({ x: 0, y: 1.2, z: 30 }, true));
  const shot = game.drainEvents().find(e => e.type === 'shot');
  assert.ok(shot);
  assert.ok(100 - bot.health >= WEAPONS.xbow.damage * 0.9, `${(100 - bot.health).toFixed(0)} damage`);
  assert.equal(me.ammo.xbow, 0);
});

test('a launcher sends a shell that bursts where it lands, hurting everyone near it, and the rocket hits harder', () => {
  const m = arena(26);
  arm(m.game, 'm79');
  assert.ok(m.game.shootPlayer({ x: 0, y: 1, z: 26 }, true));
  assert.ok(m.game.state.projectiles!.some(p => p.kind === 'shell'), 'a shell is in the air');
  run(m.game, 1.5);
  assert.equal(m.game.state.projectiles!.length, 0, 'it burst');
  const hurtShell = 100 - m.bot.health;
  assert.ok(hurtShell > 25, `the shell took ${hurtShell.toFixed(0)} off a bot standing at the target`);
  assert.ok(m.game.drainEvents().some(e => e.type === 'explosion' && e.radius === 6.5));

  const r = arena(26);
  arm(r.game, 'panzer');
  r.game.shootPlayer({ x: 0, y: 1, z: 26 }, true);
  assert.ok(r.game.state.projectiles!.some(p => p.kind === 'rocket'));
  run(r.game, 1.5);
  assert.ok(100 - r.bot.health > hurtShell, `the rocket took ${(100 - r.bot.health).toFixed(0)}`);
  assert.equal(r.me.ammo.panzer, 0, 'one shot');
});

test('a shell stops at a wall and bursts there', () => {
  const m = arena(26);
  arm(m.game, 'm79');
  m.game.world.obstacles.push({ id: 'wall', x: 0, z: 12, width: 14, depth: 0.6, height: 8, kind: 'wall' });
  m.game.shootPlayer({ x: 0, y: 1, z: 26 }, true);
  run(m.game, 1.5);
  assert.equal(m.bot.health, 100, 'the bot behind the wall is out of range of a blast at the wall');
  const events = m.game.drainEvents().filter(e => e.type === 'explosion');
  assert.ok(events.length > 0);
  assert.ok(events.every(e => e.type !== 'explosion' || e.position.z < 12.5), 'it burst on this side of the wall');
});

test('fists, a pan and a machete: reach, damage and the pause between swings', () => {
  const { game, me, bot } = arena(1.5);
  me.melee = null;
  assert.ok(game.meleeStrike(me));
  assert.equal(Math.round(100 - bot.health), FISTS.damage);
  assert.equal(game.meleeStrike(me), false, 'the swing has to finish');
  run(game, FISTS.interval + 0.1);
  bot.health = 100; me.melee = 'machete';
  bot.position = { x: 0, y: 0, z: 2.2 };
  assert.ok(game.meleeStrike(me));
  assert.equal(Math.round(100 - bot.health), MELEE.machete.damage, 'a machete reaches further and cuts deeper');
  run(game, 1);
  bot.health = 100; bot.position = { x: 0, y: 0, z: 3.5 };
  assert.ok(game.meleeStrike(me));
  assert.equal(bot.health, 100, 'out of reach');
  run(game, 1);
  bot.position = { x: 0, y: 0, z: -1.5 };
  assert.ok(game.meleeStrike(me));
  assert.equal(bot.health, 100, 'behind you is not in front of the swing');
});

test('a wall stops a blow, and vests soak a part of it', () => {
  const { game, me, bot } = arena(1.8);
  me.melee = 'machete';
  game.world.obstacles.push({ id: 'wall', x: 0, z: 0.9, width: 6, depth: 0.2, height: 3, kind: 'wall' });
  assert.ok(game.meleeStrike(me));
  assert.equal(bot.health, 100);
  game.world.obstacles.pop();
  run(game, 1);
  bot.vest = 3; bot.vestHp = 200;
  assert.ok(game.meleeStrike(me));
  assert.ok(100 - bot.health < MELEE.machete.damage, 'the vest took some');
});

test('melee weapons are picked up one at a time, swapped for the carried one, and dropped', () => {
  const { game, me } = arena();
  assert.ok(game.pickupLoot(lay(game, 'pan').id));
  assert.equal(me.melee, 'pan');
  assert.equal(game.pickupLoot(lay(game, 'pan').id), false, 'the same one again is no use');
  const before = game.state.loot.length;
  assert.ok(game.pickupLoot(lay(game, 'crowbar').id));
  assert.equal(me.melee, 'crowbar');
  assert.ok(game.state.loot.slice(before).some(l => l.kind === 'pan'), 'the pan lies beside you');
  assert.ok(game.dropItem('crowbar', 1));
  assert.equal(me.melee, null);
});

test('a client sees shells and rockets in the air and what it carries to fight up close', () => {
  const options = { seed: 77, botCount: 4, map: 'arena', humans: 2, names: ['A', 'B'], drop: false } as const;
  const host = new GameSimulation({ ...options, localId: 'p0' });
  const mirror = new GameSimulation({ ...options, localId: 'p1', remote: true });
  host.start(); mirror.start();
  host.actorById('p0')!.position = { x: 0, y: 0, z: 0 }; host.actorById('p1')!.position = { x: 3, y: 0, z: 0 };
  host.actorById('p1')!.melee = 'sickle';
  host.state.projectiles!.push({ id: 1, kind: 'rocket', x: 2, y: 2, z: 2, vx: 50, vy: 0, vz: 0, fuse: 4, owner: 'p0' });
  host.state.projectiles!.push({ id: 2, kind: 'shell', x: 3, y: 2, z: 2, vx: 40, vy: 5, vz: 0, fuse: 4, owner: 'p0' });
  const snap = JSON.parse(JSON.stringify(new SnapshotBuilder(host).build(host.drainEvents())));
  applySnapshot(mirror, snap, { writePositions: true });
  assert.deepEqual(mirror.state.projectiles!.map(p => p.kind).sort(), ['rocket', 'shell']);
  assert.equal(mirror.actorById('p1')!.melee, 'sickle');
  // On a mirror a swing only starts: the host works out the hit.
  const bot = mirror.state.actors.find(a => !a.isPlayer)!;
  mirror.player.position = { x: 3, y: 0, z: 0 }; bot.position = { x: 3, y: 0, z: 1.2 }; bot.health = 100;
  assert.ok(mirror.meleeStrike(mirror.player));
  assert.equal(bot.health, 100);
});

test('the special arms and close-combat weapons turn up on the island', () => {
  const game = new GameSimulation({ seed: 3, botCount: 1, map: 'island' });
  game.start();
  const kinds = new Set(game.state.loot.map(l => l.kind));
  for (const kind of ['pan', 'machete', 'crowbar', 'sickle']) assert.ok(kinds.has(kind as never), `no ${kind}`);
  assert.ok(['xbow', 'xbowPro', 'm79', 'panzer'].some(kind => kinds.has(kind as never)), 'at least one special arm');
});
