import type { Actor, Airdrop, AmmoType, Stance, ArmorSlot, Difficulty, Vehicle, GameEvent, GamePhase, GameState, Loot, LootKind, MapId, Obstacle, PlayerInput, Town, Vec2, Vec3, WeaponClass, WeaponType, WorldConfig, ZoneState } from '../types';
import { ACTOR_HEIGHT, ACTOR_RADIUS, createArenaWorld, HEAL_AMOUNT, HEAL_TIME, INTERACTION_RANGE, WEAPONS } from './config';
import { AMMO_PICKUP, ammoKindFor, ammoKindOf, ammoTypeOf, AMMO_ORDER, ARMOR_DURABILITY, ARMOR_NAMES, ARMOR_REDUCTION, armorKind, CORE_WEAPONS, emptyAmmo, emptyReserve, GUNS_BY_CLASS, isArmorKind, isSidearm, isWeaponKind, parseArmor, PRIMARY_SLOTS, WEAPON_ORDER } from './weapons';
import { SpatialGrid } from './spatial';
import { chooseWeapon, duelPower, gunshotLoudness, lootUtility, weakestWeapon } from './bot-logic';
import { createIslandWorld, createValleyWorld, obstacleBottom, obstacleTop } from './world';
import { movementSpread, NECK, STANCE, stanceOf } from './stance';
import { alongLine, DROP, glideReach, makePlane, placePlane, steerAir } from './drop';

interface Options { seed?: number; botCount?: number; difficulty?: Difficulty; map?: MapId; /** Start the match in the transport plane (open maps only). */ drop?: boolean }
/** A bot's plan for the drop: where to land, when to jump, how low to open the canopy. */
interface BotDrop { jumpAt: number; target: Vec2; openAgl: number; dive: boolean }
interface Runtime {
  cooldown: number; weaponCooldowns: Record<WeaponType, number>; velocityY: number; reloadWeapon: WeaponType | null;
  targetId: string | null; reaction: number; memory: number; sightTimer: number;
  goal: Vec2 | null; path: Vec2[]; pathTimer: number; stuck: number;
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
}
interface Hit { distance: number; actor?: Actor; head?: boolean; vehicle?: Vehicle }

/** How often each class turns up at a loot spot of tier 1 (houses), 2 (big houses) and 3 (cities, military). */
const CLASS_SPAWN: Record<1 | 2 | 3, Partial<Record<WeaponClass, number>>> = {
  1: { pistol: 0.16, smg: 0.17, shotgun: 0.16, ar: 0.12 },
  2: { ar: 0.18, smg: 0.08, shotgun: 0.07, br: 0.06, dmr: 0.10, lmg: 0.08, pistol: 0.03 },
  3: { dmr: 0.11, br: 0.07, sniper: 0.14, amr: 0.08, lmg: 0.09, ar: 0.12, shotgun: 0.01 },
};
/** Within a class, a gun of tier t shows up at spot tier s with this weight: rare guns concentrate in the rich spots. */
const TIER_AFFINITY: Record<1 | 2 | 3, [number, number, number]> = { 1: [1, 0.55, 0.2], 2: [0.3, 1, 0.7], 3: [0.04, 0.4, 1] };
const GEAR_SPAWN: Record<1 | 2 | 3, Array<[LootKind, number]>> = {
  1: [['medkit', 0.2], ['helmet1', 0.09], ['vest1', 0.1]],
  2: [['medkit', 0.17], ['helmet2', 0.11], ['vest2', 0.12]],
  3: [['medkit', 0.12], ['helmet3', 0.12], ['vest3', 0.14]],
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
}
/** Calibres of the guns people actually start with: spare rounds that always help someone. */
const COMMON_AMMO: AmmoType[] = ['9mm', '556', '12g', '45acp'];

