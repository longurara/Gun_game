import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameSimulation } from '../src/game/simulation.ts';
import type { PlayerInput } from '../src/types.ts';

const idle: PlayerInput = { moveX: 0, moveZ: 0, sprint: false, jump: false };
const kill = (game: GameSimulation, victimId: string, by: string) => (game as unknown as { damage(a: unknown, n: number, s?: string): void }).damage(game.actorById(victimId), 999, by);

function lobby(humans = 3, localId = 'p1', map: 'arena' | 'island' | 'valley' = 'valley') {
  const game = new GameSimulation({ seed: 9, botCount: 6, map, humans, localId, names: ['Hana', 'Minh', 'Lan'].slice(0, humans) });
  game.start();
  return game;
}

test('several humans: ids, names, the local player, and bots numbered from 1 as before', () => {
  const game = lobby();
  assert.deepEqual(game.humans.map(h => h.id), ['p0', 'p1', 'p2']);
  assert.deepEqual(game.humans.map(h => h.name), ['Hana', 'Minh', 'Lan']);
  assert.ok(game.humans.every(h => h.isPlayer));
  assert.equal(game.player.id, 'p1', 'this machine is the second person');
  assert.equal(game.multiplayer, true);
  assert.equal(game.state.actors.length, 9);
  assert.equal(game.state.actors[3].id, 'bot-1');
  assert.equal(game.state.actors[8].id, 'bot-6');
  // Everyone started with their own weapon and ammunition.
  assert.ok(game.humans.every(h => h.ownedWeapons.length === 1 && h.ammo[h.weapon] > 0));
  const single = new GameSimulation({ seed: 9, botCount: 6, map: 'valley' });
  single.start();
  assert.equal(single.multiplayer, false);
  assert.equal(single.player.id, 'player');
  assert.equal(single.state.actors[1].id, 'bot-1');
});

test('each human moves by their own input; the local one is driven by update(), the others by setHumanInput()', () => {
  const game = lobby(3, 'p1', 'arena');
  game.botsFrozen = true;
  const [a, b, c] = game.humans;
  a.position = { x: -60, y: 0, z: -22 }; b.position = { x: 0, y: 0, z: -22 }; c.position = { x: 40, y: 0, z: -22 };
  const start = game.humans.map(h => ({ ...h.position }));
  for (let i = 0; i < 30; i++) {
    game.setHumanInput('p0', { ...idle, moveX: 1 });
    game.setHumanInput('p2', { ...idle, moveZ: 1 });
    game.update(1 / 30, { ...idle, moveX: -1 });
  }
  assert.ok(a.position.x - start[0].x > 4.5, 'p0 walked east');
  assert.ok(start[1].x - b.position.x > 4.5, 'the local p1 walked west');
  assert.ok(c.position.z - start[2].z > 4.5 && Math.abs(c.position.x - start[2].x) < 0.1, 'p2 walked north only');
  // setHumanInput never overrides the local player.
  const before = b.position.x;
  game.setHumanInput('p1', { ...idle, moveX: 1 });
  game.update(1 / 30, idle);
  assert.ok(Math.abs(b.position.x - before) < 1e-6);
});

test('a remote jump tap that arrives between two packets still counts, and jumping needs a press edge', () => {
  const game = lobby(2, 'p0', 'arena');
  game.botsFrozen = true;
  const remote = game.actorById('p1')!;
  remote.position = { x: 0, y: 0, z: 0 };
  game.setHumanInput('p1', idle, true);
  game.update(1 / 30, idle);
  assert.ok(remote.position.y > 0, 'jumped on the edge');
  const held = new GameSimulation({ seed: 9, botCount: 1, map: 'arena', humans: 2, localId: 'p0' });
  held.start(); held.botsFrozen = true;
  held.setHumanInput('p1', { ...idle, jump: true });
  held.update(1 / 30, idle);
  const high = held.actorById('p1')!.position.y;
  assert.ok(high > 0, 'a held jump key also gives the first press');
  for (let i = 0; i < 90; i++) { held.setHumanInput('p1', { ...idle, jump: true }); held.update(1 / 30, idle); }
  assert.ok(held.actorById('p1')!.position.y < 0.01, 'and does not keep bouncing while held');
});

