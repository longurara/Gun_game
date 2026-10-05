import type { Actor, Difficulty, GameEvent, GamePhase, GameState, Loot, LootKind, Obstacle, PlayerInput, Vec2, Vec3, WeaponType, WorldConfig, ZoneState } from '../types';
import { ACTOR_HEIGHT, ACTOR_RADIUS, createWorld, HEAL_AMOUNT, HEAL_TIME, INTERACTION_RANGE, WEAPONS } from './config';
import { ammoKindFor, emptyAmmo, isWeaponKind, WEAPON_ORDER, weaponForAmmo } from './weapons';

interface Options { seed?: number; botCount?: 5 | 7; difficulty?: Difficulty }
interface Runtime {
  cooldown: number; weaponCooldowns: Record<WeaponType, number>; velocityY: number; reloadWeapon: WeaponType | null;
  targetId: string | null; reaction: number; memory: number; sightTimer: number;
  goal: Vec2 | null; path: Vec2[]; pathTimer: number; stuck: number;
}
interface Hit { distance: number; actor?: Actor; head?: boolean }

const ZONE_RADII = [80, 60, 42, 25, 11, 0];
const ZONE_WAITS = [60, 45, 35, 30, 20, 10];
const ZONE_SHRINKS = [35, 35, 40, 40, 40, 40];
const ZERO_INPUT: PlayerInput = { moveX: 0, moveZ: 0, sprint: false, jump: false };
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
    { x: obstacle.x - obstacle.width / 2 - padding, y: 0, z: obstacle.z - obstacle.depth / 2 - padding },
    { x: obstacle.x + obstacle.width / 2 + padding, y: obstacle.height, z: obstacle.z + obstacle.depth / 2 + padding }, range);
}

export class GameSimulation {
  public world: WorldConfig;
  public state: GameState;
  private options: Required<Options>;
  private randomState = 1;
  private events: GameEvent[] = [];
  private runtimes = new Map<string, Runtime>();
  private jumpHeld = false;
  private shrinkStart: { center: Vec2; radius: number } | null = null;

  constructor(options: Options = {}) {
    this.options = { seed: options.seed ?? 72341, botCount: options.botCount ?? 5, difficulty: options.difficulty ?? 'normal' };
    this.world = createWorld();
    this.state = this.makeState('menu');
  }

  get player(): Actor { return this.state.actors[0]; }
  get lootInReach(): Loot | null {
    if (this.state.phase !== 'playing') return null;
    let closest: Loot | null = null;
    let distance = INTERACTION_RANGE;
    for (const loot of this.state.loot) {
      if (!loot.active) continue;
      const d = Math.hypot(loot.position.x - this.player.position.x, loot.position.y - this.player.position.y, loot.position.z - this.player.position.z);
      if (d <= distance) { closest = loot; distance = d; }
    }
    return closest;
  }

  start(options: Options = {}): void {
    this.options = { ...this.options, ...options };
    this.world = createWorld();
    this.events = [];
    this.state = this.makeState('playing');
    this.events.push({ type: 'message', text: 'Nhặt trang bị gần điểm xuất phát. Người sống cuối cùng chiến thắng!' });
  }

  returnToMenu(): void {
    this.events = [];
    this.world = createWorld();
    this.state = this.makeState('menu');
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
    if (this.state.phase !== 'playing' || ![target.x, target.y, target.z].every(Number.isFinite)) return false;
    return this.fire(this.player, target, 0, aimed);
  }

  reload(): boolean {
    if (this.state.phase !== 'playing') return false;
    return this.beginReload(this.player);
  }

  switchWeapon(weapon: WeaponType): boolean {
    const actor = this.player;
    if (this.state.phase !== 'playing' || !actor.ownedWeapons.includes(weapon) || actor.weapon === weapon) return false;
    actor.weapon = weapon;
    actor.reloading = 0;
    this.runtime(actor).reloadWeapon = null;
    this.cancelHeal(actor);
    this.runtime(actor).cooldown = Math.max(this.runtime(actor).cooldown, 0.25);
    return true;
  }

