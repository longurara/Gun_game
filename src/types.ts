import type { SupplyKind, ThrowKind, UseKind } from './game/supplies';
import type { AttachKind, Attachments, PackKind } from './game/gear';
import type { MeleeKind } from './game/melee';
import type { VehicleKind } from './game/vehicles';
export interface Vec2 { x: number; z: number }
export interface Vec3 extends Vec2 { y: number }
/** Id of a gun in the arsenal (src/game/arsenal.ts). */
export type WeaponType = string;
/** Handling class of a gun: sets its baseline stats, sound and which slot it takes. */
export type WeaponClass = 'pistol' | 'smg' | 'ar' | 'br' | 'lmg' | 'shotgun' | 'dmr' | 'sniper' | 'amr' | 'bow' | 'launcher';
/** Calibre: guns of the same calibre share one ammunition pool. */
export type AmmoType = '9mm' | '45acp' | '357' | '556' | '762' | '12g' | '300' | '50cal' | 'bolt' | '40mm' | 'rocket';
export type Difficulty = 'easy' | 'normal';
export type GamePhase = 'menu' | 'playing' | 'paused' | 'won' | 'lost';
export type AmmoKind = `${AmmoType}Ammo`;
export type ArmorSlot = 'helmet' | 'vest';
export type ArmorKind = `${ArmorSlot}${1 | 2 | 3}`;
export type LootKind = WeaponType | AmmoKind | 'medkit' | ArmorKind | SupplyKind | PackKind | AttachKind | MeleeKind;
export type MapId = 'arena' | 'island' | 'valley' | 'desert' | 'pines' | 'metro' | 'range';
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
  /** Which outfit the player wears (see src/skins.ts). */
  skin: string;
  /** On the shooting range: nothing can hurt the player. */
  immortal: boolean;
}
export type ObstacleKind = 'building' | 'crate' | 'rock' | 'wall' | 'roof' | 'tree' | 'wreck' | 'floor';
/** Solid between `base + bottom` and `base + height` (base defaults to 0, bottom to 0). */
export interface Obstacle {
  id: string; x: number; z: number; width: number; depth: number; height: number;
  kind: ObstacleKind; base?: number; bottom?: number;
}
/** A stairwell: step up to it and press E to come out at `to`. Bunkers are reached and left this way. */
export interface Portal { id: string; x: number; y: number; z: number; to: Vec3; label: string; /** True: it leads down into a bunker. */ down: boolean }
/** A huge fenced compound with the best loot on the surface and a bunker beneath it. */
export interface HotArea { id: string; name: string; kind: 'base' | 'factory'; x: number; z: number; radius: number }
/** How an open map looks (rendering only): sand over the meadow, how much grass grows, a tint on the ground, the haze in the distance. */
export interface MapTheme {
  /** 0..1: how much of the meadow is bare sand (1 is a desert). */ sand: number;
  /** Multiplier on the density of grass tufts. */ grass: number;
  /** Multiplied into the ground colour. */ tint: [number, number, number];
  /** Fog and sky colour (0..1 per channel) and the fog density. */ haze: [number, number, number]; fogDensity: number;
}
/** A practice target: where it stands, how far from the firing line, and (if it moves) how it slides sideways. */
export interface RangeDummySpec { id: string; x: number; z: number; distance: number; sway?: { amp: number; period: number; phase: number } }
/** The layout of the shooting range. */
export interface RangeLayout {
  playerSpawn: Vec3; firingZ: number; dummies: RangeDummySpec[]; botSpawns: Vec3[]; laneX: number[]; distances: number[];
  yard: { x0: number; x1: number; z0: number; z1: number };
}
export interface ZoneProfile { start: number; radii: number[]; waits: number[]; shrinks: number[] }
export interface Town { id: string; name: string; x: number; z: number; radius: number; tier: 'city' | 'town' | 'hamlet' }
export interface RoadSegment { a: Vec2; b: Vec2; width: number }
export interface VehicleSpawn { x: number; z: number; yaw: number }
/** `bias` tilts what a spot holds: a hospital stocks medkits, a hangar the heavy guns. */
export interface LootSpot { x: number; z: number; y: number; tier: 1 | 2 | 3; bias?: 'medical' | 'heavy' }
/**
 * Something to stand on above the ground: a flat slab (y0 = y1) or a ramp that rises along `axis` from y0 at its low-coordinate
 * end to y1 at the other. Obstacles of kind 'floor' block heads under a slab; floors carry feet.
 */
