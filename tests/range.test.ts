import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameSimulation } from '../src/game/simulation.ts';
import { createRangeWorld, FIRING_Z, LANE_DISTANCES, LANE_X, RANGE_HALF } from '../src/game/range.ts';
import { WEAPON_ORDER, WEAPONS, isSidearm } from '../src/game/weapons.ts';
import { magazineOf } from '../src/game/gear.ts';

const idle = { moveX: 0, moveZ: 0, sprint: false, jump: false };
const range = (options: { bots?: number; immortal?: boolean } = {}) => {
  const game = new GameSimulation({ seed: 4, botCount: options.bots ?? 0, map: 'range', immortal: options.immortal });
  game.start();
  return game;
};
const run = (game: GameSimulation, seconds: number) => { for (let i = 0; i < seconds * 30; i++) game.update(1 / 30, idle); game.drainEvents(); };

test('the range has five lanes of targets from 15 to 250 m, moving targets, and a yard for bots, all inside the walls', () => {
  const world = createRangeWorld();
  assert.equal(world.id, 'range');
  assert.equal(world.halfSize, RANGE_HALF);
  const layout = world.range!;
  const fixed = layout.dummies.filter(d => !d.sway && !d.motion), moving = layout.dummies.filter(d => d.sway);
  assert.equal(fixed.length, LANE_X.length * LANE_DISTANCES.length);
  assert.equal(moving.length, 6);
  assert.equal(layout.dummies.filter(d => d.motion?.kind === 'run').length, 3, 'runners');
  assert.equal(layout.dummies.filter(d => d.motion?.kind === 'pop').length, 6, 'pop-ups');
  assert.equal(new Set(layout.dummies.map(d => d.id)).size, layout.dummies.length, 'ids are unique');
  for (const d of layout.dummies) {
    assert.equal(Math.round(d.z - FIRING_Z), d.distance, `${d.id} stands ${d.distance} m out`);
    assert.ok(Math.abs(d.x) + (d.sway?.amp ?? 0) < RANGE_HALF - 5 && d.z < RANGE_HALF - 5, `${d.id} is inside the range`);
    assert.ok(!world.obstacles.some(o => Math.abs(d.x - o.x) < o.width / 2 + 0.6 && Math.abs(d.z - o.z) < o.depth / 2 + 0.6), `${d.id} is not inside cover`);
  }
  // From the middle of a lane no target stands in the line of sight to a farther one.
  for (const x of LANE_X) {
    const lane = fixed.filter(d => Math.abs(d.x - x) < 12).sort((a, b) => a.distance - b.distance);
    assert.equal(lane.length, LANE_DISTANCES.length, `lane ${x} has all its targets`);
    for (const far of lane) for (const near of lane) {
      if (near.distance >= far.distance) continue;
      const along = (near.z - (FIRING_Z - 2)) / (far.z - (FIRING_Z - 2));
      const lineX = x + (far.x - x) * along;
      assert.ok(Math.abs(lineX - near.x) > 1, `${near.id} hides ${far.id}`);
    }
  }
  assert.ok(Math.max(...LANE_DISTANCES) >= 250 && Math.min(...LANE_DISTANCES) <= 15);
  assert.ok(layout.botSpawns.every(s => s.x > layout.yard.x0 - 1 && s.x < layout.yard.x1 && s.z > layout.yard.z0 - 1 && s.z < layout.yard.z1));
});

test('a match on the range puts you on the firing line with targets standing and bots in the yard', () => {
  const game = range({ bots: 5 });
  assert.equal(game.world.id, 'range');
  assert.equal(game.state.phase, 'playing');
  assert.equal(game.player.id, 'player');
  assert.deepEqual([game.player.position.x, game.player.position.z], [0, FIRING_Z - 2]);
  const dummies = game.state.actors.filter(a => a.dummy), bots = game.state.actors.filter(a => !a.isPlayer && !a.dummy);
  assert.equal(dummies.length, 55);
  assert.equal(bots.length, 5);
  assert.ok(dummies.every(d => d.alive && d.health === 100 && d.name === 'Bia'));
  assert.ok(bots.every(b => b.position.x > 100), 'bots wait in the yard');
  assert.equal(game.state.vehicles.length, 12, 'the motor pool');
  assert.equal(game.state.plane, null);
});

