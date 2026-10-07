/**
 * What goes over the wire. The host runs the real match and 15-20 times a second sends a snapshot of what changed near the
 * people playing; clients keep a mirror simulation (same seed, so the same island and loot) and apply the snapshots.
 * Everything here is plain data (JSON-friendly arrays, positions rounded to a centimetre) so it can be tested without
 * a network.
 */
import type { Actor, AirMode, DrillState, GameEvent, LootKind, Stance } from '../types';
import type { GameSimulation } from '../game/simulation';
import { BREATH_SECONDS } from '../game/breath';
import { AMMO_ORDER, emptyAmmo, emptyReserve, WEAPON_ORDER } from '../game/weapons';
import { placePlane } from '../game/drop';
import { SUPPLY_ORDER, THROW_ORDER, USE_CODES } from '../game/supplies';
import { ATTACH_ORDER, attachCode, attachFromCode, attachmentsOf } from '../game/gear';
import { MELEE_ORDER } from '../game/melee';

export const PROTOCOL_VERSION = 1;
/**
 * Gameplay cadence over WebRTC. Larger rooms use fewer input/snapshot updates to bound the host's upload and CPU work.
 * These packets do not count towards the Supabase Realtime quota (only discovery/signaling goes there).
 */
export function netRates(players: number): { snapshotHz: number; inputHz: number } {
  if (players <= 4) return { snapshotHz: 20, inputHz: 20 };
  if (players === 5) return { snapshotHz: 15, inputHz: 15 };
  return { snapshotHz: 15, inputHz: 10 };
}
/** Seconds between snapshots when nothing else is known (a lone client measures the real spacing from the host's clock). */
export const SNAPSHOT_INTERVAL = 1 / netRates(2).snapshotHz;
/** Actors, cars and shots farther than this from every human are not sent: nobody could see them. */
export const NEAR_DISTANCE = 420;
/** Largest room. */
export const MAX_PLAYERS = 6;

const r2 = (n: number) => Math.round(n * 100) / 100;
/** What can be flying: the four grenades, a launcher's shell and a rocket. */
const PROJECTILE_KINDS = [...THROW_ORDER, 'shell', 'rocket'] as const;
const AIR_CODES: Array<AirMode | null> = [null, 'plane', 'freefall', 'chute'];
const STANCES: Stance[] = ['stand', 'crouch', 'prone'];
const WEAPON_INDEX = new Map<string, number>(WEAPON_ORDER.map((id, index) => [id, index]));
const AMMO_INDEX = new Map<string, number>(AMMO_ORDER.map((id, index) => [id, index]));

/** [index, x, y, z, yaw, health, flags, weapon, car+1, gear] — flags: 1 alive, 2 reloading, 4 healing, bits 3-4 air mode, bits 5-6 stance, 128 reconnect protection, 256 hidden. */
export type ActorRow = [number, number, number, number, number, number, number, number, number, number, number?];
/** [index, x, y, z, yaw, speed, health, driver+1] */
export type VehicleRow = [number, number, number, number, number, number, number, number];
/** A pickup: [index, id, kind, x, y, z, optional stack size, loaded rounds, durability]. */
export type LootRow = [number, string, string, number, number, number, (number | null)?, (number | null)?, (number | null)?];

/** Everything about one human that only they need to see precisely: their inventory and flight state. */
export interface PrivateRow {
  id: string; weapon: number; owned: number[]; ammo: Array<[number, number]>; reserve: Array<[number, number]>;
  medkits: number; helmet: [number, number]; vest: [number, number]; reload: number; heal: number;
  /** Counts of each pack item in SUPPLY_ORDER, the boost gauge, and what is being used (index into USE_CODES). */
  sup?: number[]; boost?: number; hk?: number;
  /** Which grenade is selected (1 + index in THROW_ORDER, 0 none) and seconds left of flash blindness. */
  tk?: number; bl?: number;
  /** Backpack level, spare attachments (counts in ATTACH_ORDER) and what each owned gun carries [weapon, code]. */
  pk?: number; ps?: number[]; att?: Array<[number, number]>;
  /** The close-combat weapon (1 + index in MELEE_ORDER, 0 none). */
  ml?: number;
  /** Held breath as a percentage, and flags: 1 holding, 2 winded. */
  br?: number; hb?: number;
  /** Free-fall / canopy velocity and time, and the jump velocity: what a client needs to predict its own movement. */
  air?: [number, number, number, number]; vy: number; speed: number;
  /** Range-only: individual immortality, authoritative shot/hit counts and drill. */
  rp?: [number, number, number, DrillState | null];
}

