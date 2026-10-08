/**
 * The two ends of a multiplayer match. The host runs the real simulation (bots included) and sends snapshots; a client
 * runs a mirror, predicts its own movement so controls feel immediate, and draws everybody else a moment in the past,
 * blended between snapshots. Neither knows about Supabase: they talk through a `Transport`.
 */
import type { Actor, GameEvent, LootKind, MapId, PlayerInput, Projectile, Stance, Vec3, WeaponType } from '../types';
import type { GameSimulation } from '../game/simulation';
import { WEAPON_ORDER } from '../game/weapons';
import { applySnapshot, netRates, PROTOCOL_VERSION, SnapshotBuilder } from './protocol';
import { placePlane } from '../game/drop';
import { projectileGravity } from '../game/projectiles';
import type { PoseRow, Snapshot } from './protocol';
import type { NetMessage, Transport } from './transport';
import { CONNECTION_STALE_MS, RECONNECT_GRACE_MS } from './transport';

/** Everything both sides need to build the same match. */
export interface MatchSetup {
  seed: number; map: MapId; botCount: number; difficulty: 'easy' | 'normal'; drop: boolean;
  /** In join order: index 0 is the host. */
  players: Array<{ clientId: string; name: string; skin?: string }>;
  /** Selected room member, independent of which machine hosts the simulation. */
  dropLeader?: string;
}

export const actorIdFor = (index: number): string => `p${index}`;

/** Simulation options for one machine of a match. */
export function matchOptions(setup: MatchSetup, localClientId: string, remote: boolean) {
  const index = Math.max(0, setup.players.findIndex(player => player.clientId === localClientId));
  const leader = setup.players.findIndex(player => player.clientId === setup.dropLeader);
  return {
    seed: setup.seed, botCount: setup.botCount, difficulty: setup.difficulty, map: setup.map, drop: setup.drop,
    humans: setup.players.length, names: setup.players.map(player => player.name), localId: actorIdFor(index), remote,
    dropLeaderId: leader >= 0 && setup.players.length > 1 ? actorIdFor(leader) : '',
  };
}

const STANCE_NAMES = ['stand', 'crouch', 'prone'];
const num = (value: unknown, fallback = 0): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback;

// ---------------------------------------------------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------------------------------------------------

/** Where everybody and every car was at one moment of the match, so a shot can be judged against what the shooter saw. */
interface PoseFrame { t: number; actors: Float32Array; cars: Float32Array }
/** The farthest back (seconds) a shot is judged: a long ping plus the interpolation delay, but not a free pass for cheats. */
const MAX_REWIND = 0.8;
/** A client's own idea of where it stood when firing is trusted this far (metres) from where the host has it. */
const SHOOTER_TRUST = 6;

interface Remote { clientId: string; actorId: string; name: string; lastSeen: number; lastSeq: number; lastCt: number; lastJumpId: number; disconnectedAt: number | null; requestedAt: number; resumedAt: number; builder: SnapshotBuilder; pending: GameEvent[]; watchId: string | null; finalSends: number }

export class HostSession {
  private readonly clock: () => number;
  private pending: GameEvent[] = [];
  private since = 0;
  private readonly interval: number;
  private remotes = new Map<string, Remote>();
  private history: PoseFrame[] = [];
  /** Players who left or timed out (reported to the UI once). */
  private gone: string[] = [];

