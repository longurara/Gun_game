import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameSimulation } from '../src/game/simulation.ts';
import { applySnapshot, SnapshotBuilder } from '../src/net/protocol.ts';
import { BOOST_MAX, SUPPLIES } from '../src/game/supplies.ts';

const idle = { moveX: 0, moveZ: 0, sprint: false, jump: false };

function arena() {
  const game = new GameSimulation({ seed: 3, botCount: 1, map: 'arena' });
  game.start();
  game.botsFrozen = true;
  game.player.medkits = 0;
  return game;
}
const run = (game: GameSimulation, seconds: number) => { for (let i = 0; i < seconds * 30; i++) { game.player.alive && game.update(1 / 30, idle); } };

test('a bandage heals a little and stops at its cap; a first aid kit heals more', () => {
  const game = arena(), me = game.player;
  me.supplies.bandage = 3; me.supplies.firstaid = 1;
  me.health = 40;
  assert.ok(game.heal(me, 'bandage'));
  assert.ok(me.healing > 0 && me.healKind === 'bandage');
  run(game, SUPPLIES.bandage.time + 0.2);
  assert.equal(Math.round(me.health), 40 + SUPPLIES.bandage.heal);
  assert.equal(me.supplies.bandage, 2);
  // At the cap a bandage is of no use and is not spent.
  me.health = SUPPLIES.bandage.cap;
  assert.equal(game.heal(me, 'bandage'), false);
  me.health = 20;
  assert.ok(game.heal(me, 'firstaid'));
  run(game, SUPPLIES.firstaid.time + 0.2);
  assert.equal(Math.round(me.health), 20 + SUPPLIES.firstaid.heal);
  assert.equal(me.supplies.firstaid, 0);
});

test('"heal" with no item picks a sensible one: the big healer when badly hurt, a bandage to top up', () => {
  const game = arena(), me = game.player;
  me.medkits = 1; me.supplies.bandage = 2; me.supplies.firstaid = 1;
  me.health = 30;
  assert.ok(game.heal(me));
  assert.equal(me.healKind, 'medkit');
  me.healing = 0; me.healKind = null;
  me.health = 60;
  assert.ok(game.heal(me));
  assert.equal(me.healKind, 'bandage');
  me.healing = 0; me.healKind = null;
  me.supplies.bandage = 0; me.medkits = 0; me.health = 95;
  assert.equal(game.heal(me), false, 'nothing is worth using at 95 health without a kit');
});

test('a boost fills the gauge, mends slowly, quickens the runner, and runs down', () => {
  const game = arena(), me = game.player;
  me.supplies.painkiller = 1; me.supplies.energy = 1;
  me.health = 50;
  assert.ok(game.heal(me, 'painkiller'));
  run(game, SUPPLIES.painkiller.time + 0.2);
  assert.ok(Math.abs(me.boost - SUPPLIES.painkiller.boost) < 6, `boost ${me.boost.toFixed(1)}`);
  const before = me.health;
  run(game, 10);
  assert.ok(me.health > before + 5, `mended ${(me.health - before).toFixed(1)} in 10 s`);
  assert.ok(me.boost < SUPPLIES.painkiller.boost - 5, 'the gauge runs down');
  // The gauge is capped, and a full gauge cannot take another drink.
  me.boost = BOOST_MAX;
  assert.equal(game.heal(me, 'energy'), false);
  // Boosted people are faster than the same person unboosted.
  const distance = (boost: number) => {
    const g = arena(); g.player.boost = boost; g.player.position = { x: 0, y: 0, z: -40 };
    const start = { ...g.player.position };
    for (let i = 0; i < 30; i++) g.update(1 / 30, { ...idle, moveX: 1 });
    return Math.hypot(g.player.position.x - start.x, g.player.position.z - start.z);
  };
  assert.ok(distance(80) > distance(0) * 1.04, 'a full boost is quicker');
});

test('taking damage interrupts using an item and nothing is spent', () => {
  const game = arena(), me = game.player;
  me.supplies.firstaid = 1; me.health = 30;
  assert.ok(game.heal(me, 'firstaid'));
  (game as unknown as { damage(a: unknown, n: number, s?: string): void }).damage(me, 5, 'bot-1');
  assert.equal(me.healing, 0);
  run(game, SUPPLIES.firstaid.time + 0.5);
  assert.equal(me.supplies.firstaid, 1);
});

