import './style.css';
import { Engine } from '@babylonjs/core/Engines/engine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder.js';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder.js';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder.js';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder.js';
import { CreateLines } from '@babylonjs/core/Meshes/Builders/linesBuilder.js';
import '@babylonjs/core/Meshes/instancedMesh.js';
import { GameSimulation } from './game/simulation';
import { GameUI } from './ui';
import { GameAudio } from './audio';
import { createWeaponModel } from './weapon-models';
import type { WeaponModel } from './weapon-models';
import { WEAPONS, WEAPON_ORDER, isWeaponKind, lootLabel, weaponForAmmo } from './game/weapons';
import type { Actor, GameSettings, WeaponType } from './types';
import { isTouchDevice, renderBudgetFor } from './device';
import { MobileControls } from './mobile-controls';

const MeshBuilder = { CreateBox, CreateGround, CreateCylinder, CreateSphere, CreateTorus, CreateLines };

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas')!;
const touchDevice = isTouchDevice();
document.documentElement.dataset.input = touchDevice ? 'touch' : 'mouse';
const sim = new GameSimulation({ botCount: 5, difficulty: 'normal' });
const audio = new GameAudio();
let engine: Engine;
let scene: Scene;
let camera: FreeCamera;
let shadows: ShadowGenerator;
let yaw = 0, pitch = -0.12, recoil = 0, aiming = false, shooting = false, triggerPending = false, hadLock = false;
let snapCamera = true, lastPhase = sim.state.phase, footsteps = 0;
let clock = performance.now();
const keys = new Set<string>();
const models = new Map<string, Character>();
const lootMeshes = new Map<string, TransformNode>();
const effects: { mesh: Mesh; remaining: number }[] = [];
let currentZone: Mesh, currentRing: Mesh, nextRing: Mesh;
let settings: GameSettings;
let mobile: MobileControls | null = null;
let mobileJump = false;
let lastRenderTime = 0, lastLootTime = -Infinity, lastHudTime = -Infinity;
let hudPhase: string | null = null, hudWeapon: WeaponType | null = null;

const ui = new GameUI({
  onStart: (next) => { settings = next; applySettings(); start(); },
  onResume: () => { void audio.unlock(); sim.setPaused(false); lockPointer(); clock = performance.now(); },
  onRestart: () => start(),
  onMenu: () => { sim.returnToMenu(); releaseInput(); audio.pause(); },
  onSettings: (next) => { settings = next; applySettings(); },
  onSelectWeapon: selectWeapon,
});
settings = ui.settings;
if (touchDevice) {
  mobile = new MobileControls(canvas, {
    onLook: (dx, dy) => {
      if (sim.state.phase !== 'playing') return;
      const sensitivity = 0.004 * settings.sensitivity * (aiming ? 0.72 / Math.sqrt(WEAPONS[sim.player.weapon].zoom) : 1);
      yaw += dx * sensitivity;
      pitch = Math.max(-0.7, Math.min(0.8, pitch - dy * sensitivity));
    },
    onFire: (pressed) => {
      shooting = pressed && sim.state.phase === 'playing';
      if (shooting) { void audio.unlock(); triggerPending = true; }
    },
    onAimToggle: () => { if (sim.state.phase === 'playing') { void audio.unlock(); if (aiming) aiming = false; else beginAim(); } },
    onJump: (pressed) => { mobileJump = pressed; },
    onReload: () => { if (sim.reload()) { void audio.unlock(); audio.reload(); } },
    onInteract: () => { sim.interact(); },
    onHeal: () => { if (sim.heal()) { void audio.unlock(); audio.heal(); } },
    onCycleWeapon: () => cycleWeapon(1),
    onPause: pause,
  });
}

function start() {
  void audio.unlock();
  audio.pause();
  releaseInput();
  sim.start({ botCount: settings.botCount, difficulty: settings.difficulty, seed: Date.now() });
  yaw = 0; pitch = -0.12; recoil = 0; snapCamera = true; footsteps = 0;
  for (const effect of effects) effect.mesh.dispose();
  effects.length = 0;
  for (const model of models.values()) model.root.setEnabled(false);
  lockPointer();
  clock = performance.now();
  ui.notify('Tìm trang bị. Giữ vùng an toàn. Sống sót cuối cùng.');
}

function lockPointer() {
  if (touchDevice || !canvas.requestPointerLock) return;
  try {
    const result = canvas.requestPointerLock();
    if (result && typeof result.catch === 'function') {
      result.catch(() => ui.notify('Giữ chuột để xoay camera nếu trình duyệt chưa khóa chuột.'));
    }
  } catch { ui.notify('Giữ chuột để xoay camera.'); }
}

