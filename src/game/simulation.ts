import type { RangeDummySpec } from '../types';
import type { Actor, Airdrop, AmmoType, Stance, ArmorSlot, Difficulty, Vehicle, GameEvent, GamePhase, GameState, Fire, Floor, Loot, LootKind, MapId, Obstacle, Portal, Projectile, Smoke, PlayerInput, Town, Vec2, Vec3, WeaponClass, WeaponType, WorldConfig, ZoneState } from '../types';
import { ACTOR_HEIGHT, ACTOR_RADIUS, createArenaWorld, HEAL_AMOUNT, HEAL_TIME, INTERACTION_RANGE, WEAPONS } from './config';
import { AMMO_PICKUP, ammoKindFor, ammoKindOf, ammoTypeOf, AMMO_ORDER, ARMOR_DURABILITY, ARMOR_NAMES, ARMOR_REDUCTION, armorKind, CORE_WEAPONS, emptyAmmo, emptyReserve, GUNS_BY_CLASS, isArmorKind, isSidearm, isWeaponKind, parseArmor, PRIMARY_SLOTS, WEAPON_ORDER } from './weapons';
import { SpatialGrid } from './spatial';
import { chooseWeapon, duelPower, gunshotLoudness, lootUtility, weakestWeapon } from './bot-logic';
import { createMapWorld, obstacleBottom, obstacleTop } from './world';
import { createRangeWorld } from './range';
import { DEEP } from './underground';
import { BREATH_RECOVER, BREATH_RESUME, BREATH_SECONDS, BREATH_SPREAD, BREATH_VELOCITY } from './breath';
import { SCOPE_FROM } from '../optics';
import { floorSurface, STEP_UP } from './buildings';
import { HULLS, kindOf, VEHICLES, vehicleKindFor } from './vehicles';
import { FISTS, isMeleeKind, MELEE, MELEE_ORDER } from './melee';
import type { MeleeKind } from './melee';
import { ATTACH, ATTACH_ORDER, ATTACH_SLOTS, attachmentsOf, capacityOf, emptyParts, fits, isAttachKind, isPackKind, magazineOf, PACK_BASE, PACK_ORDER, PACKS, rigStats, spaceOf, usedSpace } from './gear';
import type { AttachKind, AttachSlot, PackKind } from './gear';
import { BOOST_DRAIN, BOOST_MAX, boostRegen, boostSpeed, emptySupplies, HEAL_CAP, isSupplyKind, isThrowKind, isUseKind, SUPPLIES, SUPPLY_ORDER, THROW_ORDER } from './supplies';
import type { SupplyKind, ThrowKind, UseKind } from './supplies';
import { movementSpread, NECK, STANCE, stanceOf } from './stance';
import { COMBO_WINDOW, DRILLS, hitPoints, isDrillId, drillGrade } from './drills';
import { popUp, runState } from './range';
import { holdover, pathOffset, SEGMENT, STRAIGHT_RANGE, ZERO_DISTANCE } from './ballistics';
import { alongLine, DROP, glideReach, makePlane, placePlane, steerAir } from './drop';
import { GRENADE_GRAVITY, projectileGravity } from './projectiles';

interface Options {
  seed?: number; botCount?: number; difficulty?: Difficulty; map?: MapId; /** Start the match in the transport plane (open maps only). */ drop?: boolean;
  /** On the shooting range: nothing hurts the player. */ immortal?: boolean;
  /** Multiplayer: how many of the first actors are people (default 1), which of them is on this machine, their names. */
  humans?: number; localId?: string; names?: string[];
  dropLeaderId?: string;
  /** A mirror of someone else's match: it never steps the world itself, it is told what happened. */
  remote?: boolean;
}
/** A bot's plan for the drop: where to land, when to jump, how low to open the canopy. */
interface BotDrop { jumpAt: number; target: Vec2; openAgl: number; dive: boolean }
interface Runtime {
  cooldown: number; weaponCooldowns: Record<WeaponType, number>; velocityY: number; reloadWeapon: WeaponType | null;
  targetId: string | null; reaction: number; memory: number; sightTimer: number;
  goal: Vec2 | null; path: Vec2[]; pathTimer: number; stuck: number;
  /** No route search before this time (a search that found nothing is not repeated at once). */
  pathHold: number;
  /** Seconds before this actor can throw another grenade. */
  throwCooldown: number;
  meleeCooldown: number;
  /** A vault in progress: over a crate or a window sill, from one side to the other. */
  vault: { t: number; from: Vec3; to: Vec3; peak: number } | null;
  /** Aim convergence on the current target, 0 (just spotted) to 1 (settled). */
  focus: number; strafeDir: 1 | -1; strafeTimer: number; burstLeft: number; stillTime: number;
  lastSeen: Vec2 | null; lastSeenAt: number; enemyVel: Vec2; enemyLast: Vec2 | null;
  heard: Vec2 | null; heardTimer: number;
  lootRef: Loot | null; lootTimer: number; ignored: Map<string, number>;
  coverGoal: Vec2 | null; coverTimer: number; weaponTimer: number;
  visited: Set<string>; townGoal: Vec2 | null;
  lodAcc: number; lodTier: number; duelUntil: number; detour: number;
  /** Car the bot is walking to, the destination it will drive on to, and a cooldown between searches. */
  carTarget: string | null; destination: Vec2 | null; carCooldown: number;
  drop: BotDrop | null;
  /** Where a landed supply crate is, if this bot decided to go for it. */
  airdropGoal: Vec2 | null;
  /** Current speed in m/s, kept for the accuracy penalty of shooting on the move. */
  speedNow: number;
  /** A trip into a bunker: on the way down to its stairs, looting inside, or on the way back up. */
  mission: { phase: 'down' | 'in' | 'up'; portal: Portal | null; until: number } | null;
  /** Next time this bot thinks about a bunker, and the bunkers it has already visited. */
  bunkerAt: number; bunkers: Set<string>;
  /** The last pickup search found nothing worth taking. */
  dry: boolean;
}
interface Hit { distance: number; actor?: Actor; head?: boolean; vehicle?: Vehicle; /** Where a bullet that followed an arc ended up. */ point?: Vec3 }
/** What the player is told on landing, by map. */
const ARRIVAL_MESSAGE: Partial<Record<MapId, string>> = {
  island: 'Bạn đã đáp xuống đảo. Tìm vũ khí, đừng để bo bắt kịp!',
  valley: 'Bạn đã vào thung lũng. Lục nhà tìm súng, bo thu rất nhanh!',
  range: 'Trường bắn: bia ở mọi cự ly, bot ở khu phía đông. B: kho vũ khí · K: bất tử · T: bài tập · Y: đổi bài · L: đưa xe về bãi.',
  desert: 'Sa mạc mênh mông. Tìm nhà, tìm xe, và tìm bóng râm trước khi bo khép lại.',
  pines: 'Rừng thông dày đặc. Dùng cây làm chỗ nấp và coi chừng những con dốc.',
  metro: 'Thành phố đông đúc. Lục tòa nhà, chiếm tầng cao, đừng để bị bao vây.',
};
/** Zone stages at which a supply crate drops: the long maps get three, the island two, the valley and the rest one early and one later. */
const airdropStages = (world: WorldConfig): number[] => world.zone.radii.length >= 8 ? [1, 3, 5] : world.id === 'island' ? [1, 3] : [1, 2];

/** A bullet's flight: how fast it leaves the muzzle and the distance its sights are zeroed at. */
interface Arc { velocity: number; zero: number }

/** How often each class turns up at a loot spot of tier 1 (houses), 2 (big houses) and 3 (cities, military). */
const CLASS_SPAWN: Record<1 | 2 | 3, Partial<Record<WeaponClass, number>>> = {
  1: { pistol: 0.16, smg: 0.17, shotgun: 0.16, ar: 0.12 },
  2: { ar: 0.18, smg: 0.08, shotgun: 0.07, br: 0.06, dmr: 0.10, lmg: 0.08, pistol: 0.03, bow: 0.01 },
  3: { dmr: 0.11, br: 0.07, sniper: 0.14, amr: 0.08, lmg: 0.09, ar: 0.12, shotgun: 0.01, bow: 0.02, launcher: 0.025 },
};
/** Within a class, a gun of tier t shows up at spot tier s with this weight: rare guns concentrate in the rich spots. */
const TIER_AFFINITY: Record<1 | 2 | 3, [number, number, number]> = { 1: [1, 0.55, 0.2], 2: [0.3, 1, 0.7], 3: [0.04, 0.4, 1] };
const GEAR_SPAWN: Record<1 | 2 | 3, Array<[LootKind, number]>> = {
  1: [['medkit', 0.1], ['bandage', 0.12], ['painkiller', 0.03], ['energy', 0.05], ['smoke', 0.02], ['pack1', 0.025], ['scope2', 0.015], ['extmag', 0.01], ['pan', 0.012], ['sickle', 0.01], ['helmet1', 0.09], ['vest1', 0.1]],
  2: [['medkit', 0.09], ['bandage', 0.07], ['firstaid', 0.05], ['painkiller', 0.04], ['energy', 0.05], ['frag', 0.04], ['smoke', 0.02], ['flash', 0.02], ['molotov', 0.015], ['pack1', 0.03], ['pack2', 0.02], ['pan', 0.01], ['machete', 0.012], ['crowbar', 0.01], ['scope2', 0.02], ['scope3', 0.02], ['suppressor', 0.015], ['compensator', 0.015], ['vgrip', 0.015], ['agrip', 0.015], ['extmag', 0.02], ['helmet2', 0.11], ['vest2', 0.12]],
  3: [['medkit', 0.07], ['firstaid', 0.07], ['painkiller', 0.05], ['energy', 0.04], ['bandage', 0.03], ['frag', 0.06], ['smoke', 0.03], ['flash', 0.03], ['molotov', 0.03], ['pack2', 0.03], ['pack3', 0.025], ['scope3', 0.02], ['scope4', 0.025], ['scope6', 0.02], ['suppressor', 0.02], ['compensator', 0.02], ['vgrip', 0.02], ['agrip', 0.02], ['extmag', 0.03], ['helmet3', 0.12], ['vest3', 0.14]],
};
export const LOOT_TABLES: Record<1 | 2 | 3, Array<[LootKind, number]>> = { 1: [], 2: [], 3: [] };
for (const tier of [1, 2, 3] as const) {
  for (const [cls, weight] of Object.entries(CLASS_SPAWN[tier]) as Array<[WeaponClass, number]>) {
    const guns = GUNS_BY_CLASS[cls];
    const affinity = guns.map(gun => TIER_AFFINITY[WEAPONS[gun].tier][tier - 1]);
    const total = affinity.reduce((a, b) => a + b, 0);
    guns.forEach((gun, i) => LOOT_TABLES[tier].push([gun, weight * affinity[i] / total]));
  }
  LOOT_TABLES[tier].push(...GEAR_SPAWN[tier]);
  // The roll walks the table until the weights run out, so the table must add up to one.
  const total = LOOT_TABLES[tier].reduce((sum, [, weight]) => sum + weight, 0);
  LOOT_TABLES[tier] = LOOT_TABLES[tier].map(([kind, weight]) => [kind, weight / total] as [LootKind, number]);
}
/** Calibres of the guns people actually start with: spare rounds that always help someone. */
const COMMON_AMMO: AmmoType[] = ['9mm', '556', '12g', '45acp'];

/** Landing faster than this (m/s, a drop of about 3.7 m) hurts: 8 damage for every m/s above it. */
const FALL_SAFE_SPEED = 11.5;
/** Highest thing a person vaults over (a crate, a window sill, a low wall), metres above their feet, and how long it takes. */
const VAULT_MAX = 1.4, VAULT_SECONDS = 0.5;
/** Grenades: gravity on a thrown one, blast radius and strength, flash reach, smoke and fire sizes and lifetimes. */
const BLASTS = {
  frag: { radius: 9, damage: 115, vehicle: 190 },
  shell: { radius: 6.5, damage: 105, vehicle: 170 },
  rocket: { radius: 9.5, damage: 190, vehicle: 340 },
} as const;
const FLASH_RANGE = 42;
const SMOKE_RADIUS = 6.5, SMOKE_SECONDS = 24;
const FIRE_RADIUS = 4.2, FIRE_SECONDS = 9, FIRE_DPS = 14;
const ZERO_INPUT: PlayerInput = { moveX: 0, moveZ: 0, sprint: false, jump: false };
const NO_PRESSES: ReadonlySet<string> = new Set();
/** Bots closer than this to the player run full AI every step; closer than LOD_NEAR run it a few times a second. */
const LOD_FULL = 220;
const LOD_NEAR = 650;
/** Crates are released this high and sink at AIRDROP_FALL m/s, about a minute in the air. */
const AIRDROP_HEIGHT = 520;
const AIRDROP_FALL = 9;
const VEHICLE_REACH = 4.2;
/** Shape of what a bullet hits on each kind of vehicle: half width, half length, bottom and top above the ground. */
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const distance2 = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
const finite = (n: number) => Number.isFinite(n) ? n : 0;

/** Distance along a normalized 3D ray to an axis-aligned box, or null. */
function rayBox(origin: Vec3, direction: Vec3, min: Vec3, max: Vec3, range: number): number | null {
  let near = 0;
  let far = range;
  for (const key of ['x', 'y', 'z'] as const) {
    if (Math.abs(direction[key]) < 1e-9) {
      if (origin[key] < min[key] || origin[key] > max[key]) return null;
      continue;
    }
    let a = (min[key] - origin[key]) / direction[key];
    let b = (max[key] - origin[key]) / direction[key];
    if (a > b) [a, b] = [b, a];
    near = Math.max(near, a);
    far = Math.min(far, b);
    if (near > far) return null;
  }
  return far < 0 ? null : near;
}

function obstacleHit(origin: Vec3, direction: Vec3, obstacle: Obstacle, range: number, padding = 0): number | null {
  return rayBox(origin, direction,
    { x: obstacle.x - obstacle.width / 2 - padding, y: obstacleBottom(obstacle), z: obstacle.z - obstacle.depth / 2 - padding },
    { x: obstacle.x + obstacle.width / 2 + padding, y: obstacleTop(obstacle), z: obstacle.z + obstacle.depth / 2 + padding }, range);
}

export class GameSimulation {
  public world: WorldConfig;
  public state: GameState;
  /** Dev/test switch: bots stand still and never act. Lets ballistics be tested against fixed targets. */
  public botsFrozen = false;
  private options: Required<Options>;
  private randomState = 1;
  /** Loot rolls have their own stream, so adding an item to a table does not reshuffle bots, the plane or the zone. */
  private lootState = 1;
  /** Grenade decisions have a stream of their own too, for the same reason. */
  private throwState = 1;
  private events: GameEvent[] = [];
  private runtimes = new Map<string, Runtime>();
  /** Per human: the last input, whether jump was held, and jump presses that arrived from the network. */
  private inputs = new Map<string, PlayerInput>();
  private jumpHeldBy = new Map<string, boolean>();
  private pendingPresses = new Set<string>();
  private humanList: Actor[] = [];
  private localActor: Actor | null = null;
  private shrinkStart: { center: Vec2; radius: number } | null = null;
  private obstacleGrid = new SpatialGrid<Obstacle>(24);
  private floorGrid = new SpatialGrid<Floor>(16);
  private floorSource: Floor[] | null = null;
  private gridSource: Obstacle[] | null = null;
  private gridCount = -1;
  private actorGrid = new SpatialGrid<Actor>(32);
  private actorIndex = new Map<string, Actor>();
  /** Route searches allowed this step; the rest wait a few frames so a crowd of bots cannot stall one frame. */
  private pathBudget = 0;
  /** Landing spots already claimed by bots in this drop. */
  private dropTargets: Vec2[] = [];
  private lootGrid = new SpatialGrid<Loot>(16);
  private lootSource: Loot[] | null = null;
  private lootCount = -1;

  constructor(options: Options = {}) {
    this.options = { seed: options.seed ?? 72341, botCount: options.botCount ?? 5, difficulty: options.difficulty ?? 'normal', map: options.map ?? 'arena', drop: options.drop ?? false, immortal: options.immortal ?? false, humans: Math.max(1, options.humans ?? 1), localId: options.localId ?? '', names: options.names ?? [], remote: options.remote ?? false, dropLeaderId: options.dropLeaderId ?? '' };
    this.immortal = !!options.immortal;
    this.world = this.makeWorld();
    this.state = this.makeState('menu');
  }

  private makeWorld(): WorldConfig {
    if (this.options.map === 'range') return createRangeWorld();
    return createMapWorld(this.options.map) ?? createArenaWorld();
  }

  /** The island and the valley are open maps (terrain, loot in houses, vehicles); only the small arena is not. */
  private get openWorld(): boolean {
    return this.world.id !== 'arena' && this.world.id !== 'range';
  }

  /** Shift, standing still, with a magnifying scope in hand holds the breath: it drains while held and comes back when let go. */
  private stepBreath(human: Actor, dt: number): void {
    const input = this.inputs.get(human.id) ?? ZERO_INPUT;
    const scoped = rigStats(human, human.weapon).zoom >= SCOPE_FROM;
    const want = !!input.sprint && Math.hypot(input.moveX, input.moveZ) < 0.1 && scoped && !human.vehicleId && !human.air;
    let breath = human.breath ?? BREATH_SECONDS;
    if (human.winded && breath >= BREATH_RESUME) human.winded = false;
    const holding = want && !human.winded && breath > 0;
    breath = holding ? Math.max(0, breath - dt) : Math.min(BREATH_SECONDS, breath + dt * BREATH_RECOVER);
    if (holding && breath <= 0) human.winded = true;
    human.breath = breath;
    human.holding = holding && breath > 0;
  }

  /** The shooting range: practice targets, bots that come back, no circle and no end. */
  get rangeMode(): boolean { return this.world.id === 'range'; }
  /** On the range: nothing can hurt the player. */
  immortal = false;
  setImmortal(on: boolean, actor: Actor = this.player): void {
    if (actor === this.player) this.immortal = on;
    if (actor.practice) actor.practice.immortal = on;
  }
  private dummySpecs = new Map<string, RangeDummySpec>();

  /** The person at this machine. */
  get player(): Actor { return this.localActor ?? this.state.actors[0]; }
  get localId(): string { return this.player.id; }
  /** Every human actor, in join order. */
  get humans(): readonly Actor[] { return this.humanList; }
  /** True when more than one person is in the match. */
  get multiplayer(): boolean { return this.options.humans > 1; }
  actorById(id: string): Actor | undefined { return this.state.actors.find(actor => actor.id === id); }

  /** Ground height under a point; the arena is flat. */
  heightAt(x: number, z: number): number {
    return this.world.terrain ? this.world.terrain(x, z) : 0;
  }

  private floors(): SpatialGrid<Floor> | null {
    const list = this.world.floors;
    if (!list || list.length === 0) return null;
    if (this.floorSource !== list) {
      this.floorGrid.clear();
      for (const f of list) this.floorGrid.insertBox(f, f.x - f.width / 2, f.z - f.depth / 2, f.x + f.width / 2, f.z + f.depth / 2);
      this.floorSource = list;
    }
    return this.floorGrid;
  }

  /**
   * What someone whose feet are at `feetY` stands on at (x, z): the highest slab or ramp they can step up to (at most STEP_UP
   * above their feet), or the ground. Floors far above are overhead, not underfoot.
   */
  supportHeight(x: number, z: number, feetY: number): number {
    const ground = this.heightAt(x, z);
    // Someone deep underground (in a bunker) stands on the bunker's floor, not on the terrain far above their head.
    let best = feetY < ground - DEEP ? -Infinity : ground;
    const grid = this.floors();
    if (!grid) return best === -Infinity ? ground : best;
    grid.queryBox(x, z, x, z, floor => {
      if (x < floor.x - floor.width / 2 || x > floor.x + floor.width / 2 || z < floor.z - floor.depth / 2 || z > floor.z + floor.depth / 2) return;
      const y = floorSurface(floor, x, z);
      if (y <= feetY + STEP_UP && y > best) best = y;
    });
    return best === -Infinity ? ground : best;
  }

  private obstacles(): SpatialGrid<Obstacle> {
    const list = this.world.obstacles;
    if (this.gridSource !== list || this.gridCount !== list.length) {
      this.obstacleGrid.clear();
      for (const o of list) this.obstacleGrid.insertBox(o, o.x - o.width / 2, o.z - o.depth / 2, o.x + o.width / 2, o.z + o.depth / 2);
      this.gridSource = list;
      this.gridCount = list.length;
    }
    return this.obstacleGrid;
  }

  private lootIndex(): SpatialGrid<Loot> {
    const list = this.state.loot;
    if (this.lootSource !== list || this.lootCount !== list.length) {
      this.lootGrid.clear();
      for (const loot of list) this.lootGrid.insertPoint(loot, loot.position.x, loot.position.z);
      this.lootSource = list;
      this.lootCount = list.length;
    }
    return this.lootGrid;
  }

  /** Nearest active pickup within `radius` of an actor, ignoring items on another floor. */
  private nearestLoot(from: Vec3, radius: number, accept?: (loot: Loot) => boolean): Loot | null {
    let closest: Loot | null = null;
    let best = radius;
    this.lootIndex().queryCircle(from.x, from.z, radius, loot => {
      if (!loot.active || (accept && !accept(loot))) return;
      const d = Math.hypot(loot.position.x - from.x, loot.position.y - from.y, loot.position.z - from.z);
      if (d <= best) { closest = loot; best = d; }
    });
    return closest;
  }

  get lootInReach(): Loot | null { return this.lootNear(this.player); }

  /** Active items within the same three-dimensional reach used by E, nearest first. */
  nearbyLoot(actor: Actor = this.player): Loot[] {
    if (this.state.phase !== 'playing' || actor.vehicleId || actor.air || !actor.alive) return [];
    const nearby: Loot[] = [];
    this.lootIndex().queryCircle(actor.position.x, actor.position.z, INTERACTION_RANGE, loot => {
      if (loot.active && Math.hypot(loot.position.x - actor.position.x, loot.position.y - actor.position.y, loot.position.z - actor.position.z) <= INTERACTION_RANGE) nearby.push(loot);
    });
    return nearby.sort((a, b) => Math.hypot(a.position.x - actor.position.x, a.position.y - actor.position.y, a.position.z - actor.position.z) - Math.hypot(b.position.x - actor.position.x, b.position.y - actor.position.y, b.position.z - actor.position.z));
  }

  lootNear(actor: Actor): Loot | null {
    if (this.state.phase !== 'playing' || actor.vehicleId || actor.air || !actor.alive) return null;
    return this.nearestLoot(actor.position, INTERACTION_RANGE);
  }

  start(options: Options = {}): void {
    this.options = { ...this.options, ...options };
    if (options.immortal !== undefined) this.immortal = options.immortal;
    this.world = this.makeWorld();
    this.events = [];
    this.state = this.makeState('playing');
    if (this.state.plane) this.events.push({ type: 'message', text: 'Máy bay đang bay qua đảo. Nhảy khi bạn đã chọn được điểm đáp!' });
    else this.events.push({ type: 'message', text: ARRIVAL_MESSAGE[this.options.map] ?? 'Nhặt trang bị gần điểm xuất phát. Người sống cuối cùng chiến thắng!' });
  }

  returnToMenu(options: Options = {}): void {
    this.options = { ...this.options, ...options };
    this.events = [];
    this.world = this.makeWorld();
    this.state = this.makeState('menu');
  }

  /** Change the player's stance. Standing up from a lower stance needs room overhead; returns false if not allowed. */
  setStance(stance: Stance, player: Actor = this.player): boolean {
    if (this.state.phase !== 'playing' || !player.alive || player.air || player.vehicleId) return false;
    const current = player.stance ?? 'stand';
    if (stance === current) return true;
    if (STANCE[stance].height > STANCE[current].height && !this.walkable(player.position, ACTOR_RADIUS, player.position.y, STANCE[stance].height)) return false;
    player.stance = stance;
    return true;
  }

  /** How fast the player is moving right now, m/s (drives recoil shake and the dynamic crosshair). */
  get playerSpeed(): number { return this.runtime(this.player).speedNow; }

  /** The half-angle (radians) of the cone a bullet from the player's gun lands in right now: for the dynamic crosshair. */
  currentSpread(aimed: boolean): number {
    const player = this.player;
    const weapon = WEAPONS[player.weapon];
    const grounded = player.position.y <= this.heightAt(player.position.x, player.position.z) + 0.05;
    return (aimed ? weapon.aimSpread : weapon.spread) * stanceOf(player).spread * (aimed && player.holding ? BREATH_SPREAD : 1) + movementSpread(this.runtime(player).speedNow, !grounded, aimed);
  }

  /** Can the player see this actor right now (nothing solid between them)? Used by touch aim assist. */
  canPlayerSee(actor: Actor): boolean { return this.canSee(this.player, actor); }

