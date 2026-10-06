import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameSimulation } from '../src/game/simulation.ts';
import { alongLine, DROP, glideReach, makePlane } from '../src/game/drop.ts';
import type { PlayerInput } from '../src/types.ts';
import { isWeaponKind } from '../src/game/weapons.ts';

const idle: PlayerInput = { moveX: 0, moveZ: 0, sprint: false, jump: false };
const press: PlayerInput = { ...idle, jump: true };

/** Advance the match in 1/30 s ticks. */
function run(game: GameSimulation, seconds: number, input: PlayerInput = idle): void {
  for (let i = 0; i < seconds * 30; i++) game.update(1 / 30, input);
}

test('a match with a drop starts everyone in the plane, high above the map and away from the ground fight', () => {
  const game = new GameSimulation({ seed: 5, botCount: 30, map: 'island', drop: true });
  game.start();
  const plane = game.state.plane!;
  assert.ok(plane.active && plane.y >= 600, 'a plane crosses the island at altitude');
  assert.ok(Math.abs(plane.from.x) <= 2000 + 1e-6 && Math.abs(plane.from.z) <= 2000 + 1e-6, 'it enters at the map edge');
  assert.ok(plane.length > 3900, 'and crosses the whole island');
  assert.ok(game.state.actors.every(a => a.air?.mode === 'plane' && a.position.y === plane.y));
  assert.ok(game.airborne);
  assert.equal(game.lootInReach, null);
  assert.equal(game.shootPlayer({ x: 0, y: 0, z: 0 }), false, 'no shooting from the door');
  assert.equal(game.useVehicle(), false);
  // The circle does not tick against people still in the air.
  run(game, 5);
  assert.equal(game.player.health, 100);
});

test('without the drop option nothing changes: the player stands on the ground at the start', () => {
  const game = new GameSimulation({ seed: 5, botCount: 10, map: 'island' });
  game.start();
  assert.equal(game.state.plane, null);
  assert.ok(game.state.actors.every(a => !a.air));
  const arena = new GameSimulation({ seed: 5, botCount: 5, map: 'arena', drop: true });
  arena.start();
  assert.equal(arena.state.plane, null, 'the small training arena never has a plane');
});

test('the plane carries the player along its route until they jump, and the zone clock waits for the landing', () => {
  const game = new GameSimulation({ seed: 8, botCount: 3, map: 'island', drop: true });
  game.start();
  const plane = game.state.plane!;
  assert.ok(game.state.zone.timeRemaining > 40 + plane.length / plane.speed, 'first circle is delayed by the flight');
  run(game, 10);
  assert.equal(game.player.air?.mode, 'plane');
  assert.ok(Math.abs(plane.travelled - plane.speed * 10) < plane.speed * 0.1);
  assert.ok(Math.hypot(game.player.position.x - plane.x, game.player.position.z - plane.z) < 1e-6, 'the player rides the plane');
});

test('pressing jump leaves the plane with its momentum, then free fall can be steered and a dive is faster', () => {
  const game = new GameSimulation({ seed: 8, botCount: 3, map: 'island', drop: true });
  game.start();
  run(game, 4);
  const plane = game.state.plane!;
  game.update(1 / 30, press);
  game.update(1 / 30, idle);
  const air = game.player.air!;
  assert.equal(air.mode, 'freefall');
  const heading = Math.hypot(air.vx, air.vz);
  assert.ok(heading > plane.speed * 0.5, `keeps the plane's speed (${heading.toFixed(0)} m/s)`);
  const jumpHeight = game.player.position.y;
  const east: PlayerInput = { ...idle, moveX: 1 };
  run(game, 4, east);
  assert.ok(game.player.air!.vx > 20 && game.player.air!.vx <= DROP.freefall.h + 1e-6, 'steering east sets the glide speed');
  assert.ok(game.player.air!.vy <= -DROP.freefall.v + 1, 'falls at terminal speed');
  const normalFall = jumpHeight - game.player.position.y;

  const other = new GameSimulation({ seed: 8, botCount: 3, map: 'island', drop: true });
  other.start();
  run(other, 4);
  other.update(1 / 30, press);
  run(other, 4, { ...east, sprint: true });
  assert.ok(other.player.air!.vy < game.player.air!.vy - 20, 'a dive falls much faster');
  assert.ok(jumpHeight - other.player.position.y > normalFall, 'and has dropped further in the same time');
});

