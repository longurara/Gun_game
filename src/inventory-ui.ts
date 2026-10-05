import type { Actor, AmmoType, ArmorSlot, Loot, LootKind, WeaponType } from './types';
import {
  AMMO_LABEL, AMMO_ORDER, AMMO_PICKUP, ammoKindOf, ammoTypeOf, ARMOR_DURABILITY, ARMOR_NAMES,
  armorKind, isArmorKind, isSidearm, isWeaponKind, lootLabel, parseArmor, slotOrder, WEAPONS,
} from './game/weapons';
import { weaponHudIcon } from './hud-icons';

export type InventoryCallbacks = {
  onClose: () => void;
  onSelectWeapon: (weapon: WeaponType) => void;
  onPickup: (lootId: string) => void;
  onDrop: (kind: LootKind, amount: number) => void;
  onHeal: () => void;
  onOpenChange?: (open: boolean) => void;
};

type ItemRow = {
  root: HTMLElement; icon: HTMLElement; label: HTMLElement; detail: HTMLElement;
  count: HTMLElement; action: HTMLButtonElement; secondary?: HTMLButtonElement;
};
type WeaponSlot = {
  root: HTMLElement; select: HTMLButtonElement; label: HTMLElement; category: HTMLElement;
  icon: HTMLElement; rounds: HTMLElement; reserve: HTMLElement; drop: HTMLButtonElement;
};
const icons = {
  ammo: '<path d="M8 21V8l4-6 4 6v13zM8 16h8M8 9h8"/>',
  medkit: '<path d="M8 5V3h8v2M3 7h18v14H3zM9 14h6m-3-3v6"/>',
  helmet: '<path d="M4 16v-4a8 8 0 0 1 16 0v4l-4 1v4h-5v-5zm0 0H2m18 0h2"/>',
  vest: '<path d="m8 3 4 3 4-3 4 5-3 3v10H7V11L4 8zM9 12h6m-6 4h6"/>',
};
function itemIcon(kind: LootKind): string {
  if (isWeaponKind(kind)) return weaponHudIcon(kind);
  const name = kind === 'medkit' ? 'medkit' : isArmorKind(kind) ? parseArmor(kind).slot : 'ammo';
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + icons[name] + '</svg>';
}
function write(element: HTMLElement, value: string): void {
  if (element.textContent !== value) element.textContent = value;
}
function integer(value: number): number { return Math.max(0, Math.floor(Number.isFinite(value) ? value : 0)); }
function setIcon(element: HTMLElement, kind: LootKind): void {
  if (element.dataset.kind === kind) return;
  element.dataset.kind = kind;
  element.innerHTML = itemIcon(kind);
}

/** Full match inventory; item quantities come directly from the current actor. */
export class InventoryView {
  public readonly canvas: HTMLCanvasElement;
  private readonly root: HTMLElement;
  private readonly callbacks: InventoryCallbacks;
  private readonly close: HTMLButtonElement;
  private readonly nearbyList: HTMLElement;
  private readonly carriedList: HTMLElement;
  private readonly nearbyEmpty: HTMLElement;
  private readonly carriedEmpty: HTMLElement;
  private readonly playerName: HTMLElement;
  private readonly health: HTMLElement;
  private readonly healthFill: HTMLElement;
  private readonly status: HTMLElement;
  private readonly nearbyCount: HTMLElement;
  private readonly carriedCount: HTMLElement;
  private readonly nearbyRows = new Map<string, ItemRow>();
  private readonly carriedRows = new Map<LootKind, ItemRow>();
  private readonly weapons: WeaponSlot[] = [];
  private readonly armor = new Map<ArmorSlot, { root: HTMLElement; name: HTMLElement; detail: HTMLElement; fill: HTMLElement; drop: HTMLButtonElement }>();
  private currentPlayer: Actor | null = null;
  private nearby = new Map<string, Loot>();
  private returnFocus: HTMLElement | null = null;

