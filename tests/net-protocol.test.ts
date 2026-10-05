import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameSimulation } from '../src/game/simulation.ts';
import { applySnapshot, NEAR_DISTANCE, SnapshotBuilder } from '../src/net/protocol.ts';
import type { PlayerInput } from '../src/types.ts';

const idle: PlayerInput = { moveX: 0, moveZ: 0, sprint: false, jump: false };
const near = (a: number, b: number, eps = 0.011) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

/** A host (authoritative, 3 humans) and a mirror for the second human (remote, same seed). */
function pair(map: 'valley' | 'island' = 'valley', drop = false, bots = 24) {
  const options = { seed: 77, botCount: bots, map, humans: 3, names: ['A', 'B', 'C'], drop } as const;
  const host = new GameSimulation({ ...options, localId: 'p0' });
  const mirror = new GameSimulation({ ...options, localId: 'p1', remote: true });
  host.start(); mirror.start();
  const builder = new SnapshotBuilder(host);
  const events: unknown[] = [];
  /** Run the host for `seconds` and feed the mirror a snapshot every tenth of a second. */
  const run = (seconds: number, drive?: (t: number) => void) => {
    let pending = host.drainEvents();
    for (let i = 0; i < seconds * 30; i++) {
      drive?.(i / 30);
      host.update(1 / 30, idle);
      pending.push(...host.drainEvents());
      if (i % 3 === 2) {
        const snap = JSON.parse(JSON.stringify(builder.build(pending)));
        events.push(...applySnapshot(mirror, snap, { writePositions: true }).events);
        pending = [];
      }
    }
  };
  return { host, mirror, run, events, builder };
}

test('the mirror starts as an identical world: same actors, same loot, same vehicles, same plane route', () => {
  const { host, mirror } = pair('island', true);
  assert.deepEqual(mirror.state.actors.map(a => [a.id, a.name]), host.state.actors.map(a => [a.id, a.name]));
  assert.equal(mirror.state.loot.length, host.state.loot.length);
  assert.deepEqual(mirror.state.loot.slice(0, 50).map(l => [l.id, l.kind, l.position]), host.state.loot.slice(0, 50).map(l => [l.id, l.kind, l.position]));
  assert.deepEqual(mirror.state.vehicles.map(v => v.id), host.state.vehicles.map(v => v.id));
  assert.deepEqual(mirror.state.plane, host.state.plane);
  assert.equal(mirror.localId, 'p1');
  assert.equal(host.localId, 'p0');
});

test('after a few seconds of play the mirror shows the same positions, health, zone and inventory as the host', () => {
  const { host, mirror, run } = pair('valley');
  run(8, t => { host.setHumanInput('p1', { ...idle, moveX: Math.sin(t), moveZ: 1 }); host.setHumanInput('p2', { ...idle, moveZ: -1, sprint: true }); });
  assert.ok(Math.abs(host.humans[1].position.z) > 3, 'the remote human did move on the host');
  for (const actor of host.state.actors) {
    const copy = mirror.state.actors.find(a => a.id === actor.id)!;
    const close = host.humans.some(h => Math.hypot(h.position.x - actor.position.x, h.position.z - actor.position.z) < NEAR_DISTANCE - 20);
    if (!actor.isPlayer && !close) continue;
    // The local player's own position is predicted on the client and reconciled separately.
    if (copy.id !== mirror.localId) { near(copy.position.x, actor.position.x); near(copy.position.z, actor.position.z); near(copy.position.y, actor.position.y); }
    assert.equal(copy.alive, actor.alive, actor.id);
    assert.equal(copy.health, Math.round(actor.health), actor.id);
    assert.equal(copy.weapon, actor.weapon, actor.id);
  }
  assert.equal(mirror.state.zone.stage, host.state.zone.stage);
  near(mirror.state.zone.radius, host.state.zone.radius);
  near(mirror.state.elapsed, host.state.elapsed, 0.2);
  // The local inventory is exact.
  const me = mirror.player, truth = host.actorById('p1')!;
  assert.deepEqual(me.ownedWeapons, truth.ownedWeapons);
  assert.equal(me.ammo[me.weapon], truth.ammo[truth.weapon]);
  assert.equal(me.medkits, truth.medkits);
});

test('items picked up on the host, gear dropped by the dead and crate loot all reach the mirror', () => {
  const { host, mirror, run } = pair('valley');
  run(1);
  const target = host.state.loot.find(l => l.active)!;
  const index = host.state.loot.indexOf(target);
  host.humans[2].position = { ...target.position };
  assert.ok(host.interact(host.humans[2]));
  (host as unknown as { damage(a: unknown, n: number, s?: string): void }).damage(host.actorById('bot-1'), 999, 'p0');
  run(1);
  assert.equal(mirror.state.loot[index].active, false, 'the pickup is mirrored');
  assert.equal(mirror.state.loot.length, host.state.loot.length, 'and so are the new drops');
  assert.ok(mirror.state.loot.some(l => l.id === 'drop-bot-1-weapon'));
  assert.deepEqual(mirror.state.loot.map(l => l.active), host.state.loot.map(l => l.active), 'every flag agrees');
  assert.equal(mirror.state.actors.find(a => a.id === 'bot-1')!.alive, false);
});