test('the canopy can be opened by hand after a moment, and opens by itself near the ground', () => {
  const game = new GameSimulation({ seed: 9, botCount: 2, map: 'island', drop: true });
  game.start();
  run(game, 3);
  game.update(1 / 30, press); game.update(1 / 30, idle);
  game.update(1 / 30, press); game.update(1 / 30, idle);
  assert.equal(game.player.air!.mode, 'freefall', 'a double tap in the first second does not waste the altitude');
  run(game, 2);
  game.update(1 / 30, press); game.update(1 / 30, idle);
  assert.equal(game.player.air!.mode, 'chute');
  run(game, 1);
  assert.ok(game.player.air!.vy > -DROP.chute.v - 12, 'the canopy slows the fall');

  // Leave it alone and the canopy still opens at DROP.autoOpen.
  const auto = new GameSimulation({ seed: 9, botCount: 2, map: 'island', drop: true });
  auto.start();
  run(auto, 3);
  auto.update(1 / 30, press);
  let opened = Infinity;
  for (let i = 0; i < 30 * 40 && auto.airborne; i++) {
    auto.update(1 / 30, idle);
    if (auto.player.air?.mode === 'chute' && opened === Infinity) opened = auto.heightAboveGround(auto.player);
  }
  assert.ok(opened <= DROP.autoOpen + 3 && opened > DROP.autoOpen - 8, `opened at ${opened.toFixed(0)} m`);
});

test('landing ends the drop: feet on the ground, no damage from an open canopy, loot in reach again', () => {
  const game = new GameSimulation({ seed: 11, botCount: 2, map: 'island', drop: true });
  game.start();
  run(game, 3);
  game.update(1 / 30, press);
  for (let i = 0; i < 30 * 90 && game.airborne; i++) game.update(1 / 30, { ...idle, moveZ: 0 });
  assert.ok(!game.airborne, 'player landed');
  const ground = game.heightAt(game.player.position.x, game.player.position.z);
  assert.ok(Math.abs(game.player.position.y - ground) < 1e-6);
  assert.equal(game.player.health, 100);
  const events = game.drainEvents();
  assert.ok(events.some(e => e.type === 'drop' && e.stage === 'jump' && e.actorId === 'player'));
  assert.ok(events.some(e => e.type === 'drop' && e.stage === 'chute' && e.actorId === 'player'));
  assert.ok(events.some(e => e.type === 'drop' && e.stage === 'land' && e.actorId === 'player'));
  // After landing the player walks normally.
  const before = { ...game.player.position };
  run(game, 1, { ...idle, moveX: 1 });
  assert.ok(Math.hypot(game.player.position.x - before.x, game.player.position.z - before.z) > 0.5, 'walks after landing');
});

test('a player who never jumps is pushed out when the plane leaves the island', () => {
  const game = new GameSimulation({ seed: 12, botCount: 2, map: 'island', drop: true });
  game.start();
  const plane = game.state.plane!;
  run(game, plane.length / plane.speed + 2);
  assert.equal(plane.active, false);
  assert.equal(game.player.air?.mode === 'plane', false, 'nobody stays aboard');
  assert.ok(game.drainEvents().some(e => e.type === 'message' && /đẩy ra/.test(e.text)));
});