  constructor(parent: HTMLElement, callbacks: InventoryCallbacks) {
    this.callbacks = callbacks;
    this.root = document.createElement('section');
    this.root.id = 'inventory-screen';
    this.root.className = 'inventory-screen';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-labelledby', 'inventory-title');
    this.root.innerHTML = [
      '<div class="inventory-shell">',
      '<header class="inventory-header">',
      '<div class="inventory-title-group"><span class="inventory-wordmark">LASTLIGHT <i></i></span><h2 id="inventory-title">KHO ĐỒ</h2><span class="inventory-header-sub">CHUẨN BỊ CHO CUỘC CHIẾN</span></div>',
      '<button id="inventory-close" class="inventory-close" type="button" aria-label="Đóng kho đồ"><span>ĐÓNG</span><kbd>ESC</kbd><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>',
      '</header><div class="inventory-layout">',
      '<section class="inventory-column inventory-vicinity" aria-labelledby="inventory-nearby-title">',
      '<div class="inventory-section-title"><h3 id="inventory-nearby-title">XUNG QUANH</h3><span id="inventory-nearby-count">0 VẬT PHẨM</span></div><p class="inventory-column-note">Trong tầm nhặt</p>',
      '<div id="inventory-nearby-list" class="inventory-item-list"></div><div id="inventory-nearby-empty" class="inventory-empty"><span class="inventory-empty-icon">' + itemIcon('556Ammo') + '</span><p>Không có vật phẩm gần bạn.</p><small>Đến gần đồ trên mặt đất để nhặt.</small></div></section>',
      '<section class="inventory-column inventory-carried" aria-labelledby="inventory-carried-title">',
      '<div class="inventory-section-title"><h3 id="inventory-carried-title">VẬT TƯ</h3><span id="inventory-carried-count">0 LOẠI</span></div><p class="inventory-column-note">Đạn dự trữ &amp; cứu thương</p>',
      '<div id="inventory-carried-list" class="inventory-item-list"></div><div id="inventory-carried-empty" class="inventory-empty"><span class="inventory-empty-icon">' + itemIcon('medkit') + '</span><p>Kho vật tư đang trống.</p><small>Tìm đạn và cứu thương trong các ngôi nhà.</small></div></section>',
      '<section class="inventory-character-panel" aria-label="Nhân vật và giáp đang trang bị">',
      '<div class="inventory-character-heading"><span>NGƯỜI SINH TỒN</span><i>TRANG BỊ HIỆN TẠI</i></div><div class="inventory-character-stage"><div class="inventory-character-halo" aria-hidden="true"></div><canvas id="inventory-character" width="560" height="800" aria-label="Nhân vật 3D và vũ khí đang cầm"></canvas><div class="inventory-armor-slots"></div></div>',
      '<div class="inventory-character-info"><strong id="inventory-player-name">NGƯỜI SINH TỒN</strong><div class="inventory-health-caption"><span>THỂ LỰC</span><b id="inventory-health">100 / 100</b></div><div class="inventory-health-track"><span id="inventory-health-fill"></span></div></div></section>',
      '<section class="inventory-column inventory-loadout" aria-labelledby="inventory-weapons-title">',
      '<div class="inventory-section-title"><h3 id="inventory-weapons-title">VŨ KHÍ</h3><span>2 CHÍNH · 1 PHỤ</span></div><p class="inventory-column-note">Chọn súng để trang bị</p><div class="inventory-weapon-list"></div><p class="inventory-loadout-note">Đạn cùng cỡ được dùng chung.<br>Giữ ít nhất một vũ khí để chiến đấu.</p></section>',
      '</div><footer class="inventory-footer"><div class="inventory-key-hints"><span><kbd>TAB</kbd> CHUYỂN MỤC</span><span><kbd>I</kbd> / <kbd>ESC</kbd> ĐÓNG</span></div><p id="inventory-status">Trận đấu vẫn tiếp diễn khi mở kho.</p><span class="inventory-footer-brand">LASTLIGHT <i>·</i> SURVIVAL</span></footer></div>',
    ].join('');
    parent.append(this.root);
    this.close = this.element<HTMLButtonElement>('inventory-close');
    this.canvas = this.element<HTMLCanvasElement>('inventory-character');
    this.nearbyList = this.element('inventory-nearby-list');
    this.carriedList = this.element('inventory-carried-list');
    this.nearbyEmpty = this.element('inventory-nearby-empty');
    this.carriedEmpty = this.element('inventory-carried-empty');
    this.playerName = this.element('inventory-player-name');
    this.health = this.element('inventory-health');
    this.healthFill = this.element('inventory-health-fill');
    this.status = this.element('inventory-status');
    this.nearbyCount = this.element('inventory-nearby-count');
    this.carriedCount = this.element('inventory-carried-count');
    this.close.dataset.inventoryAction = 'close';
    this.createArmor();
    this.createWeaponSlots();
    this.root.addEventListener('click', event => this.handleClick(event));
    this.root.addEventListener('keydown', event => this.handleKey(event));
  }