  constructor(readonly sim: GameSimulation, private readonly transport: Transport, setup: MatchSetup, private readonly timeoutMs = CONNECTION_STALE_MS, clock: () => number = () => performance.now()) {
    this.clock = clock;
    this.interval = 1 / netRates(setup.players.length).snapshotHz;
    setup.players.forEach((player, index) => {
      if (player.clientId === transport.clientId) return;
      this.remotes.set(player.clientId, { clientId: player.clientId, actorId: actorIdFor(index), name: player.name, lastSeen: this.clock(), lastSeq: -1, lastCt: 0, lastJumpId: 0, disconnectedAt: null, requestedAt: -Infinity, resumedAt: -Infinity, builder: new SnapshotBuilder(sim, actorIdFor(index)), pending: [], watchId: null, finalSends: 6 });
    });
    transport.onMessage((message, from) => this.receive(message, from));
    transport.onPeerState?.((id, state) => {
      const remote = this.remotes.get(id); if (!remote) return;
      if (state === 'reconnecting') this.suspend(remote);
      else if (state === 'failed') this.drop(remote, 'hết thời gian kết nối lại');
      else if (remote.disconnectedAt !== null) this.requestResume(remote);
    });
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
    if (message.k === 'bye') { this.drop(remote, 'đã thoát'); return; }
    if (remote.disconnectedAt !== null && this.clock() - remote.disconnectedAt >= RECONNECT_GRACE_MS) {
      this.drop(remote, 'hết thời gian kết nối lại'); return;
    }
    if (message.k === 'resume') {
      if (this.clock() - remote.resumedAt < 1000) return;
      remote.resumedAt = this.clock();
      if (remote.disconnectedAt !== null) this.gone.push(`${remote.name} đã kết nối lại`);
      remote.disconnectedAt = null; remote.lastSeen = this.clock();
      this.sim.setReconnecting(remote.actorId, false);
      this.transport.send({ k: 'resume-state', to: from, s: remote.builder.build(remote.pending, true, remote.watchId) });
      remote.pending = [];
      return;
    }
    if (message.k !== 'in') return;
    if (remote.disconnectedAt !== null) { this.requestResume(remote); return; }
    const seq = num(message.seq, -1);
    if (seq <= remote.lastSeq) return;
    remote.lastSeen = this.clock();
    remote.lastSeq = seq;
    remote.lastCt = num(message.ct);
    const sim = this.sim;
    const actor = sim.actorById(remote.actorId);
    if (!actor) return;
    const watched = typeof message.watch === 'string' ? sim.actorById(message.watch) : undefined;
    remote.watchId = !actor.alive && watched?.alive && (watched.isPlayer || sim.humans.some(h => h.alive && Math.hypot(h.position.x - watched.position.x, h.position.z - watched.position.z) < 300)) ? watched.id : null;
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
    const commands = Array.isArray(message.cmds) ? message.cmds.slice(0, 64) : [];
    const fires = Array.isArray(message.fires) ? (message.fires as number[][]).slice(0, 16) : [];
    const seenCommands = new Set<number>(), seenFires = new Set<number>();
    const runCommand = (index: number) => {
      if (index < 0 || index >= commands.length || seenCommands.has(index)) return;
      seenCommands.add(index);
      const cmd = commands[index];
      if (Array.isArray(cmd) && typeof cmd[0] === 'string') this.command(actor.id, cmd[0], cmd[1]);
    };
    const runFire = (index: number) => {
      if (index < 0 || index >= fires.length || seenFires.has(index)) return;
      seenFires.add(index);
      const fire = fires[index];
      if (!Array.isArray(fire)) return;
      const target = { x: num(fire[0]), y: num(fire[1]), z: num(fire[2]) };
      if (Math.hypot(target.x - actor.position.x, target.z - actor.position.z) < 1200) this.shoot(actor, target, fire[3] === 1, fire);
    };
    // Mixed packets preserve the client's action order: nonnegative command index, negative (-1 - fire index).
    for (const index of Array.isArray(message.order) ? message.order.slice(0, 80) : []) {
      if (!Number.isSafeInteger(index)) continue;
      if (index >= 0) runCommand(index); else runFire(-1 - index);
    }
    // Legacy packets, or incomplete order metadata, still execute each bounded action exactly once.
    commands.forEach((_, index) => runCommand(index)); fires.forEach((_, index) => runFire(index));
  }

  /** Remember where everything is, once per frame, for the last second. */
  private record(): void {
    const state = this.sim.state, t = state.elapsed;
    const last = this.history[this.history.length - 1];
    if (last && t - last.t < 1 / 120) return;
    if (last && t < last.t) this.history.length = 0;
    const actors = new Float32Array(state.actors.length * 3);
    state.actors.forEach((actor, i) => { actors[i * 3] = actor.position.x; actors[i * 3 + 1] = actor.position.y; actors[i * 3 + 2] = actor.position.z; });
    const cars = new Float32Array(state.vehicles.length * 4);
    state.vehicles.forEach((car, i) => { cars[i * 4] = car.position.x; cars[i * 4 + 1] = car.position.y; cars[i * 4 + 2] = car.position.z; cars[i * 4 + 3] = car.yaw; });
    this.history.push({ t, actors, cars });
    while (this.history.length > 2 && t - this.history[0].t > 1) this.history.shift();
  }