  heal(): boolean {
    if (this.state.phase !== 'playing') return false;
    return this.beginHeal(this.player);
  }

  interact(): boolean {
    const loot = this.lootInReach;
    if (!loot) return false;
    const player = this.player;
    if (isWeaponKind(loot.kind)) {
      if (!player.ownedWeapons.includes(loot.kind)) {
        player.ownedWeapons.push(loot.kind);
        player.ammo[loot.kind] = WEAPONS[loot.kind].magazine;
      }
      player.reserve[loot.kind] += WEAPONS[loot.kind].magazine;
    } else if (loot.kind === 'medkit') {
      player.medkits++;
    } else {
      const weapon = weaponForAmmo(loot.kind);
      if (!weapon) return false;
      player.reserve[weapon] += WEAPONS[weapon].ammoPickup;
    }
    loot.active = false;
    this.events.push({ type: 'pickup', kind: loot.kind });
    return true;
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
    const actors: Actor[] = this.world.spawns.slice(0, this.options.botCount + 1).map((spawn, index) => {
      const botWeapons: WeaponType[] = ['rifle', 'smg', 'shotgun', 'dmr', this.options.seed % 2 === 0 ? 'heavySniper' : 'sniper', 'pistol', 'lmg'];
      const weapon: WeaponType = index === 0 ? 'rifle' : botWeapons[index - 1];
      const ammo = emptyAmmo();
      const reserve = emptyAmmo();
      ammo[weapon] = WEAPONS[weapon].magazine;
      reserve[weapon] = index === 0 ? 60 : WEAPONS[weapon].ammoPickup * 3;
      const actor: Actor = {
        id: index === 0 ? 'player' : `bot-${index}`, name: index === 0 ? 'Bạn' : `Đối thủ ${index}`,
        isPlayer: index === 0, position: { ...spawn }, yaw: index === 0 ? 0 : this.random() * Math.PI * 2,
        health: 100, alive: true, weapon, ownedWeapons: index === 0 ? ['rifle'] : [weapon],
        ammo, reserve,
        reloading: 0, healing: 0, medkits: index === 0 ? 1 : 1, hurtTimer: 0,
      };
      this.runtime(actor);
      return actor;
    });
    const loot: Loot[] = [];
    const add = (kind: LootKind, x: number, z: number) => loot.push({ id: `loot-${loot.length}`, kind, position: { x, y: 0, z }, active: true });
    add('shotgun', -1.6, -64.3); add('rifleAmmo', 1.6, -64.3); add('medkit', 0, -66.7); add('shotgunAmmo', 2.3, -66);
    // A labelled eight-weapon cache at spawn lets players try every gun without searching the map.
    const weaponCache: Record<WeaponType, Vec2> = {
      rifle: { x: -3, z: -62.5 }, shotgun: { x: -1.6, z: -64.3 },
      smg: { x: -1, z: -62.5 }, pistol: { x: 1, z: -62.5 }, dmr: { x: 3, z: -62.5 },
      sniper: { x: -3, z: -66 }, heavySniper: { x: -1, z: -66 }, lmg: { x: 3, z: -64.5 },
    };
    WEAPON_ORDER.forEach((weapon, index) => {
      if (weapon !== 'shotgun') add(weapon, weaponCache[weapon].x, weaponCache[weapon].z);
      add(ammoKindFor(weapon), (index - 3.5) * 2, -70);
    });
    const cachePositions = [
      [-22, -42], [19, -41], [-12, -29], [19, -17], [-27, 8], [23, 12],
      [-5, 20], [18, 42], [-33, 51], [-52, -28], [52, -43], [-62, 15], [55, 50], [0, 68],
    ];
    for (let i = 0; i < cachePositions.length; i++) {
      const [x, z] = cachePositions[i];
      const weapon = WEAPON_ORDER[i % WEAPON_ORDER.length];
      add(ammoKindFor(weapon), x, z);
      add(i % 3 === 0 ? 'medkit' : weapon, x + 1.2, z + 0.8);
    }
    const zone: ZoneState = {
      center: { x: 0, z: 0 }, radius: 98, nextCenter: { x: 0, z: 0 }, nextRadius: ZONE_RADII[0],
      stage: 0, timeRemaining: ZONE_WAITS[0], isShrinking: false,
    };
    zone.nextCenter = this.nextZoneCenter(zone.center, zone.radius, zone.nextRadius);
    return { phase, elapsed: 0, actors, loot, zone, kills: 0, shots: 0, hits: 0 };
  }

