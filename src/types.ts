export interface Vec2 { x: number; z: number }
export interface Vec3 extends Vec2 { y: number }
/** Id of a gun in the arsenal (src/game/arsenal.ts). */
export type WeaponType = string;
/** Handling class of a gun: sets its baseline stats, sound and which slot it takes. */
export type WeaponClass = 'pistol' | 'smg' | 'ar' | 'br' | 'lmg' | 'shotgun' | 'dmr' | 'sniper' | 'amr';
/** Calibre: guns of the same calibre share one ammunition pool. */
export type AmmoType = '9mm' | '45acp' | '357' | '556' | '762' | '12g' | '300' | '50cal';
export type Difficulty = 'easy' | 'normal';
export type GamePhase = 'menu' | 'playing' | 'paused' | 'won' | 'lost';
export type AmmoKind = `${AmmoType}Ammo`;
export type ArmorSlot = 'helmet' | 'vest';
export type ArmorKind = `${ArmorSlot}${1 | 2 | 3}`;
export type LootKind = WeaponType | AmmoKind | 'medkit' | ArmorKind;
export type MapId = 'arena' | 'island' | 'valley';
/** Gyroscope aiming: off, only while aiming or firing, or always. */
export type GyroMode = 'off' | 'aim' | 'always';
export interface GameSettings {
  difficulty: Difficulty;
  botCount: number;
  map: MapId;
  volume: number;
  quality: 'low' | 'high';
  sensitivity: number;
  gyro: GyroMode;
  /** Multiplier on the phone's rotation (1 = the camera turns as far as the phone does). */
  gyroSensitivity: number;
  gyroInvertY: boolean;
  /** Short first-time hints, and the frame-rate readout. */
  tips: boolean;
  showFps: boolean;
  /** Touch aim assist (slows the camera over enemies and pulls toward them while firing) and recoil strength (1 = full). */
  aimAssist: 'off' | 'low' | 'high';
  recoilScale: number;
  /** Pale wedges around the crosshair showing where other people's gunshots came from. */
  soundIndicator: boolean;
}
export type ObstacleKind = 'building' | 'crate' | 'rock' | 'wall' | 'roof' | 'tree' | 'wreck';
/** Solid between `base + bottom` and `base + height` (base defaults to 0, bottom to 0). */
export interface Obstacle {
  id: string; x: number; z: number; width: number; depth: number; height: number;
  kind: ObstacleKind; base?: number; bottom?: number;
}
export interface ZoneProfile { start: number; radii: number[]; waits: number[]; shrinks: number[] }
export interface Town { id: string; name: string; x: number; z: number; radius: number; tier: 'city' | 'town' | 'hamlet' }
export interface RoadSegment { a: Vec2; b: Vec2; width: number }
export interface VehicleSpawn { x: number; z: number; yaw: number }
export interface LootSpot { x: number; z: number; y: number; tier: 1 | 2 | 3 }
export interface Lake { x: number; z: number; r: number; level: number }
export interface River { points: Array<{ x: number; z: number; level: number }>; width: number }
/** Water: the sea sits at `seaLevel`; lakes are deep, rivers are shallow enough to wade. */
export interface WaterFeatures { seaLevel: number; lakes: Lake[]; rivers: River[] }
/** Farmland: an axis-aligned patch drawn on the ground (rendering only). */
export interface Field { x: number; z: number; w: number; d: number; crop: 0 | 1 | 2 }
export interface WorldConfig {
  id: MapId; halfSize: number; obstacles: Obstacle[]; spawns: Vec3[];
  /** Ground height; absent on the flat arena. Must be pure and deterministic. */
  terrain?: (x: number, z: number) => number;
  zone: ZoneProfile; towns: Town[]; roads: RoadSegment[]; vehicleSpawns: VehicleSpawn[]; lootSpots: LootSpot[];
  water?: WaterFeatures; fields?: Field[];
}
/** A drivable car. Only the driver rides; passengers are not modelled. */
export interface Vehicle {
  id: string; position: Vec3; yaw: number; /** Signed forward speed in m/s. */ speed: number;
  health: number; driverId: string | null; colorIndex: number; hitTimer: number;
}
/** Standing, crouching (slower, steadier, smaller) or lying prone (slowest, steadiest, smallest). */
export type Stance = 'stand' | 'crouch' | 'prone';
/** Where an actor is in the drop: riding the plane, in free fall, or under a canopy. */
export type AirMode = 'plane' | 'freefall' | 'chute';
export interface AirState { mode: AirMode; vx: number; vy: number; vz: number; /** Seconds since leaving the plane. */ time: number }
/** The transport plane that flies over the map at the start of a match; everyone jumps from it. */
export interface Plane {
  x: number; y: number; z: number; yaw: number; speed: number;
  from: Vec2; to: Vec2; length: number; travelled: number; active: boolean;
}
/** A supply crate on a parachute; once down it holds top-tier gear until picked clean. */
export interface Airdrop { id: string; x: number; z: number; y: number; landed: boolean; time: number; empty: boolean; loot: string[] }
export interface Actor {
  id: string; name: string; isPlayer: boolean; position: Vec3; yaw: number;
  health: number; alive: boolean; weapon: WeaponType; ownedWeapons: WeaponType[];
  /** Rounds in each gun's magazine, and spare rounds per calibre. */
  ammo: Record<WeaponType, number>; reserve: Record<AmmoType, number>;
  reloading: number; healing: number; medkits: number; hurtTimer: number;
  /** Armour tier 0 (none) to 3, and remaining durability. The helmet guards against headshots, the vest the body. */
  helmet: number; vest: number; helmetHp: number; vestHp: number;
  /** Id of the car being driven, if any. */
  vehicleId?: string | null;
  /** Set while the actor is in the plane, falling or under a parachute; absent once on the ground. */
  air?: AirState | null;
  /** Absent means standing. */
  stance?: Stance;
}
export interface Loot { id: string; kind: LootKind; position: Vec3; active: boolean }
export interface ZoneState {
  center: Vec2; radius: number; nextCenter: Vec2; nextRadius: number;
  stage: number; timeRemaining: number; isShrinking: boolean;
}
export interface GameState {
  phase: GamePhase; elapsed: number; actors: Actor[]; loot: Loot[]; vehicles: Vehicle[];
  zone: ZoneState; kills: number; shots: number; hits: number;
  /** Present only in a match that starts with a drop from the sky. */
  plane?: Plane | null;
  airdrops?: Airdrop[];
  /** The player's place and time of death, kept while they watch the rest of the match. */
  playerRank?: number; diedAt?: number; spectating?: boolean;
}
/** While driving, throttle (-1 reverse to 1 forward) and steer (-1 left to 1 right) replace the move vector; jump is the handbrake. */
export interface PlayerInput { moveX: number; moveZ: number; sprint: boolean; jump: boolean; throttle?: number; steer?: number }
export interface WeaponConfig {
  label: string; magazine: number; damage: number; pellets: number;
  fireInterval: number; reloadTime: number; range: number; spread: number;
  category: string; fireMode: 'auto' | 'semi' | 'bolt'; zoom: number;
  aimSpread: number; recoil: number; preferredRange: number; color: string; ammoPickup: number;
  id: WeaponType; kind: WeaponClass; ammoType: AmmoType; tier: 1 | 2 | 3; sidearm: boolean;
  /** How far a shot carries (metres) and how much a bot values the gun. */
  loudness: number; value: number;
  /** Part tokens for the 3D model, and the core gun whose gunshot sound it borrows. */
  look: string; voice: WeaponType;
}
export type GameEvent =
  | { type: 'shot'; actorId: string; weapon: WeaponType; from: Vec3; to: Vec3; hitId?: string }
  | { type: 'damage'; actorId: string; amount: number; sourceId?: string }
  | { type: 'kill'; actorId: string; killerId?: string }
  | { type: 'pickup'; kind: LootKind }
  | { type: 'message'; text: string }
  | { type: 'crash'; vehicleId: string; strength: number; position: Vec3 }
  | { type: 'explosion'; position: Vec3 }
  | { type: 'drop'; actorId: string; stage: 'jump' | 'chute' | 'land' }
  | { type: 'airdrop'; stage: 'incoming' | 'landed'; position: Vec3 }
  | { type: 'end'; won: boolean };