function releaseInput() {
  keys.clear(); shooting = false; triggerPending = false; aiming = false;
  mobileJump = false; mobile?.reset();
  if (document.pointerLockElement === canvas) document.exitPointerLock();
}

function pause() {
  if (sim.state.phase !== 'playing') return;
  sim.setPaused(true); releaseInput(); audio.pause();
}

function applySettings() {
  audio.setVolume(settings.volume);
  const budget = renderBudgetFor(settings.quality, touchDevice, canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio);
  if (engine) engine.setHardwareScalingLevel(budget.scaling);
  if (scene) scene.shadowsEnabled = budget.shadows;
}

function material(name: string, color: string, emissive = 0): StandardMaterial {
  const value = new StandardMaterial(name, scene);
  value.diffuseColor = Color3.FromHexString(color);
  value.specularColor = Color3.Black();
  if (emissive) value.emissiveColor = value.diffuseColor.scale(emissive);
  return value;
}

function box(name: string, width: number, height: number, depth: number, mat: StandardMaterial, position: Vector3, parent?: TransformNode): Mesh {
  const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, scene);
  mesh.material = mat; mesh.position.copyFrom(position);
  if (parent) mesh.parent = parent;
  mesh.receiveShadows = true;
  return mesh;
}

function buildWorld() {
  const earth = material('dry-grass', '#77754e');
  const road = material('road', '#5c6352');
  const roadMark = material('road-mark', '#a6a17d');
  const plaster = material('plaster', '#a7afa1');
  const plasterWarm = material('plaster-warm', '#b4a992');
  const roofMat = material('roof', '#475951');
  const windowMat = material('windows', '#263b3a');
  const trim = material('trim', '#67796d');
  const wood = material('wood', '#927758');
  const rockMat = material('stone', '#777e73');
  const orange = material('accent', '#edaa59');
  const ground = MeshBuilder.CreateGround('ground', { width: sim.world.halfSize * 2.5, height: sim.world.halfSize * 2.5 }, scene);
  ground.material = earth; ground.receiveShadows = true; ground.metadata = { solid: true };
  box('north-road', 8, 0.035, 188, road, new Vector3(0, 0.02, 0));
  box('cross-road', 180, 0.035, 6, road, new Vector3(0, 0.023, 14));
  for (let z = -88; z < 90; z += 9) {
    const mark = box('road-dash', 0.13, 0.03, 3, roadMark, new Vector3(0, 0.048, z)); mark.isPickable = false;
  }
  for (const obstacle of sim.world.obstacles) {
    const mat = obstacle.kind === 'building' ? (Number(obstacle.id.replace(/\D/g, '')) % 2 ? plasterWarm : plaster) : obstacle.kind === 'crate' ? wood : rockMat;
    const body = box(obstacle.id, obstacle.width, obstacle.height, obstacle.depth, mat, new Vector3(obstacle.x, obstacle.height / 2, obstacle.z));
    body.metadata = { solid: true };
    shadows.addShadowCaster(body);
    if (obstacle.kind === 'building') {
      const roof = box(`${obstacle.id}-roof`, obstacle.width + 0.5, 0.26, obstacle.depth + 0.55, roofMat, new Vector3(obstacle.x, obstacle.height + 0.08, obstacle.z));
      roof.isPickable = false;
      const trimBand = box('house-trim', obstacle.width + 0.04, 0.3, obstacle.depth + 0.04, trim, new Vector3(obstacle.x, 0.3, obstacle.z)); trimBand.isPickable = false;
      for (const side of [-1, 1]) {
        for (let x = -obstacle.width / 2 + 1.8; x < obstacle.width / 2 - 0.5; x += 3.3) {
          const window = box('window', 1.05, 0.9, 0.045, windowMat, new Vector3(obstacle.x + x, Math.min(2.1, obstacle.height - 0.8), obstacle.z + side * (obstacle.depth / 2 + 0.027)));
          window.isPickable = false;
          const sill = box('window-sill', 1.2, 0.08, 0.16, trim, window.position.add(new Vector3(0, -0.48, 0))); sill.isPickable = false;
        }
      }
      const door = box('door', 1.1, 2.1, 0.035, wood, new Vector3(obstacle.x, 1.05, obstacle.z - obstacle.depth / 2 - 0.025)); door.isPickable = false;
      const plaque = box('door-plaque', 0.32, 0.2, 0.05, orange, new Vector3(obstacle.x + 0.8, 1.65, obstacle.z - obstacle.depth / 2 - 0.06)); plaque.isPickable = false;
    } else if (obstacle.kind === 'crate') {
      for (const x of [-0.3, 0.3]) {
        const band = box('crate-band', 0.085, obstacle.height + 0.025, obstacle.depth + 0.03, trim, new Vector3(obstacle.x + x * obstacle.width, obstacle.height / 2, obstacle.z)); band.isPickable = false;
      }
    }
  }
  const fenceMat = material('fence', '#45564a');
  for (let i = -100; i <= 100; i += 10) {
    for (const side of [-1, 1]) {
      for (const [x, z] of [[i, side * 103], [side * 103, i]]) {
        const pole = box('perimeter-post', 0.16, 2.1, 0.16, fenceMat, new Vector3(x, 1.05, z)); pole.isPickable = false;
      }
    }
  }
  for (const side of [-1, 1]) {
    for (const height of [0.8, 1.6]) {
      box('fence-rail', 206, 0.055, 0.055, fenceMat, new Vector3(0, height, side * 103)).isPickable = false;
      box('fence-rail', 0.055, 0.055, 206, fenceMat, new Vector3(side * 103, height, 0)).isPickable = false;
    }
  }
  const grassMat = material('grass-tuft', '#686e44');
  const tuft = MeshBuilder.CreateCylinder('grass-template', { diameterTop: 0, diameterBottom: 0.6, height: 0.55, tessellation: 3 }, scene);
  tuft.material = grassMat; tuft.setEnabled(false);
  let seed = 97;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < (touchDevice ? 120 : 420); i++) {
    const x = (rand() - 0.5) * 198, z = (rand() - 0.5) * 198;
    if (Math.abs(x) < 5 || Math.abs(z - 14) < 4 || sim.world.obstacles.some(o => Math.abs(x - o.x) < o.width / 2 + 1 && Math.abs(z - o.z) < o.depth / 2 + 1)) continue;
    const grass = tuft.createInstance(`grass-${i}`); grass.position.set(x, 0.25, z); grass.rotation.y = rand() * 6.28; grass.isPickable = false;
  }
  const pineMat = material('pine', '#40584b');
  const trunkMat = material('trunk', '#665341');
  for (let i = 0; i < (touchDevice ? 24 : 64); i++) {
    const angle = rand() * Math.PI * 2, radius = 112 + rand() * 30;
    const x = Math.sin(angle) * radius, z = Math.cos(angle) * radius;
    const height = 6 + rand() * 7;
    const trunk = box('pine-trunk', 0.5, height / 2, 0.5, trunkMat, new Vector3(x, height / 4, z)); trunk.isPickable = false;
    for (let layer = 0; layer < 3; layer++) {
      const pine = MeshBuilder.CreateCylinder('pine', { diameterTop: 0, diameterBottom: height * (0.7 - layer * 0.13), height: height * 0.6, tessellation: 6 }, scene);
      pine.position.set(x, height * (0.45 + layer * 0.21), z); pine.material = pineMat; pine.isPickable = false;
    }
  }
  const hillMat = material('hills', '#65745d');
  const hillCount = touchDevice ? 8 : 15;
  for (let i = 0; i < hillCount; i++) {
    const a = i / hillCount * Math.PI * 2;
    const hill = MeshBuilder.CreateSphere('distant-hill', { diameter: 1, segments: 5 }, scene);
    hill.scaling.set(80 + rand() * 70, 22 + rand() * 30, 80 + rand() * 70);
    hill.position.set(Math.sin(a) * 225, -2, Math.cos(a) * 225); hill.material = hillMat; hill.isPickable = false;
  }
  // Static scenery keeps its transforms; dynamic actors, loot and bo remain live.
  for (const mesh of scene.meshes) mesh.freezeWorldMatrix();
  const zoneMaterial = material('zone-wall', '#66c6c0', 0.7);
  zoneMaterial.alpha = 0.10; zoneMaterial.backFaceCulling = false; zoneMaterial.disableLighting = true;
  currentZone = MeshBuilder.CreateCylinder('zone-wall', { diameter: 2, height: 1, tessellation: touchDevice ? 48 : 96, cap: 0 }, scene);
  currentZone.material = zoneMaterial; currentZone.isPickable = false;
  const ringMat = material('safe-ring', '#88ddd0', 0.7);
  const nextMat = material('next-ring', '#f5c079', 0.8);
  currentRing = MeshBuilder.CreateTorus('safe-ring', { diameter: 2, thickness: 0.006, tessellation: touchDevice ? 48 : 96 }, scene);
  currentRing.material = ringMat; currentRing.isPickable = false;
  nextRing = MeshBuilder.CreateTorus('next-ring', { diameter: 2, thickness: 0.004, tessellation: touchDevice ? 48 : 96 }, scene);
  nextRing.material = nextMat; nextRing.isPickable = false;
}

