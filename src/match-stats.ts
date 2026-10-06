/**
 * What happened to the local player during a match, for the statistics screen: the route they took, where they got their
 * kills and where they fell, and how every weapon did. Fed from the same events the game already shows, so it works the same
 * in a solo match and online.
 */
import type { GameEvent } from './types';
import { WEAPONS } from './game/weapons';
import { MELEE } from './game/melee';

/** How the player was moving when a point of the route was recorded. */
export type RouteMode = 'foot' | 'car' | 'air' | 'under';
export interface RoutePoint { t: number; x: number; z: number; mode: RouteMode }
export interface KillMark { t: number; x: number; z: number; weapon: string; distance: number; head: boolean; victim: string }
export interface DeathMark { t: number; x: number; z: number; killer: string; cause: string }
export interface WeaponLine { weapon: string; shots: number; hits: number; heads: number; damage: number; kills: number }

export interface MatchSummary {
  route: RoutePoint[]; kills: KillMark[]; death: DeathMark | null;
  weapons: WeaponLine[];
  dealt: number; taken: number; headshots: number; longest: number;
  /** Distance covered on foot and by car, in metres. */
  walked: number; driven: number;
}

/** What the recorder needs to know about the match from outside. */
export interface StatsContext { localId: string; /** The match clock now. */ t: number; nameOf(id: string): string }

const ROUTE_INTERVAL = 2;

/** Is this cause one of the guns (as opposed to a grenade, a vehicle, a fist...)? */
const isGun = (cause: string) => Object.hasOwn(WEAPONS, cause);

export class MatchStats {
  private lines = new Map<string, WeaponLine>();
  private route: RoutePoint[] = [];
  private kills: KillMark[] = [];
  private death: DeathMark | null = null;
  private dealt = 0; private taken = 0; private headshots = 0; private longest = 0;
  private lastSample = -Infinity;
  /** Who last hurt the player and with what, in case the kill event does not say. */
  private lastBlow: { source: string; cause: string } | null = null;

  reset(): void {
    this.lines.clear(); this.route = []; this.kills = []; this.death = null;
    this.dealt = this.taken = this.headshots = this.longest = 0;
    this.lastSample = -Infinity; this.lastBlow = null;
  }

  private line(weapon: string): WeaponLine {
    let line = this.lines.get(weapon);
    if (!line) { line = { weapon, shots: 0, hits: 0, heads: 0, damage: 0, kills: 0 }; this.lines.set(weapon, line); }
    return line;
  }

  /** Call every frame while the player is alive: a point on the route every couple of seconds (and the last one when it ends). */
  sample(t: number, at: { x: number; z: number }, mode: RouteMode): void {
    if (t - this.lastSample < ROUTE_INTERVAL && this.route.length > 0) return;
    this.lastSample = t;
    this.route.push({ t, x: Math.round(at.x * 10) / 10, z: Math.round(at.z * 10) / 10, mode });
  }

  /** Close the route at the exact place and time the player stopped (dying, winning). */
  finish(t: number, at: { x: number; z: number }, mode: RouteMode): void {
    const last = this.route[this.route.length - 1];
    if (!last || last.t < t - 0.01) this.route.push({ t, x: at.x, z: at.z, mode });
  }

  event(event: GameEvent, ctx: StatsContext): void {
    const me = ctx.localId;
    switch (event.type) {
      case 'shot':
        if (event.actorId === me) { const line = this.line(event.weapon); line.shots++; if (event.hitId) line.hits++; }
        break;
      case 'melee':
        if (event.actorId === me) { const line = this.line(event.weapon); line.shots++; if (event.hitId) line.hits++; }
        break;
      case 'throw':
        if (event.actorId === me) this.line(event.kind).shots++;
        break;
      case 'damage':
        if (event.sourceId === me && event.actorId !== me) {
          this.dealt += event.amount;
          const cause = event.cause ?? 'khác';
          const line = this.line(cause);
          line.damage += event.amount;
          if (event.head) { line.heads++; this.headshots++; }
          // Guns count their hits from the shot itself; everything else counts when it connects.
          if (!isGun(cause) && cause !== 'fists' && !Object.hasOwn(MELEE, cause)) line.hits++;
        }
        if (event.actorId === me) {
          this.taken += event.amount;
          if (event.sourceId) this.lastBlow = { source: event.sourceId, cause: event.cause ?? '' };
        }
        break;
      case 'kill':
        if (event.killerId === me && event.actorId !== me) {
          const cause = event.cause ?? 'khác';
          this.line(cause).kills++;
          const at = event.at ?? { x: 0, y: 0, z: 0 }, from = event.from ?? at;
          const distance = Math.hypot(at.x - from.x, at.z - from.z);
          this.longest = Math.max(this.longest, distance);
          this.kills.push({ t: ctx.t, x: at.x, z: at.z, weapon: cause, distance, head: !!event.head, victim: ctx.nameOf(event.actorId) });
        }
        if (event.actorId === me && !this.death) {
          const at = event.at ?? { x: 0, z: 0 };
          const killerId = event.killerId ?? this.lastBlow?.source;
          this.death = { t: ctx.t, x: at.x, z: at.z, killer: killerId ? ctx.nameOf(killerId) : 'Vòng bo', cause: event.cause ?? this.lastBlow?.cause ?? (killerId ? '' : 'zone') };
        }
        break;
      default:
        break;
    }
  }

  summary(): MatchSummary {
    let walked = 0, driven = 0;
    for (let i = 1; i < this.route.length; i++) {
      const a = this.route[i - 1], b = this.route[i];
      if (b.mode === 'air' || a.mode === 'air') continue;
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      if (b.mode === 'car') driven += d; else walked += d;
    }
    const weapons = [...this.lines.values()].sort((a, b) => b.damage - a.damage || b.shots - a.shots);
    return { route: [...this.route], kills: [...this.kills], death: this.death, weapons, dealt: this.dealt, taken: this.taken, headshots: this.headshots, longest: this.longest, walked, driven };
  }
}