export interface Floor { id: string; x: number; z: number; width: number; depth: number; y0: number; y1: number; axis?: 'x' | 'z' }
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
  /** Absent on the original island, the valley and the arena. */
  theme?: MapTheme;
  /** Present only on the shooting range. */
  range?: RangeLayout;
  /** Stairs between the surface and the bunkers, and the hot areas (absent on maps without them). */
  portals?: Portal[]; hotAreas?: HotArea[];
  /** Slabs and stair ramps in multi-storey buildings; absent where there are none. */
  floors?: Floor[];
  /** Solid stand-ins for tall buildings, drawn only from a distance (never collided with). */
  proxies?: Obstacle[];
}
/** A drivable car. Only the driver rides; passengers are not modelled. */
export interface Vehicle {
  /** Car, motorbike or buggy: how it drives and whether the driver is exposed. */
  kind: VehicleKind;
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
/** A grenade in flight. `fuse` counts down to the burst; a molotov also bursts on its first impact. */
export interface Projectile { id: number; kind: ThrowKind | 'shell' | 'rocket'; x: number; y: number; z: number; vx: number; vy: number; vz: number; fuse: number; owner: string }
/** A smoke cloud that blocks sight: it swells to `radius` and clears at match time `until`. */
export interface Smoke { id: number; x: number; y: number; z: number; radius: number; born: number; until: number }
/** Burning ground from a molotov. */
export interface Fire { id: number; x: number; y: number; z: number; radius: number; until: number; owner: string; tick: number }
/** A supply crate on a parachute; once down it holds top-tier gear until picked clean. */
export interface Airdrop { id: string; x: number; z: number; y: number; landed: boolean; time: number; empty: boolean; loot: string[] }
export interface Actor {
  id: string; name: string; isPlayer: boolean; position: Vec3; yaw: number;
  health: number; alive: boolean; weapon: WeaponType; ownedWeapons: WeaponType[];
  /** Rounds in each gun's magazine, and spare rounds per calibre. */
  ammo: Record<WeaponType, number>; reserve: Record<AmmoType, number>;
  reloading: number; healing: number; medkits: number; hurtTimer: number;
  /** Healing items, boosts and grenades in the pack, the boost gauge (0-100) and what is being used right now. */
  supplies: Record<SupplyKind, number>; boost: number; healKind?: UseKind | null;
  /** Which grenade G throws, and seconds left of being blinded by a flash. */
  throwKind?: ThrowKind | null; blind?: number;
  /** Backpack level (0 none to 3), what is bolted to each gun, and spare attachments in the pack. */
  pack: number; attach: Record<WeaponType, Attachments>; parts: Record<AttachKind, number>;
  /** The close-combat weapon carried, if any. */
  melee?: MeleeKind | null;
  /** Armour tier 0 (none) to 3, and remaining durability. The helmet guards against headshots, the vest the body. */
  helmet: number; vest: number; helmetHp: number; vestHp: number;
  /** Id of the car being driven, if any. */
  vehicleId?: string | null;
  /** Set while the actor is in the plane, falling or under a parachute; absent once on the ground. */
  air?: AirState | null;
  /** Absent means standing. */
  stance?: Stance;
  /** Opponents (and people) this actor has put down, and the place and time of its own death. */
  kills?: number; rank?: number; diedAt?: number;
  /** Seconds of held breath left (absent is full), and whether it is being held or has run out. */
  breath?: number; holding?: boolean; winded?: boolean;
  /** A practice target on the shooting range: it stands still (or slides), never shoots, and stands back up after a few seconds. */
  dummy?: boolean;
}
export interface Loot {
  id: string; kind: LootKind; position: Vec3; active: boolean;
  /** Exact stack size for dropped ammunition or medkits; absent uses the normal world pickup size. */
  amount?: number;
  /** Magazine left in a dropped gun (including zero); absent is a fresh world gun with its spare magazine. */
  loadedAmmo?: number;
  /** Remaining armour durability; absent is a fresh piece. */
  durability?: number;
}
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
  /** Grenades in the air, smoke clouds and burning patches. */
  projectiles?: Projectile[]; smokes?: Smoke[]; fires?: Fire[];
  /** The player's place and time of death, kept while they watch the rest of the match. */
  playerRank?: number; diedAt?: number; spectating?: boolean;
  /** Multiplayer: who won once the match is over. */
  winnerId?: string;
  /** The human at this machine (everything the HUD shows is about them). */
  localId?: string;
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
  /** Muzzle velocity in m/s: how flat the bullet flies (see ballistics.ts). */
  velocity: number;
  /** Part tokens for the 3D model, and the core gun whose gunshot sound it borrows. */
  look: string; voice: WeaponType;
}
export type GameEvent =
  | { type: 'shot'; actorId: string; weapon: WeaponType; from: Vec3; to: Vec3; hitId?: string; /** Fired through a suppressor. */ silenced?: boolean }
  | { type: 'damage'; actorId: string; amount: number; sourceId?: string }
  | { type: 'kill'; actorId: string; killerId?: string }
  | { type: 'pickup'; kind: LootKind; /** Set in multiplayer: only this human should see it. */ for?: string }
  | { type: 'message'; text: string; /** Set in multiplayer: a private message for one human. */ for?: string }
  | { type: 'crash'; vehicleId: string; strength: number; position: Vec3 }
  | { type: 'explosion'; position: Vec3; /** Set for a grenade: how far the blast reaches. */ radius?: number }
  | { type: 'throw'; actorId: string; kind: ThrowKind; from: Vec3; to: Vec3 }
  | { type: 'smoke'; position: Vec3 }
  | { type: 'portal'; actorId: string; down: boolean; from: Vec3; to: Vec3 }
  | { type: 'melee'; actorId: string; at: Vec3; hitId?: string; weapon: MeleeKind | 'fists' }
  | { type: 'flash'; position: Vec3 }
  | { type: 'fire'; position: Vec3 }
  | { type: 'drop'; actorId: string; stage: 'jump' | 'chute' | 'land' }
  | { type: 'airdrop'; stage: 'incoming' | 'landed'; position: Vec3 }
  | { type: 'end'; won: boolean };
