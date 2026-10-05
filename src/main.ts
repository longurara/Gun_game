import './style.css';
import './theme.css';
import './mobile-hud.css';
import './desktop-hud.css';
import './air-hud.css';
import './stance-hud.css';
import './lobby.css';
import './social.css';
import './inventory.css';
import { InventoryPreview } from './inventory-preview';
import { Engine } from '@babylonjs/core/Engines/engine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
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
import { DROP, remainingGlide } from './game/drop';
import { GameUI } from './ui';
import { GameAudio } from './audio';
import { createWeaponModel } from './weapon-models';
import { Soldier } from './soldier';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { WEAPONS, isArmorKind, isSidearm, isWeaponKind, lootLabel, parseArmor, slotOrder, ammoTypeOf } from './game/weapons';
import type { Actor, GameSettings, GyroMode, Loot, LootKind, PlayerInput, Vehicle, WeaponType } from './types';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder.js';
import { isTouchDevice, renderBudgetFor, touchLookSensitivity } from './device';
import { MobileControls } from './mobile-controls';
import { Gyro, GYRO_STATUS_TEXT, gyroSupport } from './gyro';
import { STANCE } from './game/stance';
import { lookScale, pickAssist, pullStep } from './aim-assist';
import type { AssistTarget } from './aim-assist';
import { ReplayRecorder, sampleReplay, shotsBetween } from './replay';
import { LobbyView } from './lobby-ui';
import { createClient } from '@supabase/supabase-js';
import { SupabaseSocialApi } from './social/api';
import { SocialStore } from './social/store';
import { AccountView } from './social-ui';
import { SUPABASE } from './net/config';
import { normalizeRoomCode } from './net/lobby';
import { MultiplayerController } from './net/controller';
import type { MatchStart } from './net/controller';
import { ClientSession, HostSession, matchOptions } from './net/session';
import type { Transport } from './net/transport';
import type { ReplayActor } from './replay';
import { IslandRenderer } from './island-renderer';
import { GENERATED_TEXTURES, useGeneratedAlbedo } from './generated-textures';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration.js';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline.js';
import '@babylonjs/core/Rendering/depthRendererSceneComponent.js';

const MeshBuilder = { CreateBox, CreateGround, CreateCylinder, CreateSphere, CreateTorus, CreateLines };

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas')!;
canvas.tabIndex = -1;
const touchDevice = isTouchDevice();
document.documentElement.dataset.input = touchDevice ? 'touch' : 'mouse';
const sim = new GameSimulation({ botCount: 5, difficulty: 'normal' });
const audio = new GameAudio();
// Browsers only start audio after a gesture: the first click, touch or key press anywhere lets the menu theme begin.
for (const type of ['pointerdown', 'keydown'] as const) window.addEventListener(type, () => { void audio.unlock(); }, { once: true, capture: true });
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
/** Jump / open-canopy requested from the keyboard's F and E keys; consumed by the next simulation step. */
let pendingJump = false;
let lastAirMode: string | null = '', lastAirHud = -Infinity, shadowsAllowed = true;
let planeModel: TransformNode | null = null;
/** Steer the canopy toward the map flag by itself. */
let autoGlide = false;
/** The last seconds of the match, kept so the death can be replayed. */
const recorder = new ReplayRecorder();
let replay: { time: number; killerId: string; saved: Map<string, { x: number; y: number; z: number; yaw: number; stance: Actor['stance']; weapon: string; alive: boolean }> } | null = null;
const lastSoundCue = new Map<string, number>();
/** An online match: the host runs the game, a client mirrors it. Null in single player. */
let net: { role: 'host' | 'client'; host?: HostSession; client?: ClientSession; transport: Transport } | null = null;
let mpMenuOpen = false, mpSpectating = false;
/** The result of this match has been sent to the player's account (once per match). */
let resultReported = false;
let lastInput: PlayerInput = { moveX: 0, moveZ: 0, sprint: false, jump: false };
const nameplates = new Map<string, HTMLDivElement>();
/** The camera's eye height as the stance changes. */
let eyeHeight = STANCE.stand.eye;
let assistTargets: AssistTarget[] = [], lastAssistScan = -Infinity;
const frameTimes: number[] = [];
let lastPerfAt = -Infinity;
/** After dying: the actor being watched, and whoever killed the player (watched first). */
let spectateId: string | null = null, lastKillerId: string | null = null;
const airdropModels = new Map<string, { root: TransformNode; chute: TransformNode; flare: Mesh }>();
let flagBeam: Mesh | null = null, flagBeamAt: { x: number; z: number } | null = null;
let gyroOnMode: GyroMode = 'aim';
const pitchMin = () => sim.player.air ? -1.4 : -0.7;

let inventoryPreview: InventoryPreview | null = null;
const ui = new GameUI({
  onStart: (next) => { settings = next; applySettings(); syncGyro(); start(); },
  onResume: () => { void audio.unlock(); if (net) { mpMenuOpen = false; ui.setMpMenu(false); } else sim.setPaused(false); lockPointer(); clock = performance.now(); },
  onRestart: () => { if (net) leaveMatch(); else start(); },
  onMenu: () => { if (net) { leaveMatch(); return; } sim.returnToMenu({ map: 'arena', botCount: 5 }); configureWorld(); releaseInput(); audio.pause(); },
  onMultiplayer: openLobby,
  onAccount: () => accountView.show(true),
  onSpectate: startSpectating,
  onReplay: startReplay,
  onReplayStop: stopReplay,
  onSpectateExit: () => { if (net) leaveMatch(); else sim.endSpectating(); },
  onSettings: (next) => { settings = next; if (settings.gyro !== 'off') gyroOnMode = settings.gyro; applySettings(); syncGyro(); },
  onSelectWeapon: selectWeapon,
  onInventoryPickup: pickupInventory,
  onInventoryDrop: dropInventory,
  onInventoryHeal: () => { if (doHeal()) { void audio.unlock(); audio.heal(); } },
  onInventoryChange: open => {
    inventoryPreview?.setVisible(open);
    if (open) {
      releaseInput(); pendingJump = false;
      lastInput = { moveX: 0, moveZ: 0, sprint: false, jump: false };
      mobile?.setEnabled(false);
      ui.updateInventory(sim.player, sim.nearbyLoot(), !!net);
    } else if (sim.state.phase === 'playing' && sim.player.alive && !ui.mapOpen && !mpMenuOpen && !sim.state.spectating) lockPointer();
  },
  onTouchOverlayChange: (open) => { if (open) releaseInput(); },
});
inventoryPreview = new InventoryPreview(ui.inventory.canvas);
settings = ui.settings;
const gyro = new Gyro(onGyroLook, status => ui.setGyroStatus(GYRO_STATUS_TEXT[status]));
{
  const support = gyroSupport();
  ui.setGyroStatus(support !== 'ok' ? GYRO_STATUS_TEXT[support] : settings.gyro === 'off' ? GYRO_STATUS_TEXT.off : 'Sẽ bật khi bạn bắt đầu trận.');
}
if (touchDevice) {
  mobile = new MobileControls(canvas, {
    onLook: (dx, dy) => {
      if (sim.state.phase !== 'playing' || gameplayInputBlocked()) return;
      const sensitivity = touchLookSensitivity(canvas.clientWidth, canvas.clientHeight, settings.sensitivity, aiming ? WEAPONS[sim.player.weapon].zoom : null);
      const scale = lookScale(pickAssist(yaw, pitch, assistTargets, assistLevel()), assistLevel());
      lookBy(dx * sensitivity * scale, -dy * sensitivity * scale);
    },
    onFire: (pressed) => {
      shooting = pressed && sim.state.phase === 'playing' && !gameplayInputBlocked();
      if (shooting) { void audio.unlock(); triggerPending = true; }
    },
    onAimToggle: () => { if (sim.state.phase === 'playing' && !gameplayInputBlocked()) { void audio.unlock(); if (aiming) aiming = false; else beginAim(); } },
    onJump: (pressed) => {
      mobileJump = pressed && !gameplayInputBlocked();
      // At 30 FPS a tap can end before the next frame; preserve its airborne press edge.
      if (mobileJump && sim.airborne) pendingJump = true;
    },
    onReload: () => { if (doReload()) { void audio.unlock(); audio.reload(); } },
    onInteract: () => { if (!doInteract()) useVehicle(); },
    onHeal: () => { if (doHeal()) { void audio.unlock(); audio.heal(); } },
    onCycleWeapon: () => cycleWeapon(1),
    onPause: pause,
    onCrouch: () => toggleStance('crouch'),
    onProne: () => toggleStance('prone'),
    onGyroToggle: () => { void audio.unlock(); ui.setGyro(settings.gyro === 'off' ? gyroOnMode : 'off'); },
    onAutoGlide: toggleAutoGlide,
  });
}

/** Turn the sensor on or off to match the setting. Runs inside a tap, which iOS needs before it will ask for permission. */
function syncGyro() {
  if (!touchDevice) return;
  if (settings.gyro === 'off') gyro.disable();
  else void gyro.enable();
}