  private runtime(actor: Actor): Runtime {
    let runtime = this.runtimes.get(actor.id);
    if (!runtime) {
      runtime = { cooldown: 0, weaponCooldowns: emptyAmmo(), velocityY: 0, reloadWeapon: null, targetId: null, reaction: 0, memory: 0, sightTimer: 0, goal: null, path: [], pathTimer: 0, stuck: 0 };
      this.runtimes.set(actor.id, runtime);
    }
    return runtime;
  }

  private step(dt: number, input: PlayerInput, jumpPressed: boolean): void {
    this.state.elapsed += dt;
    this.advanceZone(dt);
    if (jumpPressed || Math.hypot(input.moveX, input.moveZ) > 0.05) this.cancelHeal(this.player);
    for (const actor of this.state.actors) {
      if (!actor.alive) continue;
      const runtime = this.runtime(actor);
      runtime.cooldown = Math.max(0, runtime.cooldown - dt);
      for (const weapon of WEAPON_ORDER) runtime.weaponCooldowns[weapon] = Math.max(0, runtime.weaponCooldowns[weapon] - dt);
      actor.hurtTimer = Math.max(0, actor.hurtTimer - dt);
      if (actor.reloading > 0) {
        actor.reloading = Math.max(0, actor.reloading - dt);
        if (actor.reloading < 1e-7) {
          actor.reloading = 0;
          const weapon = runtime.reloadWeapon ?? actor.weapon;
          const amount = Math.min(WEAPONS[weapon].magazine - actor.ammo[weapon], actor.reserve[weapon]);
          actor.ammo[weapon] += amount;
          actor.reserve[weapon] -= amount;
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
    if (jumpPressed && this.player.position.y <= 1e-6) {
      this.runtime(this.player).velocityY = 6.7;
      this.cancelHeal(this.player);
    }
    this.moveActor(this.player, input.moveX, input.moveZ, input.sprint ? 8.1 : 5.2, dt);
    const playerRuntime = this.runtime(this.player);
    if (this.player.position.y > 0 || playerRuntime.velocityY > 0) {
      playerRuntime.velocityY -= 18 * dt;
      this.player.position.y = Math.max(0, this.player.position.y + playerRuntime.velocityY * dt);
      if (this.player.position.y === 0) playerRuntime.velocityY = 0;
      this.resolvePenetration(this.player);
    }
    for (const actor of this.state.actors) if (!actor.isPlayer && actor.alive && this.state.phase === 'playing') this.updateBot(actor, dt);
    for (const actor of this.state.actors) {
      if (!actor.alive || this.state.phase !== 'playing') continue;
      if (distance2(actor.position, this.state.zone.center) > this.state.zone.radius) {
        const damage = 1.5 + this.state.zone.stage * 2 + (this.state.zone.radius <= 0.01 ? 20 : 0);
        this.damage(actor, damage * dt);
      }
    }
    this.checkEnd();
  }

  private beginReload(actor: Actor): boolean {
    const weapon = actor.weapon;
    if (!actor.alive || actor.reloading > 0 || actor.ammo[weapon] >= WEAPONS[weapon].magazine || actor.reserve[weapon] <= 0) return false;
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
    const chest = { x: actor.position.x, y: actor.position.y + 1.35, z: actor.position.z };
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
    const muzzleBlocked = this.world.obstacles.some(obstacle => obstacleHit(chest, { x: Math.sin(actor.yaw), y: 0, z: Math.cos(actor.yaw) }, obstacle, 0.45) !== null);
    for (let pellet = 0; pellet < weapon.pellets; pellet++) {
      const ray = this.spreadDirection(direction, (aimed ? weapon.aimSpread : weapon.spread) + extraSpread);
      const hit = muzzleBlocked ? { distance: 0 } : this.raycast(from, ray, weapon.range, actor.id);
      if (pellet === 0 || (!visualHit.actor && hit.actor)) { visualHit = hit; visualDirection = ray; }
      if (hit.actor) {
        anyHit = true;
        // Shotguns lose damage gradually beyond their useful close-range distance.
        const falloff = actor.weapon === 'shotgun' ? clamp(1 - Math.max(0, hit.distance - 12) / 45, 0.45, 1) : 1;
        damageByActor.set(hit.actor, (damageByActor.get(hit.actor) ?? 0) + weapon.damage * falloff * (hit.head ? 1.65 : 1));
      }
    }
    const to = { x: from.x + visualDirection.x * visualHit.distance, y: from.y + visualDirection.y * visualHit.distance, z: from.z + visualDirection.z * visualHit.distance };
    this.events.push({ type: 'shot', actorId: actor.id, weapon: actor.weapon, from, to, ...(visualHit.actor ? { hitId: visualHit.actor.id } : {}) });
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

  private raycast(origin: Vec3, direction: Vec3, range: number, ignoreId: string): Hit {
    let closest: Hit = { distance: range };
    for (const obstacle of this.world.obstacles) {
      const hit = obstacleHit(origin, direction, obstacle, closest.distance);
      if (hit !== null && hit <= closest.distance) closest = { distance: hit };
    }
    for (const actor of this.state.actors) {
      if (!actor.alive || actor.id === ignoreId) continue;
      const p = actor.position;
      const body = rayBox(origin, direction, { x: p.x - 0.37, y: p.y + 0.12, z: p.z - 0.37 }, { x: p.x + 0.37, y: p.y + 1.42, z: p.z + 0.37 }, closest.distance);
      const head = rayBox(origin, direction, { x: p.x - 0.24, y: p.y + 1.42, z: p.z - 0.24 }, { x: p.x + 0.24, y: p.y + ACTOR_HEIGHT, z: p.z + 0.24 }, closest.distance);
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
      actor.health = 0;
      actor.alive = false;
      actor.reloading = 0;
      actor.healing = 0;
      if (sourceId === this.player.id && !actor.isPlayer) this.state.kills++;
      this.events.push({ type: 'kill', actorId: actor.id, ...(sourceId ? { killerId: sourceId } : {}) });
      if (!actor.isPlayer) {
        const dropPosition = (offset: number): Vec3 => {
          const position = { x: actor.position.x + offset, y: 0, z: actor.position.z };
          return this.walkable(position, 0.05) ? position : { ...actor.position, y: 0 };
        };
        this.state.loot.push({ id: `drop-${actor.id}-weapon`, kind: actor.weapon, position: dropPosition(-0.7), active: true });
        this.state.loot.push({ id: `drop-${actor.id}-ammo`, kind: ammoKindFor(actor.weapon), position: dropPosition(0), active: true });
        if (actor.medkits) this.state.loot.push({ id: `drop-${actor.id}-medkit`, kind: 'medkit', position: dropPosition(0.7), active: true });
      }
    }
  }

  private checkEnd(): void {
    if (this.state.phase !== 'playing') return;
    if (!this.player.alive) this.finish(false);
    else if (!this.state.actors.some(actor => !actor.isPlayer && actor.alive)) this.finish(true);
  }

  private finish(won: boolean): void {
    this.state.phase = won ? 'won' : 'lost';
    this.events.push({ type: 'end', won });
  }

  private nextZoneCenter(center: Vec2, radius: number, nextRadius: number): Vec2 {
    const angle = this.random() * Math.PI * 2;
    const offset = Math.sqrt(this.random()) * Math.max(0, radius - nextRadius) * 0.48;
    return { x: center.x + Math.cos(angle) * offset, z: center.z + Math.sin(angle) * offset };
  }

  private advanceZone(dt: number): void {
    const zone = this.state.zone;
    if (zone.stage >= ZONE_RADII.length) return;
    zone.timeRemaining = Math.max(0, zone.timeRemaining - dt);
    if (zone.isShrinking && this.shrinkStart) {
      const progress = clamp(1 - zone.timeRemaining / ZONE_SHRINKS[zone.stage], 0, 1);
      zone.radius = this.shrinkStart.radius + (zone.nextRadius - this.shrinkStart.radius) * progress;
      zone.center = {
        x: this.shrinkStart.center.x + (zone.nextCenter.x - this.shrinkStart.center.x) * progress,
        z: this.shrinkStart.center.z + (zone.nextCenter.z - this.shrinkStart.center.z) * progress,
      };
    }
    if (zone.timeRemaining > 1e-7) return;
    if (!zone.isShrinking) {
      zone.isShrinking = true;
      zone.timeRemaining = ZONE_SHRINKS[zone.stage];
      this.shrinkStart = { center: { ...zone.center }, radius: zone.radius };
      this.events.push({ type: 'message', text: 'Vòng bo đang thu! Hãy vào vùng an toàn.' });
    } else {
      zone.radius = zone.nextRadius;
      zone.center = { ...zone.nextCenter };
      zone.stage++;
      zone.isShrinking = false;
      this.shrinkStart = null;
      if (zone.stage < ZONE_RADII.length) {
        zone.nextRadius = ZONE_RADII[zone.stage];
        zone.nextCenter = this.nextZoneCenter(zone.center, zone.radius, zone.nextRadius);
        zone.timeRemaining = ZONE_WAITS[zone.stage];
      } else { zone.timeRemaining = 0; zone.nextRadius = 0; }
    }
  }

  private moveActor(actor: Actor, moveX: number, moveZ: number, speed: number, dt: number): number {
    if (!actor.alive) return 0;
    const length = Math.hypot(moveX, moveZ);
    if (length < 1e-8) return 0;
    const scale = speed * dt / Math.max(1, length);
    const previous = { ...actor.position };
    const edge = this.world.halfSize - ACTOR_RADIUS;
    actor.position.x = clamp(actor.position.x + moveX * scale, -edge, edge);
    if (!this.walkable(actor.position, ACTOR_RADIUS, actor.position.y)) actor.position.x = previous.x;
    actor.position.z = clamp(actor.position.z + moveZ * scale, -edge, edge);
    if (!this.walkable(actor.position, ACTOR_RADIUS, actor.position.y)) actor.position.z = previous.z;
    if (!actor.isPlayer) actor.yaw = Math.atan2(moveX, moveZ);
    return distance2(actor.position, previous);
  }

  private walkable(point: Vec2, padding = ACTOR_RADIUS + 0.15, feet = 0): boolean {
    const edge = this.world.halfSize - padding;
    if (Math.abs(point.x) > edge || Math.abs(point.z) > edge) return false;
    return !this.world.obstacles.some(obstacle => feet < obstacle.height && point.x > obstacle.x - obstacle.width / 2 - padding && point.x < obstacle.x + obstacle.width / 2 + padding && point.z > obstacle.z - obstacle.depth / 2 - padding && point.z < obstacle.z + obstacle.depth / 2 + padding);
  }

  private resolvePenetration(actor: Actor): void {
    for (const obstacle of this.world.obstacles) {
      if (actor.position.y >= obstacle.height) continue;
      const left = obstacle.x - obstacle.width / 2 - ACTOR_RADIUS;
      const right = obstacle.x + obstacle.width / 2 + ACTOR_RADIUS;
      const back = obstacle.z - obstacle.depth / 2 - ACTOR_RADIUS;
      const front = obstacle.z + obstacle.depth / 2 + ACTOR_RADIUS;
      const p = actor.position;
      if (p.x <= left || p.x >= right || p.z <= back || p.z >= front) continue;
      const exits = [Math.abs(p.x - left), Math.abs(right - p.x), Math.abs(p.z - back), Math.abs(front - p.z)];
      const side = exits.indexOf(Math.min(...exits));
      if (side === 0) p.x = left - 0.001;
      else if (side === 1) p.x = right + 0.001;
      else if (side === 2) p.z = back - 0.001;
      else p.z = front + 0.001;
    }
  }

  private canSee(actor: Actor, enemy: Actor): boolean {
    const from = { x: actor.position.x, y: actor.position.y + 1.35, z: actor.position.z };
    const target = { x: enemy.position.x, y: enemy.position.y + 1.15, z: enemy.position.z };
    const distance = Math.hypot(target.x - from.x, target.y - from.y, target.z - from.z);
    if (distance < 0.01) return true;
    const direction = { x: (target.x - from.x) / distance, y: (target.y - from.y) / distance, z: (target.z - from.z) / distance };
    return !this.world.obstacles.some(obstacle => obstacleHit(from, direction, obstacle, distance) !== null);
  }

  private updateBot(actor: Actor, dt: number): void {
    const runtime = this.runtime(actor);
    runtime.sightTimer -= dt;
    runtime.pathTimer -= dt;
    runtime.reaction = Math.max(0, runtime.reaction - dt);
    runtime.memory = Math.max(0, runtime.memory - dt);
    const easy = this.options.difficulty === 'easy';
    const detection = easy ? 27 : 34;
    if (runtime.sightTimer <= 0) {
      runtime.sightTimer = 0.24 + this.random() * 0.1;
      let closest: Actor | null = null;
      let closestDistance = detection;
      for (const enemy of this.state.actors) {
        if (!enemy.alive || enemy.id === actor.id) continue;
        const distance = distance2(actor.position, enemy.position);
        // Close enemies are heard; distant detection respects the bot's facing direction.
        const directionYaw = Math.atan2(enemy.position.x - actor.position.x, enemy.position.z - actor.position.z);
        const facing = Math.cos(directionYaw - actor.yaw) > -0.2 || distance < 12;
        if (distance < closestDistance && facing && this.canSee(actor, enemy)) { closest = enemy; closestDistance = distance; }
      }
      if (closest) {
        if (runtime.targetId !== closest.id) runtime.reaction = (easy ? 1.2 : 0.65) + this.random() * 0.5 + (WEAPONS[actor.weapon].fireMode === 'bolt' ? 0.65 : 0);
        runtime.targetId = closest.id;
        runtime.memory = 4;
        runtime.goal = { x: closest.position.x, z: closest.position.z };
      } else if (runtime.memory === 0) runtime.targetId = null;
    }
    const enemy = this.state.actors.find(candidate => candidate.id === runtime.targetId && candidate.alive);
    if (!enemy) runtime.targetId = null;
    const zone = this.state.zone;
    const outside = distance2(actor.position, zone.center) > Math.max(0, zone.radius - 5);
    const futureUnsafe = zone.isShrinking && distance2(actor.position, zone.nextCenter) > Math.max(0, zone.nextRadius - 7);
    const evacuating = outside || futureUnsafe;
    if (actor.ammo[actor.weapon] === 0) this.beginReload(actor);
    if (actor.healing > 0) {
      if (enemy && this.canSee(actor, enemy) || evacuating) this.cancelHeal(actor);
      else return;
    }
    if (!enemy && !evacuating && actor.health < 45 && actor.medkits > 0 && actor.reloading === 0) {
      this.beginHeal(actor);
      return;
    }
    let moving = true;
    if (evacuating) {
      const destination = zone.isShrinking ? zone.nextCenter : zone.center;
      const safeRadius = Math.max(0, (zone.isShrinking ? zone.nextRadius : zone.radius) - 10);
      // Enter the nearest safe part of the circle instead of sending every bot to its center.
      const index = Number(actor.id.split('-')[1]) || 1;
      const angle = Math.atan2(actor.position.z - destination.z, actor.position.x - destination.x) + Math.sin(index * 2.4) * 0.08;
      runtime.goal = { x: destination.x + Math.cos(angle) * safeRadius, z: destination.z + Math.sin(angle) * safeRadius };
    } else if (enemy) {
      const visible = this.canSee(actor, enemy);
      const distance = distance2(actor.position, enemy.position);
      const weaponConfig = WEAPONS[actor.weapon];
      const preferredRange = weaponConfig.preferredRange;
      if (visible && distance <= WEAPONS[actor.weapon].range * 0.85) {
        actor.yaw = Math.atan2(enemy.position.x - actor.position.x, enemy.position.z - actor.position.z);
        const extraSpread = (easy ? 0.08 : 0.045) * (weaponConfig.fireMode === 'bolt' ? 0.7 : 1);
        if (runtime.reaction <= 0 && this.fire(actor, { x: enemy.position.x, y: enemy.position.y + 1.12, z: enemy.position.z }, extraSpread, true)) runtime.cooldown = Math.max(runtime.cooldown, easy ? 0.65 : 0.38);
        if (distance < preferredRange) moving = false;
      }
      if (visible) runtime.goal = { x: enemy.position.x, z: enemy.position.z };
    } else if (!runtime.goal || distance2(actor.position, runtime.goal) < 3) {
      // Local patrols keep the opening spread across the map; later circles bring opponents together.
      const spawn = this.world.spawns[Number(actor.id.split('-')[1])] ?? actor.position;
      const anchor = distance2(spawn, zone.center) < zone.radius - 15 ? spawn : actor.position;
      runtime.goal = null;
      for (let attempt = 0; attempt < 8; attempt++) {
        const angle = this.random() * Math.PI * 2;
        const radius = 5 + this.random() * 12;
        const point = { x: anchor.x + Math.cos(angle) * radius, z: anchor.z + Math.sin(angle) * radius };
        if (this.walkable(point) && distance2(point, zone.center) < Math.max(0, zone.radius - 7)) { runtime.goal = point; break; }
      }
    }
    if (!moving || !runtime.goal || this.state.phase !== 'playing') return;
    if (runtime.pathTimer <= 0 || !runtime.path.length) {
      runtime.path = this.findPath(actor.position, runtime.goal);
      runtime.pathTimer = 1 + this.random() * 0.5;
    }
    while (runtime.path.length && distance2(actor.position, runtime.path[0]) < 0.7) runtime.path.shift();
    const waypoint = runtime.path[0];
    if (!waypoint) { runtime.goal = null; return; }
    const dx = waypoint.x - actor.position.x;
    const dz = waypoint.z - actor.position.z;
    const distance = Math.hypot(dx, dz);
    const travel = this.moveActor(actor, dx / distance, dz / distance, evacuating ? 6.1 : 3.6, dt);
    runtime.stuck = travel < 0.006 ? runtime.stuck + dt : 0;
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
  }

  private clearPath(from: Vec2, to: Vec2): boolean {
    const distance = distance2(from, to);
    if (distance < 0.01) return this.walkable(to);
    const direction = { x: (to.x - from.x) / distance, y: 0, z: (to.z - from.z) / distance };
    const origin = { x: from.x, y: 0.05, z: from.z };
    return this.walkable(to) && !this.world.obstacles.some(obstacle => obstacleHit(origin, direction, obstacle, distance, ACTOR_RADIUS + 0.18) !== null);
  }

  /** Small deterministic A* grid with line-of-sight smoothing; diagonal corners cannot be cut. */
  private findPath(from: Vec2, goal: Vec2): Vec2[] {
    if (this.clearPath(from, goal)) return [{ ...goal }];
    const cell = 4;
    const edge = this.world.halfSize - 2;
    const size = Math.floor(edge * 2 / cell) + 1;
    const coordinates = (index: number): Vec2 => ({ x: -edge + (index % size) * cell, z: -edge + Math.floor(index / size) * cell });
    const nearest = (point: Vec2) => {
      let best = -1;
      let distance = Infinity;
      for (let index = 0; index < size * size; index++) {
        const position = coordinates(index);
        const d = distance2(position, point);
        if (d < distance && this.walkable(position)) { best = index; distance = d; }
      }
      return best;
    };
    const start = nearest(from);
    const finish = nearest(goal);
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
        if (this.clearPath(path[path.length - 1], goal)) path.push({ ...goal });
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
      const column = current % size;
      const row = Math.floor(current / size);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const x = column + dx;
        const z = row + dz;
        if (x < 0 || z < 0 || x >= size || z >= size) continue;
        const neighbor = z * size + x;
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