  /**
   * A shot from a client, judged the way the shooter saw it: everybody else is put back where they were on the
   * shooter's screen (fire[4], the host time it was drawing) and the shooter where they stood (fire[5..7]), then
   * the shot is taken and everything is returned. Without this a moving target is always hit "behind" by the
   * network delay and the interpolation delay.
   */
  private shoot(actor: Actor, target: Vec3, aimed: boolean, fire: number[]): boolean {
    const sim = this.sim, state = sim.state;
    const viewT = fire[4];
    const back = typeof viewT === 'number' && Number.isFinite(viewT) ? Math.min(MAX_REWIND, Math.max(0, state.elapsed - viewT)) : 0;
    const restoreActors: Array<[number, number, number, number]> = [];
    const restoreCars: Array<[number, number, number, number, number]> = [];
    if (back > 0.004 && this.history.length >= 2) {
      const at = state.elapsed - back;
      let i = this.history.length - 1;
      while (i > 0 && this.history[i].t > at) i--;
      const from = this.history[i], to = this.history[Math.min(i + 1, this.history.length - 1)];
      const span = to.t - from.t, k = span > 1e-6 ? Math.min(1, Math.max(0, (at - from.t) / span)) : 0;
      const lerp = (a: Float32Array, b: Float32Array, j: number) => a[j] + (b[j] - a[j]) * k;
      state.actors.forEach((other, index) => {
        if (other === actor || index * 3 + 2 >= from.actors.length) return;
        restoreActors.push([index, other.position.x, other.position.y, other.position.z]);
        other.position.x = lerp(from.actors, to.actors, index * 3); other.position.y = lerp(from.actors, to.actors, index * 3 + 1); other.position.z = lerp(from.actors, to.actors, index * 3 + 2);
      });
      state.vehicles.forEach((car, index) => {
        if (index * 4 + 3 >= from.cars.length) return;
        restoreCars.push([index, car.position.x, car.position.y, car.position.z, car.yaw]);
        car.position.x = lerp(from.cars, to.cars, index * 4); car.position.y = lerp(from.cars, to.cars, index * 4 + 1); car.position.z = lerp(from.cars, to.cars, index * 4 + 2);
        car.yaw = from.cars[index * 4 + 3] + Math.atan2(Math.sin(to.cars[index * 4 + 3] - from.cars[index * 4 + 3]), Math.cos(to.cars[index * 4 + 3] - from.cars[index * 4 + 3])) * k;
      });
    }
    const home = { ...actor.position };
    const claimed = { x: num(fire[5], NaN), y: num(fire[6], NaN), z: num(fire[7], NaN) };
    if (Number.isFinite(claimed.x + claimed.y + claimed.z) && Math.hypot(claimed.x - home.x, claimed.z - home.z) <= SHOOTER_TRUST && Math.abs(claimed.y - home.y) <= 3) {
      actor.position.x = claimed.x; actor.position.y = claimed.y; actor.position.z = claimed.z;
    }
    try {
      return sim.shootPlayer(target, aimed, actor);
    } finally {
      actor.position.x = home.x; actor.position.y = home.y; actor.position.z = home.z;
      for (const [index, x, y, z] of restoreActors) { const other = state.actors[index]; other.position.x = x; other.position.y = y; other.position.z = z; }
      for (const [index, x, y, z, yaw] of restoreCars) { const car = state.vehicles[index]; car.position.x = x; car.position.y = y; car.position.z = z; car.yaw = yaw; }
    }
  }

  private command(actorId: string, command: string, argument: unknown): void {
    const sim = this.sim, actor = sim.actorById(actorId);
    if (!actor) return;
    switch (command) {
      case 'reload': sim.reload(actor); break;
      case 'range-equip': sim.rangeEquip(argument, actor); break;
      case 'range-drill': if (argument === null) sim.stopDrill(actor); else sim.startDrill(argument, actor); break;
      case 'range-immortal': if (sim.rangeMode && typeof argument === 'boolean') sim.setImmortal(argument, actor); break;
      case 'range-reset-vehicles': sim.rangeResetVehicles(actor); break;
      case 'heal': sim.heal(actor); break;
      case 'use': sim.useSupply(argument, actor); break;
      case 'throw': {
        if (!Array.isArray(argument) || argument.length < 4) break;
        const [kind, x, y, z] = argument as unknown[];
        const target = { x: num(x, NaN), y: num(y, NaN), z: num(z, NaN) };
        if (Number.isFinite(target.x + target.y + target.z) && Math.hypot(target.x - actor.position.x, target.z - actor.position.z) < 200) sim.throwGrenade(actor, kind, target);
        break;
      }
      case 'throwsel': sim.cycleThrow(actor, argument); break;
      case 'melee': sim.meleeStrike(actor); break;
      case 'attach': {
        const [kind, weapon] = Array.isArray(argument) ? argument as unknown[] : [argument];
        sim.attachPart(actor, kind, typeof weapon === 'string' ? weapon : actor.weapon);
        break;
      }
      case 'detach': if (Array.isArray(argument) && typeof argument[0] === 'string') sim.detachPart(actor, argument[0], argument[1]); break;
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
      case 'drop-detach': sim.detachDrop(actor); break;
      case 'stairs': sim.useStairs(actor); break;
      case 'switch': sim.switchWeapon(String(argument) as WeaponType, actor); break;
      case 'stance': if (argument === 'stand' || argument === 'crouch' || argument === 'prone') sim.setStance(argument as Stance, actor); break;
    }
  }

  private drop(remote: Remote, why: string): void {
    this.remotes.delete(remote.clientId);
    this.gone.push(`${remote.name} ${why}`);
    const actor = this.sim.actorById(remote.actorId);
    if (actor) this.sim.eliminate(actor.id);
    this.sim.setReconnecting(remote.actorId, false);
    this.transport.forgetPeer?.(remote.clientId);
  }