/** Show where a nearby gunshot by somebody else came from (if the setting is on), at most a few times a second per shooter. */
function cueGunshot(shooterId: string, from: { x: number; z: number }) {
  if (!settings.soundIndicator || shooterId === sim.localId || sim.state.phase !== 'playing' || !sim.player.alive || sim.player.air) return;
  const now = performance.now();
  if (now - (lastSoundCue.get(shooterId) ?? -Infinity) < 450) return;
  const at = sim.player.position;
  const dx = from.x - at.x, dz = from.z - at.z, distance = Math.hypot(dx, dz);
  if (distance < 8 || distance > 120) return;
  lastSoundCue.set(shooterId, now);
  ui.showSoundFrom(Math.atan2(dx, dz) - yaw, 1 - distance / 140);
}

/** Turn the camera by hand (mouse, swipe, gyro or aim assist). */
function lookBy(dYaw: number, dPitch: number) {
  yaw += dYaw;
  pitch = Math.max(pitchMin(), Math.min(0.8, pitch + dPitch));
  lastLookAt = performance.now();
}

/** Aim assist applies on touch screens only. */
const assistLevel = () => touchDevice ? settings.aimAssist : 'off';

/** Enemies near the line of sight, as the angles from the camera to their bodies; refreshed a few times a second. */
function scanAssist(now: number) {
  if (now - lastAssistScan < 100) return;
  lastAssistScan = now;
  assistTargets = [];
  const player = sim.player;
  if (assistLevel() === 'off' || sim.state.phase !== 'playing' || !player.alive || player.air || player.vehicleId) return;
  const from = camera.position;
  for (const actor of sim.state.actors) {
    if (actor.isPlayer || !actor.alive || actor.air || actor.vehicleId) continue;
    const dx = actor.position.x - from.x, dz = actor.position.z - from.z, distance = Math.hypot(dx, dz);
    if (distance > 150 || distance < 2) continue;
    const targetYaw = Math.atan2(dx, dz);
    if (Math.abs(Math.atan2(Math.sin(targetYaw - yaw), Math.cos(targetYaw - yaw))) > 0.4) continue;
    if (!sim.canPlayerSee(actor)) continue;
    assistTargets.push({ id: actor.id, yaw: targetYaw, pitch: Math.atan2(actor.position.y + STANCE[actor.stance ?? 'stand'].aimY - from.y, distance), distance });
  }
}

/** Flip between standing and a lower stance (pressing the same stance again stands up). */
function toggleStance(stance: 'crouch' | 'prone') {
  if (sim.state.phase !== 'playing') return;
  const next = sim.player.stance === stance ? 'stand' : stance;
  if (!sim.setStance(next)) { if (next === 'stand') ui.notify('Không đủ chỗ để đứng lên.'); return; }
  net?.client?.queueCommand('stance', next);
  aiming = false;
  ui.tip('stance', touchDevice ? 'Nút Ngồi / Nằm: thấp hơn thì chậm hơn nhưng ngắm chính xác, giật ít và khó bị phát hiện. Nhảy hoặc chạy để đứng lên.' : 'Phím C ngồi, Z nằm (bấm lại để đứng). Thấp hơn thì chậm hơn nhưng ngắm chính xác, giật ít và khó bị phát hiện.');
}

/** Phone rotation (radians) becomes camera rotation, scaled down while zoomed so a scope stays steady. */
function onGyroLook(dYaw: number, dPitch: number) {
  if (sim.state.phase !== 'playing' || gameplayInputBlocked() || settings.gyro === 'off') return;
  // "Khi ngắm": only while looking down the sights or holding the trigger, so walking is never twitchy.
  if (settings.gyro === 'aim' && !aiming && !shooting) return;
  const zoom = aiming ? WEAPONS[sim.player.weapon].zoom : 1;
  const scale = settings.gyroSensitivity / Math.sqrt(zoom);
  const friction = lookScale(pickAssist(yaw, pitch, assistTargets, assistLevel()), assistLevel());
  lookBy(dYaw * scale * friction, dPitch * scale * friction * (settings.gyroInvertY ? -1 : 1));
}

/** Actions on the local player. Online, a client applies them to its own copy for instant feedback and asks the host; a host acts directly. */
function doReload(): boolean {
  const ok = sim.reload();
  if (ok) net?.client?.queueCommand('reload');
  return ok;
}
function doHeal(): boolean {
  const ok = sim.heal();
  if (ok) net?.client?.queueCommand('heal');
  return ok;
}
function pickupInventory(id: string): void {
  if (!ui.inventoryOpen || !sim.nearbyLoot().some(item => item.id === id)) return;
  if (net?.client) net.client.queueCommand('inventory-pickup', id);
  else sim.pickupLoot(id);
}
function dropInventory(kind: LootKind, amount: number): void {
  if (!ui.inventoryOpen || sim.state.phase !== 'playing' || !sim.player.alive || sim.player.air || sim.player.vehicleId) return;
  if (net?.client) net.client.queueCommand('inventory-drop', { kind, amount });
  else sim.dropItem(kind, amount);
}
function doInteract(): boolean {
  if (net?.client) {
    // The host decides who gets the item; the pickup arrives in the next snapshot.
    if (!sim.lootInReach) return false;
    net.client.queueCommand('interact');
    return true;
  }
  return sim.interact();
}
function doVehicle(): boolean {
  if (net?.client) {
    if (!sim.player.vehicleId && !sim.vehicleInReach) return false;
    net.client.queueCommand('vehicle');
    return true;
  }
  return sim.useVehicle();
}

// ---- Online matches -----------------------------------------------------------------------------------------------

const uiRoot = document.getElementById('ui-root')!;
const plateLayer = document.createElement('div');
plateLayer.id = 'nameplates';
uiRoot.appendChild(plateLayer);
const lobbyView = new LobbyView(uiRoot, {
  onCreate: name => mp.create(name),
  onJoin: (code, name) => mp.join(code, name),
  onStart: () => mp.start(),
  onLeave: () => mp.leave(),
  onClose: () => lobbyView.show(false),
  onInvite: friendId => { const person = social.friends.find(edge => edge.person.id === friendId)?.person; if (person) social.invite(person); },
});
const social = new SocialStore(new SupabaseSocialApi(SUPABASE, createClient as unknown as ConstructorParameters<typeof SupabaseSocialApi>[1]));
const mp = new MultiplayerController(lobbyView, {
  config: () => ({ map: settings.map, botCount: settings.botCount, difficulty: settings.difficulty }),
  begin: beginMultiplayer,
  identity: () => social.signedIn && social.displayName ? { name: social.displayName, uid: social.state.account!.id } : null,
  friends: () => ({
    friendIds: social.friends.map(edge => edge.person.id),
    invitable: social.onlineFriends().filter(friend => !friend.info.room).map(friend => ({ id: friend.edge.person.id, name: friend.edge.person.username })),
  }),
  onRoom: code => social.setRoom(code),
});
const accountView = new AccountView(uiRoot, social, {
  onJoinRoom: room => { lobbyView.show(true); mp.join(room, lobbyView.name()); },
});
social.onChange(() => {
  const profile = social.state.profile;
  ui.setAccount(social.signedIn ? { name: social.displayName ?? '', wins: profile?.wins ?? 0, kills: profile?.kills ?? 0, matches: profile?.matches ?? 0 } : null);
  lobbyView.setLockedName(social.signedIn ? social.displayName : null);
  mp.refresh();
});
void social.start();
// Coming back from a confirmation e-mail whose link failed: show why in the account window and clean the address.
if (social.linkFailed(location.hash)) {
  history.replaceState(null, '', location.pathname + location.search);
  accountView.show(true);
}

/** Send the result of the match that just ended to the signed-in player's record (once per match). */
function reportResult(won: boolean) {
  if (resultReported) return;
  resultReported = true;
  void social.reportMatch(won, sim.state.kills, won ? 1 : sim.state.playerRank ?? sim.player.rank ?? sim.state.actors.filter(actor => actor.alive).length + 1);
}

function openLobby() {
  void audio.unlock();
  lobbyView.show(true);
  mp.refreshConfig();
}

/** The lobby is done: build the same match on every machine (the host runs it, clients mirror it). */
function beginMultiplayer(info: MatchStart) {
  void audio.unlock();
  audio.pause();
  releaseInput();
  sim.start(matchOptions(info.setup, info.me, info.role === 'client'));
  audio.localId = sim.localId;
  net = info.role === 'host'
    ? { role: 'host', host: new HostSession(sim, info.transport, info.setup), transport: info.transport }
    : { role: 'client', client: new ClientSession(sim, info.transport, info.hostId), transport: info.transport };
  mpMenuOpen = false; mpSpectating = false;
  ui.setMultiplayer(true); ui.setMpMenu(false);
  lobbyView.show(false);
  configureWorld();
  stopReplay(); recorder.clear();
  resultReported = false; social.newMatch();
  pendingJump = false; lastAirMode = ''; autoGlide = false; ui.setWaypoint(null); spectateId = null; lastKillerId = null;
  yaw = sim.state.plane?.yaw ?? 0; pitch = sim.state.plane ? -0.3 : -0.12; recoil = 0; snapCamera = true; footsteps = 0;
  for (const effect of effects) effect.mesh.dispose();
  effects.length = 0;
  for (const model of models.values()) model.root.setEnabled(false);
  lockPointer();
  clock = performance.now();
  ui.notify(sim.state.plane ? 'Trận online: máy bay đang bay qua đảo. Chọn điểm đáp rồi nhảy!' : 'Trận online bắt đầu. Người sống cuối cùng chiến thắng!');
}

