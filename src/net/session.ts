/**
 * The two ends of a multiplayer match. The host runs the real simulation (bots included) and sends snapshots; a client
 * runs a mirror, predicts its own movement so controls feel immediate, and draws everybody else a moment in the past,
 * blended between snapshots. Neither knows about Supabase: they talk through a `Transport`.
 */
import type { GameEvent, LootKind, PlayerInput, Stance, Vec3, WeaponType } from '../types';
import type { GameSimulation } from '../game/simulation';
import { applySnapshot, netRates, PROTOCOL_VERSION, SnapshotBuilder } from './protocol';
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

interface Remote { clientId: string; actorId: string; name: string; lastSeen: number; lastSeq: number; lastCt: number; lastJumpId: number }

export class HostSession {
  private builder: SnapshotBuilder;
  private readonly clock: () => number;
  private pending: GameEvent[] = [];
  private since = 0;
  private readonly interval: number;
  private remotes = new Map<string, Remote>();
  private finalSends = 6;
  /** Players who left or timed out (reported to the UI once). */
  private gone: string[] = [];

  constructor(readonly sim: GameSimulation, private readonly transport: Transport, setup: MatchSetup, private readonly timeoutMs = 8000, clock: () => number = () => performance.now()) {
    this.clock = clock;
    this.interval = 1 / netRates(setup.players.length).snapshotHz;
    this.builder = new SnapshotBuilder(sim);
    setup.players.forEach((player, index) => {
      if (player.clientId === transport.clientId) return;
      this.remotes.set(player.clientId, { clientId: player.clientId, actorId: actorIdFor(index), name: player.name, lastSeen: this.clock(), lastSeq: -1, lastCt: 0, lastJumpId: 0 });
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
    // Keep the latest press in every input packet: a lost or reordered tap is recovered by the next packet.
    // Repeated ids are not new presses (in particular, they must not open the canopy after a plane jump).
    const jumpId = message.jumpId;
    const numberedJump = typeof jumpId === 'number' && Number.isSafeInteger(jumpId) && jumpId >= 0;
    const jumpEdge = numberedJump ? jumpId > remote.lastJumpId : jumpId === undefined && message.edge === 1;
    if (numberedJump) remote.lastJumpId = Math.max(remote.lastJumpId, jumpId);
    sim.setHumanInput(actor.id, {
      moveX: num(message.mx), moveZ: num(message.mz), sprint: message.sp === 1, jump: message.ju === 1,
      throttle: num(message.th), steer: num(message.st),
    }, jumpEdge);
    if (actor.alive && !actor.vehicleId && !actor.air) actor.yaw = num(message.yaw, actor.yaw);
    if (!actor.alive) return;
    for (const cmd of Array.isArray(message.cmds) ? message.cmds.slice(0, 64) : []) {
      if (Array.isArray(cmd) && typeof cmd[0] === 'string') this.command(actor.id, cmd[0], cmd[1]);
    }
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
      case 'inventory-pickup':
        if (typeof argument === 'string' && argument.length > 0 && argument.length <= 128) sim.pickupLoot(argument, actor);
        break;
      case 'inventory-drop': {
        if (!argument || typeof argument !== 'object' || Array.isArray(argument)) break;
        const { kind, amount } = argument as { kind?: unknown; amount?: unknown };
        if (typeof kind === 'string' && kind.length > 0 && kind.length <= 128 && typeof amount === 'number' && Number.isSafeInteger(amount) && amount >= 1 && amount <= 1_000_000) sim.dropItem(kind as LootKind, amount, actor);
        break;
      }
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
    // Keep the remainder so the stream holds its rate whatever the frame rate is (resetting to 0 sent ~8 Hz at 60 fps).
    this.since += dt;
    if (this.since < this.interval - 1e-6) return;
    this.since = this.since > this.interval * 3 ? 0 : this.since - this.interval;
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

/** Bounds, in seconds, of how far in the past a client draws other players (adapts to the network inside this range). */
const MIN_DELAY = 0.06, MAX_DELAY = 0.4;
/** A shot, command or jump goes out within this many ms; so does a change of movement (a stop or a turn should not wait). */
const ACTION_INTERVAL = 40;
const CHANGE_INTERVAL = 50;
/** When the next snapshot is late, keep other players moving along their last velocity for at most this long (seconds). */
const MAX_EXTRAPOLATION = 0.12;
/** A jump between two snapshots longer than this (metres) is a teleport (respawn, car seat): do not glide or extrapolate. */
const TELEPORT = 25;
/** Prediction errors are bled into the view at this rate (1/s) instead of snapping. */
const CORRECTION_RATE = 12;

export class ClientSession {
  rttMs = 0;
  lastSnapshotAt: number;
  private readonly clock: () => number;
  private buffer: Buffered[] = [];
  private trail: Trail[] = [];
  private events: GameEvent[] = [];
  private seq = 0;
  private lastSend = -Infinity;
  private lastSignature = '';
  private readonly inputInterval: number;
  private readonly snapshotInterval: number;
  /** Host clock (ms) to local clock offset: arrival time minus snapshot time, tracked towards its lower envelope. */
  private clockOffset: number | null = null;
  private excessEma = 0;
  private excessPeak = 0;
  private delay = 0.1;
  private lastFrameAt = 0;
  private lastTickAt = 0;
  /** Part of a reconciliation correction not yet applied to the view. */
  private pending = { x: 0, y: 0, z: 0 };
  private lastFireAt = -Infinity;
  private fires: number[][] = [];
  private cmds: unknown[][] = [];
  private jumpDown = false;
  private jumpId = 0;
  private lastSnapshotSeq = -1;
  private edge = false;
  private over = false;
  /** Consecutive snapshots that put the local player at an earlier stage of the drop than they predicted. */
  private regressStreak = 0;
  closedByHost = false;

  constructor(readonly sim: GameSimulation, private readonly transport: Transport, private readonly hostId: string, clock: () => number = () => performance.now()) {
    this.clock = clock;
    this.lastSnapshotAt = clock();
    const rates = netRates(Math.max(2, sim.humans.length));
    this.inputInterval = 1000 / rates.inputHz;
    this.snapshotInterval = 1 / rates.snapshotHz;
    this.delay = this.snapshotInterval + 0.05;
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
    const dt = this.lastTickAt > 0 ? Math.min(0.1, Math.max(0, (nowMs - this.lastTickAt) / 1000)) : 0;
    this.lastTickAt = nowMs;
    this.bleedCorrection(dt);
    // The trail holds where prediction says the player is, corrections included, even those still being eased in.
    this.trail.push({ at: nowMs, x: me.position.x + this.pending.x, y: me.position.y + this.pending.y, z: me.position.z + this.pending.z });
    while (this.trail.length > 90) this.trail.shift();
    if (input.jump && !this.jumpDown) { this.edge = true; this.jumpId++; }
    this.jumpDown = input.jump;
    const actions = this.fires.length > 0 || this.cmds.length > 0 || this.edge;
    const signature = `${q(input.moveX)}|${q(input.moveZ)}|${input.sprint ? 1 : 0}|${input.jump ? 1 : 0}|${q(input.throttle ?? 0)}|${q(input.steer ?? 0)}`;
    const changed = signature !== this.lastSignature;
    const gap = actions ? ACTION_INTERVAL : changed ? CHANGE_INTERVAL : this.inputInterval;
    if (nowMs - this.lastSend < gap) return;
    // Keep the phase of the schedule when frames do not line up with it, so 20 Hz stays 20 Hz at 30 fps.
    this.lastSend = nowMs - this.lastSend < gap * 2 ? this.lastSend + gap : nowMs;
    this.lastSignature = signature;
    const packet: NetMessage = {
      k: 'in', seq: ++this.seq, ct: Math.round(nowMs), mx: round3(input.moveX), mz: round3(input.moveZ), sp: input.sprint ? 1 : 0, ju: input.jump ? 1 : 0,
      th: round3(input.throttle ?? 0), st: round3(input.steer ?? 0), yaw: round3(yaw), edge: this.edge ? 1 : 0, jumpId: this.jumpId,
    };
    if (this.fires.length) packet.fires = this.fires.splice(0);
    if (this.cmds.length) packet.cmds = this.cmds.splice(0);
    this.edge = false;
    this.transport.send(packet);
  }

  private snapshot(snap: Snapshot, echoCt: number | undefined): void {
    // Network jitter and reconnects can deliver an earlier snapshot after a newer one. Never rewind authoritative state.
    if (!snap || snap.v !== PROTOCOL_VERSION || !Number.isSafeInteger(snap.seq) || snap.seq < 0 || snap.seq <= this.lastSnapshotSeq) return;
    this.lastSnapshotSeq = snap.seq;
    const now = this.clock();
    this.lastSnapshotAt = now;
    this.trackClock(now, snap.t);
    if (echoCt) this.rttMs = this.rttMs ? this.rttMs * 0.8 + Math.max(0, now - echoCt) * 0.2 : Math.max(0, now - echoCt);
    const result = applySnapshot(this.sim, snap, { writePositions: false, protectAmmo: now - this.lastFireAt < 350, keepFlight: this.regressStreak < 12 });
    this.regressStreak = result.flightRegress ? this.regressStreak + 1 : 0;
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
    if (result.local && !result.flightRegress) this.reconcile(result.local, echoCt);
    if (result.over !== undefined) this.over = true;
  }

  /** Keep the offset between the host's clock and ours, and how late snapshots run, to size the interpolation buffer. */
  private trackClock(now: number, hostTime: number): void {
    const sample = now - hostTime * 1000;
    if (this.clockOffset === null || Math.abs(sample - this.clockOffset) > 1500) {
      this.clockOffset = sample; this.excessEma = 0; this.excessPeak = 0;
      return;
    }
    // Network delay only ever adds, so follow quick improvements fast and slow worsening slowly (the lower envelope).
    this.clockOffset += (sample - this.clockOffset) * (sample < this.clockOffset ? 0.5 : 0.02);
    const excess = Math.max(0, sample - this.clockOffset);
    this.excessEma += (excess - this.excessEma) * 0.1;
    this.excessPeak = Math.max(excess, this.excessPeak * 0.985);
  }

  /** Seconds in the past other players are drawn: one snapshot interval plus the lateness we have been seeing. */
  private targetDelay(): number {
    const late = Math.max(2 * this.excessEma, 0.7 * this.excessPeak) / 1000;
    return Math.min(MAX_DELAY, Math.max(MIN_DELAY, this.snapshotInterval + late + 0.02));
  }

  /** Move the view towards the corrected position without a visible jump. */
  private bleedCorrection(dt: number): void {
    const p = this.pending;
    if (Math.abs(p.x) + Math.abs(p.y) + Math.abs(p.z) < 1e-4) { p.x = p.y = p.z = 0; return; }
    const me = this.sim.player;
    if (me.vehicleId || !me.alive) { p.x = p.y = p.z = 0; return; }
    const share = 1 - Math.exp(-dt * CORRECTION_RATE);
    me.position.x += p.x * share; me.position.y += p.y * share; me.position.z += p.z * share;
    p.x -= p.x * share; p.y -= p.y * share; p.z -= p.z * share;
  }

  /** Where the prediction trail says the local player was at a client time. */
  private trailAt(at: number): { x: number; y: number; z: number } | undefined {
    const trail = this.trail;
    if (trail.length === 0) return undefined;
    if (at <= trail[0].at) return trail[0];
    for (let i = trail.length - 1; i > 0; i--) {
      if (trail[i - 1].at <= at) {
        const from = trail[i - 1], to = trail[i], span = to.at - from.at;
        const k = span > 1e-6 ? Math.min(1, (at - from.at) / span) : 1;
        return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, z: from.z + (to.z - from.z) * k };
      }
    }
    return trail[trail.length - 1];
  }

  /**
   * The host's word on where the local player is, compared with where prediction had them when the host saw the input
   * that produced it. Small differences are timing and ignored; a real disagreement (a wall, a fall, a hit) is corrected,
   * eased into the view over a few frames unless it is large.
   */
  private reconcile(truth: { x: number; y: number; z: number }, echoCt: number | undefined): void {
    const me = this.sim.player;
    if (me.vehicleId || !me.alive) return;
    // The host's position is a little after the echoed input: it kept moving on that input until the snapshot was built.
    const then = echoCt ? this.trailAt(echoCt + this.inputInterval / 2) : undefined;
    const reference = then ?? { x: me.position.x + this.pending.x, y: me.position.y + this.pending.y, z: me.position.z + this.pending.z };
    const dx = truth.x - reference.x, dy = truth.y - reference.y, dz = truth.z - reference.z;
    const horizontal = Math.hypot(dx, dz);
    // How far the two can differ from timing alone: the speed times the uncertainty of when the host saw the input.
    const tolerance = 0.3 + this.sim.motionOf(me).speed * this.inputInterval / 2000;
    if (horizontal < tolerance && Math.abs(dy) < 0.8) return;
    if (horizontal > 8 || Math.abs(dy) > 8) {
      me.position.x += dx + this.pending.x; me.position.y += dy + this.pending.y; me.position.z += dz + this.pending.z;
      this.pending = { x: 0, y: 0, z: 0 };
      for (const item of this.trail) { item.x += dx; item.y += dy; item.z += dz; }
      return;
    }
    const share = 0.7;
    this.pending.x += dx * share; this.pending.y += dy * share; this.pending.z += dz * share;
    for (const item of this.trail) { item.x += dx * share; item.y += dy * share; item.z += dz * share; }
  }

  /** Call every frame before drawing: place everybody else where they were a moment ago, blended between snapshots. */
  frame(nowMs: number): void {
    const latest = this.buffer[this.buffer.length - 1];
    if (!latest || this.clockOffset === null) return;
    const dt = this.lastFrameAt > 0 ? Math.min(0.25, Math.max(0, (nowMs - this.lastFrameAt) / 1000)) : 0;
    this.lastFrameAt = nowMs;
    // Follow the target delay gently: widening is quick (a stall is coming), narrowing is slow so the world does not lurch.
    const target = this.targetDelay();
    this.delay = target > this.delay ? Math.min(target, this.delay + 0.25 * dt) : Math.max(target, this.delay - 0.05 * dt);
    const renderT = (nowMs - this.clockOffset) / 1000 - this.delay;
    // The newest snapshot at or before the render time, and the one after it. Past the newest, carry on its last velocity.
    let i = this.buffer.length - 1;
    while (i > 0 && this.buffer[i].t > renderT) i--;
    let older = this.buffer[i], newer = this.buffer[Math.min(i + 1, this.buffer.length - 1)];
    if (i === this.buffer.length - 1 && i > 0) older = this.buffer[i - 1], newer = latest;
    const span = newer.t - older.t;
    let k = span > 1e-6 ? (renderT - older.t) / span : 1;
    k = Math.max(0, Math.min(1 + MAX_EXTRAPOLATION / Math.max(span, 1e-3), k));
    const kv = Math.min(k, 1);
    const localIndex = this.sim.state.actors.indexOf(this.sim.player);
    const place = (target: { position: Vec3; yaw: number }, from: PoseRow, to: PoseRow) => {
      const jump = Math.hypot(to.x - from.x, to.z - from.z);
      const kh = jump > TELEPORT ? (k < 0.5 ? 0 : 1) : k;
      target.position.x = from.x + (to.x - from.x) * kh; target.position.z = from.z + (to.z - from.z) * kh;
      target.position.y = from.y + (to.y - from.y) * (jump > TELEPORT ? kh : kv);
      target.yaw = from.yaw + Math.atan2(Math.sin(to.yaw - from.yaw), Math.cos(to.yaw - from.yaw)) * kv;
    };
    for (const [index, from] of older.poses) {
      if (index === localIndex) continue;
      const actor = this.sim.state.actors[index];
      if (!actor) continue;
      place(actor, from, newer.poses.get(index) ?? from);
    }
    this.sim.state.vehicles.forEach((car, index) => {
      const from = older.cars.get(index);
      if (!from) return;
      place(car, from, newer.cars.get(index) ?? from);
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
/** Quarter steps: enough to notice that somebody started, stopped or turned. */
const q = (n: number) => Math.round(n * 4);