test('there is no circle and no end: nothing is hurt by distance, and the match never finishes', () => {
  const game = range({ bots: 0 });
  run(game, 600);
  assert.equal(game.state.phase, 'playing');
  assert.equal(game.player.health, 100);
  assert.equal(game.state.zone.radius, 1e6);
  // Killing every target does not end it either.
  for (const d of game.state.actors.filter(a => a.dummy)) (game as unknown as { damage(a: unknown, n: number, s: string): void }).damage(d, 1000, 'player');
  game.drainEvents();
  assert.equal(game.state.phase, 'playing');
});

test('a target takes hits, falls, and stands back up a few seconds later with full health, leaving no loot behind', () => {
  const game = range();
  const target = game.state.actors.find(a => a.id === 'dummy-3-25')!;
  const loot = game.state.loot.length;
  game.player.position = { x: 0, y: 0, z: FIRING_Z - 2 };
  const aim = { x: target.position.x, y: 1.1, z: target.position.z };
  let shots = 0;
  while (target.alive && shots < 30) { assert.ok(game.shootPlayer(aim, true)); shots++; for (let i = 0; i < 12; i++) game.update(1 / 30, idle); }
  assert.ok(!target.alive, `still standing after ${shots} shots`);
  assert.equal(game.state.kills, 1);
  assert.equal(game.state.loot.length, loot, 'a target drops nothing');
  run(game, 1.5);
  assert.ok(!target.alive, 'still down after 1.5 s');
  run(game, 2);
  assert.ok(target.alive && target.health === 100, 'back up');
  assert.deepEqual([target.position.x, target.position.z], [game.world.range!.dummies.find(d => d.id === target.id)!.x, game.world.range!.dummies.find(d => d.id === target.id)!.z]);
});

test('the moving targets slide from side to side', () => {
  const game = range();
  const mover = game.state.actors.find(a => a.id === 'dummy-m11')!;
  const spec = game.world.range!.dummies.find(d => d.id === 'dummy-m11')!;
  const xs: number[] = [];
  for (let i = 0; i < 30 * 12; i++) { game.update(1 / 30, idle); xs.push(mover.position.x); }
  assert.ok(Math.max(...xs) - Math.min(...xs) > spec.sway!.amp * 1.8, 'it travels about twice its amplitude');
  assert.ok(xs.every(x => Math.abs(x - spec.x) <= spec.sway!.amp + 1e-6));
  const still = game.state.actors.find(a => a.id === 'dummy-1-100')!;
  assert.equal(still.position.x, game.world.range!.dummies.find(d => d.id === still.id)!.x);
});

test('bots shoot at you but never at the targets', () => {
  const game = range({ bots: 3 });
  const bots = game.state.actors.filter(a => !a.isPlayer && !a.dummy);
  // Put a bot right behind a target, facing it.
  const target = game.state.actors.find(a => a.id === 'dummy-1-15')!;
  bots[0].position = { x: target.position.x, y: 0, z: target.position.z + 6 };
  bots[0].yaw = Math.PI;
  game.player.position = { x: 160, y: 0, z: -140 };
  run(game, 40);
  const hurt = game.state.actors.filter(a => a.dummy && a.health < 100);
  assert.equal(hurt.length, 0, 'bots left the targets alone');
});

test('a fallen player is back on the line two seconds later, and an immortal one never falls at all', () => {
  const mortal = range({ bots: 4 });
  const sim = mortal as unknown as { damage(a: unknown, n: number, s: string): void };
  mortal.player.position = { x: 150, y: 0, z: 0 };
  sim.damage(mortal.player, 1000, 'bot-1');
  assert.ok(!mortal.player.alive);
  assert.equal(mortal.state.phase, 'playing', 'no game over on the range');
  run(mortal, 2.5);
  assert.ok(mortal.player.alive && mortal.player.health === 100);
  assert.deepEqual([mortal.player.position.x, mortal.player.position.z], [0, FIRING_Z - 2]);

  const god = range({ bots: 4, immortal: true });
  const hit = god as unknown as { damage(a: unknown, n: number, s: string): void };
  hit.damage(god.player, 1000, 'bot-1');
  assert.ok(god.player.alive && god.player.health === 100);
  god.setImmortal(false);
  hit.damage(god.player, 1000, 'bot-1');
  assert.ok(!god.player.alive, 'switching it off makes you mortal again');
  // The switch does nothing outside the range.
  const island = new GameSimulation({ seed: 3, botCount: 5, map: 'island', immortal: true });
  island.start();
  (island as unknown as { damage(a: unknown, n: number, s: string): void }).damage(island.player, 1000, 'bot-1');
  assert.ok(!island.player.alive, 'no immortality in a real match');
});