test('actions can be performed for any human: reload, weapon switch, heal, shoot, stance, pickups with a private event', () => {
  const game = lobby(2, 'p0', 'arena');
  game.botsFrozen = true;
  const other = game.actorById('p1')!;
  other.position = { x: 0, y: 0, z: 0 };
  other.ammo[other.weapon] = 5;
  assert.equal(game.reload(other), true);
  assert.ok(other.reloading > 0);
  assert.ok(game.player.reloading === 0, 'the local player is unaffected');
  assert.equal(game.setStance('crouch', other), true);
  assert.equal(other.stance, 'crouch');
  assert.equal(game.player.stance, undefined);
  game.drainEvents();
  // A pickup next to the other human: the event is addressed to them.
  const loot = game.state.loot.find(l => l.active)!;
  other.position = { ...loot.position };
  assert.equal(game.interact(other), true);
  const pickup = game.drainEvents().find(e => e.type === 'pickup') as { for?: string } | undefined;
  assert.equal(pickup?.for, 'p1');
});

test('private messages are addressed to one human; shared announcements are not', () => {
  const game = new GameSimulation({ seed: 9, botCount: 4, map: 'island', humans: 2, localId: 'p0', drop: true });
  game.start();
  const events = game.drainEvents();
  assert.ok(events.some(e => e.type === 'message' && e.for === undefined), 'the plane announcement is for everyone');
  // Put p1 on the ground and have them heal: that message is theirs alone.
  const p1 = game.actorById('p1')!;
  p1.air = null; p1.position.y = game.heightAt(p1.position.x, p1.position.z); p1.health = 20; p1.medkits = 1;
  game.heal(p1);
  assert.ok(game.drainEvents().some(e => e.type === 'message' && e.for === 'p1' && /hồi máu/.test(e.text)));
});

test('the match goes on after one human dies; ranks and kills are recorded; the last one standing wins', () => {
  const game = lobby(3, 'p0', 'arena');
  game.botsFrozen = true;
  const [a, b, c] = game.humans;
  for (const bot of game.state.actors.filter(x => !x.isPlayer)) bot.alive = false;
  kill(game, 'p1', 'p0');
  game.update(1 / 30, idle);
  assert.equal(game.state.phase, 'playing', 'p1 died but p0 and p2 still fight');
  assert.equal(b.rank, 3);
  assert.equal(a.kills, 1);
  // The local player (p0) now dies too: the match continues for p2 until one is left.
  kill(game, 'p0', 'p2');
  game.update(1 / 30, idle);
  assert.equal(game.state.phase, 'lost', 'the match is over for the local player and nobody else is alive but p2');
  assert.equal(game.state.winnerId, 'p2');
  assert.equal(c.kills, 1);
  assert.equal(a.rank, 2);
  assert.equal(game.state.playerRank, 2);
  // A fallen human drops their gear for the others.
  assert.ok(game.state.loot.some(l => l.id.startsWith('drop-p1-')));
});

test('the match is won by the local player when they are the last human and bot standing', () => {
  const game = lobby(2, 'p0', 'arena');
  game.botsFrozen = true;
  for (const bot of game.state.actors.filter(x => !x.isPlayer)) bot.alive = false;
  kill(game, 'p1', 'p0');
  game.update(1 / 30, idle);
  assert.equal(game.state.phase, 'won');
  assert.equal(game.state.winnerId, 'p0');
});

test('the match ends when every human is dead even if bots are left', () => {
  const game = lobby(2, 'p0', 'arena');
  game.botsFrozen = true;
  kill(game, 'p0', 'bot-1');
  game.update(1 / 30, idle);
  assert.equal(game.state.phase, 'playing');
  kill(game, 'p1', 'bot-1');
  game.update(1 / 30, idle);
  assert.equal(game.state.phase, 'lost');
});

test('bots keep their level of detail around the nearest human, and the plane carries every human', () => {
  const game = new GameSimulation({ seed: 9, botCount: 20, map: 'island', humans: 3, localId: 'p0', drop: true });
  game.start();
  assert.ok(game.state.actors.slice(0, 3).every(a => a.air?.mode === 'plane'));
  const plane = game.state.plane!;
  game.setHumanInput('p1', idle, false);
  for (let i = 0; i < 30 * 5; i++) game.update(1 / 30, idle);
  assert.ok(game.humans.every(h => Math.hypot(h.position.x - plane.x, h.position.z - plane.z) < 1e-6), 'everyone rides along');
  // p1 jumps with a remote press; the others stay aboard.
  game.setHumanInput('p1', idle, true);
  game.update(1 / 30, idle);
  assert.equal(game.actorById('p1')!.air?.mode, 'freefall');
  assert.equal(game.actorById('p2')!.air?.mode, 'plane');
  for (let i = 0; i < 30 * 200 && game.actorById('p1')!.air; i++) { game.setHumanInput('p1', idle); game.update(1 / 30, idle); }
  assert.equal(game.actorById('p1')!.air, null, 'p1 landed by themselves');
});
