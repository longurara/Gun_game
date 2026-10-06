import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameSimulation } from '../src/game/simulation.ts';
import { AMMO_ORDER, AMMO_PICKUP, ammoKindFor, CORE_WEAPONS, emptyAmmo, emptyReserve, WEAPON_ORDER, WEAPONS } from '../src/game/weapons.ts';
import { WEAPONS as LEGACY_WEAPONS } from '../src/game/config.ts';
import type { Actor, PlayerInput, WeaponType } from '../src/types.ts';

const idle: PlayerInput = { moveX: 0, moveZ: 0, sprint: false, jump: false };

function shootingRange(weapon: WeaponType = 'rifle', distance = 8): { game: GameSimulation; target: Actor } {
  const game = new GameSimulation({ seed: 41, botCount: 7, difficulty: 'easy' });
  game.start();
  game.botsFrozen = true;
  game.world.obstacles = [];
  game.world.halfSize = 400;
  game.player.position = { x: 0, y: 0, z: 0 };
  game.player.ownedWeapons = [...WEAPON_ORDER];
  game.player.weapon = weapon;
  game.player.ammo[weapon] = WEAPONS[weapon].magazine;
  const target = game.state.actors[1];
  target.position = { x: 0, y: 0, z: distance };
  target.health = 10000;
  target.yaw = Math.PI;
  target.ammo = emptyAmmo();
  target.reserve = emptyReserve();
  game.state.actors = [game.player, target];
  game.drainEvents();
  return { game, target };
}

test('the legacy weapon export is the central catalogue and all loot stays outside solid obstacles', () => {
  assert.equal(LEGACY_WEAPONS, WEAPONS);
  const game = new GameSimulation();
  game.start({ botCount: 7 });
  assert.equal(Object.keys(game.player.ammo).length, WEAPON_ORDER.length);
  assert.deepEqual(Object.keys(game.player.reserve).sort(), [...AMMO_ORDER].sort());
  assert.ok(new Set(game.state.actors.filter(actor => !actor.isPlayer).map(actor => actor.weapon)).size >= 6);
  for (const weapon of CORE_WEAPONS) {
    assert.ok(game.state.loot.some(loot => loot.kind === weapon && Math.abs(loot.position.x) <= 3 && loot.position.z >= -66 && loot.position.z <= -62), `${weapon} is missing from the spawn cache`);
    assert.ok(game.state.loot.some(loot => loot.kind === ammoKindFor(weapon) && loot.position.z > -60), `${weapon} has no ammo elsewhere on the map`);
  }
  // The armoury lets a player handle every gun, and each calibre has a pile at the spawn.
  for (const weapon of WEAPON_ORDER) assert.ok(game.state.loot.some(loot => loot.kind === weapon), `${weapon} is missing from the arena`);
  for (const ammo of AMMO_ORDER) assert.ok(game.state.loot.some(loot => loot.kind === `${ammo}Ammo`), `no ${ammo} ammunition`);
  for (const actor of game.state.actors) {
    assert.deepEqual(Object.keys(actor.ammo).sort(), [...WEAPON_ORDER].sort());
    assert.deepEqual(Object.keys(actor.reserve).sort(), [...AMMO_ORDER].sort());
  }
  for (const loot of game.state.loot) {
    assert.ok(!game.world.obstacles.some(obstacle => Math.abs(loot.position.x - obstacle.x) < obstacle.width / 2 && Math.abs(loot.position.z - obstacle.z) < obstacle.depth / 2), `${loot.id} is inside an obstacle`);
  }
});

