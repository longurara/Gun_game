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
import { outfitFor } from './outfits';
import type { Outfit } from './outfits';
import { instantiateSwat } from './free-assets';
import { instantiateEnemy } from './enemy-assets';
import { enemyModelFor } from './enemy-catalog';
import type { EnemyModel } from './enemy-catalog';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';

type Rgb = [number, number, number];
const TIER: Rgb[] = [[1, 1, 1], [0.55, 0.6, 0.5], [0.3, 0.52, 0.88], [0.92, 0.7, 0.22]];

export { outfitFor };
export type { Outfit };

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
  /** 0..1 blend toward a crouch and toward lying prone (both 0 = standing). */
  crouch?: number; prone?: number;
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
  private swat: ReturnType<typeof instantiateSwat> | ReturnType<typeof instantiateEnemy> = null;
  private readonly enemy: EnemyModel | null;
  private readonly bodyMeshes: InstancedMesh[] = [];
  private importedMeshes: AbstractMesh[] = [];
  private detailed = true;
  private helmetTier = 0;
  private readonly outfit: Outfit;
  private swatClip: AnimationGroup | null = null;
  private swatTime = 0;
  private jersey: import('@babylonjs/core/Materials/standardMaterial.js').StandardMaterial | null = null;
  private readonly tmp = { s: new Vector3(), t: new Vector3(), e: new Vector3(), axis: new Vector3(), pole: new Vector3(), dir: new Vector3(), q: new Quaternion() };

  constructor(private readonly scene: Scene, private readonly id: string, isPlayer: boolean, private readonly shadows: ShadowGenerator, friend = false, skinId?: string) {
    const outfit = this.outfit = outfitFor(id, isPlayer, friend, skinId);
    this.enemy = !isPlayer && !friend ? enemyModelFor(id) : null;
    const root = this.root = new TransformNode(`actor-${id}`, scene);
    const bodyMeshes = this.bodyMeshes;
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
        bodyMeshes.push(instance);
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
    if ((isPlayer || friend) && (!skinId || skinId === 'default')) {
      this.swat = instantiateSwat(scene, root, id);
      if (this.swat) {
        this.importedMeshes = root.getChildMeshes().filter(mesh => mesh.name.includes('-swat-'));
        for (const mesh of bodyMeshes) if (!this.helmet.includes(mesh) && !this.vest.includes(mesh)) mesh.setEnabled(false);
        for (const mesh of root.getChildMeshes()) {
          if (!mesh.name.includes('-swat-')) continue;
          mesh.isPickable = true; mesh.metadata = { actorId: id, freeAsset: 'swat' };
          shadows.addShadowCaster(mesh);
          if (friend && mesh.material?.name === 'free-Swat') {
            this.jersey ??= mesh.material.clone(`${id}-swat-jersey`) as import('@babylonjs/core/Materials/standardMaterial.js').StandardMaterial;
            this.jersey.diffuseColor.set(...outfit.fabric); mesh.material = this.jersey;
          }
        }
      }
    }
  }

  /** Create a rig only when a bot approaches. Hidden rigs keep their procedural, batched proxy. */
  setDetail(enabled: boolean): void {
    if (!this.enemy) return;
    if (this.detailed === enabled && (this.swat || !enabled)) return;
    if (enabled && !this.swat) {
      this.swat = instantiateEnemy(this.scene, this.root, this.id, this.enemy);
      if (this.swat) {
        this.importedMeshes = this.root.getChildMeshes().filter(mesh => mesh.name.includes(`${this.id}-avatar-`) || mesh.name.includes(`${this.id}-swat-`));
        for (const mesh of this.importedMeshes) {
          mesh.isPickable = true;
          mesh.metadata = { actorId: this.id, freeAsset: this.enemy.id, enemyAsset: this.enemy.id };
          this.shadows.addShadowCaster(mesh);
          // Tint only the SWAT torso; each actor owns its material, preserving the player's palette.
          if (this.enemy.id === 'swat' && mesh.name.endsWith('Swat_Body') && mesh.material) {
            this.jersey = mesh.material.clone(`${this.id}-enemy-uniform`) as import('@babylonjs/core/Materials/standardMaterial.js').StandardMaterial;
            this.jersey.diffuseColor.set(...this.outfit.fabric); mesh.material = this.jersey;
          }
        }
      }
    }
    this.detailed = enabled && !!this.swat;
    for (const mesh of this.importedMeshes) mesh.setEnabled(this.detailed);
    for (const mesh of this.bodyMeshes) if (!this.helmet.includes(mesh) && !this.vest.includes(mesh)) mesh.setEnabled(!this.detailed);
    for (const mesh of this.headgear) mesh.setEnabled(!this.detailed && this.helmetTier === 0);
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
    this.helmetTier = helmet;
    const key = `${helmet}:${vest}`;
    if (key === this.gearKey) return;
    this.gearKey = key;
    for (const mesh of this.helmet) { mesh.setEnabled(helmet > 0); if (helmet > 0) mesh.instancedBuffers.instanceColor = new Color4(...TIER[helmet], 1); }
    for (const mesh of this.headgear) mesh.setEnabled(!(this.swat && this.detailed) && helmet === 0);
    for (const mesh of this.vest) { mesh.setEnabled(vest > 0); if (vest > 0) mesh.instancedBuffers.instanceColor = new Color4(...TIER[vest], 1); }
  }

  /** Muzzle flash and a small recoil kick. */
  fire(): void { this.flash.setEnabled(true); this.kick = 1; }
  endFlash(): void { this.flash.setEnabled(false); }

  setEnabled(enabled: boolean): void { this.root.setEnabled(enabled); }
  dispose(): void {
    for (const mesh of this.root.getChildMeshes()) this.shadows.removeShadowCaster(mesh);
    this.swat?.entries.dispose();
    if (this.swat && 'ownedMaterials' in this.swat) this.swat.ownedMaterials.forEach(material => material.dispose(false, false));
    this.root.dispose(false, false);
    this.jersey?.dispose();
  }

  /** Walk cycle with knee bend, then the arms are solved to hold the gun's two hand positions. */
  pose(dt: number, p: Pose): void {
    this.kick = Math.max(0, this.kick - dt * 9);
    const walk = Math.min(1, p.moving / 5);
    const crouch = Math.max(0, Math.min(1, p.crouch ?? 0)), prone = Math.max(0, Math.min(1 - crouch, p.prone ?? 0));
    if (this.swat && this.detailed) { this.poseSwat(dt, p, crouch, prone); return; }
    // Crouched or lying down the stride shrinks; a crouch bends the hips and knees deeply (the caller lowers the body).
    const amplitude = 1 - crouch * 0.75 - prone * 0.7;
    for (let i = 0; i < 2; i++) {
      const phase = i === 0 ? p.stride : p.stride + Math.PI;
      const hip = p.showcase ? (i === 0 ? -0.04 : 0.1) : -Math.sin(phase) * 0.62 * walk * amplitude - 0.04;
      const knee = p.showcase ? (i === 0 ? 0.1 : 0.2) : 0.1 + Math.max(0, Math.cos(phase)) * 0.85 * walk * amplitude;
      this.hips[i].rotation.x = hip * (1 - crouch) - 1.45 * crouch;
      this.knees[i].rotation.x = knee * (1 - crouch) + 2.05 * crouch;
    }
    const breathe = Math.sin(p.time * 1.6) * 0.006;
    const bob = Math.abs(Math.sin(p.stride)) * 0.016 * walk;
    // Lying down the whole body is tipped forward by the caller; turn the gun back to point along the ground.
    const pitch = (p.showcase ? 0.35 : p.reloading ? 0.55 + Math.sin(p.time * 9) * 0.1 : p.healing ? 0.75 : 0) - prone * (Math.PI / 2 - 0.12);
    this.gun.rotation.x = pitch + breathe * 2;
    this.gun.position.set(0.1, 1.36 + breathe - bob * 0.6, 0.3 - this.kick * 0.045);
    this.solveArms(pitch + breathe * 2);
  }

  private poseSwat(dt: number, p: Pose, crouch: number, prone: number): void {
    const swat = this.swat!;
    for (const rest of swat.rest) {
      rest.node.position.copyFrom(rest.position);
      if (rest.rotation) rest.node.rotationQuaternion!.copyFrom(rest.rotation);
    }
    const candidates = p.healing || p.reloading ? ['Interact', 'Idle_Gun_Pointing', 'Idle_Shoot', 'Idle'] : p.moving > .3 && !p.showcase ? ['Run_Shoot', 'Run_Gun', 'Run', 'Walk'] : ['Idle_Gun_Pointing', 'Idle_Shoot', 'Idle_Gun', 'Idle'];
    const clip = candidates.map(name => swat.entries.animationGroups.find(group => group.name.endsWith(`|${name}`) || group.name.endsWith(`-${name}`))).find(Boolean);
    if (clip && this.swatClip !== clip) {
      this.swatClip?.stop(); this.swatClip = clip; this.swatTime = 0;
      clip.start(true); clip.pause();
    }
    if (clip) {
      this.swatTime += dt * (p.moving > .3 && !p.showcase ? Math.max(.25, p.moving / 5) : 1);
      const fps = clip.targetedAnimations[0]?.animation.framePerSecond ?? 30;
      clip.goToFrame(clip.from + (this.swatTime * fps) % Math.max(1, clip.to - clip.from));
    }
    this.root.computeWorldMatrix(true).invertToRef(swat.inverse);
    // The authored rig uses independent foot controls. Keep them on the ground while folding the legs.
    if (crouch > .001) for (const leg of swat.legs) {
      if (!leg.upper || !leg.lower || !leg.end || !leg.foot) continue;
      leg.foot.computeWorldMatrix(true);
      const foot = Vector3.TransformCoordinates(leg.foot.getAbsolutePosition(), swat.inverse);
      foot.y += .477 * crouch;
      this.solveImportedLimb(leg.upper, leg.lower, leg.end, foot, new Vector3(0, 0, 1));
      const worldFoot = Vector3.TransformCoordinates(foot, this.root.getWorldMatrix());
      const parentInverse = (leg.foot.parent as TransformNode).computeWorldMatrix(true).clone().invert();
      Vector3.TransformCoordinatesToRef(worldFoot, parentInverse, leg.foot.position);
    }
    const pitch = (p.showcase ? .25 : p.reloading ? .55 : p.healing ? .75 : 0) - prone * (Math.PI / 2 - .12);
    this.gun.rotation.x = pitch;
    this.gun.position.set(.1, 1.36, .3 - this.kick * .045);
    if (this.current) for (let side = 0; side < 2; side++) {
      const arm = swat.arms[side];
      if (!arm.upper || !arm.lower || !arm.end) continue;
      const anchor = (side === 1 ? this.current.grip : this.current.fore).scale(GUN_SCALE);
      const hand = new Vector3(this.gun.position.x + anchor.x, this.gun.position.y + anchor.y * Math.cos(pitch) - anchor.z * Math.sin(pitch), this.gun.position.z + anchor.y * Math.sin(pitch) + anchor.z * Math.cos(pitch));
      this.solveImportedLimb(arm.upper, arm.lower, arm.end, hand, new Vector3(side === 1 ? .55 : -.55, -1, -.25));
    }
  }

  /** Two-bone IK in actor space; transforming directions into the parent also handles the GLB's mirrored root. */
  private solveImportedLimb(upper: TransformNode, lower: TransformNode, end: TransformNode, target: Vector3, pole: Vector3): void {
    const inverse = this.swat!.inverse;
    const local = (node: TransformNode) => { node.computeWorldMatrix(true); return Vector3.TransformCoordinates(node.getAbsolutePosition(), inverse); };
    const s = local(upper), knee = local(lower), tip = local(end);
    const aLength = Vector3.Distance(s, knee), bLength = Vector3.Distance(knee, tip);
    const axis = target.subtract(s);
    const distance = Math.max(Math.abs(aLength - bLength) + .002, Math.min(aLength + bLength - .002, axis.length()));
    axis.normalize();
    const along = (distance * distance + aLength * aLength - bLength * bLength) / (2 * distance);
    const height = Math.sqrt(Math.max(0, aLength * aLength - along * along));
    pole.subtractInPlace(axis.scale(Vector3.Dot(pole, axis))).normalize();
    const elbow = s.add(axis.scale(along)).add(pole.scale(height));
    const rotate = (node: TransformNode, child: TransformNode, destination: Vector3) => {
      node.computeWorldMatrix(true); child.computeWorldMatrix(true);
      const parentInverse = (node.parent as TransformNode).computeWorldMatrix(true).clone().invert();
      const position = node.getAbsolutePosition();
      const from = Vector3.TransformNormal(child.getAbsolutePosition().subtract(position), parentInverse).normalize();
      const worldTarget = Vector3.TransformCoordinates(destination, this.root.getWorldMatrix());
      const to = Vector3.TransformNormal(worldTarget.subtract(position), parentInverse).normalize();
      const delta = Quaternion.Identity();
      Quaternion.FromUnitVectorsToRef(from, to, delta);
      node.rotationQuaternion = delta.multiply(node.rotationQuaternion ?? Quaternion.Identity());
      node.computeWorldMatrix(true);
    };
    rotate(upper, lower, elbow);
    rotate(lower, end, s.add(axis.scale(distance)));
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
