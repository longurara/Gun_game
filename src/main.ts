import './style.css';
import './theme.css';
import './mobile-hud.css';
import './desktop-hud.css';
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
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder.js';
import { CreateLines } from '@babylonjs/core/Meshes/Builders/linesBuilder.js';
import '@babylonjs/core/Meshes/instancedMesh.js';
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh.js';
import { GameSimulation } from './game/simulation';
import { GameUI } from './ui';
import { GameAudio } from './audio';
import { createWeaponModel } from './weapon-models';
import { Soldier } from './soldier';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { WEAPONS, isArmorKind, isSidearm, isWeaponKind, lootLabel, parseArmor, slotOrder, ammoTypeOf } from './game/weapons';
import type { Actor, GameSettings, Loot, Vehicle, WeaponType } from './types';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder.js';
import { isTouchDevice, renderBudgetFor, touchLookSensitivity } from './device';
import { MobileControls } from './mobile-controls';
import { IslandRenderer } from './island-renderer';
import { GENERATED_TEXTURES, useGeneratedAlbedo } from './generated-textures';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration.js';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline.js';
import '@babylonjs/core/Rendering/depthRendererSceneComponent.js';

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
const lootMeshes = new Map<string, { node: InstancedMesh; loot: Loot }>();
const lootTemplates = new Map<string, Mesh>();
let arenaMeshes: Mesh[] = [];
let islandRenderer: IslandRenderer | null = null;
let sunlight: DirectionalLight;
let ambient: HemisphericLight;
let pipeline: DefaultRenderingPipeline | null = null;
let lastLootScan = -Infinity;
const effects: { mesh: Mesh; remaining: number; total?: number; grow?: number }[] = [];
const carModels = new Map<string, { root: TransformNode; wheels: TransformNode[]; bodies: Mesh[]; wrecked: boolean }>();
let lastLookAt = -Infinity, wasDriving = false;
let currentZone: Mesh, currentRing: Mesh, nextRing: Mesh;
let settings: GameSettings;
let mobile: MobileControls | null = null;
let mobileJump = false;
let lastRenderTime = 0, lastHudTime = -Infinity;
let hudPhase: string | null = null, hudWeapon: WeaponType | null = null;

const ui = new GameUI({
  onStart: (next) => { settings = next; applySettings(); start(); },
  onResume: () => { void audio.unlock(); sim.setPaused(false); lockPointer(); clock = performance.now(); },
  onRestart: () => start(),
  onMenu: () => { sim.returnToMenu({ map: 'arena', botCount: 5 }); configureWorld(); releaseInput(); audio.pause(); },
  onSettings: (next) => { settings = next; applySettings(); },
  onSelectWeapon: selectWeapon,
  onTouchOverlayChange: (open) => { if (open) releaseInput(); },
});
settings = ui.settings;
if (touchDevice) {
  mobile = new MobileControls(canvas, {
    onLook: (dx, dy) => {
      if (sim.state.phase !== 'playing' || ui.touchOverlayOpen) return;
      const sensitivity = touchLookSensitivity(canvas.clientWidth, canvas.clientHeight, settings.sensitivity, aiming ? WEAPONS[sim.player.weapon].zoom : null);
      lastLookAt = performance.now();
      yaw += dx * sensitivity;
      pitch = Math.max(-0.7, Math.min(0.8, pitch - dy * sensitivity));
    },
    onFire: (pressed) => {
      shooting = pressed && sim.state.phase === 'playing' && !ui.touchOverlayOpen;
      if (shooting) { void audio.unlock(); triggerPending = true; }
    },
    onAimToggle: () => { if (sim.state.phase === 'playing') { void audio.unlock(); if (aiming) aiming = false; else beginAim(); } },
    onJump: (pressed) => { mobileJump = pressed; },
    onReload: () => { if (sim.reload()) { void audio.unlock(); audio.reload(); } },
    onInteract: () => { if (!sim.interact()) useVehicle(); },
    onHeal: () => { if (sim.heal()) { void audio.unlock(); audio.heal(); } },
    onCycleWeapon: () => cycleWeapon(1),
    onPause: pause,
  });
}