export interface Snapshot {
  /** Complete world pickup state for an authoritative reconnect. */
  rs?: 1;
  v: number; seq: number; t: number;
  /** center x, z, radius, next center x, z, radius, stage, seconds left, shrinking. */
  zone: [number, number, number, number, number, number, number, number, number];
  plane?: [number, number];
  /** [follower actor index, leader actor index]; an empty list also confirms a detach. */
  fo?: Array<[number, number]>;
  a: ActorRow[]; c: VehicleRow[];
  loot: { add: LootRow[]; off: number[]; all?: number[] };
  drops: Array<[string, number, number, number, number, number]>;
  /** Grenades in flight [id, kind, x, y, z, vx, vy, vz], smoke clouds [id, x, y, z, age, remaining] and fires [id, x, y, z, remaining]. */
  pr?: Array<[number, number, number, number, number, number, number, number]>;
  sm?: Array<[number, number, number, number, number, number]>;
  fi?: Array<[number, number, number, number, number]>;
  priv: PrivateRow[];
  /** Per human: [index, kills, rank (0 while alive)] for the scoreboard. */
  humans: Array<[number, number, number]>;
  ev: GameEvent[];
  /** Set once the match is over: the winner's actor id, or '' when nobody won. */
  over?: string;
}

const horizontal = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

/** Host side: turns the live simulation into snapshots, remembering what each client has already been told about loot. */
export class SnapshotBuilder {
  private seq = 0;
  private lootSent: number;
  private initialLootCount: number;
  private lootActive: boolean[];

  constructor(private readonly sim: GameSimulation) {
    this.lootSent = sim.state.loot.length;
    this.initialLootCount = this.lootSent;
    this.lootActive = sim.state.loot.map(loot => loot.active);
  }

