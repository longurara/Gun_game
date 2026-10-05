import type { Stance } from '../types';
import { STANCE } from './stance';

/**
 * Weapon recoil as the player feels it in a battle royale: each shot kicks the aim up and to a side that follows a
 * pattern particular to the gun; while firing the kick stacks, and after firing the aim drifts back by whatever the
 * player has not already pulled down by hand. The "bank" is the kick that has not yet been recovered or countered.
 */
export interface RecoilBank {
  /** Outstanding kick in radians: pitch positive = aim raised, yaw positive = aim turned right. */
  pitch: number; yaw: number;
  /** Shots in the current burst, and seconds since the last one. */
  shots: number; idle: number;
}

export const newBank = (): RecoilBank => ({ pitch: 0, yaw: 0, shots: 0, idle: 1 });

/** Radians of kick per unit of a gun's `recoil` rating. */
const KICK_SCALE = 2.3;
const MAX_PITCH = 0.5;
const MAX_YAW = 0.26;

export interface RecoilGun { id: string; recoil: number; fireInterval: number }
export interface RecoilContext {
  aiming: boolean; stance: Stance;
  /** 0 standing still … 1 walking at full speed (more shake while moving). */
  moving: number;
  /** The player's setting: 1 is the full pattern, lower is gentler. */
  scale: number;
}

/** A number in [0, 1) that is the same for the same text, so a gun always has the same pattern. */
function hash01(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Seconds without a shot after which the next one starts a fresh burst. */
export const burstReset = (gun: RecoilGun): number => Math.max(0.35, gun.fireInterval * 2.2);

/**
 * Register a shot: returns the kick to add to the view (radians) and adds it to the bank. The first shot of a burst
 * is clean; later shots climb a little more each time and sway along the gun's own pattern.
 */
export function kick(bank: RecoilBank, gun: RecoilGun, context: RecoilContext, random: () => number = Math.random): { pitch: number; yaw: number } {
  if (bank.idle > burstReset(gun)) bank.shots = 0;
  const index = bank.shots++;
  bank.idle = 0;
  const steady = (context.aiming ? 0.7 : 1) * STANCE[context.stance].recoil * (1 + 0.3 * Math.max(0, Math.min(1, context.moving)));
  const base = gun.recoil * KICK_SCALE * context.scale * steady;
  // PUBG-style: the first bullet is clean, then the muzzle climbs harder the longer the burst runs.
  const climb = 1 + Math.min(index, 12) * 0.06;
  const phase = hash01(gun.id) * Math.PI * 2;
  const lean = hash01(`${gun.id}:lean`) < 0.5 ? -1 : 1;
  const pitch = base * climb * (0.96 + random() * 0.08);
  // Mostly a fixed sway along the gun's own pattern (so it can be learned and pulled against) with a drift toward
  // one side as the burst goes on and only a little noise on top.
  const yaw = base * (0.6 * Math.sin(index * 0.85 + phase) + 0.22 * lean * Math.min(index, 10) / 10 + (random() - 0.5) * 0.1);
  const appliedPitch = Math.max(0, Math.min(MAX_PITCH - bank.pitch, pitch));
  const appliedYaw = Math.max(-MAX_YAW - bank.yaw, Math.min(MAX_YAW - bank.yaw, yaw));
  bank.pitch += appliedPitch;
  bank.yaw += appliedYaw;
  return { pitch: appliedPitch, yaw: appliedYaw };
}

/** The player moved the aim by hand: whatever they pulled against the kick no longer needs recovering. */
export function counter(bank: RecoilBank, dPitch: number, dYaw: number): void {
  if (bank.pitch > 0 && dPitch < 0) bank.pitch = Math.max(0, bank.pitch + dPitch);
  else if (bank.pitch < 0 && dPitch > 0) bank.pitch = Math.min(0, bank.pitch + dPitch);
  if (bank.yaw > 0 && dYaw < 0) bank.yaw = Math.max(0, bank.yaw + dYaw);
  else if (bank.yaw < 0 && dYaw > 0) bank.yaw = Math.min(0, bank.yaw + dYaw);
}

/**
 * Let the aim drift back after firing. Returns how much to add to the view (the opposite sign of the bank). While a
 * burst is still going the aim barely recovers, so the kick stacks; once the burst ends it settles in under a second.
 */
export function recover(bank: RecoilBank, gun: RecoilGun | null, dt: number): { pitch: number; yaw: number } {
  bank.idle += dt;
  const bursting = gun !== null && bank.idle < burstReset(gun);
  const rate = bursting ? 0.5 : 5.5;
  const share = 1 - Math.exp(-rate * dt);
  const pitch = -bank.pitch * share, yaw = -bank.yaw * share;
  bank.pitch += pitch;
  bank.yaw += yaw;
  if (Math.abs(bank.pitch) < 1e-5) bank.pitch = 0;
  if (Math.abs(bank.yaw) < 1e-5) bank.yaw = 0;
  return { pitch, yaw };
}