  private suspend(remote: Remote): void {
    if (remote.disconnectedAt !== null) return;
    remote.disconnectedAt = this.clock();
    this.sim.setReconnecting(remote.actorId, true);
    this.gone.push(`${remote.name} mất kết nối · bảo vệ tối đa 30 giây`);
  }
  private requestResume(remote: Remote): void {
    if (this.clock() - remote.requestedAt < 500) return;
    remote.requestedAt = this.clock();
    this.transport.send({ k: 'resume-needed', to: remote.clientId });
  }

  /** Players that just left (for a message on the host's screen). */
  takeDeparted(): string[] { return this.gone.splice(0); }

  /** Call once per frame after `sim.update`. */
  tick(dt: number): void {
    this.record();
    const now = this.clock();
    for (const remote of [...this.remotes.values()]) {
      if (remote.disconnectedAt === null && now - remote.lastSeen > this.timeoutMs) {
        this.suspend(remote); this.transport.reconnectPeer?.(remote.clientId);
      }
      if (remote.disconnectedAt !== null && now - remote.disconnectedAt >= RECONNECT_GRACE_MS) this.drop(remote, 'hết thời gian kết nối lại');
    }
    // Keep the remainder so the stream holds its rate whatever the frame rate is (resetting to 0 sent ~8 Hz at 60 fps).
    this.since += dt;
    if (this.since < this.interval - 1e-6) return;
    this.since = this.since > this.interval * 3 ? 0 : this.since - this.interval;
    const over = this.sim.state.phase === 'won' || this.sim.state.phase === 'lost';
    const events = this.pending;
    this.pending = [];
    for (const remote of this.remotes.values()) {
      if (over && remote.finalSends <= 0) continue;
      remote.pending.push(...events);
      if (remote.disconnectedAt !== null || this.transport.snapshotReady?.(remote.clientId) === false) {
        // Old shot particles/sounds should not replay after congestion. Durable events stay queued.
        remote.pending = remote.pending.filter(event => event.type !== 'shot');
        continue;
      }
      const snapshot = remote.builder.build(remote.pending, false, remote.watchId);
      if (over) remote.finalSends--;
      remote.pending = [];
      this.transport.send({ k: 'snap', to: remote.clientId, s: snapshot as unknown as Record<string, unknown>, echo: { [remote.clientId]: remote.lastCt } });
    }
  }

  close(): void { this.transport.send({ k: 'closed', why: 'host' }); this.transport.close(); }
}

// ---------------------------------------------------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------------------------------------------------