  build(events: readonly GameEvent[], resync = false): Snapshot {
    const sim = this.sim, state = sim.state;
    const humans = sim.humans;
    const near = (p: { x: number; z: number }) => humans.some(human => horizontal(p, human.position) < NEAR_DISTANCE);
    const a: ActorRow[] = [];
    state.actors.forEach((actor, index) => { if (actor.isPlayer || near(actor.position)) a.push(actorRow(sim, actor, index)); });
    const c: VehicleRow[] = [];
    state.vehicles.forEach((v, index) => {
      if (!near(v.position)) return;
      const driver = v.driverId ? state.actors.findIndex(actor => actor.id === v.driverId) : -1;
      c.push([index, r2(v.position.x), r2(v.position.y), r2(v.position.z), r2(v.yaw), r2(v.speed), Math.round(v.health), driver + 1]);
    });
    const add: LootRow[] = [];
    // Re-send dynamic pickups with the periodic resync, so a missed snapshot cannot permanently lose a drop.
    const firstLoot = resync ? 0 : (this.seq + 1) % 50 === 0 ? this.initialLootCount : this.lootSent;
    for (let i = firstLoot; i < state.loot.length; i++) {
      const loot = state.loot[i];
      const row: LootRow = [i, loot.id, loot.kind, r2(loot.position.x), r2(loot.position.y), r2(loot.position.z)];
      if (loot.amount !== undefined || loot.loadedAmmo !== undefined || loot.durability !== undefined) row.push(loot.amount ?? null, loot.loadedAmmo ?? null, loot.durability ?? null);
      add.push(row);
      // New pickups start active on mirrors; include an off entry when they were already taken this interval.
      this.lootActive[i] = true;
    }
    this.lootSent = state.loot.length;
    const off: number[] = [];
    for (let i = 0; i < this.lootActive.length; i++) {
      if (this.lootActive[i] && !state.loot[i].active) { off.push(i); this.lootActive[i] = false; }
    }
    const seq = ++this.seq;
    const nearPoint = (p: { x: number; z: number }) => near(p);
    const snapshot: Snapshot = {
      v: PROTOCOL_VERSION, seq, t: r2(state.elapsed),
      zone: [r2(state.zone.center.x), r2(state.zone.center.z), r2(state.zone.radius), r2(state.zone.nextCenter.x), r2(state.zone.nextCenter.z), r2(state.zone.nextRadius), state.zone.stage, r2(state.zone.timeRemaining), state.zone.isShrinking ? 1 : 0],
      a, c, loot: { add, off },
      drops: (state.airdrops ?? []).map(drop => [drop.id, r2(drop.x), r2(drop.y), r2(drop.z), drop.landed ? 1 : 0, drop.empty ? 1 : 0]),
      priv: humans.map(human => privateRow(sim, human)),
      humans: humans.map(human => [state.actors.indexOf(human), human.kills ?? 0, human.alive ? 0 : human.rank ?? 0]),
      fo: humans.filter(human => human.alive && human.air && human.dropFollowing).map(human => [state.actors.indexOf(human), state.actors.findIndex(actor => actor.id === human.dropFollowing)]),
      ev: events.filter(event => keepEvent(sim, event, near)),
    };
    if (resync) snapshot.rs = 1;
    const flying = (state.projectiles ?? []).filter(p => nearPoint(p));
    if (flying.length) snapshot.pr = flying.map(p => [p.id, PROJECTILE_KINDS.indexOf(p.kind), r2(p.x), r2(p.y), r2(p.z), r2(p.vx), r2(p.vy), r2(p.vz)]);
    const clouds = (state.smokes ?? []).filter(s => nearPoint(s));
    if (clouds.length) snapshot.sm = clouds.map(s => [s.id, r2(s.x), r2(s.y), r2(s.z), r2(state.elapsed - s.born), r2(s.until - state.elapsed)]);
    const flames = (state.fires ?? []).filter(f => nearPoint(f));
    if (flames.length) snapshot.fi = flames.map(f => [f.id, r2(f.x), r2(f.y), r2(f.z), r2(f.until - state.elapsed)]);
    if (state.plane) snapshot.plane = [r2(state.plane.travelled), state.plane.active ? 1 : 0];
    // Now and then restate every picked-up item, so a client that missed a message heals itself.
    if (resync || seq % 50 === 0) snapshot.loot.all = this.lootActive.flatMap((active, index) => active ? [] : [index]);
    if (state.phase === 'won' || state.phase === 'lost') snapshot.over = state.winnerId ?? '';
    return snapshot;
  }
}

function actorRow(sim: GameSimulation, actor: Actor, index: number): ActorRow {
  const air = AIR_CODES.indexOf(actor.air?.mode ?? null);
  const flags = (actor.alive ? 1 : 0) | (actor.reloading > 0 ? 2 : 0) | (actor.healing > 0 ? 4 : 0) | (air << 3) | (Math.max(0, STANCES.indexOf(actor.stance ?? 'stand')) << 5) | (actor.reconnecting ? 128 : 0) | (actor.hidden ? 256 : 0);
  const car = actor.vehicleId ? sim.state.vehicles.findIndex(v => v.id === actor.vehicleId) + 1 : 0;
  return [index, r2(actor.position.x), r2(actor.position.y), r2(actor.position.z), r2(actor.yaw), Math.round(actor.health), flags, WEAPON_INDEX.get(actor.weapon) ?? 0, car, actor.helmet * 4 + actor.vest, attachCode(attachmentsOf(actor, actor.weapon))];
}

