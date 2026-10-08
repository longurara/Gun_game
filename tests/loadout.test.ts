import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameSimulation } from '../src/game/simulation.ts';
import { ARMOR_DURABILITY, isSidearm, lootLabel, slotOrder, WEAPONS } from '../src/game/weapons.ts';
import { chooseWeapon, lootUtility, weakestWeapon } from '../src/game/bot-logic.ts';
import type { Actor, LootKind, PlayerInput, WeaponType } from '../src/types.ts';

const idle: PlayerInput = { moveX: 0, moveZ: 0, sprint: false, jump: false };

/** A quiet two-actor range with frozen bots, and a helper that drops one pickup at the player's feet and takes it. */
function setup() {
  const game = new GameSimulation({ seed: 41, botCount: 5, difficulty: 'easy' });
  game.start();
  game.botsFrozen = true;
  game.world.obstacles = [];
  game.player.position = { x: 0, y: 0, z: 0 };
  const target = game.state.actors[1];
  target.position = { x: 0, y: 0, z: 8 };
  game.state.actors = [game.player, target];
  game.state.loot = [];
  game.drainEvents();
  let counter = 0;
  const take = (kind: LootKind): boolean => {
    game.state.loot.push({ id: `test-${counter++}`, kind, position: { x: 0.5, y: 0, z: 0 }, active: true });
    return game.interact();
  };
  return { game, target, take, player: game.player };
}

test('slot order lists main guns first and the sidearm last, capped at three', () => {
  assert.deepEqual(slotOrder(['pistol', 'rifle', 'dmr']), ['rifle', 'dmr', 'pistol']);
  assert.deepEqual(slotOrder(['rifle', 'smg', 'lmg', 'pistol']), ['rifle', 'smg', 'pistol']);
  assert.deepEqual(slotOrder(['sniper']), ['sniper']);
  assert.ok(isSidearm('pistol') && !isSidearm('rifle'));
});

test('a player can carry two main guns and one sidearm; more guns swap out the one in hand', () => {
  const { game, take, player } = setup();
  assert.deepEqual(player.ownedWeapons, ['rifle']);
  assert.equal(take('shotgun'), true);
  assert.equal(take('pistol'), true);
  assert.deepEqual(slotOrder(player.ownedWeapons), ['rifle', 'shotgun', 'pistol']);
  assert.equal(player.weapon, 'rifle', 'picking up into a free slot keeps the weapon in hand');

  // Both main slots are full: the gun in hand is swapped out and dropped.
  player.ammo.rifle = 12;
  const before = player.reserve['556'];
  assert.equal(take('dmr'), true);
  assert.ok(!player.ownedWeapons.includes('rifle'));
  assert.equal(player.weapon, 'dmr', 'the new gun is equipped when it replaced the held one');
  assert.equal(slotOrder(player.ownedWeapons).filter(w => !isSidearm(w)).length, 2);
  const dropped = game.state.loot.find(l => l.kind === 'rifle' && l.active);
  assert.ok(dropped, 'the swapped-out gun lies on the ground');
  assert.equal(player.ammo.rifle, 0, 'its loaded rounds went back to the pool');
  assert.equal(player.reserve['556'], before + 12);
});

test('swapping while holding the sidearm replaces the older main gun instead of the pistol', () => {
  const { take, player } = setup();
  take('smg'); take('pistol');
  player.weapon = 'pistol';
  assert.equal(take('lmg'), true);
  assert.ok(player.ownedWeapons.includes('pistol'), 'the sidearm is kept');
  assert.equal(slotOrder(player.ownedWeapons).filter(w => !isSidearm(w)).length, 2);
  assert.equal(player.weapon, 'pistol');
});

test('picking up a gun already carried only adds ammunition', () => {
  const { take, player } = setup();
  const reserve = player.reserve['556'];
  assert.equal(take('rifle'), true);
  assert.equal(player.ownedWeapons.length, 1);
  assert.equal(player.reserve['556'], reserve + WEAPONS.rifle.magazine);
});

test('armour only upgrades: a worse or equal piece is refused and the old piece drops when upgraded', () => {
  const { game, take, player } = setup();
  assert.equal(take('vest1'), true);
  assert.equal(player.vest, 1);
  assert.equal(player.vestHp, ARMOR_DURABILITY[1]);
  assert.equal(take('vest1'), false, 'an equal vest adds nothing');
  assert.equal(game.state.loot.at(-1)!.active, true, 'a refused pickup stays on the ground');
  assert.equal(take('vest3'), true);
  assert.equal(player.vest, 3);
  assert.equal(player.vestHp, ARMOR_DURABILITY[3]);
  assert.ok(game.state.loot.some(l => l.kind === 'vest1' && l.active), 'the old vest was dropped');
  assert.equal(take('helmet2'), true);
  assert.equal(player.helmet, 2);
  assert.equal(lootLabel('helmet2'), 'Mũ bảo hiểm cấp 2');
  assert.equal(lootLabel('vest3'), 'Áo giáp cấp 3');
});

