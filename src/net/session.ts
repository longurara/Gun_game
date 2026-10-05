/**
 * The two ends of a multiplayer match. The host runs the real simulation (bots included) and sends snapshots; a client
 * runs a mirror, predicts its own movement so controls feel immediate, and draws everybody else a moment in the past,
 * blended between snapshots. Neither knows about Supabase: they talk through a `Transport`.
 */
import type { GameEvent, PlayerInput, Stance, Vec3, WeaponType } from '../types';
import type { GameSimulation } from '../game/simulation';
import { applySnapshot, SNAPSHOT_INTERVAL, SnapshotBuilder } from './protocol';
import { placePlane } from '../game/drop';
import type { PoseRow, Snapshot } from './protocol';
import type { NetMessage, Transport } from './transport';

/** Everything both sides need to build the same match. */
export interface MatchSetup {
  seed: number; map: 'island' | 'valley' | 'arena'; botCount: number; difficulty: 'easy' | 'normal'; drop: boolean;
  /** In join order: index 0 is the host. */
  players: Array<{ clientId: string; name: string }>;
}

export const actorIdFor = (index: number): string => `p${index}`;

/** Simulation options for one machine of a match. */
export function matchOptions(setup: MatchSetup, localClientId: string, remote: boolean) {
  const index = Math.max(0, setup.players.findIndex(player => player.clientId === localClientId));
  return {
    seed: setup.seed, botCount: setup.botCount, difficulty: setup.difficulty, map: setup.map, drop: setup.drop,
    humans: setup.players.length, names: setup.players.map(player => player.name), localId: actorIdFor(index), remote,
  };
}

const num = (value: unknown, fallback = 0): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback;

// ---------------------------------------------------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------------------------------------------------

interface Remote { clientId: string; actorId: string; name: string; lastSeen: number; lastSeq: number; lastCt: number }

export class HostSession {
  private builder: SnapshotBuilder;
  private readonly clock: () => number;
  private pending: GameEvent[] = [];
  private since = 0;
  private remotes = new Map<string, Remote>();
  private finalSends = 6;
  /** Players who left or timed out (reported to the UI once). */
  private gone: string[] = [];

  constructor(readonly sim: GameSimulation, private readonly transport: Transport, setup: MatchSetup, private readonly timeoutMs = 8000, clock: () => number = () => performance.now()) {
    this.clock = clock;
    this.builder = new SnapshotBuilder(sim);
    setup.players.forEach((player, index) => {
      if (player.clientId === transport.clientId) return;
      this.remotes.set(player.clientId, { clientId: player.clientId, actorId: actorIdFor(index), name: player.name, lastSeen: this.clock(), lastSeq: -1, lastCt: 0 });
    });
    transport.onMessage((message, from) => this.receive(message, from));
  }

  /** Events for this machine's own screen; they are also queued for the next snapshot. */
  drainEvents(): GameEvent[] {
    const events = this.sim.drainEvents();
    this.pending.push(...events);
    return events;
  }

  private receive(message: NetMessage, from: string): void {
    const remote = this.remotes.get(from);
    if (!remote) return;
    remote.lastSeen = this.clock();
    if (message.k === 'bye') { this.drop(remote, 'đã thoát'); return; }
    if (message.k !== 'in') return;
    const seq = num(message.seq, -1);
    if (seq <= remote.lastSeq) return;
    remote.lastSeq = seq;
    remote.lastCt = num(message.ct);
    const sim = this.sim;
    const actor = sim.actorById(remote.actorId);
    if (!actor) return;
    sim.setHumanInput(actor.id, {
      moveX: num(message.mx), moveZ: num(message.mz), sprint: message.sp === 1, jump: message.ju === 1,
      throttle: num(message.th), steer: num(message.st),
    }, message.edge === 1);
    if (actor.alive && !actor.vehicleId && !actor.air) actor.yaw = num(message.yaw, actor.yaw);
    if (!actor.alive) return;
    for (const cmd of Array.isArray(message.cmds) ? message.cmds as unknown[][] : []) this.command(actor.id, String(cmd[0]), cmd[1]);
    for (const fire of Array.isArray(message.fires) ? message.fires as number[][] : []) {
      const target = { x: num(fire[0]), y: num(fire[1]), z: num(fire[2]) };
      if (Math.hypot(target.x - actor.position.x, target.z - actor.position.z) < 1200) sim.shootPlayer(target, fire[3] === 1, actor);
    }
  }

  private command(actorId: string, command: string, argument: unknown): void {
    const sim = this.sim, actor = sim.actorById(actorId);
    if (!actor) return;
    switch (command) {
      case 'reload': sim.reload(actor); break;
      case 'heal': sim.heal(actor); break;
      case 'interact': sim.interact(actor); break;
      case 'vehicle': sim.useVehicle(actor); break;
      case 'switch': sim.switchWeapon(String(argument) as WeaponType, actor); break;
      case 'stance': if (argument === 'stand' || argument === 'crouch' || argument === 'prone') sim.setStance(argument as Stance, actor); break;
    }
  }