function start() {
  void audio.unlock();
  audio.pause();
  releaseInput();
  sim.start({ botCount: settings.botCount, difficulty: settings.difficulty, seed: Date.now(), map: settings.map });
  configureWorld();
  yaw = 0; pitch = -0.12; recoil = 0; snapCamera = true; footsteps = 0;
  for (const effect of effects) effect.mesh.dispose();
  effects.length = 0;
  for (const model of models.values()) model.root.setEnabled(false);
  lockPointer();
  clock = performance.now();
  const mapId: string = sim.world.id;
  ui.notify(mapId === 'island' ? 'Bạn đã đáp xuống đảo. Tìm vũ khí và vào vùng an toàn!' : mapId === 'valley' ? 'Thung lũng đông đúc. Lục nhà tìm súng, bo thu rất nhanh!' : 'Tìm trang bị. Giữ vùng an toàn. Sống sót cuối cùng.');
}

/** Switch the scene between the small arena and the streamed island to match the simulation's world. */
function configureWorld() {
  const island = sim.world.id !== 'arena';
  for (const mesh of arenaMeshes) mesh.setEnabled(!island);
  for (const car of carModels.values()) car.root.dispose(false, true);
  carModels.clear();
  for (const entry of lootMeshes.values()) entry.node.dispose();
  lootMeshes.clear();
  for (const model of models.values()) model.root.setEnabled(false);
  islandRenderer?.dispose();
  islandRenderer = null;
  if (island) {
    islandRenderer = new IslandRenderer(scene, sim.world, touchDevice ? 5 : 6, touchDevice, shadows);
    islandRenderer.update(sim.player.position.x, sim.player.position.z, 100000);
  }
  scene.fogDensity = island ? 0.0024 : 0.0045;
  // Hazy sky-blue distance on the island; the arena keeps its olive dusk.
  scene.fogColor = island ? new Color3(0.78, 0.84, 0.88) : new Color3(0.64, 0.71, 0.65);
  scene.clearColor = island ? new Color4(0.78, 0.84, 0.88, 1) : new Color4(0.68, 0.74, 0.68, 1);
  ambient.diffuse = island ? new Color3(0.9, 0.95, 1) : Color3.White();
  ambient.groundColor = Color3.FromHexString(island ? '#6a7048' : '#636449');
  ambient.intensity = island ? 0.95 : 0.7;
  sunlight.intensity = island ? 1.25 : 0.85;
  camera.maxZ = island ? 800 : 450;
  // The arena fits one shadow map; on the island the sun's frustum follows the player instead.
  sunlight.autoUpdateExtends = !island;
  if (island) {
    sunlight.orthoLeft = -85; sunlight.orthoRight = 85; sunlight.orthoTop = 85; sunlight.orthoBottom = -85;
    sunlight.shadowMinZ = 1; sunlight.shadowMaxZ = 330;
  }
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
  ui.toggleMap(false);
  if (sim.state.phase !== 'playing') return;
  sim.setPaused(true); releaseInput(); audio.pause();
}

function applySettings() {
  audio.setVolume(settings.volume);
  const budget = renderBudgetFor(settings.quality, touchDevice, canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio);
  if (engine) engine.setHardwareScalingLevel(budget.scaling);
  if (scene) scene.shadowsEnabled = budget.shadows;
  // Multisampling and a soft bloom only where the GPU budget allows: desktop at high quality.
  if (camera) {
    const wantPipeline = !touchDevice && settings.quality === 'high';
    if (wantPipeline && !pipeline) {
      pipeline = new DefaultRenderingPipeline('lastlight', true, scene, [camera]);
      pipeline.samples = 4;
      pipeline.bloomEnabled = true;
      pipeline.bloomThreshold = 0.82; pipeline.bloomWeight = 0.28; pipeline.bloomKernel = 56; pipeline.bloomScale = 0.5;
      pipeline.sharpenEnabled = true; pipeline.sharpen.edgeAmount = 0.22;
    } else if (!wantPipeline && pipeline) { pipeline.dispose(); pipeline = null; }
  }
}