  public get open(): boolean { return !this.root.hidden; }

  public show(open: boolean): void {
    if (open === this.open) return;
    if (open) {
      const active = document.activeElement;
      this.returnFocus = active instanceof HTMLElement ? active : null;
      this.root.hidden = false;
      this.close.focus({ preventScroll: true });
    } else {
      this.root.hidden = true;
      if (this.returnFocus?.isConnected) this.returnFocus.focus({ preventScroll: true });
      this.returnFocus = null;
    }
    this.callbacks.onOpenChange?.(open);
  }

  public update(player: Actor, nearby: readonly Loot[], options: { online?: boolean } = {}): void {
    if (!this.open) return;
    this.currentPlayer = player;
    write(this.playerName, player.name);
    const hp = Math.max(0, Math.min(100, Number.isFinite(player.health) ? player.health : 0));
    write(this.health, Math.ceil(hp) + ' / 100');
    this.healthFill.style.transform = 'scaleX(' + hp / 100 + ')';
    this.healthFill.classList.toggle('low', hp <= 30);
    write(this.status, options.online ? 'Trận online vẫn tiếp tục. Hãy tìm chỗ an toàn.' : 'Trận đấu vẫn tiếp diễn khi mở kho.');
    const sorted = nearby.filter(item => item.active).map(item => ({ item, distance: Math.hypot(item.position.x - player.position.x, item.position.y - player.position.y, item.position.z - player.position.z) })).sort((a, b) => a.distance - b.distance || a.item.id.localeCompare(b.item.id));
    this.nearby = new Map(sorted.map(({ item }) => [item.id, item]));
    this.reconcileNearby(sorted, player);
    this.updateCarried(player);
    this.updateWeapons(player);
    this.updateArmor(player);
    const active = document.activeElement;
    if (!active || !this.root.contains(active) || active.tagName === 'BUTTON' && (active as HTMLButtonElement).disabled) this.close.focus({ preventScroll: true });
  }

  private element<T extends HTMLElement = HTMLElement>(id: string): T { return this.root.querySelector<T>('#' + id)!; }

  private createItemRow(kind: LootKind, action: 'pickup' | 'drop'): ItemRow {
    const root = document.createElement('article');
    root.className = 'inventory-item-row';
    root.innerHTML = '<span class="inventory-item-icon"></span><div class="inventory-item-copy"><b></b><small></small></div><span class="inventory-item-count"></span><div class="inventory-item-actions"><button type="button" class="inventory-action"></button></div>';
    const button = root.querySelector<HTMLButtonElement>('button')!;
    button.dataset.inventoryAction = action;
    const row = { root, icon: root.querySelector<HTMLElement>('.inventory-item-icon')!, label: root.querySelector<HTMLElement>('b')!, detail: root.querySelector<HTMLElement>('small')!, count: root.querySelector<HTMLElement>('.inventory-item-count')!, action: button } as ItemRow;
    setIcon(row.icon, kind);
    write(row.label, lootLabel(kind));
    return row;
  }