  private drop(remote: Remote, why: string): void {
    this.remotes.delete(remote.clientId);
    this.gone.push(`${remote.name} ${why}`);
    const actor = this.sim.actorById(remote.actorId);
    if (actor?.alive) this.sim.eliminate(actor.id);
  }

  /** Players that just left (for a message on the host's screen). */
  takeDeparted(): string[] { return this.gone.splice(0); }

  /** Call once per frame after `sim.update`. */
  tick(dt: number): void {
    const now = this.clock();
    for (const remote of [...this.remotes.values()]) if (now - remote.lastSeen > this.timeoutMs) this.drop(remote, 'mất kết nối');
    this.since += dt;
    if (this.since < SNAPSHOT_INTERVAL) return;
    this.since = 0;
    const over = this.sim.state.phase === 'won' || this.sim.state.phase === 'lost';
    if (over && this.finalSends-- <= 0) return;
    const snapshot = this.builder.build(this.pending);
    this.pending = [];
    const echo: Record<string, number> = {};
    for (const remote of this.remotes.values()) echo[remote.clientId] = remote.lastCt;
    this.transport.send({ k: 'snap', s: snapshot as unknown as Record<string, unknown>, echo });
  }

  close(): void { this.transport.send({ k: 'closed', why: 'host' }); this.transport.close(); }
}

// ---------------------------------------------------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------------------------------------------------

interface Buffered { at: number; t: number; poses: Map<number, PoseRow>; cars: Map<number, PoseRow> }
interface Trail { at: number; x: number; y: number; z: number }

/** Seconds a client draws other players in the past, enough to always have two snapshots to blend between. */
const INTERPOLATION_DELAY = 0.15;
const INPUT_INTERVAL = 100;
const ACTION_INTERVAL = 40;

export class ClientSession {
  rttMs = 0;
  lastSnapshotAt: number;
  private readonly clock: () => number;
  private buffer: Buffered[] = [];
  private trail: Trail[] = [];
  private events: GameEvent[] = [];
  private seq = 0;
  private lastSend = -Infinity;
  private lastFireAt = -Infinity;
  private fires: number[][] = [];
  private cmds: unknown[][] = [];
  private jumpDown = false;
  private edge = false;
  private over = false;
  closedByHost = false;

  constructor(readonly sim: GameSimulation, private readonly transport: Transport, private readonly hostId: string, clock: () => number = () => performance.now()) {
    this.clock = clock;
    this.lastSnapshotAt = clock();
    transport.onMessage((message, from) => {
      if (from !== hostId) return;
      if (message.k === 'snap') this.snapshot(message.s as unknown as Snapshot, (message.echo as Record<string, number> | undefined)?.[transport.clientId]);
      else if (message.k === 'closed') this.closedByHost = true;
    });
  }

  drainEvents(): GameEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  /** A shot fired by the local player: the host decides what it hits. */
  queueFire(target: Vec3, aimed: boolean): void {
    this.fires.push([Math.round(target.x * 100) / 100, Math.round(target.y * 100) / 100, Math.round(target.z * 100) / 100, aimed ? 1 : 0]);
    this.lastFireAt = this.clock();
  }
  queueCommand(command: string, argument?: unknown): void { this.cmds.push(argument === undefined ? [command] : [command, argument]); }

  /** Call once per frame after `sim.update(dt, input)` (which predicted the local movement). */
  tick(nowMs: number, input: PlayerInput, yaw: number): void {
    const me = this.sim.player;
    this.trail.push({ at: nowMs, x: me.position.x, y: me.position.y, z: me.position.z });
    while (this.trail.length > 90) this.trail.shift();
    if (input.jump && !this.jumpDown) this.edge = true;
    this.jumpDown = input.jump;
    const actions = this.fires.length > 0 || this.cmds.length > 0 || this.edge;
    if (nowMs - this.lastSend < (actions ? ACTION_INTERVAL : INPUT_INTERVAL)) return;
    this.lastSend = nowMs;
    const packet: NetMessage = {
      k: 'in', seq: ++this.seq, ct: Math.round(nowMs), mx: round3(input.moveX), mz: round3(input.moveZ), sp: input.sprint ? 1 : 0, ju: input.jump ? 1 : 0,
      th: round3(input.throttle ?? 0), st: round3(input.steer ?? 0), yaw: round3(yaw), edge: this.edge ? 1 : 0,
    };
    if (this.fires.length) packet.fires = this.fires.splice(0);
    if (this.cmds.length) packet.cmds = this.cmds.splice(0);
    this.edge = false;
    this.transport.send(packet);
  }