const sharedMaterials = new Map<string, StandardMaterial>();
/** Materials are cached by name: characters and pickups share a handful instead of owning dozens each. */
function material(name: string, color: string, emissive = 0): StandardMaterial {
  const cached = sharedMaterials.get(name);
  if (cached) return cached;
  const value = new StandardMaterial(name, scene);
  sharedMaterials.set(name, value);
  value.diffuseColor = Color3.FromHexString(color);
  value.specularColor = Color3.Black();
  if (name === 'wood') useGeneratedAlbedo(value, GENERATED_TEXTURES.wood, 1, 1.12);
  if (name === 'dry-grass') useGeneratedAlbedo(value, GENERATED_TEXTURES.ground, sim.world.halfSize * 2.5 / 4, 1.25);
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
  arenaMeshes = scene.meshes.filter(mesh => mesh.isEnabled()) as Mesh[];
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
  soldier: Soldier; root: TransformNode; last: Vector3; stride: number; moving: number;
}

function createCharacter(actor: Actor): Character {
  const soldier = new Soldier(scene, actor.id, actor.isPlayer, shadows);
  soldier.setWeapon(actor.weapon);
  return { soldier, root: soldier.root, last: new Vector3(), stride: 0, moving: 0 };
}

function renderActors(dt: number) {
  const island = sim.world.id !== 'arena';
  const focus = sim.player.position;
  const time = performance.now() * 0.001;
  for (const actor of sim.state.actors) {
    let model = models.get(actor.id);
    // On the big map only nearby characters exist in the scene; far bots are simulated but never drawn.
    if (sim.state.phase === 'menu' && !actor.isPlayer) { models.get(actor.id)?.root.setEnabled(false); continue; }
    if (island && !actor.isPlayer && Math.hypot(actor.position.x - focus.x, actor.position.z - focus.z) > (actor.alive ? 340 : 200)) {
      model?.root.setEnabled(false);
      continue;
    }
    if (!model) { model = createCharacter(actor); models.set(actor.id, model); model.last.set(actor.position.x, actor.position.y, actor.position.z); }
    model.root.setEnabled(!actor.vehicleId);
    const pos = new Vector3(actor.position.x, actor.position.y, actor.position.z);
    const speed = Vector3.Distance(pos, model.last) / Math.max(dt, 0.001);
    model.moving += ((actor.alive ? Math.min(speed, 8) : 0) - model.moving) * Math.min(1, dt * 12);
    model.stride += dt * model.moving * 2.2;
    model.root.position.copyFrom(pos);
    model.root.rotation.set(0, actor.yaw, actor.alive ? 0 : Math.PI / 2);
    if (!actor.alive) model.root.position.y = actor.position.y + 0.32;
    model.soldier.setWeapon(actor.weapon);
    model.soldier.setGear(actor.helmet, actor.vest);
    const showcase = sim.state.phase === 'menu' && actor.isPlayer;
    if (showcase) {
      // Lobby display: turned toward the camera, breathing, weapon held low.
      model.root.rotation.set(0, Math.PI + 0.55 + Math.sin(time * 0.5) * 0.1, 0);
      model.root.position.y = actor.position.y + Math.sin(time * 1.6) * 0.012;
    }
    model.soldier.pose(dt, { moving: showcase ? 0 : model.moving, stride: model.stride, alive: actor.alive, reloading: actor.reloading > 0, healing: actor.healing > 0, time, showcase });
    model.soldier.endFlash();
    model.last.copyFrom(pos);
  }
}

const CAR_COLORS = ['#b5483a', '#3f6f9a', '#d0a739', '#dcdcd2', '#52624f'];

function createCarModel(v: Vehicle) {
  const root = new TransformNode(`car-${v.id}`, scene);
  const paint = material(`car-paint-${v.colorIndex % 5}`, CAR_COLORS[v.colorIndex % 5]);
  const dark = material('car-tyre', '#1b1f21');
  const glass = material('car-glass', '#33454f', 0.15);
  const lamp = material('car-lamp', '#fff2c4', 0.9);
  const parts: Mesh[] = [];
  const add = (mesh: Mesh) => { mesh.metadata = { solid: true, car: true }; parts.push(mesh); return mesh; };
  add(box('car-body', 1.9, 0.72, 4.2, paint, new Vector3(0, 0.78, 0), root));
  add(box('car-cabin', 1.7, 0.62, 2.1, glass, new Vector3(0, 1.45, -0.25), root));
  add(box('car-roof', 1.62, 0.07, 1.95, paint, new Vector3(0, 1.8, -0.25), root));
  add(box('car-bumper', 1.96, 0.26, 0.14, dark, new Vector3(0, 0.55, 2.1), root));
  add(box('car-bumper', 1.96, 0.26, 0.14, dark, new Vector3(0, 0.55, -2.1), root));
  for (const x of [-0.65, 0.65]) add(box('car-lamp', 0.32, 0.18, 0.06, lamp, new Vector3(x, 0.9, 2.12), root));
  const wheels: TransformNode[] = [];
  for (const [x, z] of [[-0.98, 1.35], [0.98, 1.35], [-0.98, -1.35], [0.98, -1.35]]) {
    const pivot = new TransformNode('wheel-pivot', scene);
    pivot.parent = root; pivot.position.set(x, 0.42, z);
    const wheel = MeshBuilder.CreateCylinder('wheel', { diameter: 0.84, height: 0.32, tessellation: 12 }, scene);
    wheel.rotation.z = Math.PI / 2; wheel.material = dark; wheel.parent = pivot; wheel.isPickable = false;
    wheels.push(pivot);
  }
  for (const mesh of parts) { shadows.addShadowCaster(mesh); mesh.receiveShadows = true; }
  return { root, wheels, bodies: parts, wrecked: false };
}

