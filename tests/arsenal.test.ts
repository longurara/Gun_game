import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARSENAL, CLASS_BASE } from '../src/game/arsenal.ts';
import { AMMO_ORDER, GUNS_BY_CLASS, isSidearm, WEAPON_ORDER, WEAPONS } from '../src/game/weapons.ts';
import { LOOT_TABLES } from '../src/game/simulation.ts';
import { buildGun, parseLook } from '../src/gun-builder.ts';
import { buildSoldierPart, FABRIC_PARTS } from '../src/soldier-geometry.ts';
import type { PartName } from '../src/soldier-geometry.ts';
import { paintSurface } from '../src/surface-textures.ts';
import type { SurfaceKind } from '../src/surface-textures.ts';

/** Crossbows and launchers follow their own rules (one round, explosions). */
const SPECIAL = new Set<string>(['bow', 'launcher']);
const dps = (id: string) => WEAPONS[id].damage * WEAPONS[id].pellets / WEAPONS[id].fireInterval;

test('the armoury holds more than a hundred distinct guns across every class and calibre', () => {
  assert.ok(ARSENAL.length >= 100, `${ARSENAL.length} guns`);
  assert.equal(new Set(ARSENAL.map(g => g.id)).size, ARSENAL.length, 'ids are unique');
  assert.equal(new Set(ARSENAL.map(g => g.label)).size, ARSENAL.length, 'names are unique');
  for (const cls of Object.keys(CLASS_BASE)) assert.ok(SPECIAL.has(cls) ? GUNS_BY_CLASS[cls as keyof typeof GUNS_BY_CLASS].length >= 2 : GUNS_BY_CLASS[cls as keyof typeof GUNS_BY_CLASS].length >= 4, `class ${cls} is thin`);
  for (const ammo of AMMO_ORDER) assert.ok(ARSENAL.some(g => g.ammo === ammo), `no gun fires ${ammo}`);
  for (const tier of [1, 2, 3] as const) assert.ok(ARSENAL.filter(g => g.tier === tier).length >= 15, `tier ${tier} is thin`);
  assert.equal(WEAPON_ORDER.length, ARSENAL.length);
  assert.equal(WEAPON_ORDER.slice(0, 8).join(), 'rifle,shotgun,smg,pistol,dmr,sniper,heavySniper,lmg', 'the original eight keep their ids');
});

test('every gun has sane, class-appropriate stats and no gun dominates its class', () => {
  for (const id of WEAPON_ORDER) {
    const g = WEAPONS[id], base = CLASS_BASE[g.kind];
    assert.ok(g.damage > 0 && g.pellets >= 1 && g.magazine >= (SPECIAL.has(g.kind) ? 1 : 2) && g.fireInterval >= 0.04 && g.reloadTime > 0.5, `${id} has odd basic stats`);
    assert.ok(g.aimSpread <= g.spread && g.range > g.preferredRange && g.zoom >= 1, `${id} has inconsistent accuracy or range`);
    assert.ok(g.ammoPickup > 0 && (SPECIAL.has(g.kind) || g.loudness > 20) && g.value >= base.value, `${id} has odd support stats`);
    assert.equal(isSidearm(id), g.kind === 'pistol');
    const ratio = dps(id) / (base.damage * base.pellets / base.fireInterval);
    assert.ok(ratio > 0.5 && ratio < 1.75, `${id} damage output is ${ratio.toFixed(2)}× its class`);
  }
  // Rarity pays: the best legendary gun of a class is at least as strong as the average common one.
  for (const [cls, ids] of Object.entries(GUNS_BY_CLASS)) {
    const by = (tier: number) => ids.filter(id => WEAPONS[id].tier === tier).map(dps);
    if (by(3).length && by(1).length) assert.ok(Math.max(...by(3)) >= by(1).reduce((a, b) => a + b, 0) / by(1).length * 0.95, `${cls}: legendary guns should not be worse than common ones`);
  }
  for (const id of GUNS_BY_CLASS.sniper) assert.equal(WEAPONS[id].fireMode, 'bolt');
});

test('every gun can be found: loot tables are normalised and favour rarer guns in richer buildings', () => {
  for (const tier of [1, 2, 3] as const) {
    const total = LOOT_TABLES[tier].reduce((sum, [, w]) => sum + w, 0);
    assert.ok(Math.abs(total - 1) < 1e-6, `tier ${tier} weights sum to ${total}`);
  }
  const reachable = new Set<string>();
  for (const tier of [1, 2, 3] as const) for (const [kind, weight] of LOOT_TABLES[tier]) if (weight > 0) reachable.add(kind);
  const missing = WEAPON_ORDER.filter(id => !reachable.has(id));
  assert.deepEqual(missing, [], 'guns that can never spawn on the island');
  const mean = (tier: 1 | 2 | 3) => { let w = 0, v = 0; for (const [kind, weight] of LOOT_TABLES[tier]) if (WEAPONS[kind]) { w += weight; v += weight * WEAPONS[kind].tier; } return v / w; };
  assert.ok(mean(1) < mean(2) && mean(2) < mean(3), `average gun tier by building: ${mean(1).toFixed(2)}, ${mean(2).toFixed(2)}, ${mean(3).toFixed(2)}`);
});

