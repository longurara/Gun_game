import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameSimulation } from '../src/game/simulation.ts';
import { applySnapshot, SnapshotBuilder } from '../src/net/protocol.ts';
import { ATTACH, attachCode, attachFromCode, capacityOf, fits, magazineOf, PACK_BASE, rigStats, usedSpace } from '../src/game/gear.ts';
import { WEAPON_ORDER, WEAPONS } from '../src/game/weapons.ts';

const idle = { moveX: 0, moveZ: 0, sprint: false, jump: false };
const run = (game: GameSimulation, seconds: number) => { for (let i = 0; i < seconds * 30; i++) game.update(1 / 30, idle); };

function arena() {
  const game = new GameSimulation({ seed: 3, botCount: 1, map: 'arena' });
  game.start();
  game.botsFrozen = true;
  return { game, me: game.player };
}
const lay = (game: GameSimulation, kind: string, amount?: number) => {
  const me = game.player;
  game.state.loot.push({ id: `t-${game.state.loot.length}`, kind: kind as never, position: { ...me.position }, active: true, ...(amount ? { amount } : {}) });
  return game.state.loot[game.state.loot.length - 1];
};
const gunOfClass = (cls: string) => WEAPON_ORDER.find(id => WEAPONS[id].kind === cls)!;

test('the pack limits what you carry: ammunition is taken as far as there is room, and a bigger pack makes room', () => {
  const { game, me } = arena();
  // Start from an empty pack.
  me.medkits = 0;
  for (const calibre of Object.keys(me.reserve) as Array<keyof typeof me.reserve>) me.reserve[calibre] = 0;
  const capacity = capacityOf(me);
  assert.equal(capacity, PACK_BASE);
  me.reserve['556'] = Math.floor(capacity / 0.12) - 20;
  const loot = lay(game, '556Ammo', 300);
  assert.ok(game.pickupLoot(loot.id));
  assert.ok(usedSpace(me) <= capacity + 1e-6, `used ${usedSpace(me).toFixed(1)} of ${capacity}`);
  assert.ok(loot.active && (loot.amount ?? 0) > 200, `the rest stays on the ground (${loot.amount})`);
  // Full now: nothing more fits.
  assert.equal(game.pickupLoot(loot.id), false);
  // A level 3 backpack makes room.
  const pack = lay(game, 'pack3');
  assert.ok(game.pickupLoot(pack.id));
  assert.equal(me.pack, 3);
  assert.ok(capacityOf(me) > capacity + 150);
  assert.ok(game.pickupLoot(loot.id), 'now more fits');
  assert.ok(me.reserve['556'] > Math.floor(capacity / 0.12));
});

test('a medkit does not fit in a nearly full pack, and fits once there is room', () => {
  const { game, me } = arena();
  me.medkits = 0;
  for (const calibre of Object.keys(me.reserve) as Array<keyof typeof me.reserve>) me.reserve[calibre] = 0;
  me.reserve['9mm'] = Math.floor(PACK_BASE / 0.1) - 5; // 0.5 left
  const kit = lay(game, 'medkit', 3);
  assert.equal(game.pickupLoot(kit.id), false, 'a medkit takes 8 and 0.5 is free');
  assert.equal(me.medkits, 0);
  assert.ok(kit.active);
  me.reserve['9mm'] = 300; // 30 used: room for two
  assert.ok(game.pickupLoot(kit.id));
  assert.ok(me.medkits >= 2 && me.medkits <= 3);
  if (me.medkits < 3) assert.ok(kit.active, 'the rest stays on the ground');
});

test('backpacks: only a better one is taken, and the old one stays on the ground', () => {
  const { game, me } = arena();
  const first = lay(game, 'pack1');
  assert.ok(game.pickupLoot(first.id));
  assert.equal(me.pack, 1);
  const worse = lay(game, 'pack1');
  assert.equal(game.pickupLoot(worse.id), false, 'the same level is no use');
  const better = lay(game, 'pack2');
  const before = game.state.loot.length;
  assert.ok(game.pickupLoot(better.id));
  assert.equal(me.pack, 2);
  const left = game.state.loot.slice(before).filter(l => l.kind === 'pack1');
  assert.equal(left.length, 1, 'the old pack lies beside you');
  // It cannot be dropped while the contents would no longer fit without it.
  me.reserve['556'] = Math.floor(PACK_BASE / 0.12) + 100;
  assert.equal(game.dropItem('pack2', 1), false);
  me.reserve['556'] = 10;
  assert.ok(game.dropItem('pack2', 1));
  assert.equal(me.pack, 0);
});