interface Character {
  root: TransformNode; legs: TransformNode[]; gun: TransformNode; flash: Mesh;
  weapons: Map<WeaponType, WeaponModel>; currentWeapon: WeaponType;
  last: Vector3; stride: number; moving: number;
}

function createCharacter(actor: Actor): Character {
  const root = new TransformNode(`actor-${actor.id}`, scene);
  const cloth = material(`${actor.id}-cloth`, actor.isPlayer ? '#66867d' : '#946850');
  const vest = material(`${actor.id}-vest`, actor.isPlayer ? '#374f48' : '#534c43');
  const skin = material(`${actor.id}-skin`, '#ba9376');
  const dark = material(`${actor.id}-boots`, '#293530');
  const marker = material(`${actor.id}-marker`, actor.isPlayer ? '#f0b767' : '#b68d64');
  const add = (mesh: Mesh) => { mesh.metadata = { actorId: actor.id }; shadows.addShadowCaster(mesh); return mesh; };
  add(box('torso', 0.63, 0.65, 0.39, cloth, new Vector3(0, 1.17, 0), root));
  add(box('vest', 0.66, 0.43, 0.15, vest, new Vector3(0, 1.22, 0.23), root));
  add(box('backpack', 0.45, 0.55, 0.24, vest, new Vector3(0, 1.22, -0.29), root));
  add(box('belt', 0.65, 0.12, 0.41, dark, new Vector3(0, 0.9, 0), root));
  const head = MeshBuilder.CreateSphere('head', { diameter: 0.42, segments: 6 }, scene);
  head.position.set(0, 1.60, 0); head.material = skin; head.parent = root; add(head);
  const helmet = MeshBuilder.CreateSphere('helmet', { diameter: 0.49, segments: 6 }, scene);
  helmet.position.set(0, 1.70, -0.02); helmet.scaling.y = 0.6; helmet.material = vest; helmet.parent = root; add(helmet);
  add(box('helmet-band', 0.5, 0.045, 0.4, marker, new Vector3(0, 1.69, 0.015), root));
  const legs: TransformNode[] = [];
  for (const side of [-1, 1]) {
    const leg = new TransformNode('leg-pivot', scene); leg.parent = root; leg.position.set(side * 0.18, 0.87, 0);
    add(box('trouser', 0.24, 0.63, 0.27, cloth, new Vector3(0, -0.33, 0), leg));
    add(box('boot', 0.27, 0.2, 0.4, dark, new Vector3(0, -0.77, 0.06), leg));
    legs.push(leg);
    const arm = new TransformNode('arm', scene); arm.parent = root; arm.position.set(side * 0.37, 1.42, 0.05); arm.rotation.x = -1.18; arm.rotation.z = side * 0.17;
    add(box('sleeve', 0.21, 0.45, 0.22, cloth, new Vector3(0, -0.23, 0), arm));
    add(box('hand', 0.16, 0.2, 0.18, skin, new Vector3(0, -0.52, 0), arm));
  }
  const gun = new TransformNode('weapon', scene); gun.parent = root; gun.position.set(0.27, 1.32, 0.27);
  const weaponModel = createWeaponModel(actor.weapon, scene, gun, actor.id);
  for (const mesh of weaponModel.root.getChildMeshes()) if (mesh !== weaponModel.flash) shadows.addShadowCaster(mesh);
  return { root, legs, gun, flash: weaponModel.flash, weapons: new Map([[actor.weapon, weaponModel]]), currentWeapon: actor.weapon, last: new Vector3(), stride: 0, moving: 0 };
}