function privateRow(sim: GameSimulation, actor: Actor): PrivateRow {
  const motion = sim.motionOf(actor);
  const row: PrivateRow = {
    id: actor.id, weapon: WEAPON_INDEX.get(actor.weapon) ?? 0, owned: actor.ownedWeapons.map(id => WEAPON_INDEX.get(id) ?? 0),
    ammo: Object.entries(actor.ammo).filter(([, n]) => n > 0).map(([id, n]) => [WEAPON_INDEX.get(id) ?? 0, n] as [number, number]),
    reserve: Object.entries(actor.reserve).filter(([, n]) => n > 0).map(([id, n]) => [AMMO_INDEX.get(id) ?? 0, n] as [number, number]),
    medkits: actor.medkits, helmet: [actor.helmet, Math.round(actor.helmetHp)], vest: [actor.vest, Math.round(actor.vestHp)],
    reload: r2(actor.reloading), heal: r2(actor.healing), vy: r2(motion.vy), speed: r2(motion.speed),
    sup: SUPPLY_ORDER.map(kind => actor.supplies[kind]), boost: Math.round(actor.boost), hk: Math.max(0, USE_CODES.indexOf(actor.healKind ?? null)),
    tk: sim.selectedThrow(actor) ? THROW_ORDER.indexOf(sim.selectedThrow(actor)!) + 1 : 0, bl: r2(actor.blind ?? 0),
    br: Math.round((actor.breath ?? BREATH_SECONDS) / BREATH_SECONDS * 100), hb: (actor.holding ? 1 : 0) | (actor.winded ? 2 : 0),
    ml: actor.melee ? MELEE_ORDER.indexOf(actor.melee) + 1 : 0, pk: actor.pack, ps: ATTACH_ORDER.map(kind => actor.parts[kind]), att: actor.ownedWeapons.map(weapon => [WEAPON_INDEX.get(weapon) ?? 0, attachCode(attachmentsOf(actor, weapon))] as [number, number]),
  };
  if (actor.air) row.air = [r2(actor.air.vx), r2(actor.air.vy), r2(actor.air.vz), r2(actor.air.time)];
  if (actor.practice) {
    const drill = actor.practice.drill;
    row.rp = [actor.practice.immortal ? 1 : 0, actor.practice.shots, actor.practice.hits,
      drill ? { ...drill, lastHitAt: Number.isFinite(drill.lastHitAt) ? r2(drill.lastHitAt) : -1e9 } : null];
  }
  return row;
}

/** Which events a client needs: everything involving people, kills for the feed, and shots and blasts close to a human. */
function keepEvent(sim: GameSimulation, event: GameEvent, near: (p: { x: number; z: number }) => boolean): boolean {
  switch (event.type) {
    case 'shot': return near(event.from);
    case 'damage': return !!sim.actorById(event.actorId)?.isPlayer || !!(event.sourceId && sim.actorById(event.sourceId)?.isPlayer);
    case 'crash': case 'explosion': case 'smoke': case 'flash': case 'fire': return near(event.position);
    case 'throw': return near(event.from);
    case 'portal': return near(event.from) || near(event.to);
    case 'drop': return !!sim.actorById(event.actorId)?.isPlayer;
    default: return true;
  }
}

/** The parts of a snapshot a client keeps to draw other soldiers smoothly between snapshots. */
export interface PoseRow { x: number; y: number; z: number; yaw: number }

export interface ApplyOptions {
  /** Write positions of remote actors straight into the mirror (tests); a client interpolates them instead. */
  writePositions?: boolean;
  /** The local player has fired very recently: do not let a snapshot that predates those shots refill their magazine. */
  protectAmmo?: boolean;
  /** Do not take the local player back to an earlier stage of the drop (a snapshot sent before the host saw their jump). */
  keepFlight?: boolean;
  /** The local player changed stance / weapon a moment ago and the host has not heard yet: keep their choice. */
  keepStance?: boolean;
  keepWeapon?: boolean;
  /** The local player drives a car on their own screen: do not overwrite it with the host's (older) state. */
  predictDriving?: boolean;
}

export interface ApplyResult {
  events: GameEvent[];
  /** Where the host says the local player is, if they are in the snapshot. */
  local?: { x: number; y: number; z: number; yaw: number; row: ActorRow };
  /** Rows by actor index, for the interpolation buffer. */
  poses: Map<number, PoseRow>;
  over?: string;
  /** Where the host says the car the local player was already driving is (it is predicted, not overwritten). */
  ownCar?: { x: number; y: number; z: number; yaw: number; speed: number };
  /** The snapshot said the local player was at an earlier stage of the drop than prediction, and was overruled. */
  flightRegress?: boolean;
}

