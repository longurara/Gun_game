import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameSimulation } from '../src/game/simulation.ts';
import { INTERACTION_RANGE } from '../src/game/config.ts';
import { ARMOR_DURABILITY, WEAPONS } from '../src/game/weapons.ts';
import type { Loot, LootKind } from '../src/types.ts';

function setup() {
  const game = new GameSimulation({ seed: 41, botCount: 1 });
  game.start();
  game.botsFrozen = true;
  game.world.obstacles = [];
  game.player.position = { x: 0, y: 0, z: 0 };
  game.state.loot = [];
  game.drainEvents();
  let nextId = 0;
  const add = (kind: LootKind, contents: Partial<Loot> = {}) => {
    const loot: Loot = { id: `item-${nextId++}`, kind, position: { x: 0.5, y: 0, z: 0 }, active: true, ...contents };
    game.state.loot.push(loot);
    return loot;
  };
  return { game, player: game.player, add };
}

test('inventory selects a specific nearby row; E continues to take the nearest item', () => {
  const { game, player, add } = setup();
  const near = add('556Ammo', { position: { x: 0.2, y: 0, z: 0 } });
  const selected = add('medkit', { position: { x: 2, y: 0, z: 0 }, amount: 3 });
  add('medkit', { position: { x: INTERACTION_RANGE + 0.01, y: 0, z: 0 } });
  add('medkit', { position: { x: 0, y: INTERACTION_RANGE + 0.01, z: 0 } });
  add('medkit', { active: false });
  assert.deepEqual(game.nearbyLoot().map(item => item.id), [near.id, selected.id]);
  const medkits = player.medkits;
  assert.equal(game.pickupLoot(selected.id), true);
  assert.equal(player.medkits, medkits + 3);
  assert.equal(near.active, true, 'choosing a row does not collect the nearest row');
  assert.equal(game.pickupLoot(selected.id), false, 'a row can be collected only once');
  assert.equal(game.pickupLoot('missing'), false);
  assert.equal(game.interact(), true);
  assert.equal(near.active, false);
});

test('inventory reach and actions obey phase, life, vehicle and flight guards', () => {
  const { game, player, add } = setup();
  const near = add('medkit');
  const out = add('medkit', { position: { x: 4, y: 0, z: 0 } });
  assert.equal(game.pickupLoot(out.id), false);
  for (const state of ['paused', 'dead', 'vehicle', 'air'] as const) {
    game.state.phase = state === 'paused' ? 'paused' : 'playing';
    player.alive = state !== 'dead';
    player.vehicleId = state === 'vehicle' ? 'car' : null;
    player.air = state === 'air' ? { mode: 'chute', vx: 0, vy: 0, vz: 0, time: 0 } : null;
    assert.deepEqual(game.nearbyLoot(), [], state);
    assert.equal(game.pickupLoot(near.id), false, state);
    assert.equal(game.dropItem('medkit'), false, state);
  }
});

test('manual gun drop and pickup preserve the magazine and reserve through repeated cycles', () => {
  const { game, player } = setup();
  player.ownedWeapons.push('pistol');
  player.ammo.rifle = 7;
  player.ammo.pistol = 4;
  const reserve = player.reserve['556'];
  for (let i = 0; i < 3; i++) {
    assert.equal(game.dropItem('rifle'), true);
    const dropped = game.state.loot.at(-1)!;
    assert.equal(dropped.loadedAmmo, 7);
    assert.equal(player.weapon, 'pistol', 'a remaining gun becomes the held gun');
    assert.equal(player.ammo.rifle, 0);
    assert.equal(player.reserve['556'], reserve);
    assert.equal(game.pickupLoot(dropped.id), true);
    assert.equal(player.ammo.rifle, 7);
    assert.equal(player.reserve['556'], reserve, 're-picking dropped gear adds no fresh ammunition');
    assert.equal(game.pickupLoot(dropped.id), false);
    assert.equal(game.switchWeapon('rifle'), true);
  }
});

test('a duplicate dropped gun adds exactly its remaining rounds to the shared pool', () => {
  const { game, player, add } = setup();
  const reserve = player.reserve['556'];
  const loaded = player.ammo.rifle;
  const partial = add('rifle', { loadedAmmo: 5 });
  const empty = add('rifle', { loadedAmmo: 0 });
  assert.equal(game.pickupLoot(partial.id), true);
  assert.equal(game.pickupLoot(empty.id), true);
  assert.equal(player.reserve['556'], reserve + 5);
  assert.equal(player.ammo.rifle, loaded);
  assert.deepEqual(player.ownedWeapons, ['rifle']);
});

test('slot swaps keep their existing reserve transfer and leave an empty gun that cannot create rounds', () => {
  const { game, player, add } = setup();
  player.ownedWeapons.push('shotgun');
  player.ammo.shotgun = 4;
  player.ammo.rifle = 8;
  const before = player.reserve['556'];
  const dmr = add('dmr');
  assert.equal(game.pickupLoot(dmr.id), true);
  const rifle = game.state.loot.find(item => item.kind === 'rifle' && item.active)!;
  assert.equal(player.reserve['556'], before + 8);
  assert.equal(rifle.loadedAmmo, 0);
  assert.equal(game.pickupLoot(rifle.id), true);
  assert.equal(player.ammo.rifle, 0);
  assert.equal(player.reserve['556'], before + 8);
});

