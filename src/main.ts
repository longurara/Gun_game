import './style.css';
import './theme.css';
import './mobile-hud.css';
import './desktop-hud.css';
import './air-hud.css';
import './stance-hud.css';
import './lobby.css';
import './social.css';
import './inventory.css';
import './settings.css';
import './lobby-polish.css';
import './supplies.css';
import './optics.css';
import './breath.css';
import './range.css';
import { InventoryPreview } from './inventory-preview';
import { Engine } from '@babylonjs/core/Engines/engine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { PointLight } from '@babylonjs/core/Lights/pointLight.js';
import { DEEP } from './game/underground';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import { BREATH_SECONDS } from './game/breath';
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
import { isSupplyKind } from './game/supplies';
import { isAttachKind, isPackKind, rigStats } from './game/gear';
import { isMeleeKind } from './game/melee';
import { kindOf, VEHICLES } from './game/vehicles';
import type { VehicleKind } from './game/vehicles';
import type { MeleeKind } from './game/melee';
import type { AttachKind, AttachSlot, PackKind } from './game/gear';
import type { SupplyKind, ThrowKind, UseKind } from './game/supplies';
import { GameAudio } from './audio';
import { createWeaponModel } from './weapon-models';
import { Soldier } from './soldier';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { WEAPONS, isArmorKind, isSidearm, isWeaponKind, lootLabel, parseArmor, slotOrder, ammoTypeOf } from './game/weapons';
import type { Actor, AmmoType, GameSettings, GyroMode, Loot, LootKind, PlayerInput, Vehicle, WeaponType } from './types';
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
import { actorIdFor, ClientSession, HostSession, matchOptions } from './net/session';
import { skinById } from './skins';
import { clampZoom, fovFor, SCOPE_FROM, stepZoom, zoomLevels } from './optics';
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
let mobileBreath = false;
/** How much the scope drifts: 1 normally, a little with the breath held, more when winded. */
let scopeSway = 1;
let wasHolding = false;
let yaw = 0, pitch = -0.12, recoil = 0, aiming = false, shooting = false, triggerPending = false, hadLock = false;
let snapCamera = true, lastPhase = sim.state.phase, footsteps = 0;
let clock = performance.now();
const keys = new Set<string>();
const models = new Map<string, Character>();
const lootMeshes = new Map<string, { node: InstancedMesh; loot: Loot }>();
const lootTemplates = new Map<string, Mesh>();
let lootSelector: Mesh | null = null;
let arenaMeshes: Mesh[] = [];
let islandRenderer: IslandRenderer | null = null;
/** Where the pointer is on screen (-1..1) and a smoothed copy: the lobby camera and soldier lean towards it a little. */
const menuPointer = { x: 0, y: 0, sx: 0, sy: 0 };
window.addEventListener('pointermove', event => { menuPointer.x = (event.clientX / Math.max(1, innerWidth)) * 2 - 1; menuPointer.y = (event.clientY / Math.max(1, innerHeight)) * 2 - 1; });
let sunlight: DirectionalLight;
let ambient: HemisphericLight;
let pipeline: DefaultRenderingPipeline | null = null;
let lastLootScan = -Infinity;
const effects: { mesh: Mesh; remaining: number; total?: number; grow?: number }[] = [];
const carModels = new Map<string, { root: TransformNode; wheels: TransformNode[]; bodies: Mesh[]; wrecked: boolean; lastYaw?: number }>();
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
  onSettings: (next) => {
    const outfitChanged = settings?.skin !== next.skin;
    settings = next; if (settings.gyro !== 'off') gyroOnMode = settings.gyro; applySettings(); syncGyro();
    sim?.setImmortal(settings.immortal);
    // A new outfit: rebuild the player's soldier (in the lobby it is the one on show).
    if (outfitChanged && sim) { const old = models.get(sim.localId); if (old) { old.root.dispose(false, true); models.delete(sim.localId); } }
  },
  onSelectWeapon: selectWeapon,
  onRangeEquip: weapon => doRangeEquip(weapon),
  onArmouryChange: open => { if (open) { shooting = false; aiming = false; if (document.pointerLockElement) document.exitPointerLock(); } else { void audio.unlock(); lockPointer(); } },
  onBreath: held => { mobileBreath = held; },
  onZoomStep: direction => changeZoom(direction),
  onInventoryPickup: pickupInventory,
  onInventoryDrop: dropInventory,
  onInventoryHeal: () => { if (doHeal()) { void audio.unlock(); audio.heal(); } },
  onThrowSelect: kind => doThrowSelect(kind),
  onInventoryAttach: kind => doAttach(kind),
  onInventoryDetach: (weapon, slot) => doDetach(weapon, slot),
  onInventoryUse: kind => { if (doUse(kind)) { void audio.unlock(); audio.heal(); } },
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
      const sensitivity = touchLookSensitivity(canvas.clientWidth, canvas.clientHeight, settings.sensitivity, aiming ? activeZoom() : null);
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
    onHeal: () => { if (doHeal() || doBoost()) { void audio.unlock(); audio.heal(); } },
    onThrow: () => { doThrow(); },
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