for (const weapon of WEAPON_ORDER) {
  test(`${weapon}: actual weapon and ammo pickups unlock, load and refill the shared calibre pool only`, () => {
    const game = new GameSimulation({ seed: 41 });
    game.start();
    // Keep AI unarmed so this inventory test does not depend on combat timing.
    for (const actor of game.state.actors) if (!actor.isPlayer) { actor.ammo = emptyAmmo(); actor.reserve = emptyReserve(); }
    const gun = game.state.loot.find(loot => loot.kind === weapon)!;
    game.player.position = { ...gun.position };
    assert.equal(game.lootInReach?.id, gun.id);
    const ownedBefore = game.player.ownedWeapons.length;
    assert.equal(game.interact(), true);
    assert.equal(gun.active, false);
    assert.ok(game.player.ownedWeapons.includes(weapon));
    assert.equal(game.player.ownedWeapons.length, ownedBefore + (weapon === 'rifle' ? 0 : 1));
    assert.equal(game.player.ammo[weapon], WEAPONS[weapon].magazine);

    const ammo = game.state.loot.find(loot => loot.kind === ammoKindFor(weapon))!;
    game.player.position = { ...ammo.position };
    const reserves = { ...game.player.reserve };
    const calibre = WEAPONS[weapon].ammoType;
    assert.equal(game.interact(), true);
    assert.equal(game.player.reserve[calibre], reserves[calibre] + AMMO_PICKUP[calibre]);
    for (const other of AMMO_ORDER) if (other !== calibre) assert.equal(game.player.reserve[other], reserves[other]);

    if (weapon !== 'rifle') assert.equal(game.switchWeapon(weapon), true);
    game.update(0.3, idle);
    game.player.ammo[weapon] = 0;
    game.player.reserve[calibre] = 2;
    assert.equal(game.reload(), true);
    assert.equal(game.shootPlayer({ x: 0, y: 1.1, z: 0 }, true), false);
    game.update(WEAPONS[weapon].reloadTime + 0.05, idle);
    const loaded = Math.min(2, WEAPONS[weapon].magazine);
    assert.equal(game.player.ammo[weapon], loaded);
    assert.equal(game.player.reserve[calibre], 2 - loaded);
    assert.equal(game.player.reloading, 0);
    assert.equal(game.reload(), false);
  });

  // A launcher's blast is covered by its own tests (tests/special.test.ts): it has no instant hit.
  if (WEAPONS[weapon].kind !== 'launcher' && WEAPONS[weapon].magazine > 1) test(`${weapon}: aimed shots deal damage in range, stop beyond range, and obey the configured cadence`, () => {
    const { game, target } = shootingRange(weapon, 5);
    const aim = { x: 0, y: 1.1, z: 5 };
    assert.equal(game.shootPlayer(aim, true), true);
    assert.ok(target.health < 10000);
    const health = target.health;
    const ammo = game.player.ammo[weapon];
    assert.equal(game.shootPlayer(aim, true), false);
    game.update(WEAPONS[weapon].fireInterval * 0.8, idle);
    assert.equal(game.shootPlayer(aim, true), false);
    assert.equal(game.player.ammo[weapon], ammo);
    game.update(WEAPONS[weapon].fireInterval * 0.2 + 0.001, idle);
    assert.equal(game.shootPlayer(aim, true), true);
    assert.ok(target.health < health);

    const outside = shootingRange(weapon, WEAPONS[weapon].range + 4);
    assert.equal(outside.game.shootPlayer({ x: 0, y: 1.1, z: outside.target.position.z }, true), true);
    assert.equal(outside.target.health, 10000);
    assert.equal(outside.game.state.hits, 0);
  });
}

for (const weapon of ['sniper', 'heavySniper'] as const) {
  test(`${weapon}: scoped long-range body/head hits and wall obstruction use the 3D ray`, () => {
    const body = shootingRange(weapon, 120);
    body.game.shootPlayer({ x: 0, y: 1.1, z: 120 }, true);
    assert.equal(body.target.health, 10000 - WEAPONS[weapon].damage);
    const head = shootingRange(weapon, 120);
    head.game.shootPlayer({ x: 0, y: 1.65, z: 120 }, true);
    assert.equal(head.target.health, 10000 - WEAPONS[weapon].damage * 1.65);
    const blocked = shootingRange(weapon, 120);
    blocked.game.world.obstacles = [{ id: 'wall', x: 0, z: 60, width: 20, depth: 4, height: 6, kind: 'building' }];
    blocked.game.shootPlayer({ x: 0, y: 1.1, z: 120 }, true);
    assert.equal(blocked.target.health, 10000);
    const shot = blocked.game.drainEvents().find(event => event.type === 'shot');
    assert.ok(shot && shot.type === 'shot');
    assert.ok(Math.abs(shot.to.z - 58) < 0.01);
  });

  test(`${weapon}: aiming materially improves long-range accuracy over hip fire`, () => {
    const hits = (aimed: boolean) => {
      const { game, target } = shootingRange(weapon, 120);
      for (let index = 0; index < 20; index++) {
        target.position = { x: 0, y: 0, z: 120 };
        game.player.ammo[weapon] = 99;
        assert.equal(game.shootPlayer({ x: 0, y: 1.1, z: 120 }, aimed), true);
        game.update(WEAPONS[weapon].fireInterval + 0.001, idle);
      }
      return game.state.hits;
    };
    const aimedHits = hits(true);
    const hipHits = hits(false);
    assert.equal(aimedHits, 20);
    assert.ok(aimedHits > hipHits + 10, `aim=${aimedHits}, hip=${hipHits}`);
  });
}