  /** After dying, keep playing the match out as a spectator. Returns false when the match is over or nobody is left to watch. */
  continueAsSpectator(): boolean {
    if (this.state.phase !== 'lost' || this.player.alive || this.state.spectating) return false;
    if (this.state.actors.filter(actor => actor.alive).length < 2) return false;
    this.state.spectating = true;
    this.state.phase = 'playing';
    return true;
  }

  /** Stop watching and go to the results. */
  endSpectating(): void {
    if (this.state.spectating && this.state.phase === 'playing') this.finish(false);
  }

  setPaused(paused: boolean): void {
    if (paused && this.state.phase === 'playing') this.state.phase = 'paused';
    else if (!paused && this.state.phase === 'paused') this.state.phase = 'playing';
  }
  togglePause(): void { this.setPaused(this.state.phase === 'playing'); }
  drainEvents(): GameEvent[] { const pending = this.events; this.events = []; return pending; }

  /** Multiplayer (host): take a player who left or lost their connection out of the match. */
  eliminate(actorId: string): void {
    const actor = this.actorById(actorId);
    if (actor) delete actor.reconnecting;
    if (actor?.practice) { actor.practice.left = true; actor.practice.immortal = false; actor.hidden = true; }
    if (actor?.alive) this.damage(actor, 1e9);
  }

  setReconnecting(actorId: string, paused: boolean): void {
    const actor = this.actorById(actorId);
    if (!actor?.isPlayer) return;
    // A range respawn must retain the session's protection if the link was lost while dead.
    if (paused) actor.reconnecting = true; else delete actor.reconnecting;
    this.setHumanInput(actorId, ZERO_INPUT);
    this.jumpHeldBy.set(actorId, false);
    this.pendingPresses.delete(actorId);
  }

  /** Multiplayer: the hidden movement state of an actor that a client needs to predict its own movement. */
  motionOf(actor: Actor): { vy: number; speed: number } {
    const runtime = this.runtime(actor);
    return { vy: runtime.velocityY, speed: runtime.speedNow };
  }
  setMotion(actor: Actor, motion: { vy: number; speed: number }): void {
    const runtime = this.runtime(actor);
    runtime.velocityY = motion.vy;
    runtime.speedNow = motion.speed;
  }

  /** An authoritative relocation cancels old vault/jump prediction; revival also starts fresh action timers. */
  restoreMotion(actor: Actor, motion: { vy: number; speed: number }, revived = false): void {
    if (revived) this.runtimes.delete(actor.id);
    this.setMotion(actor, motion);
    this.runtime(actor).vault = null;
    this.jumpHeldBy.delete(actor.id);
  }

  /**
   * Mirror only: move the local player by their own input between snapshots (walking, falling, steering the parachute),
   * ride the plane along, and tick the timers that gate shooting. Events from this are discarded: the host reports them.
   */
  private predictLocal(dt: number, input: PlayerInput): void {
    const me = this.player;
    const kept = this.events.length;
    this.state.elapsed += dt;
    const plane = this.state.plane;
    if (plane?.active) {
      plane.travelled = Math.min(plane.length, plane.travelled + plane.speed * dt);
      placePlane(plane);
      for (const actor of this.state.actors) {
        if (actor.air?.mode !== 'plane') continue;
        actor.position.x = plane.x; actor.position.y = plane.y; actor.position.z = plane.z; actor.yaw = plane.yaw;
      }
    }
    if (me.alive) {
      const runtime = this.runtime(me);
      runtime.cooldown = Math.max(0, runtime.cooldown - dt);
      runtime.throwCooldown = Math.max(0, runtime.throwCooldown - dt);
      runtime.meleeCooldown = Math.max(0, runtime.meleeCooldown - dt);
      if (me.blind) me.blind = Math.max(0, me.blind - dt);
      for (const weapon of me.ownedWeapons) runtime.weaponCooldowns[weapon] = Math.max(0, runtime.weaponCooldowns[weapon] - dt);
      me.reloading = Math.max(0, me.reloading - dt);
      me.healing = Math.max(0, me.healing - dt);
      const pressed = input.jump && !this.jumpHeldBy.get(me.id);
      this.jumpHeldBy.set(me.id, input.jump);
      // The jump from the plane is predicted too, so the door opens the instant the key goes down; the host confirms it.
      if (me.air && me.dropFollowing) {
        // The host controls the formation. Predict its latest velocity without braking it with this follower's input.
        if (me.air.mode !== 'plane') {
          me.position.x += me.air.vx * dt; me.position.y += me.air.vy * dt; me.position.z += me.air.vz * dt;
          me.air.time += dt;
        }
      }
      else if (me.air) this.flyPlayer(me, dt, input, pressed);
      else if (!me.vehicleId) this.walkPlayer(me, dt, input, pressed);
      else this.predictDrive(me, dt, input);
    }
    this.events.length = kept;
  }

  /** Mirror only: the car the local player drives is steered by their own input right away; the host's word corrects it. */
  private predictDrive(me: Actor, dt: number, input: PlayerInput): void {
    const car = this.state.vehicles.find(v => v.id === me.vehicleId);
    if (!car || car.driverId !== me.id || car.health <= 0) return;
    this.driveVehicle(car, clamp(finite(input.throttle ?? 0), -1, 1), clamp(finite(input.steer ?? 0), -1, 1), input.jump, dt, true);
    me.position = { x: car.position.x, y: car.position.y + 0.3, z: car.position.z };
    me.yaw = car.yaw;
  }

  /** Mirror only: a shot is checked against ammunition and cadence here; the host decides what it hits. */
  private predictFire(actor: Actor): boolean {
    const runtime = this.runtime(actor);
    const weapon = WEAPONS[actor.weapon];
    if (!actor.alive || actor.reloading > 0 || runtime.cooldown > 1e-7 || runtime.weaponCooldowns[actor.weapon] > 1e-7 || actor.ammo[actor.weapon] <= 0) return false;
    actor.ammo[actor.weapon]--;
    runtime.weaponCooldowns[actor.weapon] = weapon.fireInterval;
    if (actor === this.player) this.state.shots++;
    return true;
  }

  /**
   * Multiplayer (host): what another human is holding down right now. `jumpEdge` says the jump button went down since
   * the last packet, so a quick tap between two packets still counts as a press.
   */
  setHumanInput(id: string, input: PlayerInput, jumpEdge = false): void {
    if (id === this.localId) return;
    this.inputs.set(id, { ...input, moveX: clamp(finite(input.moveX), -1, 1), moveZ: clamp(finite(input.moveZ), -1, 1) });
    if (jumpEdge) this.pendingPresses.add(id);
  }

