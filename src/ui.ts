import { InventoryView, itemIcon } from './inventory-ui';
import { SUPPLIES, SUPPLY_ORDER, THROW_ORDER } from './game/supplies';
import { ATTACH, ATTACH_SLOTS, attachmentsOf, rigStats } from './game/gear';
import { MELEE } from './game/melee';
import { DEFAULT_SKIN, isUnlocked, lockText, SKINS, skinById, usableSkin } from './skins';
import type { PlayerStats } from './skins';
import type { SupplyKind } from './game/supplies';
import type { Actor, Loot, LootKind, AirMode, GyroMode, AmmoType, ArmorSlot, GameSettings, GameState, MapId, Vec2, WeaponClass, WeaponType, WorldConfig } from './types';
import { mapData } from './game/world';
import { createRangeWorld } from './game/range';
import { remainingGlide } from './game/drop';
import { ZERO_DISTANCE } from './game/ballistics';
import { SCOPE_FROM } from './optics';
import { AMMO_LABEL, ARMOR_DURABILITY, ARMOR_NAMES, CLASS_BASE, GUNS_BY_CLASS, isSidearm, slotOrder, WEAPON_ORDER, WEAPONS } from './game/weapons';
import { weaponHudIcon } from './hud-icons';

type Callbacks = {
  onStart: (settings: GameSettings) => void;
  onResume: () => void;
  onRestart: () => void;
  onMenu: () => void;
  /** The "play with friends" button on the main screen. */
  onMultiplayer?: () => void;
  /** The profile chip on the main screen was pressed: open the account window. */
  onAccount?: () => void;
  onSettings: (settings: GameSettings) => void;
  /** Keep watching the match after dying, and stop watching. */
  onSpectate?: () => void;
  onSpectateExit?: () => void;
  /** Watch the last seconds before dying again, and stop watching. */
  onReplay?: () => void;
  onReplayStop?: () => void;
  onSelectWeapon?: (weapon: WeaponType) => void;
  /** The shooting range: take this gun, and the armoury window opened or closed. */
  onRangeEquip?: (weapon: WeaponType) => void;
  onArmouryChange?: (open: boolean) => void;
  /** The breath button on a phone was pressed or let go. */
  onBreath?: (held: boolean) => void;
  /** Change the scope's magnification: +1 zooms in, -1 out. */
  onZoomStep?: (direction: number) => void;
  onTouchOverlayChange?: (open: boolean) => void;
  onInventoryPickup?: (lootId: string) => void;
  onInventoryDrop?: (kind: LootKind, amount: number) => void;
  onInventoryHeal?: () => void;
  onInventoryUse?: (kind: import('./game/supplies').UseKind) => void;
  /** Tapping a grenade chip in the health panel chooses it. */
  onThrowSelect?: (kind: import('./game/supplies').ThrowKind) => void;
  onInventoryAttach?: (kind: import('./game/gear').AttachKind) => void;
  onInventoryDetach?: (weapon: WeaponType, slot: import('./game/gear').AttachSlot) => void;
  onInventoryChange?: (open: boolean) => void;
};
type BestRecord = { wins: number; kills: number; survival: number; /** Every hạ gục so far (kills is the best single match). */ killsTotal: number };
const DEFAULT_SETTINGS: GameSettings = { difficulty: 'normal', botCount: 100, map: 'island', volume: 0.6, quality: 'high', sensitivity: 1, gyro: 'off', gyroSensitivity: 1, gyroInvertY: false, tips: true, showFps: false, aimAssist: 'off', recoilScale: 1, soundIndicator: false, skin: 'default', immortal: false };
const BOT_CHOICES: Record<MapId, number[]> = { island: [25, 50, 100], valley: [15, 30, 50], arena: [5, 7], desert: [25, 50, 100], pines: [25, 50, 100], metro: [25, 50, 100], range: [0, 3, 6, 10] };
const defaultBots = (map: MapId): number => map === 'valley' ? 30 : map === 'arena' ? 5 : map === 'range' ? 3 : 100;
const MAP_INFO: Record<MapId, { title: string; blurb: string; size: string; time: string }> = {
  island: { title: 'ĐẢO LASTLIGHT', blurb: 'Sông, hồ, thị trấn và rừng. Lục nhà tìm súng, giáp; lái xe vượt đảo trước khi bo khép lại.', size: '4 × 4 KM', time: '≈ 10 PHÚT' },
  valley: { title: 'ĐẤU TRƯỜNG THUNG LŨNG', blurb: 'Một thung lũng khép kín, đông bot, bo thu nhanh. Giao tranh liên tục từ giây đầu tiên.', size: '1 × 1 KM', time: '≈ 6 PHÚT' },
  arena: { title: 'SÂN TẬP', blurb: 'Bản đồ nhỏ có sẵn đủ 8 loại súng quanh điểm xuất phát. Hợp để thử súng và luyện ngắm.', size: '200 M', time: '≈ 7 PHÚT' },
  range: { title: 'TRƯỜNG BẮN', blurb: 'Năm làn bia từ 15 đến 250 m, bia di động, khu bot bắn trả và kệ đủ mọi loại vũ khí. Đạn vô hạn, có thể bật bất tử để luyện thoải mái.', size: '400 M', time: 'KHÔNG GIỚI HẠN' },
  desert: { title: 'SA MẠC ĐỎ', blurb: 'Cồn cát và cao nguyên đá, vài ốc đảo, thị trấn cách xa nhau. Tìm xe để vượt sa mạc trước khi bo khép lại, và đừng để lộ mình giữa trời trống.', size: '5 × 5 KM', time: '≈ 20 PHÚT' },
  pines: { title: 'RỪNG THÔNG', blurb: 'Cao nguyên phủ rừng thông dày, hồ rải rác và những con dốc. Chỗ nấp khắp nơi, tầm nhìn chẳng được bao xa.', size: '4,5 × 4,5 KM', time: '≈ 20 PHÚT' },
  metro: { title: 'ĐÔ THỊ', blurb: 'Năm thành phố sát nhau, nhà cao tầng và công viên xen giữa. Giao tranh liên miên trong phố, chiếm tầng cao để làm chủ.', size: '3 × 3 KM', time: '≈ 20 PHÚT' },
};
const readMap = (value: unknown): MapId => typeof value === 'string' && Object.hasOwn(MAP_INFO, value) ? value as MapId : 'island';
const SETTINGS_KEY = 'lastlight.settings.v1';
const BEST_KEY = 'lastlight.best.v1';
const TIPS_KEY = 'lastlight.tips.v1';
const FIRE_MODE_LABELS = { auto: 'TỰ ĐỘNG', semi: 'BÁN TỰ ĐỘNG', bolt: 'LÊN ĐẠN TỪNG PHÁT' } as const;
const icons = {
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  target: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2"/><circle cx="15" cy="17" r="2"/>',
  medkit: '<path d="M9 5V3h6v2M3 7h18v14H3zM9 14h6m-3-3v6"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/>',
  sound: '<path d="m11 4-5 5H3v6h3l5 5zM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  mouse: '<rect x="7" y="3" width="10" height="18" rx="5"/><path d="M12 7v4"/>',
  recoil: '<path d="M13 3 5 14h6l-1 7 8-11h-6z"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 16 5-5 4 4 3-3 6 6"/>',
  gauge: '<path d="M4 17a8 8 0 1 1 16 0"/><path d="m12 17 4-5"/>',
  bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
  radar: '<circle cx="12" cy="12" r="2"/><path d="M7 7a7 7 0 0 0 0 10M17 7a7 7 0 0 1 0 10M4 4a11 11 0 0 0 0 16M20 4a11 11 0 0 1 0 16"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  reset: '<path d="M4 12a8 8 0 1 0 3-6.2M4 4v4h4"/>',
};
function icon(name: keyof typeof icons): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
}
function readJson(key: string): unknown {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return null; }
}
function saveJson(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage can be disabled in private browsing. */ }
}
function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}
/** Defaults that depend on the device: phones start with a lighter picture, gyro aiming, aim help and the gunfire indicator. */
function deviceDefaults(): GameSettings {
  const touch = document.documentElement.dataset.input === 'touch';
  return { ...DEFAULT_SETTINGS, quality: touch ? 'low' : 'high', gyro: touch ? 'aim' : 'off', aimAssist: touch ? 'low' : 'off', recoilScale: 1, soundIndicator: touch };
}
function readSettings(): GameSettings {
  const defaults = deviceDefaults();
  const value = readJson(SETTINGS_KEY);
  if (!value || typeof value !== 'object') return defaults;
  const raw = value as Partial<GameSettings>;
  const map = readMap(raw.map);
  return {
    difficulty: raw.difficulty === 'easy' ? 'easy' : 'normal',
    map,
    botCount: BOT_CHOICES[map].includes(raw.botCount as number) ? raw.botCount as number : defaultBots(map),
    quality: raw.quality === 'low' || raw.quality === 'high' ? raw.quality : defaults.quality,
    volume: clamp(raw.volume, 0, 1, DEFAULT_SETTINGS.volume),
    sensitivity: clamp(raw.sensitivity, 0.35, 2, DEFAULT_SETTINGS.sensitivity),
    gyro: raw.gyro === 'off' || raw.gyro === 'aim' || raw.gyro === 'always' ? raw.gyro : defaults.gyro,
    gyroSensitivity: clamp(raw.gyroSensitivity, 0.3, 3, DEFAULT_SETTINGS.gyroSensitivity),
    gyroInvertY: raw.gyroInvertY === true,
    tips: raw.tips !== false,
    showFps: raw.showFps === true,
    aimAssist: raw.aimAssist === 'off' || raw.aimAssist === 'low' || raw.aimAssist === 'high' ? raw.aimAssist : defaults.aimAssist,
    recoilScale: clamp(raw.recoilScale, 0.3, 1.5, defaults.recoilScale),
    soundIndicator: typeof raw.soundIndicator === 'boolean' ? raw.soundIndicator : defaults.soundIndicator,
    skin: skinById(raw.skin) ? raw.skin as string : DEFAULT_SKIN,
    immortal: raw.immortal === true,
  };
}
function readBest(): BestRecord {
  const value = readJson(BEST_KEY);
  const raw = value && typeof value === 'object' ? value as Partial<BestRecord> : {};
  const kills = Math.floor(clamp(raw.kills, 0, 999999, 0));
  return { wins: Math.floor(clamp(raw.wins, 0, 999999, 0)), kills, survival: clamp(raw.survival, 0, 999999, 0), killsTotal: Math.floor(clamp(raw.killsTotal, 0, 9999999, kills)) };
}
function formatTime(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60).toString().padStart(2, '0')}:${(value % 60).toString().padStart(2, '0')}`;
}

export class GameUI {
  public settings = readSettings();
  public readonly inventory: InventoryView;
  private inventoryPlayer: Actor | null = null;
  private callbacks: Callbacks;
  private root: HTMLElement;
  private elements = new Map<string, HTMLElement>();
  private texts = new Map<string, string>();
  private supplyKey = '';
  private best = readBest();
  private phase: GameState['phase'] | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private lastMapDraw = -Infinity;
  private lastHits = 0;
  private hitUntil = 0;
  private resultSaved = false;
  private currentWeapon: WeaponType | null = null;
  /** Landing flag the player set on the map, in world coordinates. */
  private flag: Vec2 | null = null;
  private aimStateKey = '';
  private readonly touchMode = document.documentElement.dataset.input === 'touch';

  constructor(callbacks: Callbacks) {
    this.callbacks = callbacks;
    const root = document.getElementById('ui-root');
    if (!root) throw new Error('Thiếu phần tử giao diện #ui-root.');
    this.root = root;
    root.innerHTML = `
      <div id="damage-vignette" class="damage-vignette" aria-hidden="true"></div>
      <div id="flash-overlay" class="flash-overlay" aria-hidden="true"></div>
      <section id="menu-screen" class="menu-screen lobby">
        <header class="lobby-top">
          <a class="wordmark" href="#" aria-label="LASTLIGHT, màn hình chính"><span class="brand-symbol">L<span></span></span><span>LASTLIGHT<small>VÙNG SỐNG CUỐI CÙNG</small></span></a>
          <nav class="lobby-nav" aria-label="Màn hình chính"><button id="tab-play" class="tab active" type="button">CHIẾN ĐẤU</button><button id="tab-settings" class="tab" type="button">THIẾT LẬP</button></nav>
          <div id="profile-chip" class="profile-chip" aria-label="Thành tích của bạn">
            <div id="profile-id" class="profile-id" role="button" tabindex="0" aria-label="Tài khoản: đăng nhập, kết bạn"><i>${icon('shield')}</i><span><b id="profile-name">NGƯỜI SINH TỒN</b><small id="profile-sub">CHƠI NGAY · ĐĂNG NHẬP ĐỂ KẾT BẠN</small></span></div>
            <dl><div><dt>THẮNG</dt><dd id="best-wins">0</dd></div><div><dt>HẠ GỤC</dt><dd id="best-kills">0</dd></div><div><dt id="best-third-label">SỐNG LÂU NHẤT</dt><dd id="best-time">00:00</dd></div></dl>
          </div>
        </header>
        <div class="lobby-stage">
          <div class="lobby-spot" aria-hidden="true"><span class="spot-tag">SẴN SÀNG</span><span id="spot-name" class="spot-name">BẠN</span><span class="spot-line"></span><span id="spot-gear" class="spot-gear"></span></div>
          <aside class="lobby-panel">
            <div id="play-panel" class="panel-play">
              <div class="panel-title"><span>CHỌN CHIẾN TRƯỜNG</span><em>ĐƠN · ĐẤU BOT</em></div>
              <div id="map-choice" class="map-tabs" role="radiogroup" aria-label="Bản đồ">
                <button type="button" role="radio" data-value="island"><b>ĐẢO</b><small>4 × 4 km</small></button>
                <button type="button" role="radio" data-value="valley"><b>ĐẤU TRƯỜNG</b><small>1 × 1 km</small></button>
                <button type="button" role="radio" data-value="desert"><b>SA MẠC</b><small>5 × 5 km · 20 phút</small></button>
                <button type="button" role="radio" data-value="pines"><b>RỪNG THÔNG</b><small>4,5 × 4,5 km · 20 phút</small></button>
                <button type="button" role="radio" data-value="metro"><b>ĐÔ THỊ</b><small>3 × 3 km · 20 phút</small></button>
                <button type="button" role="radio" data-value="arena"><b>SÂN TẬP</b><small>200 m</small></button>
                <button type="button" role="radio" data-value="range"><b>TRƯỜNG BẮN</b><small>Bia · bot · bất tử</small></button>
              </div>
              <div class="mode-card">
                <div class="mode-map"><canvas id="menu-map" width="320" height="320" aria-label="Bản đồ chiến trường"></canvas></div>
                <div class="mode-info">
                  <h2 id="preview-title">ĐẢO LASTLIGHT</h2>
                  <p id="preview-blurb"></p>
                  <ul class="mode-tags"><li id="preview-size">4 × 4 KM</li><li><span id="brief-bots">100</span> BOT</li><li id="preview-time">≈ 10 PHÚT</li></ul>
                </div>
              </div>
              <div class="panel-row">
                <div class="setting-group"><span class="group-label">SỐ ĐỐI THỦ</span><div id="bot-choice" class="seg seg-compact" role="radiogroup" aria-label="Số lượng bot"></div></div>
                <div class="setting-group"><span class="group-label">ĐỘ KHÓ</span><div id="difficulty-choice" class="seg seg-compact" role="radiogroup" aria-label="Độ khó"><button type="button" role="radio" data-value="normal"><b>Tiêu chuẩn</b></button><button type="button" role="radio" data-value="easy"><b>Dễ</b></button></div></div>
                <div id="immortal-group" class="setting-group" hidden><span class="group-label">BẤT TỬ</span><div id="immortal-choice" class="seg seg-compact" role="radiogroup" aria-label="Bất tử"><button type="button" role="radio" data-value="off"><b>Tắt</b></button><button type="button" role="radio" data-value="on"><b>Bật</b></button></div></div>
              </div>
              <button id="start-button" class="start-button" type="button"><span class="start-label">${icon('target')}<span><b>BẮT ĐẦU TRẬN</b><small id="start-sub">100 đối thủ · ≈ 10 phút</small></span></span>${icon('arrow')}</button>
              <button id="multi-button" class="button button-secondary multi-button" type="button">CHƠI VỚI BẠN BÈ · ONLINE ${icon('arrow')}</button>
            </div>
            <div id="settings-panel" class="settings-panel" hidden>
              <div class="panel-title"><span>CHUẨN BỊ TRƯỚC KHI VÀO TRẬN</span><em>THIẾT LẬP</em></div>
              <p class="settings-copy">Điều chỉnh để chơi thoải mái trên máy của bạn.</p>
              <section class="set-group"><h3 class="set-title">NHÂN VẬT</h3><div class="set-card"><div id="skin-grid" class="skin-grid" role="radiogroup" aria-label="Trang phục"></div></div></section>
              <section class="set-group"><h3 class="set-title">ÂM THANH</h3><div class="set-card">
                <label class="set-row set-slider"><span class="set-ico">${icon('sound')}</span><span class="set-text"><b>Âm lượng</b><small>Tiếng súng, nhạc và âm thanh trong trận</small></span><output id="volume-value">60%</output><input id="volume" type="range" min="0" max="1" step="0.05" aria-label="Âm lượng"></label>
              </div></section>
              <section class="set-group"><h3 class="set-title">ĐIỀU KHIỂN</h3><div class="set-card">
                <label class="set-row set-slider"><span class="set-ico">${icon('mouse')}</span><span class="set-text"><b>Độ nhạy chuột</b><small>Giá trị thấp giúp ngắm chính xác hơn</small></span><output id="sensitivity-value">1.00×</output><input id="sensitivity" type="range" min="0.35" max="2" step="0.05" aria-label="Độ nhạy chuột"></label>
                <label class="set-row set-slider"><span class="set-ico">${icon('recoil')}</span><span class="set-text"><b>Độ giật súng</b><small>1× là mặc định: mỗi phát hất nhẹ góc nhìn rồi tự hồi lại. Thấp hơn thì nhẹ hơn</small></span><output id="recoil-value">1.00×</output><input id="recoil-scale" type="range" min="0.3" max="1.5" step="0.05" aria-label="Độ giật súng"></label>
                <div class="set-block setting-gyro touch-only">
                  <div class="set-row set-head"><span class="set-ico">${icon('phone')}</span><span class="set-text"><b>Con quay hồi chuyển</b><small id="gyro-status"></small></span></div>
                  <div id="gyro-choice" class="seg seg-compact" role="radiogroup" aria-label="Chế độ con quay hồi chuyển"><button type="button" role="radio" data-value="off"><b>Tắt</b></button><button type="button" role="radio" data-value="aim"><b>Khi ngắm</b><small>ngắm hoặc đang bắn</small></button><button type="button" role="radio" data-value="always"><b>Luôn bật</b></button></div>
                  <label class="set-row set-slider"><span class="set-ico">${icon('phone')}</span><span class="set-text"><b>Độ nhạy cảm biến</b><small>1× = camera quay đúng bằng góc bạn xoay điện thoại</small></span><output id="gyro-sensitivity-value">1.00×</output><input id="gyro-sensitivity" type="range" min="0.3" max="3" step="0.05" aria-label="Độ nhạy con quay hồi chuyển"></label>
                  <label class="set-row set-toggle"><span class="set-ico">${icon('phone')}</span><span class="set-text"><b>Đảo chiều lên / xuống</b><small>Bật nếu nghiêng điện thoại lên mà tâm đi xuống</small></span><input id="gyro-invert" class="switch" type="checkbox" role="switch" aria-label="Đảo chiều lên xuống của con quay hồi chuyển"></label>
                </div>
                <div class="set-block setting-gyro touch-only">
                  <div class="set-row set-head"><span class="set-ico">${icon('target')}</span><span class="set-text"><b>Hỗ trợ ngắm</b><small>Camera chậm lại khi tâm lướt qua địch và hút nhẹ về thân khi bạn bắn hoặc ngắm</small></span></div>
                  <div id="assist-choice" class="seg seg-compact" role="radiogroup" aria-label="Hỗ trợ ngắm"><button type="button" role="radio" data-value="off"><b>Tắt</b></button><button type="button" role="radio" data-value="low"><b>Nhẹ</b></button><button type="button" role="radio" data-value="high"><b>Mạnh</b><small>như Free Fire</small></button></div>
                </div>
              </div></section>
              <section class="set-group"><h3 class="set-title">HÌNH ẢNH</h3><div class="set-card">
                <label class="set-row set-select"><span class="set-ico">${icon('image')}</span><span class="set-text"><b>Chất lượng hình ảnh</b><small>Giảm chất lượng nếu máy chạy chậm</small></span><select id="quality" aria-label="Chất lượng hình ảnh"><option value="high">Cao</option><option value="low">Thấp · ưu tiên FPS</option></select></label>
                <label class="set-row set-toggle"><span class="set-ico">${icon('gauge')}</span><span class="set-text"><b>Hiện FPS và thông số mạng</b><small>Số khung hình mỗi giây, số vật thể đang vẽ, ping và độ ổn định mạng</small></span><input id="show-fps" class="switch" type="checkbox" role="switch" aria-label="Hiện FPS"></label>
              </div></section>
              <section class="set-group"><h3 class="set-title">TRỢ GIÚP</h3><div class="set-card">
                <label class="set-row set-toggle"><span class="set-ico">${icon('radar')}</span><span class="set-text"><b>Hiện hướng tiếng súng</b><small>Vệt nhạt quanh tâm chỉ hướng người khác nổ súng gần bạn</small></span><input id="sound-indicator" class="switch" type="checkbox" role="switch" aria-label="Hiện hướng tiếng súng"></label>
                <label class="set-row set-toggle"><span class="set-ico">${icon('bulb')}</span><span class="set-text"><b>Gợi ý cho người mới</b><small>Mẹo ngắn hiện một lần, lần đầu bạn gặp từng tình huống</small></span><input id="tips" class="switch" type="checkbox" role="switch" aria-label="Gợi ý cho người mới"></label>
              </div></section>
              <div class="set-foot"><span class="settings-saved">Thiết lập được lưu tự động trên trình duyệt này.</span><button id="reset-settings" class="set-reset" type="button">${icon('reset')}Khôi phục mặc định</button></div><button id="back-play" class="button button-secondary" type="button">TRỞ VỀ CHIẾN ĐẤU ${icon('arrow')}</button>
            </div>
          </aside>
        </div>
        <footer class="lobby-foot">
          <div class="guide-keys desktop-controls"><span><kbd>W A S D</kbd>Di chuyển / lái dù</span><span><kbd>SPACE</kbd>Nhảy dù · mở dù</span><span><kbd>CHUỘT</kbd>Ngắm / bắn</span><span><kbd>E</kbd>Nhặt đồ</span><span><kbd>F</kbd>Lên / xuống xe</span><span><kbd>1 – 3</kbd>Chọn súng</span><span><kbd>Tab / I</kbd>Kho đồ</span><span><kbd>M</kbd>Bản đồ lớn</span><span><kbd>ESC</kbd>Tạm dừng</span></div>
          <div class="touch-guide"><span><b>NGÓN TRÁI</b>Kéo cần để di chuyển</span><span><b>NGÓN PHẢI</b>Vuốt để xoay camera</span><span><b>NÚT NGẮM</b>Bật / tắt ống ngắm</span><span><b>NÚT NHẢY</b>Nhảy khỏi máy bay · mở dù</span></div>
          <div class="touch-orientation-note">Xoay điện thoại ngang để chơi thoải mái.</div>
        </footer>
      </section>
      <div id="scope-overlay" class="optic optic-scope" aria-label="Ống ngắm" hidden>
        <div class="scope-blur"></div>
        <div class="scope-body" aria-hidden="true">
          <i class="scope-turret scope-turret-l"></i><i class="scope-turret scope-turret-r"></i><i class="scope-turret scope-turret-t"></i>
          <div class="scope-ring"></div>
        </div>
        <svg class="scope-reticle" viewBox="0 0 1000 1000" fill="none" aria-hidden="true">
          <g stroke="#050605" stroke-linecap="butt">
            <path stroke-width="9" d="M0 500H215M785 500H1000M500 785V1000"/>
            <path stroke-width="9" d="M500 0V215" opacity="0"/>
            <path stroke-width="2" d="M215 500H478M522 500H785M500 215V478M500 522V785"/>
          </g>
          <g fill="#050605">
            <circle cx="300" cy="500" r="3.4"/><circle cx="360" cy="500" r="3.4"/><circle cx="420" cy="500" r="3.4"/><circle cx="580" cy="500" r="3.4"/><circle cx="640" cy="500" r="3.4"/><circle cx="700" cy="500" r="3.4"/>
            <circle cx="500" cy="300" r="3.4"/><circle cx="500" cy="360" r="3.4"/><circle cx="500" cy="420" r="3.4"/><circle cx="500" cy="580" r="3.4"/><circle cx="500" cy="640" r="3.4"/><circle cx="500" cy="700" r="3.4"/>
          </g>
          <circle cx="500" cy="500" r="1.6" fill="#050605"/>
        </svg>
        <div class="scope-readout"><span>Điểm zero</span><strong id="scope-zero">100 m</strong></div>
        <div id="scope-breath" class="scope-breath"><span id="scope-breath-label">NÍN THỞ · SHIFT</span><i><b id="scope-breath-fill"></b></i></div>
        <button id="scope-breath-btn" class="scope-breath-btn" type="button" aria-label="Giữ để nín thở">NÍN THỞ</button>
        <div class="scope-zoombar"><button id="scope-zoom-out" type="button" aria-label="Giảm độ phóng đại">−</button><div><strong id="scope-zoom">6×</strong><small>Lăn chuột để đổi</small></div><button id="scope-zoom-in" type="button" aria-label="Tăng độ phóng đại">+</button></div>
      </div>
      <div id="range-armoury" class="armoury" role="dialog" aria-modal="true" aria-label="Kho vũ khí" hidden>
        <div class="armoury-card">
          <header class="armoury-head"><h2>KHO VŨ KHÍ</h2><input id="armoury-search" type="search" placeholder="Tìm súng…" autocomplete="off" aria-label="Tìm súng"><button id="armoury-close" type="button" aria-label="Đóng">✕</button></header>
          <nav id="armoury-classes" class="armoury-classes" aria-label="Loại súng"></nav>
          <div id="armoury-grid" class="armoury-grid" role="listbox" aria-label="Danh sách súng"></div>
          <footer class="armoury-foot">Bấm vào một khẩu để lấy ngay · đạn, phụ kiện và đồ hồi máu đều vô hạn · B hoặc Esc để đóng</footer>
        </div>
      </div>
      <section id="hud" class="hud" aria-label="Thông tin trận đấu" hidden>
        <button id="inventory-toggle" class="inventory-toggle" type="button" aria-label="Mở kho đồ" aria-controls="inventory-screen" aria-expanded="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 7V5a4 4 0 0 1 8 0v2M5 8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v12H5zM5 14h14M9 17h6"/></svg><span>KHO ĐỒ</span><kbd>Tab</kbd></button>
        <div class="hud-brand"><span class="brand-symbol">L<span></span></span><span>LASTLIGHT<small>SOLO</small></span></div>
        <div class="compass"><div class="compass-needle"></div><div id="compass-labels" class="compass-labels"></div><span id="compass-degrees" class="compass-degrees">000°</span></div>
        <div class="match-stats"><div><span>CÒN SỐNG</span><strong id="alive-count">6</strong></div><div><span>HẠ GỤC</span><strong id="kill-count">0</strong></div><div><span>THỜI GIAN</span><strong id="match-time">00:00</strong></div></div>
        <div id="range-panel" class="range-panel" hidden>
          <div class="range-title">TRƯỜNG BẮN</div>
          <div id="range-last" class="range-last">Chưa bắn trúng bia</div>
          <div id="range-stats" class="range-stats">—</div>
          <div class="range-actions">
            <button id="range-immortal" type="button" aria-pressed="false">BẤT TỬ: <b id="range-immortal-state">TẮT</b> <kbd>K</kbd></button>
            <button id="range-armoury-btn" type="button">KHO VŨ KHÍ <kbd>B</kbd></button>
          </div>
        </div>
        <div id="zone-banner" class="zone-banner"><span class="zone-dot"></span><div><span id="zone-title">VÙNG AN TOÀN</span><small id="zone-description">Vòng bo sẽ thu hẹp</small></div><strong id="zone-time">00:00</strong></div>
        <div id="crosshair" class="crosshair" aria-hidden="true"><i></i><i></i><i></i><i></i><b></b></div><div id="hit-marker" class="hit-marker" aria-hidden="true">×</div><div id="vehicle-hud" class="vehicle-hud" hidden><div class="vehicle-speed"><strong id="vehicle-speed">0</strong><span>KM/H</span></div><div class="vehicle-health"><i id="vehicle-health-bar"></i></div><small class="desktop-controls">W / S GA · A / D LÁI · SPACE PHANH · F XUỐNG XE</small></div><div id="sound-dirs" class="sound-dirs" aria-hidden="true">${[0, 1, 2, 3].map(i => `<div id="sound-dir-${i}" class="sound-dir"><i></i></div>`).join('')}</div><div id="damage-dir" class="damage-dir" aria-hidden="true"><i></i></div><div id="kill-feed" class="kill-feed" aria-live="off"></div>
        <div id="air-hud" class="air-hud" hidden><div id="air-stage" class="air-stage">TRÊN MÁY BAY</div><div class="air-readout"><div><strong id="air-alt">0</strong><span>M · ĐỘ CAO</span></div><div><strong id="air-speed">0</strong><span>KM/H</span></div><div><strong id="air-left">0</strong><span id="air-left-label">GIÂY</span></div></div><div id="air-prompt" class="air-prompt"></div></div>
        <div id="stance-badge" class="stance-badge" hidden></div><div id="perf-meter" class="perf-meter" hidden aria-hidden="true"></div><div id="spectate-bar" class="spectate-bar" hidden><span id="spectate-name">ĐANG XEM</span><small id="spectate-help"></small><button id="spectate-exit" type="button">THOÁT</button></div><div id="air-streaks" class="air-streaks" hidden aria-hidden="true"></div><div id="air-flag" class="air-flag" hidden></div>
        <div id="interaction-hint" class="interaction-hint" hidden></div><div id="action-progress" class="action-progress" hidden></div>
        <div class="health-panel"><div class="player-label"><span class="status-dot"></span>BẠN <span id="health-number">100</span><small>HP</small></div><div class="health-track"><div id="health-bar"></div></div><div id="boost-track" class="boost-track" hidden aria-label="Thanh tăng lực"><i>TĂNG LỰC</i><div><div id="boost-bar"></div></div></div><div id="armor-row" class="armor-row" aria-label="Giáp đang mặc"></div><div class="health-meta"><span>${icon('medkit')}<strong id="medkits">1</strong> TÚI CỨU THƯƠNG <kbd>H</kbd></span><span id="health-status">SẴN SÀNG</span></div><div id="supply-row" class="supply-row" aria-label="Vật phẩm hồi phục"></div></div>
        <div id="weapon-panel" class="weapon-panel"><div class="weapon-active"><div class="weapon-label"><span id="weapon-name">${WEAPONS.rifle.label}</span><small id="weapon-mode">${FIRE_MODE_LABELS[WEAPONS.rifle.fireMode]}</small><em id="weapon-category">${WEAPONS.rifle.category}</em></div><div class="ammo-count"><strong id="ammo-loaded">${WEAPONS.rifle.magazine}</strong><span>/ <b id="ammo-reserve">0</b></span></div></div><button id="touch-inventory-toggle" class="touch-inventory-toggle" type="button" aria-expanded="false" aria-controls="weapon-inventory">Kho súng ${icon('arrow')}</button><div id="weapon-inventory" class="weapon-slots" aria-label="Vũ khí đang mang"></div><div id="ammo-message" class="ammo-message">R · NẠP ĐẠN</div><div class="weapon-cycle-help">1 · 2 · 3 CHỌN SÚNG <span>Q / CUỘN · ĐỔI SÚNG</span></div></div>
        <div class="minimap-panel"><div class="map-header"><span>BẢN ĐỒ</span><span id="map-stage">VÒNG 1</span></div><canvas id="minimap" width="208" height="208" aria-label="Bản đồ: vị trí của bạn, địa hình và vùng an toàn"></canvas><div class="map-footer"><span><i></i>Vùng an toàn</span><span class="map-north">N ↑</span></div></div>
        <div class="pause-tip"><kbd>ESC</kbd> TẠM DỪNG</div>
        <div class="orientation-hint">Xoay điện thoại ngang để chơi</div>
      </section>
      <section id="pause-screen" class="overlay-screen" aria-labelledby="pause-title" hidden><div class="dialog pause-dialog"><div class="eyebrow"><span class="orange-dash"></span>TRẬN ĐẤU ĐÃ TẠM DỪNG</div><h2 id="pause-title">NGHỈ MỘT NHỊP.</h2><p>Chiến trường đang chờ bạn quay lại.</p><button id="resume-button" class="button button-primary" type="button">TIẾP TỤC TRẬN ${icon('arrow')}</button><button id="pause-restart" class="button button-secondary" type="button">CHƠI LẠI</button><button id="pause-menu" class="text-button" type="button">VỀ MÀN HÌNH CHÍNH</button><small class="dialog-hint">Nhấn ESC để tiếp tục</small></div></section>
      <section id="result-screen" class="overlay-screen results-screen" aria-labelledby="result-title" hidden><div class="result-backdrop-mark" aria-hidden="true">01</div><div class="dialog result-dialog"><div id="result-eyebrow" class="eyebrow"><span class="orange-dash"></span>TRẬN ĐẤU KẾT THÚC</div><span id="result-rank" class="result-rank">#1</span><h2 id="result-title">NGƯỜI SỐNG CUỐI.</h2><p id="result-copy">Bạn đã giữ vững vị trí cho đến giây cuối cùng.</p><div class="result-stats"><div><strong id="result-kills">0</strong><span>HẠ GỤC</span></div><div><strong id="result-time">00:00</strong><span>SỐNG SÓT</span></div><div><strong id="result-accuracy">0%</strong><span>CHÍNH XÁC</span></div></div><button id="replay-button" class="button button-secondary" type="button" hidden>XEM LẠI CÚ HẠ GỤC ${icon('arrow')}</button><button id="spectate-button" class="button button-secondary" type="button" hidden>XEM TIẾP TRẬN ${icon('arrow')}</button><button id="restart-button" class="button button-primary" type="button"><span id="restart-button-label">VÀO TRẬN MỚI</span> ${icon('arrow')}</button><button id="result-menu" class="text-button" type="button">VỀ MÀN HÌNH CHÍNH</button></div></section>
      <section id="map-screen" class="map-screen" aria-label="Bản đồ lớn" hidden><div class="map-card"><div class="map-card-head"><b>BẢN ĐỒ</b><span id="bigmap-stage">VÒNG 1</span><kbd>M</kbd><small>ĐÓNG</small></div><canvas id="bigmap" width="880" height="880"></canvas><div class="map-legend"><span><i class="lg-player"></i>Bạn</span><span><i class="lg-zone"></i>Vùng an toàn</span><span><i class="lg-next"></i>Vòng kế tiếp</span><span><i class="lg-town"></i>Thị trấn</span><span><i class="lg-crate"></i>Hộp tiếp tế</span><span class="map-tip">Chạm bản đồ để đặt hoặc bỏ cờ đáp</span></div></div></section><div id="replay-bar" class="replay-bar" hidden><span id="replay-title">PHÁT LẠI · 8 GIÂY CUỐI</span><small id="replay-detail"></small><button id="replay-stop" type="button">ĐÓNG</button></div><div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
      <div id="error-banner" class="error-banner" role="alert" hidden></div>
      <div id="loading-screen" class="loading-screen" role="status" aria-live="polite" hidden><div class="loading-spinner"></div><span id="loading-text">ĐANG CHUẨN BỊ CHIẾN TRƯỜNG</span></div>
    `;
    root.querySelectorAll<HTMLElement>('[id]').forEach(element => this.elements.set(element.id, element));
    this.inventory = new InventoryView(root, {
      onClose: () => this.toggleInventory(false),
      onSelectWeapon: weapon => this.callbacks.onSelectWeapon?.(weapon),
      onPickup: id => this.callbacks.onInventoryPickup?.(id),
      onDrop: (kind, amount) => this.callbacks.onInventoryDrop?.(kind, amount),
      onHeal: () => this.callbacks.onInventoryHeal?.(),
      onUse: kind => this.callbacks.onInventoryUse?.(kind),
      onAttach: kind => this.callbacks.onInventoryAttach?.(kind),
      onDetach: (weapon, slot) => this.callbacks.onInventoryDetach?.(weapon, slot),
      onOpenChange: open => {
        if (open) this.root.dataset.inventory = 'open'; else delete this.root.dataset.inventory;
        this.el('inventory-toggle').setAttribute('aria-expanded', String(open));
        this.callbacks.onTouchOverlayChange?.(this.touchOverlayOpen);
        this.callbacks.onInventoryChange?.(open);
      },
    });
    this.el('inventory-toggle').addEventListener('click', () => this.toggleInventory());
    const choose = (id: string, handler: (value: string) => void) => this.el(id).addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-value]');
      if (button) handler(button.dataset.value!);
    });
    choose('difficulty-choice', value => this.changeSettings({ difficulty: value === 'easy' ? 'easy' : 'normal' }));
    choose('bot-choice', value => this.changeSettings({ botCount: Number(value) }));
    choose('immortal-choice', value => this.changeSettings({ immortal: value === 'on' }));
    choose('assist-choice', value => this.changeSettings({ aimAssist: value === 'high' ? 'high' : value === 'low' ? 'low' : 'off' }));
    this.el('recoil-scale').addEventListener('input', () => this.changeSettings({ recoilScale: Number((this.el('recoil-scale') as HTMLInputElement).value) }));
    choose('gyro-choice', value => this.changeSettings({ gyro: value === 'always' ? 'always' : value === 'aim' ? 'aim' : 'off' }));
    this.el('gyro-sensitivity').addEventListener('input', () => this.changeSettings({ gyroSensitivity: Number((this.el('gyro-sensitivity') as HTMLInputElement).value) }));
    this.el('sound-indicator').addEventListener('change', () => this.changeSettings({ soundIndicator: (this.el('sound-indicator') as HTMLInputElement).checked }));
    this.el('tips').addEventListener('change', () => this.changeSettings({ tips: (this.el('tips') as HTMLInputElement).checked }));
    this.el('show-fps').addEventListener('change', () => this.changeSettings({ showFps: (this.el('show-fps') as HTMLInputElement).checked }));
    this.el('gyro-invert').addEventListener('change', () => this.changeSettings({ gyroInvertY: (this.el('gyro-invert') as HTMLInputElement).checked }));
    choose('map-choice', value => { const map = readMap(value); this.changeSettings({ map, botCount: defaultBots(map) }); });
    this.el('quality').addEventListener('change', () => this.changeSettings({ quality: (this.el('quality') as HTMLSelectElement).value === 'low' ? 'low' : 'high' }));
    this.el('volume').addEventListener('input', () => this.changeSettings({ volume: Number((this.el('volume') as HTMLInputElement).value) }));
    this.el('sensitivity').addEventListener('input', () => this.changeSettings({ sensitivity: Number((this.el('sensitivity') as HTMLInputElement).value) }));
    // Tapping a grenade chip chooses it (phones have no V key).
    this.el('supply-row').addEventListener('click', event => {
      const chip = (event.target as HTMLElement).closest<HTMLElement>('[data-supply]');
      const kind = chip?.dataset.supply;
      if (kind && (THROW_ORDER as string[]).includes(kind)) this.callbacks.onThrowSelect?.(kind as import('./game/supplies').ThrowKind);
    });
    this.el('skin-grid').addEventListener('click', event => {
      const card = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-skin]');
      const skin = skinById(card?.dataset.skin);
      if (!skin) return;
      if (!isUnlocked(skin, this.unlockStats())) { this.notify(`Chưa mở khóa: ${lockText(skin, this.unlockStats())}`); return; }
      this.changeSettings({ skin: skin.id });
    });
    this.el('reset-settings').addEventListener('click', () => { const { difficulty, map, botCount, ...rest } = deviceDefaults(); void difficulty; void map; void botCount; this.changeSettings(rest); });
    this.el('tab-play').addEventListener('click', () => this.showSettings(false));
    this.el('tab-settings').addEventListener('click', () => this.showSettings(true));
    this.el('back-play').addEventListener('click', () => this.showSettings(false));
    root.querySelector('.wordmark')?.addEventListener('click', event => { event.preventDefault(); this.showSettings(false); });
    this.el('scope-zoom-in').addEventListener('click', () => this.callbacks.onZoomStep?.(1));
    const breathButton = this.el('scope-breath-btn');
    for (const type of ['pointerdown']) breathButton.addEventListener(type, event => { event.preventDefault(); this.callbacks.onBreath?.(true); });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) breathButton.addEventListener(type, () => this.callbacks.onBreath?.(false));
    this.el('range-immortal').addEventListener('click', () => this.toggleImmortal());
    this.el('range-armoury-btn').addEventListener('click', () => this.toggleArmoury());
    this.el('armoury-close').addEventListener('click', () => this.toggleArmoury(false));
    this.el('armoury-search').addEventListener('input', () => this.renderArmoury());
    this.el('armoury-classes').addEventListener('click', event => {
      const tab = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-class]');
      if (!tab) return;
      this.armouryClass = tab.dataset.class ?? 'all';
      this.renderArmoury();
    });
    this.el('armoury-grid').addEventListener('click', event => {
      const card = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-weapon]');
      if (!card) return;
      this.armouryPicked = card.dataset.weapon as WeaponType;
      this.callbacks.onRangeEquip?.(this.armouryPicked);
      this.renderArmoury();
    });
    this.el('range-armoury').addEventListener('keydown', event => {
      if (event.key === 'Escape' || (event.code === 'KeyB' && (event.target as HTMLElement).id !== 'armoury-search')) { event.preventDefault(); event.stopPropagation(); this.toggleArmoury(false); }
    });
    this.el('scope-zoom-out').addEventListener('click', () => this.callbacks.onZoomStep?.(-1));
    this.el('start-button').addEventListener('click', () => { this.hide('error-banner', true); this.callbacks.onStart({ ...this.settings }); });
    this.el('resume-button').addEventListener('click', callbacks.onResume);
    this.el('multi-button').addEventListener('click', () => callbacks.onMultiplayer?.());
    const chip = this.el('profile-id');
    chip.addEventListener('click', () => callbacks.onAccount?.());
    chip.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); callbacks.onAccount?.(); } });
    this.el('pause-restart').addEventListener('click', callbacks.onRestart);
    this.el('restart-button').addEventListener('click', callbacks.onRestart);
    this.el('spectate-button').addEventListener('click', () => callbacks.onSpectate?.());
    this.el('replay-button').addEventListener('click', () => callbacks.onReplay?.());
    this.el('replay-stop').addEventListener('click', () => callbacks.onReplayStop?.());
    this.el('spectate-exit').addEventListener('click', () => callbacks.onSpectateExit?.());
    this.el('pause-menu').addEventListener('click', callbacks.onMenu);
    this.el('result-menu').addEventListener('click', callbacks.onMenu);
    this.el('touch-inventory-toggle').addEventListener('click', () => {
      const open = this.el('weapon-panel').classList.toggle('touch-picker-open');
      this.el('touch-inventory-toggle').setAttribute('aria-expanded', `${open}`);
      this.callbacks.onTouchOverlayChange?.(this.touchOverlayOpen);
    });
    this.el('weapon-inventory').addEventListener('click', event => {
      const card = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-weapon]');
      if (!card) return;
      this.callbacks.onSelectWeapon?.(card.dataset.weapon as WeaponType);
      this.closeWeaponPicker();
    });
    this.el('map-screen').addEventListener('click', event => {
      if (event.target === this.el('map-screen')) this.toggleMap(false);
    });
    const mapClose = document.createElement('button');
    mapClose.id = 'map-close';
    mapClose.className = 'map-close';
    mapClose.type = 'button';
    mapClose.setAttribute('aria-label', 'Đóng bản đồ');
    mapClose.textContent = '×';
    mapClose.addEventListener('click', () => this.toggleMap(false));
    root.querySelector('.map-card-head')?.appendChild(mapClose);
    const minimap = root.querySelector<HTMLElement>('.minimap-panel')!;
    minimap.setAttribute('role', 'button');
    minimap.setAttribute('tabindex', '0');
    minimap.setAttribute('aria-label', 'Mở bản đồ');
    minimap.addEventListener('click', () => this.toggleMap(true));
    minimap.addEventListener('keydown', event => {
      if (event.code === 'Enter' || event.code === 'Space') { event.preventDefault(); event.stopPropagation(); this.toggleMap(true); }
    });
    if (this.touchMode) {
      this.el('sensitivity').setAttribute('aria-label', 'Độ nhạy vuốt camera');
      const sensitivityLabel = this.el('sensitivity').closest('label')?.querySelector('span > span');
      if (sensitivityLabel) sensitivityLabel.innerHTML = 'Độ nhạy vuốt<small>Giá trị thấp giúp ngắm chính xác hơn</small>';
      const pauseHint = root.querySelector('.dialog-hint');
      if (pauseHint) pauseHint.textContent = 'Chạm Tiếp tục trận để quay lại';
    }
    this.el('bigmap').addEventListener('click', event => this.placeFlag(event as MouseEvent));
    this.syncSettings();
    this.updateBest();
  }

  /** The landing flag, or null. */
  public get waypoint(): Vec2 | null { return this.flag; }
  public setWaypoint(point: Vec2 | null): void {
    this.flag = point;
    if (this.lastState && this.lastWorld) { this.drawMinimap(this.lastState, this.lastWorld); if (this.mapOpen) this.drawBigMap(this.lastState, this.lastWorld); }
  }
  /** Change the gyroscope mode from the game screen (the in-game toggle) and remember it. */
  public setGyro(mode: GyroMode): void { this.changeSettings({ gyro: mode }); }

  /** A click on the big map plants the flag there; a click on the flag removes it. */
  private placeFlag(event: MouseEvent): void {
    const world = this.lastWorld;
    if (!world || world.id === 'arena' || world.id === 'range') return;
    const canvas = this.el('bigmap') as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0) return;
    const px = (event.clientX - rect.left) * canvas.width / rect.width;
    const py = (event.clientY - rect.top) * canvas.height / rect.height;
    const size = canvas.width;
    const scale = (size - 18) / (world.halfSize * 2);
    const point = {
      x: Math.max(-world.halfSize, Math.min(world.halfSize, (px - size / 2) / scale)),
      z: Math.max(-world.halfSize, Math.min(world.halfSize, -(py - size / 2) / scale)),
    };
    const near = this.flag && Math.hypot((this.flag.x - point.x) * scale, (this.flag.z - point.z) * scale) < 22;
    this.setWaypoint(near ? null : point);
    this.notify(near ? 'Đã bỏ cờ đáp.' : 'Đã đặt cờ đáp. Nhảy rồi bay tới đó!');
  }

  private el(id: string): HTMLElement { return this.elements.get(id)!; }
  private text(id: string, text: string): void {
    if (this.texts.get(id) === text) return;
    this.el(id).textContent = text;
    this.texts.set(id, text);
  }
  private hide(id: string, hidden: boolean): void {
    if (this.el(id).hidden !== hidden) this.el(id).hidden = hidden;
  }
  private changeSettings(partial: Partial<GameSettings>): void {
    this.settings = { ...this.settings, ...partial };
    saveJson(SETTINGS_KEY, this.settings);
    this.syncSettings();
    this.callbacks.onSettings({ ...this.settings });
  }
  private syncSettings(): void {
    const mark = (id: string, value: string) => this.el(id).querySelectorAll<HTMLButtonElement>('button[data-value]').forEach(button => {
      const on = button.dataset.value === value;
      button.classList.toggle('on', on);
      button.setAttribute('aria-checked', `${on}`);
    });
    const choices = BOT_CHOICES[this.settings.map];
    const bots = this.el('bot-choice');
    if (bots.children.length !== choices.length || (bots.children[0] as HTMLElement).dataset.value !== `${choices[0]}`) {
      bots.innerHTML = choices.map(n => `<button type="button" role="radio" data-value="${n}"><b>${n}</b><small>bot</small></button>`).join('');
    }
    mark('map-choice', this.settings.map);
    mark('immortal-choice', this.settings.immortal ? 'on' : 'off');
    this.hide('immortal-group', this.settings.map !== 'range');
    mark('bot-choice', `${this.settings.botCount}`);
    mark('difficulty-choice', this.settings.difficulty);
    mark('gyro-choice', this.settings.gyro);
    mark('assist-choice', this.settings.aimAssist);
    (this.el('recoil-scale') as HTMLInputElement).value = `${this.settings.recoilScale}`;
    this.text('recoil-value', `${this.settings.recoilScale.toFixed(2)}×`);
    (this.el('gyro-sensitivity') as HTMLInputElement).value = `${this.settings.gyroSensitivity}`;
    this.text('gyro-sensitivity-value', `${this.settings.gyroSensitivity.toFixed(2)}×`);
    (this.el('gyro-invert') as HTMLInputElement).checked = this.settings.gyroInvertY;
    (this.el('tips') as HTMLInputElement).checked = this.settings.tips;
    (this.el('sound-indicator') as HTMLInputElement).checked = this.settings.soundIndicator;
    (this.el('show-fps') as HTMLInputElement).checked = this.settings.showFps;
    const info = MAP_INFO[this.settings.map];
    this.text('preview-title', info.title);
    this.text('preview-blurb', info.blurb);
    this.text('start-sub', `${this.settings.botCount} đối thủ · ${info.time.replace('≈ ', '≈ ').toLowerCase()}`);
    this.text('preview-size', info.size);
    this.text('preview-time', info.time);
    this.drawMenuMap();
    (this.el('quality') as HTMLSelectElement).value = this.settings.quality;
    (this.el('volume') as HTMLInputElement).value = `${this.settings.volume}`;
    (this.el('sensitivity') as HTMLInputElement).value = `${this.settings.sensitivity}`;
    this.text('volume-value', `${Math.round(this.settings.volume * 100)}%`);
    this.text('sensitivity-value', `${this.settings.sensitivity.toFixed(2)}×`);
    this.text('brief-bots', `${this.settings.botCount}`);
    this.renderSkins();
    // Sliders show how far they are filled.
    this.el('settings-panel').querySelectorAll<HTMLInputElement>('input[type=range]').forEach(range => {
      const min = Number(range.min), max = Number(range.max);
      range.style.setProperty('--fill', `${max > min ? Math.round((Number(range.value) - min) / (max - min) * 100) : 0}%`);
    });
  }
  /** What counts towards unlocking outfits: this browser's record or the signed-in account's, whichever is higher. */
  public unlockStats(): PlayerStats {
    return { wins: Math.max(this.best.wins, this.account?.wins ?? 0), kills: Math.max(this.best.killsTotal, this.account?.kills ?? 0) };
  }
  /** The outfit to dress the player in: the chosen one if it has been earned. */
  public currentSkin(): string { return usableSkin(this.settings.skin, this.unlockStats()); }

  private renderSkins(): void {
    const grid = this.el('skin-grid'), stats = this.unlockStats(), chosen = usableSkin(this.settings.skin, stats);
    const key = SKINS.map(skin => skin.id + isUnlocked(skin, stats) + (skin.id === chosen)).join('|');
    if (grid.dataset.key === key) return;
    grid.dataset.key = key;
    grid.innerHTML = SKINS.map(skin => {
      const open = isUnlocked(skin, stats);
      return `<button type="button" role="radio" class="skin-card${skin.id === chosen ? ' on' : ''}${open ? '' : ' locked'}" data-skin="${skin.id}" aria-checked="${skin.id === chosen}" aria-label="${skin.name}${open ? '' : ', chưa mở khóa'}"><span class="skin-swatch"><i style="background:${skin.swatch[0]}"></i><i style="background:${skin.swatch[1]}"></i></span><b>${skin.name}</b><small>${open ? skin.blurb.split('.')[0] : lockText(skin, stats)}</small>${open ? '' : '<em aria-hidden="true">🔒</em>'}</button>`;
    }).join('');
  }

  private showSettings(show: boolean): void {
    this.hide('play-panel', show);
    this.hide('settings-panel', !show);
    this.el('tab-play').classList.toggle('active', !show);
    this.el('tab-settings').classList.toggle('active', show);
  }
  private account: { name: string; wins: number; kills: number; matches: number } | null = null;

  /** Show the signed-in player on the main screen (their saved totals), or this browser's own best when signed out. */
  public setAccount(info: { name: string; wins: number; kills: number; matches: number } | null): void {
    this.account = info;
    this.renderSkins();
    this.el('profile-chip').dataset.signed = info ? 'in' : 'out';
    this.text('spot-name', info ? info.name.toUpperCase() : 'BẠN');
    this.text('profile-name', info ? info.name.toUpperCase() : 'NGƯỜI SINH TỒN');
    this.text('profile-sub', info ? 'ĐÃ ĐĂNG NHẬP · BẠN BÈ' : 'CHƠI NGAY · ĐĂNG NHẬP ĐỂ KẾT BẠN');
    this.text('best-third-label', info ? 'TRẬN' : 'SỐNG LÂU NHẤT');
    this.updateBest();
  }

  private updateBest(): void {
    if (this.account) {
      this.text('best-wins', `${this.account.wins}`);
      this.text('best-kills', `${this.account.kills}`);
      this.text('best-time', `${this.account.matches}`);
      return;
    }
    this.text('best-wins', `${this.best.wins}`);
    this.text('best-kills', `${this.best.kills}`);
    this.text('best-time', formatTime(this.best.survival));
  }
  private closeWeaponPicker(): void {
    this.el('weapon-panel').classList.remove('touch-picker-open');
    this.el('touch-inventory-toggle').setAttribute('aria-expanded', 'false');
    this.callbacks.onTouchOverlayChange?.(this.touchOverlayOpen);
  }

  public get touchOverlayOpen(): boolean {
    return this.inventory.open || this.touchMode && (this.mapOpen || this.el('weapon-panel').classList.contains('touch-picker-open'));
  }

  public get inventoryOpen(): boolean { return this.inventory.open; }

  public toggleInventory(show?: boolean): void {
    const open = show ?? !this.inventory.open;
    if (open && (this.phase !== 'playing' || !this.inventoryPlayer?.alive || this.lastState?.spectating || !this.el('pause-screen').hidden)) return;
    if (open) { this.toggleMap(false); this.closeWeaponPicker(); this.setAim(false, this.inventoryPlayer!.weapon); }
    this.inventory.show(open);
  }

  public updateInventory(player: Actor, nearby: readonly Loot[], online = false): void {
    this.inventoryPlayer = player;
    if (!player.alive || this.phase !== 'playing' || this.lastState?.spectating) this.toggleInventory(false);
    if (this.inventory.open) this.inventory.update(player, nearby, { online });
  }

  public update(state: GameState, world: WorldConfig, hint: string): void {
    this.lastState = state;
    const phaseChanged = this.phase !== state.phase;
    if (phaseChanged) {
      this.phase = state.phase;
      const results = state.phase === 'won' || state.phase === 'lost';
      this.hide('menu-screen', state.phase !== 'menu');
      this.hide('hud', state.phase === 'menu' || results);
      this.hide('pause-screen', state.phase !== 'paused');
      this.hide('result-screen', !results);
      this.root.dataset.phase = state.phase;
      this.hide('scope-overlay', true);
      this.aimStateKey = '';
      this.closeWeaponPicker();
      if (state.phase !== 'playing') { this.toggleMap(false); this.toggleInventory(false); }
      if (state.phase === 'playing') { this.resultSaved = false; this.lastHits = state.hits; }
      if (state.phase === 'menu') this.showSettings(false);
      const focusId = state.phase === 'menu' ? 'start-button' : state.phase === 'paused' ? 'resume-button' : results ? 'restart-button' : null;
      if (focusId) this.el(focusId).focus({ preventScroll: true });
      if (results) this.showResults(state);
    }
    const player = state.actors.find(actor => actor.id === state.localId) ?? state.actors.find(actor => actor.isPlayer);
    if (!player) { this.toggleInventory(false); return; }
    this.inventoryPlayer = player;
    (this.el('inventory-toggle') as HTMLButtonElement).disabled = !player.alive || !!state.spectating;
    if (!player.alive || state.spectating) this.toggleInventory(false);
    if (this.currentWeapon !== player.weapon || phaseChanged) {
      this.currentWeapon = player.weapon;
      this.setAim(false, player.weapon);
    }
    this.el('flash-overlay').style.opacity = state.phase === 'playing' ? `${Math.min(1, Math.max(0, (player.blind ?? 0) / 1.5))}` : '0';
    this.el('damage-vignette').style.opacity = state.phase === 'playing' ? `${Math.min(0.8, Math.max(0, player.hurtTimer) * 2)}` : '0';
    if (state.phase !== 'playing' && state.phase !== 'paused') return;
    const now = performance.now();
    if (state.hits > this.lastHits) this.hitUntil = now + 170;
    this.lastHits = state.hits;
    this.el('hit-marker').classList.toggle('visible', now < this.hitUntil);
    this.text('alive-count', `${state.actors.filter(actor => actor.alive).length}`);
    this.text('kill-count', `${state.kills}`);
    const onRange = world.id === 'range';
    this.root.classList.toggle('on-range', onRange);
    this.hide('range-panel', !onRange);
    if (onRange) this.updateRangePanel(state);
    this.text('match-time', formatTime(state.elapsed));
    this.text('health-number', `${Math.ceil(Math.max(0, player.health))}`);
    this.el('health-bar').style.transform = `scaleX(${Math.max(0, Math.min(1, player.health / 100))})`;
    this.el('health-bar').classList.toggle('low', player.health < 35);
    this.text('medkits', `${player.medkits}`);
    // The boost gauge, and the healing items in the pack as small chips.
    this.hide('boost-track', player.boost <= 0);
    this.el('boost-bar').style.transform = `scaleX(${Math.max(0, Math.min(1, player.boost / 100))})`;
    const picked = player.throwKind && player.supplies[player.throwKind] > 0 ? player.throwKind : THROW_ORDER.find(kind => player.supplies[kind] > 0) ?? null;
    const supplyKey = SUPPLY_ORDER.map(kind => player.supplies[kind]).join(',') + '|' + (picked ?? '') + '|' + (player.melee ?? '');
    if (supplyKey !== this.supplyKey) {
      this.supplyKey = supplyKey;
      const melee = player.melee ? `<span class="supply-chip melee" title="${MELEE[player.melee].label} · X">${itemIcon(player.melee)}<b>X</b></span>` : '';
      this.el('supply-row').innerHTML = melee + SUPPLY_ORDER.filter(kind => player.supplies[kind] > 0).map(kind => {
        const throwing = SUPPLIES[kind].group === 'throw';
        const hint = throwing ? (this.touchMode ? ' · chạm để chọn' : ' · G ném, V đổi loại') : kind === 'painkiller' || kind === 'energy' ? ' · J' : ' · H';
        return `<span class="supply-chip${throwing ? ' throw' : ''}${kind === picked ? ' picked' : ''}" data-supply="${kind}" title="${SUPPLIES[kind].label}${hint}">${itemIcon(kind)}<b>${player.supplies[kind]}</b></span>`;
      }).join('');
    }
    this.el('health-bar').classList.toggle('mid', player.health >= 35 && player.health < 65);
    this.text('health-status', player.healing > 0 ? (player.healKind && SUPPLIES[player.healKind as SupplyKind]?.group === 'boost' ? 'ĐANG DÙNG THUỐC' : 'ĐANG HỒI MÁU') : player.boost > 0 ? 'TĂNG LỰC' : player.health < 35 ? 'CẦN HỒI MÁU' : 'SẴN SÀNG');
    const weaponConfig = WEAPONS[player.weapon];
    this.text('weapon-name', weaponConfig.label);
    const rig = rigStats(player, player.weapon), worn = attachmentsOf(player, player.weapon);
    this.text('weapon-mode', `${FIRE_MODE_LABELS[weaponConfig.fireMode]} · ${rig.zoom}×${rig.silenced ? ' · GIẢM THANH' : ''}${ATTACH_SLOTS.some(slot => worn[slot]) ? ' · ' + ATTACH_SLOTS.filter(slot => worn[slot]).map(slot => ATTACH[worn[slot]!].label.toUpperCase()).filter(label => !label.includes('GIẢM THANH')).join(', ') : ''}`);
    this.text('weapon-category', weaponConfig.category);
    this.text('ammo-loaded', `${player.ammo[player.weapon]}`);
    this.text('ammo-reserve', `${player.reserve[weaponConfig.ammoType]}`);
    this.text('ammo-message', player.reloading > 0 ? `ĐANG NẠP ĐẠN · ${player.reloading.toFixed(1)}s` : player.ammo[player.weapon] === 0 ? this.touchMode ? 'HẾT ĐẠN · CHẠM NẠP' : 'HẾT ĐẠN · NHẤN R' : this.touchMode ? 'ĐẠN SẴN SÀNG' : 'R · NẠP ĐẠN');
    this.el('weapon-panel').classList.toggle('empty', player.ammo[player.weapon] === 0);
    this.renderLoadout(player.ownedWeapons, player.weapon, player.ammo, player.reserve);
    this.renderArmor(player);
    this.expireKillFeed(now);
    this.text('interaction-hint', this.touchMode ? hint.replace('[E]', 'CHẠM NHẶT ·') : hint);
    this.hide('interaction-hint', !hint);
    this.hide('action-progress', player.reloading <= 0 && player.healing <= 0);
    this.text('action-progress', player.healing > 0 ? `HỒI MÁU · ${player.healing.toFixed(1)}s` : `NẠP ĐẠN · ${player.reloading.toFixed(1)}s`);
    const outside = !player.air && Math.hypot(player.position.x - state.zone.center.x, player.position.z - state.zone.center.z) > state.zone.radius;
    this.el('zone-banner').classList.toggle('danger', outside);
    this.text('zone-title', outside ? 'BẠN ĐANG NGOÀI VÙNG AN TOÀN' : state.zone.isShrinking ? 'VÒNG BO ĐANG THU HẸP' : 'VÙNG AN TOÀN');
    this.text('zone-description', outside ? 'Di chuyển vào vòng bo để tránh mất máu' : `Vòng ${state.zone.stage + 1} · ${state.zone.isShrinking ? 'Hãy di chuyển vào vùng mới' : 'Chuẩn bị cho vòng bo tiếp theo'}`);
    this.text('zone-time', formatTime(state.zone.timeRemaining));
    this.text('map-stage', `VÒNG ${state.zone.stage + 1}`);
    this.updateCompass(player.yaw);
    this.lastState = state;
    this.lastWorld = world;
    this.text('bigmap-stage', `VÒNG ${state.zone.stage + 1}`);
    if (now - this.lastMapDraw > 90 || phaseChanged) {
      this.lastMapDraw = now;
      this.drawMinimap(state, world);
      if (this.mapOpen) this.drawBigMap(state, world);
    }
  }

  /** Aiming through a scope (any magnification up to `max`) shows the scope; other guns aim over the shoulder with a tighter crosshair. */
  public setAim(aiming: boolean, weapon: WeaponType, optic: { zoom: number; max: number } = { zoom: 1, max: 1 }): void {
    const { zoom, max } = optic;
    const key = `${this.phase}:${weapon}:${aiming}:${zoom}:${max}`;
    if (key === this.aimStateKey) return;
    this.aimStateKey = key;
    const config = WEAPONS[weapon];
    const active = aiming && this.phase === 'playing';
    const scoped = active && max >= SCOPE_FROM;
    this.hide('scope-overlay', !scoped);
    this.hide('crosshair', scoped || this.phase !== 'playing');
    this.el('crosshair').classList.toggle('is-ads', active && !scoped);
    this.el('crosshair').classList.toggle('sniper-hip', !active && max >= SCOPE_FROM);
    this.root.dataset.aim = scoped ? 'scope' : active ? 'ads' : 'hip';
    if (scoped) {
      const label = `${Number.isInteger(zoom) ? zoom : zoom.toFixed(1)}×`;
      this.text('scope-zoom', label);
      // The sights are zeroed at a set distance; beyond it the bullet drops, so aim a little higher.
      this.text('scope-zero', `${ZERO_DISTANCE[config.kind]} m`);
      this.el('scope-zoom-in').toggleAttribute('disabled', zoom >= max - 1e-6);
      this.el('scope-zoom-out').toggleAttribute('disabled', zoom <= 1 + 1e-6);
      this.el('scope-overlay').setAttribute('aria-label', `Ống ngắm ${config.label}, độ phóng đại ${label}`);
    }
  }

  // ---- The shooting range -------------------------------------------------------------------------------------

  private rangeLastText = '';
  private rangeLastUntil = 0;
  private armouryClass = 'all';
  private armouryPicked: WeaponType | null = null;
  private breathKey = '';

  /** What the last shot that hit a target did: damage, how far away it was, and whether it was a headshot. */
  public rangeHit(damage: number, distance: number, head: boolean): void {
    this.rangeLastText = `${head ? 'ĐẦU · ' : ''}−${Math.round(damage)} máu · ${Math.round(distance)} m`;
    this.rangeLastUntil = performance.now() + 6000;
  }

  private updateRangePanel(state: GameState): void {
    const fresh = performance.now() < this.rangeLastUntil;
    this.text('range-last', this.rangeLastText ? this.rangeLastText : 'Chưa bắn trúng bia');
    this.el('range-last').classList.toggle('fresh', fresh);
    this.text('range-stats', state.shots ? `Chính xác ${Math.round(state.hits / state.shots * 100)}% · ${state.hits}/${state.shots} phát · hạ ${state.kills} bia` : 'Chưa bắn phát nào');
    this.text('range-immortal-state', this.settings.immortal ? 'BẬT' : 'TẮT');
    this.el('range-immortal').setAttribute('aria-pressed', String(this.settings.immortal));
    this.el('range-immortal').classList.toggle('on', this.settings.immortal);
  }

  /** Switch immortality on the range (the K key and the button on the panel). */
  public toggleImmortal(): void { this.changeSettings({ immortal: !this.settings.immortal }); this.notify(this.settings.immortal ? 'Bất tử: BẬT' : 'Bất tử: TẮT'); }

  public get armouryOpen(): boolean { return !this.el('range-armoury').hidden; }

  /** The armoury window: every gun in the game, by class, and a click takes one. */
  public toggleArmoury(show?: boolean): void {
    const open = show ?? !this.armouryOpen;
    if (open === this.armouryOpen) return;
    if (open && this.phase !== 'playing') return;
    this.hide('range-armoury', !open);
    if (open) {
      this.armouryPicked = null;
      this.renderArmoury(true);
      (this.el('armoury-search') as HTMLInputElement).focus({ preventScroll: true });
    }
    this.callbacks.onArmouryChange?.(open);
  }

  private renderArmoury(rebuildTabs = false): void {
    const tabs = this.el('armoury-classes');
    if (rebuildTabs || !tabs.children.length) {
      const classes = (Object.keys(GUNS_BY_CLASS) as WeaponClass[]).filter(cls => GUNS_BY_CLASS[cls].length);
      tabs.innerHTML = [`<button type="button" data-class="all">TẤT CẢ <small>${WEAPON_ORDER.length}</small></button>`,
        ...classes.map(cls => `<button type="button" data-class="${cls}">${CLASS_BASE[cls].label.toUpperCase()} <small>${GUNS_BY_CLASS[cls].length}</small></button>`)].join('');
    }
    for (const tab of tabs.querySelectorAll<HTMLButtonElement>('button')) tab.classList.toggle('on', tab.dataset.class === this.armouryClass);
    const query = (this.el('armoury-search') as HTMLInputElement).value.trim().toLowerCase();
    const current = this.armouryPicked ?? this.inventoryPlayer?.weapon;
    const list = WEAPON_ORDER.filter(id => {
      const gun = WEAPONS[id];
      return (this.armouryClass === 'all' || gun.kind === this.armouryClass) && (!query || gun.label.toLowerCase().includes(query) || gun.category.toLowerCase().includes(query) || AMMO_LABEL[gun.ammoType].toLowerCase().includes(query));
    });
    this.el('armoury-grid').innerHTML = list.map(id => {
      const gun = WEAPONS[id];
      return `<button type="button" role="option" class="armoury-gun${id === current ? ' on' : ''}" data-weapon="${id}" data-tier="${gun.tier}" aria-selected="${id === current}" style="--weapon-color:${gun.color}">${weaponHudIcon(id)}<b>${gun.label}</b><small>${gun.category} · ${AMMO_LABEL[gun.ammoType]}</small></button>`;
    }).join('') || '<p class="armoury-empty">Không có khẩu nào khớp.</p>';
  }

  /** The held-breath meter in the scope: how much is left, and whether it is being held or has run out. */
  public setBreath(fraction: number, holding: boolean, winded: boolean): void {
    const percent = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
    const key = `${percent}:${holding}:${winded}`;
    if (key === this.breathKey) return;
    this.breathKey = key;
    const meter = this.el('scope-breath');
    meter.classList.toggle('holding', holding);
    meter.classList.toggle('winded', winded);
    meter.classList.toggle('low', !winded && fraction < 0.9);
    this.el('scope-breath-fill').style.transform = `scaleX(${percent / 100})`;
    this.text('scope-breath-label', winded ? 'HẾT HƠI · ĐỢI LẤY LẠI' : holding ? 'ĐANG NÍN THỞ' : this.touchMode ? 'GIỮ NÚT NÍN THỞ' : 'NÍN THỞ · GIỮ SHIFT');
  }

  private updateCompass(yaw: number): void {
    const degrees = ((yaw * 180 / Math.PI) % 360 + 360) % 360;
    this.text('compass-degrees', `${Math.round(degrees).toString().padStart(3, '0')}°`);
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const middle = Math.round(degrees / 15) * 15;
    const compass = this.el('compass-labels');
    if (!compass.children.length) compass.innerHTML = Array.from({ length: 9 }, () => '<span></span>').join('');
    for (let i = 0; i < 9; i++) {
      const unwrapped = middle + (i - 4) * 15;
      const angle = ((unwrapped % 360) + 360) % 360;
      const label = angle % 45 === 0 ? directions[angle / 45] : `${angle}`;
      const element = compass.children[i] as HTMLElement;
      if (element.textContent !== label) element.textContent = label;
      element.style.left = `${50 + (unwrapped - degrees) * 0.68}%`;
      element.classList.toggle('cardinal', angle % 45 === 0);
    }
  }

  private loadoutKey = '';
  private armorKey = '';
  private killLines: Array<{ element: HTMLElement; until: number }> = [];
  private damageUntil = 0;

  /** Only the guns actually carried are shown: slots 1 and 2 hold main guns, slot 3 the sidearm. */
  private renderLoadout(owned: readonly WeaponType[], current: WeaponType, ammo: Record<WeaponType, number>, reserve: Record<AmmoType, number>): void {
    const slots = slotOrder(owned);
    const key = slots.join(',');
    const container = this.el('weapon-inventory');
    if (key !== this.loadoutKey) {
      this.loadoutKey = key;
      container.innerHTML = slots.map((weapon, index) => {
        const config = WEAPONS[weapon];
        const slotNumber = isSidearm(weapon) ? 3 : index + 1;
        return `<button type="button" class="weapon-slot" data-weapon="${weapon}" aria-label="Ô ${slotNumber}: ${config.label}, ${config.category}" data-tier="${config.tier}" style="--weapon-color:${config.color}"><kbd>${slotNumber}</kbd>${weaponHudIcon(weapon)}<span class="slot-name">${config.label}<small>${config.category}</small></span><i data-ammo="${weapon}"></i></button>`;
      }).join('');
      this.hide('touch-inventory-toggle', slots.length < 2);
    }
    for (const card of container.querySelectorAll<HTMLButtonElement>('button[data-weapon]')) {
      const weapon = card.dataset.weapon as WeaponType;
      card.classList.toggle('active', weapon === current);
      card.setAttribute('aria-pressed', `${weapon === current}`);
      const label = card.querySelector('i');
      const text = `${ammo[weapon]} / ${reserve[WEAPONS[weapon].ammoType]}`;
      if (label && label.textContent !== text) label.textContent = text;
    }
  }

  /** Helmet and vest are listed only while worn, each with its tier and remaining durability. */
  private renderArmor(player: { helmet: number; vest: number; helmetHp: number; vestHp: number }): void {
    const slots: ArmorSlot[] = ['helmet', 'vest'];
    const key = slots.map(slot => `${player[slot]}:${Math.ceil(player[`${slot}Hp` as const] / 5)}`).join('|');
    if (key === this.armorKey) return;
    this.armorKey = key;
    const icons: Record<ArmorSlot, string> = { helmet: '<path d="M4 15a8 8 0 0 1 16 0v2H4zM4 17h16M12 7v3"/>', vest: '<path d="M8 4 4 7v13h16V7l-4-3-2 2h-4zM12 6v14"/>' };
    this.el('armor-row').innerHTML = slots.filter(slot => player[slot] > 0).map(slot => {
      const level = player[slot], hp = player[`${slot}Hp` as const];
      const percent = Math.max(0, Math.min(100, hp / ARMOR_DURABILITY[level] * 100));
      return `<div class="armor-chip tier-${level}" title="${ARMOR_NAMES[slot]} cấp ${level}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[slot]}</svg><b>${level}</b><span><i style="width:${percent}%"></i></span></div>`;
    }).join('');
  }

  /** Kill feed: newest line first, each fading after a few seconds. */
  public pushKill(killer: string, victim: string, weapon: string, involvesPlayer: boolean): void {
    const line = document.createElement('div');
    line.className = involvesPlayer ? 'kill-line mine' : 'kill-line';
    line.innerHTML = `<b></b><em>${weapon}</em><span></span>`;
    (line.querySelector('b') as HTMLElement).textContent = killer;
    (line.querySelector('span') as HTMLElement).textContent = victim;
    const feed = this.el('kill-feed');
    feed.prepend(line);
    this.killLines.unshift({ element: line, until: performance.now() + 5500 });
    while (this.killLines.length > 5) this.killLines.pop()?.element.remove();
  }

  private expireKillFeed(now: number): void {
    while (this.killLines.length && this.killLines[this.killLines.length - 1].until < now) this.killLines.pop()?.element.remove();
  }

  /** Red wedge around the crosshair pointing at whoever hit you; `angle` is relative to where you are facing. */
  public showDamageFrom(angle: number): void {
    const indicator = this.el('damage-dir');
    indicator.style.transform = `translate(-50%, -50%) rotate(${angle}rad)`;
    indicator.classList.remove('flash');
    void indicator.offsetWidth;
    indicator.classList.add('flash');
    this.damageUntil = performance.now() + 900;
  }

  private soundSlot = 0;
  /** A pale wedge pointing at a gunshot: `angle` is relative to where you face, `strength` (0..1) is how loud it was. */
  public showSoundFrom(angle: number, strength: number): void {
    const indicator = this.el(`sound-dir-${this.soundSlot}`);
    this.soundSlot = (this.soundSlot + 1) % 4;
    indicator.style.transform = `translate(-50%, -50%) rotate(${angle}rad)`;
    indicator.style.setProperty('--loud', `${Math.max(0.25, Math.min(1, strength)).toFixed(2)}`);
    indicator.classList.remove('flash');
    void (indicator as HTMLElement).offsetWidth;
    indicator.classList.add('flash');
  }

  /** Speedometer and car condition while driving; pass null on foot. */
  public setVehicle(info: { speed: number; health: number } | null): void {
    this.hide('vehicle-hud', !info);
    this.root.dataset.driving = info ? 'true' : 'false';
    if (!info) return;
    this.text('vehicle-speed', `${Math.round(Math.abs(info.speed) * 3.6)}`);
    const bar = this.el('vehicle-health-bar');
    bar.style.transform = `scaleX(${Math.max(0, Math.min(1, info.health))})`;
    bar.classList.toggle('low', info.health < 0.3);
  }

  /** Show or hide the "watch the kill again" button on the results screen. */
  public setReplayAvailable(available: boolean): void { this.hide('replay-button', !available || this.multiplayer); }

  /** While the kill replay plays the results are hidden behind a small banner; `detail` names the killer and gun. */
  public setReplay(active: boolean, detail = ''): void {
    this.hide('replay-bar', !active);
    this.hide('result-screen', active || this.phase === 'playing' || this.phase === 'paused' || this.phase === 'menu');
    if (active) this.text('replay-detail', detail);
  }

  private multiplayer = false;
  /** In an online match the pause menu cannot pause the world and there is no restart or replay. */
  public setMultiplayer(on: boolean): void {
    this.multiplayer = on;
    this.hide('pause-restart', on);
    this.text('restart-button-label', on ? 'VỀ MÀN HÌNH CHÍNH' : 'VÀO TRẬN MỚI');
    this.root.dataset.multiplayer = on ? 'on' : 'off';
  }

  /** The in-game menu of an online match: it opens over the running game. */
  public setMpMenu(open: boolean): void {
    if (open) this.toggleInventory(false);
    this.hide('pause-screen', !open);
    if (open) this.el('resume-button').focus({ preventScroll: true });
  }

  /** Banner while watching the match after dying; null otherwise. */
  public setSpectate(name: string | null, touch = this.touchMode): void {
    this.hide('spectate-bar', name === null);
    if (this.root.dataset.spectate !== (name === null ? undefined : 'on')) {
      if (name === null) delete this.root.dataset.spectate; else this.root.dataset.spectate = 'on';
    }
    if (name === null) return;
    this.text('spectate-name', `ĐANG XEM · ${name.toUpperCase()}`);
    this.text('spectate-help', touch ? 'Nút Đổi súng: đổi người xem' : 'Q / E hoặc cuộn chuột: đổi người xem');
  }

  /** Line under the gyroscope setting that says whether the sensor works. */
  public setGyroStatus(text: string): void { this.text('gyro-status', text); }
  /** The line under the soldier's name on the main screen: what they are carrying. */
  public setSpotGear(text: string): void { this.text('spot-gear', text); }

  /** Flight readout while in the plane, in free fall or under the canopy; null once on the ground. */
  public setAir(info: { mode: AirMode; altitude: number; speed: number; seconds: number; flag?: { distance: number; reachable: boolean; auto: boolean } | null } | null): void {
    this.hide('air-hud', !info);
    this.hide('air-flag', !info?.flag);
    // Speed lines rush outward from the centre of the screen while falling fast.
    this.hide('air-streaks', info?.mode !== 'freefall');
    if (info?.mode === 'freefall') this.el('air-streaks').style.setProperty('--fall', `${Math.max(0, Math.min(1, (info.speed - 35) / 45)).toFixed(2)}`);
    const mode = info?.mode ?? '';
    // The attribute must disappear on the ground: an empty `data-air` would still match the CSS that hides the gun HUD.
    if ((this.root.dataset.air ?? '') !== mode) {
      if (mode) { this.root.dataset.air = mode; document.documentElement.dataset.air = mode; }
      else { delete this.root.dataset.air; delete document.documentElement.dataset.air; }
    }
    if (!info) return;
    const touch = this.touchMode;
    const stage = { plane: 'TRÊN MÁY BAY', freefall: 'RƠI TỰ DO', chute: 'DÙ ĐÃ MỞ' }[info.mode];
    const label = { plane: 'GIÂY TRÊN ĐẢO', freefall: 'GIÂY TỚI KHI DÙ TỰ MỞ', chute: 'GIÂY TỚI ĐẤT' }[info.mode];
    const prompt = {
      plane: touch ? 'CHẠM NÚT NHẢY ĐỂ NHẢY DÙ · CHỌN ĐIỂM ĐÁP TRÊN BẢN ĐỒ' : '[SPACE] NHẢY DÙ · [M] BẢN ĐỒ · NHÌN XUỐNG ĐỂ CHỌN ĐIỂM ĐÁP',
      freefall: touch ? 'NÚT NHẢY: MỞ DÙ · ĐẨY CẦN HẾT CỠ: LAO NHANH' : '[SPACE] MỞ DÙ · [SHIFT] LAO NHANH · W A S D LÁI',
      chute: touch ? 'ĐẨY CẦN HẾT CỠ: BAY NHANH HƠN' : '[SHIFT] BAY NHANH HƠN · W A S D LÁI',
    }[info.mode];
    this.text('air-stage', stage);
    this.text('air-alt', `${Math.max(0, Math.round(info.altitude))}`);
    this.text('air-speed', `${Math.round(info.speed * 3.6)}`);
    this.text('air-left', `${Math.max(0, Math.round(info.seconds))}`);
    this.text('air-left-label', label);
    this.text('air-prompt', prompt);
    if (info.flag) {
      const km = info.flag.distance >= 1000 ? `${(info.flag.distance / 1000).toFixed(1)} KM` : `${Math.round(info.flag.distance)} M`;
      this.text('air-flag', `CỜ ĐÁP · ${km} · ${info.flag.reachable ? 'TỚI ĐƯỢC' : 'NGOÀI TẦM LƯỢN'}${info.flag.auto ? ' · TỰ LÁI BẬT' : touch ? '' : ' · [G] TỰ LÁI'}`);
      this.el('air-flag').classList.toggle('out', !info.flag.reachable);
    }
  }

  public toggleMap(show?: boolean): void {
    const open = show ?? this.el('map-screen').hidden;
    if (open && this.phase !== 'playing') return;
    if (open) this.closeWeaponPicker();
    this.hide('map-screen', !open);
    if (open) this.toggleInventory(false);
    this.callbacks.onTouchOverlayChange?.(this.touchOverlayOpen);
    this.root.querySelector('.minimap-panel')?.setAttribute('aria-expanded', String(open));
    if (open && this.lastState) this.drawBigMap(this.lastState, this.lastWorld!);
  }
  public get mapOpen(): boolean { return !this.el('map-screen').hidden; }

  private lastState: GameState | null = null;
  private lastWorld: WorldConfig | null = null;

  /** The menu's preview of the chosen battleground. */
  /** The range at a glance: five lanes with their targets, the firing line, and the bots' yard. */
  private drawRangePreview(ctx: CanvasRenderingContext2D, size: number): void {
    const world = createRangeWorld(), layout = world.range!, pad = 9, scale = (size - pad * 2) / (world.halfSize * 2);
    const mapX = (x: number) => size / 2 + x * scale, mapY = (z: number) => size / 2 - z * scale;
    ctx.fillStyle = '#26382b'; ctx.fillRect(0, 0, size, size);
    const longest = Math.max(...layout.distances);
    ctx.fillStyle = '#7f8579';
    for (const x of layout.laneX) ctx.fillRect(mapX(x - 10), mapY(layout.firingZ + longest + 8), 20 * scale, (longest + 8) * scale);
    ctx.fillStyle = '#e2b53c'; ctx.fillRect(mapX(-110), mapY(layout.firingZ) - 1.5, 220 * scale, 3);
    for (const o of world.obstacles) {
      ctx.fillStyle = o.kind === 'building' ? '#8c978d' : o.kind === 'rock' ? '#4b5f52' : '#a58f68';
      ctx.fillRect(mapX(o.x - o.width / 2), mapY(o.z + o.depth / 2), Math.max(1.5, o.width * scale), Math.max(1.5, o.depth * scale));
    }
    ctx.fillStyle = '#f0a04a';
    for (const d of layout.dummies) ctx.fillRect(mapX(d.x) - 1.6, mapY(d.z) - 1.6, 3.2, 3.2);
    ctx.fillStyle = '#d65a4a';
    for (const spot of layout.botSpawns) { ctx.beginPath(); ctx.arc(mapX(spot.x), mapY(spot.z), 3, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#e8f0e0'; ctx.beginPath(); ctx.arc(mapX(layout.playerSpawn.x), mapY(layout.playerSpawn.z), 4, 0, Math.PI * 2); ctx.fill();
  }

  private drawMenuMap(): void {
    const canvas = this.el('menu-map') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const data = mapData(this.settings.map);
    if (data) { ctx.drawImage(this.islandBackdrop(canvas.width, data.world, data.terrain), 0, 0); return; }
    if (this.settings.map === 'range') { this.drawRangePreview(ctx, canvas.width); return; }
    ctx.fillStyle = '#1a2a24'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#ffffff14';
    for (let i = 1; i < 8; i++) { ctx.beginPath(); ctx.moveTo(i * canvas.width / 8, 0); ctx.lineTo(i * canvas.width / 8, canvas.height); ctx.moveTo(0, i * canvas.height / 8); ctx.lineTo(canvas.width, i * canvas.height / 8); ctx.stroke(); }
    ctx.fillStyle = '#6b7a6a';
    for (const [x, y, w, h] of [[60, 70, 70, 50], [190, 60, 60, 60], [40, 150, 65, 80], [200, 160, 72, 52], [120, 230, 76, 52]]) ctx.fillRect(x, y, w, h);
  }

  private islandMaps = new Map<string, HTMLCanvasElement>();

  /** Shaded relief, roads and towns of the island, rendered once and reused for every minimap frame. */
  private islandBackdrop(size: number, world: Pick<WorldConfig, 'id' | 'halfSize' | 'roads' | 'towns' | 'water' | 'theme' | 'hotAreas'>, terrain: (x: number, z: number) => number): HTMLCanvasElement {
    const cacheKey = `${world.id}:${size}`;
    const cached = this.islandMaps.get(cacheKey);
    if (cached) return cached;
    const sea = world.water?.seaLevel ?? 0;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const pad = 9, span = size - pad * 2, cell = world.halfSize * 2 / span;
    ctx.fillStyle = '#182723'; ctx.fillRect(0, 0, size, size);
    const image = ctx.createImageData(span, span);
    for (let py = 0; py < span; py++) {
      for (let px = 0; px < span; px++) {
        const x = -world.halfSize + (px + 0.5) * cell, z = world.halfSize - (py + 0.5) * cell;
        const h = terrain(x, z);
        const light = (terrain(x - cell, z + cell) - terrain(x + cell, z - cell)) / (cell * 2);
        const shade = Math.max(0.55, Math.min(1.3, 1 + light * 1.4));
        const t = Math.max(0, Math.min(1, (h - 20) / 110));
        const i = (py * span + px) * 4;
        if (h < sea + 0.3) {
          // Open sea: deeper water reads darker.
          const depth = Math.max(0, Math.min(1, (sea - h) / 7));
          image.data[i] = 44 - depth * 16; image.data[i + 1] = 108 - depth * 30; image.data[i + 2] = 142 - depth * 30;
        } else if (h < sea + 3.4) {
          image.data[i] = 196 * shade; image.data[i + 1] = 180 * shade; image.data[i + 2] = 130 * shade;
        } else {
          const sand = world.theme?.sand ?? 0, tint = world.theme?.tint ?? [1, 1, 1];
          const r = (70 + t * 90) * (1 - sand) + (190 + t * 30) * sand, g = (98 + t * 55) * (1 - sand) + (160 + t * 30) * sand, b = (68 + t * 70) * (1 - sand) + (110 + t * 30) * sand;
          image.data[i] = r * tint[0] * shade; image.data[i + 1] = g * tint[1] * shade; image.data[i + 2] = b * tint[2] * shade;
        }
        image.data[i + 3] = 255;
      }
    }
    ctx.putImageData(image, pad, pad);
    const toX = (x: number) => pad + (x + world.halfSize) / cell, toY = (z: number) => pad + (world.halfSize - z) / cell;
    // Lakes and rivers on top of the relief.
    ctx.fillStyle = '#2c6a8c';
    for (const lake of world.water?.lakes ?? []) { ctx.beginPath(); ctx.arc(toX(lake.x), toY(lake.z), Math.max(1.5, lake.r / cell), 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = '#3d86ad'; ctx.lineWidth = Math.max(1, size / 260);
    for (const river of world.water?.rivers ?? []) { ctx.beginPath(); river.points.forEach((p, i) => (i ? ctx.lineTo(toX(p.x), toY(p.z)) : ctx.moveTo(toX(p.x), toY(p.z)))); ctx.stroke(); }
    ctx.strokeStyle = '#d8d2b0aa'; ctx.lineWidth = 1;
    for (const road of world.roads) { ctx.beginPath(); ctx.moveTo(toX(road.a.x), toY(road.a.z)); ctx.lineTo(toX(road.b.x), toY(road.b.z)); ctx.stroke(); }
    for (const town of world.towns) {
      const r = town.tier === 'city' ? 4 : town.tier === 'town' ? 3 : 2;
      ctx.fillStyle = '#f1e8c8'; ctx.strokeStyle = '#151b17'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.rect(toX(town.x) - r, toY(town.z) - r, r * 2, r * 2); ctx.fill(); ctx.stroke();
    }
    // Hot areas: a red square over the compound, the best loot on the map.
    ctx.strokeStyle = '#ff5a4a'; ctx.fillStyle = '#ff5a4a22'; ctx.lineWidth = 1.5;
    for (const hot of world.hotAreas ?? []) {
      const r = hot.radius * 0.8 / cell;
      ctx.beginPath(); ctx.rect(toX(hot.x) - r, toY(hot.z) - r * 0.8, r * 2, r * 1.6); ctx.fill(); ctx.stroke();
    }
    this.islandMaps.set(cacheKey, canvas);
    return canvas;
  }

  private drawBigMap(state: GameState, world: WorldConfig): void { this.drawMinimap(state, world, 'bigmap', true); }

  private drawMinimap(state: GameState, world: WorldConfig, canvasId = 'minimap', big = false): void {
    const canvas = this.el(canvasId) as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const size = canvas.width;
    const padding = 9;
    const scale = (size - padding * 2) / (world.halfSize * 2);
    const mapX = (x: number) => size / 2 + x * scale;
    const mapY = (z: number) => size / 2 - z * scale;
    ctx.clearRect(0, 0, size, size);
    if (world.id !== 'arena' && world.terrain) ctx.drawImage(this.islandBackdrop(size, world, world.terrain), 0, 0);
    else {
    ctx.fillStyle = '#182723'; ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = '#ffffff09'; ctx.lineWidth = 1;
    for (let i = 0; i <= 6; i++) {
      const point = padding + i * (size - padding * 2) / 6;
      ctx.beginPath(); ctx.moveTo(point, padding); ctx.lineTo(point, size - padding); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(padding, point); ctx.lineTo(size - padding, point); ctx.stroke();
    }
    for (const obstacle of world.obstacles) {
      ctx.fillStyle = obstacle.kind === 'building' ? '#58645c' : obstacle.kind === 'rock' ? '#374c42' : '#93815d';
      ctx.fillRect(mapX(obstacle.x - obstacle.width / 2), mapY(obstacle.z + obstacle.depth / 2), obstacle.width * scale, obstacle.depth * scale);
    }
    }
    if (world.range) {
      // Lanes and the firing line; the targets that are standing show as small orange marks.
      ctx.fillStyle = '#ffffff12';
      for (const x of world.range.laneX) ctx.fillRect(mapX(x - 10), mapY(world.range.firingZ + Math.max(...world.range.distances) + 8), 20 * scale, (Math.max(...world.range.distances) + 8) * scale);
      ctx.fillStyle = '#e2b53c'; ctx.fillRect(mapX(-110), mapY(world.range.firingZ) - 1, 220 * scale, 2);
      ctx.fillStyle = '#f0a04a';
      for (const actor of state.actors) if (actor.dummy && actor.alive) ctx.fillRect(mapX(actor.position.x) - 1.2, mapY(actor.position.z) - 1.2, 2.4, 2.4);
    }
    // Tint terrain outside the safe circle. Enemy positions are deliberately omitted.
    ctx.fillStyle = '#4898ce25';
    ctx.beginPath(); ctx.rect(0, 0, size, size);
    ctx.moveTo(mapX(state.zone.center.x) + state.zone.radius * scale, mapY(state.zone.center.z));
    ctx.arc(mapX(state.zone.center.x), mapY(state.zone.center.z), state.zone.radius * scale, 0, Math.PI * 2);
    if (world.id !== 'range') ctx.fill('evenodd');
    ctx.strokeStyle = '#b7dbc3'; ctx.lineWidth = 1.5;
    if (world.id !== 'range') {
      ctx.beginPath(); ctx.arc(mapX(state.zone.center.x), mapY(state.zone.center.z), state.zone.radius * scale, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#eef0d88a'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.arc(mapX(state.zone.nextCenter.x), mapY(state.zone.nextCenter.z), state.zone.nextRadius * scale, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (big && world.id !== 'arena') {
      ctx.font = '600 15px "Segoe UI", Arial, sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = '#0b100dcc'; ctx.fillStyle = '#f4efd8';
      for (const town of world.towns) { const x = mapX(town.x), y = mapY(town.z) - (town.tier === 'city' ? 12 : 9); ctx.strokeText(town.name, x, y); ctx.fillText(town.name, x, y); }
      ctx.fillStyle = '#ff8a7a';
      for (const hot of world.hotAreas ?? []) { const x = mapX(hot.x), y = mapY(hot.z); ctx.strokeText(hot.name, x, y); ctx.fillText(hot.name, x, y); }
      ctx.fillStyle = '#f4efd8';
    }
    const player = state.actors.find(actor => actor.id === state.localId) ?? state.actors.find(actor => actor.isPlayer);
    const plane = state.plane;
    if (plane?.active) {
      // The plane's route, so the jump point can be chosen against the towns on the map.
      ctx.strokeStyle = '#8fd4ff'; ctx.lineWidth = big ? 2 : 1.4; ctx.setLineDash([7, 5]);
      ctx.beginPath(); ctx.moveTo(mapX(plane.from.x), mapY(plane.from.z)); ctx.lineTo(mapX(plane.to.x), mapY(plane.to.z)); ctx.stroke();
      ctx.setLineDash([]);
      ctx.save(); ctx.translate(mapX(plane.x), mapY(plane.z)); ctx.rotate(plane.yaw); ctx.scale(big ? 1.6 : 1, big ? 1.6 : 1);
      ctx.fillStyle = '#e8f6ff'; ctx.strokeStyle = '#15303f'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(1.6, -2); ctx.lineTo(8, 2); ctx.lineTo(8, 4); ctx.lineTo(1.6, 2.6); ctx.lineTo(1.2, 6); ctx.lineTo(3.4, 7.5); ctx.lineTo(3.4, 8.5); ctx.lineTo(0, 7.6); ctx.lineTo(-3.4, 8.5); ctx.lineTo(-3.4, 7.5); ctx.lineTo(-1.2, 6); ctx.lineTo(-1.6, 2.6); ctx.lineTo(-8, 4); ctx.lineTo(-8, 2); ctx.lineTo(-1.6, -2); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    }
    if (player?.air) {
      // How far this jumper could still glide from where they are: land inside the ring.
      const ground = world.terrain ? world.terrain(player.position.x, player.position.z) : 0;
      const radius = remainingGlide(player.air.mode, player.position.y - ground) * scale;
      ctx.strokeStyle = '#8fd4ffcc'; ctx.fillStyle = '#8fd4ff18'; ctx.lineWidth = big ? 2 : 1.2; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.arc(mapX(player.position.x), mapY(player.position.z), radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
    }
    for (const drop of state.airdrops ?? []) {
      if (drop.empty) continue;
      const cx = mapX(drop.x), cy = mapY(drop.z), k = big ? 1.5 : 1;
      const pulse = drop.landed ? 1 : 0.6 + 0.4 * Math.sin(performance.now() / 180);
      ctx.save(); ctx.translate(cx, cy); ctx.scale(k * pulse, k * pulse);
      ctx.fillStyle = drop.landed ? '#e0453a' : '#ffffff'; ctx.strokeStyle = '#1a0805'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.rect(-4.5, -4.5, 9, 9); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-4.5, -4.5); ctx.lineTo(4.5, 4.5); ctx.moveTo(4.5, -4.5); ctx.lineTo(-4.5, 4.5); ctx.stroke();
      ctx.restore();
    }
    if (this.flag) {
      const fx = mapX(this.flag.x), fy = mapY(this.flag.z), k = big ? 1.5 : 1;
      if (player?.air) {
        ctx.strokeStyle = '#ffd24acc'; ctx.lineWidth = big ? 2 : 1.2; ctx.setLineDash([2, 4]);
        ctx.beginPath(); ctx.moveTo(mapX(player.position.x), mapY(player.position.z)); ctx.lineTo(fx, fy); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.save(); ctx.translate(fx, fy); ctx.scale(k, k);
      ctx.strokeStyle = '#1a1405'; ctx.fillStyle = '#ffd24a'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -12); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(8, -9); ctx.lineTo(0, -6); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    if (player && !(plane?.active && player.air?.mode === 'plane')) {
      const k = big ? 1.9 : 1;
      ctx.save(); ctx.translate(mapX(player.position.x), mapY(player.position.z)); ctx.rotate(player.yaw); ctx.scale(k, k);
      ctx.fillStyle = '#ffc233'; ctx.strokeStyle = '#151b17'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 5); ctx.lineTo(0, 3); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    }
    ctx.strokeStyle = '#ffffff20'; ctx.lineWidth = 1; ctx.strokeRect(padding, padding, size - padding * 2, size - padding * 2);
  }

  private showResults(state: GameState): void {
    const won = state.phase === 'won';
    this.el('result-screen').classList.toggle('victory', won);
    this.text('result-rank', won ? '#1' : `#${Math.max(2, state.playerRank ?? state.actors.filter(actor => actor.alive).length + 1)}`);
    // The place the player died in; the option to keep watching disappears once they already did.
    this.hide('spectate-button', this.multiplayer || won || !!state.spectating || state.actors.filter(actor => actor.alive).length < 2);
    this.hide('replay-button', this.multiplayer);
    const winner = state.winnerId ? state.actors.find(actor => actor.id === state.winnerId) : undefined;
    this.text('result-title', won ? 'NGƯỜI SỐNG CUỐI.' : this.multiplayer && winner ? `${winner.name.toUpperCase()} CHIẾN THẮNG.` : 'HẸN Ở TRẬN SAU.');
    this.text('result-copy', won ? 'Bạn đã giữ vững vị trí cho đến giây cuối cùng.' : this.multiplayer && winner ? `Hạng của bạn: #${state.playerRank ?? '?'}. Chúc mừng ${winner.name}!` : 'Mỗi lần trở lại, bạn sẽ hiểu chiến trường hơn.');
    this.text('result-kills', `${state.kills}`);
    const survived = state.diedAt ?? state.elapsed;
    this.text('result-time', formatTime(survived));
    this.text('result-accuracy', `${state.shots > 0 ? Math.min(100, Math.round(state.hits / state.shots * 100)) : 0}%`);
    if (!this.resultSaved) {
      this.resultSaved = true;
      this.best = { wins: this.best.wins + (won ? 1 : 0), kills: Math.max(this.best.kills, state.kills), survival: Math.max(this.best.survival, survived), killsTotal: this.best.killsTotal + state.kills };
      saveJson(BEST_KEY, this.best);
      this.updateBest();
    }
  }

  public notify(message: string, duration = 3200): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.text('toast', message);
    this.hide('toast', false);
    this.toastTimer = setTimeout(() => this.hide('toast', true), duration);
  }

  private seenTips: Set<string> | null = null;
  /** A hint shown once ever (remembered in the browser) unless hints are switched off in the settings. */
  public tip(id: string, message: string): void {
    if (!this.settings.tips) return;
    this.seenTips ??= new Set((readJson(TIPS_KEY) as string[] | null) ?? []);
    if (this.seenTips.has(id)) return;
    this.seenTips.add(id);
    saveJson(TIPS_KEY, [...this.seenTips]);
    this.notify(`GỢI Ý · ${message}`, 6000);
  }

  private crosshairGap = -1;
  /** The crosshair opens with the bullet spread: `gap` is how far the four ticks sit from the centre, in pixels. */
  public setCrosshair(gap: number): void {
    const value = Math.round(Math.max(0, Math.min(60, gap)) * 2) / 2;
    if (value === this.crosshairGap) return;
    this.crosshairGap = value;
    this.el('crosshair').style.setProperty('--gap', `${value}px`);
  }

  /** Small label while crouching or lying down. */
  public setStance(stance: 'stand' | 'crouch' | 'prone'): void {
    this.hide('stance-badge', stance === 'stand');
    if (stance !== 'stand') this.text('stance-badge', stance === 'crouch' ? 'ĐANG NGỒI' : 'ĐANG NẰM');
  }

  /** The frame-rate readout (null hides it). */
  public setPerf(text: string | null): void {
    this.hide('perf-meter', text === null);
    if (text !== null) this.text('perf-meter', text);
  }
  public showError(message: string): void {
    this.text('error-banner', message);
    this.hide('error-banner', false);
    this.setLoading(null);
  }
  public setLoading(message: string | null): void {
    this.hide('loading-screen', message === null);
    if (message !== null) this.text('loading-text', message);
  }
}