function renderActors(dt: number) {
  const active = new Set(sim.state.actors.map(a => a.id));
  for (const [id, model] of models) if (!active.has(id)) model.root.setEnabled(false);
  for (const actor of sim.state.actors) {
    let model = models.get(actor.id);
    if (!model) { model = createCharacter(actor); models.set(actor.id, model); model.last.set(actor.position.x, actor.position.y, actor.position.z); }
    model.root.setEnabled(true);
    const pos = new Vector3(actor.position.x, actor.position.y, actor.position.z);
    const speed = Vector3.Distance(pos, model.last) / Math.max(dt, 0.001);
    model.moving += ((actor.alive ? Math.min(speed, 8) : 0) - model.moving) * Math.min(1, dt * 12);
    model.stride += dt * model.moving * 2.2;
    model.root.position.copyFrom(pos);
    model.root.rotation.set(0, actor.yaw, actor.alive ? 0 : Math.PI / 2);
    if (!actor.alive) model.root.position.y = 0.32;
    model.legs[0].rotation.x = Math.sin(model.stride) * Math.min(0.6, model.moving * 0.1);
    model.legs[1].rotation.x = -model.legs[0].rotation.x;
    if (model.currentWeapon !== actor.weapon) {
      model.weapons.get(model.currentWeapon)?.root.setEnabled(false);
      let next = model.weapons.get(actor.weapon);
      if (!next) {
        next = createWeaponModel(actor.weapon, scene, model.gun, actor.id);
        for (const mesh of next.root.getChildMeshes()) if (mesh !== next.flash) shadows.addShadowCaster(mesh);
        model.weapons.set(actor.weapon, next);
      }
      next.root.setEnabled(true); model.flash = next.flash; model.currentWeapon = actor.weapon;
    }
    model.gun.rotation.x = actor.reloading > 0 ? 0.55 + Math.sin(actor.reloading * 9) * 0.1 : actor.healing > 0 ? 0.75 : 0;
    model.flash.setEnabled(false);
    model.last.copyFrom(pos);
  }
}