  update(dt: number, input: PlayerInput = ZERO_INPUT): void {
    if (this.state.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
    const safeInput = { ...input, moveX: clamp(finite(input.moveX), -1, 1), moveZ: clamp(finite(input.moveZ), -1, 1) };
    if (this.options.remote) {
      // A mirror of someone else's match: only this player's own movement is predicted, the rest arrives in snapshots.
      let left = Math.min(dt, 1);
      while (left > 1e-8) { const slice = Math.min(left, 1 / 30); this.predictLocal(slice, safeInput); left -= slice; }
      return;
    }
    this.inputs.set(this.player.id, safeInput);
    // A press is a jump button that was up at the last step and is down now (or a press that arrived over the network).
    const pressed = new Set<string>(this.pendingPresses);
    this.pendingPresses.clear();
    for (const human of this.humanList) {
      const held = this.inputs.get(human.id)?.jump ?? false;
      if (held && !this.jumpHeldBy.get(human.id)) pressed.add(human.id);
      this.jumpHeldBy.set(human.id, held);
    }
    // Substeps keep collision, AI, and weapon cadence stable during slow frames.
    let remaining = Math.min(dt, 600);
    let first = true;
    while (remaining > 1e-8 && this.state.phase === 'playing') {
      const step = Math.min(remaining, 1 / 30);
      this.step(step, first ? pressed : NO_PRESSES);
      remaining -= step;
      first = false;
    }
  }

  shootPlayer(target: Vec3, aimed = false, actor: Actor = this.player): boolean {
    if (this.state.phase !== 'playing' || actor.vehicleId || actor.air || ![target.x, target.y, target.z].every(Number.isFinite)) return false;
    if (this.options.remote) return this.predictFire(actor);
    const grounded = actor.position.y <= this.heightAt(actor.position.x, actor.position.z) + 0.05;
    return this.fire(actor, target, movementSpread(this.runtime(actor).speedNow, !grounded, aimed), aimed);
  }

  reload(actor: Actor = this.player): boolean {
    if (this.state.phase !== 'playing' || actor.vehicleId) return false;
    return this.beginReload(actor);
  }

  switchWeapon(weapon: WeaponType, actor: Actor = this.player): boolean {
    if (this.state.phase !== 'playing' || actor.vehicleId || !actor.ownedWeapons.includes(weapon) || actor.weapon === weapon) return false;
    actor.weapon = weapon;
    actor.reloading = 0;
    this.runtime(actor).reloadWeapon = null;
    this.cancelHeal(actor);
    this.runtime(actor).cooldown = Math.max(this.runtime(actor).cooldown, 0.25);
    return true;
  }

  /** Heal with the best item for the actor's health, or with the named one (a medkit, bandage, first aid kit). */
  heal(actor: Actor = this.player, item?: UseKind): boolean {
    if (this.state.phase !== 'playing' || actor.vehicleId) return false;
    if (item !== undefined && !isUseKind(item)) return false;
    return this.beginUse(actor, item);
  }

  /** Use a healing item, a boost or (a later chapter) pick a grenade: the entry point for the "use" command. */
  useSupply(kind: unknown, actor: Actor = this.player): boolean {
    if (this.state.phase !== 'playing' || actor.vehicleId || actor.air) return false;
    if (!isUseKind(kind)) return false;
    return this.beginUse(actor, kind);
  }

  interact(actor: Actor = this.player): boolean {
    const loot = this.lootNear(actor);
    if (loot) return this.takeLoot(actor, loot);
    return this.useStairs(actor);
  }

  /** The stairwell (to or from a bunker) within reach of this actor, if any. */
  portalNear(actor: Actor = this.player): Portal | null {
    const portals = this.world.portals;
    if (!portals?.length || this.state.phase !== 'playing' || actor.vehicleId || actor.air || !actor.alive) return null;
    let best: Portal | null = null, bestDistance = INTERACTION_RANGE;
    for (const portal of portals) {
      if (Math.abs(portal.y - actor.position.y) > 2.5) continue;
      const d = Math.hypot(portal.x - actor.position.x, portal.z - actor.position.z);
      if (d <= bestDistance) { best = portal; bestDistance = d; }
    }
    return best;
  }

  /** Take the stairs in reach: the actor comes out at the other end. */
  useStairs(actor: Actor = this.player): boolean {
    const portal = this.portalNear(actor);
    if (!portal) return false;
    this.traverse(actor, portal);
    return true;
  }

  /** Put an actor at the far end of a stairwell. */
  private traverse(actor: Actor, portal: Portal): void {
    const from = { ...actor.position };
    actor.position = { x: portal.to.x, y: portal.to.y, z: portal.to.z };
    const runtime = this.runtime(actor);
    runtime.velocityY = 0; runtime.vault = null;
    runtime.path = []; runtime.pathTimer = 0; runtime.goal = null; runtime.lootRef = null; runtime.stuck = 0;
    this.cancelHeal(actor);
    this.events.push({ type: 'portal', actorId: actor.id, down: portal.down, from, to: { ...actor.position } });
  }

  /** Deep below the ground: inside a bunker. */
  private underground(actor: Actor): boolean {
    return actor.position.y < this.heightAt(actor.position.x, actor.position.z) - DEEP;
  }

  /**
   * Swing the carried close-combat weapon (or a fist): the nearest person within reach and in front takes the blow. A mirror
   * only starts the swing; the host works out who was hit.
   */
  meleeStrike(actor: Actor = this.player): boolean {
    if (this.state.phase !== 'playing' || !actor.alive || actor.vehicleId || actor.air) return false;
    const runtime = this.runtime(actor);
    const config = actor.melee && isMeleeKind(actor.melee) ? MELEE[actor.melee] : FISTS;
    if (runtime.meleeCooldown > 1e-7) return false;
    runtime.meleeCooldown = config.interval;
    this.cancelHeal(actor);
    if (this.options.remote) return true;
    let target: Actor | null = null, best = config.range;
    for (const other of this.state.actors) {
      if (other === actor || !other.alive || other.air) continue;
      const dx = other.position.x - actor.position.x, dz = other.position.z - actor.position.z, d = Math.hypot(dx, dz);
      if (d > best || Math.abs(other.position.y - actor.position.y) > 1.6) continue;
      // In front of the swing: within about 55 degrees of where the actor faces.
      const facing = Math.sin(actor.yaw) * dx + Math.cos(actor.yaw) * dz;
      if (d > 0.4 && facing / d < 0.57) continue;
      const chest = { x: actor.position.x, y: actor.position.y + stanceOf(actor).chest, z: actor.position.z };
      if (!this.lineClear(chest, { x: other.position.x, y: other.position.y + stanceOf(other).chest, z: other.position.z }, true)) continue;
      target = other; best = d;
    }
    this.events.push({ type: 'melee', actorId: actor.id, at: { ...actor.position }, weapon: actor.melee ?? 'fists', ...(target ? { hitId: target.id } : {}) });
    this.alertNearby(actor, 22);
    if (target) this.damage(target, this.absorb(target, config.damage, false), actor.id, { cause: actor.melee ?? 'fists' });
    return true;
  }

  /** How many of something worth `unit` space each (up to `wanted`) still fit in the pack; bots are not limited. */
  private roomFor(actor: Actor, unit: number, wanted: number): number {
    if (!actor.isPlayer || unit <= 0) return wanted;
    return Math.max(0, Math.min(wanted, Math.floor((capacityOf(actor) - usedSpace(actor) + 1e-6) / unit)));
  }

  /** Bolt a spare part from the pack onto a gun (the one in hand unless another is named); what was there goes back to the pack. */
  attachPart(actor: Actor, kind: unknown, weapon: WeaponType = actor.weapon): boolean {
    if (!actor.alive || !isAttachKind(kind) || actor.parts[kind] <= 0 || !actor.ownedWeapons.includes(weapon) || !fits(kind, weapon)) return false;
    const slot = ATTACH[kind].slot, worn = (actor.attach[weapon] ??= {});
    const previous = worn[slot];
    if (previous === kind) return false;
    worn[slot] = kind;
    actor.parts[kind]--;
    // The part taken off goes back in the pack, or on the ground when it no longer fits (a 4x scope is bigger than a 2x).
    if (previous) { if (this.roomFor(actor, spaceOf(previous), 1) >= 1) actor.parts[previous]++; else this.dropLoot(actor, previous, 0.9); }
    if (previous === 'extmag') this.trimMagazine(actor, weapon);
    if (actor.isPlayer) this.tell(actor, `Đã gắn ${ATTACH[kind].label.toLowerCase()}.`);
    return true;
  }

  /** Take a part off a gun and put it in the pack (or on the ground when the pack is full). */
  detachPart(actor: Actor, weapon: WeaponType, slot: unknown): boolean {
    if (!actor.alive || !ATTACH_SLOTS.includes(slot as AttachSlot)) return false;
    const worn = actor.attach[weapon], part = worn?.[slot as AttachSlot];
    if (!worn || !part) return false;
    delete worn[slot as AttachSlot];
    if (part === 'extmag') this.trimMagazine(actor, weapon);
    if (this.roomFor(actor, spaceOf(part), 1) >= 1) actor.parts[part]++; else this.dropLoot(actor, part, 0.9);
    return true;
  }

  /** Rounds above a plain magazine go back to the reserve once the extended magazine is gone. */
  private trimMagazine(actor: Actor, weapon: WeaponType): void {
    const extra = Math.max(0, actor.ammo[weapon] - magazineOf(actor, weapon));
    if (extra > 0) { actor.ammo[weapon] -= extra; actor.reserve[WEAPONS[weapon].ammoType] += extra; }
  }

  /** The grenade G throws: the chosen kind while any is left, otherwise the first kind in the pack. */
  selectedThrow(actor: Actor = this.player): ThrowKind | null {
    if (actor.throwKind && actor.supplies[actor.throwKind] > 0) return actor.throwKind;
    return THROW_ORDER.find(kind => actor.supplies[kind] > 0) ?? null;
  }

  /** Choose which grenade to throw next: the one after the current one that is still in the pack. */
  cycleThrow(actor: Actor = this.player, kind?: unknown): ThrowKind | null {
    const have = THROW_ORDER.filter(item => actor.supplies[item] > 0);
    if (have.length === 0) { actor.throwKind = null; return null; }
    if (isThrowKind(kind) && have.includes(kind)) actor.throwKind = kind;
    else {
      const current = this.selectedThrow(actor);
      actor.throwKind = have[(have.indexOf(current ?? have[0]) + 1) % have.length];
    }
    return actor.throwKind ?? null;
  }

  /**
   * Throw a grenade at a point. It flies in an arc, bounces off the ground and walls and bursts when its fuse runs out (a
   * molotov on its first impact). On a mirror only the pack is updated; the host throws it and the snapshot shows it.
   */
  throwGrenade(actor: Actor, kind: unknown, target: Vec3): boolean {
    if (this.state.phase !== 'playing' || !actor.alive || actor.vehicleId || actor.air) return false;
    if (!isThrowKind(kind) || actor.supplies[kind] <= 0) return false;
    if (![target.x, target.y, target.z].every(Number.isFinite)) return false;
    const runtime = this.runtime(actor);
    if (runtime.throwCooldown > 1e-7 || actor.reloading > 0) return false;
    runtime.throwCooldown = 0.9;
    this.cancelHeal(actor);
    actor.supplies[kind]--;
    if (actor.supplies[kind] <= 0 && actor.throwKind === kind) actor.throwKind = this.selectedThrow(actor);
    if (this.options.remote) return true;
    const chest = { x: actor.position.x, y: actor.position.y + stanceOf(actor).chest, z: actor.position.z };
    const dx = target.x - chest.x, dz = target.z - chest.z, flat = Math.hypot(dx, dz) || 0.001;
    actor.yaw = Math.atan2(dx, dz);
    // A 41 degree lob that lands near the aim point: range = v^2 sin(2a) / g.
    const angle = 0.72, range = Math.max(3, Math.min(48, flat));
    const speed = Math.min(31, Math.sqrt(range * GRENADE_GRAVITY / Math.sin(2 * angle)));
    const lift = Math.max(-3, Math.min(5, (target.y - chest.y) * 0.5));
    const ux = dx / flat, uz = dz / flat;
    const fuse = kind === 'frag' ? 3.6 : kind === 'flash' ? 2.4 : kind === 'smoke' ? 2.0 : 8;
    const from = { x: chest.x + ux * 0.6, y: chest.y + 0.15, z: chest.z + uz * 0.6 };
    this.state.projectiles ??= [];
    this.state.projectiles.push({
      id: ++this.projectileCounter, kind, x: from.x, y: from.y, z: from.z,
      vx: ux * speed * Math.cos(angle), vy: speed * Math.sin(angle) + lift, vz: uz * speed * Math.cos(angle), fuse, owner: actor.id,
    });
    this.events.push({ type: 'throw', actorId: actor.id, kind, from, to: { ...target } });
    this.alertNearby(actor, 30);
    return true;
  }

  /** Move every grenade on, bounce it off the world and burst the ones whose time has come. */
  private stepGrenades(dt: number): void {
    const state = this.state;
    const flying = state.projectiles;
    if (flying && flying.length) {
      for (let i = flying.length - 1; i >= 0; i--) {
        const p = flying[i];
        p.fuse -= dt;
        p.vy -= projectileGravity(p.kind) * dt;
        let nx = p.x + p.vx * dt, ny = p.y + p.vy * dt, nz = p.z + p.vz * dt;
        let bounced = false;
        const length = Math.hypot(nx - p.x, ny - p.y, nz - p.z);
        if (length > 1e-6) {
          const from = { x: p.x, y: p.y, z: p.z }, direction = { x: (nx - p.x) / length, y: (ny - p.y) / length, z: (nz - p.z) / length };
          let hit: number | null = null;
          this.obstacles().querySegment(p.x, p.z, nx, nz, obstacle => {
            const distance = obstacleHit(from, direction, obstacle, length);
            if (distance !== null && (hit === null || distance < hit)) hit = distance;
          });
          if (hit !== null) {
            const stop = Math.max(0, (hit as number) - 0.08);
            nx = p.x + direction.x * stop; ny = p.y + direction.y * stop; nz = p.z + direction.z * stop;
            p.vx *= -0.25; p.vz *= -0.25; p.vy *= 0.5;
            bounced = true;
          }
        }
        const ground = this.supportHeight(nx, nz, ny + 0.2) + 0.12;
        if (ny <= ground) {
          ny = ground;
          if (p.vy < -1.5) { p.vy = -p.vy * 0.35; p.vx *= 0.6; p.vz *= 0.6; bounced = true; }
          else { p.vy = 0; p.vx *= 0.88; p.vz *= 0.88; }
        }
        p.x = nx; p.y = ny; p.z = nz;
        if ((p.kind === 'molotov' || p.kind === 'shell' || p.kind === 'rocket') && bounced) p.fuse = 0;
        // A shell or rocket also bursts on anyone it touches (not its owner in the first instant).
        if ((p.kind === 'shell' || p.kind === 'rocket') && p.fuse > 0 && 6 - p.fuse > 0.12) {
          for (const actor of state.actors) {
            if (!actor.alive || actor.air || actor.id === p.owner && 6 - p.fuse < 0.4) continue;
            if (Math.hypot(actor.position.x - p.x, actor.position.z - p.z) < 0.8 && p.y > actor.position.y - 0.2 && p.y < actor.position.y + stanceOf(actor).height + 0.2) { p.fuse = 0; break; }
          }
        }
        if (p.fuse <= 0) { flying.splice(i, 1); this.detonate(p); }
      }
    }
    // Smoke thins away; fire burns whoever stands in it.
    if (state.smokes && state.smokes.length) state.smokes = state.smokes.filter(smoke => smoke.until > state.elapsed);
    const fires = state.fires;
    if (fires && fires.length) {
      for (const fire of fires) {
        fire.tick -= dt;
        if (fire.tick > 0) continue;
        fire.tick = 0.25;
        for (const actor of state.actors) {
          if (!actor.alive || actor.air || Math.abs(actor.position.y - fire.y) > 2.5) continue;
          if (Math.hypot(actor.position.x - fire.x, actor.position.z - fire.z) <= fire.radius) this.damage(actor, FIRE_DPS * 0.25, fire.owner, { cause: 'fire' });
        }
      }
      state.fires = fires.filter(fire => fire.until > state.elapsed);
    }
  }

  private detonate(p: Projectile): void {
    const state = this.state, position = { x: p.x, y: p.y, z: p.z };
    if (p.kind === 'frag' || p.kind === 'shell' || p.kind === 'rocket') {
      const blast = BLASTS[p.kind];
      const center = { x: p.x, y: p.y + 0.4, z: p.z };
      this.events.push({ type: 'explosion', position: { ...position }, radius: blast.radius });
      for (const actor of state.actors) {
        if (!actor.alive || actor.air) continue;
        const chest = { x: actor.position.x, y: actor.position.y + stanceOf(actor).chest, z: actor.position.z };
        const d = Math.hypot(chest.x - center.x, chest.y - center.y, chest.z - center.z);
        if (d > blast.radius || (d > 0.8 && !this.lineClear(center, chest, true))) continue;
        const raw = blast.damage * Math.pow(1 - d / blast.radius, 1.15);
        this.damage(actor, this.absorb(actor, raw, false), p.owner, { cause: p.kind });
      }
      for (const car of state.vehicles) {
        const d = Math.hypot(car.position.x - p.x, car.position.y + 0.8 - p.y, car.position.z - p.z);
        if (d < blast.radius - 1 && car.health > 0) this.damageVehicle(car, blast.vehicle * (1 - d / (blast.radius - 1)), p.owner);
      }
      this.alertNearby(this.actorById(p.owner) ?? this.player, 120);
    } else if (p.kind === 'smoke') {
      (state.smokes ??= []).push({ id: p.id, x: p.x, y: p.y, z: p.z, radius: SMOKE_RADIUS, born: state.elapsed, until: state.elapsed + SMOKE_SECONDS });
      this.events.push({ type: 'smoke', position });
    } else if (p.kind === 'flash') {
      const center = { x: p.x, y: p.y + 0.4, z: p.z };
      this.events.push({ type: 'flash', position });
      for (const actor of state.actors) {
        if (!actor.alive || actor.air) continue;
        const head = { x: actor.position.x, y: actor.position.y + stanceOf(actor).aimY, z: actor.position.z };
        const d = Math.hypot(head.x - center.x, head.y - center.y, head.z - center.z);
        if (d > FLASH_RANGE || !this.lineClear(center, head)) continue;
        // Looking at it hurts most; with your back to it you still catch the glare.
        const toX = (center.x - head.x) / (d || 1), toZ = (center.z - head.z) / (d || 1);
        const facing = Math.max(0, Math.sin(actor.yaw) * toX + Math.cos(actor.yaw) * toZ);
        const seconds = 6 * (1 - d / FLASH_RANGE) * (0.3 + 0.7 * facing);
        if (seconds > 0.25) actor.blind = Math.max(actor.blind ?? 0, seconds);
        if (!actor.isPlayer && seconds > 0.25) this.runtime(actor).targetId = null;
      }
    } else {
      (state.fires ??= []).push({ id: p.id, x: p.x, y: p.y, z: p.z, radius: FIRE_RADIUS, until: state.elapsed + FIRE_SECONDS, owner: p.owner, tick: 0 });
      this.events.push({ type: 'fire', position });
    }
  }

  /** A bot with grenades uses them now and then on an enemy it can see at a middling range. */
  private botThrow(actor: Actor, runtime: Runtime, target: Actor): void {
    if (runtime.throwCooldown > 0 || !THROW_ORDER.some(kind => actor.supplies[kind] > 0) || this.throwRandom() > 0.006) return;
    const d = distance2(actor.position, target.position);
    if (d < 10 || d > 38) return;
    const options = THROW_ORDER.filter(kind => actor.supplies[kind] > 0 && (kind !== 'smoke' || actor.health < 50) && (kind !== 'flash' || d < 24));
    if (options.length === 0) return;
    const kind = options[Math.floor(this.throwRandom() * options.length)];
    const lead = kind === 'smoke' ? 0.4 : 1;
    const to = { x: actor.position.x + (target.position.x - actor.position.x) * lead + runtime.enemyVel.x * 0.8, y: target.position.y, z: actor.position.z + (target.position.z - actor.position.z) * lead + runtime.enemyVel.z * 0.8 };
    this.throwGrenade(actor, kind, to);
  }

  /** Pick the inventory row the player chose, rather than whichever item happens to be nearest. */
  pickupLoot(id: string, actor: Actor = this.player): boolean {
    if (typeof id !== 'string' || !id || id.length > 128) return false;
    const loot = this.nearbyLoot(actor).find(item => item.id === id);
    return loot ? this.takeLoot(actor, loot) : false;
  }

  private takeLoot(actor: Actor, loot: Loot): boolean {
    if (!this.collectLoot(actor, loot)) return false;
    this.events.push(this.options.humans > 1 ? { type: 'pickup', kind: loot.kind, for: actor.id } : { type: 'pickup', kind: loot.kind });
    return true;
  }

  /** Drop carried gear as a real pickup. The final gun is kept because every actor must have a weapon in hand. */
  dropItem(kind: LootKind, amount = 1, actor: Actor = this.player): boolean {
    if (this.state.phase !== 'playing' || !actor.alive || actor.vehicleId || actor.air || typeof kind !== 'string' || !Number.isSafeInteger(amount) || amount < 1 || amount > 1_000_000) return false;
    if (isWeaponKind(kind)) {
      if (amount !== 1 || !actor.ownedWeapons.includes(kind) || actor.ownedWeapons.length <= 1) return false;
      const held = actor.weapon === kind;
      this.dropWeapon(actor, kind, false);
      if (held) {
        this.cancelHeal(actor);
        this.runtime(actor).cooldown = Math.max(this.runtime(actor).cooldown, 0.25);
      }
    } else if (kind === 'medkit') {
      const count = Math.min(amount, actor.medkits);
      if (count <= 0) return false;
      this.cancelHeal(actor);
      actor.medkits -= count;
      this.dropLoot(actor, kind, 0.8, { amount: count });
    } else if (isMeleeKind(kind)) {
      if (amount !== 1 || actor.melee !== kind) return false;
      actor.melee = null;
      this.dropLoot(actor, kind, 0.8);
    } else if (isPackKind(kind)) {
      if (amount !== 1 || actor.pack !== PACKS[kind as PackKind].level) return false;
      if (usedSpace(actor) > PACK_BASE) { if (actor.isPlayer) this.tell(actor, 'Hãy vứt bớt đồ trước: không có ba lô thì mang được ít hơn.'); return false; }
      actor.pack = 0;
      this.dropLoot(actor, kind, 0.8);
    } else if (isAttachKind(kind)) {
      const part = kind as AttachKind, count = Math.min(amount, actor.parts[part]);
      if (count <= 0) return false;
      actor.parts[part] -= count;
      this.dropLoot(actor, part, 0.8, { amount: count });
    } else if (isSupplyKind(kind)) {
      const supply = kind as SupplyKind; // (weapon ids are plain strings, so the guard above leaves nothing for the compiler to narrow)
      const count = Math.min(amount, actor.supplies[supply]);
      if (count <= 0) return false;
      if (actor.healing > 0 && actor.healKind === supply) this.cancelHeal(actor);
      actor.supplies[supply] -= count;
      this.dropLoot(actor, supply, 0.8, { amount: count });
    } else if (isArmorKind(kind)) {
      const { slot, level } = parseArmor(kind);
      if (amount !== 1 || actor[slot] !== level || actor[`${slot}Hp`] <= 0) return false;
      this.dropLoot(actor, kind, 0.8, { durability: actor[`${slot}Hp`] });
      actor[slot] = 0;
      actor[`${slot}Hp`] = 0;
    } else {
      const ammo = ammoTypeOf(kind);
      if (!ammo) return false;
      const count = Math.min(amount, actor.reserve[ammo]);
      if (count <= 0) return false;
      const runtime = this.runtime(actor);
      if (actor.reloading > 0 && WEAPONS[runtime.reloadWeapon ?? actor.weapon].ammoType === ammo) {
        actor.reloading = 0;
        runtime.reloadWeapon = null;
      }
      actor.reserve[ammo] -= count;
      this.dropLoot(actor, kind, 0.8, { amount: count });
    }
    return true;
  }

  /**
   * Give an actor the item and retire it from the world. Loadout rules: two main guns and one sidearm; a full group
   * swaps out the gun in hand (or the weakest). Armour only replaces a lower tier, and the old piece is dropped.
   */
  private collectLoot(actor: Actor, loot: Loot): boolean {
    const kind = loot.kind;
    if (isWeaponKind(kind)) {
      const loaded = loot.loadedAmmo ?? WEAPONS[kind].magazine;
      if (!Number.isSafeInteger(loaded) || loaded < 0 || loaded > WEAPONS[kind].magazine) return false;
      const ammo = WEAPONS[kind].ammoType;
      if (actor.ownedWeapons.includes(kind)) {
        // A second copy of a gun only empties its magazine into the pack, as far as the pack allows.
        const take = this.roomFor(actor, spaceOf(ammoKindOf(ammo), ammo), loaded);
        if (take < loaded && take < 1) { if (actor.isPlayer) this.tell(actor, 'Ba lô đã đầy.'); return false; }
        actor.reserve[ammo] += take;
        if (take < loaded) { loot.loadedAmmo = loaded - take; return true; }
      } else {
        const sidearm = isSidearm(kind);
        const group = actor.ownedWeapons.filter(w => isSidearm(w) === sidearm);
        let equip = false;
        if (group.length >= (sidearm ? 1 : PRIMARY_SLOTS)) {
          const out = group.includes(actor.weapon) ? actor.weapon : weakestWeapon(group);
          equip = out === actor.weapon;
          this.dropWeapon(actor, out);
        }
        actor.ownedWeapons.push(kind);
        actor.ammo[kind] = loaded;
        // A fresh world gun comes with a spare magazine; what the pack cannot hold is left on the ground.
        if (loot.loadedAmmo === undefined) {
          const spare = WEAPONS[kind].magazine, take = this.roomFor(actor, spaceOf(ammoKindOf(ammo), ammo), spare);
          actor.reserve[ammo] += take;
          if (take < spare) this.dropLoot(actor, ammoKindOf(ammo), 0.8, { amount: spare - take });
        }
        // Taking a gun while the matching slot was empty keeps the weapon in hand; a swap equips the new one.
        if (equip && actor.isPlayer) { actor.weapon = kind; actor.reloading = 0; this.runtime(actor).reloadWeapon = null; }
        else if (equip) this.botSwitch(actor, kind);
      }
    } else if (isMeleeKind(kind)) {
      if (actor.melee === kind) { if (actor.isPlayer) this.tell(actor, 'Bạn đã có món này rồi.'); return false; }
      if (actor.melee) this.dropLoot(actor, actor.melee, 0.9);
      actor.melee = kind as MeleeKind;
    } else if (isPackKind(kind)) {
      const pack = kind as PackKind, level = PACKS[pack].level;
      if (level <= actor.pack) {
        if (actor.isPlayer) this.tell(actor, 'Bạn đã có ba lô tốt hơn.');
        return false;
      }
      // The old pack is left on the ground; what was in it moves into the new one.
      if (actor.pack > 0) this.dropLoot(actor, `pack${actor.pack}` as PackKind, 0.9);
      actor.pack = level;
    } else if (isAttachKind(kind)) {
      const part = kind as AttachKind, amount = loot.amount ?? 1;
      if (!Number.isSafeInteger(amount) || amount < 1) return false;
      const take = Math.min(amount, this.roomFor(actor, spaceOf(part), amount));
      if (take < 1) { if (actor.isPlayer) this.tell(actor, 'Ba lô đã đầy.'); return false; }
      actor.parts[part] += take;
      if (take < amount) { loot.amount = amount - take; return true; }
      // A person's own gun in hand takes a part it fits straight away when that place is free.
      if (actor.isPlayer && actor.parts[part] > 0 && fits(part, actor.weapon) && !attachmentsOf(actor, actor.weapon)[ATTACH[part].slot]) this.attachPart(actor, part);
    } else if (kind === 'medkit') {
      const amount = loot.amount ?? 1;
      if (!Number.isSafeInteger(amount) || amount < 1) return false;
      const take = Math.min(amount, this.roomFor(actor, spaceOf('medkit'), amount));
      if (take < 1) { if (actor.isPlayer) this.tell(actor, 'Ba lô đã đầy.'); return false; }
      actor.medkits += take;
      if (take < amount) { loot.amount = amount - take; return true; }
    } else if (isSupplyKind(kind)) {
      const supply = kind as SupplyKind, config = SUPPLIES[supply], amount = loot.amount ?? config.stack;
      if (!Number.isSafeInteger(amount) || amount < 1) return false;
      if (actor.supplies[supply] >= config.max) {
        if (actor.isPlayer) this.tell(actor, `Bạn không mang thêm được ${config.label.toLowerCase()}.`);
        return false;
      }
      const take = Math.min(amount, config.max - actor.supplies[supply], this.roomFor(actor, spaceOf(supply), amount));
      if (take < 1) { if (actor.isPlayer) this.tell(actor, 'Ba lô đã đầy.'); return false; }
      actor.supplies[supply] += take;
      if (config.group === 'throw' && !actor.throwKind) actor.throwKind = supply as ThrowKind;
      if (take < amount) { loot.amount = amount - take; return true; }
    } else if (isArmorKind(kind)) {
      const { slot, level } = parseArmor(kind);
      const durability = loot.durability ?? ARMOR_DURABILITY[level];
      if (!Number.isFinite(durability) || durability <= 0 || durability > ARMOR_DURABILITY[level]) return false;
      if (level <= actor[slot]) {
        if (actor.isPlayer) this.tell(actor, `Bạn đã có ${ARMOR_NAMES[slot].toLowerCase()} tốt hơn.`);
        return false;
      }
      if (actor[slot] > 0) this.dropLoot(actor, armorKind(slot, actor[slot]), 0.9, { durability: actor[`${slot}Hp`] });
      actor[slot] = level;
      actor[`${slot}Hp`] = durability;
    } else {
      const ammo = ammoTypeOf(kind);
      if (!ammo) return false;
      const amount = loot.amount ?? AMMO_PICKUP[ammo];
      if (!Number.isSafeInteger(amount) || amount < 1) return false;
      const take = Math.min(amount, this.roomFor(actor, spaceOf(kind, ammo), amount));
      if (take < 1) { if (actor.isPlayer) this.tell(actor, 'Ba lô đã đầy.'); return false; }
      actor.reserve[ammo] += take;
      if (take < amount) { loot.amount = amount - take; return true; }
    }
    loot.active = false;
    return true;
  }

  private dropCounter = 0;
  private projectileCounter = 0;

  /** Place an item on the ground beside an actor, keeping its exact inventory contents. */
  private dropLoot(actor: Actor, kind: LootKind, offset: number, contents: Pick<Loot, 'amount' | 'loadedAmmo' | 'durability'> = {}): void {
    const angle = (this.dropCounter * 2.399) % (Math.PI * 2);
    const x = actor.position.x + Math.cos(angle) * offset, z = actor.position.z + Math.sin(angle) * offset;
    const spot = this.walkable({ x, z }, 0.05) ? { x, z } : { x: actor.position.x, z: actor.position.z };
    this.state.loot.push({ id: `drop-${actor.id}-${this.dropCounter++}`, kind, position: { x: spot.x, y: this.supportHeight(spot.x, spot.z, actor.position.y), z: spot.z }, active: true, ...contents });
  }

  /** Slot swaps return rounds to the reserve; manual drops keep them in the dropped magazine. */
  private dropWeapon(actor: Actor, weapon: WeaponType, returnRounds = true): void {
    // The parts come off and lie beside it; rounds beyond a plain magazine go back to the pack.
    const worn = attachmentsOf(actor, weapon);
    for (const slot of ATTACH_SLOTS) { const part = worn[slot]; if (part) this.dropLoot(actor, part, 1.0 + ATTACH_SLOTS.indexOf(slot) * 0.1); }
    delete actor.attach[weapon];
    const extra = Math.max(0, actor.ammo[weapon] - WEAPONS[weapon].magazine);
    if (extra > 0) { actor.ammo[weapon] -= extra; actor.reserve[WEAPONS[weapon].ammoType] += extra; }
    const loaded = actor.ammo[weapon];
    actor.ownedWeapons = actor.ownedWeapons.filter(w => w !== weapon);
    if (returnRounds) actor.reserve[WEAPONS[weapon].ammoType] += loaded;
    actor.ammo[weapon] = 0;
    this.dropLoot(actor, weapon, 0.8, { loadedAmmo: returnRounds ? 0 : loaded });
    const runtime = this.runtime(actor);
    if (runtime.reloadWeapon === weapon) { actor.reloading = 0; runtime.reloadWeapon = null; }
    if (actor.weapon === weapon && actor.ownedWeapons.length) actor.weapon = actor.ownedWeapons[0];
  }

  /** Armour soaks part of a hit and wears down; a broken piece disappears. */
  private absorb(victim: Actor, amount: number, head: boolean): number {
    if (victim.reconnecting) return 0;
    if (this.rangeMode && victim.isPlayer && (victim.practice?.immortal ?? this.immortal)) return 0;
    const slot: ArmorSlot = head ? 'helmet' : 'vest';
    const level = victim[slot];
    if (!level) return amount;
    const key = `${slot}Hp` as const;
    const absorbed = Math.min(amount * ARMOR_REDUCTION[level], victim[key]);
    victim[key] -= absorbed;
    if (victim[key] <= 1e-6) {
      victim[slot] = 0;
      victim[key] = 0;
      if (victim.isPlayer) this.tell(victim, `${ARMOR_NAMES[slot]} đã bị phá hỏng!`);
    }
    return amount - absorbed;
  }

  /** A message only that human should see (in single player it is just a message). */
  private tell(actor: Actor, text: string): void {
    this.events.push(this.options.humans > 1 ? { type: 'message', text, for: actor.id } : { type: 'message', text });
  }

  private throwRandom(): number {
    this.throwState = (this.throwState + 0x6d2b79f5) | 0;
    let value = this.throwState;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  private lootRandom(): number {
    this.lootState = (this.lootState + 0x6d2b79f5) | 0;
    let value = this.lootState;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  private random(): number {
    this.randomState = (this.randomState + 0x6d2b79f5) | 0;
    let value = this.randomState;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  private makeState(phase: GamePhase): GameState {
    this.randomState = this.options.seed | 0;
    this.runtimes.clear();
    this.inputs.clear(); this.jumpHeldBy.clear(); this.pendingPresses.clear();
    this.shrinkStart = null;
    this.dropTargets = [];
    const island = this.openWorld;
    const humanCount = this.options.humans;
    const count = this.options.botCount + humanCount;
    let spawns = this.world.spawns;
    if (island) {
      // Scatter everyone across the map: a seeded shuffle of the candidate drop points.
      spawns = this.world.spawns.slice();
      for (let i = spawns.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [spawns[i], spawns[j]] = [spawns[j], spawns[i]];
      }
    }
    const actors: Actor[] = this.rangeMode ? this.makeRangeActors() : spawns.slice(0, count).map((spawn, index) => {
      const botWeapons: WeaponType[] = island
        ? ['pistol']
        : ['rifle', 'smg', 'shotgun', 'dmr', this.options.seed % 2 === 0 ? 'heavySniper' : 'sniper', 'pistol', 'lmg'];
      // On the island everyone drops in with a sidearm and has to loot the rest.
      const human = index < humanCount;
      const weapon: WeaponType = human ? (island ? 'pistol' : 'rifle') : botWeapons[(index - humanCount) % botWeapons.length];
      const ammo = emptyAmmo();
      const reserve = emptyReserve();
      ammo[weapon] = WEAPONS[weapon].magazine;
      reserve[WEAPONS[weapon].ammoType] = human ? (island ? WEAPONS.pistol.ammoPickup : 60) : WEAPONS[weapon].ammoPickup * (island ? 1 : 3);
      const actor: Actor = {
        id: human ? (humanCount === 1 ? 'player' : `p${index}`) : `bot-${index - humanCount + 1}`,
        name: human ? (this.options.names[index] ?? (humanCount === 1 ? 'Bạn' : `Người chơi ${index + 1}`)) : `Đối thủ ${index - humanCount + 1}`,
        isPlayer: human, position: { x: spawn.x, y: this.heightAt(spawn.x, spawn.z), z: spawn.z }, yaw: human ? 0 : this.random() * Math.PI * 2,
        health: 100, alive: true, weapon, ownedWeapons: [weapon], helmet: 0, vest: 0, helmetHp: 0, vestHp: 0,
        ammo, reserve,
        reloading: 0, healing: 0, medkits: 1, hurtTimer: 0, supplies: emptySupplies(), boost: 0, healKind: null, throwKind: null, blind: 0, pack: 0, attach: {}, parts: emptyParts(), melee: null,
      };
      this.runtime(actor);
      return actor;
    });
    this.humanList = actors.filter(actor => actor.isPlayer);
    this.localActor = actors.find(actor => actor.id === this.options.localId) ?? actors[0];
    const loot: Loot[] = [];
    const add = (kind: LootKind, x: number, z: number, y = 0) => loot.push({ id: `loot-${loot.length}`, kind, position: { x, y, z }, active: true });
    this.lootState = (this.options.seed ^ 0x2f6e2b1) | 0;
    this.throwState = (this.options.seed ^ 0x51ed270b) | 0;
    if (island) this.scatterIslandLoot(add);
    else if (this.rangeMode) this.scatterRangeLoot(add);
    else this.scatterArenaLoot(add);
    const profile = this.world.zone;
    const zone: ZoneState = {
      center: { x: 0, z: 0 }, radius: profile.start, nextCenter: { x: 0, z: 0 }, nextRadius: profile.radii[0],
      stage: 0, timeRemaining: profile.waits[0], isShrinking: false,
    };
    zone.nextCenter = this.nextZoneCenter(zone.center, zone.radius, zone.nextRadius);
    const vehicles: Vehicle[] = this.world.vehicleSpawns.map((spawn, index) => ({
      id: `car-${index}`, position: { x: spawn.x, y: this.heightAt(spawn.x, spawn.z), z: spawn.z }, yaw: spawn.yaw, speed: 0,
      kind: this.world.vehicleKinds?.[index] ?? vehicleKindFor(index), health: VEHICLES[this.world.vehicleKinds?.[index] ?? vehicleKindFor(index)].health, driverId: null, colorIndex: index % 5, hitTimer: 0,
    }));
    const plane = this.options.drop && island && phase === 'playing' ? makePlane(this.world.halfSize, () => this.random()) : null;
    if (plane) {
      zone.timeRemaining += plane.length / plane.speed + DROP.zoneGrace;
      for (const actor of actors) {
        actor.position = { x: plane.x, y: plane.y, z: plane.z };
        actor.yaw = plane.yaw;
        actor.air = { mode: 'plane', vx: 0, vy: 0, vz: 0, time: 0 };
        if (!actor.isPlayer) this.runtime(actor).drop = this.planDrop(plane);
      }
      const leader = this.humanList.find(actor => actor.id === this.options.dropLeaderId);
      if (leader) for (const human of this.humanList) if (human !== leader) human.dropFollowing = leader.id;
    }
    return { phase, elapsed: 0, actors, loot, vehicles, zone, kills: 0, shots: 0, hits: 0, plane, airdrops: [], projectiles: [], smokes: [], fires: [], localId: this.localActor?.id };
  }

  /** Weighted gear tables: later tiers (cities, big houses) hold the heavy weapons. */
  private scatterIslandLoot(add: (kind: LootKind, x: number, z: number, y?: number) => void): void {
    const tables = LOOT_TABLES;
    for (const spot of this.world.lootSpots) {
      const table = tables[spot.tier];
      for (let pick = 0; pick < 2; pick++) {
        let roll = this.lootRandom();
        let kind: LootKind = table[0][0];
        for (const [candidate, weight] of table) { kind = candidate; if ((roll -= weight) < 0) break; }
        const x = spot.x + (this.lootRandom() - 0.5) * 2.4, z = spot.z + (this.lootRandom() - 0.5) * 2.4;
        const put = (item: LootKind, px: number, pz: number) => { const p = this.settleLoot(spot, px, pz); add(item, p.x, p.z, p.y); };
        put(kind, x, z);
        if (pick === 0 && spot.bias === 'medical') put('medkit', x - 0.8, z - 0.6);
        if (isWeaponKind(kind)) put(ammoKindFor(kind), x + 0.7, z + 0.5);
        else if (this.lootRandom() < 0.5) put(ammoKindOf(COMMON_AMMO[Math.floor(this.lootRandom() * COMMON_AMMO.length)]), x + 0.7, z + 0.5);
      }
    }
  }

  /**
   * Where a pickup scattered around `spot` can lie: pulled back towards the spot until it rests on the spot's own floor or
   * ground, clear of walls, crates and water. Without this an item lands inside a wall, in a crate or off a floor's edge.
   */
  private settleLoot(spot: Vec3, x: number, z: number): Vec3 {
    for (const t of [1, 0.5, 0]) {
      const px = spot.x + (x - spot.x) * t, pz = spot.z + (z - spot.z) * t;
      const y = this.supportHeight(px, pz, spot.y + 0.3);
      if (Math.abs(y - spot.y) < 0.6 && this.walkable({ x: px, z: pz }, 0.15, y, 0.9)) return { x: px, y, z: pz };
    }
    return { x: spot.x, y: spot.y, z: spot.z };
  }

  private scatterArenaLoot(add: (kind: LootKind, x: number, z: number, y?: number) => void): void {
    add('shotgun', -1.6, -64.3); add('556Ammo', 1.6, -64.3); add('medkit', 0, -66.7); add('12gAmmo', 2.3, -66);
    // A labelled eight-weapon cache at spawn lets players try every gun without searching the map.
    const weaponCache: Record<string, Vec2> = {
      rifle: { x: -3, z: -62.5 }, shotgun: { x: -1.6, z: -64.3 },
      smg: { x: -1, z: -62.5 }, pistol: { x: 1, z: -62.5 }, dmr: { x: 3, z: -62.5 },
      sniper: { x: -3, z: -66 }, heavySniper: { x: -1, z: -66 }, lmg: { x: 3, z: -64.5 },
    };
    CORE_WEAPONS.forEach(weapon => { if (weapon !== 'shotgun') add(weapon, weaponCache[weapon].x, weaponCache[weapon].z); });
    AMMO_ORDER.forEach((ammo, index) => add(ammoKindOf(ammo), (index - 3.5) * 2, -70));
    this.layOutArmoury(add);
    const cachePositions = [
      [-22, -42], [19, -41], [-12, -29], [19, -17], [-27, 8], [23, 12],
      [-5, 20], [18, 42], [-33, 51], [-52, -28], [52, -43], [-62, 15], [55, 50], [0, 68],
    ];
    for (let i = 0; i < cachePositions.length; i++) {
      const [x, z] = cachePositions[i];
      const weapon = CORE_WEAPONS[i % CORE_WEAPONS.length];
      add(ammoKindFor(weapon), x, z);
      add(i % 3 === 0 ? 'medkit' : weapon, x + 1.2, z + 0.8);
    }
  }

  /** Every gun not in the spawn cache, racked by class behind the spawn point so they can all be handled in the arena. */
  private layOutArmoury(add: (kind: LootKind, x: number, z: number, y?: number) => void): void {
    const core = new Set<string>(CORE_WEAPONS);
    // Twenty to a shelf keeps every row (one class or more per row) inside the 100 m arena edge.
    const columns = 20;
    let index = 0;
    for (const guns of Object.values(GUNS_BY_CLASS)) {
      for (const gun of guns) {
        if (core.has(gun)) continue;
        add(gun, (index % columns - (columns - 1) / 2) * 1.7, -74 - Math.floor(index / columns) * 1.7);
        index++;
      }
      // Each class starts on a fresh row so the rows read as shelves.
      index = Math.ceil(index / columns) * columns;
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // The shooting range.
  // -------------------------------------------------------------------------------------------------------------

  private rangeBotWeapon(): WeaponType {
    const pool = WEAPON_ORDER.filter(id => WEAPONS[id].kind !== 'bow' && WEAPONS[id].kind !== 'launcher');
    return pool[Math.floor(this.random() * pool.length)];
  }

  private blankActor(id: string, name: string, isPlayer: boolean, x: number, z: number, yaw: number, weapon: WeaponType): Actor {
    const ammo = emptyAmmo(), reserve = emptyReserve();
    ammo[weapon] = WEAPONS[weapon].magazine;
    reserve[WEAPONS[weapon].ammoType] = WEAPONS[weapon].ammoPickup * 3;
    return {
      id, name, isPlayer, position: { x, y: 0, z }, yaw, health: 100, alive: true, weapon, ownedWeapons: [weapon], helmet: 0, vest: 0, helmetHp: 0, vestHp: 0,
      ammo, reserve, reloading: 0, healing: 0, medkits: 1, hurtTimer: 0, supplies: emptySupplies(), boost: 0, healKind: null, throwKind: null, blind: 0, pack: 0,
      attach: {}, parts: emptyParts(), melee: null,
    };
  }

  /** Everyone has their own place at the firing line, beside the shared targets and bot yard. */
  private makeRangeActors(): Actor[] {
    const layout = this.world.range!;
    const actors: Actor[] = Array.from({ length: this.options.humans }, (_, index) => {
      const spawn = this.rangeSpawn(index), solo = this.options.humans === 1;
      const actor = this.blankActor(solo ? 'player' : `p${index}`, this.options.names[index] ?? (solo ? 'Bạn' : `Người chơi ${index + 1}`), true, spawn.x, spawn.z, 0, 'rifle');
      actor.practice = { immortal: this.immortal, shots: 0, hits: 0, drill: null };
      return actor;
    });
    for (let i = 0; i < this.options.botCount; i++) {
      const spawn = layout.botSpawns[i % layout.botSpawns.length];
      actors.push(this.blankActor(`bot-${i + 1}`, `Đối thủ ${i + 1}`, false, spawn.x, spawn.z, this.random() * Math.PI * 2, this.rangeBotWeapon()));
    }
    this.dummySpecs.clear();
    for (const spec of layout.dummies) {
      const dummy = this.blankActor(spec.id, 'Bia', false, spec.x, spec.z, Math.PI, 'pistol');
      dummy.dummy = true;
      this.dummySpecs.set(spec.id, spec);
      actors.push(dummy);
    }
    for (const actor of actors) this.runtime(actor);
    return actors;
  }

  private rangeSpawn(index: number): Vec3 {
    const spawn = this.world.range!.playerSpawn;
    return { ...spawn, x: spawn.x + (index - (this.options.humans - 1) / 2) * 2.4 };
  }

  /** Every gun racked behind the firing line, class by class, with ammunition, parts, supplies and armour in front of the racks. */
  private scatterRangeLoot(add: (kind: LootKind, x: number, z: number, y?: number) => void): void {
    const base = (this.world.range?.firingZ ?? -150) - 12;
    let row = 0;
    for (const guns of Object.values(GUNS_BY_CLASS)) {
      for (let i = 0; i < guns.length; i += 24) {
        guns.slice(i, i + 24).forEach((gun, j) => add(gun, (j - 11.5) * 2.1, base - row * 1.9));
        row++;
      }
    }
    const extras: LootKind[] = [...AMMO_ORDER.map(ammoKindOf), ...ATTACH_ORDER, ...SUPPLY_ORDER, 'medkit', 'helmet1', 'helmet2', 'helmet3', 'vest1', 'vest2', 'vest3', ...PACK_ORDER, ...MELEE_ORDER];
    extras.forEach((kind, i) => add(kind, (i % 22 - 10.5) * 2.2, base + 3.2 - Math.floor(i / 22) * 1.9));
  }

  /** Put someone back on their feet where they stood. */
  private revive(actor: Actor, at: Vec3): void {
    actor.alive = true; actor.health = 100; actor.hurtTimer = 0; actor.reloading = 0; actor.healing = 0; actor.blind = 0;
    actor.position = { x: at.x, y: this.heightAt(at.x, at.z), z: at.z };
    delete actor.diedAt; delete actor.rank;
    if (actor.isPlayer) { delete this.state.playerRank; delete this.state.diedAt; }
  }

  /** A bot that fell comes back with a different gun, from any of the yard's spawn points. */
  private reviveBot(actor: Actor): void {
    const weapon = this.rangeBotWeapon();
    actor.weapon = weapon; actor.ownedWeapons = [weapon];
    actor.ammo = emptyAmmo(); actor.reserve = emptyReserve(); actor.attach = {};
    actor.ammo[weapon] = WEAPONS[weapon].magazine;
    actor.reserve[WEAPONS[weapon].ammoType] = WEAPONS[weapon].ammoPickup * 3;
    const spots = this.world.range!.botSpawns;
    this.revive(actor, spots[Math.floor(this.random() * spots.length)]);
    this.runtimes.delete(actor.id);
    this.runtime(actor);
  }

  /** The range keeps the player supplied (ammunition, parts, supplies), stands targets and bots back up, and sends the player back to the line. */
  private stepRange(dt: number): void {
    if (!this.rangeMode) return;
    void dt;
    const now = this.state.elapsed;
    for (const [index, player] of this.humans.entries()) {
      if (player.practice?.left) continue;
      if (player.alive) {
        for (const type of AMMO_ORDER) player.reserve[type] = Math.max(player.reserve[type], 400);
        for (const kind of ATTACH_ORDER) player.parts[kind] = Math.max(player.parts[kind], 2);
        for (const kind of SUPPLY_ORDER) player.supplies[kind] = Math.max(player.supplies[kind], 3);
        player.medkits = Math.max(player.medkits, 3);
        player.pack = 3;
      } else if (now - (player.diedAt ?? now) > 2) {
        this.revive(player, this.rangeSpawn(index));
        this.runtimes.delete(player.id);
        this.setHumanInput(player.id, ZERO_INPUT);
      }
      const drill = player.practice?.drill;
      if (drill && !drill.done && now >= drill.endsAt) {
        drill.done = true;
        this.tell(player, `Hết giờ · ${DRILLS[drill.id as keyof typeof DRILLS]?.name ?? 'Bài tập'}: ${drill.score} điểm, hạng ${drillGrade(drill.id as keyof typeof DRILLS, drill.score)}.`);
      }
    }
    for (const actor of this.state.actors) {
      if (actor.isPlayer) continue;
      const spec = actor.dummy ? this.dummySpecs.get(actor.id) : undefined;
      const motion = spec?.motion;
      // A ducked target comes back with the next rising of its cycle, standing up fresh; the rest wait a moment.
      if (motion?.kind === 'pop') {
        const up = popUp(motion, now);
        if (up && actor.hidden) { actor.hidden = false; if (!actor.alive) this.revive(actor, { x: spec!.x, y: 0, z: spec!.z }); }
        else if (!up && !actor.hidden) actor.hidden = true;
        continue;
      }
      if (!actor.alive) {
        if (now - (actor.diedAt ?? now) < (actor.dummy ? 2.5 : 6)) continue;
        if (spec) this.revive(actor, { x: spec.x, y: 0, z: spec.z }); else this.reviveBot(actor);
        continue;
      }
      if (spec?.sway) actor.position.x = spec.x + Math.sin(now * Math.PI * 2 / spec.sway.period + spec.sway.phase) * spec.sway.amp;
      if (motion?.kind === 'run') {
        const { x, dir } = runState(motion, now);
        actor.position.x = x;
        if (dir !== 0) actor.yaw = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      }
    }
    // A wrecked vehicle is replaced after a few seconds.
    this.state.vehicles.forEach((car, index) => {
      if (car.health > 0) { this.wrecked.delete(car.id); return; }
      const since = this.wrecked.get(car.id) ?? (this.wrecked.set(car.id, now), now);
      if (now - since > 6) this.resetVehicle(car, index);
    });
  }

  private wrecked = new Map<string, number>();

  /** Put a vehicle back at its parking spot, whole and empty. */
  private resetVehicle(car: Vehicle, index: number): void {
    const spawn = this.world.vehicleSpawns[index];
    if (!spawn) return;
    const driver = this.vehicleDriver(car);
    if (driver) this.exitVehicle(driver);
    const kind = this.world.vehicleKinds?.[index] ?? vehicleKindFor(index);
    car.position = { x: spawn.x, y: this.heightAt(spawn.x, spawn.z), z: spawn.z };
    car.yaw = spawn.yaw; car.speed = 0; car.health = VEHICLES[kind].health; car.hitTimer = 0; car.driverId = null;
    this.wrecked.delete(car.id);
  }

  /** The range: every vehicle back where it started (the L key and the panel button). */
  rangeResetVehicles(actor: Actor = this.player): boolean {
    if (!this.rangeMode || this.state.phase !== 'playing') return false;
    this.state.vehicles.forEach((car, index) => this.resetVehicle(car, index));
    this.tell(actor, 'Đã đưa mọi xe về bãi.');
    return true;
  }

  /** Begin a timed drill: every target stands up, the clock starts, and the score is cleared. */
  startDrill(id: unknown, player: Actor = this.player): boolean {
    if (!this.rangeMode || this.state.phase !== 'playing' || !player.alive || !player.practice || !isDrillId(id)) return false;
    // Starting one person's drill must not reset targets another person is shooting.
    if (this.options.humans === 1) for (const actor of this.state.actors) if (actor.dummy && !actor.alive) { const spec = this.dummySpecs.get(actor.id); if (spec) this.revive(actor, { x: spec.x, y: 0, z: spec.z }); }
    const now = this.state.elapsed;
    player.practice.drill = { id, startedAt: now, endsAt: now + DRILLS[id].seconds, score: 0, hits: 0, shots: 0, heads: 0, kills: 0, combo: 0, lastHitAt: -Infinity, done: false, weapon: player.weapon };
    if (player === this.player) this.state.drill = player.practice.drill;
    this.tell(player, `${DRILLS[id].name}: ${DRILLS[id].seconds} giây · ${DRILLS[id].blurb}.`);
    return true;
  }

  /** End the drill early (it keeps the score so far on show), or clear a finished one. */
  stopDrill(player: Actor = this.player): boolean {
    const drill = player.practice?.drill;
    if (!this.rangeMode || !drill) return false;
    if (drill.done) { player.practice!.drill = null; if (player === this.player) this.state.drill = null; return true; }
    drill.done = true; drill.endsAt = this.state.elapsed;
    return true;
  }

  /** A hit on a target counts for the drill if it is one the drill is about. */
  private scoreDrill(target: Actor, head: boolean, killed: boolean, player: Actor): void {
    const drill = player.practice?.drill;
    if (!drill || drill.done || !isDrillId(drill.id)) return;
    const spec = this.dummySpecs.get(target.id);
    if (!spec || !DRILLS[drill.id].counts(spec)) return;
    const now = this.state.elapsed;
    drill.combo = now - drill.lastHitAt <= COMBO_WINDOW ? drill.combo + 1 : 0;
    drill.lastHitAt = now;
    const distance = Math.hypot(target.position.x - player.position.x, target.position.z - player.position.z);
    drill.score += hitPoints(spec, distance, head, killed, drill.combo);
    drill.hits++;
    if (head) drill.heads++;
    if (killed) drill.kills++;
  }

  /** Take any gun in the game, with a full magazine and plenty in reserve; it replaces the one in hand (or the sidearm for a pistol). */
  rangeEquip(weapon: unknown, actor: Actor = this.player): boolean {
    if (!this.rangeMode || !actor.alive || typeof weapon !== 'string' || !isWeaponKind(weapon)) return false;
    if (!actor.ownedWeapons.includes(weapon)) {
      const sidearm = isSidearm(weapon);
      const same = actor.ownedWeapons.filter(w => isSidearm(w) === sidearm);
      if (same.length >= (sidearm ? 1 : PRIMARY_SLOTS)) {
        const out = sidearm || !same.includes(actor.weapon) ? same[0] : actor.weapon;
        actor.ownedWeapons.splice(actor.ownedWeapons.indexOf(out), 1);
      }
      actor.ownedWeapons.push(weapon);
    }
    actor.weapon = weapon;
    actor.reloading = 0;
    actor.ammo[weapon] = magazineOf(actor, weapon);
    const type = WEAPONS[weapon].ammoType;
    actor.reserve[type] = Math.max(actor.reserve[type], 400);
    this.tell(actor, `Đã lấy ${WEAPONS[weapon].label}.`);
    return true;
  }

  private runtime(actor: Actor): Runtime {
    let runtime = this.runtimes.get(actor.id);
    if (!runtime) {
      runtime = {
        cooldown: 0, weaponCooldowns: emptyAmmo(), velocityY: 0, reloadWeapon: null, targetId: null, reaction: 0, memory: 0, sightTimer: 0,
        goal: null, path: [], pathTimer: 0, stuck: 0, pathHold: 0, throwCooldown: 0, meleeCooldown: 0, vault: null,
        focus: 0, strafeDir: 1, strafeTimer: 0, burstLeft: 0, stillTime: 0,
        lastSeen: null, lastSeenAt: -Infinity, enemyVel: { x: 0, z: 0 }, enemyLast: null,
        heard: null, heardTimer: 0,
        lootRef: null, lootTimer: 0, ignored: new Map(), coverGoal: null, coverTimer: 0, weaponTimer: 0,
        visited: new Set(), townGoal: null,
        lodAcc: 0, lodTier: 0, duelUntil: 0, detour: 0, carTarget: null, destination: null, carCooldown: 0, drop: null, airdropGoal: null, speedNow: 0,
        mission: null, bunkerAt: 20 + (Number(actor.id.split('-')[1]) % 17) * 3, bunkers: new Set(), dry: false,
      };
      this.runtimes.set(actor.id, runtime);
    }
    return runtime;
  }

  private step(dt: number, pressed: ReadonlySet<string>): void {
    this.state.elapsed += dt;
    this.advanceZone(dt);
    this.stepPlane(dt);
    this.stepAirdrops(dt);
    for (const human of this.humanList) {
      const held = human.reconnecting ? ZERO_INPUT : this.inputs.get(human.id) ?? ZERO_INPUT;
      if (pressed.has(human.id) || Math.hypot(held.moveX, held.moveZ) > 0.05) this.cancelHeal(human);
    }
    for (const actor of this.state.actors) {
      if (!actor.alive) continue;
      const runtime = this.runtime(actor);
      runtime.cooldown = Math.max(0, runtime.cooldown - dt);
      runtime.throwCooldown = Math.max(0, runtime.throwCooldown - dt);
      runtime.meleeCooldown = Math.max(0, runtime.meleeCooldown - dt);
      if (actor.blind) actor.blind = Math.max(0, actor.blind - dt);
      for (const weapon of actor.ownedWeapons) runtime.weaponCooldowns[weapon] = Math.max(0, runtime.weaponCooldowns[weapon] - dt);
      actor.hurtTimer = Math.max(0, actor.hurtTimer - dt);
      if (actor.reloading > 0) {
        actor.reloading = Math.max(0, actor.reloading - dt);
        if (actor.reloading < 1e-7) {
          actor.reloading = 0;
          const weapon = runtime.reloadWeapon ?? actor.weapon;
          const ammoType = WEAPONS[weapon].ammoType;
          const amount = Math.max(0, Math.min(magazineOf(actor, weapon) - actor.ammo[weapon], actor.reserve[ammoType]));
          actor.ammo[weapon] += amount;
          actor.reserve[ammoType] -= amount;
          runtime.reloadWeapon = null;
        }
      }
      if (actor.healing > 0) {
        actor.healing = Math.max(0, actor.healing - dt);
        if (actor.healing < 1e-7) {
          actor.healing = 0;
          this.finishUse(actor);
        }
      }
      // A boosted person mends slowly, faster while the gauge is full; the gauge runs down as it does.
      if (actor.boost > 0) {
        const regen = boostRegen(actor.boost);
        if (actor.health < 100) actor.health = Math.min(100, actor.health + regen * dt);
        actor.boost = Math.max(0, actor.boost - BOOST_DRAIN * dt);
      }
    }
    // A client can lead the host too: step independent humans before the people following them.
    const orderedHumans = this.humanList.some(human => human.dropFollowing)
      ? [...this.humanList].sort((a, b) => Number(!!a.dropFollowing) - Number(!!b.dropFollowing)) : this.humanList;
    for (const human of orderedHumans) {
      if (!human.alive) continue;
      const held = human.reconnecting ? ZERO_INPUT : this.inputs.get(human.id) ?? ZERO_INPUT;
      const jump = !human.reconnecting && pressed.has(human.id);
      if (human.air) this.flyPlayer(human, dt, held, jump);
      else if (!human.vehicleId) this.walkPlayer(human, dt, held, jump);
    }
    for (const human of this.humanList) if (human.alive) this.stepBreath(human, dt);
    this.rebuildActorGrid();
    this.pathBudget = 3;
    this.updateBots(dt);
    this.stepRange(dt);
    this.stepVehicles(dt);
    this.stepGrenades(dt);
    this.applyZone(dt);
    this.checkEnd();
  }

  /** Is there something low straight ahead that can be climbed over, with room to land beyond it? Starts the vault if so. */
  private tryVault(player: Actor, input: PlayerInput): boolean {
    const length = Math.hypot(input.moveX, input.moveZ);
    if (length < 0.3 || player.vehicleId || player.air) return false;
    const dx = input.moveX / length, dz = input.moveZ / length, feet = player.position.y, p = player.position;
    const probe = { x: p.x + dx * 0.75, z: p.z + dz * 0.75 };
    let low = false;
    let top = 0;
    this.obstacles().queryBox(probe.x - 0.05, probe.z - 0.05, probe.x + 0.05, probe.z + 0.05, obstacle => {
      if (probe.x < obstacle.x - obstacle.width / 2 || probe.x > obstacle.x + obstacle.width / 2 || probe.z < obstacle.z - obstacle.depth / 2 || probe.z > obstacle.z + obstacle.depth / 2) return;
      const up = obstacleTop(obstacle) - feet, from = obstacleBottom(obstacle) - feet;
      if (from <= 0.4 && up >= 0.4 && up <= VAULT_MAX) { low = true; top = Math.max(top, up); }
    });
    if (!low) return false;
    const height = stanceOf(player).height;
    for (let reach = 1.1; reach <= 3.2; reach += 0.2) {
      const x = p.x + dx * reach, z = p.z + dz * reach;
      if (!this.walkable({ x, z }, ACTOR_RADIUS, feet, ACTOR_HEIGHT)) continue;
      const ground = this.supportHeight(x, z, feet);
      if (Math.abs(ground - feet) > 0.7) return false;
      this.runtime(player).vault = { t: 0, from: { ...p }, to: { x, y: ground, z }, peak: Math.max(top, 0.8) + 0.25 };
      player.stance = 'stand';
      this.cancelHeal(player);
      void height;
      return true;
    }
    return false;
  }

  private stepVault(player: Actor, runtime: Runtime, dt: number): void {
    const vault = runtime.vault!;
    vault.t = Math.min(1, vault.t + dt / VAULT_SECONDS);
    const k = vault.t;
    player.position.x = vault.from.x + (vault.to.x - vault.from.x) * k;
    player.position.z = vault.from.z + (vault.to.z - vault.from.z) * k;
    player.position.y = vault.from.y + (vault.to.y - vault.from.y) * k + vault.peak * Math.sin(Math.PI * k);
    runtime.velocityY = 0; runtime.speedNow = 0;
    if (vault.t >= 1) { player.position.y = vault.to.y; runtime.vault = null; }
  }

  private walkPlayer(player: Actor, dt: number, input: PlayerInput, jumpPressed: boolean): void {
    const vaulting = this.runtime(player);
    if (vaulting.vault) { this.stepVault(player, vaulting, dt); return; }
    // Jumping or sprinting from a crouch or lying down first gets you up (if there is room).
    const wasLow = !!player.stance && player.stance !== 'stand';
    if (wasLow && (jumpPressed || (input.sprint && Math.hypot(input.moveX, input.moveZ) > 0.2))) this.setStance('stand', player);
    if (jumpPressed && !wasLow && player.position.y <= this.supportHeight(player.position.x, player.position.z, player.position.y) + 1e-6) {
      // Running at something low: climb over it instead of jumping into it.
      if (this.tryVault(player, input)) return;
      this.runtime(player).velocityY = 6.7;
      this.cancelHeal(player);
    }
    const stanceData = stanceOf(player);
    const before = { x: player.position.x, z: player.position.z };
    this.moveActor(player, input.moveX, input.moveZ, (input.sprint ? stanceData.sprint : stanceData.speed) * boostSpeed(player.boost), dt);
    this.runtime(player).speedNow = Math.hypot(player.position.x - before.x, player.position.z - before.z) / Math.max(dt, 1e-6);
    const playerRuntime = this.runtime(player);
    const ground = this.supportHeight(player.position.x, player.position.z, player.position.y);
    if (player.position.y > ground || playerRuntime.velocityY > 0) {
      playerRuntime.velocityY -= 18 * dt;
      player.position.y = Math.max(ground, player.position.y + playerRuntime.velocityY * dt);
      // On rolling terrain and down stairs, stay glued to the surface when walking downhill instead of hopping.
      if (this.world.terrain && playerRuntime.velocityY <= 0 && player.position.y - ground < 0.35) player.position.y = ground;
      if (player.position.y === ground) {
        // Landing from a real fall (off a roof or a mezzanine) hurts; the host decides how much.
        const impact = -playerRuntime.velocityY;
        if (impact > FALL_SAFE_SPEED && !this.options.remote) this.damage(player, (impact - FALL_SAFE_SPEED) * 8, undefined, { cause: 'fall' });
        playerRuntime.velocityY = 0;
      }
      this.resolvePenetration(player);
    } else player.position.y = ground;
  }

  private applyZone(dt: number): void {
    if (this.rangeMode) return;
    for (const actor of this.state.actors) {
      if (!actor.alive || actor.air || this.state.phase !== 'playing') continue;
      if (distance2(actor.position, this.state.zone.center) > this.state.zone.radius) {
        const damage = 1.5 + this.state.zone.stage * 2 + (this.state.zone.radius <= 0.01 ? 20 : 0);
        this.damage(actor, damage * dt, undefined, { cause: 'zone' });
      }
    }
    this.checkEnd();
  }

  // -------------------------------------------------------------------------------------------------------------
  // The drop: everybody starts in a plane that crosses the map. Jump when you like, steer in free fall (Shift dives),
  // open the canopy by hand or let it open at DROP.autoOpen, then glide to the spot you picked. Bots plan a landing
  // spot near a town within reach of the route and jump at the point from which they can just make it.
  // -------------------------------------------------------------------------------------------------------------

  /** True while the player is still in the plane, falling or under the canopy. */
  get airborne(): boolean { return !!this.player.air; }

  /** Height of an actor above the ground under it, in metres. */
  heightAboveGround(actor: Actor): number { return actor.position.y - this.heightAt(actor.position.x, actor.position.z); }

  private stepPlane(dt: number): void {
    const plane = this.state.plane;
    if (!plane?.active) return;
    plane.travelled = Math.min(plane.length, plane.travelled + plane.speed * dt);
    placePlane(plane);
    for (const actor of this.state.actors) {
      if (actor.air?.mode !== 'plane') continue;
      actor.position.x = plane.x; actor.position.y = plane.y; actor.position.z = plane.z; actor.yaw = plane.yaw;
    }
    if (plane.travelled < plane.length) return;
    // Out of island: whoever is still aboard is pushed out the door.
    plane.active = false;
    for (const actor of this.state.actors) {
      if (!actor.alive || actor.air?.mode !== 'plane') continue;
      this.jumpFromPlane(actor);
      if (actor.isPlayer) this.tell(actor, 'Máy bay đã bay hết đảo, bạn bị đẩy ra khỏi cửa!');
    }
  }

  private jumpFromPlane(actor: Actor): void {
    const plane = this.state.plane;
    if (!plane || actor.air?.mode !== 'plane') return;
    const momentum = plane.speed * 0.9;
    actor.air = { mode: 'freefall', vx: Math.sin(plane.yaw) * momentum, vz: Math.cos(plane.yaw) * momentum, vy: -3, time: 0 };
    // The door is wide: jumpers leave a few metres apart rather than on one point.
    const spread = actor.isPlayer ? 0 : 8;
    actor.position = { x: plane.x + (this.random() - 0.5) * spread, y: plane.y - 2, z: plane.z + (this.random() - 0.5) * spread };
    this.cancelHeal(actor);
    this.events.push({ type: 'drop', actorId: actor.id, stage: 'jump' });
    if (actor.isPlayer) this.tell(actor, `Rơi tự do! Lái để chọn điểm đáp, nhảy lần nữa để mở dù (tự mở ở độ cao ${DROP.autoOpen} m).`);
  }

  private openChute(actor: Actor): void {
    if (actor.air?.mode !== 'freefall') return;
    actor.air.mode = 'chute';
    this.events.push({ type: 'drop', actorId: actor.id, stage: 'chute' });
  }

  private flyPlayer(player: Actor, dt: number, input: PlayerInput, jumpPressed: boolean): void {
    if (player.dropFollowing && this.followDrop(player)) return;
    const air = player.air!;
    if (air.mode === 'plane') {
      if (jumpPressed && this.state.elapsed > DROP.doorDelay) this.jumpFromPlane(player);
      return;
    }
    // A second press opens the canopy, but not in the first instant of the fall, so a double tap cannot waste the altitude.
    if (jumpPressed && air.mode === 'freefall' && air.time > 1) this.openChute(player);
    this.moveInAir(player, { x: input.moveX, z: input.moveZ, dive: input.sprint }, dt);
  }

  /** Give back this human's controls without changing their current flight or velocity. */
  detachDrop(actor: Actor = this.player): boolean {
    if (this.state.phase !== 'playing' || !actor.isPlayer || !actor.alive || !actor.air || !actor.dropFollowing) return false;
    delete actor.dropFollowing;
    this.tell(actor, 'Đã tách đội. Bạn tự điều khiển nhảy dù.');
    return true;
  }

  private followDrop(actor: Actor): boolean {
    const leader = this.humanList.find(human => human.id === actor.dropFollowing);
    if (!leader?.alive || !leader.air || leader.dropFollowing || leader.reconnecting) { this.detachDrop(actor); return false; }
    const mode = actor.air!.mode;
    if (leader.air.mode === 'plane') return true;
    if (mode === 'plane') this.jumpFromPlane(actor);
    if (mode !== 'chute' && leader.air.mode === 'chute') this.openChute(actor);
    actor.air = { ...leader.air };
    actor.yaw = leader.yaw;
    // Seven metres between canopies. Stable slots do not collapse when another member detaches.
    const slot = this.humanList.filter(human => human !== leader).indexOf(actor);
    const side = (slot % 2 ? -1 : 1) * (Math.floor(slot / 2) + 1) * 7;
    const back = -(Math.floor(slot / 2) + 1) * 7;
    const yaw = this.state.plane?.yaw ?? leader.yaw, sin = Math.sin(yaw), cos = Math.cos(yaw);
    const edge = this.world.halfSize - ACTOR_RADIUS;
    actor.position = { x: clamp(leader.position.x + side * cos + back * sin, -edge, edge),
      y: leader.position.y, z: clamp(leader.position.z - side * sin + back * cos, -edge, edge) };
    const ground = this.heightAt(actor.position.x, actor.position.z);
    if (actor.position.y <= ground) this.land(actor, ground);
    else if (actor.air.mode === 'freefall' && actor.position.y - ground <= DROP.autoOpen) {
      this.detachDrop(actor); this.openChute(actor);
    }
    return true;
  }

  private moveInAir(actor: Actor, control: { x: number; z: number; dive: boolean }, dt: number): void {
    const air = actor.air!;
    steerAir(air, control, dt);
    const p = actor.position;
    const edge = this.world.halfSize - ACTOR_RADIUS;
    p.x = clamp(p.x + air.vx * dt, -edge, edge);
    p.z = clamp(p.z + air.vz * dt, -edge, edge);
    p.y += air.vy * dt;
    if (!actor.isPlayer && Math.hypot(air.vx, air.vz) > 1) actor.yaw = Math.atan2(air.vx, air.vz);
    const ground = this.heightAt(p.x, p.z);
    const openAt = actor.isPlayer ? DROP.autoOpen : this.runtime(actor).drop?.openAgl ?? DROP.autoOpen;
    if (air.mode === 'freefall' && p.y - ground <= openAt) this.openChute(actor);
    if (p.y <= ground) this.land(actor, ground);
  }

  /** Is this a spot someone can stand: dry, clear of walls and not under a roof (the canopy cannot drop through one). */
  private canLandAt(point: Vec2): boolean {
    if (!this.walkable(point, ACTOR_RADIUS)) return false;
    let covered = false;
    this.obstacles().queryBox(point.x - 0.5, point.z - 0.5, point.x + 0.5, point.z + 0.5, obstacle => {
      if ((obstacle.kind === 'roof' || obstacle.kind === 'floor') && Math.abs(point.x - obstacle.x) < obstacle.width / 2 + 0.5 && Math.abs(point.z - obstacle.z) < obstacle.depth / 2 + 0.5) { covered = true; return true; }
    });
    return !covered;
  }

  /** Nearest standable point to where the canopy came down: shore for a splashdown, the yard beside a roof. */
  private nearestLanding(point: Vec2): Vec2 | null {
    if (this.canLandAt(point)) return point;
    for (let radius = 3; radius <= 400; radius += 3) {
      const steps = Math.max(8, Math.round(radius * 0.9));
      for (let i = 0; i < steps; i++) {
        const angle = i / steps * Math.PI * 2;
        const candidate = { x: point.x + Math.cos(angle) * radius, z: point.z + Math.sin(angle) * radius };
        if (this.canLandAt(candidate)) return candidate;
      }
    }
    return null;
  }

  private land(actor: Actor, ground: number): void {
    const air = actor.air!;
    const impact = -air.vy;
    actor.air = null;
    delete actor.dropFollowing;
    const runtime = this.runtime(actor);
    runtime.velocityY = 0;
    runtime.drop = null;
    runtime.goal = null; runtime.path = []; runtime.pathTimer = 0;
    const p = actor.position;
    const splash = !!this.world.water && this.deepWater(p.x, p.z, ground);
    const spot = this.nearestLanding(p);
    if (spot) { p.x = spot.x; p.z = spot.z; }
    p.y = this.heightAt(p.x, p.z);
    this.resolvePenetration(actor);
    this.events.push({ type: 'drop', actorId: actor.id, stage: 'land' });
    if (actor.isPlayer && splash) this.tell(actor, 'Bạn rơi xuống nước và bơi vào bờ.');
    else if (actor.isPlayer) this.tell(actor, 'Đã tiếp đất. Tìm vũ khí trong nhà gần nhất!');
    if (impact > DROP.safeLanding) this.damage(actor, (impact - DROP.safeLanding) * 3, undefined, { cause: 'fall' });
  }

  /** Pick a town (or a loose spot) the route passes within glide range of, and the moment to jump so the glide ends there. */
  private planDrop(plane: NonNullable<GameState['plane']>): BotDrop {
    const reach = glideReach(plane.y);
    const reachable = (point: Vec2) => alongLine(plane, point).side <= reach * 0.9;
    const weight = (town: Town) => town.tier === 'city' ? 1.6 : town.tier === 'town' ? 1.2 : 1;
    const towns = this.world.towns.filter(reachable);
    const spawns = this.world.spawns;
    // Sample a few candidate spots (a third of them in towns) and take the one farthest from the spots already
    // chosen, so a hundred bots spread across the band under the route instead of piling into the same city.
    const sample = (): Vec2 | null => {
      if (towns.length && this.random() < 0.3) {
        let roll = this.random() * towns.reduce((sum, town) => sum + weight(town), 0);
        let pick = towns[0];
        for (const town of towns) { pick = town; roll -= weight(town); if (roll < 0) break; }
        return { x: pick.x + (this.random() - 0.5) * pick.radius * 0.9, z: pick.z + (this.random() - 0.5) * pick.radius * 0.9 };
      }
      for (let attempt = 0; attempt < 12; attempt++) {
        const spot = spawns[Math.floor(this.random() * spawns.length)];
        if (spot && reachable(spot)) return { x: spot.x, z: spot.z };
      }
      return null;
    };
    let target: Vec2 | null = null;
    let roomiest = -1;
    for (let i = 0; i < 6; i++) {
      const candidate = sample();
      if (!candidate) continue;
      const room = this.dropTargets.reduce((least, other) => Math.min(least, distance2(candidate, other)), Infinity);
      if (room > roomiest) { roomiest = room; target = candidate; }
    }
    target ??= spawns.reduce<Vec2>((best, spot) => alongLine(plane, spot).side < alongLine(plane, best).side ? spot : best, spawns[0] ?? { x: 0, z: 0 });
    this.dropTargets.push(target);
    const { along, side } = alongLine(plane, target);
    const glide = Math.max(side + 5, reach * (0.55 + this.random() * 0.35));
    const jumpAt = clamp(along - Math.sqrt(Math.max(0, glide * glide - side * side)), 2 + this.random() * 20, plane.length - 5);
    return { jumpAt, target, openAgl: this.random() < 0.4 ? DROP.autoOpen + this.random() * 120 : DROP.autoOpen, dive: this.random() < 0.3 };
  }

  private updateBotAir(actor: Actor, dt: number): void {
    const air = actor.air!;
    const plan = this.runtime(actor).drop;
    if (air.mode === 'plane') {
      const plane = this.state.plane;
      if (!plan || (plane && plane.travelled >= plan.jumpAt)) this.jumpFromPlane(actor);
      return;
    }
    const target = plan?.target ?? actor.position;
    const dx = target.x - actor.position.x, dz = target.z - actor.position.z;
    const distance = Math.hypot(dx, dz);
    const dive = !!plan?.dive && air.mode === 'freefall' && distance < 150;
    const cap = (air.mode === 'chute' ? DROP.chute : dive ? DROP.dive : DROP.freefall).h;
    // Ease off near the spot so the canopy comes down on it instead of swinging past.
    const throttle = clamp(distance / (cap * 1.2), 0, 1);
    this.moveInAir(actor, { x: distance > 0.5 ? dx / distance * throttle : 0, z: distance > 0.5 ? dz / distance * throttle : 0, dive }, dt);
  }

  // -------------------------------------------------------------------------------------------------------------
  // Supply crates: at set circles a crate parachutes into the next safe zone and lands with top-tier gear. Bots near it
  // are drawn to it, so it pulls fights toward the middle of the map. Only in matches that start with the drop.
  // -------------------------------------------------------------------------------------------------------------

  private onZoneStage(stage: number): void {
    if (!this.options.drop || !this.openWorld) return;
    if (airdropStages(this.world).includes(stage)) this.releaseAirdrop();
  }

  private releaseAirdrop(): void {
    const zone = this.state.zone;
    if (zone.nextRadius <= 0) return;
    let spot: Vec2 | null = null;
    for (let attempt = 0; attempt < 30 && !spot; attempt++) {
      const angle = this.random() * Math.PI * 2, radius = Math.sqrt(this.random()) * zone.nextRadius * 0.7;
      const candidate = { x: zone.nextCenter.x + Math.cos(angle) * radius, z: zone.nextCenter.z + Math.sin(angle) * radius };
      if (this.canLandAt(candidate)) spot = candidate;
    }
    if (!spot) return;
    const ground = this.heightAt(spot.x, spot.z);
    const crates = this.state.airdrops ??= [];
    const drop: Airdrop = { id: `airdrop-${crates.length}`, x: spot.x, z: spot.z, y: ground + AIRDROP_HEIGHT, landed: false, time: 0, empty: false, loot: [] };
    crates.push(drop);
    this.events.push({ type: 'airdrop', stage: 'incoming', position: { x: spot.x, y: drop.y, z: spot.z } });
    this.events.push({ type: 'message', text: 'Hộp tiếp tế đang rơi xuống! Xem vị trí trên bản đồ.' });
  }

  private stepAirdrops(dt: number): void {
    const crates = this.state.airdrops;
    if (!crates?.length) return;
    for (const drop of crates) {
      drop.time += dt;
      if (drop.landed) {
        if (!drop.empty && drop.loot.every(id => !this.state.loot.find(l => l.id === id)?.active)) drop.empty = true;
        continue;
      }
      const ground = this.heightAt(drop.x, drop.z);
      drop.y = Math.max(ground, drop.y - AIRDROP_FALL * dt);
      if (drop.y <= ground) this.landAirdrop(drop, ground);
    }
  }

  private landAirdrop(drop: Airdrop, ground: number): void {
    drop.landed = true;
    // Two strong guns (not the lowest tier), top armour, medkits and ammunition for the guns.
    const classes: WeaponClass[] = ['br', 'dmr', 'lmg', 'sniper', 'amr', 'ar'];
    const contents: LootKind[] = [];
    for (let i = 0; i < 2; i++) {
      const guns = GUNS_BY_CLASS[classes[Math.floor(this.random() * classes.length)]].filter(gun => WEAPONS[gun].tier >= 2);
      if (guns.length) contents.push(guns[Math.floor(this.random() * guns.length)]);
    }
    contents.push('helmet3', 'vest3', 'medkit', 'medkit', 'pack3');
    for (const kind of [...contents]) if (isWeaponKind(kind)) contents.push(ammoKindFor(kind), ammoKindFor(kind));
    contents.forEach((kind, index) => {
      const angle = index / contents.length * Math.PI * 2;
      // The landing point was checked, the ring around it was not: keep each item out of trees, rocks and water.
      const position = this.settleLoot({ x: drop.x, y: ground, z: drop.z }, drop.x + Math.cos(angle) * 1.8, drop.z + Math.sin(angle) * 1.8);
      const id = `${drop.id}-${index}`;
      this.state.loot.push({ id, kind, position, active: true });
      drop.loot.push(id);
    });
    this.events.push({ type: 'airdrop', stage: 'landed', position: { x: drop.x, y: ground, z: drop.z } });
    this.events.push({ type: 'message', text: 'Hộp tiếp tế đã hạ cánh, có khói đỏ báo hiệu!' });
    // Bots in earshot of the engine drop what they are doing about four times in ten.
    for (const actor of this.state.actors) {
      if (actor.isPlayer || !actor.alive || actor.air || actor.vehicleId) continue;
      if (distance2(actor.position, drop) < 800 && this.random() < 0.4) this.runtime(actor).airdropGoal = { x: drop.x, z: drop.z };
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // Vehicles: a kinematic car (throttle, steering, drag, slope), crashes that hurt, bullets that wreck it, and bots
  // that walk to a nearby car when their destination is far and drive there on a simple autopilot.
  // -------------------------------------------------------------------------------------------------------------

  private vehicle(id: string | null | undefined): Vehicle | undefined {
    return id ? this.state.vehicles.find(v => v.id === id) : undefined;
  }

  private vehicleDriver(v: Vehicle): Actor | undefined {
    return v.driverId ? this.state.actors.find(a => a.id === v.driverId) : undefined;
  }

  /** The nearest empty, working car within arm's reach of the player. */
  get vehicleInReach(): Vehicle | null { return this.vehicleNear(this.player); }

  vehicleNear(actor: Actor): Vehicle | null {
    if (this.state.phase !== 'playing' || actor.vehicleId || actor.air || !actor.alive) return null;
    let best = null as Vehicle | null;
    let nearest = VEHICLE_REACH;
    for (const v of this.state.vehicles) {
      if (v.driverId || v.health <= 0 || v.netVisible === false) continue;
      if (Math.abs(actor.position.y - v.position.y) > 2) continue;
      const d = distance2(v.position, actor.position);
      if (d < nearest) { best = v; nearest = d; }
    }
    return best;
  }

  /** Get into the nearest car, or out of the one being driven. */
  useVehicle(actor: Actor = this.player): boolean {
    if (this.state.phase !== 'playing' || actor.air || !actor.alive) return false;
    if (actor.vehicleId) { this.exitVehicle(actor); return true; }
    const car = this.vehicleNear(actor);
    return car ? this.enterVehicle(actor, car) : false;
  }

  private enterVehicle(actor: Actor, v: Vehicle): boolean {
    if (v.driverId || v.health <= 0 || actor.vehicleId) return false;
    this.cancelHeal(actor);
    actor.reloading = 0;
    const runtime = this.runtime(actor);
    runtime.reloadWeapon = null; runtime.velocityY = 0; runtime.vault = null; runtime.speedNow = 0;
    actor.vehicleId = v.id;
    actor.stance = 'stand';
    v.driverId = actor.id;
    actor.position = { x: v.position.x, y: v.position.y + 0.3, z: v.position.z };
    if (actor.isPlayer) this.tell(actor, 'Đang lái xe. Nhấn F để xuống xe.');
    return true;
  }

  private exitVehicle(actor: Actor): void {
    const v = this.vehicle(actor.vehicleId);
    actor.vehicleId = null;
    const runtime = this.runtime(actor);
    runtime.velocityY = 0; runtime.vault = null; runtime.speedNow = 0;
    if (!v) return;
    v.driverId = null;
    // Step out on whichever side is free, a little way from the doors.
    const right = { x: Math.cos(v.yaw), z: -Math.sin(v.yaw) };
    let spot = { x: v.position.x, z: v.position.z };
    search: for (const distance of [2.7, 3.6, 4.6]) {
      for (const side of [-1, 1]) {
        const candidate = { x: v.position.x + right.x * distance * side, z: v.position.z + right.z * distance * side };
        if (this.walkable(candidate)) { spot = candidate; break search; }
      }
    }
    actor.position = { x: spot.x, y: this.heightAt(spot.x, spot.z), z: spot.z };
    actor.yaw = v.yaw;
    runtime.path = [];
    runtime.pathTimer = 0;
    if (actor.isPlayer) this.tell(actor, 'Đã xuống xe.');
  }

  private stepVehicles(dt: number): void {
    for (const v of this.state.vehicles) {
      v.hitTimer = Math.max(0, v.hitTimer - dt);
      if (v.health <= 0) continue;
      let driver = this.vehicleDriver(v);
      if (v.driverId && (!driver || !driver.alive)) { v.driverId = null; driver = undefined; }
      let throttle = 0, steer = 0, brake = false;
      if (driver?.isPlayer) {
        const input = this.inputs.get(driver.id) ?? ZERO_INPUT;
        throttle = clamp(finite(input.throttle ?? 0), -1, 1);
        steer = clamp(finite(input.steer ?? 0), -1, 1);
        brake = input.jump;
      } else if (driver) ({ throttle, steer, brake } = this.autopilot(v, driver, dt));
      this.driveVehicle(v, throttle, steer, brake, dt);
      if (v.health <= 0) continue;
      if (driver && driver.vehicleId === v.id) {
        driver.position = { x: v.position.x, y: v.position.y + 0.3, z: v.position.z };
        driver.yaw = v.yaw;
      }
      this.runOver(v, driver);
    }
  }

  /** `predicted`: a mirror's guess at the local player's car; a bump stops it but only the host decides the damage. */
  private driveVehicle(v: Vehicle, throttle: number, steer: number, brake: boolean, dt: number, predicted = false): void {
    const stats = VEHICLES[kindOf(v)];
    const maxForward = stats.maxForward, maxReverse = stats.maxReverse;
    if (Math.abs(throttle) > 0.02) {
      const target = throttle > 0 ? maxForward * throttle : maxReverse * throttle;
      const braking = (throttle > 0 && v.speed < -0.3) || (throttle < 0 && v.speed > 0.3);
      v.speed += clamp(target - v.speed, braking ? -18 * dt : -6 * dt, braking ? 18 * dt : stats.accel * dt);
    } else v.speed *= Math.exp(-0.45 * dt);
    if (brake) v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), 22 * dt);
    // Slopes pull on the car: climbing bleeds speed, descending adds some.
    const sx = Math.sin(v.yaw), cz = Math.cos(v.yaw);
    const rise = (this.heightAt(v.position.x + sx * 2, v.position.z + cz * 2) - this.heightAt(v.position.x - sx * 2, v.position.z - cz * 2)) / 4;
    v.speed = clamp(v.speed - rise * 9.81 * 0.35 * dt, -maxReverse * 1.2, maxForward * 1.1);
    // Bicycle steering: tighter at low speed, calmer when fast.
    const lock = stats.lock / (1 + Math.abs(v.speed) * 0.05);
    v.yaw = wrapAngle(v.yaw + (v.speed / stats.wheelbase) * Math.tan(steer * lock) * dt);
    const distance = v.speed * dt;
    const pieces = Math.max(1, Math.ceil(Math.abs(distance) / 0.8));
    for (let i = 0; i < pieces; i++) {
      const next = { x: v.position.x + Math.sin(v.yaw) * distance / pieces, z: v.position.z + Math.cos(v.yaw) * distance / pieces };
      if (!this.walkable(next, stats.radius, v.position.y)) { if (predicted) v.speed = -v.speed * 0.2; else this.crash(v); break; }
      v.position.x = next.x;
      v.position.z = next.z;
      v.position.y = this.heightAt(next.x, next.z);
    }
  }

  private crash(v: Vehicle): void {
    const impact = Math.abs(v.speed);
    v.speed = -v.speed * 0.2;
    if (impact < 3) return;
    this.events.push({ type: 'crash', vehicleId: v.id, strength: impact, position: { ...v.position } });
    v.health -= impact * impact * 0.35;
    const driver = this.vehicleDriver(v);
    const hurtAt = VEHICLES[kindOf(v)].hurtAt;
    if (driver && impact > hurtAt) this.damage(driver, (impact - hurtAt) * 2.2, undefined, { cause: 'vehicle' });
    if (v.health <= 0) this.explode(v);
  }

  private explode(v: Vehicle): void {
    v.health = 0;
    v.speed = 0;
    const driver = this.vehicleDriver(v);
    if (driver) { this.exitVehicle(driver); this.damage(driver, 25, undefined, { cause: 'vehicle' }); }
    v.driverId = null;
    this.events.push({ type: 'explosion', position: { ...v.position } });
    for (const actor of this.state.actors) {
      if (!actor.alive || actor.vehicleId || actor.air) continue;
      const d = distance2(actor.position, v.position);
      if (d < 7) this.damage(actor, 70 * (1 - d / 7), undefined, { cause: 'vehicle' });
    }
    const lengthwise = Math.abs(Math.sin(v.yaw)) > 0.7;
    const hull = HULLS[kindOf(v)], long = hull.length * 2, wide = hull.half * 2 + 0.3;
    this.world.obstacles.push({
      id: `wreck-${v.id}`, x: v.position.x, z: v.position.z, width: lengthwise ? long : wide, depth: lengthwise ? wide : long,
      height: 1.4, kind: 'wreck', base: v.position.y,
    });
  }

  /** A moving car hurts anyone it hits, and loses a little speed doing so. */
  private runOver(v: Vehicle, driver: Actor | undefined): void {
    if (!driver || Math.abs(v.speed) < 5 || v.hitTimer > 0) return;
    this.actorGrid.queryCircle(v.position.x, v.position.z, 2.6, other => {
      if (other === driver || !other.alive || other.vehicleId || distance2(other.position, v.position) > 2.3) return;
      this.damage(other, Math.min(110, Math.abs(v.speed) * 5), driver.id, { cause: 'vehicle' });
      v.hitTimer = 0.45;
      v.speed *= 0.82;
    });
  }

  /** Someone driving a vehicle with no body around them. */
  private exposedRider(actor: Actor): boolean {
    const car = this.state.vehicles.find(v => v.id === actor.vehicleId);
    return !!car && VEHICLES[kindOf(car)].exposed;
  }

  /** Shots wreck a car; the driver takes a little of every hit. */
  private damageVehicle(v: Vehicle, amount: number, sourceId: string): void {
    if (v.health <= 0) return;
    v.health -= amount * 0.55;
    const driver = this.vehicleDriver(v);
    if (driver && driver.id !== sourceId) this.damage(driver, amount * 0.08, sourceId, { cause: 'vehicle' });
    if (v.health <= 0) this.explode(v);
  }

  /** Steer a bot-driven car toward the bot's goal, swerving around obstacles and backing out when stuck. */
  private autopilot(v: Vehicle, driver: Actor, dt: number): { throttle: number; steer: number; brake: boolean } {
    const runtime = this.runtime(driver);
    const goal = runtime.goal;
    if (!goal) return { throttle: 0, steer: 0, brake: true };
    const dx = goal.x - v.position.x, dz = goal.z - v.position.z;
    const distance = Math.hypot(dx, dz);
    let diff = wrapAngle(Math.atan2(dx, dz) - v.yaw);
    if (runtime.detour > 0) {
      runtime.detour -= dt;
      return { throttle: -0.8, steer: -clamp(diff * 1.8, -1, 1), brake: false };
    }
    const look = clamp(7 + Math.abs(v.speed) * 0.7, 9, 26);
    const clear = (angle: number) => this.walkable({ x: v.position.x + Math.sin(v.yaw + angle) * look, z: v.position.z + Math.cos(v.yaw + angle) * look }, VEHICLES[kindOf(v)].radius, v.position.y);
    const front = clear(0), left = clear(-0.45), right = clear(0.45);
    let throttle = distance < 14 ? 0 : 0.9;
    if (!front) {
      diff = left && !right ? -0.9 : right && !left ? 0.9 : diff >= 0 ? 0.9 : -0.9;
      throttle = 0.4;
    } else if (!left && right) diff += 0.3;
    else if (!right && left) diff -= 0.3;
    if (Math.abs(diff) > 1.1) throttle *= 0.45;
    runtime.stuck = throttle > 0 && Math.abs(v.speed) < 0.6 ? runtime.stuck + dt : 0;
    if (runtime.stuck > 1.6) { runtime.detour = 1.4; runtime.stuck = 0; }
    return { throttle, steer: clamp(diff * 1.8, -1, 1), brake: false };
  }

  /** Bots with a faraway destination walk to a free car within reach and take it. */
  private boardCheck(actor: Actor, runtime: Runtime, dt: number): void {
    if (actor.vehicleId || this.state.vehicles.length === 0) return;
    runtime.carCooldown = Math.max(0, runtime.carCooldown - dt);
    let target = this.vehicle(runtime.carTarget);
    if (target && (target.driverId || target.health <= 0)) { target = undefined; runtime.carTarget = null; }
    if (!target) {
      if (runtime.carCooldown > 0 || !runtime.goal || distance2(actor.position, runtime.goal) < 260) return;
      let best = null as Vehicle | null;
      let nearest = 80;
      for (const v of this.state.vehicles) {
        if (v.driverId || v.health <= 0) continue;
        const d = distance2(actor.position, v.position);
        if (d < nearest) { best = v; nearest = d; }
      }
      runtime.carCooldown = 15;
      if (!best) return;
      target = best;
      runtime.carTarget = best.id;
      runtime.destination = { ...runtime.goal };
    }
    if (distance2(actor.position, target.position) < 3.4) {
      runtime.carTarget = null;
      if (this.enterVehicle(actor, target)) { runtime.goal = runtime.destination; runtime.path = []; }
      return;
    }
    runtime.goal = { x: target.position.x, z: target.position.z };
  }

  /** A bot at the wheel only decides where to go and when to get out; the autopilot does the driving. */
  private botDriving(actor: Actor, runtime: Runtime, evacuating: boolean): void {
    const car = this.vehicle(actor.vehicleId);
    if (!car) { actor.vehicleId = null; return; }
    this.pickGoal(actor, runtime, evacuating, false);
    const goal = runtime.goal;
    if (!goal || distance2(car.position, goal) < 28 || car.health < 90) {
      this.exitVehicle(actor);
      runtime.destination = null;
    }
  }

  /**
   * Level of detail: on the large map only bots near the player run the full routine every step;
   * mid-range bots run it a few times a second and distant bots run the abstract routine once a second.
   */
  private updateBots(dt: number): void {
    if (this.botsFrozen) return;
    const lod = this.openWorld;
    const watchers = this.humanList.filter(human => human.alive);
    if (!watchers.length) watchers.push(this.player);
    for (const actor of this.state.actors) {
      if (actor.isPlayer || actor.dummy || !actor.alive || this.state.phase !== 'playing') continue;
      if (actor.air) { this.updateBotAir(actor, dt); continue; }
      if (!lod) { this.updateBot(actor, dt); continue; }
      const runtime = this.runtime(actor);
      let d = Infinity;
      for (const human of watchers) d = Math.min(d, Math.hypot(actor.position.x - human.position.x, actor.position.z - human.position.z, actor.position.y - human.position.y));
      const tier = d < LOD_FULL ? 0 : d < LOD_NEAR ? 1 : 2;
      if (tier < 2 && runtime.lodTier === 2) { this.resolvePenetration(actor); runtime.path = []; runtime.pathTimer = 0; }
      runtime.lodTier = tier;
      runtime.lodAcc += dt;
      const interval = tier === 0 ? 0 : tier === 1 ? 0.15 : 1;
      if (runtime.lodAcc < interval) continue;
      const elapsed = runtime.lodAcc;
      runtime.lodAcc = 0;
      if (tier === 2) this.updateFarBot(actor, elapsed); else this.updateBot(actor, elapsed);
    }
  }

  private beginReload(actor: Actor): boolean {
    const weapon = actor.weapon;
    if (!actor.alive || actor.reloading > 0 || actor.ammo[weapon] >= magazineOf(actor, weapon) || actor.reserve[WEAPONS[weapon].ammoType] <= 0) return false;
    this.cancelHeal(actor);
    actor.reloading = WEAPONS[weapon].reloadTime;
    this.runtime(actor).reloadWeapon = weapon;
    return true;
  }

  /** Is this item in the pack and of any use right now? */
  private canUse(actor: Actor, item: UseKind): boolean {
    if (item === 'medkit') return actor.medkits > 0 && actor.health < HEAL_CAP.medkit;
    const config = SUPPLIES[item];
    if (actor.supplies[item] <= 0) return false;
    return config.group === 'heal' ? actor.health < config.cap : actor.boost < BOOST_MAX;
  }

  /** The healing item worth using at this health: big healers when badly hurt, cheap ones to top up. */
  private pickHeal(actor: Actor): UseKind | null {
    const order: UseKind[] = actor.health < 45 ? ['medkit', 'firstaid', 'bandage'] : actor.health < 75 ? ['bandage', 'firstaid', 'medkit'] : ['firstaid', 'medkit', 'bandage'];
    return order.find(item => this.canUse(actor, item)) ?? null;
  }

  private beginUse(actor: Actor, item?: UseKind): boolean {
    if (!actor.alive || actor.healing > 0 || actor.reloading > 0) return false;
    const choice = item ?? this.pickHeal(actor);
    if (!choice || !this.canUse(actor, choice)) return false;
    actor.healing = choice === 'medkit' ? HEAL_TIME : SUPPLIES[choice].time;
    actor.healKind = choice;
    if (actor.isPlayer) this.tell(actor, choice === 'medkit' || SUPPLIES[choice as SupplyKind]?.group === 'heal' ? 'Đang hồi máu… Hãy đứng yên.' : 'Đang dùng… Hãy đứng yên.');
    return true;
  }

  private beginHeal(actor: Actor): boolean { return this.beginUse(actor); }

  /** The timer ran out: take the item from the pack and apply it. */
  private finishUse(actor: Actor): void {
    const item = actor.healKind ?? 'medkit';
    actor.healKind = null;
    if (!this.canUse(actor, item)) return;
    if (item === 'medkit') {
      actor.medkits--;
      actor.health = Math.min(HEAL_CAP.medkit, actor.health + HEAL_AMOUNT);
      if (actor.isPlayer) this.tell(actor, 'Đã hồi máu.');
      return;
    }
    const config = SUPPLIES[item];
    actor.supplies[item]--;
    if (config.group === 'heal') {
      actor.health = Math.min(Math.max(actor.health, config.cap), actor.health + config.heal);
      if (actor.isPlayer) this.tell(actor, 'Đã hồi máu.');
    } else {
      actor.boost = Math.min(BOOST_MAX, actor.boost + config.boost);
      if (actor.isPlayer) this.tell(actor, 'Thanh tăng lực đã đầy hơn.');
    }
  }

  private cancelHeal(actor: Actor): void {
    if (actor.healing > 0) {
      actor.healing = 0;
      actor.healKind = null;
      if (actor.isPlayer) this.tell(actor, 'Đã hủy hồi máu.');
    }
  }

  private fire(actor: Actor, target: Vec3, extraSpread: number, aimed = false): boolean {
    const runtime = this.runtime(actor);
    const weapon = WEAPONS[actor.weapon];
    if (!actor.alive || actor.reloading > 0 || runtime.cooldown > 1e-7 || runtime.weaponCooldowns[actor.weapon] > 1e-7) return false;
    if (actor.ammo[actor.weapon] <= 0) { this.beginReload(actor); return false; }
    const rig = rigStats(actor, actor.weapon);
    const chest = { x: actor.position.x, y: actor.position.y + stanceOf(actor).chest, z: actor.position.z };
    let direction = { x: target.x - chest.x, y: target.y - chest.y, z: target.z - chest.z };
    let length = Math.hypot(direction.x, direction.y, direction.z);
    if (length < 0.001) return false;
    actor.yaw = Math.atan2(direction.x, direction.z);
    const from = { x: chest.x + Math.sin(actor.yaw) * 0.45, y: chest.y, z: chest.z + Math.cos(actor.yaw) * 0.45 };
    direction = { x: target.x - from.x, y: target.y - from.y, z: target.z - from.z };
    length = Math.hypot(direction.x, direction.y, direction.z);
    direction = { x: direction.x / length, y: direction.y / length, z: direction.z / length };
    actor.ammo[actor.weapon]--;
    runtime.weaponCooldowns[actor.weapon] = weapon.fireInterval;
    this.cancelHeal(actor);
    if (actor === this.player) this.state.shots++;
    if (actor.practice) {
      actor.practice.shots++;
      const drill = actor.practice.drill;
      if (drill && !drill.done) drill.shots++;
    }
    if (weapon.kind === 'launcher') {
      const rocket = weapon.ammoType === 'rocket';
      const speed = rocket ? 62 : 42;
      const unit = Math.hypot(direction.x, direction.y, direction.z) || 1;
      (this.state.projectiles ??= []).push({
        id: ++this.projectileCounter, kind: rocket ? 'rocket' : 'shell', x: from.x, y: from.y, z: from.z,
        vx: direction.x / unit * speed, vy: direction.y / unit * speed, vz: direction.z / unit * speed, fuse: 6, owner: actor.id,
      });
      this.events.push({ type: 'shot', actorId: actor.id, weapon: actor.weapon, from, to: { x: from.x + direction.x * 12, y: from.y + direction.y * 12, z: from.z + direction.z * 12 } });
      this.alertNearby(actor, gunshotLoudness(actor.weapon) * (this.openWorld ? 1 : 0.45));
      this.checkEnd();
      return true;
    }
    let anyHit = false;
    const damageByActor = new Map<Actor, number>();
    const headshots = new Set<Actor>();
    let visualHit: Hit = { distance: weapon.range };
    let visualDirection = direction;
    const muzzleDirection = { x: Math.sin(actor.yaw), y: 0, z: Math.cos(actor.yaw) };
    let muzzleBlocked = false;
    this.obstacles().queryCircle(chest.x, chest.z, 1, obstacle => {
      if (obstacleHit(chest, muzzleDirection, obstacle, 0.45) !== null) { muzzleBlocked = true; return true; }
    });
    // Bullets fall over distance in open worlds and on the range; the small arena keeps flat shots. Held breath flattens the path.
    const held = aimed && !!actor.holding;
    const arc: Arc | undefined = this.openWorld || this.rangeMode ? { velocity: weapon.velocity * (held ? BREATH_VELOCITY : 1), zero: ZERO_DISTANCE[weapon.kind] } : undefined;
    for (let pellet = 0; pellet < weapon.pellets; pellet++) {
      const ray = this.spreadDirection(direction, (aimed ? weapon.aimSpread : weapon.spread) * stanceOf(actor).spread * rig.spread * (held ? BREATH_SPREAD : 1) + extraSpread);
      const hit = muzzleBlocked ? { distance: 0 } : this.raycast(from, ray, weapon.range, actor.id, arc);
      if (pellet === 0 || (!visualHit.actor && hit.actor)) { visualHit = hit; visualDirection = ray; }
      if (hit.vehicle) this.damageVehicle(hit.vehicle, weapon.damage, actor.id);
      if (hit.actor) {
        anyHit = true;
        // Shotguns lose damage gradually beyond their useful close-range distance.
        const falloff = weapon.kind === 'shotgun' ? clamp(1 - Math.max(0, hit.distance - 12) / 45, 0.45, 1) : 1;
        const raw = weapon.damage * falloff * (hit.head ? 1.65 : 1);
        damageByActor.set(hit.actor, (damageByActor.get(hit.actor) ?? 0) + this.absorb(hit.actor, raw, !!hit.head));
        if (hit.head) headshots.add(hit.actor);
      }
    }
    const to = visualHit.point ?? { x: from.x + visualDirection.x * visualHit.distance, y: from.y + visualDirection.y * visualHit.distance, z: from.z + visualDirection.z * visualHit.distance };
    this.events.push({ type: 'shot', actorId: actor.id, weapon: actor.weapon, from, to, ...(visualHit.actor ? { hitId: visualHit.actor.id } : {}), ...(rig.silenced ? { silenced: true } : {}) });
    // On the cramped arena everyone would hear everything; halve the range there.
    this.alertNearby(actor, gunshotLoudness(actor.weapon) * rig.loud * (this.openWorld ? 1 : 0.45));
    if (actor === this.player && anyHit) this.state.hits++;
    if (actor.practice && anyHit) actor.practice.hits++;
    for (const [victim, amount] of damageByActor) this.damage(victim, amount, actor.id, { cause: actor.weapon, head: headshots.has(victim) });
    this.checkEnd();
    return true;
  }

  private spreadDirection(direction: Vec3, spread: number): Vec3 {
    const radius = Math.sqrt(this.random()) * spread;
    const angle = this.random() * Math.PI * 2;
    const horizontal = Math.hypot(direction.x, direction.z);
    const right = horizontal > 1e-8 ? { x: direction.z / horizontal, y: 0, z: -direction.x / horizontal } : { x: 1, y: 0, z: 0 };
    const up = { x: direction.y * right.z, y: direction.z * right.x - direction.x * right.z, z: -direction.y * right.x };
    const ray = {
      x: direction.x + right.x * radius * Math.cos(angle) + up.x * radius * Math.sin(angle),
      y: direction.y + up.y * radius * Math.sin(angle),
      z: direction.z + right.z * radius * Math.cos(angle) + up.z * radius * Math.sin(angle),
    };
    const length = Math.hypot(ray.x, ray.y, ray.z);
    return { x: ray.x / length, y: ray.y / length, z: ray.z / length };
  }

  /** Distance at which a ray first dips below the terrain, or null. Marches in short steps then bisects. */
  private terrainHit(origin: Vec3, direction: Vec3, range: number): number | null {
    const terrain = this.world.terrain;
    if (!terrain) return null;
    // From deep underground (a bunker) the ground overhead is not in the way: walls and the ceiling do the stopping.
    if (origin.y < terrain(origin.x, origin.z) - DEEP) return null;
    const horizontal = Math.hypot(direction.x, direction.z);
    // A ray climbing steeply from above the surface cannot re-enter it within a short range.
    const step = 3;
    let previous = 0;
    for (let d = step; ; d += step) {
      const distance = Math.min(d, range);
      const x = origin.x + direction.x * distance, z = origin.z + direction.z * distance;
      const y = origin.y + direction.y * distance;
      if (y < terrain(x, z)) {
        let low = previous, high = distance;
        for (let i = 0; i < 7; i++) {
          const mid = (low + high) / 2;
          if (origin.y + direction.y * mid < terrain(origin.x + direction.x * mid, origin.z + direction.z * mid)) high = mid; else low = mid;
        }
        return high;
      }
      if (distance >= range) return null;
      if (horizontal < 1e-6 && direction.y > 0) return null;
      previous = distance;
    }
  }

  /**
   * A shot: straight when short or in the arena, otherwise along the bullet's arc, traced in pieces of SEGMENT metres.
   * `distance` in the result is the distance along the aim line, `point` where the bullet ended up.
   */
  private raycast(origin: Vec3, direction: Vec3, range: number, ignoreId: string, arc?: Arc): Hit {
    if (!arc || range <= STRAIGHT_RANGE) return this.raycastStraight(origin, direction, range, ignoreId);
    const pointAt = (d: number): Vec3 => ({ x: origin.x + direction.x * d, y: origin.y + direction.y * d + pathOffset(d, arc.velocity, arc.zero), z: origin.z + direction.z * d });
    let from = pointAt(0);
    let travelled = 0;
    while (travelled < range - 1e-6) {
      const next = Math.min(range, travelled === 0 ? STRAIGHT_RANGE : travelled + SEGMENT);
      const to = pointAt(next);
      const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, length = Math.hypot(dx, dy, dz);
      const hit = this.raycastStraight(from, { x: dx / length, y: dy / length, z: dz / length }, length, ignoreId);
      if (hit.distance < length - 1e-7 || hit.actor || hit.vehicle) {
        const along = travelled + hit.distance * (next - travelled) / length;
        return { ...hit, distance: along, point: { x: from.x + dx / length * hit.distance, y: from.y + dy / length * hit.distance, z: from.z + dz / length * hit.distance } };
      }
      from = to; travelled = next;
    }
    return { distance: range, point: from };
  }

  private raycastStraight(origin: Vec3, direction: Vec3, range: number, ignoreId: string): Hit {
    let closest: Hit = { distance: range };
    this.obstacles().querySegment(origin.x, origin.z, origin.x + direction.x * range, origin.z + direction.z * range, obstacle => {
      const hit = obstacleHit(origin, direction, obstacle, closest.distance);
      if (hit !== null && hit <= closest.distance) closest = { distance: hit };
    });
    const ground = this.terrainHit(origin, direction, closest.distance);
    if (ground !== null && ground < closest.distance) closest = { distance: ground };
    for (const car of this.state.vehicles) {
      if (car.health <= 0 || car.netVisible === false) continue;
      const dx = origin.x - car.position.x, dz = origin.z - car.position.z;
      if (Math.hypot(dx, dz) > closest.distance + 4) continue;
      // Rotate the ray into the car's own frame (x to its right, z forward) and test an upright box.
      const c = Math.cos(car.yaw), s = Math.sin(car.yaw);
      const localOrigin = { x: dx * c - dz * s, y: origin.y, z: dx * s + dz * c };
      const localDirection = { x: direction.x * c - direction.z * s, y: direction.y, z: direction.x * s + direction.z * c };
      // A car is a tall closed box; a bike or a buggy is low, so a rider sits above it.
      const hull = HULLS[kindOf(car)];
      const hit = rayBox(localOrigin, localDirection, { x: -hull.half, y: car.position.y + hull.low, z: -hull.length }, { x: hull.half, y: car.position.y + hull.high, z: hull.length }, closest.distance);
      if (hit !== null && hit < closest.distance) closest = { distance: hit, vehicle: car };
    }
    for (const actor of this.state.actors) {
      if (!actor.alive || actor.id === ignoreId || actor.air || actor.hidden || actor.netVisible === false) continue;
      // Inside a car you are covered; on a bike or in a buggy nothing shields you.
      if (actor.vehicleId && !this.exposedRider(actor)) continue;
      const p = actor.position;
      const shape = stanceOf(actor);
      const neck = shape.height * NECK;
      const body = rayBox(origin, direction, { x: p.x - shape.half, y: p.y + 0.05, z: p.z - shape.half }, { x: p.x + shape.half, y: p.y + neck, z: p.z + shape.half }, closest.distance);
      const head = rayBox(origin, direction, { x: p.x - 0.24, y: p.y + neck, z: p.z - 0.24 }, { x: p.x + 0.24, y: p.y + shape.height, z: p.z + 0.24 }, closest.distance);
      const distance = head !== null && (body === null || head < body) ? head : body;
      if (distance !== null && distance < closest.distance - 1e-7) closest = { distance, actor, head: distance === head };
    }
    return closest;
  }

  /** `how` says what did the harm and whether it was a headshot; it goes into the events for the match statistics. */
  private damage(actor: Actor, amount: number, sourceId?: string, how: { cause?: string; head?: boolean } = {}): void {
    if (!actor.alive || amount <= 0 || actor.reconnecting) return;
    if (this.rangeMode && actor.isPlayer && (actor.practice?.immortal ?? this.immortal)) return;
    const actual = Math.min(actor.health, amount);
    actor.health = Math.max(0, actor.health - actual);
    actor.hurtTimer = 0.45;
    const shooter = sourceId ? this.actorById(sourceId) : undefined;
    if (actor.dummy && shooter?.isPlayer) this.scoreDrill(actor, how.head === true, actor.health <= 1e-7, shooter);
    // Zone ticks are intentionally not emitted every frame; the HUD tracks health.
    if (sourceId) {
      this.cancelHeal(actor);
      this.events.push({ type: 'damage', actorId: actor.id, amount: actual, sourceId, ...(how.cause ? { cause: how.cause } : {}), ...(how.head ? { head: true } : {}) });
    }
    if (actor.health <= 1e-7) {
      if (actor.vehicleId) this.exitVehicle(actor);
      actor.health = 0;
      actor.alive = false;
      actor.rank = this.state.actors.filter(a => a.alive).length + 1;
      actor.diedAt = this.state.elapsed;
      if (actor === this.player) { this.state.playerRank = actor.rank; this.state.diedAt = actor.diedAt; }
      actor.reloading = 0;
      actor.healing = 0;
      const killer = sourceId ? this.actorById(sourceId) : undefined;
      if (killer?.isPlayer && killer !== actor) killer.kills = (killer.kills ?? 0) + 1;
      if (sourceId === this.player.id && actor !== this.player) this.state.kills++;
      this.events.push({ type: 'kill', actorId: actor.id, ...(sourceId ? { killerId: sourceId } : {}), ...(how.cause ? { cause: how.cause } : {}), ...(how.head ? { head: true } : {}), at: { ...actor.position }, ...(killer ? { from: { ...killer.position } } : {}) });
      // In a match with other people a fallen person drops their gear too.
      if ((!actor.isPlayer || this.options.humans > 1) && !this.rangeMode) this.dropEverything(actor);
    }
  }

  /**
   * A fallen actor leaves exactly what it carried, so a fallen enemy is worth searching but nothing is made up: every gun
   * with the rounds really in it, its parts, every calibre of spare ammunition, medkits, supplies, the pack and armour.
   */
  private dropEverything(actor: Actor): void {
    const dropPosition = (offset: number): Vec3 => {
      const x = actor.position.x + offset;
      const position = { x, y: this.supportHeight(x, actor.position.z, actor.position.y), z: actor.position.z };
      return this.walkable(position, 0.05, position.y) ? position : { ...actor.position, y: this.supportHeight(actor.position.x, actor.position.z, actor.position.y) };
    };
    const held = actor.weapon;
    for (const weapon of actor.ownedWeapons.filter(w => w !== held)) this.dropWeapon(actor, weapon, false);
    // The gun in hand keeps its own id where it fell; its parts lie beside it and rounds beyond a plain magazine go to the reserve.
    const worn = attachmentsOf(actor, held);
    for (const slot of ATTACH_SLOTS) { const part = worn[slot]; if (part) this.dropLoot(actor, part, 1.0 + ATTACH_SLOTS.indexOf(slot) * 0.1); }
    delete actor.attach[held];
    const loaded = Math.min(actor.ammo[held], WEAPONS[held].magazine);
    actor.reserve[WEAPONS[held].ammoType] += actor.ammo[held] - loaded;
    actor.ammo[held] = 0;
    this.state.loot.push({ id: `drop-${actor.id}-weapon`, kind: held, position: dropPosition(-0.7), active: true, loadedAmmo: loaded });
    const heldAmmo = WEAPONS[held].ammoType;
    if (actor.reserve[heldAmmo] > 0) this.state.loot.push({ id: `drop-${actor.id}-ammo`, kind: ammoKindOf(heldAmmo), position: dropPosition(0), active: true, amount: actor.reserve[heldAmmo] });
    AMMO_ORDER.forEach((ammo, i) => { if (ammo !== heldAmmo && actor.reserve[ammo] > 0) this.dropLoot(actor, ammoKindOf(ammo), 1.9 + i * 0.05, { amount: actor.reserve[ammo] }); });
    if (actor.medkits) this.state.loot.push({ id: `drop-${actor.id}-medkit`, kind: 'medkit', position: dropPosition(0.7), active: true, amount: actor.medkits });
    if (actor.melee) this.dropLoot(actor, actor.melee, 1.5);
    SUPPLY_ORDER.forEach((kind, i) => { if (actor.supplies[kind] > 0) this.dropLoot(actor, kind, 1.7 + i * 0.1, { amount: actor.supplies[kind] }); });
    ATTACH_ORDER.forEach((kind, i) => { if ((actor.parts?.[kind] ?? 0) > 0) this.dropLoot(actor, kind, 2.4 + i * 0.05, { amount: actor.parts[kind] }); });
    if (actor.pack > 0) this.dropLoot(actor, PACK_ORDER[actor.pack - 1], 1.3);
    for (const slot of ['helmet', 'vest'] as const) if (actor[slot] > 0) this.dropLoot(actor, armorKind(slot, actor[slot]), 1.4, { durability: actor[`${slot}Hp`] });
  }

  private checkEnd(): void {
    // The shooting range never ends: the player is stood back up instead.
    if (this.state.phase !== 'playing' || this.rangeMode) return;
    if (this.options.humans > 1) {
      // With several people the match goes on without any one of them, and ends when one actor is left or nobody human is.
      const alive = this.state.actors.filter(actor => actor.alive);
      if (alive.length <= 1 || !this.humanList.some(human => human.alive)) {
        const winner = alive.length === 1 ? alive[0] : undefined;
        if (winner) this.state.winnerId = winner.id;
        this.finish(winner === this.player);
      }
      return;
    }
    if (!this.player.alive) {
      // Watching on after death: the match runs until at most one opponent is left.
      if (!this.state.spectating || this.state.actors.filter(actor => actor.alive).length <= 1) this.finish(false);
    } else if (!this.state.actors.some(actor => !actor.isPlayer && actor.alive)) this.finish(true);
  }

  private finish(won: boolean): void {
    this.state.phase = won ? 'won' : 'lost';
    this.events.push({ type: 'end', won });
  }

  private nextZoneCenter(center: Vec2, radius: number, nextRadius: number): Vec2 {
    let result = center;
    // On the island the safe circle must close in on dry land, not on open water.
    for (let attempt = 0; attempt < 24; attempt++) {
      const angle = this.random() * Math.PI * 2;
      const offset = Math.sqrt(this.random()) * Math.max(0, radius - nextRadius) * 0.48;
      result = { x: center.x + Math.cos(angle) * offset, z: center.z + Math.sin(angle) * offset };
      if (!this.world.water) break;
      const ground = this.heightAt(result.x, result.z);
      if (ground > 4 && !this.deepWater(result.x, result.z, ground)) break;
    }
    return result;
  }

  private advanceZone(dt: number): void {
    const zone = this.state.zone;
    const profile = this.world.zone;
    if (this.rangeMode || zone.stage >= profile.radii.length) return;
    zone.timeRemaining = Math.max(0, zone.timeRemaining - dt);
    if (zone.isShrinking && this.shrinkStart) {
      const progress = clamp(1 - zone.timeRemaining / profile.shrinks[zone.stage], 0, 1);
      zone.radius = this.shrinkStart.radius + (zone.nextRadius - this.shrinkStart.radius) * progress;
      zone.center = {
        x: this.shrinkStart.center.x + (zone.nextCenter.x - this.shrinkStart.center.x) * progress,
        z: this.shrinkStart.center.z + (zone.nextCenter.z - this.shrinkStart.center.z) * progress,
      };
    }
    if (zone.timeRemaining > 1e-7) return;
    if (!zone.isShrinking) {
      zone.isShrinking = true;
      zone.timeRemaining = profile.shrinks[zone.stage];
      this.shrinkStart = { center: { ...zone.center }, radius: zone.radius };
      this.events.push({ type: 'message', text: 'Vòng bo đang thu! Hãy vào vùng an toàn.' });
    } else {
      zone.radius = zone.nextRadius;
      zone.center = { ...zone.nextCenter };
      zone.stage++;
      zone.isShrinking = false;
      this.shrinkStart = null;
      if (zone.stage < profile.radii.length) {
        zone.nextRadius = profile.radii[zone.stage];
        zone.nextCenter = this.nextZoneCenter(zone.center, zone.radius, zone.nextRadius);
        zone.timeRemaining = profile.waits[zone.stage];
      } else { zone.timeRemaining = 0; zone.nextRadius = 0; }
      this.onZoneStage(zone.stage);
    }
  }

  private moveActor(actor: Actor, moveX: number, moveZ: number, speed: number, dt: number): number {
    if (!actor.alive) return 0;
    const length = Math.hypot(moveX, moveZ);
    if (length < 1e-8) return 0;
    const scale = speed * dt / Math.max(1, length);
    const previous = { ...actor.position };
    const edge = this.world.halfSize - ACTOR_RADIUS;
    // Walkers track the terrain; only the player can leave it (jumping), so bots always stand on the ground.
    // Bots in a bunker stand on its floor; the ground overhead is far above them.
    const deep = !actor.isPlayer && this.underground(actor);
    const feet = () => actor.isPlayer || deep ? actor.position.y : this.heightAt(actor.position.x, actor.position.z);
    // Long strides (low-detail bots) are split so a thin wall can never be stepped over.
    const pieces = Math.max(1, Math.ceil(Math.hypot(moveX, moveZ) * scale / 0.45));
    for (let piece = 0; piece < pieces; piece++) {
      const before = { x: actor.position.x, z: actor.position.z };
      actor.position.x = clamp(actor.position.x + moveX * scale / pieces, -edge, edge);
      if (!this.walkable(actor.position, ACTOR_RADIUS, feet(), stanceOf(actor).height)) actor.position.x = before.x;
      actor.position.z = clamp(actor.position.z + moveZ * scale / pieces, -edge, edge);
      if (!this.walkable(actor.position, ACTOR_RADIUS, feet(), stanceOf(actor).height)) actor.position.z = before.z;
    }
    if (!actor.isPlayer) {
      actor.yaw = Math.atan2(moveX, moveZ);
      actor.position.y = deep ? this.supportHeight(actor.position.x, actor.position.z, actor.position.y) : this.heightAt(actor.position.x, actor.position.z);
    }
    return distance2(actor.position, previous);
  }

  /** True when a body of the given radius, standing with its feet at the given height (default: ground), clears every obstacle. */
  /** Sea and lakes are too deep to wade; rivers are shallow by construction. */
  private deepWater(x: number, z: number, ground: number): boolean {
    const water = this.world.water;
    if (!water) return false;
    if (ground < water.seaLevel - 1) return true;
    for (const lake of water.lakes) {
      const dx = x - lake.x, dz = z - lake.z;
      if (Math.abs(dx) < lake.r && Math.abs(dz) < lake.r && ground < lake.level - 1 && dx * dx + dz * dz < lake.r * lake.r) return true;
    }
    return false;
  }

  /** While a bot plans a route deep underground, the level it plans on (the ground overhead means nothing there). */
  private navFeet: number | null = null;

  private walkable(point: Vec2, padding = ACTOR_RADIUS + 0.15, standing?: number, height = ACTOR_HEIGHT): boolean {
    const edge = this.world.halfSize - padding;
    if (Math.abs(point.x) > edge || Math.abs(point.z) > edge) return false;
    const ground = this.heightAt(point.x, point.z);
    if (this.world.water && this.deepWater(point.x, point.z, ground)) return false;
    const feet = standing ?? this.navFeet ?? ground;
    let free = true;
    this.obstacles().queryBox(point.x - padding, point.z - padding, point.x + padding, point.z + padding, obstacle => {
      if (obstacle.kind === 'floor' && feet >= obstacleTop(obstacle) - STEP_UP) return;
      if (feet < obstacleTop(obstacle) && feet + height > obstacleBottom(obstacle)
        && point.x > obstacle.x - obstacle.width / 2 - padding && point.x < obstacle.x + obstacle.width / 2 + padding
        && point.z > obstacle.z - obstacle.depth / 2 - padding && point.z < obstacle.z + obstacle.depth / 2 + padding) { free = false; return true; }
    });
    return free;
  }

  private resolvePenetration(actor: Actor): void {
    const p = actor.position;
    this.obstacles().queryCircle(p.x, p.z, 8, obstacle => {
      if (p.y >= obstacleTop(obstacle) || p.y + ACTOR_HEIGHT <= obstacleBottom(obstacle)) return;
      const left = obstacle.x - obstacle.width / 2 - ACTOR_RADIUS;
      const right = obstacle.x + obstacle.width / 2 + ACTOR_RADIUS;
      const back = obstacle.z - obstacle.depth / 2 - ACTOR_RADIUS;
      const front = obstacle.z + obstacle.depth / 2 + ACTOR_RADIUS;
      if (p.x <= left || p.x >= right || p.z <= back || p.z >= front) return;
      const exits = [Math.abs(p.x - left), Math.abs(right - p.x), Math.abs(p.z - back), Math.abs(front - p.z)];
      const side = exits.indexOf(Math.min(...exits));
      if (side === 0) p.x = left - 0.001;
      else if (side === 1) p.x = right + 0.001;
      else if (side === 2) p.z = back - 0.001;
      else p.z = front + 0.001;
    });
  }

  /** Line of sight between chest-height points, blocked by obstacles and by terrain crests. */
  private lineClear(from: Vec3, target: Vec3, ignoreSmoke = false): boolean {
    const distance = Math.hypot(target.x - from.x, target.y - from.y, target.z - from.z);
    if (distance < 0.01) return true;
    const direction = { x: (target.x - from.x) / distance, y: (target.y - from.y) / distance, z: (target.z - from.z) / distance };
    let clear = true;
    this.obstacles().querySegment(from.x, from.z, target.x, target.z, obstacle => {
      if (obstacleHit(from, direction, obstacle, distance) !== null) { clear = false; return true; }
    });
    return clear && this.terrainHit(from, direction, distance) === null && (ignoreSmoke || !this.smokeBlocks(from, target));
  }

  /** Does the line between two points pass through a smoke cloud? */
  private smokeBlocks(from: Vec3, target: Vec3): boolean {
    const smokes = this.state.smokes;
    if (!smokes || smokes.length === 0) return false;
    const dx = target.x - from.x, dy = target.y - from.y, dz = target.z - from.z, length2 = dx * dx + dy * dy + dz * dz;
    for (const smoke of smokes) {
      // A cloud swells over its first moments.
      const swell = Math.min(1, 0.35 + (this.state.elapsed - smoke.born) / 1.6);
      const r = smoke.radius * swell * 0.92;
      const cx = smoke.x - from.x, cy = smoke.y + 1.6 - from.y, cz = smoke.z - from.z;
      const t = length2 > 1e-9 ? Math.max(0, Math.min(1, (cx * dx + cy * dy + cz * dz) / length2)) : 0;
      const px = from.x + dx * t - smoke.x, py = from.y + dy * t - (smoke.y + 1.6), pz = from.z + dz * t - smoke.z;
      if (px * px + py * py + pz * pz < r * r) return true;
    }
    return false;
  }

  private canSee(actor: Actor, enemy: Actor): boolean {
    if ((actor.blind ?? 0) > 0) return false;
    return this.lineClear(
      { x: actor.position.x, y: actor.position.y + stanceOf(actor).chest, z: actor.position.z },
      { x: enemy.position.x, y: enemy.position.y + stanceOf(enemy).aimY + 0.03, z: enemy.position.z });
  }

  private rebuildActorGrid(): void {
    this.actorGrid.clear();
    this.actorIndex.clear();
    for (const actor of this.state.actors) {
      this.actorIndex.set(actor.id, actor);
      if (actor.alive && !actor.air) this.actorGrid.insertPoint(actor, actor.position.x, actor.position.z);
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // Bot brain. Near the player a bot runs the full routine below; beyond LOD_NEAR it runs the cheap abstract
  // routine (`updateFarBot`) that keeps the same goals and inventory but resolves fights statistically.
  // -------------------------------------------------------------------------------------------------------------

  private detectionRange(actor: Actor, easy: boolean): number {
    const scoped: Partial<Record<WeaponType, number>> = { dmr: 34, sniper: 60, heavySniper: 75 };
    // Optics only pay off in open country; on the 200 m arena the bonus would let snipers see across the whole map.
    const open = this.openWorld ? 1 : 0.3;
    return (easy ? 27 : 34) + (scoped[actor.weapon] ?? 0) * (easy ? 0.7 : 1) * open;
  }

  private perceive(actor: Actor, runtime: Runtime, easy: boolean): void {
    runtime.sightTimer = 0.24 + this.random() * 0.1;
    const detection = this.detectionRange(actor, easy);
    let closest = null as Actor | null;
    let closestDistance = detection;
    this.actorGrid.queryCircle(actor.position.x, actor.position.z, detection, enemy => {
      if (!enemy.alive || enemy.id === actor.id || enemy.dummy) return;
      // Crouching and lying down shrink the distance at which a bot notices you.
      const distance = distance2(actor.position, enemy.position) / stanceOf(enemy).stealth;
      if (distance >= closestDistance) return;
      // Close enemies are heard; distant detection respects the bot's facing direction.
      const directionYaw = Math.atan2(enemy.position.x - actor.position.x, enemy.position.z - actor.position.z);
      const facing = Math.cos(directionYaw - actor.yaw) > -0.2 || distance < 12;
      if (facing && this.canSee(actor, enemy)) { closest = enemy; closestDistance = distance; }
    });
    if (closest) {
      const spotted: Actor = closest;
      if (runtime.targetId !== spotted.id) {
        runtime.reaction = (easy ? 1.2 : 0.65) + this.random() * 0.5 + (WEAPONS[actor.weapon].fireMode === 'bolt' ? 0.65 : 0);
        runtime.focus = 0;
        runtime.enemyLast = null;
        runtime.enemyVel = { x: 0, z: 0 };
      }
      runtime.targetId = spotted.id;
      runtime.memory = 6;
      runtime.lastSeen = { x: spotted.position.x, z: spotted.position.z };
      runtime.lastSeenAt = this.state.elapsed;
      runtime.heard = null;
    } else if (runtime.memory === 0) runtime.targetId = null;
  }

  /** Smoothed velocity of the tracked enemy, used to model how a human aim lags behind a moving target. */
  private trackEnemy(runtime: Runtime, enemy: Actor, dt: number): void {
    const last = runtime.enemyLast;
    if (last && dt > 1e-4) {
      const vx = clamp((enemy.position.x - last.x) / dt, -9, 9), vz = clamp((enemy.position.z - last.z) / dt, -9, 9);
      runtime.enemyVel.x += (vx - runtime.enemyVel.x) * 0.35;
      runtime.enemyVel.z += (vz - runtime.enemyVel.z) * 0.35;
    }
    runtime.enemyLast = { x: enemy.position.x, z: enemy.position.z };
  }

  private botShoot(actor: Actor, runtime: Runtime, enemy: Actor, easy: boolean, retreating: boolean): void {
    const weapon = WEAPONS[actor.weapon];
    if (runtime.reaction > 0) return;
    // Bolt-action shooters settle before firing instead of spraying on the move.
    if (weapon.fireMode === 'bolt' && (runtime.stillTime < 0.45 || runtime.focus < 0.4)) return;
    const speed = Math.hypot(runtime.enemyVel.x, runtime.enemyVel.z);
    // Bullets are instant, so a bot does not lead: it lags behind a moving target, which strafing exploits.
    const lag = (easy ? 0.28 : 0.16) * (1 - 0.6 * runtime.focus);
    const aim = { x: enemy.position.x - runtime.enemyVel.x * lag, y: enemy.position.y + stanceOf(enemy).aimY, z: enemy.position.z - runtime.enemyVel.z * lag };
    // Bots hold over for bullet drop (they still miss through spread and lag).
    if (this.openWorld) aim.y += holdover(Math.hypot(aim.x - actor.position.x, aim.z - actor.position.z), weapon.velocity, ZERO_DISTANCE[weapon.kind]);
    const base = (easy ? 0.08 : 0.05) * (weapon.fireMode === 'bolt' ? 0.7 : 1);
    const spread = base * (1 - 0.6 * runtime.focus) * (1 + Math.min(1, speed / 6) * 0.6) * (runtime.stillTime < 0.2 ? 1.25 : 1) * (retreating ? 1.4 : 1);
    if (!this.fire(actor, aim, spread, true)) return;
    if (weapon.fireMode === 'auto') {
      if (runtime.burstLeft <= 0) runtime.burstLeft = 3 + Math.floor(this.random() * 5);
      runtime.burstLeft--;
      if (runtime.burstLeft <= 0) runtime.cooldown = Math.max(runtime.cooldown, (0.25 + this.random() * 0.45) * (easy ? 1.8 : 1));
    } else runtime.cooldown = Math.max(runtime.cooldown, weapon.fireInterval * (easy ? 1.8 : 1.15) + this.random() * 0.2);
  }

  private botSwitch(actor: Actor, weapon: WeaponType): void {
    const runtime = this.runtime(actor);
    actor.weapon = weapon;
    actor.reloading = 0;
    runtime.reloadWeapon = null;
    this.cancelHeal(actor);
    runtime.cooldown = Math.max(runtime.cooldown, 0.45);
  }

  /** A point within reach that the enemy cannot see (behind an obstacle or a terrain crest). */
  private findCover(actor: Actor, enemy: Actor): Vec2 | null {
    const eye = { x: enemy.position.x, y: enemy.position.y + 1.35, z: enemy.position.z };
    let best: Vec2 | null = null;
    let bestScore = Infinity;
    for (let i = 0; i < 14; i++) {
      const angle = (i / 14) * Math.PI * 2 + this.random() * 0.4;
      const radius = 6 + this.random() * 16;
      const point = { x: actor.position.x + Math.cos(angle) * radius, z: actor.position.z + Math.sin(angle) * radius };
      if (!this.walkable(point)) continue;
      if (this.lineClear(eye, { x: point.x, y: this.heightAt(point.x, point.z) + 1.2, z: point.z })) continue;
      const score = radius - 0.15 * distance2(point, enemy.position);
      if (score < bestScore) { best = point; bestScore = score; }
    }
    return best;
  }

  /** Alert bots that can plausibly hear this shot. Some ignore it; nearer shots are more convincing. */
  private alertNearby(shooter: Actor, loudness: number): void {
    this.actorGrid.queryCircle(shooter.position.x, shooter.position.z, loudness, other => {
      if (other === shooter || !other.alive || other.isPlayer) return;
      const runtime = this.runtime(other);
      if (runtime.targetId && runtime.memory > 0) return;
      const d = distance2(other.position, shooter.position);
      if (d > loudness || d < 8 || runtime.heardTimer > 6.5 || Math.abs(other.position.y - shooter.position.y) > 14) return;
      if (this.random() > 0.3 + (1 - d / loudness) * 0.5) return;
      runtime.heard = { x: shooter.position.x + (this.random() - 0.5) * d * 0.3, z: shooter.position.z + (this.random() - 0.5) * d * 0.3 };
      runtime.heardTimer = 9;
    });
  }

  /** Walk to the most valuable nearby pickup. Returns true when a pickup is the current goal. */
  private seekLoot(actor: Actor, runtime: Runtime): boolean {
    const now = this.state.elapsed;
    if (runtime.lootRef && (!runtime.lootRef.active || lootUtility(actor, runtime.lootRef.kind) <= 0)) runtime.lootRef = null;
    if (!runtime.lootRef && runtime.lootTimer <= 0) {
      runtime.lootTimer = 0.8 + this.random() * 0.5;
      const zone = this.state.zone;
      let best = null as Loot | null;
      let bestScore = 0;
      this.lootIndex().queryCircle(actor.position.x, actor.position.z, this.openWorld ? 75 : 55, loot => {
        if (!loot.active) return;
        // Bots do not climb stairs: anything above the ground floor is for people.
        if (loot.position.y - this.heightAt(loot.position.x, loot.position.z) > 1.5) return;
        // Another level (a bunker under the street, or the street over a bunker) is out of reach.
        if (Math.abs(loot.position.y - actor.position.y) > 6) return;
        const until = runtime.ignored.get(loot.id);
        if (until !== undefined && until > now) return;
        const utility = lootUtility(actor, loot.kind);
        if (utility <= 0 || distance2(loot.position, zone.center) > zone.radius - 8) return;
        const score = utility / (1 + Math.hypot(loot.position.x - actor.position.x, loot.position.z - actor.position.z) / 25);
        if (score > bestScore) { best = loot; bestScore = score; }
      });
      runtime.lootRef = best;
      runtime.dry = !best;
    }
    const target = runtime.lootRef;
    if (!target) return false;
    if (Math.hypot(target.position.x - actor.position.x, target.position.y - actor.position.y, target.position.z - actor.position.z) <= (this.navFeet !== null || this.underground(actor) ? 2.2 : 1.5)) {
      this.collectLoot(actor, target);
      runtime.lootRef = null;
      runtime.lootTimer = 0.25;
      return false;
    }
    runtime.goal = { x: target.position.x, z: target.position.z };
    return true;
  }

  /** Bunker stairs on the level the actor stands on that lead the other way: down from the street, up from below. */
  private stairsOnLevel(actor: Actor, down: boolean): Portal[] {
    return (this.world.portals ?? []).filter(p => p.down === down && Math.abs(p.y - actor.position.y) < 3);
  }

  private bunkerOf(portal: Portal): string { return portal.id.replace(/-s\d+-(?:down|up)$/, ''); }

  /**
   * A calm, healthy bot on the street now and then makes for a nearby bunker's stairs (once per bunker), to loot it.
   * Returns the walking speed while the trip is on the way down, or null when the bot has other business.
   */
  private bunkerTrip(actor: Actor, runtime: Runtime): number | null {
    const portals = this.world.portals;
    if (!portals?.length) return null;
    const now = this.state.elapsed;
    const mission = runtime.mission;
    if (mission?.phase === 'down' && mission.portal) {
      if (now > mission.until) { runtime.mission = null; return null; }
      if (distance2(actor.position, mission.portal) <= 2.3 && Math.abs(mission.portal.y - actor.position.y) <= 2.5) {
        this.traverse(actor, mission.portal);
        runtime.mission = { phase: 'in', portal: null, until: now + 45 + this.random() * 70 };
        return 3.9;
      }
      // Far from anyone the walk is a straight line that a shed wall can stop: the last few metres are skipped.
      if (runtime.lodTier === 2 && distance2(actor.position, mission.portal) < 14) { this.traverse(actor, mission.portal); runtime.mission = { phase: 'in', portal: null, until: now + 45 + this.random() * 70 }; return 3.9; }
      runtime.goal = { x: mission.portal.x, z: mission.portal.z };
      return 4.4;
    }
    runtime.mission = null;
    if (now < runtime.bunkerAt || actor.health < 60 || runtime.targetId) return null;
    runtime.bunkerAt = now + 8 + this.random() * 8;
    if (this.random() > 0.5) return null;
    const zone = this.state.zone;
    const radius = zone.isShrinking ? Math.min(zone.radius, zone.nextRadius) : zone.radius;
    const center = zone.isShrinking ? zone.nextCenter : zone.center;
    let best: Portal | null = null, bestDistance = 380;
    for (const portal of this.stairsOnLevel(actor, true)) {
      if (runtime.bunkers.has(this.bunkerOf(portal)) || distance2(portal, center) > radius - 30) continue;
      const d = distance2(actor.position, portal);
      if (d < bestDistance) { best = portal; bestDistance = d; }
    }
    if (!best) return null;
    runtime.bunkers.add(this.bunkerOf(best));
    runtime.mission = { phase: 'down', portal: best, until: now + 40 + bestDistance / 3.5 };
    runtime.goal = { x: best.x, z: best.z };
    return 4.4;
  }

  /** Underground: loot the rooms for a while, then climb out (at once if the circle is closing in). */
  private bunkerLeg(actor: Actor, runtime: Runtime, evacuating: boolean): number {
    const now = this.state.elapsed;
    const mission = runtime.mission ?? (runtime.mission = { phase: 'in', portal: null, until: now + 45 + this.random() * 70 });
    if (mission.phase === 'in') {
      if (!evacuating && now < mission.until) {
        if (this.seekLoot(actor, runtime)) return 3.9;
        // Just picked something up: look again in a moment rather than leaving.
        if (!runtime.dry) return 3.6;
      }
      mission.phase = 'up';
      runtime.lootRef = null;
    }
    const exits = this.stairsOnLevel(actor, false);
    let exit: Portal | null = null, best = Infinity;
    for (const portal of exits) { const d = distance2(actor.position, portal); if (d < best) { exit = portal; best = d; } }
    if (!exit) return 3.6;
    if (best <= 2.3) { this.traverse(actor, exit); runtime.mission = null; return 3.9; }
    runtime.goal = { x: exit.x, z: exit.z };
    return 4.6;
  }

  /** A bot far from anyone, underground: no routes through the walls; it loots what is near in a few jumps and climbs out. */
  private farBunker(actor: Actor, runtime: Runtime, elapsed: number): void {
    const now = this.state.elapsed;
    const mission = runtime.mission ?? (runtime.mission = { phase: 'in', portal: null, until: now + 45 + this.random() * 70 });
    runtime.lootTimer -= elapsed;
    const zone = this.state.zone;
    const evacuating = distance2(actor.position, zone.center) > Math.max(0, zone.radius - 5) || (zone.isShrinking && distance2(actor.position, zone.nextCenter) > Math.max(0, zone.nextRadius - 7));
    if (mission.phase === 'in' && !evacuating && now < mission.until) {
      if (runtime.lootTimer <= 0) {
        runtime.lootTimer = 2 + this.random() * 1.5;
        const loot = this.nearestLoot(actor.position, 60, item => Math.abs(item.position.y - actor.position.y) < 3 && lootUtility(actor, item.kind) > 0);
        if (loot) this.collectLoot(actor, loot);
      }
      return;
    }
    const exit = this.stairsOnLevel(actor, false).sort((a, b) => distance2(actor.position, a) - distance2(actor.position, b))[0];
    runtime.mission = null;
    if (exit) this.traverse(actor, exit);
  }

  private nextTownGoal(actor: Actor, runtime: Runtime): Vec2 | null {
    const zone = this.state.zone;
    let best = null as Town | null;
    let bestScore = 0;
    for (const town of this.world.towns) {
      if (runtime.visited.has(town.id) || distance2(town, zone.center) > zone.radius - town.radius * 0.3 - 30) continue;
      const weight = town.tier === 'city' ? 1.6 : town.tier === 'town' ? 1.2 : 1;
      const score = weight / (distance2(actor.position, town) + 150) * (0.6 + this.random() * 0.8);
      if (score > bestScore) { best = town; bestScore = score; }
    }
    if (!best) { runtime.visited.clear(); return null; }
    runtime.visited.add(best.id);
    return { x: best.x + (this.random() - 0.5) * best.radius * 0.6, z: best.z + (this.random() - 0.5) * best.radius * 0.6 };
  }

  /**
   * Choose where a calm bot goes next and how fast: out of the zone first, then toward gunfire it heard,
   * then pickups, then a patrol (town to town on the island, local rounds in the arena).
   */
  private pickGoal(actor: Actor, runtime: Runtime, evacuating: boolean, allowLoot = true): number {
    const zone = this.state.zone;
    if (this.underground(actor)) return this.bunkerLeg(actor, runtime, evacuating);
    if (evacuating) {
      if (runtime.mission) runtime.mission = null;
      runtime.lootRef = null;
      const destination = zone.isShrinking ? zone.nextCenter : zone.center;
      const safeRadius = Math.max(0, (zone.isShrinking ? zone.nextRadius : zone.radius) - 10);
      // Enter the nearest safe part of the circle instead of sending every bot to its center.
      const index = Number(actor.id.split('-')[1]) || 1;
      const angle = Math.atan2(actor.position.z - destination.z, actor.position.x - destination.x) + Math.sin(index * 2.4) * 0.08;
      runtime.goal = { x: destination.x + Math.cos(angle) * safeRadius, z: destination.z + Math.sin(angle) * safeRadius };
      return 6.1;
    }
    if (runtime.heard && actor.health >= 45) {
      if (distance2(actor.position, runtime.heard) < 10) { runtime.heard = null; runtime.heardTimer = 0; }
      else { runtime.goal = { ...runtime.heard }; return 4.2; }
    }
    const crate = runtime.airdropGoal;
    if (crate) {
      const open = this.state.airdrops?.some(drop => drop.landed && !drop.empty && Math.hypot(drop.x - crate.x, drop.z - crate.z) < 2);
      if (!open || distance2(actor.position, crate) < 5) runtime.airdropGoal = null;
      else { runtime.goal = { ...crate }; return 5; }
    }
    if (allowLoot) { const trip = this.bunkerTrip(actor, runtime); if (trip !== null) return trip; }
    if (allowLoot && this.seekLoot(actor, runtime)) return 3.9;
    if (!runtime.goal || distance2(actor.position, runtime.goal) < (this.world.towns.length ? 8 : 3)) {
      runtime.goal = null;
      if (this.world.towns.length) {
        runtime.goal = this.nextTownGoal(actor, runtime);
        if (!runtime.goal) {
          const angle = this.random() * Math.PI * 2, radius = Math.sqrt(this.random()) * zone.radius * 0.6;
          const point = { x: zone.center.x + Math.cos(angle) * radius, z: zone.center.z + Math.sin(angle) * radius };
          if (this.walkable(point)) runtime.goal = point;
        }
      } else {
        // Local patrols keep the opening spread across the map; later circles bring opponents together.
        const spawn = this.world.spawns[Number(actor.id.split('-')[1])] ?? actor.position;
        const anchor = distance2(spawn, zone.center) < zone.radius - 15 ? spawn : actor.position;
        for (let attempt = 0; attempt < 8; attempt++) {
          const angle = this.random() * Math.PI * 2;
          const radius = 5 + this.random() * 12;
          const point = { x: anchor.x + Math.cos(angle) * radius, z: anchor.z + Math.sin(angle) * radius };
          if (this.walkable(point) && distance2(point, zone.center) < Math.max(0, zone.radius - 7)) { runtime.goal = point; break; }
        }
      }
    }
    return 3.6;
  }

  private updateBot(actor: Actor, dt: number): void {
    const runtime = this.runtime(actor);
    const now = this.state.elapsed;
    const easy = this.options.difficulty === 'easy';
    runtime.sightTimer -= dt;
    runtime.pathTimer -= dt;
    runtime.lootTimer -= dt;
    runtime.weaponTimer -= dt;
    runtime.coverTimer -= dt;
    runtime.strafeTimer -= dt;
    runtime.reaction = Math.max(0, runtime.reaction - dt);
    runtime.memory = Math.max(0, runtime.memory - dt);
    runtime.heardTimer = Math.max(0, runtime.heardTimer - dt);
    if (runtime.heardTimer === 0) runtime.heard = null;
    if (runtime.sightTimer <= 0) this.perceive(actor, runtime, easy);
    const enemy = runtime.targetId ? this.actorIndex.get(runtime.targetId) ?? null : null;
    if (!enemy || !enemy.alive) runtime.targetId = null;
    const target = enemy && enemy.alive ? enemy : null;
    const visible = !!target && this.canSee(actor, target);
    const zone = this.state.zone;
    const outside = distance2(actor.position, zone.center) > Math.max(0, zone.radius - 5);
    const futureUnsafe = zone.isShrinking && distance2(actor.position, zone.nextCenter) > Math.max(0, zone.nextRadius - 7);
    const evacuating = outside || futureUnsafe;
    if (actor.vehicleId) { this.botDriving(actor, runtime, evacuating); return; }
    if (actor.ammo[actor.weapon] === 0) this.beginReload(actor);
    if (runtime.weaponTimer <= 0 && actor.reloading === 0 && actor.healing === 0) {
      runtime.weaponTimer = 1 + this.random() * 0.6;
      const best = chooseWeapon(actor, target ? distance2(actor.position, target.position) : 28);
      if (best !== actor.weapon) this.botSwitch(actor, best);
    }
    if (actor.healing > 0) {
      if (visible || evacuating) this.cancelHeal(actor);
      else return;
    }
    const exposed = !!target && (visible || now - runtime.lastSeenAt < 2.5);
    if (!exposed && !evacuating && actor.health < 55 && this.pickHeal(actor) && actor.reloading === 0) {
      this.beginHeal(actor);
      return;
    }
    // A calm bot with a boost in its pack drinks it before the next fight.
    if (!exposed && !evacuating && actor.boost < 15 && actor.reloading === 0) {
      const boost = (['painkiller', 'energy'] as const).find(item => this.canUse(actor, item));
      if (boost && this.random() < 0.02) { this.beginUse(actor, boost); return; }
    }

    if (target && visible && actor.reloading === 0 && actor.healing === 0) this.botThrow(actor, runtime, target);

    let direct: { dx: number; dz: number; speed: number } | null = null;
    let hold = false;
    // A marksman holding a long-range position lies down instead of crouching.
    let lieDown = false;
    let speed = 3.6;
    const lowHealth = actor.health < 38 && (this.pickHeal(actor) !== null || actor.health < 22);
    if (target) {
      const dx = target.position.x - actor.position.x, dz = target.position.z - actor.position.z;
      const distance = Math.hypot(dx, dz);
      const weapon = WEAPONS[actor.weapon];
      if (visible) {
        runtime.focus = Math.min(1, runtime.focus + dt / (easy ? 2.6 : 1.6));
        runtime.lastSeen = { x: target.position.x, z: target.position.z };
        runtime.lastSeenAt = now;
        this.trackEnemy(runtime, target, dt);
        if (distance <= weapon.range * 0.85) {
          actor.yaw = Math.atan2(dx, dz);
          this.botShoot(actor, runtime, target, easy, evacuating || lowHealth);
        }
      } else runtime.focus = Math.max(0, runtime.focus - dt * 0.6);
      if (evacuating) speed = this.pickGoal(actor, runtime, true);
      else if (lowHealth && exposed) {
        if (runtime.coverTimer <= 0) { runtime.coverTimer = 1.5; runtime.coverGoal = this.findCover(actor, target); }
        if (runtime.coverGoal && distance2(actor.position, runtime.coverGoal) > 1.5) { runtime.goal = runtime.coverGoal; speed = 5; }
        else if (runtime.coverGoal) hold = true;
        else if (distance > 0.1) direct = { dx: -dx / distance, dz: -dz / distance, speed: 4.5 };
      } else if (visible) {
        const scoped = weapon.fireMode === 'bolt' || weapon.zoom >= 4;
        if (scoped && distance > 22) { hold = true; lieDown = distance > 60; }
        else if (distance > weapon.preferredRange * 1.4) { runtime.goal = { x: target.position.x, z: target.position.z }; speed = 4.4; }
        else {
          if (runtime.strafeTimer <= 0) { runtime.strafeDir = this.random() < 0.5 ? 1 : -1; runtime.strafeTimer = 0.7 + this.random() * 1.4; }
          // Circle-strafe the target while drifting toward the gun's preferred range.
          const radial = clamp((distance - weapon.preferredRange) / Math.max(1, weapon.preferredRange), -0.6, 0.6);
          const fx = dx / Math.max(distance, 0.01), fz = dz / Math.max(distance, 0.01);
          direct = { dx: fz * runtime.strafeDir + fx * radial, dz: -fx * runtime.strafeDir + fz * radial, speed: 2.7 };
        }
      } else {
        const memory = runtime.lastSeen ?? target.position;
        runtime.goal = { x: memory.x, z: memory.z };
        speed = 3.6;
      }
    } else {
      runtime.coverGoal = null;
      speed = this.pickGoal(actor, runtime, evacuating);
      this.boardCheck(actor, runtime, dt);
    }

    // A bot that stands its ground to shoot crouches (or lies down at long range): a smaller, steadier target.
    actor.stance = hold ? (lieDown ? 'prone' : 'crouch') : 'stand';
    let moved = 0;
    if (hold) moved = 0;
    else if (direct) {
      moved = this.moveActor(actor, direct.dx, direct.dz, direct.speed, dt);
      if (moved < direct.speed * dt * 0.3) { runtime.strafeDir = runtime.strafeDir === 1 ? -1 : 1; runtime.strafeTimer = 0.8; }
    } else moved = this.followPath(actor, runtime, speed, dt);
    runtime.stillTime = moved < Math.max(1e-4, speed * dt * 0.1) ? runtime.stillTime + dt : 0;
    if (visible && target) actor.yaw = Math.atan2(target.position.x - actor.position.x, target.position.z - actor.position.z);
  }

  /** Walk the A* path toward `runtime.goal`, replanning on a timer and sidestepping when stuck. */
  private followPath(actor: Actor, runtime: Runtime, speed: number, dt: number): number {
    this.navFeet = this.underground(actor) ? actor.position.y : null;
    try { return this.followPathOn(actor, runtime, speed, dt); } finally { this.navFeet = null; }
  }

  private followPathOn(actor: Actor, runtime: Runtime, speed: number, dt: number): number {
    const goal = runtime.goal;
    if (!goal || this.state.phase !== 'playing') return 0;
    if ((runtime.pathTimer <= 0 || !runtime.path.length) && (this.pathBudget <= 0 || this.state.elapsed < runtime.pathHold)) {
      // Out of search budget this step: keep walking toward the goal and plan again shortly.
      runtime.pathTimer = Math.min(runtime.pathTimer, 0) + 0.05;
      const dx = goal.x - actor.position.x, dz = goal.z - actor.position.z, length = Math.hypot(dx, dz) || 1;
      return this.moveActor(actor, dx / length, dz / length, speed, dt);
    }
    if (runtime.pathTimer <= 0 || !runtime.path.length) {
      this.pathBudget--;
      runtime.path = this.findPath(actor.position, goal);
      runtime.pathTimer = 1 + this.random() * 0.5;
      if (!runtime.path.length) {
        runtime.pathHold = this.state.elapsed + 1.5;
        // No route (a pickup sealed behind walls, say): give up on it for a while.
        if (runtime.lootRef) { runtime.ignored.set(runtime.lootRef.id, this.state.elapsed + 120); runtime.lootRef = null; }
        runtime.goal = null;
        return 0;
      }
    }
    while (runtime.path.length && distance2(actor.position, runtime.path[0]) < 0.7) runtime.path.shift();
    const waypoint = runtime.path[0];
    if (!waypoint) {
      if (distance2(actor.position, goal) < 2) runtime.goal = null; else runtime.pathTimer = 0;
      return 0;
    }
    const dx = waypoint.x - actor.position.x;
    const dz = waypoint.z - actor.position.z;
    const distance = Math.hypot(dx, dz);
    const travel = this.moveActor(actor, dx / distance, dz / distance, speed, dt);
    runtime.stuck = travel < speed * dt * 0.1 ? runtime.stuck + dt : 0;
    if (runtime.stuck > 0.8) {
      this.resolvePenetration(actor);
      runtime.path = [];
      runtime.pathTimer = 0;
      runtime.stuck = 0;
      // Pick a reachable detour; never teleport a visible bot.
      const detours = [{ x: 3, z: 0 }, { x: -3, z: 0 }, { x: 0, z: 3 }, { x: 0, z: -3 }];
      const detour = detours.find(offset => this.walkable({ x: actor.position.x + offset.x, z: actor.position.z + offset.z }));
      if (detour) runtime.path.push({ x: actor.position.x + detour.x, z: actor.position.z + detour.z });
      else runtime.goal = null;
    }
    return travel;
  }

  /**
   * Cheap routine for bots far from the player: same goals and inventory, straight-line movement
   * (collisions still apply) and statistical duels instead of ballistics.
   */
  private updateFarBot(actor: Actor, dt: number): void {
    const runtime = this.runtime(actor);
    const now = this.state.elapsed;
    if (runtime.duelUntil > now) return;
    runtime.lootTimer -= dt;
    runtime.weaponTimer -= dt;
    runtime.heardTimer = Math.max(0, runtime.heardTimer - dt);
    if (runtime.heardTimer === 0) runtime.heard = null;
    if (actor.healing > 0) return;
    if (this.underground(actor)) { this.farBunker(actor, runtime, dt); return; }
    const farZone = this.state.zone;
    const farEvacuating = distance2(actor.position, farZone.center) > Math.max(0, farZone.radius - 5) || (farZone.isShrinking && distance2(actor.position, farZone.nextCenter) > Math.max(0, farZone.nextRadius - 7));
    if (actor.vehicleId) { this.botDriving(actor, runtime, farEvacuating); return; }
    if (actor.ammo[actor.weapon] === 0) this.beginReload(actor);
    if (runtime.weaponTimer <= 0 && actor.reloading === 0) {
      runtime.weaponTimer = 4;
      const best = chooseWeapon(actor, 28);
      if (best !== actor.weapon) this.botSwitch(actor, best);
    }
    const zone = this.state.zone;
    const outside = distance2(actor.position, zone.center) > Math.max(0, zone.radius - 5);
    const futureUnsafe = zone.isShrinking && distance2(actor.position, zone.nextCenter) > Math.max(0, zone.nextRadius - 7);
    const evacuating = outside || futureUnsafe;
    if (!evacuating && actor.health < 60 && this.pickHeal(actor) && actor.reloading === 0) { this.beginHeal(actor); return; }
    const rival = this.nearestRival(actor, 45);
    if (rival && this.random() < 0.55) { this.resolveDuel(actor, rival); return; }
    const speed = this.pickGoal(actor, runtime, evacuating);
    this.boardCheck(actor, runtime, dt);
    const goal = runtime.goal;
    if (!goal) return;
    const dx = goal.x - actor.position.x, dz = goal.z - actor.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 1) { runtime.goal = null; return; }
    const moved = this.moveActor(actor, dx / distance, dz / distance, speed, dt);
    runtime.stuck = moved < speed * dt * 0.35 ? runtime.stuck + dt : 0;
    if (runtime.stuck > 2.5) {
      // A wall or thicket is in the way: sidestep instead of pushing against it.
      const side = this.random() < 0.5 ? 1 : -1;
      if (runtime.lootRef) { runtime.ignored.set(runtime.lootRef.id, now + 300); runtime.lootRef = null; }
      runtime.goal = { x: actor.position.x - dz / distance * side * 30 + dx / distance * 12, z: actor.position.z + dx / distance * side * 30 + dz / distance * 12 };
      runtime.stuck = 0;
    }
  }

  private nearestRival(actor: Actor, radius: number): Actor | null {
    const now = this.state.elapsed;
    let best = null as Actor | null;
    let bestDistance = radius;
    this.actorGrid.queryCircle(actor.position.x, actor.position.z, radius, other => {
      if (other === actor || !other.alive || other.isPlayer || other.dummy) return;
      const runtime = this.runtime(other);
      if (runtime.lodTier < 2 || runtime.duelUntil > now) return;
      const d = distance2(actor.position, other.position);
      if (d < bestDistance && Math.abs(other.position.y - actor.position.y) < 14) { best = other; bestDistance = d; }
    });
    return best;
  }

  /** Off-screen firefight: the stronger bot (gun at this range, health, a little luck) wins and pays for it. */
  private resolveDuel(a: Actor, b: Actor): void {
    const d = distance2(a.position, b.position);
    const powerA = duelPower(a, d) * (0.7 + this.random() * 0.6);
    const powerB = duelPower(b, d) * (0.7 + this.random() * 0.6);
    const [winner, loser, winnerPower, loserPower] = powerA >= powerB ? [a, b, powerA, powerB] : [b, a, powerB, powerA];
    const cost = clamp(loserPower / winnerPower, 0.2, 0.95) * (25 + this.random() * 45);
    winner.health = Math.max(5, winner.health - cost);
    for (const actor of [winner, loser]) {
      const used = Math.floor(5 + this.random() * 15);
      actor.ammo[actor.weapon] = Math.max(0, actor.ammo[actor.weapon] - used);
      this.runtime(actor).duelUntil = this.state.elapsed + 5 + this.random() * 5;
    }
    this.damage(loser, loser.health + 1, winner.id, { cause: winner.weapon });
  }

  private clearPath(from: Vec2, to: Vec2): boolean {
    const distance = distance2(from, to);
    if (distance < 0.01) return this.walkable(to);
    if (!this.walkable(to)) return false;
    const padding = ACTOR_RADIUS + 0.18;
    const ankle = (this.navFeet ?? this.heightAt(from.x, from.z)) + 0.05;
    const dx = to.x - from.x, dz = to.z - from.z;
    let clear = true;
    this.obstacles().queryBox(Math.min(from.x, to.x) - padding, Math.min(from.z, to.z) - padding, Math.max(from.x, to.x) + padding, Math.max(from.z, to.z) + padding, obstacle => {
      // Roofs are overhead and walls are judged at ankle height, so slopes never turn a clear route into a blocked one.
      if (ankle < obstacleBottom(obstacle) || ankle > obstacleTop(obstacle)) return;
      // Slab test of the segment against the obstacle grown by the walker's radius.
      const x0 = obstacle.x - obstacle.width / 2 - padding, x1 = obstacle.x + obstacle.width / 2 + padding;
      const z0 = obstacle.z - obstacle.depth / 2 - padding, z1 = obstacle.z + obstacle.depth / 2 + padding;
      let near = 0, far = 1;
      if (Math.abs(dx) < 1e-9) { if (from.x < x0 || from.x > x1) return; }
      else { let a = (x0 - from.x) / dx, b = (x1 - from.x) / dx; if (a > b) { const t = a; a = b; b = t; } near = Math.max(near, a); far = Math.min(far, b); if (near > far) return; }
      if (Math.abs(dz) < 1e-9) { if (from.z < z0 || from.z > z1) return; }
      else { let a = (z0 - from.z) / dz, b = (z1 - from.z) / dz; if (a > b) { const t = a; a = b; b = t; } near = Math.max(near, a); far = Math.min(far, b); if (near > far) return; }
      clear = false;
      return true;
    });
    return clear;
  }

  /** Nearest walkable lattice point to `point`, searching outward in rings. */
  private snapWalkable(point: Vec2, cell: number): Vec2 | null {
    const cx = Math.round(point.x / cell), cz = Math.round(point.z / cell);
    let best: Vec2 | null = null;
    let bestDistance = Infinity;
    for (let ring = 0; ring <= 4; ring++) {
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dz = -ring; dz <= ring; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          const candidate = { x: (cx + dx) * cell, z: (cz + dz) * cell };
          const d = distance2(candidate, point);
          if (d < bestDistance && this.walkable(candidate)) { best = candidate; bestDistance = d; }
        }
      }
      if (best) return best;
    }
    return null;
  }

  /**
   * Local A* on a lattice window around the start and goal, with line-of-sight smoothing; diagonal corners
   * cannot be cut. Far goals are approached in legs, so cost stays bounded on a 4 km map.
   */
  private findPath(from: Vec2, goal: Vec2): Vec2[] {
    const leg = this.openWorld ? 48 : 120;
    const travel = distance2(from, goal);
    let target = goal;
    if (travel > leg) {
      const t = leg / travel;
      const lead = { x: from.x + (goal.x - from.x) * t, z: from.z + (goal.z - from.z) * t };
      target = this.walkable(lead) ? lead : this.snapWalkable(lead, 2) ?? lead;
    }
    if (this.clearPath(from, target)) return [{ ...target }];
    // Short hops indoors need a finer lattice: a doorway with a crate behind it is narrower than two coarse cells.
    // Bunker doorways are narrow and the halls big: a fine lattice all the way.
    const cell = this.navFeet !== null ? 1 : this.openWorld ? (distance2(from, target) <= 22 ? 1 : 2) : 4;
    // Search a box around the route; a big building in the way (a warehouse, an apartment block) can need a wider one.
    let budget = this.navFeet !== null ? 6000 : 2600;
    const search = (margin: number): Vec2[] => {
    const i0 = Math.floor((Math.min(from.x, target.x) - margin) / cell), i1 = Math.ceil((Math.max(from.x, target.x) + margin) / cell);
    const j0 = Math.floor((Math.min(from.z, target.z) - margin) / cell), j1 = Math.ceil((Math.max(from.z, target.z) + margin) / cell);
    const width = i1 - i0 + 1, height = j1 - j0 + 1;
    const coordinates = (index: number): Vec2 => ({ x: (i0 + (index % width)) * cell, z: (j0 + Math.floor(index / width)) * cell });
    const indexOf = (point: Vec2) => {
      const snapped = this.snapWalkable(point, cell);
      if (!snapped) return -1;
      const i = Math.round(snapped.x / cell) - i0, j = Math.round(snapped.z / cell) - j0;
      return i < 0 || j < 0 || i >= width || j >= height ? -1 : j * width + i;
    };
    const start = indexOf(from);
    const finish = indexOf(target);
    if (start < 0 || finish < 0) return [];
    const finishAt = coordinates(finish);
    const closed = new Set<number>();
    const previous = new Map<number, number>();
    const costs = new Map([[start, 0]]);
    // Binary min-heap of [priority, index]; stale entries are skipped when popped.
    const heap: Array<[number, number]> = [[distance2(coordinates(start), finishAt), start]];
    const push = (entry: [number, number]) => {
      let i = heap.push(entry) - 1;
      while (i > 0) { const parent = (i - 1) >> 1; if (heap[parent][0] <= heap[i][0]) break; [heap[parent], heap[i]] = [heap[i], heap[parent]]; i = parent; }
    };
    const pop = (): [number, number] => {
      const top = heap[0], last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        for (let i = 0; ;) {
          const l = i * 2 + 1, r = l + 1; let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
        }
      }
      return top;
    };
    while (heap.length) {
      const current = pop()[1];
      if (closed.has(current)) continue;
      // Give up on a goal that cannot be reached instead of flooding the whole window.
      if (--budget < 0) return [];
      if (current === finish) {
        let node = current;
        const path: Vec2[] = [coordinates(node)];
        while (previous.has(node)) { node = previous.get(node)!; path.unshift(coordinates(node)); }
        if (this.clearPath(path[path.length - 1], target)) path.push({ ...target });
        // A bot hugging a wall stands inside the padded clearance, so no segment from its exact spot passes the check: step to the
        // snapped start cell first, then smooth from there.
        const smooth: Vec2[] = [];
        let anchor = { ...from };
        if (!this.walkable(from)) { anchor = coordinates(start); smooth.push(anchor); }
        for (let i = 0; i < path.length;) {
          let farthest = i;
          for (let j = path.length - 1; j > i; j--) if (this.clearPath(anchor, path[j])) { farthest = j; break; }
          if (!this.clearPath(anchor, path[farthest])) return [];
          smooth.push(path[farthest]);
          anchor = path[farthest];
          i = farthest + 1;
        }
        return smooth;
      }
      closed.add(current);
      const column = current % width;
      const row = Math.floor(current / width);
      const here = coordinates(current);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const x = column + dx;
        const z = row + dz;
        if (x < 0 || z < 0 || x >= width || z >= height) continue;
        const neighbor = z * width + x;
        if (closed.has(neighbor)) continue;
        const cost = (costs.get(current) ?? Infinity) + cell * Math.hypot(dx, dz);
        if (cost >= (costs.get(neighbor) ?? Infinity)) continue;
        const at = coordinates(neighbor);
        if (!this.clearPath(here, at)) continue;
        previous.set(neighbor, current);
        costs.set(neighbor, cost);
        push([cost + distance2(at, finishAt), neighbor]);
      }
    }
    return [];
    };
    const found = search(this.openWorld ? 14 : 24);
    return found.length || !this.openWorld || budget <= 0 ? found : search(46);
  }
}