test('ammunition, parts and supplies never run out, so every gun can be tried to the end of a magazine', () => {
  const game = range();
  const p = game.player;
  for (let n = 0; n < 40; n++) { game.shootPlayer({ x: 0, y: 1, z: 40 }, false); for (let i = 0; i < 12; i++) game.update(1 / 30, idle); }
  assert.ok(p.reserve['556'] >= 400, 'rifle rounds are topped up');
  assert.ok(Object.values(p.parts).every(n => n >= 2) && Object.values(p.supplies).every(n => n >= 3) && p.medkits >= 3 && p.pack === 3);
  p.reserve['556'] = 0;
  game.update(1 / 30, idle);
  assert.ok(p.reserve['556'] >= 400);
});

test('any gun in the game can be taken at once, filling the right slot, with a full magazine', () => {
  const game = range();
  const p = game.player;
  for (const id of WEAPON_ORDER) {
    assert.equal(game.rangeEquip(id), true, id);
    assert.equal(p.weapon, id);
    assert.equal(p.ammo[id], magazineOf(p, id), `${id} has a full magazine`);
    assert.ok(p.reserve[WEAPONS[id].ammoType] >= 400);
    assert.ok(p.ownedWeapons.filter(w => !isSidearm(w)).length <= 2 && p.ownedWeapons.filter(isSidearm).length <= 1, `${id}: too many guns`);
    assert.ok(p.ownedWeapons.includes(id));
  }
  // A second primary joins the first; a third replaces the one in hand; a pistol only ever replaces the sidearm.
  p.ownedWeapons = ['pistol'];
  game.rangeEquip('rifle'); game.rangeEquip('smg');
  assert.deepEqual(p.ownedWeapons.filter(w => !isSidearm(w)).sort(), ['rifle', 'smg']);
  game.rangeEquip('sniper');
  assert.deepEqual(p.ownedWeapons.filter(w => !isSidearm(w)).sort(), ['rifle', 'sniper'], 'the gun in hand (smg) was replaced');
  game.rangeEquip('pistol');
  assert.equal(p.ownedWeapons.filter(isSidearm).length, 1);
  assert.deepEqual(p.ownedWeapons.filter(w => !isSidearm(w)).sort(), ['rifle', 'sniper']);
  assert.equal(game.rangeEquip('no-such-gun'), false);
  assert.equal(game.rangeEquip(42), false);
  assert.equal(game.rangeEquip('constructor'), false);
  // Not on any other map.
  const arena = new GameSimulation({ seed: 3, botCount: 3, map: 'arena' });
  arena.start();
  assert.equal(arena.rangeEquip('m416'), false);
});

test('every gun, ammunition type and attachment is also racked on the ground behind the line', () => {
  const game = range();
  const kinds = new Set(game.state.loot.map(l => l.kind));
  assert.deepEqual(WEAPON_ORDER.filter(id => !kinds.has(id)), [], 'a gun missing from the racks');
  for (const kind of ['556Ammo', 'rocketAmmo', 'scope6', 'suppressor', 'frag', 'bandage', 'vest3', 'pack3', 'machete']) assert.ok(kinds.has(kind as never), `${kind} missing`);
  assert.ok(game.state.loot.every(l => l.position.z < FIRING_Z && Math.abs(l.position.x) < RANGE_HALF && l.position.z > -RANGE_HALF), 'all of it behind the line and inside the walls');
  // And it can be picked up like anything else.
  const m416 = game.state.loot.find(l => l.kind === 'm416')!;
  game.player.position = { x: m416.position.x, y: 0, z: m416.position.z + 0.5 };
  game.update(1 / 30, idle);
  assert.ok(game.interact());
  assert.ok(game.player.ownedWeapons.includes('m416'));
});

test('the immortal choice made when a match starts reaches the simulation', () => {
  const game = new GameSimulation({ map: 'arena' });
  game.start({ map: 'range', botCount: 2, immortal: true });
  assert.equal(game.immortal, true);
  const hit = game as unknown as { damage(a: unknown, n: number, s: string): void };
  hit.damage(game.player, 500, 'bot-1');
  assert.ok(game.player.alive && game.player.health === 100);
  game.start({ map: 'range', botCount: 2, immortal: false });
  assert.equal(game.immortal, false);
});
