/**
 * Gyroscope aiming for phones: turning the phone turns the camera, on top of the touch swipe.
 *
 * Rotation rates come from the `devicemotion` event (degrees per second about the device's x, y and z axes). Yaw is
 * measured about the gravity axis rather than a fixed device axis, so the aim turns the same way however the phone is
 * tilted; pitch is the rotation about the screen's own horizontal axis.
 */
import type { GyroMode } from './types';
export type { GyroMode };
/** `insecure`: browsers only deliver motion events to pages served over HTTPS (or localhost). */
export type GyroStatus = 'off' | 'unsupported' | 'insecure' | 'waiting' | 'denied' | 'active';

export interface Vec3 { x: number; y: number; z: number }
/** `DeviceMotionEvent.rotationRate`: alpha about z, beta about x, gamma about y, in degrees per second. */
export interface RotationRate { alpha: number; beta: number; gamma: number }

const DEG = Math.PI / 180;
/** Slower than this is sensor noise, not a hand. */
const DEAD_ZONE = 0.35;

/** Screen "up" and "right" as unit vectors in the device's own axes, for each screen rotation. */
function screenAxes(angle: number): { up: Vec3; right: Vec3 } {
  switch (((Math.round(angle / 90) % 4) + 4) % 4) {
    case 1: return { up: { x: 1, y: 0, z: 0 }, right: { x: 0, y: -1, z: 0 } };
    case 2: return { up: { x: 0, y: -1, z: 0 }, right: { x: -1, y: 0, z: 0 } };
    case 3: return { up: { x: -1, y: 0, z: 0 }, right: { x: 0, y: 1, z: 0 } };
    default: return { up: { x: 0, y: 1, z: 0 }, right: { x: 1, y: 0, z: 0 } };
  }
}

const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;

/**
 * The world's "up" in device axes from an accelerometer reading, or null when the reading is unusable. Android and
 * iOS have disagreed on the sign of `accelerationIncludingGravity`, so the sign is fixed by how a phone is actually
 * held: screen roughly upright or tilted back, which puts "up" along screen-up and out of the screen.
 */
export function upFromGravity(gravity: Vec3 | null, angle: number): Vec3 | null {
  if (!gravity) return null;
  const length = Math.hypot(gravity.x, gravity.y, gravity.z);
  if (!Number.isFinite(length) || length < 3) return null;
  let up = { x: gravity.x / length, y: gravity.y / length, z: gravity.z / length };
  if (dot(up, screenAxes(angle).up) + 0.5 * up.z < 0) up = { x: -up.x, y: -up.y, z: -up.z };
  return up;
}

/**
 * Camera turn from one motion sample, in radians: positive yaw turns right, positive pitch looks up. `dt` is the time
 * the rate was held, in seconds.
 */
export function gyroLook(rate: RotationRate, gravity: Vec3 | null, angle: number, dt: number): { yaw: number; pitch: number } {
  if (![rate.alpha, rate.beta, rate.gamma, dt].every(Number.isFinite) || dt <= 0) return { yaw: 0, pitch: 0 };
  const axes = screenAxes(angle);
  const omega = { x: rate.beta * DEG, y: rate.gamma * DEG, z: rate.alpha * DEG };
  const up = upFromGravity(gravity, angle) ?? axes.up;
  const yawRate = -dot(omega, up);
  const pitchRate = dot(omega, axes.right);
  const dead = DEAD_ZONE * DEG;
  return {
    yaw: Math.abs(yawRate) < dead ? 0 : yawRate * dt,
    pitch: Math.abs(pitchRate) < dead ? 0 : pitchRate * dt,
  };
}

/** What the page can do right now, before asking for any permission. */
export function gyroSupport(): 'ok' | 'unsupported' | 'insecure' {
  if (typeof window === 'undefined' || !('DeviceMotionEvent' in window)) return 'unsupported';
  return window.isSecureContext === false ? 'insecure' : 'ok';
}

type PermissionedMotionEvent = typeof DeviceMotionEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };

/** Listens to the phone's motion sensors and reports camera turns. Start it from a tap: iOS asks for permission then. */
export class Gyro {
  status: GyroStatus = 'off';
  private listening = false;
  private lastTime = 0;
  private gravity: Vec3 | null = null;

  constructor(private readonly onLook: (yaw: number, pitch: number) => void, private readonly onStatus: (status: GyroStatus) => void = () => {}) {}

  private setStatus(status: GyroStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.onStatus(status);
  }

  /** Begin listening. Call this directly from a tap or click handler; later calls while running do nothing. */
  async enable(): Promise<GyroStatus> {
    if (this.listening) return this.status;
    const support = gyroSupport();
    if (support !== 'ok') { this.setStatus(support); return this.status; }
    const motion = window.DeviceMotionEvent as PermissionedMotionEvent;
    if (typeof motion.requestPermission === 'function') {
      try {
        if (await motion.requestPermission() !== 'granted') { this.setStatus('denied'); return this.status; }
      } catch { this.setStatus('denied'); return this.status; }
    }
    window.addEventListener('devicemotion', this.handle);
    this.listening = true;
    this.lastTime = 0;
    this.gravity = null;
    // Stays "waiting" until a sample with real rotation data arrives: desktops fire one empty event.
    this.setStatus('waiting');
    return this.status;
  }

  disable(): void {
    if (this.listening) window.removeEventListener('devicemotion', this.handle);
    this.listening = false;
    this.setStatus('off');
  }

  private screenAngle(): number {
    return screen.orientation?.angle ?? (window as { orientation?: number }).orientation ?? 0;
  }

  private handle = (event: DeviceMotionEvent): void => {
    const rate = event.rotationRate;
    if (!rate || rate.alpha === null || rate.beta === null || rate.gamma === null) return;
    const now = performance.now();
    const dt = this.lastTime ? Math.min(0.05, Math.max(0.001, (now - this.lastTime) / 1000)) : 0;
    this.lastTime = now;
    const g = event.accelerationIncludingGravity;
    if (g && g.x !== null && g.y !== null && g.z !== null) {
      // Smooth the accelerometer: hand shake and the shot itself would otherwise tilt the "up" axis.
      this.gravity = this.gravity
        ? { x: this.gravity.x * 0.9 + g.x * 0.1, y: this.gravity.y * 0.9 + g.y * 0.1, z: this.gravity.z * 0.9 + g.z * 0.1 }
        : { x: g.x, y: g.y, z: g.z };
    }
    this.setStatus('active');
    if (!dt) return;
    const look = gyroLook({ alpha: rate.alpha, beta: rate.beta, gamma: rate.gamma }, this.gravity, this.screenAngle(), dt);
    if (look.yaw || look.pitch) this.onLook(look.yaw, look.pitch);
  };
}

export const GYRO_STATUS_TEXT: Record<GyroStatus, string> = {
  off: 'Tắt: chỉ dùng vuốt màn hình để ngắm.',
  unsupported: 'Thiết bị hoặc trình duyệt này không có cảm biến chuyển động.',
  insecure: 'Cần mở game bằng HTTPS (hoặc localhost): trình duyệt chặn cảm biến trên địa chỉ http thường.',
  waiting: 'Đang chờ cảm biến… hãy xoay nhẹ điện thoại.',
  denied: 'Chưa được cấp quyền cảm biến. Cho phép trong cài đặt trình duyệt rồi tải lại trang.',
  active: 'Đang hoạt động: xoay điện thoại để chỉnh tâm ngắm.',
};