  private reconcileNearby(sorted: Array<{ item: Loot; distance: number }>, player: Actor): void {
    for (const [id, row] of this.nearbyRows) {
      if (!this.nearby.has(id)) { row.root.remove(); this.nearbyRows.delete(id); }
    }
    sorted.forEach(({ item, distance }, index) => {
      let row = this.nearbyRows.get(item.id);
      if (!row) {
        row = this.createItemRow(item.kind, 'pickup');
        row.action.dataset.lootId = item.id;
        write(row.action, 'NHẶT');
        this.nearbyRows.set(item.id, row);
      }
      setIcon(row.icon, item.kind);
      write(row.label, lootLabel(item.kind));
      const ammo = ammoTypeOf(item.kind);
      let detail = distance.toFixed(1) + ' m';
      if (isWeaponKind(item.kind) && item.loadedAmmo !== undefined) detail += ' · ' + integer(item.loadedAmmo) + ' đạn trong súng';
      if (isArmorKind(item.kind)) {
        const max = ARMOR_DURABILITY[parseArmor(item.kind).level];
        detail += ' · ' + integer(item.durability ?? max) + ' / ' + max + ' độ bền';
      }
      write(row.detail, detail);
      write(row.count, ammo ? '+' + integer(item.amount ?? AMMO_PICKUP[ammo]) : isWeaponKind(item.kind) ? 'SÚNG' : isArmorKind(item.kind) ? 'CẤP ' + parseArmor(item.kind).level : '+' + integer(item.amount ?? 1));
      row.action.setAttribute('aria-label', 'Nhặt ' + lootLabel(item.kind));
      row.action.disabled = !player.alive || !!player.air || !!player.vehicleId;
      if (this.nearbyList.children[index] !== row.root) this.nearbyList.insertBefore(row.root, this.nearbyList.children[index] ?? null);
    });
    this.nearbyEmpty.hidden = sorted.length > 0;
    write(this.nearbyCount, sorted.length + ' VẬT PHẨM');
  }

  private updateCarried(player: Actor): void {
    const kinds: Array<{ kind: LootKind; count: number; ammo?: AmmoType }> = [];
    if (player.medkits > 0) kinds.push({ kind: 'medkit', count: integer(player.medkits) });
    for (const ammo of AMMO_ORDER) if (player.reserve[ammo] > 0) kinds.push({ kind: ammoKindOf(ammo), count: integer(player.reserve[ammo]), ammo });
    const liveKinds = new Set(kinds.map(item => item.kind));
    for (const [kind, row] of this.carriedRows) {
      if (!liveKinds.has(kind)) { row.root.remove(); this.carriedRows.delete(kind); }
    }
    kinds.forEach(({ kind, count, ammo }, index) => {
      let row = this.carriedRows.get(kind);
      if (!row) {
        row = this.createItemRow(kind, 'drop');
        row.action.dataset.kind = kind;
        if (kind === 'medkit') {
          const heal = document.createElement('button');
          heal.type = 'button'; heal.className = 'inventory-action inventory-action-primary';
          heal.dataset.inventoryAction = 'heal'; heal.setAttribute('aria-label', 'Dùng túi cứu thương');
          row.root.querySelector('.inventory-item-actions')!.prepend(heal);
          row.secondary = heal;
        }
        this.carriedRows.set(kind, row);
      }
      write(row.count, '×' + count);
      write(row.detail, ammo ? 'Đạn dự trữ' : player.healing > 0 ? 'Đang hồi máu · ' + player.healing.toFixed(1) + ' s' : 'Hồi phục thể lực');
      const amount = ammo ? Math.min(30, count) : 1;
      row.action.dataset.amount = String(amount);
      row.action.disabled = !player.alive || !!player.air || !!player.vehicleId;
      write(row.action, ammo ? 'BỎ ' + amount : 'BỎ');
      row.action.setAttribute('aria-label', 'Bỏ ' + amount + ' ' + lootLabel(kind));
      if (row.secondary) {
        row.secondary.disabled = !player.alive || player.health >= 99 || player.healing > 0 || !!player.air || !!player.vehicleId;
        write(row.secondary, player.healing > 0 ? 'ĐANG DÙNG' : 'DÙNG');
      }
      if (this.carriedList.children[index] !== row.root) this.carriedList.insertBefore(row.root, this.carriedList.children[index] ?? null);
    });
    this.carriedEmpty.hidden = kinds.length > 0;
    write(this.carriedCount, kinds.length + ' LOẠI');
  }