/** Connection health for the FPS overlay: ping, how many snapshots arrive, how late they run, how far behind others are drawn, how often the host moved you. */
function netReadout(client: ClientSession): string {
  const s = client.netStats();
  return ` · ping ${Math.round(s.rttMs)} ms
mạng: ${s.snapshotsPerSecond.toFixed(0)} gói/s · giật ${Math.round(s.jitterMs)} ms · vẽ trễ ${Math.round(s.delayMs)} ms · kéo lại ${s.correctionsPer10s}/10 s`;
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
  const scale = settings.gyroSensitivity / Math.sqrt(activeZoom());
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
/** Use a named healing item or boost (the pack, the inventory buttons, the J key). */
function doUse(kind: UseKind): boolean {
  const ok = sim.heal(sim.player, kind);
  if (ok) net?.client?.queueCommand('use', kind);
  return ok;
}
/** Throw the selected grenade at whatever the crosshair points at (or a short lob ahead when it points at the sky). */
function doThrow(): boolean {
  const kind = sim.selectedThrow();
  if (!kind || sim.state.phase !== 'playing' || gameplayInputBlocked()) return false;
  const ray = camera.getForwardRay(48);
  const pick = scene.pickWithRay(ray, mesh => mesh.isEnabled() && mesh.isPickable && !!mesh.metadata?.solid);
  const aim = pick?.hit && pick.pickedPoint ? pick.pickedPoint : ray.origin.add(ray.direction.scale(26));
  const target = { x: aim.x, y: aim.y, z: aim.z };
  if (!sim.throwGrenade(sim.player, kind, target)) return false;
  net?.client?.queueCommand('throw', [kind, Math.round(target.x * 100) / 100, Math.round(target.y * 100) / 100, Math.round(target.z * 100) / 100]);
  void audio.unlock();
  return true;
}
/** Put a spare part from the pack on the gun in hand (the inventory's GẮN button). */
function doAttach(kind: AttachKind): void {
  if (!sim.attachPart(sim.player, kind)) return;
  net?.client?.queueCommand('attach', [kind, sim.player.weapon]);
  void audio.unlock(); audio.heal();
}
function doDetach(weapon: string, slot: AttachSlot): void {
  if (!sim.detachPart(sim.player, weapon, slot)) return;
  net?.client?.queueCommand('detach', [weapon, slot]);
}
/** Swing the carried close-combat weapon (X): the host decides who it hits. */
function doMelee(): boolean {
  if (!sim.meleeStrike(sim.player)) return false;
  net?.client?.queueCommand('melee');
  void audio.unlock();
  return true;
}
function doThrowSelect(kind?: ThrowKind): void {
  const chosen = sim.cycleThrow(sim.player, kind);
  if (chosen) net?.client?.queueCommand('throwsel', chosen);
}
/** Drink or take whichever boost is in the pack and would still help. */
function doBoost(): boolean {
  const kind = (['painkiller', 'energy'] as const).find(item => sim.player.supplies[item] > 0 && sim.player.boost < 100);
  return kind ? doUse(kind) : false;
}
/**
 * Which of the items in reach E will take. By default the nearest; ↑/↓ (Alt + wheel, a tap on the hint on a phone) pick
 * another, and the choice sticks while that item stays in reach.
 */
let nearLoot: Loot[] = [];
let lootChoiceId: string | null = null, lootChoiceManual = false;
function refreshLootChoice(): Loot | null {
  nearLoot = sim.nearbyLoot();
  const kept = lootChoiceManual ? nearLoot.find(item => item.id === lootChoiceId) : undefined;
  if (!kept) lootChoiceManual = false;
  const choice = kept ?? nearLoot[0] ?? null;
  lootChoiceId = choice?.id ?? null;
  return choice;
}
function cycleLoot(step: number): void {
  const current = refreshLootChoice();
  if (!current || nearLoot.length < 2) return;
  const index = nearLoot.indexOf(current);
  lootChoiceId = nearLoot[(index + step + nearLoot.length) % nearLoot.length].id;
  lootChoiceManual = true;
  void audio.unlock();
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
  const choice = refreshLootChoice();
  if (net?.client) {
    // The host decides who gets the item (or takes the stairs); the result arrives in the next snapshot.
    if (!choice) {
      if (!sim.portalNear()) return false;
      net.client.queueCommand('stairs');
      return true;
    }
    net.client.queueCommand('inventory-pickup', choice.id);
    return true;
  }
  return choice ? sim.pickupLoot(choice.id) : sim.useStairs();
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
  // The range is for one player: a room on it plays on the island instead.
  config: () => ({ map: settings.map === 'range' ? 'island' : settings.map, botCount: settings.map === 'range' ? 100 : settings.botCount, difficulty: settings.difficulty }),
  begin: beginMultiplayer,
  skin: () => ui.currentSkin(),
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
  matchSkins.clear();
  info.setup.players.forEach((player, index) => { if (player.skin && skinById(player.skin)) matchSkins.set(actorIdFor(index), player.skin); });
  // Everyone's soldier is rebuilt in the outfit they chose.
  for (const model of models.values()) model.root.dispose(false, true);
  models.clear();
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
  sim.start({ botCount: settings.botCount, difficulty: settings.difficulty, seed: Date.now(), map: settings.map, drop: settings.map !== 'arena' && settings.map !== 'range', immortal: settings.immortal, humans: 1, localId: '', names: [], remote: false });
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
  else ui.notify(({ island: 'Bạn đã đáp xuống đảo. Tìm vũ khí và vào vùng an toàn!', valley: 'Thung lũng đông đúc. Lục nhà tìm súng, bo thu rất nhanh!', desert: 'Sa mạc mênh mông. Tìm xe và vào vùng an toàn trước khi bo khép lại!', pines: 'Rừng thông dày đặc. Tìm vũ khí, dùng cây làm chỗ nấp.', metro: 'Thành phố đông đúc. Lục tòa nhà, chiếm tầng cao.' } as Record<string, string>)[mapId] ?? 'Tìm trang bị. Giữ vùng an toàn. Sống sót cuối cùng.');
}

/** Switch the scene between the small arena and the streamed island to match the simulation's world. */
let rangeMeshes: Mesh[] = [];

/** A board with a distance painted on it. */
function signBoard(text: string): StandardMaterial {
  const name = `range-sign-${text}`;
  const cached = sharedMaterials.get(name);
  if (cached) return cached;
  const texture = new DynamicTexture(name, { width: 256, height: 128 }, scene, false);
  const context = texture.getContext() as unknown as CanvasRenderingContext2D;
  context.fillStyle = '#f2efe2'; context.fillRect(0, 0, 256, 128);
  context.fillStyle = '#c63d2f'; context.fillRect(0, 0, 256, 14); context.fillRect(0, 114, 256, 14);
  context.fillStyle = '#1b1f1c'; context.font = 'bold 64px "Segoe UI", Arial, sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle';
  context.fillText(text, 128, 66);
  texture.update();
  const board = new StandardMaterial(name, scene);
  board.diffuseTexture = texture; board.emissiveColor = new Color3(0.34, 0.34, 0.32); board.specularColor = Color3.Black();
  sharedMaterials.set(name, board);
  return board;
}

/** The shooting range's scenery: concrete lanes with distance marks and boards, the firing line under a shelter, racks, berms, and the yard. */
function buildRangeScene() {
  if (rangeMeshes.length || !sim.world.range) return;
  const layout = sim.world.range, half = sim.world.halfSize;
  const known = new Set<unknown>(scene.meshes);
  const grass = material('range-grass', '#6f8456'), concrete = material('range-concrete', '#9b9d94'), paint = material('range-paint', '#ece8d4'), yellow = material('range-yellow', '#e2b53c');
  const earth = material('range-earth', '#76603f'), dark = material('range-dark', '#2e3733');
  const wood = material('wood', '#927758'), plaster = material('plaster', '#a7afa1'), roofMat = material('roof', '#475951'), rockMat = material('stone', '#777e73'), trim = material('trim', '#67796d');
  const ground = MeshBuilder.CreateGround('range-ground', { width: half * 2.8, height: half * 2.8 }, scene);
  ground.material = grass; ground.receiveShadows = true; ground.metadata = { solid: true };
  const z0 = layout.firingZ, far = z0 + Math.max(...layout.distances), length = far - z0 + 16, middle = (z0 + far) / 2 + 2;
  const flat = (name: string, w: number, d: number, mat: StandardMaterial, x: number, y: number, z: number) => { const mesh = box(name, w, 0.04, d, mat, new Vector3(x, y, z)); mesh.isPickable = false; return mesh; };
  for (const x of layout.laneX) {
    flat('lane', 20, length, concrete, x, 0.02, middle);
    for (const side of [-1, 1]) flat('lane-edge', 0.25, length, paint, x + side * 10, 0.03, middle);
    for (const d of layout.distances) flat('lane-mark', 20, 0.45, paint, x, 0.035, z0 + d);
  }
  flat('firing-line', 220, 0.7, yellow, 0, 0.045, z0);
  flat('rack-floor', 70, 44, concrete, 0, 0.02, z0 - 36);
  for (const d of layout.distances) for (const side of [-1, 1]) {
    const pole = box('sign-pole', 0.14, 3, 0.14, dark, new Vector3(side * 112, 1.5, z0 + d)); pole.isPickable = false;
    const board = box('sign', 3.2, 1.6, 0.1, signBoard(`${d} M`), new Vector3(side * 112, 3.1, z0 + d)); board.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2; board.isPickable = false;
  }
  // Low dividers between the lanes at the firing line (nothing overhead: the camera sits behind the player).
  for (let x = -100; x <= 100; x += 40) box('stall-divider', 0.25, 1.0, 5, dark, new Vector3(x, 0.5, z0 - 2.5)).isPickable = false;
  box('berm-back', half * 2.1, 8, 12, earth, new Vector3(0, 4, half + 4)).isPickable = false;
  for (const side of [-1, 1]) box('berm-side', 12, 7, half * 2.1, earth, new Vector3(side * (half + 4), 3.5, 0)).isPickable = false;
  for (const obstacle of sim.world.obstacles) {
    const mat = obstacle.kind === 'building' ? plaster : obstacle.kind === 'crate' ? wood : rockMat;
    const body = box(obstacle.id, obstacle.width, obstacle.height, obstacle.depth, mat, new Vector3(obstacle.x, obstacle.height / 2, obstacle.z));
    body.metadata = { solid: true };
    shadows.addShadowCaster(body);
    if (obstacle.kind === 'building') {
      box(`${obstacle.id}-roof`, obstacle.width + 0.5, 0.26, obstacle.depth + 0.55, roofMat, new Vector3(obstacle.x, obstacle.height + 0.08, obstacle.z)).isPickable = false;
      box('house-trim', obstacle.width + 0.04, 0.3, obstacle.depth + 0.04, trim, new Vector3(obstacle.x, 0.3, obstacle.z)).isPickable = false;
    }
  }
  for (const mesh of scene.meshes) if (!known.has(mesh)) { mesh.freezeWorldMatrix(); rangeMeshes.push(mesh as Mesh); }
}

function configureWorld() {
  const range = sim.world.id === 'range';
  const island = sim.world.id !== 'arena' && !range;
  for (const mesh of arenaMeshes) mesh.setEnabled(!island && !range);
  if (range) buildRangeScene();
  for (const mesh of rangeMeshes) mesh.setEnabled(range);
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
  underground = false; surfaceLook = null; lamp?.setEnabled(false);
  // Each open map has its own haze; the arena keeps its olive dusk.
  const haze = sim.world.theme?.haze ?? [0.78, 0.84, 0.88];
  scene.fogDensity = island ? sim.world.theme?.fogDensity ?? 0.0024 : range ? 0.0011 : 0.0045;
  scene.fogColor = island ? new Color3(haze[0], haze[1], haze[2]) : range ? new Color3(0.76, 0.82, 0.86) : new Color3(0.64, 0.71, 0.65);
  scene.clearColor = island ? new Color4(haze[0], haze[1], haze[2], 1) : range ? new Color4(0.74, 0.82, 0.9, 1) : new Color4(0.68, 0.74, 0.68, 1);
  ambient.diffuse = island ? new Color3(0.9, 0.95, 1) : Color3.White();
  ambient.groundColor = Color3.FromHexString(island ? '#6a7048' : '#636449');
  ambient.intensity = island ? 0.95 : 0.7;
  sunlight.intensity = island ? 1.25 : 0.85;
  camera.maxZ = island ? 800 : range ? 700 : 450;
  // The arena fits one shadow map; on the island the sun's frustum follows the player instead.
  sunlight.autoUpdateExtends = !island;
  if (range) {
    // A long field: the shadow box follows the player like on the big maps.
    sunlight.autoUpdateExtends = false;
    sunlight.orthoLeft = -70; sunlight.orthoRight = 70; sunlight.orthoTop = 70; sunlight.orthoBottom = -70;
    sunlight.shadowMinZ = 1; sunlight.shadowMaxZ = 300;
  }
  if (island) {
    sunlight.orthoLeft = -85; sunlight.orthoRight = 85; sunlight.orthoTop = 85; sunlight.orthoBottom = -85;
    sunlight.shadowMinZ = 1; sunlight.shadowMaxZ = 330;
  }
}

/** In a bunker the sky and the sun are gone: dim ambient light, thick dark fog and a lamp on the player's head. */
let underground = false;
let lamp: PointLight | null = null;
let surfaceLook: { fog: number; fogColor: Color3; clear: Color4; ambient: number; sun: number; shadows: boolean; maxZ: number } | null = null;
function setUnderground(on: boolean) {
  if (on === underground) return;
  underground = on;
  if (on) {
    surfaceLook = { fog: scene.fogDensity, fogColor: scene.fogColor.clone(), clear: scene.clearColor.clone(), ambient: ambient.intensity, sun: sunlight.intensity, shadows: scene.shadowsEnabled, maxZ: camera.maxZ };
    scene.fogDensity = 0.035; scene.fogColor = new Color3(0.03, 0.035, 0.04); scene.clearColor = new Color4(0.03, 0.035, 0.04, 1);
    ambient.intensity = 0.4; sunlight.intensity = 0; scene.shadowsEnabled = false; camera.maxZ = 150;
    if (!lamp) { lamp = new PointLight('headlamp', new Vector3(0, 0, 0), scene); lamp.diffuse = Color3.FromHexString('#ffe9c4'); lamp.specular = Color3.Black(); lamp.range = 26; }
    lamp.intensity = 1.1; lamp.setEnabled(true);
  } else {
    const look = surfaceLook;
    if (look) { scene.fogDensity = look.fog; scene.fogColor = look.fogColor; scene.clearColor = look.clear; ambient.intensity = look.ambient; sunlight.intensity = look.sun; scene.shadowsEnabled = look.shadows; camera.maxZ = look.maxZ; }
    surfaceLook = null;
    lamp?.setEnabled(false);
  }
}

function gameplayInputBlocked(): boolean {
  return mpMenuOpen || ui.mapOpen || ui.touchOverlayOpen || ui.armouryOpen;
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
  if (name === 'dry-grass') useGeneratedAlbedo(value, GENERATED_TEXTURES.terrainGrass, sim.world.halfSize, 1.25);
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

/** Outfits the other people in an online match chose, by actor id. */
const matchSkins = new Map<string, string>();

function createCharacter(actor: Actor): Character {
  const skin = actor.id === sim.localId ? ui.currentSkin() : matchSkins.get(actor.id);
  const soldier = new Soldier(scene, actor.id, actor.isPlayer && actor.id === sim.localId, shadows, actor.isPlayer && actor.id !== sim.localId, skin);
  soldier.setWeapon(actor.weapon);
  return { soldier, root: soldier.root, last: new Vector3(), stride: 0, moving: 0, crouch: 0, prone: 0 };
}

function renderActors(dt: number) {
  const island = sim.world.id !== 'arena';
  const focus = focusPosition();
  const time = performance.now() * 0.001;
  let newModels = 0;
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
    if (!model) {
      // A soldier costs a few tens of milliseconds to build; a city full of bots would stall the frame, so only a couple appear per frame.
      if (!actor.isPlayer && newModels >= 2) continue;
      if (!actor.isPlayer) newModels++;
      model = createCharacter(actor); models.set(actor.id, model); model.last.set(actor.position.x, actor.position.y, actor.position.z);
    }
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
      model.root.rotation.set(0, Math.PI + 0.55 + Math.sin(time * 0.5) * 0.1 - menuPointer.sx * 0.3, 0);
      model.root.position.y = actor.position.y + Math.sin(time * 1.6) * 0.012;
    }
    model.soldier.pose(dt, { moving: showcase ? 0 : model.moving, stride: model.stride, alive: actor.alive, reloading: actor.reloading > 0, healing: actor.healing > 0, time, showcase, crouch: model.crouch, prone: model.prone });
    model.soldier.endFlash();
    model.last.copyFrom(pos);
  }
}