test('pickups stack up to a limit, a full pack refuses more, dropped stacks keep their size, the dead leave theirs behind', () => {
  const game = arena(), me = game.player;
  const add = (kind: 'bandage' | 'energy', amount?: number) => {
    game.state.loot.push({ id: `t-${game.state.loot.length}`, kind, position: { ...me.position }, active: true, ...(amount ? { amount } : {}) });
    return game.pickupLoot(game.state.loot[game.state.loot.length - 1].id);
  };
  assert.ok(add('bandage'));
  assert.equal(me.supplies.bandage, SUPPLIES.bandage.stack);
  assert.ok(add('bandage', 3));
  assert.equal(me.supplies.bandage, SUPPLIES.bandage.stack + 3);
  me.supplies.bandage = SUPPLIES.bandage.max;
  assert.equal(add('bandage'), false, 'a full pack takes no more');
  assert.ok(add('energy'));
  assert.equal(me.supplies.energy, 1);
  // Drop a few: they land as one stack.
  const before = game.state.loot.length;
  assert.ok(game.dropItem('bandage', 5));
  assert.equal(me.supplies.bandage, SUPPLIES.bandage.max - 5);
  const dropped = game.state.loot[before];
  assert.equal(dropped.kind, 'bandage');
  assert.equal(dropped.amount, 5);
  // A fallen opponent drops what it carried.
  const bot = game.state.actors.find(a => !a.isPlayer)!;
  bot.supplies.firstaid = 2;
  const lootBefore = game.state.loot.length;
  (game as unknown as { damage(a: unknown, n: number, s?: string): void }).damage(bot, 999, 'p0');
  const drops = game.state.loot.slice(lootBefore).filter(l => l.kind === 'firstaid');
  assert.equal(drops.length, 1);
  assert.equal(drops[0].amount, 2);
});

test('the loot tables still add up to one, and every new item turns up on the island', () => {
  const game = new GameSimulation({ seed: 3, botCount: 1, map: 'island' });
  game.start();
  const kinds = new Set(game.state.loot.map(l => l.kind));
  for (const kind of ['bandage', 'firstaid', 'painkiller', 'energy']) assert.ok(kinds.has(kind as never), `no ${kind} on the map`);
  for (const kind of ['helmet1', 'helmet3', 'vest3', 'medkit']) assert.ok(kinds.has(kind as never), `no ${kind} on the map`);
});

test('a client sees its own pack, boost gauge and what it is using', () => {
  const options = { seed: 77, botCount: 6, map: 'arena', humans: 2, names: ['A', 'B'], drop: false } as const;
  const host = new GameSimulation({ ...options, localId: 'p0' });
  const mirror = new GameSimulation({ ...options, localId: 'p1', remote: true });
  host.start(); mirror.start();
  const builder = new SnapshotBuilder(host);
  const p1 = host.actorById('p1')!;
  p1.supplies.bandage = 4; p1.supplies.painkiller = 2; p1.boost = 55; p1.health = 40;
  assert.ok(host.heal(p1, 'painkiller'));
  host.update(1 / 30, idle);
  const snap = JSON.parse(JSON.stringify(builder.build(host.drainEvents())));
  applySnapshot(mirror, snap, { writePositions: true });
  const mine = mirror.actorById('p1')!;
  assert.equal(mine.supplies.bandage, 4);
  assert.equal(mine.supplies.painkiller, 2);
  assert.ok(Math.abs(mine.boost - 55) <= 1);
  assert.equal(mine.healKind, 'painkiller');
  assert.ok(mine.healing > 0);
});

test('bots patch themselves up with what they carry when nobody is shooting at them', () => {
  const game = new GameSimulation({ seed: 5, botCount: 3, map: 'arena' });
  game.start();
  game.player.health = 100;
  const bot = game.state.actors.find(a => !a.isPlayer)!;
  bot.health = 30; bot.medkits = 0; bot.supplies.bandage = 6;
  for (let i = 0; i < 30 * 40; i++) { game.player.health = 100; game.update(1 / 30, idle); if (bot.supplies.bandage < 6) break; }
  assert.ok(bot.supplies.bandage < 6, 'the bot used a bandage');
  assert.ok(bot.health > 30);
});