const ZERO_INPUT: PlayerInput = { moveX: 0, moveZ: 0, sprint: false, jump: false };
/** Bots closer than this to the player run full AI every step; closer than LOD_NEAR run it a few times a second. */
const LOD_FULL = 220;
const LOD_NEAR = 650;
/** Crates are released this high and sink at AIRDROP_FALL m/s, about a minute in the air. */
const AIRDROP_HEIGHT = 520;
const AIRDROP_FALL = 9;
const VEHICLE_RADIUS = 1.7;
const VEHICLE_REACH = 4.2;
const VEHICLE_HEALTH = 300;
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
  private events: GameEvent[] = [];
  private runtimes = new Map<string, Runtime>();
  private jumpHeld = false;
  private shrinkStart: { center: Vec2; radius: number } | null = null;
  private obstacleGrid = new SpatialGrid<Obstacle>(24);
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
    this.options = { seed: options.seed ?? 72341, botCount: options.botCount ?? 5, difficulty: options.difficulty ?? 'normal', map: options.map ?? 'arena', drop: options.drop ?? false };
    this.world = this.makeWorld();
    this.state = this.makeState('menu');
  }

  private makeWorld(): WorldConfig {
    switch (this.options.map) {
      case 'island': return createIslandWorld();
      case 'valley': return createValleyWorld();
      default: return createArenaWorld();
    }
  }

  /** The island and the valley are open maps (terrain, loot in houses, vehicles); only the small arena is not. */
  private get openWorld(): boolean {
    return this.world.id !== 'arena';
  }

  get player(): Actor { return this.state.actors[0]; }

  /** Ground height under a point; the arena is flat. */
  heightAt(x: number, z: number): number {
    return this.world.terrain ? this.world.terrain(x, z) : 0;
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

  get lootInReach(): Loot | null {
    if (this.state.phase !== 'playing' || this.player.vehicleId || this.player.air || !this.player.alive) return null;
    return this.nearestLoot(this.player.position, INTERACTION_RANGE);
  }

  start(options: Options = {}): void {
    this.options = { ...this.options, ...options };
    this.world = this.makeWorld();
    this.events = [];
    this.state = this.makeState('playing');
    if (this.state.plane) this.events.push({ type: 'message', text: 'Máy bay đang bay qua đảo. Nhảy khi bạn đã chọn được điểm đáp!' });
    else this.events.push({ type: 'message', text: this.options.map === 'island' ? 'Bạn đã đáp xuống đảo. Tìm vũ khí, đừng để bo bắt kịp!' : this.options.map === 'valley' ? 'Bạn đã vào thung lũng. Lục nhà tìm súng, bo thu rất nhanh!' : 'Nhặt trang bị gần điểm xuất phát. Người sống cuối cùng chiến thắng!' });
  }

  returnToMenu(options: Options = {}): void {
    this.options = { ...this.options, ...options };
    this.events = [];
    this.world = this.makeWorld();
    this.state = this.makeState('menu');
  }

  /** Change the player's stance. Standing up from a lower stance needs room overhead; returns false if not allowed. */
  setStance(stance: Stance): boolean {
    const player = this.player;
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
    return (aimed ? weapon.aimSpread : weapon.spread) * stanceOf(player).spread + movementSpread(this.runtime(player).speedNow, !grounded, aimed);
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

  update(dt: number, input: PlayerInput = ZERO_INPUT): void {
    if (this.state.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
    const safeInput = { ...input, moveX: clamp(finite(input.moveX), -1, 1), moveZ: clamp(finite(input.moveZ), -1, 1) };
    const jumpPressed = safeInput.jump && !this.jumpHeld;
    this.jumpHeld = safeInput.jump;
    // Substeps keep collision, AI, and weapon cadence stable during slow frames.
    let remaining = Math.min(dt, 600);
    let first = true;
    while (remaining > 1e-8 && this.state.phase === 'playing') {
      const step = Math.min(remaining, 1 / 30);
      this.step(step, safeInput, first && jumpPressed);
      remaining -= step;
      first = false;
    }
  }

  shootPlayer(target: Vec3, aimed = false): boolean {
    if (this.state.phase !== 'playing' || this.player.vehicleId || this.player.air || ![target.x, target.y, target.z].every(Number.isFinite)) return false;
    const grounded = this.player.position.y <= this.heightAt(this.player.position.x, this.player.position.z) + 0.05;
    return this.fire(this.player, target, movementSpread(this.runtime(this.player).speedNow, !grounded, aimed), aimed);
  }

  reload(): boolean {
    if (this.state.phase !== 'playing' || this.player.vehicleId) return false;
    return this.beginReload(this.player);
  }

  switchWeapon(weapon: WeaponType): boolean {
    const actor = this.player;
    if (this.state.phase !== 'playing' || actor.vehicleId || !actor.ownedWeapons.includes(weapon) || actor.weapon === weapon) return false;
    actor.weapon = weapon;
    actor.reloading = 0;
    this.runtime(actor).reloadWeapon = null;
    this.cancelHeal(actor);
    this.runtime(actor).cooldown = Math.max(this.runtime(actor).cooldown, 0.25);
    return true;
  }

  heal(): boolean {
    if (this.state.phase !== 'playing' || this.player.vehicleId) return false;
    return this.beginHeal(this.player);
  }

  interact(): boolean {
    const loot = this.lootInReach;
    if (!loot || !this.collectLoot(this.player, loot)) return false;
    this.events.push({ type: 'pickup', kind: loot.kind });
    return true;
  }

  /**
   * Give an actor the item and retire it from the world. Loadout rules: two main guns and one sidearm; a full group
   * swaps out the gun in hand (or the weakest). Armour only replaces a lower tier, and the old piece is dropped.
   */
  private collectLoot(actor: Actor, loot: Loot): boolean {
    const kind = loot.kind;
    if (isWeaponKind(kind)) {
      if (actor.ownedWeapons.includes(kind)) {
        actor.reserve[WEAPONS[kind].ammoType] += WEAPONS[kind].magazine;
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
        actor.ammo[kind] = WEAPONS[kind].magazine;
        actor.reserve[WEAPONS[kind].ammoType] += WEAPONS[kind].magazine;
        // Taking a gun while the matching slot was empty keeps the weapon in hand; a swap equips the new one.
        if (equip && actor.isPlayer) { actor.weapon = kind; actor.reloading = 0; this.runtime(actor).reloadWeapon = null; }
        else if (equip) this.botSwitch(actor, kind);
      }
    } else if (kind === 'medkit') {
      actor.medkits++;
    } else if (isArmorKind(kind)) {
      const { slot, level } = parseArmor(kind);
      if (level <= actor[slot]) {
        if (actor.isPlayer) this.events.push({ type: 'message', text: `Bạn đã có ${ARMOR_NAMES[slot].toLowerCase()} tốt hơn.` });
        return false;
      }
      if (actor[slot] > 0) this.dropLoot(actor, armorKind(slot, actor[slot]), 0.9);
      actor[slot] = level;
      actor[`${slot}Hp`] = ARMOR_DURABILITY[level];
    } else {
      const ammo = ammoTypeOf(kind);
      if (!ammo) return false;
      actor.reserve[ammo] += AMMO_PICKUP[ammo];
    }
    loot.active = false;
    return true;
  }

  private dropCounter = 0;

  /** Place an item on the ground beside an actor. */
  private dropLoot(actor: Actor, kind: LootKind, offset: number): void {
    const angle = (this.dropCounter * 2.399) % (Math.PI * 2);
    const x = actor.position.x + Math.cos(angle) * offset, z = actor.position.z + Math.sin(angle) * offset;
    const spot = this.walkable({ x, z }, 0.05) ? { x, z } : { x: actor.position.x, z: actor.position.z };
    this.state.loot.push({ id: `drop-${actor.id}-${this.dropCounter++}`, kind, position: { x: spot.x, y: this.heightAt(spot.x, spot.z), z: spot.z }, active: true });
  }

  /** Remove a gun from a loadout. Its loaded rounds return to the ammunition pool so nothing is lost. */
  private dropWeapon(actor: Actor, weapon: WeaponType): void {
    actor.ownedWeapons = actor.ownedWeapons.filter(w => w !== weapon);
    actor.reserve[WEAPONS[weapon].ammoType] += actor.ammo[weapon];
    actor.ammo[weapon] = 0;
    this.dropLoot(actor, weapon, 0.8);
    if (actor.weapon === weapon && actor.ownedWeapons.length) actor.weapon = actor.ownedWeapons[0];
  }

  /** Armour soaks part of a hit and wears down; a broken piece disappears. */
  private absorb(victim: Actor, amount: number, head: boolean): number {
    const slot: ArmorSlot = head ? 'helmet' : 'vest';
    const level = victim[slot];
    if (!level) return amount;
    const key = `${slot}Hp` as const;
    const absorbed = Math.min(amount * ARMOR_REDUCTION[level], victim[key]);
    victim[key] -= absorbed;
    if (victim[key] <= 1e-6) {
      victim[slot] = 0;
      victim[key] = 0;
      if (victim.isPlayer) this.events.push({ type: 'message', text: `${ARMOR_NAMES[slot]} đã bị phá hỏng!` });
    }
    return amount - absorbed;
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
    this.jumpHeld = false;
    this.shrinkStart = null;
    this.dropTargets = [];
    const island = this.openWorld;
    const count = this.options.botCount + 1;
    let spawns = this.world.spawns;
    if (island) {
      // Scatter everyone across the map: a seeded shuffle of the candidate drop points.
      spawns = this.world.spawns.slice();
      for (let i = spawns.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [spawns[i], spawns[j]] = [spawns[j], spawns[i]];
      }
    }
    const actors: Actor[] = spawns.slice(0, count).map((spawn, index) => {
      const botWeapons: WeaponType[] = island
        ? ['pistol']
        : ['rifle', 'smg', 'shotgun', 'dmr', this.options.seed % 2 === 0 ? 'heavySniper' : 'sniper', 'pistol', 'lmg'];
      // On the island everyone drops in with a sidearm and has to loot the rest.
      const weapon: WeaponType = index === 0 ? (island ? 'pistol' : 'rifle') : botWeapons[(index - 1) % botWeapons.length];
      const ammo = emptyAmmo();
      const reserve = emptyReserve();
      ammo[weapon] = WEAPONS[weapon].magazine;
      reserve[WEAPONS[weapon].ammoType] = index === 0 ? (island ? WEAPONS.pistol.ammoPickup : 60) : WEAPONS[weapon].ammoPickup * (island ? 1 : 3);
      const actor: Actor = {
        id: index === 0 ? 'player' : `bot-${index}`, name: index === 0 ? 'Bạn' : `Đối thủ ${index}`,
        isPlayer: index === 0, position: { x: spawn.x, y: this.heightAt(spawn.x, spawn.z), z: spawn.z }, yaw: index === 0 ? 0 : this.random() * Math.PI * 2,
        health: 100, alive: true, weapon, ownedWeapons: [weapon], helmet: 0, vest: 0, helmetHp: 0, vestHp: 0,
        ammo, reserve,
        reloading: 0, healing: 0, medkits: index === 0 ? 1 : 1, hurtTimer: 0,
      };
      this.runtime(actor);
      return actor;
    });
    const loot: Loot[] = [];
    const add = (kind: LootKind, x: number, z: number, y = 0) => loot.push({ id: `loot-${loot.length}`, kind, position: { x, y, z }, active: true });
    if (island) this.scatterIslandLoot(add);
    else this.scatterArenaLoot(add);
    const profile = this.world.zone;
    const zone: ZoneState = {
      center: { x: 0, z: 0 }, radius: profile.start, nextCenter: { x: 0, z: 0 }, nextRadius: profile.radii[0],
      stage: 0, timeRemaining: profile.waits[0], isShrinking: false,
    };
    zone.nextCenter = this.nextZoneCenter(zone.center, zone.radius, zone.nextRadius);
    const vehicles: Vehicle[] = this.world.vehicleSpawns.map((spawn, index) => ({
      id: `car-${index}`, position: { x: spawn.x, y: this.heightAt(spawn.x, spawn.z), z: spawn.z }, yaw: spawn.yaw, speed: 0,
      health: VEHICLE_HEALTH, driverId: null, colorIndex: index % 5, hitTimer: 0,
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
    }
    return { phase, elapsed: 0, actors, loot, vehicles, zone, kills: 0, shots: 0, hits: 0, plane, airdrops: [] };
  }

  /** Weighted gear tables: later tiers (cities, big houses) hold the heavy weapons. */
  private scatterIslandLoot(add: (kind: LootKind, x: number, z: number, y?: number) => void): void {
    const tables = LOOT_TABLES;
    for (const spot of this.world.lootSpots) {
      const table = tables[spot.tier];
      for (let pick = 0; pick < 2; pick++) {
        let roll = this.random();
        let kind: LootKind = table[0][0];
        for (const [candidate, weight] of table) { kind = candidate; if ((roll -= weight) < 0) break; }
        const x = spot.x + (this.random() - 0.5) * 2.4, z = spot.z + (this.random() - 0.5) * 2.4;
        add(kind, x, z, spot.y);
        if (isWeaponKind(kind)) add(ammoKindFor(kind), x + 0.7, z + 0.5, spot.y);
        else if (this.random() < 0.5) add(ammoKindOf(COMMON_AMMO[Math.floor(this.random() * COMMON_AMMO.length)]), x + 0.7, z + 0.5, spot.y);
      }
    }
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
    const columns = 15;
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

  private runtime(actor: Actor): Runtime {
    let runtime = this.runtimes.get(actor.id);
    if (!runtime) {
      runtime = {
        cooldown: 0, weaponCooldowns: emptyAmmo(), velocityY: 0, reloadWeapon: null, targetId: null, reaction: 0, memory: 0, sightTimer: 0,
        goal: null, path: [], pathTimer: 0, stuck: 0,
        focus: 0, strafeDir: 1, strafeTimer: 0, burstLeft: 0, stillTime: 0,
        lastSeen: null, lastSeenAt: -Infinity, enemyVel: { x: 0, z: 0 }, enemyLast: null,
        heard: null, heardTimer: 0,
        lootRef: null, lootTimer: 0, ignored: new Map(), coverGoal: null, coverTimer: 0, weaponTimer: 0,
        visited: new Set(), townGoal: null,
        lodAcc: 0, lodTier: 0, duelUntil: 0, detour: 0, carTarget: null, destination: null, carCooldown: 0, drop: null, airdropGoal: null, speedNow: 0,
      };
      this.runtimes.set(actor.id, runtime);
    }
    return runtime;
  }

  private step(dt: number, input: PlayerInput, jumpPressed: boolean): void {
    this.state.elapsed += dt;
    this.advanceZone(dt);
    this.stepPlane(dt);
    this.stepAirdrops(dt);
    if (jumpPressed || Math.hypot(input.moveX, input.moveZ) > 0.05) this.cancelHeal(this.player);
    for (const actor of this.state.actors) {
      if (!actor.alive) continue;
      const runtime = this.runtime(actor);
      runtime.cooldown = Math.max(0, runtime.cooldown - dt);
      for (const weapon of actor.ownedWeapons) runtime.weaponCooldowns[weapon] = Math.max(0, runtime.weaponCooldowns[weapon] - dt);
      actor.hurtTimer = Math.max(0, actor.hurtTimer - dt);
      if (actor.reloading > 0) {
        actor.reloading = Math.max(0, actor.reloading - dt);
        if (actor.reloading < 1e-7) {
          actor.reloading = 0;
          const weapon = runtime.reloadWeapon ?? actor.weapon;
          const ammoType = WEAPONS[weapon].ammoType;
          const amount = Math.min(WEAPONS[weapon].magazine - actor.ammo[weapon], actor.reserve[ammoType]);
          actor.ammo[weapon] += amount;
          actor.reserve[ammoType] -= amount;
          runtime.reloadWeapon = null;
        }
      }
      if (actor.healing > 0) {
        actor.healing = Math.max(0, actor.healing - dt);
        if (actor.healing < 1e-7) {
          actor.healing = 0;
          if (actor.medkits > 0) {
            actor.medkits--;
            actor.health = Math.min(100, actor.health + HEAL_AMOUNT);
            if (actor.isPlayer) this.events.push({ type: 'message', text: 'Đã hồi máu.' });
          }
        }
      }
    }
    const player = this.player;
    if (player.air) this.flyPlayer(dt, input, jumpPressed);
    else if (!player.vehicleId) this.walkPlayer(dt, input, jumpPressed);
    this.rebuildActorGrid();
    this.pathBudget = 3;
    this.updateBots(dt);
    this.stepVehicles(dt, input);
    this.applyZone(dt);
    this.checkEnd();
  }

  private walkPlayer(dt: number, input: PlayerInput, jumpPressed: boolean): void {
    const player = this.player;
    // Jumping or sprinting from a crouch or lying down first gets you up (if there is room).
    const wasLow = !!player.stance && player.stance !== 'stand';
    if (wasLow && (jumpPressed || (input.sprint && Math.hypot(input.moveX, input.moveZ) > 0.2))) this.setStance('stand');
    if (jumpPressed && !wasLow && player.position.y <= this.heightAt(player.position.x, player.position.z) + 1e-6) {
      this.runtime(player).velocityY = 6.7;
      this.cancelHeal(player);
    }
    const stanceData = stanceOf(player);
    const before = { x: player.position.x, z: player.position.z };
    this.moveActor(player, input.moveX, input.moveZ, input.sprint ? stanceData.sprint : stanceData.speed, dt);
    this.runtime(player).speedNow = Math.hypot(player.position.x - before.x, player.position.z - before.z) / Math.max(dt, 1e-6);
    const playerRuntime = this.runtime(player);
    const ground = this.heightAt(player.position.x, player.position.z);
    if (player.position.y > ground || playerRuntime.velocityY > 0) {
      playerRuntime.velocityY -= 18 * dt;
      player.position.y = Math.max(ground, player.position.y + playerRuntime.velocityY * dt);
      // On rolling terrain, stay glued to the ground when walking downhill instead of hopping.
      if (this.world.terrain && playerRuntime.velocityY <= 0 && player.position.y - ground < 0.35) player.position.y = ground;
      if (player.position.y === ground) playerRuntime.velocityY = 0;
      this.resolvePenetration(player);
    } else player.position.y = ground;
  }

  private applyZone(dt: number): void {
    for (const actor of this.state.actors) {
      if (!actor.alive || actor.air || this.state.phase !== 'playing') continue;
      if (distance2(actor.position, this.state.zone.center) > this.state.zone.radius) {
        const damage = 1.5 + this.state.zone.stage * 2 + (this.state.zone.radius <= 0.01 ? 20 : 0);
        this.damage(actor, damage * dt);
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
      if (actor.isPlayer) this.events.push({ type: 'message', text: 'Máy bay đã bay hết đảo, bạn bị đẩy ra khỏi cửa!' });
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
    if (actor.isPlayer) this.events.push({ type: 'message', text: `Rơi tự do! Lái để chọn điểm đáp, nhảy lần nữa để mở dù (tự mở ở độ cao ${DROP.autoOpen} m).` });
  }

  private openChute(actor: Actor): void {
    if (actor.air?.mode !== 'freefall') return;
    actor.air.mode = 'chute';
    this.events.push({ type: 'drop', actorId: actor.id, stage: 'chute' });
  }

  private flyPlayer(dt: number, input: PlayerInput, jumpPressed: boolean): void {
    const player = this.player;
    const air = player.air!;
    if (air.mode === 'plane') {
      if (jumpPressed && this.state.elapsed > DROP.doorDelay) this.jumpFromPlane(player);
      return;
    }
    // A second press opens the canopy, but not in the first instant of the fall, so a double tap cannot waste the altitude.
    if (jumpPressed && air.mode === 'freefall' && air.time > 1) this.openChute(player);
    this.moveInAir(player, { x: input.moveX, z: input.moveZ, dive: input.sprint }, dt);
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
      if (obstacle.kind === 'roof' && Math.abs(point.x - obstacle.x) < obstacle.width / 2 + 0.5 && Math.abs(point.z - obstacle.z) < obstacle.depth / 2 + 0.5) { covered = true; return true; }
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
    if (actor.isPlayer && splash) this.events.push({ type: 'message', text: 'Bạn rơi xuống nước và bơi vào bờ.' });
    else if (actor.isPlayer) this.events.push({ type: 'message', text: 'Đã tiếp đất. Tìm vũ khí trong nhà gần nhất!' });
    if (impact > DROP.safeLanding) this.damage(actor, (impact - DROP.safeLanding) * 3);
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
    if ((this.world.id === 'island' ? [1, 3] : [1, 2]).includes(stage)) this.releaseAirdrop();
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
    contents.push('helmet3', 'vest3', 'medkit', 'medkit');
    for (const kind of [...contents]) if (isWeaponKind(kind)) contents.push(ammoKindFor(kind), ammoKindFor(kind));
    contents.forEach((kind, index) => {
      const angle = index / contents.length * Math.PI * 2;
      const x = drop.x + Math.cos(angle) * 1.8, z = drop.z + Math.sin(angle) * 1.8;
      const id = `${drop.id}-${index}`;
      this.state.loot.push({ id, kind, position: { x, y: this.heightAt(x, z), z }, active: true });
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
  get vehicleInReach(): Vehicle | null {
    if (this.state.phase !== 'playing' || this.player.vehicleId || this.player.air || !this.player.alive) return null;
    let best = null as Vehicle | null;
    let nearest = VEHICLE_REACH;
    for (const v of this.state.vehicles) {
      if (v.driverId || v.health <= 0) continue;
      const d = distance2(v.position, this.player.position);
      if (d < nearest) { best = v; nearest = d; }
    }
    return best;
  }

  /** Get into the nearest car, or out of the one being driven. */
  useVehicle(): boolean {
    if (this.state.phase !== 'playing' || this.player.air || !this.player.alive) return false;
    if (this.player.vehicleId) { this.exitVehicle(this.player); return true; }
    const car = this.vehicleInReach;
    return car ? this.enterVehicle(this.player, car) : false;
  }

  private enterVehicle(actor: Actor, v: Vehicle): boolean {
    if (v.driverId || v.health <= 0 || actor.vehicleId) return false;
    this.cancelHeal(actor);
    actor.reloading = 0;
    this.runtime(actor).reloadWeapon = null;
    actor.vehicleId = v.id;
    actor.stance = 'stand';
    v.driverId = actor.id;
    actor.position = { x: v.position.x, y: v.position.y + 0.3, z: v.position.z };
    if (actor.isPlayer) this.events.push({ type: 'message', text: 'Đang lái xe. Nhấn F để xuống xe.' });
    return true;
  }

  private exitVehicle(actor: Actor): void {
    const v = this.vehicle(actor.vehicleId);
    actor.vehicleId = null;
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
    const runtime = this.runtime(actor);
    runtime.path = [];
    runtime.pathTimer = 0;
    if (actor.isPlayer) this.events.push({ type: 'message', text: 'Đã xuống xe.' });
  }

  private stepVehicles(dt: number, input: PlayerInput): void {
    for (const v of this.state.vehicles) {
      v.hitTimer = Math.max(0, v.hitTimer - dt);
      if (v.health <= 0) continue;
      let driver = this.vehicleDriver(v);
      if (v.driverId && (!driver || !driver.alive)) { v.driverId = null; driver = undefined; }
      let throttle = 0, steer = 0, brake = false;
      if (driver?.isPlayer) {
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

  private driveVehicle(v: Vehicle, throttle: number, steer: number, brake: boolean, dt: number): void {
    const maxForward = 30, maxReverse = 9;
    if (Math.abs(throttle) > 0.02) {
      const target = throttle > 0 ? maxForward * throttle : maxReverse * throttle;
      const braking = (throttle > 0 && v.speed < -0.3) || (throttle < 0 && v.speed > 0.3);
      v.speed += clamp(target - v.speed, braking ? -18 * dt : -6 * dt, braking ? 18 * dt : 9 * dt);
    } else v.speed *= Math.exp(-0.45 * dt);
    if (brake) v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), 22 * dt);
    // Slopes pull on the car: climbing bleeds speed, descending adds some.
    const sx = Math.sin(v.yaw), cz = Math.cos(v.yaw);
    const rise = (this.heightAt(v.position.x + sx * 2, v.position.z + cz * 2) - this.heightAt(v.position.x - sx * 2, v.position.z - cz * 2)) / 4;
    v.speed = clamp(v.speed - rise * 9.81 * 0.35 * dt, -maxReverse * 1.2, maxForward * 1.1);
    // Bicycle steering: tighter at low speed, calmer when fast.
    const lock = 0.6 / (1 + Math.abs(v.speed) * 0.05);
    v.yaw = wrapAngle(v.yaw + (v.speed / 2.9) * Math.tan(steer * lock) * dt);
    const distance = v.speed * dt;
    const pieces = Math.max(1, Math.ceil(Math.abs(distance) / 0.8));
    for (let i = 0; i < pieces; i++) {
      const next = { x: v.position.x + Math.sin(v.yaw) * distance / pieces, z: v.position.z + Math.cos(v.yaw) * distance / pieces };
      if (!this.walkable(next, VEHICLE_RADIUS, v.position.y)) { this.crash(v); break; }
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
    if (driver && impact > 9) this.damage(driver, (impact - 9) * 2.2);
    if (v.health <= 0) this.explode(v);
  }

  private explode(v: Vehicle): void {
    v.health = 0;
    v.speed = 0;
    const driver = this.vehicleDriver(v);
    if (driver) { this.exitVehicle(driver); this.damage(driver, 25); }
    v.driverId = null;
    this.events.push({ type: 'explosion', position: { ...v.position } });
    for (const actor of this.state.actors) {
      if (!actor.alive || actor.vehicleId || actor.air) continue;
      const d = distance2(actor.position, v.position);
      if (d < 7) this.damage(actor, 70 * (1 - d / 7));
    }
    const lengthwise = Math.abs(Math.sin(v.yaw)) > 0.7;
    this.world.obstacles.push({
      id: `wreck-${v.id}`, x: v.position.x, z: v.position.z, width: lengthwise ? 4.2 : 2.2, depth: lengthwise ? 2.2 : 4.2,
      height: 1.4, kind: 'wreck', base: v.position.y,
    });
  }

  /** A moving car hurts anyone it hits, and loses a little speed doing so. */
  private runOver(v: Vehicle, driver: Actor | undefined): void {
    if (!driver || Math.abs(v.speed) < 5 || v.hitTimer > 0) return;
    this.actorGrid.queryCircle(v.position.x, v.position.z, 2.6, other => {
      if (other === driver || !other.alive || other.vehicleId || distance2(other.position, v.position) > 2.3) return;
      this.damage(other, Math.min(110, Math.abs(v.speed) * 5), driver.id);
      v.hitTimer = 0.45;
      v.speed *= 0.82;
    });
  }

  /** Shots wreck a car; the driver takes a little of every hit. */
  private damageVehicle(v: Vehicle, amount: number, sourceId: string): void {
    if (v.health <= 0) return;
    v.health -= amount * 0.55;
    const driver = this.vehicleDriver(v);
    if (driver && driver.id !== sourceId) this.damage(driver, amount * 0.08, sourceId);
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
    const clear = (angle: number) => this.walkable({ x: v.position.x + Math.sin(v.yaw + angle) * look, z: v.position.z + Math.cos(v.yaw + angle) * look }, VEHICLE_RADIUS, v.position.y);
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
    const player = this.player.position;
    for (const actor of this.state.actors) {
      if (actor.isPlayer || !actor.alive || this.state.phase !== 'playing') continue;
      if (actor.air) { this.updateBotAir(actor, dt); continue; }
      if (!lod) { this.updateBot(actor, dt); continue; }
      const runtime = this.runtime(actor);
      const d = distance2(actor.position, player);
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
    if (!actor.alive || actor.reloading > 0 || actor.ammo[weapon] >= WEAPONS[weapon].magazine || actor.reserve[WEAPONS[weapon].ammoType] <= 0) return false;
    this.cancelHeal(actor);
    actor.reloading = WEAPONS[weapon].reloadTime;
    this.runtime(actor).reloadWeapon = weapon;
    return true;
  }

  private beginHeal(actor: Actor): boolean {
    if (!actor.alive || actor.medkits <= 0 || actor.health >= 100 || actor.healing > 0 || actor.reloading > 0) return false;
    actor.healing = HEAL_TIME;
    if (actor.isPlayer) this.events.push({ type: 'message', text: 'Đang hồi máu… Hãy đứng yên.' });
    return true;
  }

  private cancelHeal(actor: Actor): void {
    if (actor.healing > 0) {
      actor.healing = 0;
      if (actor.isPlayer) this.events.push({ type: 'message', text: 'Đã hủy hồi máu.' });
    }
  }

  private fire(actor: Actor, target: Vec3, extraSpread: number, aimed = false): boolean {
    const runtime = this.runtime(actor);
    const weapon = WEAPONS[actor.weapon];
    if (!actor.alive || actor.reloading > 0 || runtime.cooldown > 1e-7 || runtime.weaponCooldowns[actor.weapon] > 1e-7) return false;
    if (actor.ammo[actor.weapon] <= 0) { this.beginReload(actor); return false; }
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
    if (actor.isPlayer) this.state.shots++;
    let anyHit = false;
    const damageByActor = new Map<Actor, number>();
    let visualHit: Hit = { distance: weapon.range };
    let visualDirection = direction;
    const muzzleDirection = { x: Math.sin(actor.yaw), y: 0, z: Math.cos(actor.yaw) };
    let muzzleBlocked = false;
    this.obstacles().queryCircle(chest.x, chest.z, 1, obstacle => {
      if (obstacleHit(chest, muzzleDirection, obstacle, 0.45) !== null) { muzzleBlocked = true; return true; }
    });
    for (let pellet = 0; pellet < weapon.pellets; pellet++) {
      const ray = this.spreadDirection(direction, (aimed ? weapon.aimSpread : weapon.spread) * stanceOf(actor).spread + extraSpread);
      const hit = muzzleBlocked ? { distance: 0 } : this.raycast(from, ray, weapon.range, actor.id);
      if (pellet === 0 || (!visualHit.actor && hit.actor)) { visualHit = hit; visualDirection = ray; }
      if (hit.vehicle) this.damageVehicle(hit.vehicle, weapon.damage, actor.id);
      if (hit.actor) {
        anyHit = true;
        // Shotguns lose damage gradually beyond their useful close-range distance.
        const falloff = weapon.kind === 'shotgun' ? clamp(1 - Math.max(0, hit.distance - 12) / 45, 0.45, 1) : 1;
        const raw = weapon.damage * falloff * (hit.head ? 1.65 : 1);
        damageByActor.set(hit.actor, (damageByActor.get(hit.actor) ?? 0) + this.absorb(hit.actor, raw, !!hit.head));
      }
    }
    const to = { x: from.x + visualDirection.x * visualHit.distance, y: from.y + visualDirection.y * visualHit.distance, z: from.z + visualDirection.z * visualHit.distance };
    this.events.push({ type: 'shot', actorId: actor.id, weapon: actor.weapon, from, to, ...(visualHit.actor ? { hitId: visualHit.actor.id } : {}) });
    // On the cramped arena everyone would hear everything; halve the range there.
    this.alertNearby(actor, gunshotLoudness(actor.weapon) * (this.openWorld ? 1 : 0.45));
    if (actor.isPlayer && anyHit) this.state.hits++;
    for (const [victim, amount] of damageByActor) this.damage(victim, amount, actor.id);
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

  private raycast(origin: Vec3, direction: Vec3, range: number, ignoreId: string): Hit {
    let closest: Hit = { distance: range };
    this.obstacles().querySegment(origin.x, origin.z, origin.x + direction.x * range, origin.z + direction.z * range, obstacle => {
      const hit = obstacleHit(origin, direction, obstacle, closest.distance);
      if (hit !== null && hit <= closest.distance) closest = { distance: hit };
    });
    const ground = this.terrainHit(origin, direction, closest.distance);
    if (ground !== null && ground < closest.distance) closest = { distance: ground };
    for (const car of this.state.vehicles) {
      if (car.health <= 0) continue;
      const dx = origin.x - car.position.x, dz = origin.z - car.position.z;
      if (Math.hypot(dx, dz) > closest.distance + 4) continue;
      // Rotate the ray into the car's own frame (x to its right, z forward) and test an upright box.
      const c = Math.cos(car.yaw), s = Math.sin(car.yaw);
      const localOrigin = { x: dx * c - dz * s, y: origin.y, z: dx * s + dz * c };
      const localDirection = { x: direction.x * c - direction.z * s, y: direction.y, z: direction.x * s + direction.z * c };
      const hit = rayBox(localOrigin, localDirection, { x: -0.95, y: car.position.y + 0.25, z: -2.1 }, { x: 0.95, y: car.position.y + 1.7, z: 2.1 }, closest.distance);
      if (hit !== null && hit < closest.distance) closest = { distance: hit, vehicle: car };
    }
    for (const actor of this.state.actors) {
      if (!actor.alive || actor.id === ignoreId || actor.vehicleId || actor.air) continue;
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

  private damage(actor: Actor, amount: number, sourceId?: string): void {
    if (!actor.alive || amount <= 0) return;
    const actual = Math.min(actor.health, amount);
    actor.health = Math.max(0, actor.health - actual);
    actor.hurtTimer = 0.45;
    // Zone ticks are intentionally not emitted every frame; the HUD tracks health.
    if (sourceId) {
      this.cancelHeal(actor);
      this.events.push({ type: 'damage', actorId: actor.id, amount: actual, sourceId });
    }
    if (actor.health <= 1e-7) {
      if (actor.vehicleId) this.exitVehicle(actor);
      actor.health = 0;
      actor.alive = false;
      if (actor.isPlayer) { this.state.playerRank = this.state.actors.filter(a => a.alive).length + 1; this.state.diedAt = this.state.elapsed; }
      actor.reloading = 0;
      actor.healing = 0;
      if (sourceId === this.player.id && !actor.isPlayer) this.state.kills++;
      this.events.push({ type: 'kill', actorId: actor.id, ...(sourceId ? { killerId: sourceId } : {}) });
      if (!actor.isPlayer) {
        const dropPosition = (offset: number): Vec3 => {
          const x = actor.position.x + offset;
          const position = { x, y: this.heightAt(x, actor.position.z), z: actor.position.z };
          return this.walkable(position, 0.05) ? position : { ...actor.position, y: this.heightAt(actor.position.x, actor.position.z) };
        };
        this.state.loot.push({ id: `drop-${actor.id}-weapon`, kind: actor.weapon, position: dropPosition(-0.7), active: true });
        this.state.loot.push({ id: `drop-${actor.id}-ammo`, kind: ammoKindFor(actor.weapon), position: dropPosition(0), active: true });
        if (actor.medkits) this.state.loot.push({ id: `drop-${actor.id}-medkit`, kind: 'medkit', position: dropPosition(0.7), active: true });
        // Everything else the bot carried: spare guns and armour, so a fallen enemy is worth searching.
        actor.ownedWeapons.filter(w => w !== actor.weapon).forEach(w => this.dropLoot(actor, w, 1.1));
        for (const slot of ['helmet', 'vest'] as const) if (actor[slot] > 0) this.dropLoot(actor, armorKind(slot, actor[slot]), 1.4);
      }
    }
  }

  private checkEnd(): void {
    if (this.state.phase !== 'playing') return;
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
    if (zone.stage >= profile.radii.length) return;
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
    const feet = () => actor.isPlayer ? actor.position.y : this.heightAt(actor.position.x, actor.position.z);
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
      actor.position.y = this.heightAt(actor.position.x, actor.position.z);
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

  private walkable(point: Vec2, padding = ACTOR_RADIUS + 0.15, standing?: number, height = ACTOR_HEIGHT): boolean {
    const edge = this.world.halfSize - padding;
    if (Math.abs(point.x) > edge || Math.abs(point.z) > edge) return false;
    const ground = this.heightAt(point.x, point.z);
    if (this.world.water && this.deepWater(point.x, point.z, ground)) return false;
    const feet = standing ?? ground;
    let free = true;
    this.obstacles().queryBox(point.x - padding, point.z - padding, point.x + padding, point.z + padding, obstacle => {
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
  private lineClear(from: Vec3, target: Vec3): boolean {
    const distance = Math.hypot(target.x - from.x, target.y - from.y, target.z - from.z);
    if (distance < 0.01) return true;
    const direction = { x: (target.x - from.x) / distance, y: (target.y - from.y) / distance, z: (target.z - from.z) / distance };
    let clear = true;
    this.obstacles().querySegment(from.x, from.z, target.x, target.z, obstacle => {
      if (obstacleHit(from, direction, obstacle, distance) !== null) { clear = false; return true; }
    });
    return clear && this.terrainHit(from, direction, distance) === null;
  }

  private canSee(actor: Actor, enemy: Actor): boolean {
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
      if (!enemy.alive || enemy.id === actor.id) return;
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
      if (d > loudness || d < 8 || runtime.heardTimer > 6.5) return;
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
        const until = runtime.ignored.get(loot.id);
        if (until !== undefined && until > now) return;
        const utility = lootUtility(actor, loot.kind);
        if (utility <= 0 || distance2(loot.position, zone.center) > zone.radius - 8) return;
        const score = utility / (1 + Math.hypot(loot.position.x - actor.position.x, loot.position.z - actor.position.z) / 25);
        if (score > bestScore) { best = loot; bestScore = score; }
      });
      runtime.lootRef = best;
    }
    const target = runtime.lootRef;
    if (!target) return false;
    if (Math.hypot(target.position.x - actor.position.x, target.position.y - actor.position.y, target.position.z - actor.position.z) <= 1.5) {
      this.collectLoot(actor, target);
      runtime.lootRef = null;
      runtime.lootTimer = 0.25;
      return false;
    }
    runtime.goal = { x: target.position.x, z: target.position.z };
    return true;
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
    if (evacuating) {
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
    if (!exposed && !evacuating && actor.health < 55 && actor.medkits > 0 && actor.reloading === 0) {
      this.beginHeal(actor);
      return;
    }

    let direct: { dx: number; dz: number; speed: number } | null = null;
    let hold = false;
    // A marksman holding a long-range position lies down instead of crouching.
    let lieDown = false;
    let speed = 3.6;
    const lowHealth = actor.health < 38 && (actor.medkits > 0 || actor.health < 22);
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
    const goal = runtime.goal;
    if (!goal || this.state.phase !== 'playing') return 0;
    if ((runtime.pathTimer <= 0 || !runtime.path.length) && this.pathBudget <= 0) {
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
    if (!evacuating && actor.health < 60 && actor.medkits > 0 && actor.reloading === 0) { this.beginHeal(actor); return; }
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
      if (other === actor || !other.alive || other.isPlayer) return;
      const runtime = this.runtime(other);
      if (runtime.lodTier < 2 || runtime.duelUntil > now) return;
      const d = distance2(actor.position, other.position);
      if (d < bestDistance) { best = other; bestDistance = d; }
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
    this.damage(loser, loser.health + 1, winner.id);
  }

  private clearPath(from: Vec2, to: Vec2): boolean {
    const distance = distance2(from, to);
    if (distance < 0.01) return this.walkable(to);
    if (!this.walkable(to)) return false;
    const padding = ACTOR_RADIUS + 0.18;
    const ankle = this.heightAt(from.x, from.z) + 0.05;
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
    const cell = this.openWorld ? 2 : 4;
    const margin = this.openWorld ? 14 : 24;
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
    const open = new Set([start]);
    const closed = new Set<number>();
    const previous = new Map<number, number>();
    const costs = new Map([[start, 0]]);
    const heuristics = new Map([[start, distance2(coordinates(start), coordinates(finish))]]);
    while (open.size) {
      let current = -1;
      let cheapest = Infinity;
      for (const index of open) { const cost = (costs.get(index) ?? Infinity) + (heuristics.get(index) ?? Infinity); if (cost < cheapest) { current = index; cheapest = cost; } }
      if (current === finish) {
        const path: Vec2[] = [coordinates(current)];
        while (previous.has(current)) { current = previous.get(current)!; path.unshift(coordinates(current)); }
        if (this.clearPath(path[path.length - 1], target)) path.push({ ...target });
        const smooth: Vec2[] = [];
        let anchor = { ...from };
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
      open.delete(current);
      closed.add(current);
      const column = current % width;
      const row = Math.floor(current / width);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const x = column + dx;
        const z = row + dz;
        if (x < 0 || z < 0 || x >= width || z >= height) continue;
        const neighbor = z * width + x;
        if (closed.has(neighbor) || !this.clearPath(coordinates(current), coordinates(neighbor))) continue;
        const cost = (costs.get(current) ?? Infinity) + cell * Math.hypot(dx, dz);
        if (cost >= (costs.get(neighbor) ?? Infinity)) continue;
        previous.set(neighbor, current);
        costs.set(neighbor, cost);
        heuristics.set(neighbor, distance2(coordinates(neighbor), coordinates(finish)));
        open.add(neighbor);
      }
    }
    return [];
  }
}
