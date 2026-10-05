export interface MobileCallbacks {
  onLook(dx: number, dy: number): void;
  onFire(pressed: boolean): void;
  onAimToggle(): void;
  onJump(pressed: boolean): void;
  onReload(): void;
  onInteract(): void;
  onHeal(): void;
  onCycleWeapon(): void;
  onPause(): void;
  /** Turn gyroscope aiming on or off from the game screen. */
  onGyroToggle?(): void;
  /** Turn the parachute's auto-steer toward the map flag on or off. */
  onAutoGlide?(): void;
}

export interface JoystickInput {
  side: number;
  forward: number;
  sprint: boolean;
  stickX: number;
  stickY: number;
}

/** Radial dead zone preserves direction; diagonal movement never exceeds unit speed. */
export function getJoystickInput(deltaX: number, deltaY: number, radius: number, deadZone = 0.12): JoystickInput {
  const zero: JoystickInput = { side: 0, forward: 0, sprint: false, stickX: 0, stickY: 0 };
  if (![deltaX, deltaY, radius].every(Number.isFinite) || radius <= 0) return zero;
  const length = Math.hypot(deltaX, deltaY);
  if (length === 0 || !Number.isFinite(length)) return zero;
  const rawStrength = Math.min(1, length / radius);
  const dead = Number.isFinite(deadZone) ? Math.max(0, Math.min(0.95, deadZone)) : 0.12;
  const strength = rawStrength <= dead ? 0 : (rawStrength - dead) / (1 - dead);
  const directionX = deltaX / length;
  const directionY = deltaY / length;
  return {
    side: directionX * strength,
    forward: -directionY * strength,
    sprint: rawStrength >= 0.94,
    stickX: directionX * rawStrength * radius,
    stickY: directionY * rawStrength * radius,
  };
}

type Action = 'aim' | 'reload' | 'interact' | 'heal' | 'weapon' | 'pause' | 'fullscreen' | 'gyro' | 'glide';
type PointerRole =
  | { kind: 'look'; target: HTMLElement; x: number; y: number }
  | { kind: 'joystick'; target: HTMLElement; centerX: number; centerY: number; radius: number }
  | { kind: 'fire' | 'jump'; target: HTMLButtonElement; x: number; y: number }
  | { kind: 'action'; target: HTMLButtonElement; action: Action };

const ICONS = {
  fire: '<path d="m5 17 10-10 4 4L9 21zm10-10 3-4 3 3-2 5M8 14l4 4M4 20l2 2"/>',
  aim: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>',
  jump: '<circle cx="13" cy="4" r="2"/><path d="m5 10 6-3 5 2 4-3M11 7l-2 7 5 1 4 6M9 14l-5 6"/>',
  reload: '<path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/>',
  interact: '<path d="M5 9h14v12H5zm0 0 7-6 7 6m-7 1v7m-3-3 3 3 3-3"/>',
  heal: '<path d="M4 6h16v15H4zm5 0V3h6v3m-3 5v6m-3-3h6"/>',
  weapon: '<path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="4"/>',
  fullscreen: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"/>',
  gyro: '<rect x="8" y="3" width="8" height="18" rx="2"/><path d="M4 8c-1 2.5-1 5.500 0 8M20 8c1 2.500 1 5.500 0 8"/>',
  glide: '<path d="M6 21V4m0 0h11l-2.500 4L17 12H6"/>',
} as const;

function icon(name: keyof typeof ICONS): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