/** Leave an online match (the others carry on) and go back to the main screen. */
function leaveMatch() {
  const current = net;
  net = null;
  try { current?.host?.close(); current?.client?.leave(); } catch { /* the connection may already be gone */ }
  mpMenuOpen = false; mpSpectating = false;
  ui.setMultiplayer(false); ui.setMpMenu(false);
  for (const label of nameplates.values()) label.remove();
  nameplates.clear();
  sim.returnToMenu({ map: 'arena', botCount: 5, humans: 1, localId: '', names: [], remote: false });
  audio.localId = sim.localId;
  configureWorld();
  releaseInput();
  audio.pause();
}

/** Floating names over the other players, projected from the 3D world onto the page. */
function updateNameplates() {
  const show = !!net && sim.state.phase === 'playing' && !spectating() && !replay;
  const people = show ? sim.humans.filter(human => human.id !== sim.localId && human.alive && human.air?.mode !== 'plane') : [];
  const wanted = new Set(people.map(person => person.id));
  for (const [id, label] of nameplates) if (!wanted.has(id)) { label.remove(); nameplates.delete(id); }
  if (!people.length) return;
  const width = engine.getRenderWidth(), height = engine.getRenderHeight();
  const toCss = { x: canvas.clientWidth / width, y: canvas.clientHeight / height };
  const view = scene.getTransformMatrix(), viewport = camera.viewport.toGlobal(width, height);
  for (const person of people) {
    let label = nameplates.get(person.id);
    if (!label) { label = document.createElement('div'); label.className = 'nameplate'; label.textContent = person.name; plateLayer.appendChild(label); nameplates.set(person.id, label); }
    const distance = Vector3.Distance(camera.position, new Vector3(person.position.x, person.position.y, person.position.z));
    const above = (person.stance === 'prone' ? 0.9 : person.stance === 'crouch' ? 1.7 : 2.25) + (person.air ? 1.5 : 0);
    const spot = Vector3.Project(new Vector3(person.position.x, person.position.y + above, person.position.z), Matrix.IdentityReadOnly, view, viewport);
    const visible = spot.z > 0 && spot.z < 1 && distance < 170 && spot.x > -50 && spot.x < width + 50;
    label.style.display = visible ? 'block' : 'none';
    if (visible) {
      label.style.transform = `translate(${(spot.x * toCss.x).toFixed(0)}px, ${(spot.y * toCss.y).toFixed(0)}px) translate(-50%, -100%)`;
      label.style.opacity = String(Math.max(0.35, 1 - distance / 220));
    }
  }
}

function start() {
  void audio.unlock();
  audio.pause();
  releaseInput();
  sim.start({ botCount: settings.botCount, difficulty: settings.difficulty, seed: Date.now(), map: settings.map, drop: settings.map !== 'arena', humans: 1, localId: '', names: [], remote: false });
  audio.localId = sim.localId;
  configureWorld();
  stopReplay(); recorder.clear();
  resultReported = false; social.newMatch();
  pendingJump = false; lastAirMode = ''; autoGlide = false; ui.setWaypoint(null); spectateId = null; lastKillerId = null;
  yaw = sim.state.plane?.yaw ?? 0; pitch = sim.state.plane ? -0.3 : -0.12; recoil = 0; snapCamera = true; footsteps = 0;
  for (const effect of effects) effect.mesh.dispose();
  effects.length = 0;
  for (const model of models.values()) model.root.setEnabled(false);
  lockPointer();
  clock = performance.now();
  const mapId: string = sim.world.id;
  if (sim.state.plane) ui.notify('Máy bay đang bay qua đảo. Mở bản đồ, chọn điểm đáp rồi nhảy!');
  else ui.notify(mapId === 'island' ? 'Bạn đã đáp xuống đảo. Tìm vũ khí và vào vùng an toàn!' : mapId === 'valley' ? 'Thung lũng đông đúc. Lục nhà tìm súng, bo thu rất nhanh!' : 'Tìm trang bị. Giữ vùng an toàn. Sống sót cuối cùng.');
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
    islandRenderer.update(focusPosition().x, focusPosition().z, 100000);
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

function gameplayInputBlocked(): boolean {
  return mpMenuOpen || ui.mapOpen || ui.touchOverlayOpen;
}

function lockPointer() {
  if (gameplayInputBlocked()) return;
  // A joined match starts without a local click: leave hidden lobby inputs/buttons behind.
  canvas.focus({ preventScroll: true });
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
  mobileJump = false; pendingJump = false; mobile?.reset();
  if (document.pointerLockElement === canvas) document.exitPointerLock();
}

function pause() {
  ui.toggleMap(false);
  if (sim.state.phase !== 'playing') return;
  // Online the world cannot be paused (other people are in it): the menu just opens over the running game.
  if (net) { if (!mpMenuOpen) { mpMenuOpen = true; releaseInput(); ui.setMpMenu(true); } return; }
  sim.setPaused(true); ui.toggleInventory(false); releaseInput(); audio.pause();
}

function applySettings() {
  audio.setVolume(settings.volume);
  const budget = renderBudgetFor(settings.quality, touchDevice, canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio);
  if (engine) engine.setHardwareScalingLevel(budget.scaling);
  shadowsAllowed = budget.shadows;
  if (scene) scene.shadowsEnabled = budget.shadows && !(sim.player.air && sim.heightAboveGround(sim.player) > 150);
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
  soldier: Soldier; root: TransformNode; last: Vector3; stride: number; moving: number; chute?: TransformNode; lastStep?: number; crouch: number; prone: number;
}

/** A four-engined transport that crosses the island at the start of a match: round fuselage, high wing, blinking lights. */
let planeLights: Mesh[] = [];
function createPlaneModel(): TransformNode {
  const root = new TransformNode('transport-plane', scene);
  const hull = material('plane-hull', '#cfd5d3');
  const belly = material('plane-belly', '#9aa5a8');
  const dark = material('plane-dark', '#33424c');
  const accent = material('plane-accent', '#e0903c');
  const parts: Mesh[] = [];
  const cylinder = (name: string, options: { diameterTop?: number; diameterBottom?: number; diameter?: number; height: number }, mat: StandardMaterial, position: Vector3, rotationX = 0) => {
    const mesh = MeshBuilder.CreateCylinder(name, { tessellation: 14, ...options }, scene);
    mesh.rotation.x = rotationX; mesh.position.copyFrom(position); mesh.material = mat; mesh.parent = root;
    parts.push(mesh);
    return mesh;
  };
  cylinder('plane-fuselage', { diameter: 3.8, height: 24 }, hull, new Vector3(0, 0, 0), Math.PI / 2);
  cylinder('plane-nose', { diameterTop: 0.5, diameterBottom: 3.8, height: 6 }, hull, new Vector3(0, -0.1, 15), Math.PI / 2);
  cylinder('plane-tail-cone', { diameterTop: 0.9, diameterBottom: 3.8, height: 8 }, hull, new Vector3(0, 0.4, -16), -Math.PI / 2);
  parts.push(box('plane-belly', 2.6, 0.5, 18, belly, new Vector3(0, -1.75, -1), root));
  parts.push(box('plane-cockpit', 2.5, 0.8, 2.4, dark, new Vector3(0, 0.85, 14), root));
  parts.push(box('plane-windows', 3.9, 0.45, 10, dark, new Vector3(0, 0.55, 3), root));
  parts.push(box('plane-stripe', 3.95, 0.35, 16, accent, new Vector3(0, -0.45, 1), root));
  parts.push(box('plane-wing', 34, 0.5, 5.8, hull, new Vector3(0, 1.1, 1.5), root));
  parts.push(box('plane-wing-edge', 34.1, 0.52, 0.9, accent, new Vector3(0, 1.1, -1.1), root));
  parts.push(box('plane-tailplane', 11, 0.4, 3.2, hull, new Vector3(0, 2.4, -17), root));
  parts.push(box('plane-fin', 0.5, 5.5, 4.5, accent, new Vector3(0, 4.2, -16.5), root));
  parts.push(box('plane-ramp', 3, 0.3, 4.5, dark, new Vector3(0, -1.2, -17.5), root));
  for (const x of [-12, -6, 6, 12]) {
    cylinder('plane-engine', { diameter: 1.6, height: 3.6 }, dark, new Vector3(x, 0.4, 3.8), Math.PI / 2);
    cylinder('plane-prop', { diameter: 3.4, height: 0.06 }, material('plane-prop', '#1c2328'), new Vector3(x, 0.4, 5.8), Math.PI / 2).visibility = 0.55;
  }
  // Red left, green right, and a white strobe on the fin.
  const light = (name: string, color: string, position: Vector3) => {
    const lamp = MeshBuilder.CreateSphere(name, { diameter: 0.9, segments: 6 }, scene);
    const glow = material(`plane-light-${name}`, color, 1);
    glow.disableLighting = true;
    lamp.material = glow; lamp.position.copyFrom(position); lamp.parent = root; parts.push(lamp);
    return lamp;
  };
  planeLights = [light('red', '#ff3b30', new Vector3(-17, 1.2, 1.5)), light('green', '#34c759', new Vector3(17, 1.2, 1.5)), light('strobe', '#ffffff', new Vector3(0, 7.2, -16.5))];
  for (const mesh of parts) { mesh.isPickable = false; mesh.receiveShadows = false; }
  return root;
}

const CHUTE_COLORS = ['#d6533a', '#e0b13a', '#3f7fb5', '#6a9a52', '#d9d9cf', '#9a4fa0'];

/** A round canopy over the soldier's head, joined to the shoulders by a few lines. */
function createChute(parent: TransformNode, id: string): TransformNode {
  const node = new TransformNode(`chute-${id}`, scene);
  node.parent = parent;
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const colour = Color3.FromHexString(CHUTE_COLORS[hash % CHUTE_COLORS.length]);
  const canopy = material('canopy', '#ffffff');
  canopy.backFaceCulling = false;
  const dome = MeshBuilder.CreateSphere('chute-dome', { diameter: 5.2, segments: 12, slice: 0.5 }, scene);
  // Alternating gores: the pilot's colour and off-white, painted as vertex colours so every canopy shares one material.
  const positions = dome.getVerticesData(VertexBuffer.PositionKind)!;
  const colours: number[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    const gore = Math.floor((Math.atan2(positions[i + 2], positions[i]) + Math.PI) / (Math.PI * 2) * 12) % 2;
    colours.push(gore ? 0.93 : colour.r, gore ? 0.92 : colour.g, gore ? 0.86 : colour.b, 1);
  }
  dome.setVerticesData(VertexBuffer.ColorKind, colours);
  dome.material = canopy; dome.parent = node; dome.scaling.y = 0.62; dome.position.y = 4.6; dome.isPickable = false;
  const points: Vector3[] = [];
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2;
    points.push(new Vector3(0, 1.5, 0), new Vector3(Math.cos(a) * 2.5, 4.6, Math.sin(a) * 2.5));
  }
  const lines = MeshBuilder.CreateLines('chute-lines', { points }, scene);
  lines.color = new Color3(0.84, 0.85, 0.8); lines.parent = node; lines.isPickable = false;
  return node;
}