  private createWeaponSlots(): void {
    const list = this.root.querySelector('.inventory-weapon-list')!;
    for (let index = 0; index < 3; index++) {
      const root = document.createElement('article');
      root.className = 'inventory-weapon-slot';
      root.dataset.slot = String(index + 1);
      root.innerHTML = '<div class="inventory-slot-top"><span class="inventory-slot-number">0' + (index + 1) + '</span><span class="inventory-slot-type">' + (index === 2 ? 'VŨ KHÍ PHỤ' : 'VŨ KHÍ CHÍNH') + '</span><button class="inventory-weapon-drop" type="button" data-inventory-action="drop">BỎ</button></div><button class="inventory-weapon-select" type="button" data-inventory-action="select"><span class="inventory-weapon-name"></span><span class="inventory-weapon-category"></span><span class="inventory-weapon-art"></span><span class="inventory-weapon-ammo"><b></b><small></small></span><span class="inventory-equipped-label">ĐANG CẦM</span></button>';
      this.weapons.push({ root, select: root.querySelector<HTMLButtonElement>('.inventory-weapon-select')!, label: root.querySelector<HTMLElement>('.inventory-weapon-name')!, category: root.querySelector<HTMLElement>('.inventory-weapon-category')!, icon: root.querySelector<HTMLElement>('.inventory-weapon-art')!, rounds: root.querySelector<HTMLElement>('.inventory-weapon-ammo b')!, reserve: root.querySelector<HTMLElement>('.inventory-weapon-ammo small')!, drop: root.querySelector<HTMLButtonElement>('.inventory-weapon-drop')! });
      list.append(root);
    }
  }

  private updateWeapons(player: Actor): void {
    const ordered = slotOrder(player.ownedWeapons);
    const primary = ordered.filter(weapon => !isSidearm(weapon));
    const slots = [primary[0], primary[1], ordered.find(isSidearm)];
    slots.forEach((weapon, index) => {
      const slot = this.weapons[index], config = weapon ? WEAPONS[weapon] : undefined;
      slot.root.classList.toggle('empty', !config);
      slot.root.classList.toggle('equipped', !!config && weapon === player.weapon);
      slot.select.disabled = !config;
      slot.select.setAttribute('aria-pressed', String(!!config && weapon === player.weapon));
      slot.select.setAttribute('aria-label', config ? 'Trang bị ' + config.label : (index === 2 ? 'Ô vũ khí phụ trống' : 'Ô vũ khí chính ' + (index + 1) + ' trống'));
      slot.select.dataset.weapon = weapon ?? '';
      write(slot.label, config?.label ?? 'Ô TRỐNG');
      write(slot.category, config ? config.category + ' · ' + AMMO_LABEL[config.ammoType] : index === 2 ? 'Nhặt một khẩu súng ngắn' : 'Nhặt một vũ khí chính');
      if (config) setIcon(slot.icon, weapon!);
      else if (slot.icon.dataset.kind) { slot.icon.innerHTML = ''; delete slot.icon.dataset.kind; }
      write(slot.rounds, config ? integer(player.ammo[weapon!]) + ' / ' + config.magazine : '—');
      write(slot.reserve, config ? integer(player.reserve[config.ammoType]) + ' dự trữ' : '');
      slot.drop.hidden = !config;
      slot.drop.disabled = !config || player.ownedWeapons.length <= 1 || !player.alive || !!player.air || !!player.vehicleId;
      slot.drop.dataset.kind = weapon ?? '';
      slot.drop.dataset.amount = '1';
      slot.drop.setAttribute('aria-label', 'Bỏ ' + (config?.label ?? 'vũ khí'));
      slot.drop.title = slot.drop.disabled && config ? 'Cần giữ ít nhất một vũ khí' : '';
    });
  }