/** Plane, free fall, canopy: how far along the drop someone is. */
const FLIGHT_ORDER: Record<string, number> = { plane: 1, freefall: 2, chute: 3 };

/** Client side: bring the mirror simulation in line with a snapshot. */
export function applySnapshot(sim: GameSimulation, snap: Snapshot, options: ApplyOptions = {}): ApplyResult {
  const state = sim.state;
  const poses = new Map<number, PoseRow>();
  const result: ApplyResult = { events: snap.ev, poses };
  const localId = sim.localId;
  const drivenBefore = options.predictDriving ? sim.actorById(localId)?.vehicleId ?? null : null;
  for (const human of sim.humans) delete human.dropFollowing;
  for (const [follower, leader] of snap.fo ?? []) {
    const actor = state.actors[follower], target = state.actors[leader];
    if (actor?.isPlayer && target?.isPlayer && actor !== target) actor.dropFollowing = target.id;
  }
  for (const row of snap.a) {
    const [index, x, y, z, yaw, health, flags, weapon, car, gear, rig] = row;
    const actor = state.actors[index];
    if (!actor) continue;
    poses.set(index, { x, y, z, yaw });
    const alive = (flags & 1) !== 0;
    const wasAlive = actor.alive;
    actor.alive = alive;
    if (sim.rangeMode && alive && !wasAlive) { delete actor.rank; delete actor.diedAt; if (actor.id === localId) { delete state.playerRank; delete state.diedAt; } }
    actor.health = alive ? health : 0;
    actor.reloading = flags & 2 ? Math.max(actor.reloading, 0.01) : 0;
    actor.healing = flags & 4 ? Math.max(actor.healing, 0.01) : 0;
    if (flags & 128) actor.reconnecting = true; else delete actor.reconnecting;
    actor.hidden = (flags & 256) !== 0;
    const airMode = AIR_CODES[(flags >> 3) & 3];
    if (options.keepFlight && actor.id === localId && airMode && actor.air && (FLIGHT_ORDER[actor.air.mode] ?? 0) > (FLIGHT_ORDER[airMode] ?? 0)) result.flightRegress = true;
    else if (airMode) { if (!actor.air || actor.air.mode !== airMode) actor.air = { mode: airMode, vx: 0, vy: 0, vz: 0, time: actor.air?.time ?? 0 }; }
    else actor.air = null;
    const own = actor.id === localId;
    if (!(own && options.keepStance)) actor.stance = STANCES[(flags >> 5) & 3] ?? 'stand';
    if (!(own && options.keepWeapon)) actor.weapon = WEAPON_ORDER[weapon] ?? actor.weapon;
    actor.vehicleId = car ? state.vehicles[car - 1]?.id ?? null : null;
    actor.helmet = gear >> 2; actor.vest = gear & 3;
    // What other people's guns carry, so their scopes and suppressors show; your own come in the private row.
    if (actor.id !== localId && typeof rig === 'number') { const held = WEAPON_ORDER[weapon]; if (held) actor.attach[held] = attachFromCode(rig); }
    if (actor.id === localId) result.local = { x, y, z, yaw, row };
    else if (options.writePositions) { actor.position.x = x; actor.position.y = y; actor.position.z = z; actor.yaw = yaw; }
  }
  for (const [index, x, y, z, yaw, speed, health, driver] of snap.c) {
    const car = state.vehicles[index];
    if (!car) continue;
    car.health = health;
    car.driverId = driver ? state.actors[driver - 1]?.id ?? null : null;
    if (drivenBefore && car.id === drivenBefore && car.driverId === localId) { result.ownCar = { x, y, z, yaw, speed }; continue; }
    car.position.x = x; car.position.y = y; car.position.z = z; car.yaw = yaw; car.speed = speed;
  }
  // Loot: items the host added since (dropped gear, crate contents), and items it says were picked up.
  let changedLoot = false;
  for (const [index, id, kind, x, y, z, amount, loadedAmmo, durability] of snap.loot.add) {
    if (!Number.isSafeInteger(index) || index < 0 || index > 1_000_000) continue;
    // A previous add packet may be missing: keep every slot safe for spatial indexing and rendering until it arrives.
    while (state.loot.length <= index) {
      state.loot.push({ id: `pending-loot-${state.loot.length}`, kind: 'medkit', position: { x: 0, y: 0, z: 0 }, active: false });
    }
    if (state.loot[index].id !== id) {
      changedLoot = true;
      state.loot[index] = { id, kind: kind as LootKind, position: { x, y, z }, active: true };
      if (typeof amount === 'number') state.loot[index].amount = amount;
      if (typeof loadedAmmo === 'number') state.loot[index].loadedAmmo = loadedAmmo;
      if (typeof durability === 'number') state.loot[index].durability = durability;
    } else {
      const loot = state.loot[index];
      if (snap.rs) {
        changedLoot = true; loot.active = true; loot.position = { x, y, z }; loot.kind = kind as LootKind;
        delete loot.amount; delete loot.loadedAmmo; delete loot.durability;
      }
      if (typeof amount === 'number') loot.amount = amount;
      if (typeof loadedAmmo === 'number') loot.loadedAmmo = loadedAmmo;
      if (typeof durability === 'number') loot.durability = durability;
    }
  }
  // Replacing a placeholder keeps the length: change array identity so the mirror rebuilds its spatial loot index.
  if (changedLoot) state.loot = [...state.loot];
  for (const index of snap.loot.off) if (state.loot[index]) state.loot[index].active = false;
  if (snap.loot.all) for (const index of snap.loot.all) if (state.loot[index]) state.loot[index].active = false;
  state.airdrops = snap.drops.map(([id, x, y, z, landed, empty]) => {
    const previous = state.airdrops?.find(drop => drop.id === id);
    return { id, x, y, z, landed: landed === 1, empty: empty === 1, time: previous?.time ?? 0, loot: previous?.loot ?? [] };
  });
  state.projectiles = (snap.pr ?? []).filter(row => PROJECTILE_KINDS[row[1]]).map(([id, kind, x, y, z, vx, vy, vz]) => ({ id, kind: PROJECTILE_KINDS[kind], x, y, z, vx, vy, vz, fuse: 0, owner: '' }));
  state.smokes = (snap.sm ?? []).map(([id, x, y, z, age, remaining]) => ({ id, x, y, z, radius: 6.5, born: snap.t - age, until: snap.t + remaining }));
  state.fires = (snap.fi ?? []).map(([id, x, y, z, remaining]) => ({ id, x, y, z, radius: 4.2, until: snap.t + remaining, owner: '', tick: 1 }));
  const [cx, cz, radius, ncx, ncz, nradius, stage, timeRemaining, shrinking] = snap.zone;
  state.zone.center = { x: cx, z: cz }; state.zone.radius = radius;
  state.zone.nextCenter = { x: ncx, z: ncz }; state.zone.nextRadius = nradius;
  state.zone.stage = stage; state.zone.timeRemaining = timeRemaining; state.zone.isShrinking = shrinking === 1;
  if (snap.plane && state.plane) {
    state.plane.travelled = snap.plane[0]; state.plane.active = snap.plane[1] === 1;
    placePlane(state.plane);
  }
  state.elapsed = snap.t;
  for (const row of snap.priv) {
    const actor = sim.actorById(row.id);
    if (!actor) continue;
    if (actor.id === localId) applyPrivate(sim, actor, row, options.protectAmmo === true, result.flightRegress === true, options.keepWeapon === true);
    else { actor.ownedWeapons = row.owned.map(index => WEAPON_ORDER[index]); }
  }
  for (const [index, kills, rank] of snap.humans) {
    const actor = state.actors[index];
    if (!actor) continue;
    actor.kills = kills;
    if (sim.rangeMode && actor.id === localId) state.kills = kills;
    if (rank) { actor.rank = rank; if (actor.id === localId) state.playerRank = rank; }
  }
  if (snap.over !== undefined) {
    result.over = snap.over;
    state.winnerId = snap.over || undefined;
    state.phase = snap.over === localId ? 'won' : 'lost';
  }
  return result;
}

