export interface Vec2 { x: number; z: number }
export interface Vec3 extends Vec2 { y: number }
export type WeaponType = 'rifle' | 'shotgun' | 'smg' | 'pistol' | 'dmr' | 'sniper' | 'heavySniper' | 'lmg';
export type Difficulty = 'easy' | 'normal';
export type GamePhase = 'menu' | 'playing' | 'paused' | 'won' | 'lost';
export type AmmoKind = `${WeaponType}Ammo`;
export type LootKind = WeaponType | AmmoKind | 'medkit';
export interface GameSettings {
  difficulty: Difficulty;
  botCount: 5 | 7;
  volume: number;
  quality: 'low' | 'high';
  sensitivity: number;
}
export interface Obstacle {
  id: string; x: number; z: number; width: number; depth: number; height: number;
  kind: 'building' | 'crate' | 'rock';
}
export interface WorldConfig { halfSize: number; obstacles: Obstacle[]; spawns: Vec3[] }
export interface Actor {
  id: string; name: string; isPlayer: boolean; position: Vec3; yaw: number;
  health: number; alive: boolean; weapon: WeaponType; ownedWeapons: WeaponType[];
  ammo: Record<WeaponType, number>; reserve: Record<WeaponType, number>;
  reloading: number; healing: number; medkits: number; hurtTimer: number;
}
export interface Loot { id: string; kind: LootKind; position: Vec3; active: boolean }
export interface ZoneState {
  center: Vec2; radius: number; nextCenter: Vec2; nextRadius: number;
  stage: number; timeRemaining: number; isShrinking: boolean;
}
export interface GameState {
  phase: GamePhase; elapsed: number; actors: Actor[]; loot: Loot[];
  zone: ZoneState; kills: number; shots: number; hits: number;
}
export interface PlayerInput { moveX: number; moveZ: number; sprint: boolean; jump: boolean }
export interface WeaponConfig {
  label: string; magazine: number; damage: number; pellets: number;
  fireInterval: number; reloadTime: number; range: number; spread: number;
  category: string; fireMode: 'auto' | 'semi' | 'bolt'; zoom: number;
  aimSpread: number; recoil: number; preferredRange: number; color: string; ammoPickup: number;
}
export type GameEvent =
  | { type: 'shot'; actorId: string; weapon: WeaponType; from: Vec3; to: Vec3; hitId?: string }
  | { type: 'damage'; actorId: string; amount: number; sourceId?: string }
  | { type: 'kill'; actorId: string; killerId?: string }
  | { type: 'pickup'; kind: LootKind }
  | { type: 'message'; text: string }
  | { type: 'end'; won: boolean };