function renderVehicles(dt: number) {
  const focus = sim.player.position;
  for (const v of sim.state.vehicles) {
    let car = carModels.get(v.id);
    if (Math.hypot(v.position.x - focus.x, v.position.z - focus.z) > 380) { car?.root.setEnabled(false); continue; }
    if (!car) { car = createCarModel(v); carModels.set(v.id, car); }
    car.root.setEnabled(true);
    car.root.position.set(v.position.x, v.position.y, v.position.z);
    // Lean the body to follow the slope under it.
    const sx = Math.sin(v.yaw), cz = Math.cos(v.yaw);
    const pitch = Math.atan2(sim.heightAt(v.position.x - sx * 2, v.position.z - cz * 2) - sim.heightAt(v.position.x + sx * 2, v.position.z + cz * 2), 4);
    const roll = Math.atan2(sim.heightAt(v.position.x - cz * 1.2, v.position.z + sx * 1.2) - sim.heightAt(v.position.x + cz * 1.2, v.position.z - sx * 1.2), 2.4);
    car.root.rotation.set(pitch, v.yaw, roll);
    for (const wheel of car.wheels) wheel.rotation.x += v.speed * dt / 0.42;
    if (v.health <= 0 && !car.wrecked) {
      car.wrecked = true;
      const burnt = material('car-burnt', '#242322');
      for (const mesh of car.bodies) mesh.material = burnt;
    }
  }
}

const AMMO_COLOR: Record<string, string> = { '9mm': '#e0c070', '45acp': '#d8a860', '357': '#d09070', '556': '#9cc27a', '762': '#c8b078', '12g': '#d46a5a', '300': '#8fb4d8', '50cal': '#d8d27a' };

function createLootNode(loot: Loot): TransformNode {
  const root = new TransformNode(`loot-${loot.id}`, scene);
  const isMed = loot.kind === 'medkit', weapon = isWeaponKind(loot.kind) ? loot.kind : null;
  const ammoType = ammoTypeOf(loot.kind);
  const armor = isArmorKind(loot.kind) ? parseArmor(loot.kind) : null;
  const tierColor = ['#9aa3a0', '#9aa3a0', '#4f8fd6', '#e0b13a'];
  const mat = material(`loot-${loot.kind}`, armor ? tierColor[armor.level] : isMed ? '#88d4a4' : weapon ? WEAPONS[weapon].color : ammoType ? AMMO_COLOR[ammoType] : '#c1b77e', 0.25);
  if (armor) {
    if (armor.slot === 'helmet') {
      const dome = MeshBuilder.CreateSphere('helmet-loot', { diameter: 0.46, segments: 8, slice: 0.6 }, scene);
      dome.material = mat; dome.parent = root; dome.isPickable = false;
    } else {
      const body = box('vest-loot', 0.5, 0.56, 0.2, mat, new Vector3(0, 0, 0), root); body.isPickable = false;
      box('vest-strap', 0.52, 0.08, 0.22, material('vest-strap', '#2c3430'), new Vector3(0, 0.12, 0), root).isPickable = false;
    }
  } else if (weapon) {
    const display = createWeaponModel(weapon, scene, root);
    // Lying flat and turning slowly, centred on its middle so every gun spins about its own centre.
    display.root.scaling.setAll(0.72); display.root.rotation.z = 0.12; display.root.position.set(0, 0, -0.34);
  } else {
    const base = box('loot', 0.35, isMed ? 0.35 : 0.16, 0.3, mat, new Vector3(0, 0, 0), root); base.isPickable = false;
  }
  if (isMed) {
    const crossMat = material('cross', '#edf5d7', 0.3);
    box('cross', 0.22, 0.07, 0.04, crossMat, new Vector3(0, 0, -0.17), root).isPickable = false;
    box('cross', 0.07, 0.22, 0.04, crossMat, new Vector3(0, 0, -0.171), root).isPickable = false;
  }
  const marker = MeshBuilder.CreateTorus('loot-ring', { diameter: 0.9, thickness: 0.023, tessellation: 24 }, scene);
  marker.parent = root; marker.position.y = -0.3; marker.isPickable = false;
  marker.material = weapon ? material(`loot-ring-tier-${WEAPONS[weapon].tier}`, ['', '#d6ded9', '#4f9bd9', '#f0b43c'][WEAPONS[weapon].tier], 0.6) : mat;
  // Merging needs every part to carry the same vertex attributes; procedural guns use vertex colours.
  if (weapon) marker.setVerticesData(VertexBuffer.ColorKind, new Array(marker.getTotalVertices() * 4).fill(1));
  return root;
}