function renderLoot(time: number) {
  const currentIds = new Set(sim.state.loot.map(loot => loot.id));
  for (const [id, root] of lootMeshes) {
    if (!currentIds.has(id)) { root.dispose(false, true); lootMeshes.delete(id); }
  }
  for (const loot of sim.state.loot) {
    let root = lootMeshes.get(loot.id);
    const inView = !touchDevice || sim.state.phase !== 'menu' && Math.hypot(loot.position.x - sim.player.position.x, loot.position.z - sim.player.position.z) < 75;
    const visible = loot.active && inView;
    if (!root && touchDevice && !visible) continue;
    if (!root) {
      root = new TransformNode(`loot-${loot.id}`, scene); lootMeshes.set(loot.id, root);
      const isMed = loot.kind === 'medkit', weapon = isWeaponKind(loot.kind) ? loot.kind : null;
      const ammoWeapon = weaponForAmmo(loot.kind);
      const mat = material(`loot-${loot.kind}`, isMed ? '#88d4a4' : weapon ? WEAPONS[weapon].color : ammoWeapon ? WEAPONS[ammoWeapon].color : '#c1b77e', 0.2);
      if (weapon) {
        const display = createWeaponModel(weapon, scene, root);
        display.root.scaling.setAll(0.78); display.root.rotation.x = Math.PI / 2;
      } else {
        const base = box('loot', 0.35, isMed ? 0.35 : 0.16, 0.3, mat, new Vector3(0, 0, 0), root); base.isPickable = false;
      }
      if (isMed) {
        const crossMat = material('cross', '#edf5d7', 0.3);
        box('cross', 0.22, 0.07, 0.04, crossMat, new Vector3(0, 0, -0.17), root).isPickable = false;
        box('cross', 0.07, 0.22, 0.04, crossMat, new Vector3(0, 0, -0.171), root).isPickable = false;
      }
      const marker = MeshBuilder.CreateTorus('loot-ring', { diameter: 0.9, thickness: 0.023, tessellation: 24 }, scene);
      marker.parent = root; marker.position.y = -0.3; marker.material = mat; marker.isPickable = false;
    }
    root.setEnabled(visible);
    if (visible) {
      root.position.set(loot.position.x, 0.45 + Math.sin(time * 2 + loot.position.x) * 0.07, loot.position.z);
      root.rotation.y = time * 0.45;
    }
  }
}

function renderZone() {
  const zone = sim.state.zone;
  const show = sim.state.phase !== 'menu';
  currentZone.setEnabled(show); currentRing.setEnabled(show); nextRing.setEnabled(show);
  currentZone.position.set(zone.center.x, 4, zone.center.z); currentZone.scaling.set(Math.max(0.05, zone.radius), 8, Math.max(0.05, zone.radius));
  currentRing.position.set(zone.center.x, 0.07, zone.center.z); currentRing.scaling.set(zone.radius, 1, zone.radius);
  nextRing.position.set(zone.nextCenter.x, 0.085, zone.nextCenter.z); nextRing.scaling.set(zone.nextRadius, 1, zone.nextRadius);
}