test('every gun builds a valid, distinct 3D model whose parts and hand positions make sense', () => {
  const signatures = new Map<string, string>();
  for (const entry of ARSENAL) {
    parseLook(entry.cls, entry.look);
    const gun = buildGun(entry.cls, entry.look, entry.tier);
    assert.ok(gun.bag.groups.size >= 2, `${entry.id} has too few finishes`);
    const { min, max } = gun.bag.bounds();
    const length = max[2] - min[2];
    assert.ok(length > 0.38 && length < 2.2, `${entry.id} is ${length.toFixed(2)} m long`);
    assert.ok(max[1] - min[1] > 0.12 && max[1] - min[1] < 0.8 && max[0] - min[0] < 0.5, `${entry.id} has odd proportions`);
    assert.ok(gun.muzzle[2] > max[2] - 0.4 && gun.muzzle[2] <= max[2] + 1e-6, `${entry.id}: muzzle at ${gun.muzzle[2].toFixed(2)} but model ends at ${max[2].toFixed(2)}`);
    assert.ok(gun.grip[2] < gun.muzzle[2] && gun.fore[2] <= gun.muzzle[2] && gun.grip[1] < 0, `${entry.id}: hands are misplaced`);
    let hash = 0;
    for (const [finish, data] of gun.bag.groups) {
      const vertices = data.positions.length / 3;
      assert.equal(data.normals.length, data.positions.length);
      assert.equal(data.colors.length / 4, vertices);
      assert.equal(data.uvs.length / 2, vertices);
      assert.ok(data.indices.length % 3 === 0 && data.indices.every(i => i >= 0 && i < vertices), `${entry.id}/${finish} has bad indices`);
      assert.ok(data.positions.every(Number.isFinite) && data.uvs.every(Number.isFinite), `${entry.id}/${finish} has non-finite data`);
      for (let i = 0; i < data.positions.length; i += 7) hash = (hash * 31 + Math.round(data.positions[i] * 4000)) | 0;
      for (let i = 0; i < data.colors.length; i += 41) hash = (hash * 29 + Math.round(data.colors[i] * 255)) | 0;
      hash = (hash * 17 + vertices) | 0;
    }
    const key = `${hash}`;
    assert.ok(!signatures.has(key), `${entry.id} looks identical to ${signatures.get(key)}`);
    signatures.set(key, entry.id);
    assert.ok(gun.bag.vertexCount() < 6000, `${entry.id} is too heavy (${gun.bag.vertexCount()} vertices)`);
  }
});

test('guns are visually distinguishable: finishes and part combinations vary widely', () => {
  const finishes = new Set<string>();
  const silhouettes = new Set<string>();
  for (const entry of ARSENAL) {
    const look = parseLook(entry.cls, entry.look);
    finishes.add(`${look.metal}/${look.furniture}`);
    silhouettes.add([look.frame, look.stock, look.guard, look.mag, look.optic, look.muzzle, [...look.extras].sort().join('+')].join('|'));
  }
  assert.ok(finishes.size >= 25, `${finishes.size} finish combinations`);
  assert.ok(silhouettes.size >= 100, `${silhouettes.size} part combinations`);
  const counts = (pick: (g: ReturnType<typeof parseLook>) => string) => new Set(ARSENAL.map(g => pick(parseLook(g.cls, g.look)))).size;
  assert.ok(counts(l => l.optic) >= 9 && counts(l => l.muzzle) >= 6 && counts(l => l.stock) >= 7 && counts(l => l.mag) >= 9, 'part variety');
});

test('surface textures are deterministic, in range and tile without a visible seam', () => {
  const kinds: SurfaceKind[] = ['metal', 'poly', 'wood', 'camoW', 'camoD', 'camoU', 'camoS', 'camoMono', 'weave'];
  for (const kind of kinds) {
    const a = paintSurface(kind, 64), b = paintSurface(kind, 64);
    assert.deepEqual(a.albedo, b.albedo, `${kind} is not deterministic`);
    assert.equal(a.albedo.length, 64 * 64 * 4);
    let min = 255, max = 0, edge = 0, inner = 0;
    for (let y = 0; y < 64; y++) {
      for (let k = 0; k < 3; k++) {
        min = Math.min(min, a.albedo[(y * 64) * 4 + k]); max = Math.max(max, a.albedo[(y * 64) * 4 + k]);
        edge += Math.abs(a.albedo[(y * 64) * 4 + k] - a.albedo[(y * 64 + 63) * 4 + k]);
        inner += Math.abs(a.albedo[(y * 64 + 31) * 4 + k] - a.albedo[(y * 64 + 32) * 4 + k]);
      }
    }
    assert.ok(max - min > 8, `${kind} is flat`);
    assert.ok(edge <= inner * 1.6 + 40, `${kind} seam ${edge} vs interior ${inner}`);
    assert.ok(a.normal.every((v, i) => i % 4 === 3 ? v === 255 : true));
  }
});

test('the soldier is built from valid parts that stack to a human height', () => {
  const parts: PartName[] = ['torso0', 'torso1', 'torso2', 'head', 'hair', 'cap', 'beanie', 'helmet', 'vest', 'thigh', 'shin', 'upper', 'fore'];
  let top = 0;
  for (const part of parts) {
    for (const fabric of ['camoMono', 'weave'] as const) {
      const bag = buildSoldierPart(part, fabric);
      assert.ok(bag.vertexCount() > 0, `${part} is empty`);
      for (const data of bag.groups.values()) assert.ok(data.indices.every(i => i < data.positions.length / 3) && data.positions.every(Number.isFinite));
    }
    if (part === 'helmet' || part === 'head') top = Math.max(top, buildSoldierPart(part, 'weave').bounds().max[1]);
  }
  assert.ok(top > 1.7 && top < 1.95, `head top at ${top.toFixed(2)} m`);
  assert.ok(FABRIC_PARTS.includes('torso1'));
});