const CAR_COLORS = ['#b5483a', '#3f6f9a', '#d0a739', '#dcdcd2', '#52624f'];
type CarModel = { root: TransformNode; wheels: TransformNode[]; bodies: Mesh[]; wrecked: boolean; lastYaw?: number };

function createCarModel(v: Vehicle): CarModel {
  const build = VEHICLE_MODELS[kindOf(v)];
  if (build) return build(v);
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

/** A motorbike: two wheels, a frame, a tank, a seat and handlebars. */
function createBikeModel(v: Vehicle) {
  const root = new TransformNode(`car-${v.id}`, scene);
  const paint = material(`car-paint-${v.colorIndex % 5}`, CAR_COLORS[v.colorIndex % 5]);
  const dark = material('car-tyre', '#1b1f21'), metal = material('bike-metal', '#8f9aa0', 0.1), lamp = material('car-lamp', '#fff2c4', 0.9);
  const parts: Mesh[] = [];
  const add = (mesh: Mesh) => { mesh.metadata = { solid: true, car: true }; parts.push(mesh); return mesh; };
  add(box('bike-frame', 0.14, 0.32, 1.25, dark, new Vector3(0, 0.62, 0), root));
  add(box('bike-engine', 0.26, 0.3, 0.45, metal, new Vector3(0, 0.46, 0.05), root));
  add(box('bike-tank', 0.3, 0.22, 0.5, paint, new Vector3(0, 0.86, 0.22), root));
  add(box('bike-seat', 0.26, 0.1, 0.6, dark, new Vector3(0, 0.86, -0.38), root));
  add(box('bike-fender', 0.2, 0.05, 0.4, paint, new Vector3(0, 0.74, -0.78), root));
  add(box('bike-fork', 0.07, 0.7, 0.07, metal, new Vector3(0, 0.7, 0.82), root));
  add(box('bike-bars', 0.7, 0.05, 0.05, dark, new Vector3(0, 1.08, 0.7), root));
  add(box('bike-lamp', 0.16, 0.14, 0.08, lamp, new Vector3(0, 0.98, 0.9), root));
  const wheels: TransformNode[] = [];
  for (const z of [0.82, -0.78]) {
    const pivot = new TransformNode('wheel-pivot', scene);
    pivot.parent = root; pivot.position.set(0, 0.36, z);
    const wheel = MeshBuilder.CreateCylinder('wheel', { diameter: 0.72, height: 0.14, tessellation: 14 }, scene);
    wheel.rotation.z = Math.PI / 2; wheel.material = dark; wheel.parent = pivot; wheel.isPickable = false;
    wheels.push(pivot);
  }
  for (const mesh of parts) { shadows.addShadowCaster(mesh); mesh.receiveShadows = true; }
  return { root, wheels, bodies: parts, wrecked: false } as { root: TransformNode; wheels: TransformNode[]; bodies: Mesh[]; wrecked: boolean; lastYaw?: number };
}

/** An open buggy: a low chassis, a roll cage, two seats and fat tyres. */
function createBuggyModel(v: Vehicle) {
  const root = new TransformNode(`car-${v.id}`, scene);
  const paint = material(`car-paint-${v.colorIndex % 5}`, CAR_COLORS[v.colorIndex % 5]);
  const dark = material('car-tyre', '#1b1f21'), cage = material('buggy-cage', '#2f3a3d', 0.1), lamp = material('car-lamp', '#fff2c4', 0.9);
  const parts: Mesh[] = [];
  const add = (mesh: Mesh) => { mesh.metadata = { solid: true, car: true }; parts.push(mesh); return mesh; };
  add(box('buggy-chassis', 1.5, 0.3, 2.5, paint, new Vector3(0, 0.55, 0), root));
  add(box('buggy-engine', 1.0, 0.45, 0.7, cage, new Vector3(0, 0.9, -1.0), root));
  add(box('buggy-seat', 0.55, 0.12, 0.5, dark, new Vector3(-0.35, 0.82, -0.1), root));
  add(box('buggy-seat', 0.55, 0.12, 0.5, dark, new Vector3(0.35, 0.82, -0.1), root));
  for (const x of [-0.7, 0.7]) for (const z of [0.55, -0.55]) add(box('buggy-post', 0.06, 1.0, 0.06, cage, new Vector3(x, 1.2, z), root));
  add(box('buggy-roof', 1.5, 0.06, 1.2, cage, new Vector3(0, 1.72, 0), root));
  add(box('buggy-front', 1.4, 0.3, 0.3, paint, new Vector3(0, 0.62, 1.2), root));
  for (const x of [-0.5, 0.5]) add(box('car-lamp', 0.26, 0.16, 0.06, lamp, new Vector3(x, 0.75, 1.36), root));
  const wheels: TransformNode[] = [];
  for (const [x, z] of [[-1.0, 0.95], [1.0, 0.95], [-1.0, -0.95], [1.0, -0.95]]) {
    const pivot = new TransformNode('wheel-pivot', scene);
    pivot.parent = root; pivot.position.set(x, 0.46, z);
    const wheel = MeshBuilder.CreateCylinder('wheel', { diameter: 0.92, height: 0.4, tessellation: 12 }, scene);
    wheel.rotation.z = Math.PI / 2; wheel.material = dark; wheel.parent = pivot; wheel.isPickable = false;
    wheels.push(pivot);
  }
  for (const mesh of parts) { shadows.addShadowCaster(mesh); mesh.receiveShadows = true; }
  return { root, wheels, bodies: parts, wrecked: false } as { root: TransformNode; wheels: TransformNode[]; bodies: Mesh[]; wrecked: boolean; lastYaw?: number };
}

/** The shared pieces of the simple box-built vehicles: paint, glass, lamps, and helpers to place parts and wheels. */
function vehicleKit(v: Vehicle, name: string) {
  const root = new TransformNode(`car-${v.id}`, scene);
  const paint = material(`car-paint-${v.colorIndex % 5}`, CAR_COLORS[v.colorIndex % 5]);
  const dark = material('car-tyre', '#1b1f21'), glass = material('car-glass', '#33454f', 0.15), lamp = material('car-lamp', '#fff2c4', 0.9);
  const trim = material('buggy-cage', '#2f3a3d', 0.1), canvas = material('car-canvas', '#6f7a55', 0.05), chrome = material('bike-metal', '#8f9aa0', 0.1);
  const parts: Mesh[] = [], wheels: TransformNode[] = [];
  const part = (label: string, w: number, h: number, d: number, mat: StandardMaterial, x: number, y: number, z: number) => {
    const mesh = box(`${name}-${label}`, w, h, d, mat, new Vector3(x, y, z), root);
    mesh.metadata = { solid: true, car: true }; parts.push(mesh); return mesh;
  };
  const wheel = (x: number, z: number, diameter: number, width: number) => {
    const pivot = new TransformNode('wheel-pivot', scene);
    pivot.parent = root; pivot.position.set(x, diameter / 2, z);
    const tyre = MeshBuilder.CreateCylinder('wheel', { diameter, height: width, tessellation: 12 }, scene);
    tyre.rotation.z = Math.PI / 2; tyre.material = dark; tyre.parent = pivot; tyre.isPickable = false;
    wheels.push(pivot);
  };
  const lamps = (z: number, y: number, x: number, w = 0.28) => { for (const side of [-1, 1]) part('lamp', w, 0.16, 0.06, lamp, side * x, y, z); };
  const finish = (): CarModel => { for (const mesh of parts) { shadows.addShadowCaster(mesh); mesh.receiveShadows = true; } return { root, wheels, bodies: parts, wrecked: false }; };
  return { paint, dark, glass, lamp, trim, canvas, chrome, part, wheel, lamps, finish };
}

/** A soft-top jeep: boxy, open at the sides, with a spare wheel on the back. */
function createJeepModel(v: Vehicle): CarModel {
  const k = vehicleKit(v, 'jeep');
  k.part('body', 1.7, 0.5, 3.4, k.paint, 0, 0.72, 0);
  k.part('hood', 1.5, 0.3, 1.1, k.paint, 0, 1.0, 1.25);
  k.part('screen', 1.5, 0.5, 0.06, k.glass, 0, 1.28, 0.6);
  for (const x of [-0.4, 0.4]) k.part('seat', 0.5, 0.12, 0.5, k.dark, x, 1.0, 0);
  k.part('bench', 1.4, 0.12, 0.45, k.dark, 0, 1.0, -0.9);
  for (const x of [-0.82, 0.82]) for (const z of [0.5, -1.35]) k.part('post', 0.06, 0.95, 0.06, k.trim, x, 1.45, z);
  k.part('top', 1.75, 0.06, 1.95, k.canvas, 0, 1.95, -0.42);
  k.part('spare', 0.8, 0.8, 0.25, k.dark, 0, 1.15, -1.85);
  k.part('bumper', 1.8, 0.2, 0.14, k.trim, 0, 0.55, 1.82);
  k.lamps(1.82, 0.9, 0.55);
  for (const [x, z] of [[-0.95, 1.1], [0.95, 1.1], [-0.95, -1.1], [0.95, -1.1]]) k.wheel(x, z, 0.92, 0.32);
  return k.finish();
}

/** A pickup truck: a cab at the front and an open bed behind it. */
function createPickupModel(v: Vehicle): CarModel {
  const k = vehicleKit(v, 'pickup');
  k.part('chassis', 1.8, 0.3, 4.7, k.trim, 0, 0.55, 0);
  k.part('cab', 1.8, 0.95, 1.5, k.paint, 0, 1.2, 0.65);
  k.part('cab-glass', 1.84, 0.45, 1.2, k.glass, 0, 1.45, 0.62);
  k.part('hood', 1.8, 0.45, 1.1, k.paint, 0, 0.85, 1.85);
  k.part('bed', 1.85, 0.12, 2.3, k.paint, 0, 0.8, -1.3);
  for (const x of [-0.89, 0.89]) k.part('side', 0.08, 0.5, 2.3, k.paint, x, 1.08, -1.3);
  k.part('tailgate', 1.85, 0.5, 0.08, k.paint, 0, 1.08, -2.45);
  k.part('bumper', 1.9, 0.22, 0.14, k.trim, 0, 0.6, 2.45);
  k.lamps(2.42, 0.95, 0.6);
  for (const [x, z] of [[-0.98, 1.6], [0.98, 1.6], [-0.98, -1.5], [0.98, -1.5]]) k.wheel(x, z, 0.96, 0.32);
  return k.finish();
}

/** A tall delivery van. */
function createVanModel(v: Vehicle): CarModel {
  const k = vehicleKit(v, 'van');
  k.part('body', 2.0, 1.8, 4.6, k.paint, 0, 1.2, -0.3);
  k.part('nose', 1.9, 0.9, 0.8, k.paint, 0, 0.72, 2.3);
  k.part('screen', 1.85, 0.75, 0.06, k.glass, 0, 1.6, 2.0);
  for (const x of [-1.01, 1.01]) k.part('window', 0.04, 0.5, 0.9, k.glass, x, 1.65, 1.35);
  k.part('stripe', 2.02, 0.16, 4.6, k.trim, 0, 0.85, -0.3);
  k.part('bumper', 2.0, 0.22, 0.14, k.trim, 0, 0.55, 2.72);
  k.part('bumper', 2.0, 0.22, 0.14, k.trim, 0, 0.55, -2.62);
  k.lamps(2.72, 0.85, 0.6);
  for (const [x, z] of [[-1.0, 1.7], [1.0, 1.7], [-1.0, -1.6], [1.0, -1.6]]) k.wheel(x, z, 0.86, 0.3);
  return k.finish();
}

/** A minibus: long, with a band of windows down both sides. */
function createMinibusModel(v: Vehicle): CarModel {
  const k = vehicleKit(v, 'minibus');
  k.part('body', 2.2, 1.9, 6.0, k.paint, 0, 1.25, 0);
  for (const x of [-1.11, 1.11]) k.part('windows', 0.04, 0.6, 4.6, k.glass, x, 1.75, -0.25);
  k.part('screen', 2.0, 0.85, 0.06, k.glass, 0, 1.65, 3.02);
  k.part('roof', 2.1, 0.08, 5.8, k.trim, 0, 2.23, 0);
  k.part('stripe', 2.22, 0.14, 6.0, k.trim, 0, 0.85, 0);
  k.part('bumper', 2.2, 0.22, 0.14, k.trim, 0, 0.5, 3.05);
  k.part('bumper', 2.2, 0.22, 0.14, k.trim, 0, 0.5, -3.05);
  k.lamps(3.04, 0.85, 0.7);
  for (const [x, z] of [[-1.1, 2.0], [1.1, 2.0], [-1.1, -2.0], [1.1, -2.0]]) k.wheel(x, z, 1.0, 0.34);
  return k.finish();
}

/** A low sports coupe with a rear wing. */
function createCoupeModel(v: Vehicle): CarModel {
  const k = vehicleKit(v, 'coupe');
  k.part('body', 1.9, 0.5, 4.3, k.paint, 0, 0.6, 0);
  k.part('hood', 1.8, 0.2, 1.5, k.paint, 0, 0.92, 1.35);
  k.part('cabin', 1.55, 0.42, 1.7, k.glass, 0, 1.08, -0.35);
  k.part('roof', 1.5, 0.06, 1.35, k.paint, 0, 1.32, -0.4);
  k.part('wing', 1.7, 0.07, 0.36, k.trim, 0, 1.12, -2.0);
  for (const x of [-0.6, 0.6]) k.part('wing-post', 0.06, 0.3, 0.06, k.trim, x, 0.95, -1.95);
  k.part('splitter', 1.95, 0.12, 0.2, k.trim, 0, 0.42, 2.18);
  k.lamps(2.16, 0.78, 0.65, 0.34);
  for (const [x, z] of [[-0.97, 1.4], [0.97, 1.4], [-0.97, -1.3], [0.97, -1.3]]) k.wheel(x, z, 0.74, 0.36);
  return k.finish();
}

/** A small scooter: a step-through frame, a front shield and a bench seat. */
function createScooterModel(v: Vehicle): CarModel {
  const k = vehicleKit(v, 'scooter');
  k.part('deck', 0.36, 0.08, 0.85, k.paint, 0, 0.3, 0.1);
  k.part('rear', 0.34, 0.5, 0.7, k.paint, 0, 0.58, -0.5);
  k.part('seat', 0.3, 0.1, 0.55, k.dark, 0, 0.88, -0.42);
  k.part('shield', 0.4, 0.55, 0.14, k.paint, 0, 0.75, 0.6);
  k.part('column', 0.07, 0.55, 0.07, k.chrome, 0, 1.0, 0.62);
  k.part('bars', 0.62, 0.05, 0.05, k.dark, 0, 1.28, 0.6);
  k.part('lamp', 0.16, 0.12, 0.08, k.lamp, 0, 0.98, 0.7);
  k.wheel(0, 0.72, 0.52, 0.12); k.wheel(0, -0.68, 0.52, 0.14);
  return k.finish();
}

/** A four-wheeled quad bike. */
function createQuadModel(v: Vehicle): CarModel {
  const k = vehicleKit(v, 'quad');
  k.part('chassis', 0.9, 0.25, 1.4, k.paint, 0, 0.55, 0);
  k.part('engine', 0.5, 0.3, 0.5, k.chrome, 0, 0.8, 0.0);
  k.part('seat', 0.42, 0.12, 0.7, k.dark, 0, 0.9, -0.3);
  k.part('fender', 1.2, 0.08, 0.5, k.paint, 0, 0.8, 0.62);
  k.part('rack', 0.7, 0.06, 0.45, k.trim, 0, 0.98, -0.85);
  k.part('column', 0.07, 0.5, 0.07, k.chrome, 0, 0.98, 0.42);
  k.part('bars', 0.85, 0.05, 0.05, k.dark, 0, 1.2, 0.42);
  k.lamps(0.88, 0.85, 0.3, 0.2);
  for (const [x, z] of [[-0.62, 0.55], [0.62, 0.55], [-0.62, -0.55], [0.62, -0.55]]) k.wheel(x, z, 0.62, 0.3);
  return k.finish();
}

/** A three-wheeled tuk-tuk with a canvas roof. */
function createTuktukModel(v: Vehicle): CarModel {
  const k = vehicleKit(v, 'tuktuk');
  k.part('floor', 1.2, 0.12, 2.2, k.paint, 0, 0.5, -0.2);
  k.part('nose', 0.7, 0.7, 0.5, k.paint, 0, 0.85, 0.95);
  k.part('screen', 1.15, 0.55, 0.05, k.glass, 0, 1.4, 0.55);
  k.part('seat', 1.0, 0.14, 0.6, k.dark, 0, 0.78, -0.75);
  k.part('back', 1.0, 0.5, 0.1, k.dark, 0, 1.05, -1.1);
  for (const x of [-0.6, 0.6]) for (const z of [0.5, -1.15]) k.part('post', 0.06, 1.2, 0.06, k.trim, x, 1.3, z);
  k.part('roof', 1.4, 0.07, 1.95, k.canvas, 0, 1.92, -0.32);
  k.part('bars', 0.6, 0.05, 0.05, k.dark, 0, 1.15, 0.9);
  k.lamps(1.2, 0.95, 0.2, 0.16);
  k.wheel(0, 1.0, 0.52, 0.14); k.wheel(-0.62, -0.8, 0.58, 0.16); k.wheel(0.62, -0.8, 0.58, 0.16);
  return k.finish();
}

/** A motorbike with a sidecar bolted on its right. */
function createSidecarModel(v: Vehicle): CarModel {
  const k = vehicleKit(v, 'sidecar');
  const bx = -0.45;
  k.part('frame', 0.14, 0.32, 1.25, k.dark, bx, 0.62, 0);
  k.part('engine', 0.26, 0.3, 0.45, k.chrome, bx, 0.46, 0.05);
  k.part('tank', 0.3, 0.22, 0.5, k.paint, bx, 0.86, 0.22);
  k.part('seat', 0.26, 0.1, 0.6, k.dark, bx, 0.86, -0.38);
  k.part('fork', 0.07, 0.7, 0.07, k.chrome, bx, 0.7, 0.82);
  k.part('bars', 0.7, 0.05, 0.05, k.dark, bx, 1.08, 0.7);
  k.part('lamp', 0.16, 0.14, 0.08, k.lamp, bx, 0.98, 0.9);
  k.part('tub', 0.7, 0.4, 1.25, k.paint, 0.6, 0.62, -0.05);
  k.part('nose', 0.5, 0.28, 0.4, k.paint, 0.6, 0.56, 0.8);
  k.part('screen', 0.5, 0.3, 0.05, k.glass, 0.6, 1.0, 0.45);
  k.part('strut', 0.6, 0.06, 0.06, k.trim, 0.0, 0.55, 0.25);
  k.part('strut', 0.6, 0.06, 0.06, k.trim, 0.0, 0.55, -0.4);
  k.wheel(bx, 0.82, 0.72, 0.14); k.wheel(bx, -0.78, 0.72, 0.14); k.wheel(0.95, -0.1, 0.62, 0.14);
  return k.finish();
}

const VEHICLE_MODELS: Partial<Record<VehicleKind, (v: Vehicle) => CarModel>> = {
  bike: createBikeModel, buggy: createBuggyModel, jeep: createJeepModel, pickup: createPickupModel, van: createVanModel, minibus: createMinibusModel,
  coupe: createCoupeModel, scooter: createScooterModel, quad: createQuadModel, tuktuk: createTuktukModel, sidecar: createSidecarModel,
};

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
    // A motorbike leans into its turns.
    let lean = 0;
    if ((kindOf(v) === 'bike' || kindOf(v) === 'scooter') && car.lastYaw !== undefined && dt > 0) lean = Math.max(-0.5, Math.min(0.5, Math.atan2(Math.sin(v.yaw - car.lastYaw), Math.cos(v.yaw - car.lastYaw)) / dt * v.speed * 0.012));
    car.lastYaw = v.yaw;
    car.root.rotation.set(pitch, v.yaw, roll - lean);
    for (const wheel of car.wheels) wheel.rotation.x += v.speed * dt / 0.42;
    if (v.health <= 0 && !car.wrecked) {
      car.wrecked = true;
      const burnt = material('car-burnt', '#242322');
      for (const mesh of car.bodies) mesh.material = burnt;
    }
  }
}