function updateCamera(dt: number) {
  if (sim.state.phase === 'menu') {
    const angle = performance.now() * 0.000015;
    camera.position.set(Math.sin(angle + 0.65) * 96, 38, -Math.cos(angle + 0.65) * 96);
    camera.setTarget(new Vector3(0, 0.9, 4)); camera.fov = 0.88; return;
  }
  const actor = sim.player;
  recoil *= Math.exp(-dt * 9);
  const viewPitch = Math.max(-0.7, Math.min(0.8, pitch + recoil));
  const forward = new Vector3(Math.sin(yaw) * Math.cos(viewPitch), Math.sin(viewPitch), Math.cos(yaw) * Math.cos(viewPitch));
  const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const pivot = new Vector3(actor.position.x, actor.position.y + 1.52, actor.position.z);
  const weapon = WEAPONS[actor.weapon];
  if (aiming && weapon.zoom >= 4 && sim.state.phase === 'playing') {
    camera.position.copyFrom(pivot);
    camera.setTarget(pivot.add(forward.scale(200)));
    camera.fov = 2 * Math.atan(Math.tan(0.92 / 2) / weapon.zoom);
    models.get(actor.id)?.root.setEnabled(false);
    snapCamera = true;
    return;
  }
  const desired = pivot.add(right.scale(aiming ? 0.6 : 0.8)).subtract(forward.scale(aiming ? 2.1 : 4.9));
  const delta = desired.subtract(pivot), distance = delta.length();
  const hit = scene.pickWithRay(new Ray(pivot, delta.normalize(), distance), m => !!m.metadata?.solid);
  if (hit?.hit && hit.distance < distance) desired.copyFrom(pivot.add(delta.scale(Math.max(0.3, hit.distance - 0.3))));
  camera.position.copyFrom(snapCamera ? desired : Vector3.Lerp(camera.position, desired, 1 - Math.exp(-dt * 20)));
  snapCamera = false;
  camera.setTarget(camera.position.add(forward.scale(100)));
  const targetFov = aiming ? 2 * Math.atan(Math.tan(0.92 / 2) / weapon.zoom) : 0.92;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 12);
}

function shoot() {
  const weapon = WEAPONS[sim.player.weapon];
  const ray = camera.getForwardRay(weapon.range);
  const pick = scene.pickWithRay(ray, mesh => {
    if (!mesh.isEnabled() || !mesh.isPickable) return false;
    if (mesh.metadata?.actorId) return mesh.metadata.actorId !== 'player' && !!sim.state.actors.find(a => a.id === mesh.metadata.actorId)?.alive;
    return !!mesh.metadata?.solid;
  });
  const target = pick?.hit && pick.pickedPoint ? pick.pickedPoint : ray.origin.add(ray.direction.scale(weapon.range));
  if (sim.shootPlayer({ x: target.x, y: target.y, z: target.z }, aiming)) recoil = Math.min(0.13, recoil + weapon.recoil);
}

function selectWeapon(weapon: WeaponType) {
  if (!sim.player.ownedWeapons.includes(weapon)) { ui.notify(`Chưa nhặt ${WEAPONS[weapon].label}`); return; }
  if (sim.switchWeapon(weapon)) {
    aiming = false; shooting = false; triggerPending = false; recoil = 0;
    mobile?.cancelFire();
    ui.notify(`${WEAPONS[weapon].label} · ${WEAPONS[weapon].category}`);
  }
}

function cycleWeapon(direction: number) {
  const owned = WEAPON_ORDER.filter(weapon => sim.player.ownedWeapons.includes(weapon));
  if (owned.length < 2) return;
  const index = owned.indexOf(sim.player.weapon);
  selectWeapon(owned[(index + direction + owned.length) % owned.length]);
}

function beginAim() {
  if (WEAPONS[sim.player.weapon].zoom >= 4) {
    const ray = camera.getForwardRay(WEAPONS[sim.player.weapon].range);
    const pick = scene.pickWithRay(ray, mesh => mesh.isEnabled() && !!mesh.metadata && mesh.metadata.actorId !== 'player' && (!!mesh.metadata.solid || !!sim.state.actors.find(actor => actor.id === mesh.metadata.actorId)?.alive));
    const target = pick?.pickedPoint ?? ray.origin.add(ray.direction.scale(WEAPONS[sim.player.weapon].range));
    const dx = target.x - sim.player.position.x, dz = target.z - sim.player.position.z;
    yaw = Math.atan2(dx, dz);
    pitch = Math.atan2(target.y - sim.player.position.y - 1.52, Math.hypot(dx, dz));
    recoil = 0;
  }
  aiming = true;
}