test('last gun, invalid quantities and unavailable items cannot be dropped', () => {
  const { game, player } = setup();
  assert.equal(game.dropItem('rifle'), false);
  player.ownedWeapons.push('pistol');
  for (const amount of [0, -1, 0.5, NaN, Infinity, 1_000_001]) assert.equal(game.dropItem('556Ammo', amount), false);
  assert.equal(game.dropItem('rifle', 2), false);
  assert.equal(game.dropItem('vest1'), false);
  assert.equal(game.dropItem('unknown'), false);
  assert.equal(game.dropItem('sniper'), false);
  player.medkits = 0;
  assert.equal(game.dropItem('medkit'), false);
  player.reserve['12g'] = 0;
  assert.equal(game.dropItem('12gAmmo'), false);
  assert.equal(game.state.loot.length, 0);
});

test('ammo and medkit stacks clamp to availability and return exactly what was dropped', () => {
  const { game, player } = setup();
  player.reserve['556'] = 11;
  player.medkits = 4;
  assert.equal(game.dropItem('556Ammo', 5), true);
  const ammo = game.state.loot.at(-1)!;
  assert.equal(ammo.amount, 5);
  assert.equal(player.reserve['556'], 6);
  assert.equal(game.dropItem('556Ammo', 99), true);
  const remainder = game.state.loot.at(-1)!;
  assert.equal(remainder.amount, 6);
  assert.equal(player.reserve['556'], 0);
  assert.equal(game.pickupLoot(ammo.id), true);
  assert.equal(game.pickupLoot(remainder.id), true);
  assert.equal(player.reserve['556'], 11);
  assert.equal(game.dropItem('medkit', 99), true);
  const kits = game.state.loot.at(-1)!;
  assert.equal(kits.amount, 4);
  assert.equal(player.medkits, 0);
  assert.equal(game.pickupLoot(kits.id), true);
  assert.equal(player.medkits, 4);
});

test('dropping worn armour and upgrading armour preserve its durability without repairing it', () => {
  const { game, player, add } = setup();
  player.vest = 2;
  player.vestHp = 37.25;
  assert.equal(game.dropItem('vest2'), true);
  const vest = game.state.loot.at(-1)!;
  assert.equal(vest.durability, 37.25);
  assert.equal(player.vest, 0);
  assert.equal(player.vestHp, 0);
  assert.equal(game.pickupLoot(vest.id), true);
  assert.equal(player.vestHp, 37.25);
  const better = add('vest3');
  assert.equal(game.pickupLoot(better.id), true);
  assert.equal(player.vestHp, ARMOR_DURABILITY[3]);
  assert.equal(game.state.loot.filter(item => item.active && item.kind === 'vest2').at(-1)!.durability, 37.25);
  const broken = add('helmet3', { durability: 0 });
  assert.equal(game.pickupLoot(broken.id), false);
  assert.equal(game.dropItem('helmet3'), false);
  assert.equal(broken.active, true);
});

test('dropping medical supplies or the current reload resources cancels the pending action', () => {
  const healing = setup();
  healing.player.health = 30;
  healing.player.medkits = 2;
  assert.equal(healing.game.heal(), true);
  assert.equal(healing.game.dropItem('medkit'), true);
  assert.equal(healing.player.healing, 0);
  healing.game.update(4);
  assert.equal(healing.player.health, 30);
  assert.equal(healing.player.medkits, 1);

  const reload = setup();
  reload.player.ammo.rifle = 3;
  assert.equal(reload.game.reload(), true);
  assert.equal(reload.game.dropItem('556Ammo', 5), true);
  assert.equal(reload.player.reloading, 0);
  reload.game.update(WEAPONS.rifle.reloadTime + 0.5);
  assert.equal(reload.player.ammo.rifle, 3);

  reload.player.ownedWeapons.push('pistol');
  reload.player.ammo.pistol = 4;
  assert.equal(reload.game.reload(), true);
  assert.equal(reload.game.dropItem('rifle'), true);
  assert.equal(reload.player.reloading, 0);
  assert.equal(reload.player.weapon, 'pistol');
  reload.game.update(WEAPONS.rifle.reloadTime + 0.5);
  assert.equal(reload.player.ammo.rifle, 0);
});

test('inventory operations target the supplied actor, leaving the local inventory untouched', () => {
  const game = new GameSimulation({ seed: 41, humans: 2, botCount: 0 });
  game.start();
  game.world.obstacles = [];
  const remote = game.humans[1];
  remote.position = { x: 0, y: 0, z: 0 };
  game.player.position = { x: 20, y: 0, z: 0 };
  game.state.loot = [{ id: 'remote-kit', kind: 'medkit', amount: 2, active: true, position: { x: 0, y: 0, z: 0 } }];
  const mine = game.player.medkits, theirs = remote.medkits;
  assert.deepEqual(game.nearbyLoot(), []);
  assert.equal(game.pickupLoot('remote-kit'), false);
  assert.equal(game.pickupLoot('remote-kit', remote), true);
  assert.equal(game.player.medkits, mine);
  assert.equal(remote.medkits, theirs + 2);
  assert.equal(game.dropItem('medkit', 2, remote), true);
  assert.equal(remote.medkits, theirs);
});