/** One merged mesh per pickup kind; every item of that kind is an instance, so a kind costs one draw call. */
function lootInstance(loot: Loot): InstancedMesh {
  let template = lootTemplates.get(loot.kind);
  if (!template) {
    const root = createLootNode(loot);
    const merged = Mesh.MergeMeshes(root.getChildMeshes(false) as Mesh[], true, true, undefined, false, true)!;
    merged.name = `loot-template-${loot.kind}`;
    merged.isPickable = false;
    merged.setEnabled(false);
    root.dispose();
    template = merged;
    lootTemplates.set(loot.kind, template);
  }
  const node = template.createInstance(`loot-${loot.id}`);
  node.isPickable = false;
  return node;
}

/**
 * Pickups exist in the scene only while they are active and near the player, so a map with thousands of items
 * costs a handful of nodes. The (cheap) distance scan runs a few times a second; bobbing runs every frame.
 */
function renderLoot(time: number) {
  const now = performance.now();
  const playing = sim.state.phase !== 'menu';
  if (now - lastLootScan >= 120 || hudPhase !== sim.state.phase) {
    lastLootScan = now;
    const island = sim.world.id !== 'arena';
    // No pickups in the lobby; on big maps only those near the player exist in the scene.
    const range = !playing ? 0 : island ? 95 : touchDevice ? 75 : Infinity;
    const focus = sim.player.position;
    const current = new Set<string>();
    for (const loot of sim.state.loot) {
      current.add(loot.id);
      const d = Math.hypot(loot.position.x - focus.x, loot.position.z - focus.z);
      const entry = lootMeshes.get(loot.id);
      const wanted = loot.active && d < range;
      if (entry && (entry.loot !== loot || !loot.active || d > range * 1.25)) { entry.node.dispose(); lootMeshes.delete(loot.id); }
      else if (!entry && wanted) lootMeshes.set(loot.id, { node: lootInstance(loot), loot });
    }
    for (const [id, entry] of lootMeshes) if (!current.has(id)) { entry.node.dispose(); lootMeshes.delete(id); }
  }
  for (const { node, loot } of lootMeshes.values()) {
    node.position.set(loot.position.x, loot.position.y + 0.45 + Math.sin(time * 2 + loot.position.x) * 0.07, loot.position.z);
    node.rotation.y = time * 0.45;
  }
}

function renderZone() {
  const zone = sim.state.zone;
  const show = sim.state.phase !== 'menu';
  currentZone.setEnabled(show); currentRing.setEnabled(show); nextRing.setEnabled(show);
  // The wall must clear the island's mountains, so it is taller there.
  const wallHeight = sim.world.id !== 'arena' ? 170 : 8;
  currentZone.position.set(zone.center.x, wallHeight / 2, zone.center.z); currentZone.scaling.set(Math.max(0.05, zone.radius), wallHeight, Math.max(0.05, zone.radius));
  currentRing.position.set(zone.center.x, 0.07, zone.center.z); currentRing.scaling.set(zone.radius, 1, zone.radius);
  nextRing.position.set(zone.nextCenter.x, 0.085, zone.nextCenter.z); nextRing.scaling.set(zone.nextRadius, 1, zone.nextRadius);
}