test('you can choose where to land: steering toward a target brings the canopy down near it', () => {
  const game = new GameSimulation({ seed: 14, botCount: 2, map: 'island', drop: true });
  game.start();
  run(game, 2);
  const plane = game.state.plane!;
  const reach = glideReach(plane.y);
  const side = reach * 0.6;
  const dir = { x: Math.sin(plane.yaw), z: Math.cos(plane.yaw) };
  // A point to the side of the route, ahead of where the plane is now.
  const target = { x: plane.x + dir.x * 350 - dir.z * side, z: plane.z + dir.z * 350 + dir.x * side };
  game.update(1 / 30, press);
  let guard = 0;
  while (game.airborne && guard++ < 30 * 120) {
    const p = game.player.position;
    const dx = target.x - p.x, dz = target.z - p.z, d = Math.hypot(dx, dz);
    const throttle = Math.min(1, d / 30);
    game.update(1 / 30, { ...idle, moveX: dx / (d || 1) * throttle, moveZ: dz / (d || 1) * throttle });
  }
  assert.ok(!game.airborne);
  const miss = Math.hypot(game.player.position.x - target.x, game.player.position.z - target.z);
  assert.ok(miss < 80, `landed ${miss.toFixed(0)} m from the chosen spot (glide reach ${reach.toFixed(0)} m)`);
});

test('every bot jumps, lands on dry ground and starts looking for loot; none is shot while in the air', () => {
  const game = new GameSimulation({ seed: 21, botCount: 100, map: 'island', drop: true });
  game.start();
  const plane = game.state.plane!;
  run(game, plane.length / plane.speed + 1);
  assert.ok(game.state.actors.every(a => a.air?.mode !== 'plane'), 'nobody still in the plane');
  let diedAloft = 0;
  for (let i = 0; i < 30 * 120 && game.state.actors.some(a => a.air); i++) {
    game.update(1 / 30, idle);
    diedAloft += game.state.actors.filter(a => !a.alive && a.air).length;
  }
  assert.equal(game.state.actors.filter(a => a.air).length, 0, 'everyone has landed');
  assert.equal(diedAloft, 0, 'nobody dies in the air');
  assert.ok(game.state.actors.filter(a => a.alive).length >= 75, 'the landing does not turn into a massacre');
  for (const actor of game.state.actors.filter(a => a.alive && !a.vehicleId)) {
    const ground = game.heightAt(actor.position.x, actor.position.z);
    assert.ok(Math.abs(actor.position.y - ground) < 1e-6, `${actor.id} floats`);
    assert.ok(Math.abs(actor.position.x) < 2000 && Math.abs(actor.position.z) < 2000);
  }
  // They are spread over the map, not stacked on one spot, and most landed near a town.
  const cells = new Set(game.state.actors.map(a => `${Math.floor(a.position.x / 400)},${Math.floor(a.position.z / 400)}`));
  assert.ok(cells.size >= 6, `landings cover ${cells.size} map cells`);
  const nearTown = game.state.actors.filter(a => game.world.towns.some(t => Math.hypot(a.position.x - t.x, a.position.z - t.z) < t.radius * 1.4)).length;
  assert.ok(nearTown >= 25, `only ${nearTown} bots landed in a town`);
});

test('the flight route is reproducible from the seed and always crosses the map', () => {
  const rand = (seed: number) => { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; };
  for (let seed = 1; seed < 40; seed++) {
    const plane = makePlane(2000, rand(seed));
    const again = makePlane(2000, rand(seed));
    assert.deepEqual(plane, again);
    assert.ok(plane.length > 3900 && plane.length < 5700);
    for (const end of [plane.from, plane.to]) assert.ok(Math.abs(end.x) <= 2000 + 1e-6 && Math.abs(end.z) <= 2000 + 1e-6);
    const centre = alongLine(plane, { x: 0, z: 0 });
    assert.ok(centre.side <= 2000 * 0.25 + 1, 'the route stays near the middle');
  }
});

test('the small valley also has a (shorter) drop, and a splashdown moves the player to the shore', () => {
  const valley = new GameSimulation({ seed: 3, botCount: 20, map: 'valley', drop: true });
  valley.start();
  assert.ok(valley.state.plane!.length < 1500 && valley.state.plane!.y >= 300);
  const island = new GameSimulation({ seed: 3, botCount: 1, map: 'island', drop: true });
  island.start();
  // Put the player over open sea, in free fall just above the water.
  const player = island.player;
  player.air = { mode: 'chute', vx: 0, vy: -6, vz: 0, time: 5 };
  player.position = { x: -1990, y: 3, z: 0 };
  island.state.plane!.active = false;
  for (let i = 0; i < 30 * 20 && island.airborne; i++) island.update(1 / 30, idle);
  assert.ok(!island.airborne);
  const ground = island.heightAt(player.position.x, player.position.z);
  assert.ok(ground > -1, `player stands on ground at height ${ground.toFixed(1)}`);
  assert.ok(island.drainEvents().some(e => e.type === 'message' && /bơi vào bờ/.test(e.text)));
});