interface Buffered { at: number; t: number; poses: Map<number, PoseRow>; cars: Map<number, PoseRow> }
interface Trail { at: number; x: number; y: number; z: number; /** The car's heading while driving. */ cy: number }

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
  /** How often and how far the host has had to move the local player (for the debug line and tests). */
  corrections = { count: 0, metres: 0 };
  private arrivals: number[] = [];
  private correctionTimes: number[] = [];
  lastSnapshotAt: number;
  private readonly clock: () => number;
  private buffer: Buffered[] = [];
  private trail: Trail[] = [];
  private events: GameEvent[] = [];
  private seq = 0;
  private lastSend = -Infinity;
  private lastSignature = '';
  private watchId: string | null = null;
  /** Send the camera's actor rather than a client-supplied position; the host validates it. */
  setView(actorId: string | null): void { this.watchId = actorId; }
  private readonly inputInterval: number;
  private readonly snapshotInterval: number;
  /** Host clock (ms) to local clock offset: arrival time minus snapshot time, tracked towards its lower envelope. */
  private clockOffset: number | null = null;
  private excessEma = 0;
  private excessPeak = 0;
  private delay = 0.1;
  private lastFrameAt = 0;
  /** Grenades as the last snapshot had them, and when it arrived: they are flown on from there each frame. */
  private flight: { at: number; list: Projectile[] } = { at: 0, list: [] };
  /** The host time the screen was showing at the last frame: what the player was looking at when they pulled the trigger. */
  private viewT = NaN;
  private lastTickAt = 0;
  /** Part of a reconciliation correction not yet applied to the view. */
  private pending = { x: 0, y: 0, z: 0 };
  private pendingYaw = 0;
  private firedWeapons = new Map<WeaponType, number>();
  private intent: { stance?: { value: string; at: number }; switch?: { value: string; at: number } } = {};
  private fires: number[][] = [];
  private cmds: unknown[][] = [];
  private actionOrder: number[] = [];
  private jumpDown = false;
  private jumpId = 0;
  private lastSnapshotSeq = -1;
  private edge = false;
  private over = false;
  /** Consecutive snapshots that put the local player at an earlier stage of the drop than they predicted. */
  private regressStreak = 0;
  closedByHost = false;
  connectionLost = false;
  private recoveryAt: number | null = null;
  private resumeAt = -Infinity;

  constructor(readonly sim: GameSimulation, private readonly transport: Transport, private readonly hostId: string, clock: () => number = () => performance.now()) {
    this.clock = clock;
    this.lastSnapshotAt = clock();
    const rates = netRates(Math.max(2, sim.humans.length));
    this.inputInterval = 1000 / rates.inputHz;
    this.snapshotInterval = 1 / rates.snapshotHz;
    this.delay = this.snapshotInterval + 0.05;
    transport.onMessage((message, from) => {
      if (from !== hostId) return;
      if (typeof message.to === 'string' && message.to !== transport.clientId) return;
      if (message.k === 'snap') this.snapshot(message.s as unknown as Snapshot, (message.echo as Record<string, number> | undefined)?.[transport.clientId]);
      else if (message.k === 'closed') this.closedByHost = true;
      else if (message.k === 'resume-needed' && message.to === transport.clientId) { this.beginRecovery(); this.sendResume(); }
      else if (message.k === 'resume-state' && message.to === transport.clientId) this.snapshot(message.s as unknown as Snapshot, undefined, true);
    });
    transport.onStatus(status => {
      if (status === 'closed' || status === 'error') this.connectionLost = true;
      else if (status === 'reconnecting') this.beginRecovery();
      else if (status === 'open' && this.recoveryAt !== null) { this.resumeAt = -Infinity; this.sendResume(); }
    });
  }

  drainEvents(): GameEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  /** A shot fired by the local player: the host decides what it hits. */
  queueFire(target: Vec3, aimed: boolean): void {
    if (this.reconnecting || this.connectionLost) return;
    const fire = [Math.round(target.x * 100) / 100, Math.round(target.y * 100) / 100, Math.round(target.z * 100) / 100, aimed ? 1 : 0];
    // Tell the host what this player was looking at and where they stood, so it can judge the shot as they saw it.
    if (Number.isFinite(this.viewT)) { const me = this.sim.player; fire.push(Math.round(this.viewT * 1000) / 1000, Math.round(me.position.x * 100) / 100, Math.round(me.position.y * 100) / 100, Math.round(me.position.z * 100) / 100); }
    this.actionOrder.push(-1 - this.fires.length); this.fires.push(fire);
    this.firedWeapons.set(this.sim.player.weapon, this.clock());
  }
  queueCommand(command: string, argument?: unknown): void {
    if (this.reconnecting || this.connectionLost) return;
    this.actionOrder.push(this.cmds.length); this.cmds.push(argument === undefined ? [command] : [command, argument]);
    // The player's own choice shows at once; snapshots sent before the host heard of it must not undo it.
    if (command === 'stance' || command === 'switch') this.intent[command] = { value: String(argument), at: this.clock() };
    if (command === 'range-equip') this.intent.switch = { value: String(argument), at: this.clock() };
  }

  /** Call once per frame after `sim.update(dt, input)` (which predicted the local movement). */
  tick(nowMs: number, input: PlayerInput, yaw: number): void {
    if (!this.over && this.silence * 1000 > CONNECTION_STALE_MS) this.beginRecovery();
    if (this.recoveryAt !== null) {
      if (nowMs - this.recoveryAt >= RECONNECT_GRACE_MS) this.connectionLost = true;
      else this.sendResume();
      return;
    }
    const me = this.sim.player;
    const dt = this.lastTickAt > 0 ? Math.min(0.1, Math.max(0, (nowMs - this.lastTickAt) / 1000)) : 0;
    this.lastTickAt = nowMs;
    this.bleedCorrection(dt);
    // The trail holds where prediction says the player is, corrections included, even those still being eased in.
    const car = me.vehicleId ? this.sim.state.vehicles.find(v => v.id === me.vehicleId) : undefined;
    this.trail.push({ at: nowMs, x: me.position.x + this.pending.x, y: me.position.y + this.pending.y, z: me.position.z + this.pending.z, cy: (car?.yaw ?? 0) + this.pendingYaw });
    while (this.trail.length > 90) this.trail.shift();
    if (input.jump && !this.jumpDown) { this.edge = true; this.jumpId++; }
    this.jumpDown = input.jump;
    const actions = this.fires.length > 0 || this.cmds.length > 0 || this.edge;
    const signature = `${q(input.moveX)}|${q(input.moveZ)}|${input.sprint ? 1 : 0}|${input.jump ? 1 : 0}|${q(input.throttle ?? 0)}|${q(input.steer ?? 0)}|${round3(yaw)}|${this.watchId ?? ''}`;
    const changed = signature !== this.lastSignature;
    const resting = !me.air && !me.vehicleId && !input.jump && Math.hypot(input.moveX, input.moveZ) < .001;
    const gap = actions ? ACTION_INTERVAL : changed ? CHANGE_INTERVAL : resting ? 250 : this.inputInterval;
    if (nowMs - this.lastSend < gap) return;
    // Keep the phase of the schedule when frames do not line up with it, so 20 Hz stays 20 Hz at 30 fps.
    this.lastSend = nowMs - this.lastSend < gap * 2 ? this.lastSend + gap : nowMs;
    this.lastSignature = signature;
    const packet: NetMessage = {
      k: 'in', seq: ++this.seq, ct: Math.round(nowMs), mx: round3(input.moveX), mz: round3(input.moveZ), sp: input.sprint ? 1 : 0, ju: input.jump ? 1 : 0,
      th: round3(input.throttle ?? 0), st: round3(input.steer ?? 0), yaw: round3(yaw), edge: this.edge ? 1 : 0, jumpId: this.jumpId,
    };
    if (this.watchId && !me.alive) packet.watch = this.watchId;
    if (this.fires.length && this.cmds.length) packet.order = [...this.actionOrder];
    this.actionOrder.length = 0;
    if (this.fires.length) packet.fires = this.fires.splice(0);
    if (this.cmds.length) packet.cmds = this.cmds.splice(0);
    this.edge = false;
    this.transport.send(packet);
  }

  private snapshot(snap: Snapshot, echoCt: number | undefined, resumed = false): void {
    // Network jitter and reconnects can deliver an earlier snapshot after a newer one. Never rewind authoritative state.
    if (!snap || snap.v !== PROTOCOL_VERSION || !Number.isSafeInteger(snap.seq) || snap.seq < 0 || snap.seq <= this.lastSnapshotSeq) return;
    this.lastSnapshotSeq = snap.seq;
    if (resumed) {
      this.recoveryAt = null; this.connectionLost = false;
      this.buffer.length = 0; this.trail.length = 0; this.arrivals.length = 0;
      this.clockOffset = null; this.viewT = NaN; this.intent = {};
      this.pending = { x: 0, y: 0, z: 0 }; this.pendingYaw = 0;
      this.fires.length = 0; this.cmds.length = 0; this.actionOrder.length = 0; this.edge = false; this.jumpDown = false;
      this.firedWeapons.clear(); this.regressStreak = 12; this.lastSignature = '';
    }
    const now = this.clock();
    this.lastSnapshotAt = now;
    this.arrivals.push(now);
    while (this.arrivals.length > 0 && now - this.arrivals[0] > 3000) this.arrivals.shift();
    this.trackClock(now, snap.t);
    if (echoCt) this.rttMs = this.rttMs ? this.rttMs * 0.8 + Math.max(0, now - echoCt) * 0.2 : Math.max(0, now - echoCt);
    // Hold the player's own stance / weapon choice until the host reports the same (or a generous time has passed).
    const grace = Math.max(800, this.rttMs * 2 + 400);
    const holds = (key: 'stance' | 'switch') => { const item = this.intent[key]; if (item && now - item.at > grace) delete this.intent[key]; return !!this.intent[key]; };
    const enteringActors = new Set(snap.a.filter(row => this.sim.state.actors[row[0]]?.netVisible === false).map(row => row[0]));
    const enteringCars = new Set(snap.c.filter(row => this.sim.state.vehicles[row[0]]?.netVisible === false).map(row => row[0]));
    for (const [weapon, at] of this.firedWeapons) if (now - at >= 350) this.firedWeapons.delete(weapon);
    const result = applySnapshot(this.sim, snap, { writePositions: resumed, restoreMotion: resumed, protectAmmo: new Set(this.firedWeapons.keys()), keepFlight: !resumed && this.regressStreak < 12, keepStance: !resumed && holds('stance'), keepWeapon: !resumed && holds('switch'), predictDriving: !resumed });
    const resetLocal = resumed || result.teleports.has(this.sim.state.actors.indexOf(this.sim.player));
    if (resetLocal && result.local) {
      const { x, y, z, yaw } = result.local;
      this.sim.player.position = { x, y, z }; this.sim.player.yaw = yaw;
      this.trail.length = 0; this.intent = {};
      this.firedWeapons.clear();
      this.pending = { x: 0, y: 0, z: 0 }; this.pendingYaw = 0;
    }
    for (const old of this.buffer) {
      for (const index of enteringActors) old.poses.delete(index);
      for (const index of result.teleports) old.poses.delete(index);
      for (const index of enteringCars) old.cars.delete(index);
    }
    if (this.sim.player.reconnecting && !resumed) this.beginRecovery();
    if (result.local) {
      const [, , , , , , flags, weapon] = result.local.row;
      if (this.intent.stance && STANCE_NAMES[(flags >> 5) & 3] === this.intent.stance.value) delete this.intent.stance;
      if (this.intent.switch && WEAPON_ORDER[weapon] === this.intent.switch.value) delete this.intent.switch;
    }
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
    this.flight = { at: now, list: (this.sim.state.projectiles ?? []).map(p => ({ ...p })) };
    while (this.buffer.length > 24) this.buffer.shift();
    if (result.local && !result.flightRegress && !resetLocal) this.reconcile(result.local, echoCt);
    if (result.ownCar && !resetLocal) this.reconcileCar(result.ownCar, echoCt);
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
    if (Math.abs(p.x) + Math.abs(p.y) + Math.abs(p.z) + Math.abs(this.pendingYaw) < 1e-4) { p.x = p.y = p.z = 0; this.pendingYaw = 0; return; }
    const me = this.sim.player;
    if (!me.alive) { p.x = p.y = p.z = 0; this.pendingYaw = 0; return; }
    const car = me.vehicleId ? this.sim.state.vehicles.find(v => v.id === me.vehicleId) : undefined;
    if (me.vehicleId && !car) { p.x = p.y = p.z = 0; this.pendingYaw = 0; return; }
    const share = 1 - Math.exp(-dt * CORRECTION_RATE);
    me.position.x += p.x * share; me.position.y += p.y * share; me.position.z += p.z * share;
    if (car) { car.position.x += p.x * share; car.position.y += p.y * share; car.position.z += p.z * share; car.yaw += this.pendingYaw * share; }
    p.x -= p.x * share; p.y -= p.y * share; p.z -= p.z * share; this.pendingYaw -= this.pendingYaw * share;
  }

  /** Where the prediction trail says the local player was at a client time. */
  private trailAt(at: number): { x: number; y: number; z: number; cy: number } | undefined {
    const trail = this.trail;
    if (trail.length === 0) return undefined;
    if (at <= trail[0].at) return trail[0];
    for (let i = trail.length - 1; i > 0; i--) {
      if (trail[i - 1].at <= at) {
        const from = trail[i - 1], to = trail[i], span = to.at - from.at;
        const k = span > 1e-6 ? Math.min(1, (at - from.at) / span) : 1;
        return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, z: from.z + (to.z - from.z) * k, cy: from.cy + Math.atan2(Math.sin(to.cy - from.cy), Math.cos(to.cy - from.cy)) * k };
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
    const timing = this.inputInterval / 2000 + Math.min(0.025, this.excessPeak / 1000);
    const tolerance = 0.3 + this.sim.motionOf(me).speed * timing;
    if (horizontal < tolerance && Math.abs(dy) < 0.8) return;
    if (horizontal > 8 || Math.abs(dy) > 8) {
      me.position.x += dx + this.pending.x; me.position.y += dy + this.pending.y; me.position.z += dz + this.pending.z;
      this.pending = { x: 0, y: 0, z: 0 };
      for (const item of this.trail) { item.x += dx; item.y += dy; item.z += dz; }
      return;
    }
    const share = 0.7;
    this.corrections.count++; this.corrections.metres += horizontal * share;
    this.correctionTimes.push(this.clock());
    while (this.correctionTimes.length > 0 && this.clock() - this.correctionTimes[0] > 10000) this.correctionTimes.shift();
    this.pending.x += dx * share; this.pending.y += dy * share; this.pending.z += dz * share;
    for (const item of this.trail) { item.x += dx * share; item.y += dy * share; item.z += dz * share; }
  }

  /** The same idea for the car the local player drives: the host's car against where prediction had it, eased in. */
  private reconcileCar(truth: { x: number; y: number; z: number; yaw: number; speed: number }, echoCt: number | undefined): void {
    const me = this.sim.player;
    const car = this.sim.state.vehicles.find(v => v.id === me.vehicleId);
    if (!car || !me.alive) return;
    const then = echoCt ? this.trailAt(echoCt + this.inputInterval / 2) : undefined;
    const ref = then ? { x: then.x, y: then.y - 0.3, z: then.z, yaw: then.cy } : { x: car.position.x + this.pending.x, y: car.position.y + this.pending.y, z: car.position.z + this.pending.z, yaw: car.yaw + this.pendingYaw };
    const dx = truth.x - ref.x, dy = truth.y - ref.y, dz = truth.z - ref.z;
    const dyaw = Math.atan2(Math.sin(truth.yaw - ref.yaw), Math.cos(truth.yaw - ref.yaw));
    const horizontal = Math.hypot(dx, dz);
    const tolerance = 0.5 + Math.abs(car.speed) * this.inputInterval / 2000;
    if (horizontal < tolerance && Math.abs(dyaw) < 0.06 && Math.abs(dy) < 1) return;
    if (horizontal > 12) {
      car.position.x += dx + this.pending.x; car.position.y += dy + this.pending.y; car.position.z += dz + this.pending.z;
      car.yaw += dyaw + this.pendingYaw; car.speed = truth.speed;
      me.position = { x: car.position.x, y: car.position.y + 0.3, z: car.position.z };
      this.pending = { x: 0, y: 0, z: 0 }; this.pendingYaw = 0;
      for (const item of this.trail) { item.x += dx; item.y += dy; item.z += dz; item.cy += dyaw; }
      return;
    }
    const share = 0.5;
    this.pending.x += dx * share; this.pending.y += dy * share; this.pending.z += dz * share; this.pendingYaw += dyaw * share;
    // A real disagreement (a bump the client did not feel) also means the speed was wrong.
    if (horizontal > tolerance * 2) car.speed += (truth.speed - car.speed) * 0.3;
    for (const item of this.trail) { item.x += dx * share; item.y += dy * share; item.z += dz * share; item.cy += dyaw * share; }
  }

  /** Call every frame before drawing: place everybody else where they were a moment ago, blended between snapshots. */
  frame(nowMs: number): void {
    // A grenade moves smoothly between snapshots: carry each on along the velocity it was thrown with.
    if (this.flight.list.length) {
      const t = Math.min(0.25, Math.max(0, (nowMs - this.flight.at) / 1000));
      this.sim.state.projectiles = this.flight.list.map(p => {
        const x = p.x + p.vx * t, z = p.z + p.vz * t;
        const gravity = projectileGravity(p.kind), y = p.y + p.vy * t - gravity * t * t / 2;
        const ground = this.sim.supportHeight(x, z, Math.max(p.y, y) + .2) + .12;
        return { ...p, x, z, y: Math.max(ground, y), vy: y <= ground ? 0 : p.vy - gravity * t };
      });
    }
    const latest = this.buffer[this.buffer.length - 1];
    if (!latest || this.clockOffset === null) return;
    const dt = this.lastFrameAt > 0 ? Math.min(0.25, Math.max(0, (nowMs - this.lastFrameAt) / 1000)) : 0;
    this.lastFrameAt = nowMs;
    // Follow the target delay gently: widening is quick (a stall is coming), narrowing is slow so the world does not lurch.
    const target = this.targetDelay();
    this.delay = target > this.delay ? Math.min(target, this.delay + 0.25 * dt) : Math.max(target, this.delay - 0.05 * dt);
    const renderT = (nowMs - this.clockOffset) / 1000 - this.delay;
    this.viewT = renderT;
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
      if (!actor || actor.netVisible === false) continue;
      place(actor, from, newer.poses.get(index) ?? from);
    }
    const driver = this.sim.player;
    this.sim.state.vehicles.forEach((car, index) => {
      if (car.netVisible === false) return;
      // The car the local player drives is predicted, not drawn from the past.
      if (driver.vehicleId === car.id && car.driverId === driver.id) return;
      const from = older.cars.get(index);
      if (!from) return;
      place(car, from, newer.cars.get(index) ?? from);
    });
    // Driving: the local player sits in the car.
    const me = this.sim.player;
    const ride = me.vehicleId ? this.sim.state.vehicles.find(car => car.id === me.vehicleId) : undefined;
    if (ride) { me.position = { x: ride.position.x, y: ride.position.y + 0.3, z: ride.position.z }; me.yaw = ride.yaw; }
  }

  /** For the on-screen readout: what the connection is doing right now. */
  netStats(): { rttMs: number; snapshotsPerSecond: number; jitterMs: number; delayMs: number; correctionsPer10s: number; silenceMs: number } {
    const now = this.clock();
    const recent = this.arrivals.filter(at => now - at <= 3000);
    return {
      rttMs: this.rttMs, snapshotsPerSecond: recent.length / 3, jitterMs: this.excessPeak, delayMs: this.delay * 1000,
      correctionsPer10s: this.correctionTimes.filter(at => now - at <= 10000).length, silenceMs: now - this.lastSnapshotAt,
    };
  }

  /** Seconds since the host last sent anything. */
  get silence(): number { return (this.clock() - this.lastSnapshotAt) / 1000; }
  get reconnecting(): boolean { return this.recoveryAt !== null || (!this.over && this.silence * 1000 > CONNECTION_STALE_MS); }
  get reconnectSeconds(): number { return Math.max(0, Math.ceil((RECONNECT_GRACE_MS - (this.clock() - (this.recoveryAt ?? this.lastSnapshotAt + CONNECTION_STALE_MS))) / 1000)); }
  private beginRecovery(): void {
    if (this.recoveryAt !== null) return;
    this.recoveryAt = this.clock(); this.resumeAt = -Infinity;
    this.fires.length = 0; this.cmds.length = 0; this.actionOrder.length = 0; this.firedWeapons.clear(); this.edge = false; this.intent = {};
    this.transport.reconnectPeer?.(this.hostId);
  }
  private sendResume(): void {
    if (this.clock() - this.resumeAt < 1000) return;
    this.resumeAt = this.clock(); this.transport.send({ k: 'resume' });
  }
  get matchOver(): boolean { return this.over; }

  leave(): void { this.transport.send({ k: 'bye' }); this.transport.close(); }
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
/** Quarter steps: enough to notice that somebody started, stopped or turned. */
const q = (n: number) => Math.round(n * 4);