function createCharacter(actor: Actor): Character {
  const soldier = new Soldier(scene, actor.id, actor.isPlayer && actor.id === sim.localId, shadows, actor.isPlayer && actor.id !== sim.localId);
  soldier.setWeapon(actor.weapon);
  return { soldier, root: soldier.root, last: new Vector3(), stride: 0, moving: 0, crouch: 0, prone: 0 };
}

function renderActors(dt: number) {
  const island = sim.world.id !== 'arena';
  const focus = focusPosition();
  const time = performance.now() * 0.001;
  for (const actor of sim.state.actors) {
    let model = models.get(actor.id);
    // Riders of the plane are inside it; nobody is drawn there.
    if (actor.air?.mode === 'plane') { model?.root.setEnabled(false); continue; }
    if (actor.air && !actor.isPlayer && Math.hypot(actor.position.x - focus.x, actor.position.y - focus.y, actor.position.z - focus.z) > 300) { model?.root.setEnabled(false); continue; }
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
    model.moving += ((actor.alive && !actor.air ? Math.min(speed, 8) : 0) - model.moving) * Math.min(1, dt * 12);
    model.stride += dt * model.moving * 2.2;
    // Each footfall of a nearby soldier is heard, placed left or right of the listener.
    const footfall = Math.floor(model.stride / Math.PI);
    if (actor.id !== sim.localId && dt > 0 && actor.alive && !actor.air && !actor.vehicleId && model.moving > 1.5 && model.lastStep !== undefined && footfall !== model.lastStep) audio.footstepOther(actor.position, focus, model.moving > 5);
    model.lastStep = footfall;
    model.root.position.copyFrom(pos);
    model.root.rotation.set(0, actor.yaw, actor.alive ? 0 : Math.PI / 2);
    if (!actor.alive) model.root.position.y = actor.position.y + 0.32;
    // Crouch lowers the body (the legs fold); lying down tips it forward onto the ground, head ahead.
    const blendTo = (current: number, goal: number) => current + (goal - current) * Math.min(1, dt * 10);
    model.crouch = blendTo(model.crouch, actor.alive && actor.stance === 'crouch' ? 1 : 0);
    model.prone = blendTo(model.prone, actor.alive && actor.stance === 'prone' ? 1 : 0);
    if (model.crouch > 0.001) model.root.position.y -= 0.477 * model.crouch - Math.abs(Math.sin(model.stride)) * 0.035 * model.crouch * Math.min(1, model.moving / 2);
    if (model.prone > 0.001) {
      model.root.rotation.x = (Math.PI / 2 - 0.12) * model.prone;
      model.root.position.x -= Math.sin(actor.yaw) * 0.85 * model.prone;
      model.root.position.z -= Math.cos(actor.yaw) * 0.85 * model.prone;
      model.root.position.y += 0.14 * model.prone;
      // Crawling: the body rocks from side to side with each pull of an arm.
      if (actor.alive) model.root.rotation.z = Math.sin(model.stride) * 0.07 * model.prone * Math.min(1, model.moving / 1.2);
    }
    if (actor.air?.mode === 'freefall') {
      // Belly down, arms and legs trailing: body laid flat about its middle.
      model.root.rotation.set(Math.PI / 2 - 0.15, actor.yaw, 0);
      model.root.position.set(pos.x - Math.sin(actor.yaw) * 0.85, pos.y + 0.05, pos.z - Math.cos(actor.yaw) * 0.85);
    }
    const chuteOpen = actor.air?.mode === 'chute';
    if (chuteOpen && !model.chute) model.chute = createChute(model.root, actor.id);
    model.chute?.setEnabled(chuteOpen);
    model.soldier.setWeapon(actor.weapon);
    model.soldier.setGear(actor.helmet, actor.vest);
    const showcase = sim.state.phase === 'menu' && actor.isPlayer;
    if (showcase) {
      // Lobby display: turned toward the camera, breathing, weapon held low.
      model.root.rotation.set(0, Math.PI + 0.55 + Math.sin(time * 0.5) * 0.1, 0);
      model.root.position.y = actor.position.y + Math.sin(time * 1.6) * 0.012;
    }
    model.soldier.pose(dt, { moving: showcase ? 0 : model.moving, stride: model.stride, alive: actor.alive, reloading: actor.reloading > 0, healing: actor.healing > 0, time, showcase, crouch: model.crouch, prone: model.prone });
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
  const focus = focusPosition();
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
    const high = !!sim.player.air && sim.heightAboveGround(sim.player) > 150;
    const range = !playing || high ? 0 : island ? 95 : touchDevice ? 75 : Infinity;
    const focus = focusPosition();
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

const spectating = () => !sim.player.alive && (!!sim.state.spectating || (!!net && sim.state.phase === 'playing'));

/** Alive opponents in a stable order, for cycling through who to watch. */
function spectateCandidates(): Actor[] {
  if (!net) return sim.state.actors.filter(actor => !actor.isPlayer && actor.alive);
  // Online only people and the bots around them are sent to every machine, so those are the ones worth watching.
  const people = sim.humans.filter(human => human.alive && human.id !== sim.localId);
  return sim.state.actors.filter(actor => actor.id !== sim.localId && actor.alive && !actor.air
    && (actor.isPlayer || people.some(person => Math.hypot(person.position.x - actor.position.x, person.position.z - actor.position.z) < 300)));
}

function spectateTarget(): Actor | null {
  const list = spectateCandidates();
  let target = list.find(actor => actor.id === spectateId);
  if (!target) {
    // The one being watched died: stay with whoever is closest to where they were.
    const from = (spectateId ? sim.state.actors.find(actor => actor.id === spectateId)?.position : null) ?? sim.player.position;
    target = list.reduce<Actor | undefined>((best, actor) => !best || Math.hypot(actor.position.x - from.x, actor.position.z - from.z) < Math.hypot(best.position.x - from.x, best.position.z - from.z) ? actor : best, undefined);
    spectateId = target?.id ?? null;
  }
  return target ?? null;
}

function cycleSpectate(direction: number) {
  const list = spectateCandidates();
  if (!list.length) return;
  const index = Math.max(0, list.findIndex(actor => actor.id === spectateId));
  spectateId = list[(index + direction + list.length) % list.length].id;
  snapCamera = true;
}

/** The point the world is built around: the player, or the actor being watched after the player's death. */
function focusPosition() {
  if (spectating()) { const target = spectateTarget(); if (target) return target.position; }
  return sim.player.position;
}

function startSpectating() {
  if (!sim.continueAsSpectator()) return;
  void audio.unlock();
  releaseInput();
  spectateId = lastKillerId && sim.state.actors.some(actor => actor.id === lastKillerId && actor.alive) ? lastKillerId : null;
  spectateTarget();
  snapCamera = true; pitch = -0.15;
  lockPointer();
  clock = performance.now();
}

/** Orbit camera around the watched actor, steered with the mouse or a swipe like the normal camera. */
function spectateCamera(dt: number) {
  const target = spectateTarget();
  if (!target) return;
  const viewPitch = Math.max(pitchMin(), Math.min(0.8, pitch));
  const forward = new Vector3(Math.sin(yaw) * Math.cos(viewPitch), Math.sin(viewPitch), Math.cos(yaw) * Math.cos(viewPitch));
  const car = target.vehicleId ? sim.state.vehicles.find(v => v.id === target.vehicleId) : undefined;
  const pivot = car ? new Vector3(car.position.x, car.position.y + 1.9, car.position.z) : new Vector3(target.position.x, target.position.y + (target.air?.mode === 'freefall' ? 0.9 : 1.5), target.position.z);
  const back = car ? 9 : target.air ? 9 : 5.5;
  const desired = pivot.subtract(forward.scale(back));
  desired.y = Math.max(desired.y, sim.heightAt(desired.x, desired.z) + 1);
  camera.position.copyFrom(snapCamera ? desired : Vector3.Lerp(camera.position, desired, 1 - Math.exp(-dt * 12)));
  snapCamera = false;
  camera.setTarget(camera.position.add(forward.scale(100)));
  camera.fov += (0.92 - camera.fov) * Math.min(1, dt * 8);
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
  if (replay) { replayCamera(dt); return; }
  if (spectating()) { spectateCamera(dt); return; }
  if (actor.air) { airCamera(dt, actor); return; }
  const ridden = actor.vehicleId ? sim.state.vehicles.find(v => v.id === actor.vehicleId) : undefined;
  if (ridden) aiming = false;
  recoil *= Math.exp(-dt * 9);
  const viewPitch = Math.max(-0.7, Math.min(0.8, pitch + recoil));
  const forward = new Vector3(Math.sin(yaw) * Math.cos(viewPitch), Math.sin(viewPitch), Math.cos(yaw) * Math.cos(viewPitch));
  const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  eyeHeight += (STANCE[actor.stance ?? 'stand'].eye - eyeHeight) * Math.min(1, dt * 10);
  const pivot = ridden ? new Vector3(ridden.position.x, ridden.position.y + 1.9, ridden.position.z) : new Vector3(actor.position.x, actor.position.y + eyeHeight, actor.position.z);
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

/** Orbit camera for the drop: wide around the plane, close behind a falling body, a little higher under the canopy. */
function airCamera(dt: number, actor: Actor) {
  const air = actor.air!;
  aiming = false;
  const viewPitch = Math.max(pitchMin(), Math.min(0.8, pitch));
  const forward = new Vector3(Math.sin(yaw) * Math.cos(viewPitch), Math.sin(viewPitch), Math.cos(yaw) * Math.cos(viewPitch));
  const lift = air.mode === 'plane' ? 3 : air.mode === 'chute' ? 2.4 : 0.9;
  const back = air.mode === 'plane' ? 30 : air.mode === 'chute' ? 9 : 7;
  const pivot = new Vector3(actor.position.x, actor.position.y + lift, actor.position.z);
  const desired = pivot.subtract(forward.scale(back));
  desired.y = Math.max(desired.y, sim.heightAt(desired.x, desired.z) + 1.2);
  camera.position.copyFrom(snapCamera ? desired : Vector3.Lerp(camera.position, desired, 1 - Math.exp(-dt * 18)));
  snapCamera = false;
  camera.setTarget(camera.position.add(forward.scale(100)));
  // The view widens with the speed of the fall.
  const targetFov = 0.95 + (air.mode === 'freefall' ? Math.min(0.28, -air.vy / 78 * 0.28) : 0);
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 6);
}

/** Fog and view distance suit the height: thin and long up high, the normal island haze near the ground. */
function applyAirView(mode: string | null) {
  if (sim.world.id === 'arena') return;
  scene.fogDensity = mode === 'plane' || mode === 'freefall' ? 0.0004 : mode === 'chute' ? 0.0009 : 0.0024;
  camera.maxZ = mode ? 2800 : 800;
  islandRenderer?.setHighView(!!mode);
}

/** Supply crates: a wooden box under a canopy while falling, then a column of red smoke until it is emptied. */
function renderAirdrops() {
  const crates = sim.state.airdrops ?? [];
  const live = new Set<string>();
  const time = performance.now() * 0.001;
  for (const drop of crates) {
    live.add(drop.id);
    let model = airdropModels.get(drop.id);
    if (!model) {
      const root = new TransformNode(drop.id, scene);
      const wood = material('airdrop-wood', '#8a6a3c');
      const band = material('airdrop-band', '#d9482f');
      const parts = [box('airdrop-box', 1.5, 1.1, 1.5, wood, new Vector3(0, 0.55, 0), root), box('airdrop-band', 1.56, 0.3, 1.56, band, new Vector3(0, 0.55, 0), root), box('airdrop-lid', 1.6, 0.12, 1.6, band, new Vector3(0, 1.14, 0), root)];
      for (const part of parts) { part.isPickable = false; shadows.addShadowCaster(part); }
      const chute = createChute(root, drop.id);
      const flare = MeshBuilder.CreateCylinder('airdrop-smoke', { diameterTop: 7, diameterBottom: 1.6, height: 140, tessellation: 10, cap: 0 }, scene);
      const smoke = material('airdrop-smoke', '#e0453a', 0.9);
      smoke.alpha = 0.4; smoke.disableLighting = true; smoke.fogEnabled = false; smoke.backFaceCulling = false;
      flare.material = smoke; flare.isPickable = false; flare.parent = root; flare.position.y = 70;
      model = { root, chute, flare };
      airdropModels.set(drop.id, model);
    }
    model.root.position.set(drop.x, drop.y, drop.z);
    model.chute.setEnabled(!drop.landed);
    model.flare.setEnabled(drop.landed && !drop.empty);
    if (drop.landed) model.flare.scaling.x = model.flare.scaling.z = 1 + Math.sin(time * 2 + drop.x) * 0.08;
    else model.root.rotation.y = Math.sin(time * 0.7 + drop.z) * 0.15;
  }
  for (const [id, model] of airdropModels) if (!live.has(id)) { model.root.dispose(false, false); airdropModels.delete(id); }
}

function toggleAutoGlide() {
  const mode = sim.player.air?.mode;
  if (!ui.waypoint || !mode || mode === 'plane') { ui.notify(ui.waypoint ? 'Tự lái dù hoạt động sau khi bạn nhảy.' : 'Đặt cờ đáp trên bản đồ (phím M) trước.'); return; }
  autoGlide = !autoGlide;
  ui.notify(autoGlide ? 'Tự lái dù: bay tới cờ đáp. Giữ Chạy để lao nhanh.' : 'Đã tắt tự lái dù.');
}

/** A tall gold column over the landing flag, readable from the sky and from the ground. */
function renderFlag() {
  const flag = sim.state.phase === 'menu' ? null : ui.waypoint;
  if (!flag) { flagBeam?.setEnabled(false); flagBeamAt = null; return; }
  if (!flagBeam) {
    flagBeam = MeshBuilder.CreateCylinder('landing-flag', { diameter: 3, height: 700, tessellation: 10, cap: 0 }, scene);
    const glow = material('flag-beam', '#ffd24a', 1);
    glow.alpha = 0.32; glow.disableLighting = true; glow.fogEnabled = false; glow.backFaceCulling = false;
    flagBeam.material = glow; flagBeam.isPickable = false;
  }
  flagBeam.setEnabled(true);
  if (!flagBeamAt || flagBeamAt.x !== flag.x || flagBeamAt.z !== flag.z) {
    flagBeamAt = { x: flag.x, z: flag.z };
    flagBeam.position.set(flag.x, sim.heightAt(flag.x, flag.z) + 350, flag.z);
  }
}

function renderPlane() {
  const plane = sim.state.plane;
  if (!plane?.active || sim.state.phase === 'menu') { planeModel?.setEnabled(false); return; }
  planeModel ??= createPlaneModel();
  planeModel.setEnabled(true);
  // Navigation lights: steady red and green, a short white strobe once a second.
  planeLights[2]?.setEnabled(performance.now() % 1000 < 120);
  planeModel.position.set(plane.x, plane.y, plane.z);
  planeModel.rotation.y = plane.yaw;
}

function shoot() {
  const weapon = WEAPONS[sim.player.weapon];
  const ray = camera.getForwardRay(weapon.range);
  const pick = scene.pickWithRay(ray, mesh => {
    if (!mesh.isEnabled() || !mesh.isPickable) return false;
    if (mesh.metadata?.actorId) return mesh.metadata.actorId !== sim.localId && !!sim.state.actors.find(a => a.id === mesh.metadata.actorId)?.alive;
    return !!mesh.metadata?.solid;
  });
  const target = pick?.hit && pick.pickedPoint ? pick.pickedPoint : ray.origin.add(ray.direction.scale(weapon.range));
  if (sim.shootPlayer({ x: target.x, y: target.y, z: target.z }, aiming)) {
    if (net?.client) {
      // The host decides what the shot hits; the gunshot is heard at once on this machine.
      net.client.queueFire({ x: target.x, y: target.y, z: target.z }, aiming);
      audio.handle({ type: 'shot', actorId: sim.localId, weapon: sim.player.weapon, from: { ...sim.player.position }, to: { x: target.x, y: target.y, z: target.z } }, sim.player.position);
    }
    // A short kick of the view that settles by itself; the setting scales it and a lower stance softens it.
    recoil = Math.min(0.13, recoil + weapon.recoil * settings.recoilScale * STANCE[sim.player.stance ?? 'stand'].recoil);
  }
}

/** Get in or out of a car and reset aim state so nothing carries over. */
function useVehicle() {
  if (!doVehicle()) return;
  aiming = false; shooting = false; triggerPending = false; recoil = 0;
  mobile?.cancelFire();
}

function selectWeapon(weapon: WeaponType) {
  if (!sim.player.ownedWeapons.includes(weapon)) return;
  if (sim.switchWeapon(weapon)) {
    net?.client?.queueCommand('switch', weapon);
    aiming = false; shooting = false; triggerPending = false; recoil = 0;
    mobile?.cancelFire();
    ui.notify(`${WEAPONS[weapon].label} · ${WEAPONS[weapon].category}`);
  }
}

function cycleWeapon(direction: number) {
  if (spectating()) { cycleSpectate(direction); return; }
  const owned = slotOrder(sim.player.ownedWeapons);
  if (owned.length < 2) return;
  const index = owned.indexOf(sim.player.weapon);
  selectWeapon(owned[(index + direction + owned.length) % owned.length]);
}

function beginAim() {
  if (WEAPONS[sim.player.weapon].zoom >= 4) {
    const ray = camera.getForwardRay(WEAPONS[sim.player.weapon].range);
    const pick = scene.pickWithRay(ray, mesh => mesh.isEnabled() && !!mesh.metadata && mesh.metadata.actorId !== sim.localId && (!!mesh.metadata.solid || !!sim.state.actors.find(actor => actor.id === mesh.metadata.actorId)?.alive));
    const target = pick?.pickedPoint ?? ray.origin.add(ray.direction.scale(WEAPONS[sim.player.weapon].range));
    const dx = target.x - sim.player.position.x, dz = target.z - sim.player.position.z;
    yaw = Math.atan2(dx, dz);
    pitch = Math.atan2(target.y - sim.player.position.y - 1.52, Math.hypot(dx, dz));
    recoil = 0;
  }
  aiming = true;
}

function spawnTracer(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, shooterId: string) {
  const line = MeshBuilder.CreateLines('tracer', { points: [new Vector3(from.x, from.y, from.z), new Vector3(to.x, to.y, to.z)] }, scene);
  line.color = Color3.FromHexString(shooterId === sim.localId ? '#ffdc9b' : '#dbb785'); line.isPickable = false;
  effects.push({ mesh: line, remaining: 0.065 });
  models.get(shooterId)?.soldier.fire();
}

/** Everybody within 300 m of the player (or of the watched actor): enough to replay the fight that killed them. */
function snapshotActors(): ReplayActor[] {
  const focus = sim.player.position;
  const out: ReplayActor[] = [];
  for (const actor of sim.state.actors) {
    if (!actor.alive || actor.air || Math.hypot(actor.position.x - focus.x, actor.position.z - focus.z) > 300) continue;
    out.push({ id: actor.id, x: actor.position.x, y: actor.position.y, z: actor.position.z, yaw: actor.yaw, stance: actor.stance, weapon: actor.weapon, vehicleId: actor.vehicleId });
  }
  return out;
}

const canReplay = () => !net && sim.state.phase === 'lost' && !sim.state.spectating && recorder.playable(lastKillerId);

/** Replay the last seconds before the player died, from behind the killer, using the same soldiers and a few tracers. */
function startReplay() {
  if (!canReplay() || replay) return;
  const saved = new Map<string, { x: number; y: number; z: number; yaw: number; stance: Actor['stance']; weapon: string; alive: boolean }>();
  for (const actor of sim.state.actors) saved.set(actor.id, { x: actor.position.x, y: actor.position.y, z: actor.position.z, yaw: actor.yaw, stance: actor.stance, weapon: actor.weapon, alive: actor.alive });
  replay = { time: 0, killerId: lastKillerId!, saved };
  const last = recorder.frames[recorder.frames.length - 1].actors.find(actor => actor.id === lastKillerId);
  const killer = sim.state.actors.find(actor => actor.id === lastKillerId);
  ui.setReplay(true, `${killer?.name ?? 'Đối thủ'} · ${last ? WEAPONS[last.weapon]?.label ?? '' : ''}`);
  snapCamera = true;
}

function stopReplay() {
  if (!replay) return;
  for (const actor of sim.state.actors) {
    const before = replay.saved.get(actor.id);
    if (!before) continue;
    actor.position.x = before.x; actor.position.y = before.y; actor.position.z = before.z;
    actor.yaw = before.yaw; actor.stance = before.stance; actor.weapon = before.weapon; actor.alive = before.alive;
  }
  replay = null;
  ui.setReplay(false);
}

/** Put every recorded soldier where it was `replay.time` seconds into the last stretch, and fire the tracers that fell in this step. */
function stepReplay(dt: number) {
  if (!replay) return;
  const previous = replay.time;
  replay.time = Math.min(recorder.duration, replay.time + dt);
  for (const pose of sampleReplay(recorder.frames, replay.time)) {
    const actor = sim.state.actors.find(a => a.id === pose.id);
    if (!actor) continue;
    actor.position.x = pose.x; actor.position.y = pose.y; actor.position.z = pose.z;
    actor.yaw = pose.yaw; actor.stance = pose.stance; actor.weapon = pose.weapon; actor.alive = true;
  }
  for (const shot of shotsBetween(recorder.shots, recorder.frames, previous, replay.time)) spawnTracer(shot.from, shot.to, shot.actorId);
  if (replay.time >= recorder.duration + 1.2) stopReplay();
}

/** Behind the killer, looking toward the victim, so both and the shots between them are in view. */
function replayCamera(dt: number) {
  const killer = sim.state.actors.find(actor => actor.id === replay!.killerId), victim = sim.player;
  if (!killer) return;
  const dx = victim.position.x - killer.position.x, dz = victim.position.z - killer.position.z, length = Math.max(0.1, Math.hypot(dx, dz));
  const back = new Vector3(-dx / length, 0, -dz / length);
  const side = new Vector3(dz / length, 0, -dx / length);
  const desired = new Vector3(killer.position.x, killer.position.y + 2.1, killer.position.z).addInPlace(back.scale(4.2)).addInPlace(side.scale(1.1));
  desired.y = Math.max(desired.y, sim.heightAt(desired.x, desired.z) + 0.8);
  camera.position.copyFrom(snapCamera ? desired : Vector3.Lerp(camera.position, desired, 1 - Math.exp(-dt * 6)));
  snapCamera = false;
  camera.setTarget(new Vector3((killer.position.x + victim.position.x) / 2, killer.position.y + 1.3, (killer.position.z + victim.position.z) / 2));
  camera.fov += (0.85 - camera.fov) * Math.min(1, dt * 6);
}

function events(dt: number) {
  // Online, the host also queues events for the others and a client gets them in snapshots; a client's own simulation
  // produces nothing worth showing (the host reports it).
  const list = net?.host ? net.host.drainEvents() : net?.client ? (sim.drainEvents(), net.client.drainEvents()) : sim.drainEvents();
  for (const event of list) {
    if ((event.type === 'message' || event.type === 'pickup') && event.for && event.for !== sim.localId) continue;
    const ownEcho = !!net?.client && event.type === 'shot' && event.actorId === sim.localId;
    if (ownEcho && event.type === 'shot' && event.hitId) sim.state.hits++;
    if (!ownEcho) audio.handle(event, focusPosition());
    if (net?.client && event.type === 'kill' && event.killerId === sim.localId && event.actorId !== sim.localId) sim.state.kills++;
    if (event.type === 'message') ui.notify(event.text);
    if (event.type === 'shot') {
      cueGunshot(event.actorId, event.from);
      spawnTracer(event.from, event.to, event.actorId);
      recorder.shot({ t: sim.state.elapsed, actorId: event.actorId, from: event.from, to: event.to });
    }
    if (event.type === 'kill' && event.actorId === sim.localId) lastKillerId = event.killerId ?? null;
    if (event.type === 'kill') {
      const victim = sim.state.actors.find(a => a.id === event.actorId);
      const killer = event.killerId ? sim.state.actors.find(a => a.id === event.killerId) : undefined;
      if (victim) ui.pushKill(killer?.name ?? 'Vòng bo', victim.name, killer?.vehicleId ? 'XE' : killer ? WEAPONS[killer.weapon].label : 'BO', event.killerId === sim.localId || victim.id === sim.localId);
    }
    if (event.type === 'kill' && event.killerId === sim.localId) {
      const victim = sim.state.actors.find(a => a.id === event.actorId); ui.notify(`Đã hạ ${victim?.name ?? 'đối thủ'}`);
    }
    if (event.type === 'damage' && event.actorId === sim.localId) {
      recoil = Math.min(0.13, recoil + 0.005);
      const source = event.sourceId ? sim.state.actors.find(a => a.id === event.sourceId) : undefined;
      if (source) ui.showDamageFrom(Math.atan2(source.position.x - sim.player.position.x, source.position.z - sim.player.position.z) - yaw);
    }
    if (event.type === 'pickup') {
      ui.notify(`Nhặt ${lootLabel(event.kind)}`);
      if (isArmorKind(event.kind)) ui.tip('armor', 'Mũ đỡ đạn bắn vào đầu, áo giáp đỡ đạn vào thân. Cấp càng cao càng bền; chỉ thay được bằng cấp cao hơn.');
    }
    if (event.type === 'airdrop' && event.stage === 'incoming') ui.tip('airdrop', 'Hộp tiếp tế có đồ rất tốt nhưng ai cũng muốn lấy. Xem vị trí trên bản đồ (M).');
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
  if (event.defaultPrevented || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  if ((event.code === 'Tab' || event.code === 'KeyI') && sim.state.phase === 'playing' && !mpMenuOpen && !replay && !sim.state.spectating) {
    event.preventDefault();
    if (!event.repeat) ui.toggleInventory();
    return;
  }
  if (ui.inventoryOpen) {
    if (event.code === 'Escape' && !event.repeat) { event.preventDefault(); ui.toggleInventory(false); }
    return;
  }
  if (event.code === 'Escape' && !event.repeat) {
    if (replay) { stopReplay(); return; }
    if (net && mpMenuOpen) { mpMenuOpen = false; ui.setMpMenu(false); void audio.unlock(); lockPointer(); return; }
    if (sim.state.phase === 'playing') pause();
    else if (sim.state.phase === 'paused') { sim.setPaused(false); void audio.unlock(); lockPointer(); clock = performance.now(); }
    return;
  }
  if (sim.state.phase !== 'playing') return;
  if (event.code === 'KeyM' && !event.repeat && !mpMenuOpen) { ui.toggleMap(); return; }
  if (gameplayInputBlocked()) return;
  if (event.code === 'Space' && event.target instanceof Element && event.target.closest('button, [role="button"]')) return;
  if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight'].includes(event.code)) event.preventDefault();
  keys.add(event.code);
  if (event.repeat) return;
  // A quick tap on Space (jump from the plane, open the canopy) can be over before the next frame reads the keys.
  if (event.code === 'Space' && sim.airborne) pendingJump = true;
  if (event.code === 'KeyR' && doReload()) audio.reload();
  if (event.code === 'KeyH' && doHeal()) audio.heal();
  if ((event.code === 'KeyE' || event.code === 'KeyF') && sim.airborne) pendingJump = true;
  else if (event.code === 'KeyE' && !doInteract()) useVehicle();
  else if (event.code === 'KeyF') useVehicle();
  // Slots 1 and 2 are the main guns in the order they were picked up; slot 3 is the sidearm.
  const slotKey = /^(?:Digit|Numpad)([1-3])$/.exec(event.code);
  if (slotKey) {
    const slots = slotOrder(sim.player.ownedWeapons), number = Number(slotKey[1]);
    const weapon = number === 3 ? slots.find(isSidearm) : slots.filter(w => !isSidearm(w))[number - 1];
    if (weapon) selectWeapon(weapon);
  }
  if (event.code === 'KeyG' && sim.airborne) toggleAutoGlide();
  if (event.code === 'KeyQ') cycleWeapon(1);
  if (event.code === 'KeyC') toggleStance('crouch');
  if (event.code === 'KeyZ') toggleStance('prone');
});
window.addEventListener('keyup', event => keys.delete(event.code));
canvas.addEventListener('mousedown', event => {
  if (touchDevice || sim.state.phase !== 'playing' || gameplayInputBlocked()) return;
  event.preventDefault(); void audio.unlock();
  if (!document.pointerLockElement) lockPointer();
  if (event.button === 0) { shooting = true; triggerPending = true; }
  if (event.button === 2) beginAim();
});
window.addEventListener('mouseup', event => { if (touchDevice) return; if (event.button === 0) shooting = false; if (event.button === 2) aiming = false; });
canvas.addEventListener('contextmenu', event => event.preventDefault());
canvas.addEventListener('wheel', event => {
  if (sim.state.phase !== 'playing' || gameplayInputBlocked()) return;
  event.preventDefault(); cycleWeapon(event.deltaY >= 0 ? 1 : -1);
}, { passive: false });
window.addEventListener('mousemove', event => {
  if (touchDevice || sim.state.phase !== 'playing' || gameplayInputBlocked() || (document.pointerLockElement !== canvas && !shooting && !aiming)) return;
  const sensitivity = 0.0016 * settings.sensitivity * (aiming ? 0.72 / Math.sqrt(WEAPONS[sim.player.weapon].zoom) : 1);
  lookBy(event.movementX * sensitivity, -event.movementY * sensitivity);
});
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (!locked && hadLock && sim.state.phase === 'playing' && !ui.inventoryOpen) pause();
  hadLock = locked;
});
window.addEventListener('blur', () => { if (!net) pause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && !net) pause(); });
function resizeGame() {
  if (touchDevice) releaseInput();
  if (engine) { applySettings(); engine.resize(); }
}
window.addEventListener('resize', resizeGame);
window.visualViewport?.addEventListener('resize', resizeGame);
window.addEventListener('orientationchange', resizeGame);