/** One independent pointer role per finger, with capture-safe releases and no mouse synthesis. */
export class MobileControls {
  readonly movement = { side: 0, forward: 0, sprint: false };
  private readonly root: HTMLDivElement;
  private readonly joystick: HTMLDivElement;
  private readonly stick: HTMLDivElement;
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly pointers = new Map<number, PointerRole>();
  private readonly pointerClicks = new WeakMap<HTMLButtonElement, number>();
  private enabled = false;
  private joystickPointer: number | null = null;
  private lookPointer: number | null = null;
  private aimActive = false;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly callbacks: MobileCallbacks) {
    const uiRoot = document.querySelector<HTMLElement>('#ui-root');
    if (!uiRoot) throw new Error('Cần tạo giao diện #ui-root trước điều khiển cảm ứng.');
    this.root = document.createElement('div');
    this.root.id = 'mobile-controls';
    this.root.className = 'mobile-controls';
    this.root.hidden = true;
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', 'Điều khiển cảm ứng');
    this.root.style.pointerEvents = 'none';
    this.root.style.touchAction = 'none';
    const button = (id: keyof typeof ICONS, label: string, extra = '', elementId: string = id) =>
      `<button id="touch-${elementId}" class="touch-button ${extra}" type="button" aria-label="${label}">${icon(id)}<span>${label}</span></button>`;
    this.root.innerHTML = `
      <div id="touch-joystick" class="touch-joystick" role="group" aria-label="Kéo để di chuyển, kéo hết cỡ để chạy">
        <span class="touch-joystick-label">DI CHUYỂN</span><div id="touch-stick" class="touch-stick"></div>
      </div>
      ${button('fire', 'Bắn bên trái', 'touch-fire-left', 'fire-left')}
      <div class="touch-primary-actions touch-combat-cluster">
        ${button('fire', 'Bắn', 'touch-fire')}
        ${button('aim', 'Ngắm', 'touch-aim')}
        ${button('jump', 'Nhảy', 'touch-jump')}
      </div>
      <div class="touch-utility-actions touch-action-row">
        ${button('reload', 'Nạp đạn')}${button('interact', 'Nhặt đồ')}
        ${button('heal', 'Hồi máu')}${button('weapon', 'Đổi súng')}
      </div>
      <div class="touch-top-actions">
        ${button('gyro', 'Con quay', 'touch-gyro')}
        ${button('glide', 'Tự lái dù', 'touch-glide')}
        ${button('pause', 'Tạm dừng', 'touch-pause')}
        ${button('fullscreen', 'Toàn màn hình', 'touch-fullscreen')}
      </div>
    `;
    uiRoot.appendChild(this.root);
    this.joystick = this.root.querySelector<HTMLDivElement>('#touch-joystick')!;
    this.stick = this.root.querySelector<HTMLDivElement>('#touch-stick')!;
    this.canvas.style.touchAction = 'none';
    this.joystick.style.touchAction = 'none';
    this.joystick.style.pointerEvents = 'auto';
    this.root.querySelectorAll<HTMLButtonElement>('.touch-button').forEach(buttonElement => {
      this.buttons.set(buttonElement.id, buttonElement);
      buttonElement.style.touchAction = 'none';
      buttonElement.style.pointerEvents = 'auto';
      buttonElement.addEventListener('contextmenu', event => event.preventDefault());
      buttonElement.addEventListener('click', event => {
        // Pointer actions run once on pointerup. Allow keyboard/assistive clicks.
        event.preventDefault();
        event.stopPropagation();
        if (!this.enabled || buttonElement.disabled || event.detail !== 0) return;
        if (performance.now() - (this.pointerClicks.get(buttonElement) ?? -Infinity) < 800) return;
        const action = buttonElement.id.slice('touch-'.length);
        if (action === 'fire' || action === 'fire-left' || action === 'jump') return;
        this.perform(action as Action);
      });
      buttonElement.addEventListener('pointerdown', this.onButtonDown);
    });
    this.buttons.get('touch-aim')!.setAttribute('aria-pressed', 'false');
    for (const id of ['touch-fire', 'touch-fire-left']) this.buttons.get(id)!.setAttribute('aria-description', 'Giữ để bắn, kéo để xoay góc nhìn');
    this.buttons.get('touch-fullscreen')!.hidden = typeof document.documentElement.requestFullscreen !== 'function';
    this.buttons.get('touch-gyro')!.hidden = true;
    this.buttons.get('touch-glide')!.hidden = true;
    this.joystick.addEventListener('pointerdown', this.onJoystickDown);
    this.canvas.addEventListener('pointerdown', this.onCanvasDown);
    // Window listeners cover pointers whose capture is unavailable in a browser.
    window.addEventListener('pointermove', this.onPointerMove, { passive: false });
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerCancel);
    window.addEventListener('lostpointercapture', this.onPointerCancel);
    window.addEventListener('blur', this.onReset);
    window.addEventListener('orientationchange', this.onReset);
    window.addEventListener('resize', this.onReset);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.clearJoystick();
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    this.root.hidden = !enabled;
    if (!enabled) this.reset();
  }

  /** End a held trigger after changing weapons without disturbing other fingers. */
  cancelFire(): void {
    const firePointers = [...this.pointers.entries()].filter(([, role]) => role.kind === 'fire');
    for (const [id] of firePointers) this.pointers.delete(id);
    for (const id of ['touch-fire', 'touch-fire-left']) this.buttons.get(id)?.classList.remove('is-pressed', 'is-active');
    for (const [id, role] of firePointers) {
      if (role.kind === 'fire') this.pointerClicks.set(role.target, performance.now());
      this.releaseCapture(role.target, id);
    }
    this.callbacks.onFire(false);
  }

  reset(): void {
    const captured = [...this.pointers.entries()];
    this.pointers.clear();
    this.joystickPointer = null;
    this.lookPointer = null;
    this.clearJoystick();
    for (const button of this.buttons.values()) {
      button.classList.remove('is-pressed');
      if (button.id !== 'touch-aim' && button.id !== 'touch-gyro' && button.id !== 'touch-glide') button.classList.remove('is-active');
    }
    this.buttons.get('touch-aim')?.classList.toggle('is-active', this.aimActive);
    for (const [id, role] of captured) this.releaseCapture(role.target, id);
    this.callbacks.onFire(false);
    this.callbacks.onJump(false);
  }

  update(state: { aiming: boolean; canPickup: boolean; reloading: boolean; healing: boolean; gyroAvailable?: boolean; gyroOn?: boolean; glideReady?: boolean; glideOn?: boolean }): void {
    this.aimActive = state.aiming;
    const gyro = this.buttons.get('touch-gyro')!;
    gyro.hidden = !state.gyroAvailable;
    gyro.classList.toggle('is-active', !!state.gyroOn);
    gyro.setAttribute('aria-pressed', String(!!state.gyroOn));
    const glide = this.buttons.get('touch-glide')!;
    glide.hidden = !state.glideReady;
    glide.classList.toggle('is-active', !!state.glideOn);
    glide.setAttribute('aria-pressed', String(!!state.glideOn));
    const aim = this.buttons.get('touch-aim')!;
    aim.classList.toggle('is-active', state.aiming);
    aim.setAttribute('aria-pressed', String(state.aiming));
    const pickup = this.buttons.get('touch-interact')!;
    pickup.classList.toggle('can-pickup', state.canPickup);
    pickup.disabled = !state.canPickup;
    pickup.setAttribute('aria-disabled', String(!state.canPickup));
    for (const [id, busy] of [['touch-reload', state.reloading], ['touch-heal', state.healing]] as const) {
      const button = this.buttons.get(id)!;
      button.classList.toggle('is-busy', busy);
      button.setAttribute('aria-busy', String(busy));
      button.disabled = busy;
    }
  }

  private accepts(event: PointerEvent): boolean {
    return this.enabled && (event.pointerType === 'touch' || event.pointerType === 'pen') && !this.pointers.has(event.pointerId);
  }

  private capture(target: HTMLElement, id: number): void {
    try { target.setPointerCapture(id); } catch { /* Window listeners still release this pointer. */ }
  }

  private releaseCapture(target: HTMLElement, id: number): void {
    try { if (target.hasPointerCapture(id)) target.releasePointerCapture(id); } catch { /* Pointer has already ended. */ }
  }

  private onJoystickDown = (event: PointerEvent): void => {
    if (!this.accepts(event) || this.joystickPointer !== null) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = this.joystick.getBoundingClientRect();
    const thumb = this.stick.getBoundingClientRect();
    const diameter = Math.min(bounds.width, bounds.height);
    const thumbDiameter = Math.min(thumb.width, thumb.height) || diameter * 0.36;
    const role: PointerRole = {
      kind: 'joystick', target: this.joystick,
      centerX: bounds.left + bounds.width / 2,
      centerY: bounds.top + bounds.height / 2,
      radius: Math.max(1, (diameter - thumbDiameter) / 2),
    };
    this.joystickPointer = event.pointerId;
    this.pointers.set(event.pointerId, role);
    this.joystick.classList.add('is-active');
    this.capture(this.joystick, event.pointerId);
    this.moveJoystick(role, event.clientX, event.clientY);
  };

  private onCanvasDown = (event: PointerEvent): void => {
    if (!this.accepts(event) || this.lookPointer !== null) return;
    event.preventDefault();
    this.lookPointer = event.pointerId;
    this.pointers.set(event.pointerId, { kind: 'look', target: this.canvas, x: event.clientX, y: event.clientY });
    this.capture(this.canvas, event.pointerId);
  };

  private onButtonDown = (event: PointerEvent): void => {
    const button = event.currentTarget as HTMLButtonElement;
    if (!this.accepts(event) || button.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    const name = button.id.slice('touch-'.length);
    this.pointerClicks.set(button, performance.now());
    const kind = name === 'fire' || name === 'fire-left' ? 'fire' : name === 'jump' ? 'jump' : 'action';
    const alreadyHeld = this.hasKind(kind);
    const role: PointerRole = kind === 'action'
      ? { kind, target: button, action: name as Action }
      : { kind, target: button, x: event.clientX, y: event.clientY };
    this.pointers.set(event.pointerId, role);
    button.classList.add('is-pressed');
    if (kind !== 'action') button.classList.add('is-active');
    this.capture(button, event.pointerId);
    if (kind === 'fire' && !alreadyHeld) this.callbacks.onFire(true);
    if (kind === 'jump' && !alreadyHeld) this.callbacks.onJump(true);
  };

  private onPointerMove = (event: PointerEvent): void => {
    const role = this.pointers.get(event.pointerId);
    if (!this.enabled || !role) return;
    event.preventDefault();
    if (role.kind === 'joystick') this.moveJoystick(role, event.clientX, event.clientY);
    else if (role.kind === 'look' || role.kind === 'fire') {
      const dx = event.clientX - role.x;
      const dy = event.clientY - role.y;
      role.x = event.clientX;
      role.y = event.clientY;
      if (Number.isFinite(dx) && Number.isFinite(dy) && (dx !== 0 || dy !== 0)) this.callbacks.onLook(dx, dy);
    }
  };

  private onPointerUp = (event: PointerEvent): void => { this.finishPointer(event, false); };
  private onPointerCancel = (event: PointerEvent): void => { this.finishPointer(event, true); };
  private onReset = (): void => { if (this.enabled || this.pointers.size > 0) this.reset(); };
  private onVisibilityChange = (): void => { if (document.hidden) this.onReset(); };

  private finishPointer(event: PointerEvent, cancelled: boolean): void {
    const role = this.pointers.get(event.pointerId);
    if (!role) return;
    if (event.cancelable) event.preventDefault();
    this.pointers.delete(event.pointerId);
    if (role.kind === 'joystick') {
      this.joystickPointer = null;
      this.clearJoystick();
    } else if (role.kind === 'look') this.lookPointer = null;
    else {
      this.pointerClicks.set(role.target, performance.now());
      const buttonStillHeld = [...this.pointers.values()].some(pointer => pointer.target === role.target);
      role.target.classList.toggle('is-pressed', buttonStillHeld);
      if (role.kind === 'fire' || role.kind === 'jump') {
        const held = this.hasKind(role.kind);
        role.target.classList.toggle('is-active', buttonStillHeld);
        if (role.kind === 'fire' && !held) this.callbacks.onFire(false);
        if (role.kind === 'jump' && !held) this.callbacks.onJump(false);
      } else if (role.kind === 'action' && !cancelled && !role.target.disabled) {
        const bounds = role.target.getBoundingClientRect();
        const inside = event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
        if (inside) this.perform(role.action);
      }
    }
    this.releaseCapture(role.target, event.pointerId);
  }

  private hasKind(kind: PointerRole['kind']): boolean {
    return [...this.pointers.values()].some(pointer => pointer.kind === kind);
  }

  private moveJoystick(role: Extract<PointerRole, { kind: 'joystick' }>, x: number, y: number): void {
    const value = getJoystickInput(x - role.centerX, y - role.centerY, role.radius);
    this.movement.side = value.side;
    this.movement.forward = value.forward;
    this.movement.sprint = value.sprint;
    this.positionStick(value.stickX, value.stickY);
  }

  private clearJoystick(): void {
    this.movement.side = 0;
    this.movement.forward = 0;
    this.movement.sprint = false;
    this.joystick.classList.remove('is-active');
    this.positionStick(0, 0);
  }

  private positionStick(x: number, y: number): void {
    this.stick.style.setProperty('--stick-x', `${x}px`);
    this.stick.style.setProperty('--stick-y', `${y}px`);
    this.stick.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
  }

  private perform(action: Action): void {
    switch (action) {
      case 'aim': this.callbacks.onAimToggle(); break;
      case 'reload': this.callbacks.onReload(); break;
      case 'interact': this.callbacks.onInteract(); break;
      case 'heal': this.callbacks.onHeal(); break;
      case 'weapon': this.callbacks.onCycleWeapon(); break;
      case 'pause': this.callbacks.onPause(); break;
      case 'gyro': this.callbacks.onGyroToggle?.(); break;
      case 'glide': this.callbacks.onAutoGlide?.(); break;
      case 'fullscreen':
        // Unsupported or rejected fullscreen never interrupts touch controls.
        try {
          const request = document.fullscreenElement
            ? document.exitFullscreen()
            : document.documentElement.requestFullscreen();
          void request.catch(() => {});
        } catch { /* Unsupported browser/device or a blocked gesture. */ }
        break;
    }
  }
}