function updateCamera(dt: number) {
  if (sim.state.phase === 'menu') {
    // Lobby shot: the player's character stands left of centre (the panel fills the right), seen from a low
    // three-quarter angle with a slow sway, against the arena and its sun.
    const t = performance.now() * 0.001;
    const p = sim.player.position;
    camera.position.set(p.x + 3.3 + Math.sin(t * 0.25) * 0.5, p.y + 1.35 + Math.sin(t * 0.4) * 0.05, p.z - 5.2 + Math.cos(t * 0.25) * 0.3);
    camera.setTarget(new Vector3(p.x + 1.15, p.y + 1.2, p.z));
    camera.fov = 0.7; return;
  }
  const actor = sim.player;
  const ridden = actor.vehicleId ? sim.state.vehicles.find(v => v.id === actor.vehicleId) : undefined;
  if (ridden) aiming = false;
  recoil *= Math.exp(-dt * 9);
  const viewPitch = Math.max(-0.7, Math.min(0.8, pitch + recoil));
  const forward = new Vector3(Math.sin(yaw) * Math.cos(viewPitch), Math.sin(viewPitch), Math.cos(yaw) * Math.cos(viewPitch));
  const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const pivot = ridden ? new Vector3(ridden.position.x, ridden.position.y + 1.9, ridden.position.z) : new Vector3(actor.position.x, actor.position.y + 1.52, actor.position.z);
  const weapon = WEAPONS[actor.weapon];
  if (aiming && weapon.zoom >= 4 && sim.state.phase === 'playing') {
    camera.position.copyFrom(pivot);
    camera.setTarget(pivot.add(forward.scale(200)));
    camera.fov = 2 * Math.atan(Math.tan(0.92 / 2) / weapon.zoom);
    models.get(actor.id)?.root.setEnabled(false);
    snapCamera = true;
    return;
  }
  const desired = ridden
    ? pivot.subtract(forward.scale(9.5)).add(new Vector3(0, 1.1, 0))
    : pivot.add(right.scale(aiming ? 0.6 : 0.8)).subtract(forward.scale(aiming ? 2.1 : 4.9));
  const delta = desired.subtract(pivot), distance = delta.length();
  const hit = scene.pickWithRay(new Ray(pivot, delta.normalize(), distance), m => !!m.metadata?.solid && !m.metadata?.car);
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

/** Get in or out of a car and reset aim state so nothing carries over. */
function useVehicle() {
  if (!sim.useVehicle()) return;
  aiming = false; shooting = false; triggerPending = false; recoil = 0;
  mobile?.cancelFire();
}

function selectWeapon(weapon: WeaponType) {
  if (!sim.player.ownedWeapons.includes(weapon)) return;
  if (sim.switchWeapon(weapon)) {
    aiming = false; shooting = false; triggerPending = false; recoil = 0;
    mobile?.cancelFire();
    ui.notify(`${WEAPONS[weapon].label} · ${WEAPONS[weapon].category}`);
  }
}

function cycleWeapon(direction: number) {
  const owned = slotOrder(sim.player.ownedWeapons);
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
      models.get(event.actorId)?.soldier.fire();
    }
    if (event.type === 'kill') {
      const victim = sim.state.actors.find(a => a.id === event.actorId);
      const killer = event.killerId ? sim.state.actors.find(a => a.id === event.killerId) : undefined;
      if (victim) ui.pushKill(killer?.name ?? 'Vòng bo', victim.name, killer?.vehicleId ? 'XE' : killer ? WEAPONS[killer.weapon].label : 'BO', event.killerId === 'player' || victim.isPlayer);
    }
    if (event.type === 'kill' && event.killerId === 'player') {
      const victim = sim.state.actors.find(a => a.id === event.actorId); ui.notify(`Đã hạ ${victim?.name ?? 'đối thủ'}`);
    }
    if (event.type === 'damage' && event.actorId === 'player') {
      recoil = Math.min(0.13, recoil + 0.005);
      const source = event.sourceId ? sim.state.actors.find(a => a.id === event.sourceId) : undefined;
      if (source) ui.showDamageFrom(Math.atan2(source.position.x - sim.player.position.x, source.position.z - sim.player.position.z) - yaw);
    }
    if (event.type === 'pickup') ui.notify(`Nhặt ${lootLabel(event.kind)}`);
    if (event.type === 'crash' && sim.player.vehicleId === event.vehicleId) recoil = Math.min(0.13, recoil + event.strength * 0.004);
    if (event.type === 'explosion') {
      const flash = CreateSphere('blast', { diameter: 2, segments: 8 }, scene);
      const blastMaterial = new StandardMaterial('blast', scene);
      blastMaterial.emissiveColor = new Color3(1, 0.6, 0.2); blastMaterial.diffuseColor = Color3.Black(); blastMaterial.alpha = 0.85; blastMaterial.disableLighting = true;
      flash.material = blastMaterial; flash.isPickable = false; flash.position.set(event.position.x, event.position.y + 1, event.position.z);
      effects.push({ mesh: flash, remaining: 0.5, total: 0.5, grow: 4 });
      const near = Math.hypot(event.position.x - sim.player.position.x, event.position.z - sim.player.position.z);
      if (near < 40) recoil = Math.min(0.13, recoil + 0.08 * (1 - near / 40));
    }
  }
  for (let i = effects.length - 1; i >= 0; i--) {
    const effect = effects[i];
    effect.remaining -= dt;
    if (effect.total && effect.grow) {
      const t = 1 - Math.max(0, effect.remaining) / effect.total;
      effect.mesh.scaling.setAll(1 + effect.grow * t);
      if (effect.mesh.material) effect.mesh.material.alpha = 0.85 * (1 - t);
    }
    if (effect.remaining <= 0) { effect.mesh.dispose(false, !!effect.total); effects.splice(i, 1); }
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
  if (event.code === 'Space' && event.target instanceof Element && event.target.closest('button, [role="button"]')) return;
  if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight'].includes(event.code)) event.preventDefault();
  keys.add(event.code);
  if (event.repeat) return;
  if (event.code === 'KeyR' && sim.reload()) audio.reload();
  if (event.code === 'KeyH' && sim.heal()) audio.heal();
  if (event.code === 'KeyE' && !sim.interact()) useVehicle();
  if (event.code === 'KeyF') useVehicle();
  // Slots 1 and 2 are the main guns in the order they were picked up; slot 3 is the sidearm.
  const slotKey = /^(?:Digit|Numpad)([1-3])$/.exec(event.code);
  if (slotKey) {
    const slots = slotOrder(sim.player.ownedWeapons), number = Number(slotKey[1]);
    const weapon = number === 3 ? slots.find(isSidearm) : slots.filter(w => !isSidearm(w))[number - 1];
    if (weapon) selectWeapon(weapon);
  }
  if (event.code === 'KeyM') ui.toggleMap();
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
  lastLookAt = performance.now();
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
  ambient = new HemisphericLight('ambient', new Vector3(0, 1, 0), scene); ambient.intensity = 0.7; ambient.groundColor = Color3.FromHexString('#636449');
  sunlight = new DirectionalLight('sunlight', new Vector3(-0.5, -1, 0.65), scene);
  sunlight.position.set(45, 70, -45); sunlight.intensity = 0.85; sunlight.diffuse = Color3.FromHexString('#ffe0ae');
  shadows = new ShadowGenerator(touchDevice ? 256 : 2048, sunlight);
  if (touchDevice) { shadows.useBlurExponentialShadowMap = true; shadows.blurKernel = 12; shadows.darkness = 0.23; }
  else {
    // Percentage-closer filtering keeps contact shadows crisp without the light bleeding of exponential maps.
    shadows.usePercentageCloserFiltering = true;
    shadows.filteringQuality = ShadowGenerator.QUALITY_HIGH;
    shadows.bias = 0.0004; shadows.normalBias = 0.03; shadows.darkness = 0.42;
    // Foliage cards are alpha-tested; let their cut-outs shape the shadows too.
    shadows.transparencyShadow = true;
  }
  camera = new FreeCamera('camera', new Vector3(50, 35, -80), scene);
  camera.minZ = 0.08; camera.maxZ = 450; camera.inputs.clear();
  const grading = scene.imageProcessingConfiguration;
  grading.toneMappingEnabled = true;
  grading.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
  grading.exposure = 1.22;
  grading.contrast = 1.22;
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
      const car = sim.player.vehicleId ? sim.state.vehicles.find(v => v.id === sim.player.vehicleId) : undefined;
      if (car) {
        if (!wasDriving) { yaw = car.yaw; pitch = -0.2; snapCamera = true; }
        // Without recent mouse input the chase camera swings in behind the car.
        if (Math.abs(car.speed) > 3 && performance.now() - lastLookAt > 1200) {
          const heading = car.speed >= 0 ? car.yaw : car.yaw + Math.PI;
          yaw += Math.atan2(Math.sin(heading - yaw), Math.cos(heading - yaw)) * Math.min(1, dt * 1.6);
        }
        sim.update(dt, { moveX: 0, moveZ: 0, sprint: false, jump: keys.has('Space') || mobileJump, throttle: Math.max(-1, Math.min(1, rawForward)), steer: Math.max(-1, Math.min(1, rawSide)) });
        audio.engine(car.speed, rawForward);
      } else {
        sim.update(dt, { moveX: Math.sin(yaw) * forward + Math.cos(yaw) * side, moveZ: Math.cos(yaw) * forward - Math.sin(yaw) * side, sprint, jump: keys.has('Space') || mobileJump });
        sim.player.yaw = yaw;
      }
      if (wasDriving && !car) { snapCamera = true; pitch = -0.12; }
      wasDriving = !!car;
      if (!car && (forward || side)) { footsteps += dt; if (footsteps > (sprint ? 0.30 : 0.43) && sim.player.position.y < 0.05) { audio.footstep(sprint); footsteps = 0; } }
      else footsteps = 0;
    }
    renderActors(sim.state.phase === 'paused' ? 0 : dt);
    renderVehicles(sim.state.phase === 'paused' ? 0 : dt);
    renderLoot(sim.state.elapsed);
    if (islandRenderer && sim.state.phase !== 'menu') {
      const p = sim.player.position;
      islandRenderer.update(p.x, p.z, 3, dt);
      // Keep the shadow frustum centred on the player, 150 m back along the sun's direction.
      const sun = sunlight.direction.normalizeToNew();
      sunlight.position.set(p.x - sun.x * 150, p.y - sun.y * 150, p.z - sun.z * 150);
    }
    renderZone(); updateCamera(dt);
    if (sim.state.phase === 'playing' && (triggerPending || shooting && WEAPONS[sim.player.weapon].fireMode === 'auto')) shoot();
    triggerPending = false;
    events(sim.state.phase === 'paused' ? 0 : dt);
    if (sim.state.phase !== lastPhase) {
      if (sim.state.phase === 'won' || sim.state.phase === 'lost') releaseInput();
      lastPhase = sim.state.phase;
    }
    const loot = sim.lootInReach;
    const nearbyCar = sim.vehicleInReach;
    const hint = sim.player.vehicleId ? `${touchDevice ? 'Chạm Nhặt' : '[F]'} để xuống xe` : loot ? `${touchDevice ? '' : '[E] '}Nhặt ${lootLabel(loot.kind)}` : nearbyCar ? `${touchDevice ? '' : '[F] '}Lên xe` : sim.player.healing > 0 ? 'Đang hồi máu…' : sim.player.reloading > 0 ? 'Đang nạp đạn…' : !touchDevice && document.pointerLockElement !== canvas && sim.state.phase === 'playing' ? 'Nhấp vào màn hình để điều khiển chuột' : '';
    if (!touchDevice || now - lastHudTime >= 90 || hudPhase !== sim.state.phase || hudWeapon !== sim.player.weapon) {
      ui.update(sim.state, sim.world, hint); lastHudTime = now; hudPhase = sim.state.phase; hudWeapon = sim.player.weapon;
    }
    ui.setAim(aiming && sim.state.phase === 'playing', sim.player.weapon);
    mobile?.setEnabled(sim.state.phase === 'playing' && !ui.touchOverlayOpen);
    const drivenCar = sim.player.vehicleId ? sim.state.vehicles.find(v => v.id === sim.player.vehicleId) : undefined;
    ui.setVehicle(drivenCar ? { speed: drivenCar.speed, health: drivenCar.health / 300 } : null);
    mobile?.update({ aiming, canPickup: !!loot || !!nearbyCar || !!drivenCar, reloading: sim.player.reloading > 0, healing: sim.player.healing > 0 });
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