/** Pickup models for close-combat weapons. */
function buildMeleeModel(kind: MeleeKind, mat: StandardMaterial, root: TransformNode): void {
  const wood = material('melee-wood', '#7a5a3a', 0.15), dark = material('melee-dark', '#2c3430', 0.15);
  const flat = (name: string, diameter: number, thickness: number, y = 0, z = 0) => {
    const mesh = CreateCylinder(name, { diameter, height: thickness, tessellation: 14 }, scene);
    mesh.parent = root; mesh.position.set(0, y, z); mesh.material = mat; mesh.isPickable = false; return mesh;
  };
  if (kind === 'pan') {
    const pan = flat('pan-dish', 0.34, 0.04); pan.rotation.x = Math.PI / 2; pan.position.z = 0.1;
    box('pan-handle', 0.05, 0.04, 0.3, dark, new Vector3(0, 0, -0.18), root).isPickable = false;
  } else if (kind === 'machete') {
    box('machete-blade', 0.07, 0.015, 0.5, mat, new Vector3(0, 0, 0.1), root).isPickable = false;
    box('machete-handle', 0.04, 0.04, 0.16, dark, new Vector3(0, 0, -0.22), root).isPickable = false;
  } else if (kind === 'crowbar') {
    box('crowbar-shaft', 0.035, 0.035, 0.5, mat, new Vector3(0, 0, 0), root).isPickable = false;
    const hook = box('crowbar-hook', 0.035, 0.035, 0.12, mat, new Vector3(0, 0.05, 0.24), root); hook.rotation.x = 0.6; hook.isPickable = false;
  } else {
    box('sickle-handle', 0.04, 0.04, 0.2, wood, new Vector3(0, 0, -0.15), root).isPickable = false;
    const arc = MeshBuilder.CreateTorus('sickle-blade', { diameter: 0.3, thickness: 0.025, tessellation: 20 }, scene);
    arc.parent = root; arc.position.set(0, 0, 0.1); arc.material = mat; arc.isPickable = false;
  }
}