function applyPrivate(sim: GameSimulation, actor: Actor, row: PrivateRow, protectAmmo: boolean, keepFlight: boolean, keepWeapon: boolean): void {
  const previous = actor.ammo;
  if (!keepWeapon) actor.weapon = WEAPON_ORDER[row.weapon] ?? actor.weapon;
  actor.ownedWeapons = row.owned.map(index => WEAPON_ORDER[index]);
  const ammo = emptyAmmo();
  for (const [index, n] of row.ammo) ammo[WEAPON_ORDER[index]] = n;
  // Shots fired in the last moment may not have reached the host yet: keep the lower count for the gun in hand.
  if (protectAmmo) ammo[actor.weapon] = Math.min(ammo[actor.weapon], previous[actor.weapon] ?? 0);
  actor.ammo = ammo;
  const reserve = emptyReserve();
  for (const [index, n] of row.reserve) reserve[AMMO_ORDER[index]] = n;
  actor.reserve = reserve;
  actor.medkits = row.medkits;
  actor.helmet = row.helmet[0]; actor.helmetHp = row.helmet[1];
  actor.vest = row.vest[0]; actor.vestHp = row.vest[1];
  actor.reloading = row.reload; actor.healing = row.heal;
  if (Array.isArray(row.sup)) SUPPLY_ORDER.forEach((kind, i) => { const n = row.sup![i]; actor.supplies[kind] = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; });
  if (typeof row.boost === 'number' && Number.isFinite(row.boost)) actor.boost = Math.max(0, Math.min(100, row.boost));
  actor.healKind = row.heal > 0 ? USE_CODES[row.hk ?? 1] ?? null : null;
  actor.throwKind = row.tk ? THROW_ORDER[row.tk - 1] ?? null : null;
  actor.melee = row.ml ? MELEE_ORDER[row.ml - 1] ?? null : null;
  if (typeof row.pk === 'number') actor.pack = Math.max(0, Math.min(3, Math.floor(row.pk)));
  if (Array.isArray(row.ps)) ATTACH_ORDER.forEach((kind, i) => { const n = row.ps![i]; actor.parts[kind] = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; });
  if (Array.isArray(row.att)) { actor.attach = {}; for (const [weapon, code] of row.att) { const id = WEAPON_ORDER[weapon]; if (id && code) actor.attach[id] = attachFromCode(code); } }
  if (typeof row.br === 'number' && Number.isFinite(row.br)) actor.breath = Math.max(0, Math.min(100, row.br)) / 100 * BREATH_SECONDS;
  actor.holding = typeof row.hb === 'number' && (row.hb & 1) === 1; actor.winded = typeof row.hb === 'number' && (row.hb & 2) === 2;
  actor.blind = typeof row.bl === 'number' && Number.isFinite(row.bl) ? Math.max(0, row.bl) : 0;
  if (sim.rangeMode && row.rp) {
    const [immortal, shots, hits, drill] = row.rp;
    // Preserve the object while a drill runs, so UI records completion only once.
    const previous = actor.practice?.drill;
    const current = drill && previous?.id === drill.id && previous.startedAt === drill.startedAt ? Object.assign(previous, drill) : drill ? { ...drill } : null;
    actor.practice = { immortal: immortal === 1, shots, hits, drill: current };
    sim.setImmortal(immortal === 1, actor);
    sim.state.shots = shots; sim.state.hits = hits; sim.state.kills = actor.kills ?? 0; sim.state.drill = current;
  }
  // The stage and its velocity/time must agree: a pre-jump plane payload would otherwise stop a predicted fall.
  if (!keepFlight && row.air && actor.air) { actor.air.vx = row.air[0]; actor.air.vy = row.air[1]; actor.air.vz = row.air[2]; actor.air.time = row.air[3]; }
  // On foot the client predicts its own jump and the host's vertical speed is a round trip old: taking it would stretch
  // every jump. Only a flight (free fall, canopy) needs the host's velocity to stay in step.
  if (!keepFlight && actor.air) sim.setMotion(actor, { vy: row.vy, speed: row.speed });
}