  private createArmor(): void {
    const parent = this.root.querySelector('.inventory-armor-slots')!;
    for (const name of ['helmet', 'vest'] as const) {
      const root = document.createElement('article');
      root.className = 'inventory-armor-slot';
      root.dataset.armor = name;
      root.innerHTML = '<span class="inventory-armor-icon">' + itemIcon(armorKind(name, 1)) + '</span><div class="inventory-armor-copy"><b></b><small></small><div class="inventory-armor-track"><span></span></div></div><button type="button" class="inventory-armor-drop" data-inventory-action="drop" data-amount="1" aria-label="Bỏ giáp">BỎ</button>';
      this.armor.set(name, { root, name: root.querySelector<HTMLElement>('b')!, detail: root.querySelector<HTMLElement>('small')!, fill: root.querySelector<HTMLElement>('.inventory-armor-track span')!, drop: root.querySelector<HTMLButtonElement>('button')! });
      parent.append(root);
    }
  }

  private updateArmor(player: Actor): void {
    for (const name of ['helmet', 'vest'] as const) {
      const item = this.armor.get(name)!;
      const level = Math.max(0, Math.min(3, integer(player[name]))), hp = integer(name === 'helmet' ? player.helmetHp : player.vestHp);
      const max = ARMOR_DURABILITY[level];
      item.root.classList.toggle('empty', level === 0);
      write(item.name, ARMOR_NAMES[name]);
      write(item.detail, level ? 'CẤP ' + level + ' · ' + hp + ' / ' + max : 'CHƯA TRANG BỊ');
      item.fill.style.transform = 'scaleX(' + (max ? Math.max(0, Math.min(1, hp / max)) : 0) + ')';
      item.fill.classList.toggle('low', level > 0 && hp / max < 0.3);
      item.drop.hidden = level === 0;
      item.drop.disabled = !player.alive || !!player.air || !!player.vehicleId;
      item.drop.dataset.kind = level ? armorKind(name, level) : '';
      item.drop.setAttribute('aria-label', 'Bỏ ' + ARMOR_NAMES[name].toLowerCase());
    }
  }

  private handleClick(event: MouseEvent): void {
    const target = event.target as Element | null;
    if (!target || typeof target.closest !== 'function') return;
    const button = target.closest<HTMLButtonElement>('button[data-inventory-action]');
    if (!button || button.disabled || !this.open) return;
    const action = button.dataset.inventoryAction;
    if (action === 'close') { this.callbacks.onClose(); return; }
    const player = this.currentPlayer;
    if (!player || !player.alive) return;
    if (action === 'select' && button.dataset.weapon && player.ownedWeapons.includes(button.dataset.weapon)) this.callbacks.onSelectWeapon(button.dataset.weapon);
    if (action === 'pickup' && !player.air && !player.vehicleId && button.dataset.lootId && this.nearby.has(button.dataset.lootId)) this.callbacks.onPickup(button.dataset.lootId);
    if (action === 'heal' && player.medkits > 0 && player.health < 99 && player.healing <= 0 && !player.air && !player.vehicleId) this.callbacks.onHeal();
    if (action === 'drop' && !player.air && !player.vehicleId && button.dataset.kind) {
      const kind = button.dataset.kind;
      if (isWeaponKind(kind) && player.ownedWeapons.length <= 1) return;
      this.callbacks.onDrop(kind, Math.max(1, integer(Number(button.dataset.amount))));
    }
  }

  private handleKey(event: KeyboardEvent): void {
    if (!this.open) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation(); this.callbacks.onClose(); return;
    }
    if (event.key !== 'Tab') return;
    const buttons = [...this.root.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')].filter(button => !button.closest('[hidden]'));
    if (!buttons.length) { event.preventDefault(); return; }
    const first = buttons[0], last = buttons[buttons.length - 1], current = document.activeElement;
    if (event.shiftKey && (current === first || !this.root.contains(current))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (current === last || !this.root.contains(current))) { event.preventDefault(); first.focus(); }
    event.stopPropagation();
  }
}
