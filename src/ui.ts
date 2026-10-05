import type { AirMode, GyroMode, AmmoType, ArmorSlot, GameSettings, GameState, MapId, Vec2, WeaponType, WorldConfig } from './types';
import { mapData } from './game/world';
import { remainingGlide } from './game/drop';
import { ZERO_DISTANCE } from './game/ballistics';
import { ARMOR_DURABILITY, ARMOR_NAMES, isSidearm, slotOrder, WEAPONS } from './game/weapons';
import { weaponHudIcon } from './hud-icons';

type Callbacks = {
  onStart: (settings: GameSettings) => void;
  onResume: () => void;
  onRestart: () => void;
  onMenu: () => void;
  onSettings: (settings: GameSettings) => void;
  /** Keep watching the match after dying, and stop watching. */
  onSpectate?: () => void;
  onSpectateExit?: () => void;
  /** Watch the last seconds before dying again, and stop watching. */
  onReplay?: () => void;
  onReplayStop?: () => void;
  onSelectWeapon?: (weapon: WeaponType) => void;
  onTouchOverlayChange?: (open: boolean) => void;
};
type BestRecord = { wins: number; kills: number; survival: number };
const DEFAULT_SETTINGS: GameSettings = { difficulty: 'normal', botCount: 100, map: 'island', volume: 0.6, quality: 'high', sensitivity: 1, gyro: 'off', gyroSensitivity: 1, gyroInvertY: false, tips: true, showFps: false, aimAssist: 'off', recoilScale: 1, soundIndicator: false };
const BOT_CHOICES: Record<MapId, number[]> = { island: [25, 50, 100], valley: [15, 30, 50], arena: [5, 7] };
const defaultBots = (map: MapId): number => map === 'island' ? 100 : map === 'valley' ? 30 : 5;
const MAP_INFO: Record<MapId, { title: string; blurb: string; size: string; time: string }> = {
  island: { title: 'ĐẢO LASTLIGHT', blurb: 'Sông, hồ, thị trấn và rừng. Lục nhà tìm súng, giáp; lái xe vượt đảo trước khi bo khép lại.', size: '4 × 4 KM', time: '≈ 10 PHÚT' },
  valley: { title: 'ĐẤU TRƯỜNG THUNG LŨNG', blurb: 'Một thung lũng khép kín, đông bot, bo thu nhanh. Giao tranh liên tục từ giây đầu tiên.', size: '1 × 1 KM', time: '≈ 6 PHÚT' },
  arena: { title: 'SÂN TẬP', blurb: 'Bản đồ nhỏ có sẵn đủ 8 loại súng quanh điểm xuất phát. Hợp để thử súng và luyện ngắm.', size: '200 M', time: '≈ 7 PHÚT' },
};
const readMap = (value: unknown): MapId => value === 'arena' ? 'arena' : value === 'valley' ? 'valley' : 'island';
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
function readSettings(): GameSettings {
  const touch = document.documentElement.dataset.input === 'touch';
  const defaults: GameSettings = { ...DEFAULT_SETTINGS, quality: touch ? 'low' : 'high', gyro: touch ? 'aim' : 'off', aimAssist: touch ? 'low' : 'off', recoilScale: touch ? 0.75 : 1, soundIndicator: touch };
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
  };
}
function readBest(): BestRecord {
  const value = readJson(BEST_KEY);
  const raw = value && typeof value === 'object' ? value as Partial<BestRecord> : {};
  return { wins: Math.floor(clamp(raw.wins, 0, 999999, 0)), kills: Math.floor(clamp(raw.kills, 0, 999999, 0)), survival: clamp(raw.survival, 0, 999999, 0) };
}
function formatTime(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60).toString().padStart(2, '0')}:${(value % 60).toString().padStart(2, '0')}`;
}

export class GameUI {
  public settings = readSettings();
  private callbacks: Callbacks;
  private root: HTMLElement;
  private elements = new Map<string, HTMLElement>();
  private texts = new Map<string, string>();
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
      <section id="menu-screen" class="menu-screen lobby">
        <header class="lobby-top">
          <a class="wordmark" href="#" aria-label="LASTLIGHT, màn hình chính"><span class="brand-symbol">L<span></span></span><span>LASTLIGHT<small>VÙNG SỐNG CUỐI CÙNG</small></span></a>
          <nav class="lobby-nav" aria-label="Màn hình chính"><button id="tab-play" class="tab active" type="button">CHIẾN ĐẤU</button><button id="tab-settings" class="tab" type="button">THIẾT LẬP</button></nav>
          <div class="profile-chip" aria-label="Thành tích của bạn">
            <div class="profile-id"><i>${icon('shield')}</i><span><b>NGƯỜI SINH TỒN</b><small>CHƠI NGAY · KHÔNG CẦN TÀI KHOẢN</small></span></div>
            <dl><div><dt>THẮNG</dt><dd id="best-wins">0</dd></div><div><dt>HẠ GỤC</dt><dd id="best-kills">0</dd></div><div><dt>SỐNG LÂU NHẤT</dt><dd id="best-time">00:00</dd></div></dl>
          </div>
        </header>
        <div class="lobby-stage">
          <div class="lobby-spot" aria-hidden="true"><span class="spot-tag">SẴN SÀNG</span><span class="spot-name">BẠN</span></div>
          <aside class="lobby-panel">
            <div id="play-panel" class="panel-play">
              <div class="panel-title"><span>CHỌN CHIẾN TRƯỜNG</span><em>ĐƠN · ĐẤU BOT</em></div>
              <div id="map-choice" class="map-tabs" role="radiogroup" aria-label="Bản đồ">
                <button type="button" role="radio" data-value="island"><b>ĐẢO</b><small>4 × 4 km</small></button>
                <button type="button" role="radio" data-value="valley"><b>ĐẤU TRƯỜNG</b><small>1 × 1 km</small></button>
                <button type="button" role="radio" data-value="arena"><b>SÂN TẬP</b><small>200 m</small></button>
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
              </div>
              <button id="start-button" class="start-button" type="button"><span class="start-label">${icon('target')}<span><b>BẮT ĐẦU TRẬN</b><small id="start-sub">100 đối thủ · ≈ 10 phút</small></span></span>${icon('arrow')}</button>
            </div>
            <div id="settings-panel" class="settings-panel" hidden>
              <div class="panel-title"><span>CHUẨN BỊ TRƯỚC KHI VÀO TRẬN</span><em>THIẾT LẬP</em></div>
              <p class="settings-copy">Điều chỉnh để chơi thoải mái trên máy của bạn.</p>
              <label class="setting-row"><span>${icon('sound')}<span>Âm lượng<small>Tiếng súng và âm thanh trong trận</small></span></span><output id="volume-value">60%</output><input id="volume" type="range" min="0" max="1" step="0.05" aria-label="Âm lượng"></label>
              <label class="setting-row"><span>${icon('target')}<span>Độ nhạy chuột<small>Giá trị thấp giúp ngắm chính xác hơn</small></span></span><output id="sensitivity-value">1.00×</output><input id="sensitivity" type="range" min="0.35" max="2" step="0.05" aria-label="Độ nhạy chuột"></label>
              <div class="setting-gyro touch-only">
                <div class="setting-gyro-head"><span>${icon('target')}<span>Con quay hồi chuyển<small id="gyro-status"></small></span></span></div>
                <div id="gyro-choice" class="seg seg-compact" role="radiogroup" aria-label="Chế độ con quay hồi chuyển"><button type="button" role="radio" data-value="off"><b>Tắt</b></button><button type="button" role="radio" data-value="aim"><b>Khi ngắm</b><small>ngắm hoặc đang bắn</small></button><button type="button" role="radio" data-value="always"><b>Luôn bật</b></button></div>
                <label class="setting-row"><span>${icon('target')}<span>Độ nhạy cảm biến<small>1× = camera quay đúng bằng góc bạn xoay điện thoại</small></span></span><output id="gyro-sensitivity-value">1.00×</output><input id="gyro-sensitivity" type="range" min="0.3" max="3" step="0.05" aria-label="Độ nhạy con quay hồi chuyển"></label>
                <label class="setting-row gyro-invert"><span>${icon('target')}<span>Đảo chiều lên / xuống<small>Bật nếu nghiêng điện thoại lên mà tâm đi xuống</small></span></span><input id="gyro-invert" type="checkbox" aria-label="Đảo chiều lên xuống của con quay hồi chuyển"></label>
              </div>
              <label class="setting-quality"><span>Chất lượng hình ảnh<small>Giảm chất lượng nếu máy chạy chậm</small></span><select id="quality" aria-label="Chất lượng hình ảnh"><option value="high">Cao</option><option value="low">Thấp · ưu tiên FPS</option></select></label>
              <label class="setting-row"><span>${icon('target')}<span>Độ giật súng<small>1× = giật như PUBG PC: tâm leo lên theo mẫu riêng của từng súng, kéo chuột xuống để bù. Thấp hơn thì nhẹ hơn</small></span></span><output id="recoil-value">1.00×</output><input id="recoil-scale" type="range" min="0.3" max="1.5" step="0.05" aria-label="Độ giật súng"></label>
              <div class="setting-gyro touch-only">
                <div class="setting-gyro-head"><span>${icon('target')}<span>Hỗ trợ ngắm<small>Camera chậm lại khi tâm lướt qua địch và hút nhẹ về thân khi bạn bắn hoặc ngắm</small></span></span></div>
                <div id="assist-choice" class="seg seg-compact" role="radiogroup" aria-label="Hỗ trợ ngắm"><button type="button" role="radio" data-value="off"><b>Tắt</b></button><button type="button" role="radio" data-value="low"><b>Nhẹ</b></button><button type="button" role="radio" data-value="high"><b>Mạnh</b><small>như Free Fire</small></button></div>
              </div>
              <label class="setting-row setting-check"><span>${icon('target')}<span>Hiện hướng tiếng súng<small>Vệt nhạt quanh tâm chỉ hướng người khác nổ súng gần bạn</small></span></span><input id="sound-indicator" type="checkbox" aria-label="Hiện hướng tiếng súng"></label>
              <label class="setting-row setting-check"><span>${icon('target')}<span>Gợi ý cho người mới<small>Mẹo ngắn hiện một lần, lần đầu bạn gặp từng tình huống</small></span></span><input id="tips" type="checkbox" aria-label="Gợi ý cho người mới"></label>
              <label class="setting-row setting-check"><span>${icon('target')}<span>Hiện FPS<small>Số khung hình mỗi giây và số vật thể đang vẽ, để biết máy có chạy nổi không</small></span></span><input id="show-fps" type="checkbox" aria-label="Hiện FPS"></label>
              <div class="settings-saved">Thiết lập được lưu tự động trên trình duyệt này.</div><button id="back-play" class="button button-secondary" type="button">TRỞ VỀ CHIẾN ĐẤU ${icon('arrow')}</button>
            </div>
          </aside>
        </div>
        <footer class="lobby-foot">
          <div class="guide-keys desktop-controls"><span><kbd>W A S D</kbd>Di chuyển / lái dù</span><span><kbd>SPACE</kbd>Nhảy dù · mở dù</span><span><kbd>CHUỘT</kbd>Ngắm / bắn</span><span><kbd>E</kbd>Nhặt đồ</span><span><kbd>F</kbd>Lên / xuống xe</span><span><kbd>1 – 3</kbd>Chọn súng</span><span><kbd>M</kbd>Bản đồ lớn</span><span><kbd>ESC</kbd>Tạm dừng</span></div>
          <div class="touch-guide"><span><b>NGÓN TRÁI</b>Kéo cần để di chuyển</span><span><b>NGÓN PHẢI</b>Vuốt để xoay camera</span><span><b>NÚT NGẮM</b>Bật / tắt ống ngắm</span><span><b>NÚT NHẢY</b>Nhảy khỏi máy bay · mở dù</span></div>
          <div class="touch-orientation-note">Xoay điện thoại ngang để chơi thoải mái.</div>
        </footer>
      </section>
      <div id="scope-overlay" class="scope-overlay" aria-label="Ống ngắm" hidden>
        <div class="scope-lens">
          <svg class="scope-reticle" viewBox="0 0 1000 1000" fill="none" aria-hidden="true">
            <g stroke="rgba(10, 17, 13, .9)" stroke-width="1.8">
              <path d="M34 500H485M515 500H966M500 34V485M500 515V966"/>
              <path d="M335 491V509M390 493V507M445 494V506M555 494V506M610 493V507M665 491V509M491 335H509M493 390H507M494 445H506M476 555H524M468 610H532M458 665H542M448 720H552"/>
            </g>
            <g stroke="rgba(5, 10, 7, .9)" stroke-width="6"><path d="M20 500H200M800 500H980M500 800V980"/></g>
            <g fill="rgba(10, 17, 13, .75)" font-family="Segoe UI, Arial, sans-serif" font-size="14"><text x="541" y="560">2</text><text x="549" y="615">4</text><text x="559" y="670">6</text></g>
            <circle cx="500" cy="500" r="2.2" fill="#b85435"/>
          </svg>
          <div class="scope-optic-label"><span id="scope-weapon-name">ỐNG NGẮM</span><strong id="scope-zoom">6×</strong></div>
        </div>
      </div>
      <section id="hud" class="hud" aria-label="Thông tin trận đấu" hidden>
        <div class="hud-brand"><span class="brand-symbol">L<span></span></span><span>LASTLIGHT<small>SOLO</small></span></div>
        <div class="compass"><div class="compass-needle"></div><div id="compass-labels" class="compass-labels"></div><span id="compass-degrees" class="compass-degrees">000°</span></div>
        <div class="match-stats"><div><span>CÒN SỐNG</span><strong id="alive-count">6</strong></div><div><span>HẠ GỤC</span><strong id="kill-count">0</strong></div><div><span>THỜI GIAN</span><strong id="match-time">00:00</strong></div></div>
        <div id="zone-banner" class="zone-banner"><span class="zone-dot"></span><div><span id="zone-title">VÙNG AN TOÀN</span><small id="zone-description">Vòng bo sẽ thu hẹp</small></div><strong id="zone-time">00:00</strong></div>
        <div id="crosshair" class="crosshair" aria-hidden="true"><i></i><i></i><i></i><i></i><b></b></div><div id="hit-marker" class="hit-marker" aria-hidden="true">×</div><div id="vehicle-hud" class="vehicle-hud" hidden><div class="vehicle-speed"><strong id="vehicle-speed">0</strong><span>KM/H</span></div><div class="vehicle-health"><i id="vehicle-health-bar"></i></div><small class="desktop-controls">W / S GA · A / D LÁI · SPACE PHANH · F XUỐNG XE</small></div><div id="sound-dirs" class="sound-dirs" aria-hidden="true">${[0, 1, 2, 3].map(i => `<div id="sound-dir-${i}" class="sound-dir"><i></i></div>`).join('')}</div><div id="damage-dir" class="damage-dir" aria-hidden="true"><i></i></div><div id="kill-feed" class="kill-feed" aria-live="off"></div>
        <div id="air-hud" class="air-hud" hidden><div id="air-stage" class="air-stage">TRÊN MÁY BAY</div><div class="air-readout"><div><strong id="air-alt">0</strong><span>M · ĐỘ CAO</span></div><div><strong id="air-speed">0</strong><span>KM/H</span></div><div><strong id="air-left">0</strong><span id="air-left-label">GIÂY</span></div></div><div id="air-prompt" class="air-prompt"></div></div>
        <div id="stance-badge" class="stance-badge" hidden></div><div id="perf-meter" class="perf-meter" hidden aria-hidden="true"></div><div id="spectate-bar" class="spectate-bar" hidden><span id="spectate-name">ĐANG XEM</span><small id="spectate-help"></small><button id="spectate-exit" type="button">THOÁT</button></div><div id="air-streaks" class="air-streaks" hidden aria-hidden="true"></div><div id="air-flag" class="air-flag" hidden></div>
        <div id="interaction-hint" class="interaction-hint" hidden></div><div id="action-progress" class="action-progress" hidden></div>
        <div class="health-panel"><div class="player-label"><span class="status-dot"></span>BẠN <span id="health-number">100</span><small>HP</small></div><div class="health-track"><div id="health-bar"></div></div><div id="armor-row" class="armor-row" aria-label="Giáp đang mặc"></div><div class="health-meta"><span>${icon('medkit')}<strong id="medkits">1</strong> TÚI CỨU THƯƠNG <kbd>H</kbd></span><span id="health-status">SẴN SÀNG</span></div></div>
        <div id="weapon-panel" class="weapon-panel"><div class="weapon-active"><div class="weapon-label"><span id="weapon-name">${WEAPONS.rifle.label}</span><small id="weapon-mode">${FIRE_MODE_LABELS[WEAPONS.rifle.fireMode]}</small><em id="weapon-category">${WEAPONS.rifle.category}</em></div><div class="ammo-count"><strong id="ammo-loaded">${WEAPONS.rifle.magazine}</strong><span>/ <b id="ammo-reserve">0</b></span></div></div><button id="touch-inventory-toggle" class="touch-inventory-toggle" type="button" aria-expanded="false" aria-controls="weapon-inventory">Kho súng ${icon('arrow')}</button><div id="weapon-inventory" class="weapon-slots" aria-label="Vũ khí đang mang"></div><div id="ammo-message" class="ammo-message">R · NẠP ĐẠN</div><div class="weapon-cycle-help">1 · 2 · 3 CHỌN SÚNG <span>Q / CUỘN · ĐỔI SÚNG</span></div></div>
        <div class="minimap-panel"><div class="map-header"><span>BẢN ĐỒ</span><span id="map-stage">VÒNG 1</span></div><canvas id="minimap" width="208" height="208" aria-label="Bản đồ: vị trí của bạn, địa hình và vùng an toàn"></canvas><div class="map-footer"><span><i></i>Vùng an toàn</span><span class="map-north">N ↑</span></div></div>
        <div class="pause-tip"><kbd>ESC</kbd> TẠM DỪNG</div>
        <div class="orientation-hint">Xoay điện thoại ngang để chơi</div>
      </section>
      <section id="pause-screen" class="overlay-screen" aria-labelledby="pause-title" hidden><div class="dialog pause-dialog"><div class="eyebrow"><span class="orange-dash"></span>TRẬN ĐẤU ĐÃ TẠM DỪNG</div><h2 id="pause-title">NGHỈ MỘT NHỊP.</h2><p>Chiến trường đang chờ bạn quay lại.</p><button id="resume-button" class="button button-primary" type="button">TIẾP TỤC TRẬN ${icon('arrow')}</button><button id="pause-restart" class="button button-secondary" type="button">CHƠI LẠI</button><button id="pause-menu" class="text-button" type="button">VỀ MÀN HÌNH CHÍNH</button><small class="dialog-hint">Nhấn ESC để tiếp tục</small></div></section>
      <section id="result-screen" class="overlay-screen results-screen" aria-labelledby="result-title" hidden><div class="result-backdrop-mark" aria-hidden="true">01</div><div class="dialog result-dialog"><div id="result-eyebrow" class="eyebrow"><span class="orange-dash"></span>TRẬN ĐẤU KẾT THÚC</div><span id="result-rank" class="result-rank">#1</span><h2 id="result-title">NGƯỜI SỐNG CUỐI.</h2><p id="result-copy">Bạn đã giữ vững vị trí cho đến giây cuối cùng.</p><div class="result-stats"><div><strong id="result-kills">0</strong><span>HẠ GỤC</span></div><div><strong id="result-time">00:00</strong><span>SỐNG SÓT</span></div><div><strong id="result-accuracy">0%</strong><span>CHÍNH XÁC</span></div></div><button id="replay-button" class="button button-secondary" type="button" hidden>XEM LẠI CÚ HẠ GỤC ${icon('arrow')}</button><button id="spectate-button" class="button button-secondary" type="button" hidden>XEM TIẾP TRẬN ${icon('arrow')}</button><button id="restart-button" class="button button-primary" type="button">VÀO TRẬN MỚI ${icon('arrow')}</button><button id="result-menu" class="text-button" type="button">VỀ MÀN HÌNH CHÍNH</button></div></section>
      <section id="map-screen" class="map-screen" aria-label="Bản đồ lớn" hidden><div class="map-card"><div class="map-card-head"><b>BẢN ĐỒ</b><span id="bigmap-stage">VÒNG 1</span><kbd>M</kbd><small>ĐÓNG</small></div><canvas id="bigmap" width="880" height="880"></canvas><div class="map-legend"><span><i class="lg-player"></i>Bạn</span><span><i class="lg-zone"></i>Vùng an toàn</span><span><i class="lg-next"></i>Vòng kế tiếp</span><span><i class="lg-town"></i>Thị trấn</span><span><i class="lg-crate"></i>Hộp tiếp tế</span><span class="map-tip">Chạm bản đồ để đặt hoặc bỏ cờ đáp</span></div></div></section><div id="replay-bar" class="replay-bar" hidden><span id="replay-title">PHÁT LẠI · 8 GIÂY CUỐI</span><small id="replay-detail"></small><button id="replay-stop" type="button">ĐÓNG</button></div><div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
      <div id="error-banner" class="error-banner" role="alert" hidden></div>
      <div id="loading-screen" class="loading-screen" role="status" aria-live="polite" hidden><div class="loading-spinner"></div><span id="loading-text">ĐANG CHUẨN BỊ CHIẾN TRƯỜNG</span></div>
    `;
    root.querySelectorAll<HTMLElement>('[id]').forEach(element => this.elements.set(element.id, element));
    const choose = (id: string, handler: (value: string) => void) => this.el(id).addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-value]');
      if (button) handler(button.dataset.value!);
    });
    choose('difficulty-choice', value => this.changeSettings({ difficulty: value === 'easy' ? 'easy' : 'normal' }));
    choose('bot-choice', value => this.changeSettings({ botCount: Number(value) }));
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
    this.el('tab-play').addEventListener('click', () => this.showSettings(false));
    this.el('tab-settings').addEventListener('click', () => this.showSettings(true));
    this.el('back-play').addEventListener('click', () => this.showSettings(false));
    root.querySelector('.wordmark')?.addEventListener('click', event => { event.preventDefault(); this.showSettings(false); });
    this.el('start-button').addEventListener('click', () => { this.hide('error-banner', true); this.callbacks.onStart({ ...this.settings }); });
    this.el('resume-button').addEventListener('click', callbacks.onResume);
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
      this.closeInventory();
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
    if (!world || world.id === 'arena') return;
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
  }
  private showSettings(show: boolean): void {
    this.hide('play-panel', show);
    this.hide('settings-panel', !show);
    this.el('tab-play').classList.toggle('active', !show);
    this.el('tab-settings').classList.toggle('active', show);
  }
  private updateBest(): void {
    this.text('best-wins', `${this.best.wins}`);
    this.text('best-kills', `${this.best.kills}`);
    this.text('best-time', formatTime(this.best.survival));
  }
  private closeInventory(): void {
    this.el('weapon-panel').classList.remove('touch-picker-open');
    this.el('touch-inventory-toggle').setAttribute('aria-expanded', 'false');
    this.callbacks.onTouchOverlayChange?.(this.touchOverlayOpen);
  }

  public get touchOverlayOpen(): boolean {
    return this.touchMode && (this.mapOpen || this.el('weapon-panel').classList.contains('touch-picker-open'));
  }

  public update(state: GameState, world: WorldConfig, hint: string): void {
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
      this.closeInventory();
      if (state.phase !== 'playing') this.toggleMap(false);
      if (state.phase === 'playing') { this.resultSaved = false; this.lastHits = state.hits; }
      if (state.phase === 'menu') this.showSettings(false);
      const focusId = state.phase === 'menu' ? 'start-button' : state.phase === 'paused' ? 'resume-button' : results ? 'restart-button' : null;
      if (focusId) this.el(focusId).focus({ preventScroll: true });
      if (results) this.showResults(state);
    }
    const player = state.actors.find(actor => actor.isPlayer);
    if (!player) return;
    if (this.currentWeapon !== player.weapon || phaseChanged) {
      this.currentWeapon = player.weapon;
      this.setAim(false, player.weapon);
    }
    this.el('damage-vignette').style.opacity = state.phase === 'playing' ? `${Math.min(0.8, Math.max(0, player.hurtTimer) * 2)}` : '0';
    if (state.phase !== 'playing' && state.phase !== 'paused') return;
    const now = performance.now();
    if (state.hits > this.lastHits) this.hitUntil = now + 170;
    this.lastHits = state.hits;
    this.el('hit-marker').classList.toggle('visible', now < this.hitUntil);
    this.text('alive-count', `${state.actors.filter(actor => actor.alive).length}`);
    this.text('kill-count', `${state.kills}`);
    this.text('match-time', formatTime(state.elapsed));
    this.text('health-number', `${Math.ceil(Math.max(0, player.health))}`);
    this.el('health-bar').style.transform = `scaleX(${Math.max(0, Math.min(1, player.health / 100))})`;
    this.el('health-bar').classList.toggle('low', player.health < 35);
    this.text('medkits', `${player.medkits}`);
    this.el('health-bar').classList.toggle('mid', player.health >= 35 && player.health < 65);
    this.text('health-status', player.healing > 0 ? 'ĐANG HỒI MÁU' : player.health < 35 ? 'CẦN HỒI MÁU' : 'SẴN SÀNG');
    const weaponConfig = WEAPONS[player.weapon];
    this.text('weapon-name', weaponConfig.label);
    this.text('weapon-mode', `${FIRE_MODE_LABELS[weaponConfig.fireMode]} · ${weaponConfig.zoom}×`);
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

  public setAim(aiming: boolean, weapon: WeaponType): void {
    const key = `${this.phase}:${weapon}:${aiming}`;
    if (key === this.aimStateKey) return;
    this.aimStateKey = key;
    const config = WEAPONS[weapon];
    const active = aiming && this.phase === 'playing';
    const scoped = active && config.zoom >= 4;
    this.hide('scope-overlay', !scoped);
    this.hide('crosshair', scoped || this.phase !== 'playing');
    this.el('crosshair').classList.toggle('is-ads', active && !scoped);
    this.el('crosshair').classList.toggle('sniper-hip', !active && config.zoom >= 4);
    this.root.dataset.aim = scoped ? 'scope' : active ? 'ads' : 'hip';
    if (scoped) {
      this.text('scope-weapon-name', config.label);
      // The sights are zeroed at a set distance; beyond it the bullet drops, so aim a little higher.
      this.text('scope-zoom', `${config.zoom}× · ${ZERO_DISTANCE[config.kind]} M`);
      this.el('scope-overlay').setAttribute('aria-label', `Ống ngắm ${config.label}, độ phóng đại ${config.zoom} lần`);
    }
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
  public setReplayAvailable(available: boolean): void { this.hide('replay-button', !available); }

  /** While the kill replay plays the results are hidden behind a small banner; `detail` names the killer and gun. */
  public setReplay(active: boolean, detail = ''): void {
    this.hide('replay-bar', !active);
    this.hide('result-screen', active || this.phase === 'playing' || this.phase === 'paused' || this.phase === 'menu');
    if (active) this.text('replay-detail', detail);
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
    if (open) this.closeInventory();
    this.hide('map-screen', !open);
    this.callbacks.onTouchOverlayChange?.(this.touchOverlayOpen);
    this.root.querySelector('.minimap-panel')?.setAttribute('aria-expanded', String(open));
    if (open && this.lastState) this.drawBigMap(this.lastState, this.lastWorld!);
  }
  public get mapOpen(): boolean { return !this.el('map-screen').hidden; }

  private lastState: GameState | null = null;
  private lastWorld: WorldConfig | null = null;

  /** The menu's preview of the chosen battleground. */
  private drawMenuMap(): void {
    const canvas = this.el('menu-map') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const data = mapData(this.settings.map);
    if (data) { ctx.drawImage(this.islandBackdrop(canvas.width, data.world, data.terrain), 0, 0); return; }
    ctx.fillStyle = '#1a2a24'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#ffffff14';
    for (let i = 1; i < 8; i++) { ctx.beginPath(); ctx.moveTo(i * canvas.width / 8, 0); ctx.lineTo(i * canvas.width / 8, canvas.height); ctx.moveTo(0, i * canvas.height / 8); ctx.lineTo(canvas.width, i * canvas.height / 8); ctx.stroke(); }
    ctx.fillStyle = '#6b7a6a';
    for (const [x, y, w, h] of [[60, 70, 70, 50], [190, 60, 60, 60], [40, 150, 65, 80], [200, 160, 72, 52], [120, 230, 76, 52]]) ctx.fillRect(x, y, w, h);
  }

  private islandMaps = new Map<number, HTMLCanvasElement>();

  /** Shaded relief, roads and towns of the island, rendered once and reused for every minimap frame. */
  private islandBackdrop(size: number, world: Pick<WorldConfig, 'id' | 'halfSize' | 'roads' | 'towns' | 'water'>, terrain: (x: number, z: number) => number): HTMLCanvasElement {
    const cacheKey = size * 10 + (world.id === 'valley' ? 1 : 0);
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
          image.data[i] = (70 + t * 90) * shade; image.data[i + 1] = (98 + t * 55) * shade; image.data[i + 2] = (68 + t * 70) * shade;
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
    // Tint terrain outside the safe circle. Enemy positions are deliberately omitted.
    ctx.fillStyle = '#4898ce25';
    ctx.beginPath(); ctx.rect(0, 0, size, size);
    ctx.moveTo(mapX(state.zone.center.x) + state.zone.radius * scale, mapY(state.zone.center.z));
    ctx.arc(mapX(state.zone.center.x), mapY(state.zone.center.z), state.zone.radius * scale, 0, Math.PI * 2);
    ctx.fill('evenodd');
    ctx.strokeStyle = '#b7dbc3'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(mapX(state.zone.center.x), mapY(state.zone.center.z), state.zone.radius * scale, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#eef0d88a'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.arc(mapX(state.zone.nextCenter.x), mapY(state.zone.nextCenter.z), state.zone.nextRadius * scale, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    if (big && world.id !== 'arena') {
      ctx.font = '600 15px "Segoe UI", Arial, sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = '#0b100dcc'; ctx.fillStyle = '#f4efd8';
      for (const town of world.towns) { const x = mapX(town.x), y = mapY(town.z) - (town.tier === 'city' ? 12 : 9); ctx.strokeText(town.name, x, y); ctx.fillText(town.name, x, y); }
    }
    const player = state.actors.find(actor => actor.isPlayer);
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
    this.hide('spectate-button', won || !!state.spectating || state.actors.filter(actor => actor.alive).length < 2);
    this.text('result-title', won ? 'NGƯỜI SỐNG CUỐI.' : 'HẸN Ở TRẬN SAU.');
    this.text('result-copy', won ? 'Bạn đã giữ vững vị trí cho đến giây cuối cùng.' : 'Mỗi lần trở lại, bạn sẽ hiểu chiến trường hơn.');
    this.text('result-kills', `${state.kills}`);
    const survived = state.diedAt ?? state.elapsed;
    this.text('result-time', formatTime(survived));
    this.text('result-accuracy', `${state.shots > 0 ? Math.min(100, Math.round(state.hits / state.shots * 100)) : 0}%`);
    if (!this.resultSaved) {
      this.resultSaved = true;
      this.best = { wins: this.best.wins + (won ? 1 : 0), kills: Math.max(this.best.kills, state.kills), survival: Math.max(this.best.survival, survived) };
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