function events(dt: number) {
  for (const event of sim.drainEvents()) {
    audio.handle(event, sim.player.position);
    if (event.type === 'message') ui.notify(event.text);
    if (event.type === 'shot') {
      const line = MeshBuilder.CreateLines('tracer', { points: [new Vector3(event.from.x, event.from.y, event.from.z), new Vector3(event.to.x, event.to.y, event.to.z)] }, scene);
      line.color = Color3.FromHexString(event.actorId === 'player' ? '#ffdc9b' : '#dbb785'); line.isPickable = false;
      effects.push({ mesh: line, remaining: 0.065 });
      const actorModel = models.get(event.actorId); if (actorModel) actorModel.flash.setEnabled(true);
    }
    if (event.type === 'kill' && event.killerId === 'player') {
      const victim = sim.state.actors.find(a => a.id === event.actorId); ui.notify(`Đã hạ ${victim?.name ?? 'đối thủ'}`);
    }
    if (event.type === 'damage' && event.actorId === 'player') recoil = Math.min(0.13, recoil + 0.005);
  }
  for (let i = effects.length - 1; i >= 0; i--) {
    effects[i].remaining -= dt;
    if (effects[i].remaining <= 0) { effects[i].mesh.dispose(); effects.splice(i, 1); }
  }
}

window.addEventListener('keydown', event => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  if (event.code === 'Escape' && !event.repeat) {
    if (sim.state.phase === 'playing') pause();
    else if (sim.state.phase === 'paused') { sim.setPaused(false); void audio.unlock(); lockPointer(); clock = performance.now(); }
    return;
  }
  if (sim.state.phase !== 'playing') return;
  if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight'].includes(event.code)) event.preventDefault();
  keys.add(event.code);
  if (event.repeat) return;
  if (event.code === 'KeyR' && sim.reload()) audio.reload();
  if (event.code === 'KeyH' && sim.heal()) audio.heal();
  if (event.code === 'KeyE') sim.interact();
  const weaponKey = /^(?:Digit|Numpad)([1-8])$/.exec(event.code);
  if (weaponKey) selectWeapon(WEAPON_ORDER[Number(weaponKey[1]) - 1]);
  if (event.code === 'KeyQ') cycleWeapon(1);
});
window.addEventListener('keyup', event => keys.delete(event.code));
canvas.addEventListener('mousedown', event => {
  if (touchDevice || sim.state.phase !== 'playing') return;
  event.preventDefault(); void audio.unlock();
  if (!document.pointerLockElement) lockPointer();
  if (event.button === 0) { shooting = true; triggerPending = true; }
  if (event.button === 2) beginAim();
});
window.addEventListener('mouseup', event => { if (touchDevice) return; if (event.button === 0) shooting = false; if (event.button === 2) aiming = false; });
canvas.addEventListener('contextmenu', event => event.preventDefault());
canvas.addEventListener('wheel', event => {
  if (sim.state.phase !== 'playing') return;
  event.preventDefault(); cycleWeapon(event.deltaY >= 0 ? 1 : -1);
}, { passive: false });
window.addEventListener('mousemove', event => {
  if (touchDevice || sim.state.phase !== 'playing' || (document.pointerLockElement !== canvas && !shooting && !aiming)) return;
  const sensitivity = 0.0016 * settings.sensitivity * (aiming ? 0.72 / Math.sqrt(WEAPONS[sim.player.weapon].zoom) : 1);
  yaw += event.movementX * sensitivity;
  pitch = Math.max(-0.7, Math.min(0.8, pitch - event.movementY * sensitivity));
});
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (!locked && hadLock && sim.state.phase === 'playing') pause();
  hadLock = locked;
});
window.addEventListener('blur', pause);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
function resizeGame() {
  if (touchDevice) releaseInput();
  if (engine) { applySettings(); engine.resize(); }
}
window.addEventListener('resize', resizeGame);
window.visualViewport?.addEventListener('resize', resizeGame);
window.addEventListener('orientationchange', resizeGame);