const PACK_COLOR: Record<PackKind, string> = { pack1: '#6f7a5a', pack2: '#5a7a8a', pack3: '#8a6a3a' };

/** Pickup models for backpacks and gun parts: a rucksack, a scope tube, a suppressor, a grip, a magazine. */
function buildGearModel(kind: PackKind | AttachKind, mat: StandardMaterial, root: TransformNode): void {
  const dark = material('gear-dark', '#2c3430', 0.15), metal = material('gear-metal', '#8f9a94', 0.2);
  const tube = (name: string, diameter: number, length: number, m: StandardMaterial, y = 0) => {
    const mesh = CreateCylinder(name, { diameter, height: length, tessellation: 10 }, scene);
    mesh.rotation.x = Math.PI / 2; mesh.position.y = y; mesh.parent = root; mesh.material = m; mesh.isPickable = false;
  };
  if (isPackKind(kind)) {
    box('pack-body', 0.4, 0.46, 0.2, mat, new Vector3(0, 0.05, 0), root).isPickable = false;
    box('pack-flap', 0.42, 0.14, 0.23, dark, new Vector3(0, 0.22, 0), root).isPickable = false;
    box('pack-pocket', 0.26, 0.2, 0.08, dark, new Vector3(0, -0.02, -0.12), root).isPickable = false;
    return;
  }
  if (kind.startsWith('scope')) {
    tube('scope-tube', 0.09, 0.34, mat);
    tube('scope-lens', 0.12, 0.05, dark, 0);
    box('scope-mount', 0.06, 0.05, 0.18, metal, new Vector3(0, -0.07, 0), root).isPickable = false;
  } else if (kind === 'suppressor') {
    tube('suppressor', 0.08, 0.36, mat);
    tube('suppressor-cap', 0.05, 0.04, dark);
  } else if (kind === 'compensator') {
    tube('comp-body', 0.07, 0.16, mat);
    for (const dz of [-0.04, 0.02]) box('comp-fin', 0.12, 0.012, 0.015, metal, new Vector3(0, 0, dz), root).isPickable = false;
  } else if (kind === 'vgrip' || kind === 'agrip') {
    const handle = box('grip', 0.05, 0.2, 0.05, mat, new Vector3(0, 0, 0), root); handle.isPickable = false;
    if (kind === 'agrip') handle.rotation.x = 0.7;
    box('grip-base', 0.08, 0.04, 0.12, metal, new Vector3(0, 0.12, 0), root).isPickable = false;
  } else {
    const mag = box('ext-mag', 0.09, 0.3, 0.16, mat, new Vector3(0, 0, 0), root); mag.isPickable = false; mag.rotation.x = 0.15;
    box('ext-mag-base', 0.1, 0.03, 0.17, metal, new Vector3(0, -0.15, 0), root).isPickable = false;
  }
}

const SUPPLY_COLOR: Record<SupplyKind, string> = { bandage: '#f0eee2', firstaid: '#d9503f', painkiller: '#e8a33a', energy: '#4aa8e0', frag: '#5a6b4a', smoke: '#9aa3a0', flash: '#d8d8c8', molotov: '#8a5a3a' };

/** Small pickup models for the pack items: a roll of bandage, a pill bottle, a drink can, a grenade. */
function buildSupplyModel(kind: SupplyKind, mat: StandardMaterial, root: TransformNode): void {
  const part = (mesh: Mesh) => { mesh.parent = root; mesh.isPickable = false; return mesh; };
  switch (kind) {
    case 'bandage': {
      box('bandage', 0.36, 0.14, 0.26, mat, new Vector3(0, 0, 0), root).isPickable = false;
      box('bandage-stripe', 0.08, 0.145, 0.27, material('bandage-stripe', '#d84a3a', 0.2), new Vector3(0, 0, 0), root).isPickable = false;
      break;
    }
    case 'painkiller': {
      const bottle = part(CreateCylinder('pill-bottle', { diameter: 0.2, height: 0.32, tessellation: 10 }, scene)); bottle.material = mat;
      const cap = part(CreateCylinder('pill-cap', { diameter: 0.21, height: 0.07, tessellation: 10 }, scene)); cap.material = material('pill-cap', '#f4f2e8', 0.2); cap.position.y = 0.19;
      break;
    }
    case 'energy': {
      const can = part(CreateCylinder('energy-can', { diameter: 0.2, height: 0.34, tessellation: 12 }, scene)); can.material = mat;
      const lid = part(CreateCylinder('energy-lid', { diameter: 0.205, height: 0.03, tessellation: 12 }, scene)); lid.material = material('energy-lid', '#cfd6d8', 0.2); lid.position.y = 0.185;
      break;
    }
    default: {
      const body = part(CreateSphere('grenade-body', { diameter: 0.3, segments: 8 }, scene)); body.material = mat;
      box('grenade-cap', 0.1, 0.1, 0.1, material('grenade-cap', '#3a3d38', 0.1), new Vector3(0, 0.17, 0), root).isPickable = false;
    }
  }
}

const AMMO_COLOR: Record<AmmoType, string> = { '9mm': '#e0c070', '45acp': '#d8a860', '357': '#d09070', '556': '#9cc27a', '762': '#c8b078', '12g': '#d46a5a', '300': '#8fb4d8', '50cal': '#d8d27a', bolt: '#a4bf88', '40mm': '#d5a063', rocket: '#b99575' };