test('the vest soaks body hits and the helmet soaks headshots, and both wear out', () => {
  const body = setup();
  body.target.health = 10000;
  body.target.vest = 2; body.target.vestHp = ARMOR_DURABILITY[2];
  body.game.shootPlayer({ x: 0, y: 1.1, z: 8 });
  const lost = 10000 - body.target.health;
  assert.ok(Math.abs(lost - WEAPONS.rifle.damage * 0.6) < 1e-6, `vest tier 2 lets through 60% of ${WEAPONS.rifle.damage}, got ${lost}`);
  assert.ok(body.target.vestHp < ARMOR_DURABILITY[2], 'the vest took wear');

  const head = setup();
  head.target.health = 10000;
  head.target.helmet = 3; head.target.helmetHp = ARMOR_DURABILITY[3];
  head.game.shootPlayer({ x: 0, y: 1.65, z: 8 });
  const headLoss = 10000 - head.target.health;
  assert.ok(Math.abs(headLoss - WEAPONS.rifle.damage * 1.65 * 0.45) < 1e-6, `helmet tier 3 lets through 45%, got ${headLoss}`);

  const bare = setup();
  bare.target.health = 10000;
  bare.target.vest = 1; bare.target.vestHp = 1; // nearly broken
  bare.game.shootPlayer({ x: 0, y: 1.1, z: 8 });
  assert.equal(bare.target.vest, 0, 'a spent vest breaks');
  assert.ok(10000 - bare.target.health > WEAPONS.rifle.damage * 0.9, 'a spent vest barely helps');
  // A helmet does nothing against a body hit, and the vest does nothing against a headshot.
  const mixed = setup();
  mixed.target.health = 10000; mixed.target.helmet = 3; mixed.target.helmetHp = 230;
  mixed.game.shootPlayer({ x: 0, y: 1.1, z: 8 });
  assert.equal(10000 - mixed.target.health, WEAPONS.rifle.damage);
});

test('a fallen bot drops everything it carried: every gun and each armour piece', () => {
  const { game, target } = setup();
  game.state.actors = [game.player, target];
  target.ownedWeapons = ['smg', 'dmr', 'pistol'];
  target.weapon = 'smg';
  target.helmet = 2; target.vest = 3; target.helmetHp = 100; target.vestHp = 100;
  target.reserve['9mm'] = 30;
  target.health = 1;
  game.botsFrozen = true;
  game.shootPlayer({ x: 0, y: 1.1, z: 8 });
  assert.equal(target.alive, false);
  const dropped = game.state.loot.filter(l => l.active).map(l => l.kind);
  for (const kind of ['smg', '9mmAmmo', 'dmr', 'pistol', 'helmet2', 'vest3'] as const) assert.ok(dropped.includes(kind), `${kind} was not dropped`);
});

test('bot gear valuation: free slots are wanted, full slots need a clear upgrade, better armour is wanted', () => {
  const { player } = setup();
  const actor = { ...player, ownedWeapons: ['smg', 'shotgun'] as WeaponType[], helmet: 0, vest: 2, health: 100, medkits: 0 } as Actor;
  assert.ok(lootUtility(actor, 'rifle') >= 2, 'a clearly better gun is worth swapping for');
  assert.equal(lootUtility(actor, 'pistol') > 0, true, 'the sidearm slot is free');
  assert.equal(lootUtility(actor, 'helmet1') > 0, true);
  assert.equal(lootUtility(actor, 'vest1'), 0, 'a lower vest is useless');
  assert.equal(lootUtility(actor, 'vest3') > 0, true);
  const stocked = { ...actor, ownedWeapons: ['rifle', 'dmr'] as WeaponType[] } as Actor;
  assert.equal(lootUtility(stocked, 'shotgun'), 0, 'a worse gun is not worth a swap');
  assert.equal(weakestWeapon(['rifle', 'shotgun']), 'shotgun');
});

test('bots pick the gun that suits the range', () => {
  const { player } = setup();
  const actor = { ...player, ownedWeapons: ['shotgun', 'sniper', 'pistol'] as WeaponType[], weapon: 'pistol' as WeaponType } as Actor;
  actor.ammo.shotgun = 6; actor.ammo.sniper = 5; actor.ammo.pistol = 15;
  assert.equal(chooseWeapon(actor, 8), 'shotgun');
  assert.equal(chooseWeapon(actor, 120), 'sniper');
});

test('an unarmed ground-level ray still hits through an empty loadout: bots with no ammo anywhere keep their gun', () => {
  const { player } = setup();
  const actor = { ...player, ownedWeapons: ['rifle'] as WeaponType[], weapon: 'rifle' as WeaponType } as Actor;
  actor.ammo.rifle = 0; actor.reserve['556'] = 0;
  assert.equal(chooseWeapon(actor, 20), 'rifle');
});

test('bots move after taking a weapon off the ground and loot is consumed from the world', () => {
  const game = new GameSimulation({ seed: 5, botCount: 7, difficulty: 'normal' });
  game.start();
  game.player.position = { x: 999, y: 0, z: 999 };
  game.player.health = 100000;
  const total = game.state.loot.length;
  game.update(60, idle);
  const taken = game.state.loot.filter(l => !l.active).length;
  assert.ok(taken > 0 && taken < total, `bots collected ${taken} of ${total} items`);
  const equipped = game.state.actors.filter(a => !a.isPlayer && a.alive).map(a => slotOrder(a.ownedWeapons).length);
  assert.ok(equipped.every(n => n >= 1 && n <= 3), 'no bot ever carries more than three guns');
});
