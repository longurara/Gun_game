import type { Stance } from './types';

/** What the replay needs to redraw one soldier at one moment. */
export interface ReplayActor { id: string; x: number; y: number; z: number; yaw: number; stance?: Stance; weapon: string; vehicleId?: string | null }
export interface ReplayFrame { t: number; actors: ReplayActor[] }
export interface ReplayShot { t: number; actorId: string; from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number } }

/** How much of the match's end is kept, and how often a frame is recorded. */
export const REPLAY_SECONDS = 8;
export const REPLAY_INTERVAL = 0.1;

/** A rolling record of the last few seconds: positions of everybody nearby and the shots fired. */
export class ReplayRecorder {
  frames: ReplayFrame[] = [];
  shots: ReplayShot[] = [];
  private last = -Infinity;

  clear(): void { this.frames = []; this.shots = []; this.last = -Infinity; }

  /** Record a frame if one is due; `snapshot` is only called when it is. */
  frame(t: number, snapshot: () => ReplayActor[]): void {
    if (t - this.last < REPLAY_INTERVAL) return;
    this.last = t;
    this.frames.push({ t, actors: snapshot() });
    while (this.frames.length > 1 && t - this.frames[0].t > REPLAY_SECONDS) this.frames.shift();
    while (this.shots.length && t - this.shots[0].t > REPLAY_SECONDS + 1) this.shots.shift();
  }

  shot(shot: ReplayShot): void { this.shots.push(shot); }

  get duration(): number { return this.frames.length > 1 ? this.frames[this.frames.length - 1].t - this.frames[0].t : 0; }
  /** Enough to be worth watching: at least two seconds with the killer in the last frame. */
  playable(killerId: string | null): boolean {
    if (!killerId || this.duration < 2) return false;
    return this.frames[this.frames.length - 1].actors.some(actor => actor.id === killerId);
  }
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const lerpAngle = (a: number, b: number, k: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

/** Everybody's pose at replay time `time` (seconds after the first frame), blending the two frames around it. */
export function sampleReplay(frames: readonly ReplayFrame[], time: number): ReplayActor[] {
  if (!frames.length) return [];
  const start = frames[0].t;
  const t = start + Math.max(0, Math.min(time, frames[frames.length - 1].t - start));
  let index = 0;
  while (index < frames.length - 2 && frames[index + 1].t <= t) index++;
  const a = frames[index], b = frames[Math.min(index + 1, frames.length - 1)];
  const k = b.t > a.t ? Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))) : 0;
  const later = new Map(b.actors.map(actor => [actor.id, actor]));
  return a.actors.map(actor => {
    const next = later.get(actor.id);
    if (!next) return actor;
    return {
      ...actor, x: lerp(actor.x, next.x, k), y: lerp(actor.y, next.y, k), z: lerp(actor.z, next.z, k), yaw: lerpAngle(actor.yaw, next.yaw, k),
      stance: k < 0.5 ? actor.stance : next.stance, weapon: k < 0.5 ? actor.weapon : next.weapon, vehicleId: k < 0.5 ? actor.vehicleId : next.vehicleId,
    };
  });
}

/** Shots fired in the window (from, to] of replay time, so each is shown exactly once as the replay plays. */
export function shotsBetween(shots: readonly ReplayShot[], frames: readonly ReplayFrame[], from: number, to: number): ReplayShot[] {
  if (!frames.length) return [];
  const start = frames[0].t;
  return shots.filter(shot => shot.t - start > from && shot.t - start <= to);
}
