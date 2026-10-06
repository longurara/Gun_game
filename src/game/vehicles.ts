/**
 * The kinds of vehicle and how each drives. Closed ones (car, coupe, pickup, van, minibus) shield the driver; open ones
 * (motorbike, scooter, sidecar, quad, buggy, jeep, tuk-tuk) leave them exposed. Bigger vehicles take more punishment
 * and turn wider; lighter ones are quicker off the line and more fragile.
 */
export type VehicleKind = 'car' | 'bike' | 'buggy' | 'jeep' | 'pickup' | 'van' | 'minibus' | 'coupe' | 'scooter' | 'quad' | 'tuktuk' | 'sidecar';
export interface VehicleStats {
  label: string; health: number; /** Collision radius in metres. */ radius: number;
  maxForward: number; maxReverse: number; /** Speed gained per second under full throttle. */ accel: number;
  /** Steering lock (radians at a standstill) and wheelbase (metres). */ lock: number; wheelbase: number;
  /** True when the driver can be shot (nothing closes them in). */ exposed: boolean;
  /** Crash speed above which the driver is hurt. */ hurtAt: number;
}
export const VEHICLES: Record<VehicleKind, VehicleStats> = {
  car: { label: 'Ô tô', health: 300, radius: 1.7, maxForward: 30, maxReverse: 9, accel: 9, lock: 0.6, wheelbase: 2.9, exposed: false, hurtAt: 9 },
  bike: { label: 'Xe máy', health: 140, radius: 0.95, maxForward: 37, maxReverse: 6, accel: 14, lock: 0.85, wheelbase: 1.5, exposed: true, hurtAt: 6 },
  buggy: { label: 'Xe địa hình', health: 220, radius: 1.45, maxForward: 27, maxReverse: 8, accel: 11, lock: 0.72, wheelbase: 2.4, exposed: true, hurtAt: 8 },
  jeep: { label: 'Xe jeep', health: 260, radius: 1.6, maxForward: 26, maxReverse: 8, accel: 10, lock: 0.62, wheelbase: 2.6, exposed: true, hurtAt: 8 },
  pickup: { label: 'Xe bán tải', health: 340, radius: 1.85, maxForward: 28, maxReverse: 8, accel: 8, lock: 0.55, wheelbase: 3.2, exposed: false, hurtAt: 9 },
  van: { label: 'Xe van', health: 380, radius: 2.0, maxForward: 25, maxReverse: 7, accel: 6.5, lock: 0.5, wheelbase: 3.4, exposed: false, hurtAt: 9 },
  minibus: { label: 'Xe buýt mini', health: 440, radius: 2.2, maxForward: 22, maxReverse: 6, accel: 5, lock: 0.45, wheelbase: 4.0, exposed: false, hurtAt: 10 },
  coupe: { label: 'Xe thể thao', health: 220, radius: 1.6, maxForward: 42, maxReverse: 8, accel: 12, lock: 0.55, wheelbase: 2.7, exposed: false, hurtAt: 8 },
  scooter: { label: 'Xe tay ga', health: 90, radius: 0.8, maxForward: 24, maxReverse: 5, accel: 9, lock: 0.9, wheelbase: 1.2, exposed: true, hurtAt: 5 },
  quad: { label: 'Xe 4 bánh', health: 160, radius: 1.05, maxForward: 30, maxReverse: 7, accel: 12, lock: 0.8, wheelbase: 1.4, exposed: true, hurtAt: 6 },
  tuktuk: { label: 'Xe lam', health: 130, radius: 1.25, maxForward: 18, maxReverse: 5, accel: 7, lock: 0.8, wheelbase: 1.8, exposed: true, hurtAt: 6 },
  sidecar: { label: 'Xe máy thùng', health: 200, radius: 1.25, maxForward: 34, maxReverse: 6, accel: 12, lock: 0.7, wheelbase: 1.9, exposed: true, hurtAt: 7 },
};

/**
 * The upright box a shot has to hit to hit the vehicle: half the width, half the length, and the heights above the ground it
 * covers. A closed vehicle is tall; an open one is low, so the rider sits above it and can be hit.
 */
export const HULLS: Record<VehicleKind, { half: number; length: number; low: number; high: number }> = {
  car: { half: 0.95, length: 2.1, low: 0.25, high: 1.7 },
  bike: { half: 0.35, length: 1.0, low: 0.15, high: 0.95 },
  buggy: { half: 0.8, length: 1.3, low: 0.25, high: 0.95 },
  jeep: { half: 0.9, length: 1.8, low: 0.25, high: 1.0 },
  pickup: { half: 0.95, length: 2.3, low: 0.25, high: 1.6 },
  van: { half: 1.0, length: 2.4, low: 0.25, high: 2.1 },
  minibus: { half: 1.15, length: 3.0, low: 0.3, high: 2.3 },
  coupe: { half: 0.9, length: 2.0, low: 0.2, high: 1.3 },
  scooter: { half: 0.3, length: 0.8, low: 0.15, high: 0.9 },
  quad: { half: 0.6, length: 0.9, low: 0.2, high: 0.85 },
  tuktuk: { half: 0.75, length: 1.2, low: 0.25, high: 1.0 },
  sidecar: { half: 0.75, length: 1.15, low: 0.15, high: 0.95 },
};

/** The vehicles that wait at parking spots, in the order a spot's index picks them: mostly everyday cars, with the rest sprinkled in. */
const EVERYDAY: readonly VehicleKind[] = ['car', 'car', 'car', 'jeep', 'pickup', 'van', 'coupe', 'scooter', 'quad', 'tuktuk', 'sidecar'];

/** Which kind waits at the n-th parking spot (the same on every machine, so the kind never has to travel over the network). */
export function vehicleKindFor(index: number): VehicleKind {
  if (index % 7 === 3) return 'bike';
  if (index % 5 === 1) return 'buggy';
  if (index % 17 === 5) return 'minibus';
  return EVERYDAY[index % EVERYDAY.length];
}
export const kindOf = (vehicle: { kind?: VehicleKind }): VehicleKind => vehicle.kind ?? 'car';