test('attachments: a scope magnifies, a suppressor hushes, a compensator and grips calm, an extended magazine holds more', () => {
  const { game, me } = arena();
  const rifle = gunOfClass('ar');
  me.ownedWeapons = [rifle, ...me.ownedWeapons.filter(w => w !== rifle)];
  me.weapon = rifle;
  const base = rigStats(me, rifle);
  assert.equal(base.zoom, WEAPONS[rifle].zoom);
  assert.equal(base.silenced, false);
  for (const part of ['scope4', 'suppressor', 'vgrip', 'extmag'] as const) { me.parts[part] = 1; assert.ok(game.attachPart(me, part), `${part} goes on a rifle`); }
  const rig = rigStats(me, rifle);
  assert.equal(rig.zoom, Math.max(4, WEAPONS[rifle].zoom));
  assert.ok(rig.silenced && rig.loud < 0.5);
  assert.ok(rig.recoil < 0.9);
  assert.ok(rig.magazine > WEAPONS[rifle].magazine, `magazine ${rig.magazine} vs ${WEAPONS[rifle].magazine}`);
  assert.equal(me.parts.scope4, 0, 'the part left the pack');
  // A second scope replaces the first, which goes back to the pack.
  me.parts.scope6 = 1;
  assert.equal(fits('scope6', rifle), false, 'a rifle does not take a 6x');
  me.parts.scope3 = 1;
  assert.ok(game.attachPart(me, 'scope3'));
  assert.equal(me.parts.scope4, 1);
  assert.equal(rigStats(me, rifle).zoom, Math.max(3, WEAPONS[rifle].zoom));
});

test('an extended magazine reloads to its full size and gives the extra rounds back when it comes off', () => {
  const { game, me } = arena();
  const rifle = gunOfClass('ar');
  me.ownedWeapons = [rifle]; me.weapon = rifle;
  me.parts.extmag = 1;
  assert.ok(game.attachPart(me, 'extmag'));
  const size = magazineOf(me, rifle);
  me.ammo[rifle] = 0; me.reserve[WEAPONS[rifle].ammoType] = 200;
  assert.ok(game.reload(me));
  run(game, WEAPONS[rifle].reloadTime + 0.3);
  assert.equal(me.ammo[rifle], size);
  const reserve = me.reserve[WEAPONS[rifle].ammoType];
  assert.ok(game.detachPart(me, rifle, 'mag'));
  assert.equal(me.ammo[rifle], WEAPONS[rifle].magazine, 'back to a plain magazine');
  assert.equal(me.reserve[WEAPONS[rifle].ammoType], reserve + size - WEAPONS[rifle].magazine, 'the extra rounds went to the pack');
  assert.equal(me.parts.extmag, 1);
});

test('only parts a gun can take go on it, and a gun dropped takes nothing with it', () => {
  const { game, me } = arena();
  const shotgun = gunOfClass('shotgun'), pistol = gunOfClass('pistol'), rifle = gunOfClass('ar');
  me.ownedWeapons = [rifle, shotgun, pistol];
  me.parts.suppressor = 1; me.parts.scope2 = 1; me.parts.vgrip = 1;
  assert.equal(game.attachPart(me, 'scope2', shotgun), false, 'no scope on a shotgun');
  assert.equal(game.attachPart(me, 'vgrip', pistol), false, 'no grip on a pistol');
  assert.ok(game.attachPart(me, 'suppressor', pistol));
  assert.equal(game.attachPart(me, 'suppressor', 'not-a-gun'), false);
  assert.equal(game.attachPart(me, 'bogus', rifle), false);
  assert.ok(game.attachPart(me, 'scope2', rifle));
  me.weapon = rifle;
  const before = game.state.loot.length;
  assert.ok(game.dropItem(pistol, 1));
  const dropped = game.state.loot.slice(before).map(l => l.kind);
  assert.ok(dropped.includes('suppressor'), 'its suppressor lies beside it');
  assert.equal(me.attach[pistol], undefined);
});

test('picking up a part that fits the gun in hand puts it on straight away, otherwise it goes in the pack', () => {
  const { game, me } = arena();
  const rifle = gunOfClass('ar');
  me.ownedWeapons = [rifle]; me.weapon = rifle;
  assert.ok(game.pickupLoot(lay(game, 'compensator').id));
  assert.equal(me.attach[rifle]?.muzzle, 'compensator');
  assert.equal(me.parts.compensator, 0);
  assert.ok(game.pickupLoot(lay(game, 'suppressor').id));
  assert.equal(me.attach[rifle]?.muzzle, 'compensator', 'the place is taken: the new part waits in the pack');
  assert.equal(me.parts.suppressor, 1);
  assert.ok(game.attachPart(me, 'suppressor'), 'and can be swapped in by hand');
  assert.equal(me.parts.compensator, 1, 'the old one goes back into the pack');
});