  private snapshot(snap: Snapshot, echoCt: number | undefined): void {
    const now = this.clock();
    this.lastSnapshotAt = now;
    if (echoCt) this.rttMs = this.rttMs ? this.rttMs * 0.8 + Math.max(0, now - echoCt) * 0.2 : Math.max(0, now - echoCt);
    const result = applySnapshot(this.sim, snap, { writePositions: false, protectAmmo: now - this.lastFireAt < 350 });
    this.events.push(...result.events.filter(event => !('for' in event) || (event as { for?: string }).for === undefined || (event as { for?: string }).for === this.sim.localId));
    // The plane in a snapshot is where it was a moment ago: move it on by the time the message took, riders with it.
    const plane = this.sim.state.plane;
    if (plane?.active) {
      plane.travelled = Math.min(plane.length, plane.travelled + plane.speed * Math.min(0.5, this.rttMs / 2000));
      placePlane(plane);
      for (const actor of this.sim.state.actors) if (actor.air?.mode === 'plane') { actor.position.x = plane.x; actor.position.y = plane.y; actor.position.z = plane.z; }
    }
    const poses = new Map(result.poses);
    const cars = new Map<number, PoseRow>();
    for (const [index, x, y, z, yaw] of snap.c) cars.set(index, { x, y, z, yaw });
    this.buffer.push({ at: now, t: snap.t, poses, cars });
    while (this.buffer.length > 24) this.buffer.shift();
    if (result.local) this.reconcile(result.local, echoCt);
    if (result.over !== undefined) this.over = true;
  }

  /**
   * The host's word on where the local player is, compared with where prediction had them when the host saw the input
   * that produced it. Small differences are timing and ignored; a real disagreement (a wall, a fall, a hit) is corrected.
   */
  private reconcile(truth: { x: number; y: number; z: number }, echoCt: number | undefined): void {
    const me = this.sim.player;
    if (me.vehicleId || !me.alive) return;
    let then: Trail | undefined;
    if (echoCt) then = this.trail.reduce<Trail | undefined>((best, item) => !best || Math.abs(item.at - echoCt) < Math.abs(best.at - echoCt) ? item : best, undefined);
    const reference = then ?? { x: me.position.x, y: me.position.y, z: me.position.z, at: 0 };
    const dx = truth.x - reference.x, dy = truth.y - reference.y, dz = truth.z - reference.z;
    const horizontal = Math.hypot(dx, dz);
    // Within a metre and a half the prediction stands: the host saw the input a little later than the client made it.
    if (horizontal < 1.5 && Math.abs(dy) < 1.2) return;
    const share = horizontal > 8 || Math.abs(dy) > 8 ? 1 : 0.6;
    me.position.x += dx * share; me.position.y += dy * share; me.position.z += dz * share;
    for (const item of this.trail) { item.x += dx * share; item.y += dy * share; item.z += dz * share; }
  }

  /** Call every frame before drawing: place everybody else where they were a moment ago, blended between snapshots. */
  frame(nowMs: number): void {
    const latest = this.buffer[this.buffer.length - 1];
    if (!latest) return;
    const hostNow = latest.t + (nowMs - latest.at) / 1000;
    const renderT = hostNow - INTERPOLATION_DELAY;
    let older = latest, newer = latest;
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      if (this.buffer[i].t <= renderT) { older = this.buffer[i]; newer = this.buffer[Math.min(i + 1, this.buffer.length - 1)]; break; }
      older = this.buffer[i]; newer = this.buffer[i];
    }
    const span = newer.t - older.t;
    const k = span > 1e-6 ? Math.max(0, Math.min(1, (renderT - older.t) / span)) : 1;
    const localIndex = this.sim.state.actors.indexOf(this.sim.player);
    for (const [index, from] of older.poses) {
      if (index === localIndex) continue;
      const actor = this.sim.state.actors[index];
      const to = newer.poses.get(index) ?? from;
      if (!actor) continue;
      actor.position.x = from.x + (to.x - from.x) * k; actor.position.y = from.y + (to.y - from.y) * k; actor.position.z = from.z + (to.z - from.z) * k;
      actor.yaw = from.yaw + Math.atan2(Math.sin(to.yaw - from.yaw), Math.cos(to.yaw - from.yaw)) * k;
    }
    this.sim.state.vehicles.forEach((car, index) => {
      const from = older.cars.get(index);
      if (!from) return;
      const to = newer.cars.get(index) ?? from;
      car.position.x = from.x + (to.x - from.x) * k; car.position.y = from.y + (to.y - from.y) * k; car.position.z = from.z + (to.z - from.z) * k;
      car.yaw = from.yaw + Math.atan2(Math.sin(to.yaw - from.yaw), Math.cos(to.yaw - from.yaw)) * k;
    });
    // Driving: the local player rides the host's car (not predicted).
    const me = this.sim.player;
    const ride = me.vehicleId ? this.sim.state.vehicles.find(car => car.id === me.vehicleId) : undefined;
    if (ride) { me.position = { x: ride.position.x, y: ride.position.y + 0.3, z: ride.position.z }; me.yaw = ride.yaw; }
  }

  /** Seconds since the host last sent anything. */
  get silence(): number { return (this.clock() - this.lastSnapshotAt) / 1000; }
  get matchOver(): boolean { return this.over; }

  leave(): void { this.transport.send({ k: 'bye' }); this.transport.close(); }
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
