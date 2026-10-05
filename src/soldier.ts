import type { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import { Color4 } from '@babylonjs/core/Maths/math.color.js';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { surfaceMaterial } from './surface-materials';
import type { SurfaceFinish } from './surface-materials';
import { ARM_FORE, ARM_UPPER, buildSoldierPart, FABRIC_PARTS, HIP_HEIGHT, KNEE_DROP, SHOULDER } from './soldier-geometry';
import type { PartName } from './soldier-geometry';
import { createWeaponModel } from './weapon-models';
import type { WeaponModel } from './weapon-models';
import type { WeaponType } from './types';

type Rgb = [number, number, number];
interface Outfit { camo: boolean; fabric: Rgb; skin: Rgb; hair: Rgb; hat: Rgb; headgear: 'hair' | 'cap' | 'beanie'; pack: 0 | 1 | 2 }

const CAMO_TINTS: Rgb[] = [[0.62, 0.8, 0.48], [1, 0.86, 0.58], [0.7, 0.76, 0.88], [0.55, 0.62, 0.45], [0.85, 0.82, 0.7]];
const PLAIN_TINTS: Rgb[] = [[0.4, 0.5, 0.72], [0.36, 0.38, 0.42], [0.64, 0.72, 0.45], [0.9, 0.78, 0.55], [0.66, 0.68, 0.72], [0.74, 0.46, 0.4]];
const SKIN: Rgb[] = [[1, 0.84, 0.7], [0.92, 0.72, 0.56], [0.78, 0.58, 0.42], [0.58, 0.4, 0.28], [0.4, 0.27, 0.2]];
const HAIR: Rgb[] = [[0.1, 0.08, 0.07], [0.32, 0.2, 0.12], [0.75, 0.6, 0.3], [0.55, 0.22, 0.1], [0.62, 0.62, 0.62]];
const HATS: Rgb[] = [[0.25, 0.3, 0.22], [0.15, 0.15, 0.17], [0.55, 0.45, 0.3], [0.5, 0.2, 0.18], [0.2, 0.28, 0.4]];
const TIER: Rgb[] = [[1, 1, 1], [0.55, 0.6, 0.5], [0.3, 0.52, 0.88], [0.92, 0.7, 0.22]];

function hash(text: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
}

/** A stable look for each soldier: the player is always the teal-and-amber one, bots vary. */
export function outfitFor(id: string, isPlayer: boolean): Outfit {
  if (isPlayer) return { camo: false, fabric: [0.36, 0.68, 0.62], skin: SKIN[1], hair: HAIR[1], hat: [0.95, 0.72, 0.3], headgear: 'cap', pack: 0 };
  const r = hash(id);
  const camo = r() < 0.6;
  const pick = <T,>(list: T[]) => list[Math.floor(r() * list.length)];
  const headgearRoll = r();
  return {
    camo, fabric: pick(camo ? CAMO_TINTS : PLAIN_TINTS), skin: pick(SKIN), hair: pick(HAIR), hat: pick(HATS),
    headgear: headgearRoll < 0.45 ? 'hair' : headgearRoll < 0.75 ? 'cap' : 'beanie', pack: Math.floor(r() * 3) as 0 | 1 | 2,
  };
}

const sources = new WeakMap<Scene, Map<string, Mesh[]>>();

/** Hidden source meshes for a part; every soldier's piece is an instance of these, so all soldiers batch together. */
function partSources(scene: Scene, part: PartName, camo: boolean): Mesh[] {
  let byKey = sources.get(scene);
  if (!byKey) { byKey = new Map(); sources.set(scene, byKey); scene.onDisposeObservable.add(() => sources.delete(scene)); }
  const key = `${part}:${camo ? 'c' : 'p'}`;
  const existing = byKey.get(key);
  if (existing && existing.every(m => !m.isDisposed())) return existing;
  const bag = buildSoldierPart(part, camo ? 'camoMono' : 'weave');
  const meshes: Mesh[] = [];
  for (const [finish, data] of bag.groups) {
    if (!data.indices.length) continue;
    const mesh = new Mesh(`soldier-${part}-${finish}`, scene);
    const vertexData = new VertexData();
    vertexData.positions = data.positions; vertexData.normals = data.normals; vertexData.colors = data.colors; vertexData.uvs = data.uvs; vertexData.indices = data.indices;
    vertexData.applyToMesh(mesh);
    mesh.material = surfaceMaterial(scene, finish as SurfaceFinish);
    mesh.registerInstancedBuffer('instanceColor', 4);
    mesh.isPickable = false;
    mesh.setEnabled(false);
    meshes.push(mesh);
  }
  byKey.set(key, meshes);
  return meshes;
}

/** Rotation taking the limb's rest direction (-Y) onto `to` (a unit vector). */
function aim(to: Vector3, out: Quaternion): Quaternion {
  const dot = -to.y;
  if (dot < -0.9999) return out.set(1, 0, 0, 0);
  // axis = from × to, with from = (0,-1,0)
  const x = -to.z, y = 0, z = to.x;
  out.set(x, y, z, 1 + dot);
  return out.normalize();
}

export interface Pose {
  /** Smoothed speed (0–8 m/s) and the stride phase, both owned by the caller. */
  moving: number; stride: number; alive: boolean; reloading: boolean; healing: boolean; time: number;
  /** Lobby display: relaxed, weapon held lower. */
  showcase?: boolean;
}

const GUN_SCALE = 0.68;

export class Soldier {
  readonly root: TransformNode;
  readonly gun: TransformNode;
  flash: { setEnabled(enabled: boolean): void };
  private readonly weapons = new Map<WeaponType, WeaponModel>();
  private current: WeaponModel | null = null;
  private currentId: WeaponType | null = null;
  private readonly hips: TransformNode[] = [];
  private readonly knees: TransformNode[] = [];
  private readonly shoulders: TransformNode[] = [];
  private readonly elbows: TransformNode[] = [];
  private readonly helmet: InstancedMesh[];
  private readonly headgear: InstancedMesh[];
  private readonly vest: InstancedMesh[];
  private gearKey = '';
  private kick = 0;
  private readonly tmp = { s: new Vector3(), t: new Vector3(), e: new Vector3(), axis: new Vector3(), pole: new Vector3(), dir: new Vector3(), q: new Quaternion() };

  constructor(private readonly scene: Scene, private readonly id: string, isPlayer: boolean, private readonly shadows: ShadowGenerator) {
    const outfit = outfitFor(id, isPlayer);
    const root = this.root = new TransformNode(`actor-${id}`, scene);
    const attach = (part: PartName, parent: TransformNode, tint: Rgb): InstancedMesh[] => {
      const out: InstancedMesh[] = [];
      for (const source of partSources(scene, part, FABRIC_PARTS.includes(part) && outfit.camo)) {
        const instance = source.createInstance(`${id}-${part}`);
        instance.parent = parent;
        instance.instancedBuffers.instanceColor = new Color4(tint[0], tint[1], tint[2], 1);
        instance.isPickable = true;
        instance.metadata = { actorId: id };
        shadows.addShadowCaster(instance);
        out.push(instance);
      }
      return out;
    };
    attach(`torso${outfit.pack}` as PartName, root, outfit.fabric);
    attach('head', root, outfit.skin);
    this.helmet = attach('helmet', root, TIER[1]);
    const headgearPart: PartName = outfit.headgear === 'hair' ? 'hair' : outfit.headgear === 'cap' ? 'cap' : 'beanie';
    this.headgear = attach(headgearPart, root, outfit.headgear === 'hair' ? outfit.hair : outfit.hat);
    this.vest = attach('vest', root, TIER[1]);
    for (const side of [-1, 1]) {
      const hip = new TransformNode('hip', scene); hip.parent = root; hip.position.set(side * 0.115, HIP_HEIGHT, 0);
      attach('thigh', hip, outfit.fabric);
      const knee = new TransformNode('knee', scene); knee.parent = hip; knee.position.set(0, -KNEE_DROP, 0);
      attach('shin', knee, outfit.fabric);
      this.hips.push(hip); this.knees.push(knee);
      const shoulder = new TransformNode('shoulder', scene); shoulder.parent = root; shoulder.position.set(side * SHOULDER[0], SHOULDER[1], SHOULDER[2]);
      shoulder.rotationQuaternion = new Quaternion();
      attach('upper', shoulder, outfit.fabric);
      const elbow = new TransformNode('elbow', scene); elbow.parent = root;
      elbow.rotationQuaternion = new Quaternion();
      attach('fore', elbow, outfit.fabric);
      this.shoulders.push(shoulder); this.elbows.push(elbow);
    }
    this.gun = new TransformNode('weapon', scene);
    this.gun.parent = root;
    this.gun.position.set(0.1, 1.36, 0.3);
    this.gun.scaling.setAll(GUN_SCALE);
    this.flash = this.gun; // replaced as soon as a weapon is set
    this.setGear(0, 0);
  }

  /** Draw the gun the actor currently holds, building its model on first use. */
  setWeapon(weapon: WeaponType): void {
    if (this.currentId === weapon) return;
    this.current?.root.setEnabled(false);
    let model = this.weapons.get(weapon);
    if (!model) {
      model = createWeaponModel(weapon, this.scene, this.gun, this.id);
      for (const mesh of model.root.getChildMeshes()) if (mesh !== model.flash) this.shadows.addShadowCaster(mesh);
      this.weapons.set(weapon, model);
    }
    model.root.setEnabled(true);
    this.current = model; this.currentId = weapon; this.flash = model.flash;
  }

  /** Helmet and vest appear only while worn, tinted by tier; without a helmet the soldier shows hair or a hat. */
  setGear(helmet: number, vest: number): void {
    const key = `${helmet}:${vest}`;
    if (key === this.gearKey) return;
    this.gearKey = key;
    for (const mesh of this.helmet) { mesh.setEnabled(helmet > 0); if (helmet > 0) mesh.instancedBuffers.instanceColor = new Color4(...TIER[helmet], 1); }
    for (const mesh of this.headgear) mesh.setEnabled(helmet === 0);
    for (const mesh of this.vest) { mesh.setEnabled(vest > 0); if (vest > 0) mesh.instancedBuffers.instanceColor = new Color4(...TIER[vest], 1); }
  }

  /** Muzzle flash and a small recoil kick. */
  fire(): void { this.flash.setEnabled(true); this.kick = 1; }
  endFlash(): void { this.flash.setEnabled(false); }

  setEnabled(enabled: boolean): void { this.root.setEnabled(enabled); }
  dispose(): void { this.root.dispose(false, false); }

  /** Walk cycle with knee bend, then the arms are solved to hold the gun's two hand positions. */
  pose(dt: number, p: Pose): void {
    this.kick = Math.max(0, this.kick - dt * 9);
    const walk = Math.min(1, p.moving / 5);
    for (let i = 0; i < 2; i++) {
      const phase = i === 0 ? p.stride : p.stride + Math.PI;
      this.hips[i].rotation.x = p.showcase ? (i === 0 ? -0.04 : 0.1) : -Math.sin(phase) * 0.62 * walk - 0.04;
      this.knees[i].rotation.x = p.showcase ? (i === 0 ? 0.1 : 0.2) : 0.1 + Math.max(0, Math.cos(phase)) * 0.85 * walk;
    }
    const breathe = Math.sin(p.time * 1.6) * 0.006;
    const bob = Math.abs(Math.sin(p.stride)) * 0.016 * walk;
    const pitch = p.showcase ? 0.35 : p.reloading ? 0.55 + Math.sin(p.time * 9) * 0.1 : p.healing ? 0.75 : 0;
    this.gun.rotation.x = pitch + breathe * 2;
    this.gun.position.set(0.1, 1.36 + breathe - bob * 0.6, 0.3 - this.kick * 0.045);
    this.solveArms(pitch + breathe * 2);
  }

  /** Two-bone arm IK: the right hand holds the grip, the left the fore-end. */
  private solveArms(pitch: number): void {
    if (!this.current) return;
    const { s, t, e, axis, pole, dir, q } = this.tmp;
    const cos = Math.cos(pitch), sin = Math.sin(pitch);
    for (let side = 0; side < 2; side++) {
      // Right arm (side 1) takes the grip anchor, left arm the fore anchor.
      const anchor = side === 1 ? this.current.grip : this.current.fore;
      const ay = anchor.y * GUN_SCALE, az = anchor.z * GUN_SCALE, ax = anchor.x * GUN_SCALE;
      t.set(this.gun.position.x + ax, this.gun.position.y + ay * cos - az * sin, this.gun.position.z + ay * sin + az * cos);
      const sign = side === 1 ? 1 : -1;
      s.set(sign * SHOULDER[0], SHOULDER[1], SHOULDER[2]);
      axis.copyFrom(t).subtractInPlace(s);
      let d = axis.length();
      const maxReach = ARM_UPPER + ARM_FORE - 0.002, minReach = Math.abs(ARM_UPPER - ARM_FORE) + 0.02;
      if (d > maxReach) { axis.scaleInPlace(maxReach / d); d = maxReach; t.copyFrom(s).addInPlace(axis); }
      else if (d < minReach) d = minReach;
      axis.scaleInPlace(1 / d);
      const a = (d * d + ARM_UPPER * ARM_UPPER - ARM_FORE * ARM_FORE) / (2 * d);
      const h = Math.sqrt(Math.max(0, ARM_UPPER * ARM_UPPER - a * a));
      // The elbow bends down and out, away from the body.
      pole.set(sign * 0.55, -1, -0.25);
      const along = Vector3.Dot(pole, axis);
      pole.subtractInPlace(dir.copyFrom(axis).scaleInPlace(along));
      pole.normalize();
      e.copyFrom(s).addInPlace(dir.copyFrom(axis).scaleInPlace(a)).addInPlace(dir.copyFrom(pole).scaleInPlace(h));
      const shoulder = this.shoulders[side], elbow = this.elbows[side];
      dir.copyFrom(e).subtractInPlace(s).normalize();
      aim(dir, q); shoulder.rotationQuaternion!.copyFrom(q);
      elbow.position.copyFrom(e);
      dir.copyFrom(t).subtractInPlace(e).normalize();
      aim(dir, q); elbow.rotationQuaternion!.copyFrom(q);
    }
  }
}