test('switching through another gun and pausing cannot bypass a heavy sniper bolt cooldown', () => {
  const { game } = shootingRange('heavySniper');
  const aim = { x: 0, y: 1.1, z: 8 };
  assert.equal(game.shootPlayer(aim, true), true);
  assert.equal(game.switchWeapon('rifle'), true);
  game.update(0.26, idle);
  assert.equal(game.shootPlayer(aim, true), true, 'another ready gun can fire after its equip delay');
  assert.equal(game.switchWeapon('heavySniper'), true);
  game.update(0.26, idle);
  const ammo = game.player.ammo.heavySniper;
  assert.equal(game.shootPlayer(aim, true), false);
  game.setPaused(true);
  game.update(5, idle);
  game.setPaused(false);
  assert.equal(game.shootPlayer(aim, true), false);
  assert.equal(game.player.ammo.heavySniper, ammo);
  game.update(WEAPONS.heavySniper.fireInterval - 0.52 + 0.01, idle);
  assert.equal(game.shootPlayer(aim, true), true);
});

test('bot death drops its actual new weapon and matching ammunition that the player can collect', () => {
  const { game, target } = shootingRange();
  game.player.ownedWeapons = ['rifle'];
  target.weapon = 'dmr';
  target.ownedWeapons = ['dmr'];
  target.health = 10;
  const sentinel = { ...target, id: 'sentinel', position: { x: 90, y: 0, z: 90 }, health: 100, ammo: emptyAmmo(), reserve: emptyReserve() };
  game.state.actors.push(sentinel);
  game.shootPlayer({ x: 0, y: 1.1, z: 8 }, true);
  assert.equal(target.alive, false);
  assert.equal(game.state.phase, 'playing');
  const weapon = game.state.loot.find(loot => loot.id === `drop-${target.id}-weapon`)!;
  const ammo = game.state.loot.find(loot => loot.id === `drop-${target.id}-ammo`)!;
  assert.equal(weapon.kind, 'dmr');
  assert.equal(ammo.kind, '762Ammo');
  game.player.position = { ...weapon.position };
  assert.equal(game.interact(), true);
  assert.ok(game.player.ownedWeapons.includes('dmr'));
  assert.equal(game.player.ammo.dmr, WEAPONS.dmr.magazine);
  game.player.position = { ...ammo.position };
  const before = game.player.reserve['762'];
  assert.equal(game.interact(), true);
  assert.equal(game.player.reserve['762'], before + WEAPONS.dmr.ammoPickup);
});

test('restart clears every magazine and calibre pool, ownership and the previous bolt cooldown', () => {
  const { game } = shootingRange('heavySniper');
  game.shootPlayer({ x: 0, y: 1.1, z: 8 }, true);
  game.start({ seed: 41 });
  assert.deepEqual(game.player.ownedWeapons, ['rifle']);
  for (const weapon of WEAPON_ORDER) assert.equal(game.player.ammo[weapon], weapon === 'rifle' ? WEAPONS.rifle.magazine : 0);
  for (const ammo of AMMO_ORDER) assert.equal(game.player.reserve[ammo], ammo === '556' ? 60 : 0);
  const gun = game.state.loot.find(loot => loot.kind === 'heavySniper')!;
  game.player.position = { ...gun.position };
  game.interact();
  game.switchWeapon('heavySniper');
  game.update(0.26, idle);
  assert.equal(game.shootPlayer({ x: 0, y: 1.1, z: 0 }, true), true);
  assert.equal(game.state.shots, 1);
});