function createLootNode(loot: Loot): TransformNode {
  const root = new TransformNode(`loot-${loot.id}`, scene);
  const isMed = loot.kind === 'medkit' || loot.kind === 'firstaid', weapon = isWeaponKind(loot.kind) ? loot.kind : null;
  const supply = isSupplyKind(loot.kind) ? loot.kind as SupplyKind : null;
  const gear = isPackKind(loot.kind) || isAttachKind(loot.kind) ? loot.kind as AttachKind | PackKind : null;
  const melee = isMeleeKind(loot.kind) ? loot.kind as MeleeKind : null;
  const ammoType = ammoTypeOf(loot.kind);
  const armor = isArmorKind(loot.kind) ? parseArmor(loot.kind) : null;
  const tierColor = ['#9aa3a0', '#9aa3a0', '#4f8fd6', '#e0b13a'];
  const mat = material(`loot-${loot.kind}`, armor ? tierColor[armor.level] : supply ? SUPPLY_COLOR[supply] : melee ? '#9aa3a0' : gear ? (isPackKind(gear) ? PACK_COLOR[gear] : '#4a5650') : isMed ? '#88d4a4' : weapon ? WEAPONS[weapon].color : ammoType ? AMMO_COLOR[ammoType] : '#c1b77e', 0.25);
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
  } else if (melee) {
    buildMeleeModel(melee, mat, root);
  } else if (gear) {
    buildGearModel(gear, mat, root);
  } else if (supply && !isMed) {
    buildSupplyModel(supply, mat, root);
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
const GRENADE_COLOR: Record<ThrowKind | 'shell' | 'rocket', string> = { frag: '#4a5a3a', smoke: '#8a9390', flash: '#e8e8d8', molotov: '#8a5a34', shell: '#3a3d38', rocket: '#c9b46a' };
const grenadeMeshes = new Map<number, Mesh>();
const smokeClouds = new Map<number, { puffs: Mesh[]; material: StandardMaterial }>();
const fireBeds = new Map<number, { flames: Mesh[]; material: StandardMaterial }>();
/** A stable pseudo-random number from an id and a slot, so a cloud or a fire always looks the same. */
const scatter = (id: number, slot: number): number => { const v = Math.sin(id * 12.9898 + slot * 78.233) * 43758.5453; return v - Math.floor(v); };

/** Grenades in the air, smoke clouds and burning ground: built when they appear, removed when they are gone. */
function renderGrenades(time: number) {
  const state = sim.state;
  const liveShells = new Set<number>();
  for (const p of state.projectiles ?? []) {
    liveShells.add(p.id);
    let mesh = grenadeMeshes.get(p.id);
    if (!mesh) {
      mesh = p.kind === 'molotov' ? CreateCylinder('grenade', { diameter: 0.13, height: 0.28, tessellation: 8 }, scene)
        : p.kind === 'rocket' ? CreateCylinder('rocket', { diameter: 0.16, height: 0.8, tessellation: 8 }, scene)
        : CreateSphere('grenade', { diameter: p.kind === 'shell' ? 0.16 : 0.22, segments: 6 }, scene);
      mesh.material = material(`grenade-${p.kind}`, GRENADE_COLOR[p.kind], 0.2);
      mesh.isPickable = false;
      grenadeMeshes.set(p.id, mesh);
    }
    mesh.position.set(p.x, p.y, p.z);
    if (p.kind === 'rocket' || p.kind === 'shell') { const speed = Math.hypot(p.vx, p.vy, p.vz) || 1; mesh.rotation.set(Math.asin(-p.vy / speed) + Math.PI / 2, Math.atan2(p.vx, p.vz), 0); }
    else { mesh.rotation.x = time * 9; mesh.rotation.z = time * 6; }
  }
  for (const [id, mesh] of grenadeMeshes) if (!liveShells.has(id)) { mesh.dispose(); grenadeMeshes.delete(id); }

  const liveClouds = new Set<number>();
  for (const smoke of state.smokes ?? []) {
    liveClouds.add(smoke.id);
    let cloud = smokeClouds.get(smoke.id);
    if (!cloud) {
      const skin = new StandardMaterial(`smoke-${smoke.id}`, scene);
      skin.diffuseColor = new Color3(0.8, 0.82, 0.82); skin.emissiveColor = new Color3(0.42, 0.44, 0.44); skin.specularColor = Color3.Black();
      skin.alpha = 0.85; skin.backFaceCulling = false;
      const puffs = Array.from({ length: 11 }, (_, i) => {
        const puff = CreateSphere(`smoke-puff-${smoke.id}-${i}`, { diameter: 4.4 + scatter(smoke.id, i) * 2.6, segments: 8 }, scene);
        puff.material = skin; puff.isPickable = false;
        return puff;
      });
      cloud = { puffs, material: skin };
      smokeClouds.set(smoke.id, cloud);
    }
    const swell = Math.min(1, 0.25 + (state.elapsed - smoke.born) / 1.6);
    cloud.material.alpha = 0.84 * Math.min(1, Math.max(0, (smoke.until - state.elapsed) / 4));
    cloud.puffs.forEach((puff, i) => {
      const angle = scatter(smoke.id, i + 20) * Math.PI * 2, reach = scatter(smoke.id, i + 40) * smoke.radius * 0.55 * swell;
      puff.scaling.setAll(swell);
      puff.position.set(smoke.x + Math.cos(angle) * reach + Math.sin(time * 0.4 + i) * 0.25, smoke.y + 1.2 + scatter(smoke.id, i + 60) * 3.2 * swell, smoke.z + Math.sin(angle) * reach + Math.cos(time * 0.35 + i) * 0.25);
    });
  }
  for (const [id, cloud] of smokeClouds) if (!liveClouds.has(id)) { cloud.puffs.forEach(puff => puff.dispose()); cloud.material.dispose(); smokeClouds.delete(id); }

  const liveFires = new Set<number>();
  for (const fire of state.fires ?? []) {
    liveFires.add(fire.id);
    let bed = fireBeds.get(fire.id);
    if (!bed) {
      const glow = new StandardMaterial(`fire-${fire.id}`, scene);
      glow.emissiveColor = new Color3(1, 0.5, 0.12); glow.diffuseColor = Color3.Black(); glow.alpha = 0.8; glow.disableLighting = true;
      const flames = Array.from({ length: 9 }, (_, i) => {
        const flame = CreateCylinder(`flame-${fire.id}-${i}`, { diameterTop: 0, diameterBottom: 0.9, height: 1.6, tessellation: 6 }, scene);
        flame.material = glow; flame.isPickable = false;
        return flame;
      });
      bed = { flames, material: glow };
      fireBeds.set(fire.id, bed);
    }
    bed.material.alpha = 0.8 * Math.min(1, Math.max(0, (fire.until - state.elapsed) / 1.5));
    bed.flames.forEach((flame, i) => {
      const angle = scatter(fire.id, i) * Math.PI * 2, reach = Math.sqrt(scatter(fire.id, i + 30)) * fire.radius * 0.85;
      const height = 0.7 + 0.5 * Math.sin(time * 9 + i * 1.7) + scatter(fire.id, i + 50) * 0.6;
      flame.scaling.set(1 + 0.2 * Math.sin(time * 7 + i), height, 1 + 0.2 * Math.cos(time * 6 + i));
      flame.position.set(fire.x + Math.cos(angle) * reach, fire.y + 0.8 * height, fire.z + Math.sin(angle) * reach);
    });
  }
  for (const [id, bed] of fireBeds) if (!liveFires.has(id)) { bed.flames.forEach(flame => flame.dispose()); bed.material.dispose(); fireBeds.delete(id); }
}

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
  const chosen = playing && sim.state.phase === 'playing' ? lootChoiceId : null;
  let selected: Loot | null = null;
  for (const { node, loot } of lootMeshes.values()) {
    node.position.set(loot.position.x, loot.position.y + 0.45 + Math.sin(time * 2 + loot.position.x) * 0.07, loot.position.z);
    node.rotation.y = time * 0.45;
    const isChosen = chosen !== null && loot.id === chosen;
    node.scaling.setAll(isChosen ? 1.3 : 1);
    if (isChosen) selected = loot;
  }
  if (!lootSelector || lootSelector.isDisposed()) {
    lootSelector = MeshBuilder.CreateTorus('loot-selector', { diameter: 1.5, thickness: 0.07, tessellation: 32 }, scene);
    lootSelector.isPickable = false;
    const glow = new StandardMaterial('loot-selector-material', scene);
    glow.disableLighting = true; glow.emissiveColor = new Color3(1, 0.72, 0.1); glow.fogEnabled = false;
    lootSelector.material = glow;
  }
  lootSelector.setEnabled(!!selected);
  if (selected) {
    lootSelector.position.set(selected.position.x, selected.position.y + 0.17, selected.position.z);
    const pulse = 1 + Math.sin(time * 6) * 0.08;
    lootSelector.scaling.set(pulse, pulse, pulse);
  }
}

function renderZone() {
  const zone = sim.state.zone;
  const show = sim.state.phase !== 'menu' && sim.world.id !== 'range';
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

/**
 * The lobby's stage: a cool rim light behind the soldier, two slowly turning hex rings and a soft glow on the ground,
 * and a few dozen dust motes drifting through the light. Built on first use, shown only while the menu is up.
 */
interface MenuStage { rim: DirectionalLight; rings: Mesh[]; glow: Mesh; pulse: Mesh; motes: Array<{ node: InstancedMesh; seed: number }>; }
let menuStage: MenuStage | null = null;

function glowMaterial(name: string, color: string, alpha: number): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.disableLighting = true; material.emissiveColor = Color3.FromHexString(color); material.alpha = alpha; material.fogEnabled = false; material.backFaceCulling = false;
  return material;
}

function buildMenuStage(): MenuStage {
  const rim = new DirectionalLight('menu-rim', new Vector3(0.53, -0.05, -0.85), scene);
  rim.diffuse = Color3.FromHexString('#8fd0ff'); rim.specular = Color3.Black(); rim.intensity = 1.1;
  const ringA = CreateTorus('menu-ring-a', { diameter: 3.1, thickness: 0.05, tessellation: 6 }, scene);
  ringA.material = glowMaterial('menu-ring-a-material', '#f5b50a', 0.9);
  const ringB = CreateTorus('menu-ring-b', { diameter: 4.4, thickness: 0.03, tessellation: 6 }, scene);
  ringB.material = glowMaterial('menu-ring-b-material', '#f5b50a', 0.5);
  const pulse = CreateTorus('menu-ring-pulse', { diameter: 2.2, thickness: 0.012, tessellation: 64 }, scene);
  pulse.material = glowMaterial('menu-ring-pulse-material', '#ffe28a', 0.7);
  const glow = CreateCylinder('menu-glow', { diameter: 3.6, height: 0.01, tessellation: 48 }, scene);
  glow.material = glowMaterial('menu-glow-material', '#f5b50a', 0.14);
  const meshes = [ringA, ringB, pulse, glow];
  for (const mesh of meshes) { mesh.isPickable = false; mesh.receiveShadows = false; }
  const template = CreateSphere('menu-mote', { diameter: 1, segments: 4 }, scene);
  template.material = glowMaterial('menu-mote-material', '#ffd98a', 0.55);
  template.isPickable = false; template.setEnabled(false);
  const motes = Array.from({ length: 64 }, (_, index) => ({ node: template.createInstance(`menu-mote-${index}`), seed: index * 12.9898 }));
  for (const mote of motes) mote.node.isPickable = false;
  return { rim, rings: [ringA, ringB, pulse], glow, pulse, motes };
}