try {
  ui.setLoading('Đang dựng vùng sinh tồn…');
  engine = new Engine(canvas, !touchDevice, { stencil: true, preserveDrawingBuffer: !touchDevice }, false);
  engine.renderEvenInBackground = false;
  scene = new Scene(engine);
  scene.skipPointerMovePicking = true; scene.skipPointerDownPicking = true; scene.skipPointerUpPicking = true;
  scene.clearColor = new Color4(0.68, 0.74, 0.68, 1);
  scene.fogMode = Scene.FOGMODE_EXP2; scene.fogDensity = 0.0045;
  scene.fogColor = new Color3(0.64, 0.71, 0.65);
  const ambient = new HemisphericLight('ambient', new Vector3(0, 1, 0), scene); ambient.intensity = 0.7; ambient.groundColor = Color3.FromHexString('#636449');
  const sunlight = new DirectionalLight('sunlight', new Vector3(-0.5, -1, 0.65), scene);
  sunlight.position.set(45, 70, -45); sunlight.intensity = 0.85; sunlight.diffuse = Color3.FromHexString('#ffe0ae');
  shadows = new ShadowGenerator(touchDevice ? 256 : 1024, sunlight); shadows.useBlurExponentialShadowMap = !touchDevice; shadows.blurKernel = 12; shadows.darkness = 0.23;
  camera = new FreeCamera('camera', new Vector3(50, 35, -80), scene);
  camera.minZ = 0.08; camera.maxZ = 450; camera.inputs.clear();
  buildWorld(); applySettings();
  ui.setLoading(null);
  engine.runRenderLoop(() => {
    const now = performance.now();
    if (document.hidden) { clock = now; return; }
    const frameInterval = touchDevice ? 1000 / (sim.state.phase === 'paused' ? 15 : settings.quality === 'low' ? 30 : 60) : 0;
    if (frameInterval && now - lastRenderTime < frameInterval - 1) return;
    lastRenderTime = now;
    const dt = Math.min(0.1, Math.max(0, (now - clock) / 1000)); clock = now;
    if (sim.state.phase === 'playing') {
      const rawForward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0) + (mobile?.movement.forward ?? 0);
      const rawSide = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0) + (mobile?.movement.side ?? 0);
      const length = Math.max(1, Math.hypot(rawForward, rawSide));
      const forward = rawForward / length, side = rawSide / length;
      const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight') || !!mobile?.movement.sprint;
      sim.update(dt, { moveX: Math.sin(yaw) * forward + Math.cos(yaw) * side, moveZ: Math.cos(yaw) * forward - Math.sin(yaw) * side, sprint, jump: keys.has('Space') || mobileJump });
      sim.player.yaw = yaw;
      if (forward || side) { footsteps += dt; if (footsteps > (sprint ? 0.30 : 0.43) && sim.player.position.y < 0.05) { audio.footstep(sprint); footsteps = 0; } }
      else footsteps = 0;
    }
    renderActors(sim.state.phase === 'paused' ? 0 : dt);
    if (!touchDevice || now - lastLootTime >= 80 || hudPhase !== sim.state.phase) { renderLoot(sim.state.elapsed); lastLootTime = now; }
    renderZone(); updateCamera(dt);
    if (sim.state.phase === 'playing' && (triggerPending || shooting && WEAPONS[sim.player.weapon].fireMode === 'auto')) shoot();
    triggerPending = false;
    events(sim.state.phase === 'paused' ? 0 : dt);
    if (sim.state.phase !== lastPhase) {
      if (sim.state.phase === 'won' || sim.state.phase === 'lost') releaseInput();
      lastPhase = sim.state.phase;
    }
    const loot = sim.lootInReach;
    const hint = loot ? `${touchDevice ? '' : '[E] '}Nhặt ${lootLabel(loot.kind)}` : sim.player.healing > 0 ? 'Đang hồi máu…' : sim.player.reloading > 0 ? 'Đang nạp đạn…' : !touchDevice && document.pointerLockElement !== canvas && sim.state.phase === 'playing' ? 'Nhấp vào màn hình để điều khiển chuột' : '';
    if (!touchDevice || now - lastHudTime >= 90 || hudPhase !== sim.state.phase || hudWeapon !== sim.player.weapon) {
      ui.update(sim.state, sim.world, hint); lastHudTime = now; hudPhase = sim.state.phase; hudWeapon = sim.player.weapon;
    }
    ui.setAim(aiming && sim.state.phase === 'playing', sim.player.weapon);
    mobile?.setEnabled(sim.state.phase === 'playing');
    mobile?.update({ aiming, canPickup: !!loot, reloading: sim.player.reloading > 0, healing: sim.player.healing > 0 });
    scene.render();
  });
  if (import.meta.env.DEV) {
    Object.assign(window, { __LASTLIGHT__: { simulation: sim, engine, scene, getCamera: () => ({ yaw, pitch }), setCamera: (nextYaw: number, nextPitch: number) => { yaw = nextYaw; pitch = nextPitch; } } });
  }
} catch (error) {
  console.error(error);
  ui.setLoading(null);
  ui.showError('Không thể khởi tạo đồ họa 3D. Hãy bật tăng tốc phần cứng và mở game bằng Chrome hoặc Edge.');
}