test('supply crates: one parachutes into the next safe zone at set circles, lands with top gear and draws bots to it', () => {
  const game = new GameSimulation({ seed: 36, botCount: 40, map: 'island', drop: true });
  game.start();
  const events: string[] = [];
  let lootBefore = game.state.loot.length;
  let crate: NonNullable<typeof game.state.airdrops>[number] | undefined;
  for (let i = 0; i < 30 * 700 && !(crate?.landed); i++) {
    for (const a of game.state.actors) a.health = 100; // the test watches the crates, not who survives the circle
    game.update(1 / 30, idle);
    for (const e of game.drainEvents()) if (e.type === 'airdrop') events.push(e.stage);
    crate = game.state.airdrops?.[0];
  }
  assert.ok(crate, 'a crate was released');
  assert.ok(crate!.landed, 'and it came down');
  assert.deepEqual(events.slice(0, 2), ['incoming', 'landed']);
  const ground = game.heightAt(crate!.x, crate!.z);
  assert.ok(Math.abs(crate!.y - ground) < 1e-6);
  // It fell into the next circle, on standable ground.
  const zone = game.state.zone;
  assert.ok(Math.hypot(crate!.x - zone.center.x, crate!.z - zone.center.z) < zone.radius + 1, 'inside the safe zone');
  const items = game.state.loot.filter(l => crate!.loot.includes(l.id));
  assert.ok(items.length >= 8, `${items.length} items`);
  const kinds = items.map(l => l.kind);
  assert.ok(kinds.includes('helmet3') && kinds.includes('vest3') && kinds.filter(k => k === 'medkit').length === 2);
  assert.ok(items.filter(l => isWeaponKind(l.kind)).length === 2, 'two guns');
  assert.ok(game.state.loot.length > lootBefore - 1);
  // A bot that has decided to go for it walks there: it ends up much closer (or has already picked something up).
  const runtimes = (game as unknown as { runtimes: Map<string, { airdropGoal: { x: number; z: number } | null }> }).runtimes;
  // A bot caught inside a building far from everyone walks in a straight line and can stay stuck against a wall: pick one in the open.
  const indoors = (x: number, z: number) => game.world.obstacles.some(o => (o.kind === 'roof' || o.kind === 'floor') && Math.abs(x - o.x) < o.width / 2 + 2 && Math.abs(z - o.z) < o.depth / 2 + 2);
  const candidates = game.state.actors.filter(a => !a.isPlayer && a.alive && !a.air && !a.vehicleId && !indoors(a.position.x, a.position.z));
  const bot = candidates.reduce((best, a) => Math.hypot(a.position.x - crate!.x, a.position.z - crate!.z) < Math.hypot(best.position.x - crate!.x, best.position.z - crate!.z) ? a : best);
  const start = Math.hypot(bot.position.x - crate!.x, bot.position.z - crate!.z);
  runtimes.get(bot.id)!.airdropGoal = { x: crate!.x, z: crate!.z };
  // The closest it gets counts: once it is there it may wander off after another pickup.
  let end = start;
  for (let i = 0; i < 30 * 40 && items.every(l => l.active); i++) {
    for (const a of game.state.actors) a.health = 100;
    game.update(1 / 30, idle);
    end = Math.min(end, Math.hypot(bot.position.x - crate!.x, bot.position.z - crate!.z));
  }
  assert.ok(items.some(l => !l.active) || end < start * 0.6, `bot went from ${start.toFixed(0)} m to ${end.toFixed(0)} m`);
});

test('without the drop option no supply crates are ever released', () => {
  const game = new GameSimulation({ seed: 33, botCount: 10, map: 'island' });
  game.start();
  for (let i = 0; i < 30 * 400; i++) { game.player.health = 100; game.update(1 / 30, idle); }
  assert.equal(game.state.airdrops?.length ?? 0, 0);
});