function updateMenuStage(show: boolean, dt: number) {
  if (!show && !menuStage) return;
  if (show && (!menuStage || menuStage.glow.isDisposed())) menuStage = buildMenuStage();
  const stage = menuStage!;
  stage.rim.setEnabled(show);
  for (const mesh of [...stage.rings, stage.glow]) mesh.setEnabled(show);
  for (const mote of stage.motes) mote.node.setEnabled(show);
  if (!show) return;
  const t = performance.now() * 0.001, p = sim.player.position;
  menuPointer.sx += (menuPointer.x - menuPointer.sx) * Math.min(1, dt * 3);
  menuPointer.sy += (menuPointer.y - menuPointer.sy) * Math.min(1, dt * 3);
  const y = p.y + 0.035;
  stage.rings[0].position.set(p.x, y, p.z); stage.rings[0].rotation.y = t * 0.35;
  stage.rings[1].position.set(p.x, y, p.z); stage.rings[1].rotation.y = -t * 0.2;
  stage.pulse.position.set(p.x, y, p.z);
  const breathe = 1 + ((t * 0.8) % 1) * 0.55;
  stage.pulse.scaling.set(breathe, 1, breathe);
  (stage.pulse.material as StandardMaterial).alpha = 0.7 * (1 - ((t * 0.8) % 1));
  stage.glow.position.set(p.x, y - 0.015, p.z);
  for (const { node, seed } of stage.motes) {
    const rise = (t * (0.05 + (Math.sin(seed) * 0.5 + 0.5) * 0.08) + (Math.sin(seed * 3.1) * 0.5 + 0.5) * 4) % 4;
    node.position.set(p.x + Math.sin(seed * 1.7) * 4.2 + Math.sin(t * 0.3 + seed) * 0.35, p.y + rise * 0.9, p.z + Math.cos(seed * 2.3) * 3.4 + Math.cos(t * 0.25 + seed) * 0.3);
    const size = 0.018 + (Math.sin(seed * 5.3) * 0.5 + 0.5) * 0.03;
    node.scaling.set(size, size, size);
  }
}