test('events: shots near people, kills for the feed, private messages and pickups arrive with their addressee', () => {
  const { host, run, events } = pair('valley');
  run(0.5);
  events.length = 0;
  const p2 = host.humans[2];
  p2.position = { ...host.state.loot.find(l => l.active)!.position };
  host.interact(p2);
  (host as unknown as { damage(a: unknown, n: number, s?: string): void }).damage(host.actorById('bot-2'), 999, 'p1');
  host.heal(host.humans[0]);
  run(0.3);
  const types = (events as Array<{ type: string; for?: string; actorId?: string; killerId?: string }>);
  assert.ok(types.some(e => e.type === 'pickup' && e.for === 'p2'));
  assert.ok(types.some(e => e.type === 'kill' && e.actorId === 'bot-2' && e.killerId === 'p1'));
  assert.ok(types.every(e => e.type !== 'pickup' || e.for), 'no pickup is anonymous');
});

test('far-away actors and vehicles are left out of a snapshot, and a snapshot stays small', () => {
  const { host, builder } = pair('island', false, 100);
  host.humans.forEach(h => { h.position = { x: -1500, y: 0, z: -1500 }; });
  const snap = builder.build([]);
  assert.ok(snap.a.length < 40, `${snap.a.length} actors sent out of ${host.state.actors.length}`);
  assert.ok(snap.a.length >= 3, 'the humans are always included');
  const bytes = JSON.stringify(snap).length;
  assert.ok(bytes < 12000, `${bytes} bytes`);
  // The first snapshot has no loot additions (the mirror built the same list from the seed).
  assert.equal(snap.loot.add.length, 0);
});

test('a snapshot carries the plane, the match result and per-human scoreboard rows', () => {
  const { host, mirror, run } = pair('island', true, 10);
  run(2);
  assert.ok(host.state.plane && mirror.state.plane);
  near(mirror.state.plane!.travelled, host.state.plane!.travelled, 8);
  for (const bot of host.state.actors.filter(a => !a.isPlayer)) bot.alive = false;
  (host as unknown as { damage(a: unknown, n: number, s?: string): void }).damage(host.actorById('p0'), 999, 'p2');
  (host as unknown as { damage(a: unknown, n: number, s?: string): void }).damage(host.actorById('p1'), 999, 'p2');
  run(0.5);
  assert.equal(host.state.phase, 'lost', 'host was eliminated, p2 won');
  assert.equal(mirror.state.phase, 'lost', 'the mirror (p1) lost too');
  assert.equal(mirror.state.winnerId, 'p2');
  assert.equal(mirror.actorById('p2')!.kills, 2);
  assert.equal(mirror.state.playerRank, 2);
});

test('the winner sees a win', () => {
  const options = { seed: 77, botCount: 4, map: 'valley', humans: 2, names: ['A', 'B'] } as const;
  const host = new GameSimulation({ ...options, localId: 'p0' });
  const winner = new GameSimulation({ ...options, localId: 'p1', remote: true });
  host.start(); winner.start();
  const builder = new SnapshotBuilder(host);
  for (const bot of host.state.actors.filter(a => !a.isPlayer)) bot.alive = false;
  (host as unknown as { damage(a: unknown, n: number, s?: string): void }).damage(host.actorById('p0'), 999, 'p1');
  host.update(1 / 30, idle);
  const result = applySnapshot(winner, JSON.parse(JSON.stringify(builder.build(host.drainEvents()))));
  assert.equal(result.over, 'p1');
  assert.equal(winner.state.phase, 'won');
});

test('ammo protection: a snapshot that predates the latest shots does not refill the local magazine', () => {
  const { host, mirror, builder } = pair('valley');
  const me = mirror.player;
  me.ammo[me.weapon] = 10;
  const snap = JSON.parse(JSON.stringify(builder.build([])));
  const before = host.actorById('p1')!.ammo[me.weapon];
  assert.ok(before > 10);
  applySnapshot(mirror, snap, { protectAmmo: true });
  assert.equal(me.ammo[me.weapon], 10, 'the lower local count is kept');
  applySnapshot(mirror, snap);
  assert.equal(me.ammo[me.weapon], before, 'without protection the host value wins');
});

test('flight prediction: a snapshot sent before the host saw the jump does not put the local player back in the plane', () => {
  const { host, mirror, builder } = pair('island', true, 6);
  const me = mirror.player;
  me.air = { mode: 'freefall', vx: 0, vy: -10, vz: 0, time: 0.2 };
  const snap = JSON.parse(JSON.stringify(builder.build([])));
  const stale = applySnapshot(mirror, snap, { keepFlight: true });
  assert.equal(me.air?.mode, 'freefall', 'the local jump stands');
  assert.equal(stale.flightRegress, true);
  // Once the host agrees, nothing is overruled; and landing (no air state) is always accepted.
  host.actorById('p1')!.air = { mode: 'freefall', vx: 0, vy: -10, vz: 0, time: 0.4 };
  const agreed = applySnapshot(mirror, JSON.parse(JSON.stringify(builder.build([]))), { keepFlight: true });
  assert.equal(agreed.flightRegress, undefined);
  host.actorById('p1')!.air = null;
  applySnapshot(mirror, JSON.parse(JSON.stringify(builder.build([]))), { keepFlight: true });
  assert.equal(me.air, null);
  // Without the option the old behaviour applies.
  me.air = { mode: 'chute', vx: 0, vy: -6, vz: 0, time: 3 };
  host.actorById('p1')!.air = { mode: 'plane', vx: 0, vy: 0, vz: 0, time: 0 };
  applySnapshot(mirror, JSON.parse(JSON.stringify(builder.build([]))));
  assert.equal(me.air?.mode, 'plane');
});
