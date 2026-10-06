/** The kinds of vehicle and how each drives: a closed car, a quick motorbike that leaves its rider exposed, an open buggy. */
export type VehicleKind = 'car' | 'bike' | 'buggy';
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
};
/** Which kind waits at the n-th parking spot: mostly cars, with bikes and buggies sprinkled in. */
export function vehicleKindFor(index: number): VehicleKind {
  return index % 7 === 3 ? 'bike' : index % 5 === 1 ? 'buggy' : 'car';
}
export const kindOf = (vehicle: { kind?: VehicleKind }): VehicleKind => vehicle.kind ?? 'car';