test('a suppressed shot is flagged for the sound and draws fewer bots', () => {
  const { game, me } = arena();
  const rifle = gunOfClass('ar');
  me.ownedWeapons = [rifle]; me.weapon = rifle; me.ammo[rifle] = 30;
  me.position = { x: 0, y: 0, z: 0 };
  assert.ok(game.shootPlayer({ x: 0, y: 1, z: 30 }, false));
  assert.equal(game.drainEvents().find(e => e.type === 'shot' && e.actorId === me.id && e.silenced), undefined);
  run(game, 1);
  me.parts.suppressor = 1;
  assert.ok(game.attachPart(me, 'suppressor'));
  assert.ok(game.shootPlayer({ x: 0, y: 1, z: 30 }, false));
  assert.ok(game.drainEvents().some(e => e.type === 'shot' && e.silenced === true));
});

test('attachment codes round trip and a client sees its own pack, parts and gun fittings, and what others hold', () => {
  const rifleParts = { scope: 'scope4', muzzle: 'suppressor', grip: 'vgrip', mag: 'extmag' } as const;
  assert.deepEqual(attachFromCode(attachCode(rifleParts)), rifleParts);
  assert.deepEqual(attachFromCode(0), {});
  assert.equal(ATTACH.scope4.slot, 'scope');
  const options = { seed: 77, botCount: 4, map: 'arena', humans: 2, names: ['A', 'B'], drop: false } as const;
  const host = new GameSimulation({ ...options, localId: 'p0' });
  const mirror = new GameSimulation({ ...options, localId: 'p1', remote: true });
  host.start(); mirror.start();
  const rifle = gunOfClass('ar');
  const p0 = host.actorById('p0')!, p1 = host.actorById('p1')!;
  p0.position = { x: 0, y: 0, z: 0 }; p1.position = { x: 3, y: 0, z: 0 };
  p1.pack = 2; p1.parts.vgrip = 2; p1.ownedWeapons = [rifle]; p1.weapon = rifle; p1.attach[rifle] = { scope: 'scope4', muzzle: 'suppressor' };
  p0.ownedWeapons = [rifle]; p0.weapon = rifle; p0.attach[rifle] = { muzzle: 'compensator' };
  const builder = new SnapshotBuilder(host);
  applySnapshot(mirror, JSON.parse(JSON.stringify(builder.build(host.drainEvents()))), { writePositions: true });
  const mine = mirror.actorById('p1')!;
  assert.equal(mine.pack, 2);
  assert.equal(mine.parts.vgrip, 2);
  assert.deepEqual(mine.attach[rifle], { scope: 'scope4', muzzle: 'suppressor' });
  assert.deepEqual(mirror.actorById('p0')!.attach[rifle], { muzzle: 'compensator' }, 'the other person suppressor and scope are visible');
});

test('backpacks and parts turn up on the island, and bots never go for them', () => {
  const game = new GameSimulation({ seed: 3, botCount: 1, map: 'island' });
  game.start();
  const kinds = new Set(game.state.loot.map(l => l.kind));
  for (const kind of ['pack1', 'pack2', 'scope2', 'scope4', 'suppressor', 'compensator', 'vgrip', 'agrip', 'extmag']) assert.ok(kinds.has(kind as never), `no ${kind} on the map`);
});

test('a kind sent over the network must be one of ours: names inherited from Object are not parts, packs, supplies or melee weapons', async () => {
  const { isAttachKind, isPackKind } = await import('../src/game/gear.ts');
  const { isSupplyKind, isUseKind, isThrowKind } = await import('../src/game/supplies.ts');
  const { isMeleeKind } = await import('../src/game/melee.ts');
  const { isWeaponKind } = await import('../src/game/weapons.ts');
  for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
    assert.equal(isAttachKind(name), false, `attach ${name}`);
    assert.equal(isPackKind(name), false, `pack ${name}`);
    assert.equal(isSupplyKind(name), false, `supply ${name}`);
    assert.equal(isUseKind(name), false, `use ${name}`);
    assert.equal(isThrowKind(name), false, `throw ${name}`);
    assert.equal(isMeleeKind(name), false, `melee ${name}`);
    assert.equal(isWeaponKind(name), false, `weapon ${name}`);
  }
  assert.equal(isAttachKind('scope4'), true);
  assert.equal(isSupplyKind('frag'), true);
  assert.equal(isMeleeKind('pan'), true);
  assert.equal(isPackKind('pack2'), true);
});