function updateCamera(dt: number) {
  updateMenuStage(sim.state.phase === 'menu', dt);
  if (sim.state.phase === 'menu') { const gun = WEAPONS[sim.player.weapon]; ui.setSpotGear(`${gun.label} · ${gun.category}`); }
  if (sim.state.phase === 'menu') {
    // Lobby shot: a low, close three-quarter angle on the soldier (left of centre; the panel fills the right) with a slow
    // sway, leaning a little towards the pointer so the scene feels alive.
    const t = performance.now() * 0.001;
    const p = sim.player.position;
    camera.position.set(p.x + 3.0 + Math.sin(t * 0.25) * 0.7 + menuPointer.sx * 0.55, p.y + 1.0 + Math.sin(t * 0.4) * 0.06 - menuPointer.sy * 0.12, p.z - 4.4 + Math.cos(t * 0.25) * 0.4);
    camera.setTarget(new Vector3(p.x + 1.0 - menuPointer.sx * 0.25, p.y + 1.15 - menuPointer.sy * 0.08, p.z));
    camera.fov = 0.62; return;
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
  if (aiming && isScope() && sim.state.phase === 'playing') {
    // Down the scope: the camera sits at the eye and the scope overlay stands in for the gun. The crosshair drifts a little unless the breath is held.
    camera.position.copyFrom(pivot);
    scopeSway += ((sim.player.holding ? 0.15 : sim.player.winded ? 1.7 : 1) - scopeSway) * Math.min(1, dt * 5);
    const t = performance.now() * 0.001, amplitude = 0.0017 * scopeSway;
    const swayYaw = (Math.sin(t * 0.83) + 0.45 * Math.sin(t * 2.1 + 1.3)) * amplitude, swayPitch = (Math.cos(t * 1.07) + 0.4 * Math.sin(t * 2.6)) * amplitude;
    const drifted = new Vector3(Math.sin(yaw + swayYaw) * Math.cos(viewPitch + swayPitch), Math.sin(viewPitch + swayPitch), Math.cos(yaw + swayYaw) * Math.cos(viewPitch + swayPitch));
    camera.setTarget(pivot.add(drifted.scale(200)));
    camera.fov += (fovFor(activeZoom()) - camera.fov) * Math.min(1, dt * 16);
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
  // Over the shoulder a plain sight zooms a little; a scope never gets here.
  const targetFov = aiming ? fovFor(activeZoom()) : 0.92;
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
  scene.fogDensity = mode === 'plane' || mode === 'freefall' ? 0.0004 : mode === 'chute' ? 0.0009 : sim.world.theme?.fogDensity ?? 0.0024;
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

/** Stairwells to and from the bunkers: a glowing pad with a faint column over it, for the few that are near. */
const portalMarkers: Array<{ pad: Mesh; column: Mesh }> = [];
function renderPortals() {
  const portals = sim.world.portals;
  let used = 0;
  if (portals?.length && sim.state.phase !== 'menu') {
    const at = focusPosition();
    for (const portal of portals) {
      if (Math.abs(portal.y - at.y) > 6 || Math.abs(portal.x - at.x) > 40 || Math.abs(portal.z - at.z) > 40) continue;
      let marker = portalMarkers[used];
      if (!marker) {
        const pad = MeshBuilder.CreateCylinder('portal-pad', { diameter: 1.7, height: 0.06, tessellation: 20 }, scene);
        const column = MeshBuilder.CreateCylinder('portal-column', { diameter: 1.5, height: 2.6, tessellation: 16, cap: 0 }, scene);
        for (const mesh of [pad, column]) { mesh.isPickable = false; mesh.material = material(mesh === pad ? 'portal-down' : 'portal-glow', '#ffffff', 1); }
        marker = { pad, column }; portalMarkers.push(marker);
      }
      const tint = portal.down ? '#ffb43a' : '#6fe0ff';
      const pad = material(`portal-pad-${portal.down ? 'd' : 'u'}`, tint, 1), glow = material(`portal-glow-${portal.down ? 'd' : 'u'}`, tint, 1);
      pad.disableLighting = true; glow.disableLighting = true; glow.alpha = 0.22; glow.backFaceCulling = false;
      marker.pad.material = pad; marker.column.material = glow;
      marker.pad.position.set(portal.x, portal.y + 0.06, portal.z); marker.column.position.set(portal.x, portal.y + 1.3, portal.z);
      marker.pad.setEnabled(true); marker.column.setEnabled(true);
      used++;
    }
  }
  for (let i = used; i < portalMarkers.length; i++) { portalMarkers[i].pad.setEnabled(false); portalMarkers[i].column.setEnabled(false); }
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
    recoil = Math.min(0.13, recoil + weapon.recoil * rigStats(sim.player, sim.player.weapon).recoil * settings.recoilScale * STANCE[sim.player.stance ?? 'stand'].recoil);
  }
}

/** Get in or out of a car and reset aim state so nothing carries over. */
function useVehicle() {
  if (!doVehicle()) return;
  aiming = false; shooting = false; triggerPending = false; recoil = 0;
  mobile?.cancelFire();
}

/** The shooting range: take any gun. */
function doRangeEquip(weapon: WeaponType) {
  if (!sim.rangeEquip(weapon)) return;
  void audio.unlock();
  aiming = false; shooting = false; triggerPending = false; recoil = 0;
  mobile?.cancelFire();
  const old = models.get(sim.localId);
  old?.soldier.setWeapon(weapon);
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

/** The magnification remembered for each gun's sight; undefined means "full zoom", which is where a scope starts. */
const rememberedZoom = new Map<string, number>();
let aimZoom: number | undefined;
const aimLevels = () => zoomLevels(rigStats(sim.player, sim.player.weapon).zoom);
/** The magnification in use: 1 off the sights, otherwise the chosen level of this gun's sight. */
function activeZoom(): number { return aiming ? clampZoom(aimLevels(), aimZoom) : 1; }
/** The gun in hand has a scope (4x and up) to look through; other guns are aimed over the shoulder. */
const isScope = () => rigStats(sim.player, sim.player.weapon).zoom >= SCOPE_FROM;

/** Zoom a scope in (+1) or out (-1); a close-range sight has one level and stays as it is. */
function changeZoom(direction: number): boolean {
  if (!aiming || !isScope()) return false;
  const levels = aimLevels(), next = stepZoom(levels, activeZoom(), direction);
  if (next === activeZoom()) return true;
  aimZoom = next;
  rememberedZoom.set(sim.player.weapon, next);
  void audio.unlock();
  return true;
}

function beginAim() {
  aimZoom = rememberedZoom.get(sim.player.weapon);
  if (isScope()) {
    ui.tip('breath', touchDevice ? 'Giữ nút NÍN THỞ khi ngắm ống nhắm: tâm ổn định, đạn đi thẳng hơn, nhưng chỉ được vài giây.' : 'Giữ Shift (đứng yên) khi ngắm ống nhắm để nín thở: tâm ổn định hơn và đường đạn thẳng hơn, nhưng chỉ được vài giây. Lăn chuột để đổi độ phóng đại.');
    const range = WEAPONS[sim.player.weapon].range;
    const ray = camera.getForwardRay(range);
    const pick = scene.pickWithRay(ray, mesh => mesh.isEnabled() && !!mesh.metadata && mesh.metadata.actorId !== sim.localId && (!!mesh.metadata.solid || !!sim.state.actors.find(actor => actor.id === mesh.metadata.actorId)?.alive));
    const target = pick?.pickedPoint ?? ray.origin.add(ray.direction.scale(range));
    const dx = target.x - sim.player.position.x, dz = target.z - sim.player.position.z;
    yaw = Math.atan2(dx, dz);
    pitch = Math.atan2(target.y - sim.player.position.y - eyeHeight, Math.hypot(dx, dz));
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
    if (event.type === 'damage' && event.sourceId === sim.localId && sim.rangeMode && event.actorId !== sim.localId) {
      const target = sim.actorById(event.actorId), gun = WEAPONS[sim.player.weapon];
      if (target) {
        const distance = Math.hypot(target.position.x - sim.player.position.x, target.position.z - sim.player.position.z);
        ui.rangeHit(event.amount, distance, event.amount > gun.damage * 1.3 && gun.kind !== 'shotgun');
      }
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
    if (event.type === 'flash') {
      const burst = CreateSphere('flash-burst', { diameter: 3, segments: 10 }, scene);
      const glare = new StandardMaterial('flash-burst', scene);
      glare.emissiveColor = new Color3(1, 1, 0.92); glare.diffuseColor = Color3.Black(); glare.alpha = 0.9; glare.disableLighting = true;
      burst.material = glare; burst.isPickable = false; burst.position.set(event.position.x, event.position.y + 0.6, event.position.z);
      effects.push({ mesh: burst, remaining: 0.4, total: 0.4, grow: 7 });
    }
    if (event.type === 'explosion') {
      const flash = CreateSphere('blast', { diameter: 2, segments: 8 }, scene);
      const blastMaterial = new StandardMaterial('blast', scene);
      blastMaterial.emissiveColor = new Color3(1, 0.6, 0.2); blastMaterial.diffuseColor = Color3.Black(); blastMaterial.alpha = 0.85; blastMaterial.disableLighting = true;
      flash.material = blastMaterial; flash.isPickable = false; flash.position.set(event.position.x, event.position.y + 1, event.position.z);
      effects.push({ mesh: flash, remaining: 0.5, total: 0.5, grow: event.radius ? event.radius * 0.55 : 4 });
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
  if (sim.rangeMode && !event.repeat && !mpMenuOpen && !ui.mapOpen) {
    if (event.code === 'KeyB') { event.preventDefault(); ui.toggleArmoury(); return; }
    if (event.code === 'KeyK') { ui.toggleImmortal(); return; }
  }
  if (gameplayInputBlocked()) return;
  if (event.code === 'Space' && event.target instanceof Element && event.target.closest('button, [role="button"]')) return;
  if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight'].includes(event.code)) event.preventDefault();
  keys.add(event.code);
  if (event.repeat) return;
  // A quick tap on Space (jump from the plane, open the canopy) can be over before the next frame reads the keys.
  if (event.code === 'Space' && sim.airborne) pendingJump = true;
  if (event.code === 'KeyR' && doReload()) audio.reload();
  if (event.code === 'KeyH' && doHeal()) audio.heal();
  if (event.code === 'KeyJ' && doBoost()) audio.heal();
  if (event.code === 'KeyG' && !sim.airborne) doThrow();
  if (event.code === 'KeyX' && !event.repeat && sim.state.phase === 'playing' && !gameplayInputBlocked()) doMelee();
  if (event.code === 'KeyV' && !event.repeat) doThrowSelect();
  if ((event.code === 'KeyE' || event.code === 'KeyF') && sim.airborne) pendingJump = true;
  else if (event.code === 'KeyE' && !doInteract()) useVehicle();
  else if (event.code === 'KeyF') useVehicle();
  else if ((event.code === 'ArrowUp' || event.code === 'ArrowDown') && sim.state.phase === 'playing' && !gameplayInputBlocked()) { event.preventDefault(); cycleLoot(event.code === 'ArrowDown' ? 1 : -1); }
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
// On a phone, tapping the pickup hint moves on to the next item in reach.
document.getElementById('interaction-hint')?.addEventListener('click', () => { if (touchDevice && nearLoot.length > 1) cycleLoot(1); });
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
  event.preventDefault();
  if (aiming && !event.altKey && isScope()) { changeZoom(event.deltaY < 0 ? 1 : -1); return; }
  if (event.altKey) cycleLoot(event.deltaY >= 0 ? 1 : -1); else cycleWeapon(event.deltaY >= 0 ? 1 : -1);
}, { passive: false });
window.addEventListener('mousemove', event => {
  if (touchDevice || sim.state.phase !== 'playing' || gameplayInputBlocked() || (document.pointerLockElement !== canvas && !shooting && !aiming)) return;
  const sensitivity = 0.0016 * settings.sensitivity * (aiming ? 0.72 / Math.sqrt(activeZoom()) : 1);
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
      const sprint = !gameplayInputBlocked() && (keys.has('ShiftLeft') || keys.has('ShiftRight') || !!mobile?.movement.sprint || mobileBreath);
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
    renderGrenades(performance.now() * 0.001);
    renderPlane(); renderFlag(); renderAirdrops(); renderPortals();
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
    {
      const at = focusPosition();
      const below = sim.state.phase !== 'menu' && !!islandRenderer && at.y < sim.heightAt(at.x, at.z) - DEEP;
      setUnderground(below);
      if (below && lamp) lamp.position.set(camera.position.x, camera.position.y + 0.3, camera.position.z);
    }
    if (sim.state.phase === 'playing' && !underground) {
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
    const loot = refreshLootChoice();
    const nearbyCar = sim.vehicleInReach;
    if (loot) ui.tip('loot', touchDevice ? 'Chạm nút Nhặt để lấy đồ. Bạn mang tối đa 2 súng thường và 1 súng lục; hầu hết đồ nằm trong nhà.' : 'Nhấn E để nhặt đồ; có nhiều món gần nhau thì ↑/↓ (hoặc Alt + lăn chuột) để chọn món. Bạn mang tối đa 2 súng thường và 1 súng lục; hầu hết đồ nằm trong nhà.');
    if (nearbyCar) ui.tip('car', touchDevice ? 'Chạm nút Nhặt để lên xe: đi xa rất nhanh nhưng bạn không bắn được khi đang lái.' : 'Nhấn F để lên xe: đi xa rất nhanh nhưng bạn không bắn được khi đang lái.');
    if (sim.player.alive && sim.player.health < 50 && (sim.player.medkits > 0 || sim.player.supplies.bandage > 0 || sim.player.supplies.firstaid > 0)) ui.tip('heal', touchDevice ? 'Chạm nút Hồi máu và đứng yên khoảng 3 giây để dùng túi cứu thương.' : 'Nhấn H và đứng yên khoảng 3 giây để dùng túi cứu thương.');
    const stairs = !loot && !sim.player.vehicleId && !sim.player.air ? sim.portalNear() : null;
    const hint = sim.player.air ? '' : stairs ? `${touchDevice ? 'Chạm Nhặt' : '[E]'} để ${stairs.down ? stairs.label.charAt(0).toLowerCase() + stairs.label.slice(1) : 'lên mặt đất'}` : sim.player.vehicleId ? `${touchDevice ? 'Chạm Nhặt' : '[F]'} để xuống xe` : loot ? `${touchDevice ? '' : '[E] '}Nhặt ${lootLabel(loot.kind)}${nearLoot.length > 1 ? ` (${nearLoot.indexOf(loot) + 1}/${nearLoot.length}) · ${touchDevice ? 'chạm để đổi món' : '↑↓ chọn món'}` : ''}` : nearbyCar ? `${touchDevice ? '' : '[F] '}Lên ${VEHICLES[kindOf(nearbyCar)].label.toLowerCase()}` : sim.player.healing > 0 ? 'Đang hồi máu…' : sim.player.reloading > 0 ? 'Đang nạp đạn…' : !touchDevice && document.pointerLockElement !== canvas && sim.state.phase === 'playing' ? 'Nhấp vào màn hình để điều khiển chuột' : '';
    if (!touchDevice || now - lastHudTime >= 90 || hudPhase !== sim.state.phase || hudWeapon !== sim.player.weapon) {
      ui.update(sim.state, sim.world, hint);
      ui.updateInventory(sim.player, ui.inventoryOpen ? sim.nearbyLoot() : [], !!net);
      lastHudTime = now; hudPhase = sim.state.phase; hudWeapon = sim.player.weapon;
    }
    ui.setBreath((sim.player.breath ?? BREATH_SECONDS) / BREATH_SECONDS, !!sim.player.holding, !!sim.player.winded);
    if (!!sim.player.holding !== wasHolding) { wasHolding = !!sim.player.holding; if (aiming) audio.breath(wasHolding); }
    ui.setAim(aiming && sim.state.phase === 'playing' && !gameplayInputBlocked(), sim.player.weapon, { zoom: activeZoom(), max: rigStats(sim.player, sim.player.weapon).zoom });
    mobile?.setEnabled(sim.state.phase === 'playing' && !gameplayInputBlocked());
    const drivenCar = sim.player.vehicleId ? sim.state.vehicles.find(v => v.id === sim.player.vehicleId) : undefined;
    ui.setVehicle(drivenCar ? { speed: drivenCar.speed, health: drivenCar.health / VEHICLES[kindOf(drivenCar)].health } : null);
    // Frame-rate readout, refreshed twice a second from the last 120 frames.
    frameTimes.push(dt * 1000);
    if (frameTimes.length > 120) frameTimes.shift();
    if (!settings.showFps) ui.setPerf(null);
    else if (now - lastPerfAt >= 500) {
      lastPerfAt = now;
      const average = frameTimes.reduce((sum, value) => sum + value, 0) / Math.max(1, frameTimes.length);
      ui.setPerf(`${Math.round(engine.getFps())} FPS · khung TB ${average.toFixed(1)} ms · tệ nhất ${Math.max(...frameTimes).toFixed(0)} ms
${scene.getActiveMeshes().length} vật thể đang vẽ / ${scene.meshes.length} · ${sim.state.actors.filter(a => a.alive && a.air).length} người trên không${net?.client ? netReadout(net.client) : net?.host ? ' · chủ phòng' : ''}`);
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
      aiming, canThrow: !!sim.selectedThrow(), canPickup: !!loot || !!nearbyCar || !!drivenCar, reloading: sim.player.reloading > 0, healing: sim.player.healing > 0, stance: sim.player.stance ?? 'stand',
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