{
  const room = new URLSearchParams(location.search).get('room');
  if (room) { lobbyView.prefillCode(normalizeRoomCode(room)); lobbyView.show(true); }
}

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
    audio.setMenuMusic(sim.state.phase === 'menu');
    if (sim.state.phase === 'playing') {
      const rawForward = gameplayInputBlocked() ? 0 : (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0) + (mobile?.movement.forward ?? 0);
      const rawSide = gameplayInputBlocked() ? 0 : (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0) + (mobile?.movement.side ?? 0);
      const length = Math.max(1, Math.hypot(rawForward, rawSide));
      const forward = rawForward / length, side = rawSide / length;
      const sprint = !gameplayInputBlocked() && (keys.has('ShiftLeft') || keys.has('ShiftRight') || !!mobile?.movement.sprint);
      const jump = !gameplayInputBlocked() && (keys.has('Space') || mobileJump || pendingJump);
      const car = sim.player.vehicleId ? sim.state.vehicles.find(v => v.id === sim.player.vehicleId) : undefined;
      if (car) {
        if (!wasDriving) { yaw = car.yaw; pitch = -0.2; snapCamera = true; }
        // Without recent mouse input the chase camera swings in behind the car.
        if (Math.abs(car.speed) > 3 && performance.now() - lastLookAt > 1200) {
          const heading = car.speed >= 0 ? car.yaw : car.yaw + Math.PI;
          yaw += Math.atan2(Math.sin(heading - yaw), Math.cos(heading - yaw)) * Math.min(1, dt * 1.6);
        }
        sim.update(dt, lastInput = { moveX: 0, moveZ: 0, sprint: false, jump, throttle: Math.max(-1, Math.min(1, rawForward)), steer: Math.max(-1, Math.min(1, rawSide)) });
        audio.engine(car.speed, rawForward);
      } else {
        let moveX = Math.sin(yaw) * forward + Math.cos(yaw) * side, moveZ = Math.cos(yaw) * forward - Math.sin(yaw) * side;
        const flag = ui.waypoint, air = sim.player.air;
        if (autoGlide && !gameplayInputBlocked() && air && air.mode !== 'plane' && flag) {
          // Head for the flag, easing off as it nears so the canopy comes down on it.
          const dx = flag.x - sim.player.position.x, dz = flag.z - sim.player.position.z, distance = Math.hypot(dx, dz);
          const cap = air.mode === 'chute' ? (sprint ? DROP.chuteFast : DROP.chute).h : (sprint ? DROP.dive : DROP.freefall).h;
          const throttle = Math.min(1, distance / (cap * 1.2));
          moveX = distance > 0.5 ? dx / distance * throttle : 0; moveZ = distance > 0.5 ? dz / distance * throttle : 0;
        }
        if (!air) autoGlide = false;
        sim.update(dt, lastInput = { moveX, moveZ, sprint, jump });
        sim.player.yaw = yaw;
      }
      pendingJump = false;
      if (wasDriving && !car) { snapCamera = true; pitch = -0.12; }
      wasDriving = !!car;
      const lowStance = sim.player.stance ?? 'stand';
      if (!car && !sim.player.air && (forward || side) && lowStance !== 'prone') { footsteps += dt; if (footsteps > (sprint ? 0.30 : lowStance === 'crouch' ? 0.75 : 0.43) && sim.player.position.y < 0.05 && lowStance === 'stand') { audio.footstep(sprint); footsteps = 0; } else if (footsteps > 0.75) footsteps = 0; }
      else footsteps = 0;
    }
    if (net) {
      if (net.host) {
        net.host.tick(dt);
        for (const text of net.host.takeDeparted()) ui.notify(text);
      } else if (net.client) {
        net.client.tick(now, lastInput, yaw);
        net.client.frame(now);
        if (net.client.closedByHost || net.client.silence > 15) { ui.notify(net.client.closedByHost ? 'Chủ phòng đã rời trận.' : 'Mất kết nối với chủ phòng.'); leaveMatch(); }
      }
      if (net && sim.state.phase === 'playing' && !sim.player.alive && !mpSpectating) {
        // Killed in an online match: the match goes on without you, so keep watching it.
        mpSpectating = true;
        sim.state.spectating = true;
        spectateId = lastKillerId && sim.state.actors.some(actor => actor.id === lastKillerId && actor.alive) ? lastKillerId : null;
        snapCamera = true; pitch = -0.15;
        ui.notify(`Bạn bị hạ · hạng #${sim.state.playerRank ?? sim.player.rank ?? '?'} · đang xem tiếp trận`);
      }
    }
    updateNameplates();
    // Results go to the account: a finished single-player match, or (online) the moment you are out or win.
    if (!resultReported) {
      if (sim.state.phase === 'won' || sim.state.phase === 'lost') reportResult(sim.state.phase === 'won');
      else if (net && sim.state.phase === 'playing' && !sim.player.alive) reportResult(false);
    }
    renderActors(sim.state.phase === 'paused' ? 0 : dt);
    renderVehicles(sim.state.phase === 'paused' ? 0 : dt);
    renderLoot(sim.state.elapsed);
    renderPlane(); renderFlag(); renderAirdrops();
    if (islandRenderer && sim.state.phase !== 'menu') {
      const p = focusPosition();
      islandRenderer.update(p.x, p.z, 3, dt);
      // Keep the shadow frustum centred on the player, 150 m back along the sun's direction.
      const sun = sunlight.direction.normalizeToNew();
      sunlight.position.set(p.x - sun.x * 150, p.y - sun.y * 150, p.z - sun.z * 150);
    }
    const airMode = sim.player.air?.mode ?? null;
    if (airMode !== lastAirMode) {
      // Leaving the air (landing) returns the camera to ground level; entering it snaps to the orbit view.
      if (lastAirMode && !airMode) pitch = -0.12;
      snapCamera = true;
      lastAirMode = airMode;
      applyAirView(airMode);
    }
    if (sim.state.phase === 'playing') {
      const shadowsOn = shadowsAllowed && !(airMode && sim.heightAboveGround(sim.player) > 150);
      if (scene.shadowsEnabled !== shadowsOn) scene.shadowsEnabled = shadowsOn;
    }
    if (sim.state.phase === 'playing' && sim.player.alive && !sim.player.air) {
      // Assist slows the aim over enemies and pulls toward them.
      scanAssist(now);
      const level = assistLevel();
      if (level !== 'off' && (shooting || aiming)) {
        const pull = pullStep(pickAssist(yaw, pitch, assistTargets, level), level, dt, true);
        if (pull.yaw || pull.pitch) lookBy(pull.yaw, pull.pitch);
      }
    }
    // The crosshair opens with the bullet spread (bigger when moving, jumping or standing; smaller aiming or crouched).
    ui.setCrosshair(4 + Math.tan(sim.currentSpread(aiming)) / Math.tan(camera.fov / 2) * (canvas.clientHeight / 2));
    ui.setStance(sim.player.air || sim.state.phase !== 'playing' ? 'stand' : sim.player.stance ?? 'stand');
    if (sim.state.phase === 'playing' && sim.player.alive && !sim.player.air) recorder.frame(sim.state.elapsed, snapshotActors);
    if (replay) stepReplay(dt);
    ui.setReplayAvailable(canReplay() && !replay);
    audio.setListenerYaw(yaw);
    renderZone(); updateCamera(dt);
    if (sim.state.phase === 'playing' && !gameplayInputBlocked() && (triggerPending || shooting && WEAPONS[sim.player.weapon].fireMode === 'auto')) shoot();
    triggerPending = false;
    events(sim.state.phase === 'paused' ? 0 : dt);
    if (sim.state.phase !== lastPhase) {
      if (sim.state.phase === 'won' || sim.state.phase === 'lost') releaseInput();
      lastPhase = sim.state.phase;
    }
    const loot = sim.lootInReach;
    const nearbyCar = sim.vehicleInReach;
    if (loot) ui.tip('loot', touchDevice ? 'Chạm nút Nhặt để lấy đồ. Bạn mang tối đa 2 súng thường và 1 súng lục; hầu hết đồ nằm trong nhà.' : 'Nhấn E để nhặt đồ. Bạn mang tối đa 2 súng thường và 1 súng lục; hầu hết đồ nằm trong nhà.');
    if (nearbyCar) ui.tip('car', touchDevice ? 'Chạm nút Nhặt để lên xe: đi xa rất nhanh nhưng bạn không bắn được khi đang lái.' : 'Nhấn F để lên xe: đi xa rất nhanh nhưng bạn không bắn được khi đang lái.');
    if (sim.player.alive && sim.player.health < 50 && sim.player.medkits > 0) ui.tip('heal', touchDevice ? 'Chạm nút Hồi máu và đứng yên khoảng 3 giây để dùng túi cứu thương.' : 'Nhấn H và đứng yên khoảng 3 giây để dùng túi cứu thương.');
    const hint = sim.player.air ? '' : sim.player.vehicleId ? `${touchDevice ? 'Chạm Nhặt' : '[F]'} để xuống xe` : loot ? `${touchDevice ? '' : '[E] '}Nhặt ${lootLabel(loot.kind)}` : nearbyCar ? `${touchDevice ? '' : '[F] '}Lên xe` : sim.player.healing > 0 ? 'Đang hồi máu…' : sim.player.reloading > 0 ? 'Đang nạp đạn…' : !touchDevice && document.pointerLockElement !== canvas && sim.state.phase === 'playing' ? 'Nhấp vào màn hình để điều khiển chuột' : '';
    if (!touchDevice || now - lastHudTime >= 90 || hudPhase !== sim.state.phase || hudWeapon !== sim.player.weapon) {
      ui.update(sim.state, sim.world, hint);
      ui.updateInventory(sim.player, ui.inventoryOpen ? sim.nearbyLoot() : [], !!net);
      lastHudTime = now; hudPhase = sim.state.phase; hudWeapon = sim.player.weapon;
    }
    ui.setAim(aiming && sim.state.phase === 'playing' && !gameplayInputBlocked(), sim.player.weapon);
    mobile?.setEnabled(sim.state.phase === 'playing' && !gameplayInputBlocked());
    const drivenCar = sim.player.vehicleId ? sim.state.vehicles.find(v => v.id === sim.player.vehicleId) : undefined;
    ui.setVehicle(drivenCar ? { speed: drivenCar.speed, health: drivenCar.health / 300 } : null);
    // Frame-rate readout, refreshed twice a second from the last 120 frames.
    frameTimes.push(dt * 1000);
    if (frameTimes.length > 120) frameTimes.shift();
    if (!settings.showFps) ui.setPerf(null);
    else if (now - lastPerfAt >= 500) {
      lastPerfAt = now;
      const average = frameTimes.reduce((sum, value) => sum + value, 0) / Math.max(1, frameTimes.length);
      ui.setPerf(`${Math.round(engine.getFps())} FPS · khung TB ${average.toFixed(1)} ms · tệ nhất ${Math.max(...frameTimes).toFixed(0)} ms
${scene.getActiveMeshes().length} vật thể đang vẽ / ${scene.meshes.length} · ${sim.state.actors.filter(a => a.alive && a.air).length} người trên không${net?.client ? ` · ping ${Math.round(net.client.rttMs)} ms` : net?.host ? ' · chủ phòng' : ''}`);
    }
    ui.setSpectate(spectating() && sim.state.phase === 'playing' ? spectateTarget()?.name ?? '—' : null);
    const air = sim.player.air;
    if (air && sim.state.phase !== 'menu') {
      const plane = sim.state.plane;
      const agl = sim.heightAboveGround(sim.player);
      const speed = air.mode === 'plane' ? plane?.speed ?? 0 : Math.hypot(air.vx, air.vy, air.vz);
      if (sim.state.phase === 'playing') {
        if (air.mode === 'plane') audio.engine(8, 0.2); else audio.wind(air.mode === 'chute' ? speed * 0.5 : speed);
      }
      if (!touchDevice || now - lastAirHud >= 90) {
        lastAirHud = now;
        const seconds = air.mode === 'plane' ? plane ? (plane.length - plane.travelled) / plane.speed : 0
          : air.mode === 'freefall' ? Math.max(0, agl - DROP.autoOpen) / Math.max(1, -air.vy) : agl / Math.max(1, -air.vy);
        const flag = ui.waypoint;
        const flagInfo = flag ? (() => {
          const distance = Math.hypot(flag.x - sim.player.position.x, flag.z - sim.player.position.z);
          return { distance, reachable: distance <= remainingGlide(air.mode, agl), auto: autoGlide };
        })() : null;
        ui.setAir({ mode: air.mode, altitude: agl, speed, seconds, flag: flagInfo });
      }
    } else ui.setAir(null);
    mobile?.update({
      aiming, canPickup: !!loot || !!nearbyCar || !!drivenCar, reloading: sim.player.reloading > 0, healing: sim.player.healing > 0, stance: sim.player.stance ?? 'stand',
      gyroAvailable: gyroSupport() === 'ok', gyroOn: settings.gyro !== 'off' && gyro.status !== 'denied',
      glideReady: !!ui.waypoint && !!sim.player.air && sim.player.air.mode !== 'plane', glideOn: autoGlide,
    });
    scene.render();
    if (ui.inventoryOpen) inventoryPreview?.update(sim.player, sim.state.elapsed);
  });
  if (import.meta.env.DEV) {
    Object.assign(window, { __LASTLIGHT__: { simulation: sim, engine, scene, beginMultiplayer, getCamera: () => ({ yaw, pitch }), setCamera: (nextYaw: number, nextPitch: number) => { yaw = nextYaw; pitch = nextPitch; }, net: () => net, assist: () => ({ targets: assistTargets, scale: lookScale(pickAssist(yaw, pitch, assistTargets, assistLevel()), assistLevel()) }) } });
  }
} catch (error) {
  console.error(error);
  ui.setLoading(null);
  ui.showError('Không thể khởi tạo đồ họa 3D. Hãy bật tăng tốc phần cứng và mở game bằng Chrome hoặc Edge.');
}
