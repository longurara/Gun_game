import { Engine } from '@babylonjs/core/Engines/engine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import '@babylonjs/core/Meshes/instancedMesh.js';
import { Soldier } from './soldier';
import type { Actor } from './types';
import { preloadFreeAssets } from './free-assets';

/** A small, independent portrait scene; the game owns its render cadence. */
export class InventoryPreview {
  private engine: Engine | null = null;
  private scene: Scene | null = null;
  private camera: FreeCamera | null = null;
  private shadows: ShadowGenerator | null = null;
  private soldier: Soldier | null = null;
  private actorId: string | null = null;
  private skinId = '';
  private assetsReady = false;
  private visible = false;
  private failed = false;
  private disposed = false;
  private lastTime: number | null = null;
  private size = '';
  private fallback: HTMLElement | null = null;
  private readonly resizeObserver: ResizeObserver | null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (this.visible) this.resize();
    });
    this.resizeObserver?.observe(canvas);
  }

  setVisible(open: boolean): void {
    if (this.disposed) return;
    this.visible = open;
    this.lastTime = null;
    if (open) this.resize();
    // No engine.runRenderLoop: a closed inventory does no scene or GPU work.
  }

  /** Time is in seconds, matching the Soldier pose and the main game clock. */
  update(player: Actor, time: number, skinId = 'default'): void {
    if (!this.visible || this.failed || this.disposed) return;
    if (this.canvas.clientWidth < 1 || this.canvas.clientHeight < 1) return;
    try {
      if (!this.engine) this.initialize();
      if (!this.scene || !this.shadows) return;
      if (!this.assetsReady) return;
      this.resize();
      if (!this.soldier || this.actorId !== player.id || this.skinId !== skinId) {
        if (this.soldier) {
          for (const mesh of this.soldier.root.getChildMeshes()) this.shadows.removeShadowCaster(mesh);
          this.soldier.dispose();
        }
        this.soldier = new Soldier(this.scene, player.id, true, this.shadows, false, skinId);
        this.actorId = player.id;
        this.skinId = skinId;
        this.soldier.root.rotation.y = -0.34;
      }
      this.soldier.setGear(Math.max(0, Math.min(3, player.helmet)), Math.max(0, Math.min(3, player.vest)));
      this.soldier.setWeapon(player.weapon);
      this.soldier.endFlash();
      const dt = this.lastTime === null ? 1 / 60 : Math.max(0, Math.min(0.05, time - this.lastTime));
      this.lastTime = time;
      this.soldier.pose(dt, { moving: 0, stride: 0, alive: true, reloading: false, healing: false, time, showcase: true });
      this.engine!.beginFrame();
      this.scene.render();
      this.engine!.endFrame();
    } catch {
      this.showFallback();
    }
  }

  private initialize(): void {
    this.engine = new Engine(this.canvas, true, {
      alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: false,
      stencil: false, powerPreference: 'low-power',
    });
    this.engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 1.5));
    const scene = this.scene = new Scene(this.engine);
    scene.clearColor = new Color4(0, 0, 0, 0);
    scene.skipPointerMovePicking = true;
    scene.skipPointerDownPicking = true;
    scene.skipPointerUpPicking = true;
    const camera = this.camera = new FreeCamera('inventory-portrait-camera', new Vector3(0, 1.02, 4.3), scene);
    camera.setTarget(new Vector3(0, 0.94, 0));
    camera.fov = 0.5;
    camera.minZ = 0.1;
    camera.maxZ = 35;
    const fill = new HemisphericLight('inventory-fill', new Vector3(0, 1, 0.4), scene);
    fill.diffuse = new Color3(0.75, 0.88, 1);
    fill.groundColor = new Color3(0.18, 0.22, 0.28);
    fill.intensity = 0.8;
    const key = new DirectionalLight('inventory-key', new Vector3(0.6, -0.9, -0.7), scene);
    key.position.set(-3, 5, 4);
    key.diffuse = new Color3(1, 0.88, 0.7);
    key.intensity = 1.1;
    const rim = new DirectionalLight('inventory-rim', new Vector3(-0.8, -0.3, 0.8), scene);
    rim.diffuse = new Color3(0.47, 0.76, 1);
    rim.intensity = 0.7;
    const shadows = this.shadows = new ShadowGenerator(512, key);
    shadows.usePoissonSampling = true;
    shadows.bias = 0.001;
    shadows.normalBias = 0.015;
    this.size = '';
    this.resize();
    void preloadFreeAssets(scene).then(() => { if (!this.disposed && !scene.isDisposed) this.assetsReady = true; });
  }

  private resize(): void {
    if (!this.engine || !this.camera || !this.visible) return;
    const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
    if (width < 1 || height < 1) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    const size = width + ':' + height + ':' + ratio;
    if (size === this.size) return;
    this.size = size;
    this.engine.setHardwareScalingLevel(1 / ratio);
    this.engine.resize();
    // Fit the full body and lowered rifle even in a narrow mobile column.
    const halfFov = Math.tan(this.camera.fov / 2);
    this.camera.position.z = Math.max(2.2 / (2 * halfFov), 1.2 / (2 * halfFov * width / height));
    this.camera.setTarget(new Vector3(0, 0.94, 0));
  }

  private showFallback(): void {
    this.failed = true;
    this.releaseScene();
    this.canvas.hidden = true;
    this.fallback = document.createElement('p');
    this.fallback.className = 'inventory-preview-unavailable';
    this.fallback.textContent = 'Không thể tải xem trước 3D trên thiết bị này. Trang bị của bạn vẫn hiển thị bên cạnh.';
    this.fallback.setAttribute('role', 'status');
    this.fallback.style.cssText = 'position:absolute;inset:38% 12% auto;text-align:center;color:#aab8bd;font-size:12px;line-height:1.6;';
    this.canvas.insertAdjacentElement('afterend', this.fallback);
  }

  private releaseScene(): void {
    this.soldier = null;
    this.actorId = null;
    this.camera = null;
    this.shadows = null;
    this.scene?.dispose();
    this.scene = null;
    this.engine?.dispose();
    this.engine = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.visible = false;
    this.resizeObserver?.disconnect();
    this.releaseScene();
    this.fallback?.remove();
    this.fallback = null;
  }
}
