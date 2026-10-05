import type { GameSettings, GameState, WeaponType, WorldConfig } from './types';
import { WEAPON_ORDER, WEAPONS } from './game/weapons';

type Callbacks = {
  onStart: (settings: GameSettings) => void;
  onResume: () => void;
  onRestart: () => void;
  onMenu: () => void;
  onSettings: (settings: GameSettings) => void;
  onSelectWeapon?: (weapon: WeaponType) => void;
};
type BestRecord = { wins: number; kills: number; survival: number };
const DEFAULT_SETTINGS: GameSettings = { difficulty: 'normal', botCount: 5, volume: 0.6, quality: 'high', sensitivity: 1 };
const SETTINGS_KEY = 'lastlight.settings.v1';
const BEST_KEY = 'lastlight.best.v1';
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
  const defaults: GameSettings = { ...DEFAULT_SETTINGS, quality: document.documentElement.dataset.input === 'touch' ? 'low' : 'high' };
  const value = readJson(SETTINGS_KEY);
  if (!value || typeof value !== 'object') return defaults;
  const raw = value as Partial<GameSettings>;
  return {
    difficulty: raw.difficulty === 'easy' ? 'easy' : 'normal',
    botCount: raw.botCount === 7 ? 7 : 5,
    quality: raw.quality === 'low' || raw.quality === 'high' ? raw.quality : defaults.quality,
    volume: clamp(raw.volume, 0, 1, DEFAULT_SETTINGS.volume),
    sensitivity: clamp(raw.sensitivity, 0.35, 2, DEFAULT_SETTINGS.sensitivity),
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
  private aimStateKey = '';
  private readonly touchMode = document.documentElement.dataset.input === 'touch';

  constructor(callbacks: Callbacks) {
    this.callbacks = callbacks;
    const root = document.getElementById('ui-root');
    if (!root) throw new Error('Thiếu phần tử giao diện #ui-root.');
    this.root = root;
    root.innerHTML = `
      <div id="damage-vignette" class="damage-vignette" aria-hidden="true"></div>
      <section id="menu-screen" class="menu-screen">
        <header class="menu-header"><a class="wordmark" href="#" aria-label="LASTLIGHT, màn hình chính"><span class="brand-symbol">L<span></span></span><span>LASTLIGHT<small>SINGLE PLAYER · WEB EDITION</small></span></a><div class="build-badge"><span></span>CHIẾN TRƯỜNG 01</div></header>
        <div class="menu-body">
          <div class="menu-left">
            <nav class="menu-tabs" aria-label="Màn hình chính"><button id="tab-play" class="tab active" type="button">TÁC CHIẾN</button><button id="tab-settings" class="tab" type="button">THIẾT LẬP</button></nav>
            <div id="play-panel" class="hero-panel">
              <div class="eyebrow"><span class="orange-dash"></span>ĐƠN ĐỘC. CHƯA BAO GIỜ AN TOÀN.</div>
              <h1>LAST<span>LIGHT</span></h1>
              <p class="hero-subtitle">VÙNG SỐNG CUỐI CÙNG</p>
              <p class="hero-copy">8 dòng súng. Áp sát hoặc ngắm xa với ống ngắm đến 8×.<br>Giữ mình trong vòng bo. Chỉ một người được ở lại.</p>
              <div class="deployment-settings"><label>ĐỘ KHÓ<select id="difficulty" aria-label="Độ khó"><option value="normal">Tiêu chuẩn</option><option value="easy">Dễ · làm quen</option></select></label><label>ĐỐI THỦ<select id="bot-count" aria-label="Số lượng bot"><option value="5">5 bot</option><option value="7">7 bot</option></select></label></div>
              <button id="start-button" class="button button-primary start-button" type="button"><span>${icon('target')}BẮT ĐẦU TRẬN</span>${icon('arrow')}</button>
              <div class="solo-note"><span></span>CHƠI NGAY · KHÔNG CẦN TÀI KHOẢN</div>
              <div class="personal-record"><div><strong id="best-wins">0</strong><span>CHIẾN THẮNG</span></div><div><strong id="best-kills">0</strong><span>KỶ LỤC HẠ GỤC</span></div><div><strong id="best-time">00:00</strong><span>SỐNG SÓT LÂU NHẤT</span></div></div>
            </div>
            <div id="settings-panel" class="settings-panel" hidden>
              <div class="eyebrow"><span class="orange-dash"></span>CHUẨN BỊ TRƯỚC KHI VÀO TRẬN</div><h2>THIẾT LẬP</h2><p class="settings-copy">Điều chỉnh để chơi thoải mái trên máy của bạn.</p>
              <label class="setting-row"><span>${icon('sound')}<span>Âm lượng<small>Tiếng súng và âm thanh trong trận</small></span></span><output id="volume-value">60%</output><input id="volume" type="range" min="0" max="1" step="0.05" aria-label="Âm lượng"></label>
              <label class="setting-row"><span>${icon('target')}<span>Độ nhạy chuột<small>Giá trị thấp giúp ngắm chính xác hơn</small></span></span><output id="sensitivity-value">1.00×</output><input id="sensitivity" type="range" min="0.35" max="2" step="0.05" aria-label="Độ nhạy chuột"></label>
              <label class="setting-quality"><span>Chất lượng hình ảnh<small>Giảm chất lượng nếu máy chạy chậm</small></span><select id="quality" aria-label="Chất lượng hình ảnh"><option value="high">Cao</option><option value="low">Thấp · ưu tiên FPS</option></select></label>
              <div class="settings-saved">Thiết lập được lưu tự động trên trình duyệt này.</div><button id="back-play" class="button button-secondary" type="button">TRỞ VỀ TÁC CHIẾN ${icon('arrow')}</button>
            </div>
          </div>
          <aside class="mission-card" aria-label="Thông tin chiến trường"><div class="mission-top"><span>ĐỊA ĐIỂM / 01</span><span class="mission-number">01</span></div><div class="mission-horizon"><span>VÙNG HOANG PHẾ</span></div><div class="mission-description"><div class="eyebrow">NHIỆM VỤ SINH TỒN</div><h2>Không còn<br>đường lui.</h2><p>8 dòng súng, ống ngắm đến 8×.<br>Giữ vị trí trong vòng bo và<br>chọn thời điểm ra đòn.</p></div><dl><div><dt>CHẾ ĐỘ</dt><dd>SOLO / BOT</dd></div><div><dt>CHIẾN TRƯỜNG</dt><dd>1 NGƯỜI + <span id="brief-bots">5</span> BOT</dd></div><div><dt>MỤC TIÊU</dt><dd>NGƯỜI SỐNG CUỐI</dd></div></dl><div class="mission-footer">${icon('shield')}MỖI TRẬN LÀ MỘT CƠ HỘI MỚI</div></aside>
        </div>
        <footer class="control-guide"><div class="guide-title">LÀM CHỦ CHIẾN TRƯỜNG</div><div class="guide-keys desktop-controls"><span><kbd>W A S D</kbd>Di chuyển</span><span><kbd>CHUỘT</kbd>Ngắm / bắn</span><span><kbd>SHIFT</kbd>Chạy</span><span><kbd>SPACE</kbd>Nhảy</span><span><kbd>E</kbd>Nhặt đồ</span><span><kbd>R</kbd>Nạp đạn</span><span><kbd>H</kbd>Hồi máu</span><span><kbd>1 – 8</kbd>Chọn súng</span><span><kbd>Q / CUỘN</kbd>Đổi súng</span><span><kbd>ESC</kbd>Tạm dừng</span></div><span class="guide-tip desktop-controls">Giữ chuột phải để ngắm / mở ống ngắm · Q hoặc cuộn chuột để đổi súng đã nhặt</span><div class="touch-guide"><span><b>NGÓN TRÁI</b>Kéo cần để di chuyển</span><span><b>NGÓN PHẢI</b>Vuốt vùng trống để xoay camera</span><span><b>NÚT NGẮM</b>Chạm để bật / tắt ống ngắm</span><small>Giữ nút Bắn với súng tự động; chạm từng phát với súng bán tự động và súng ngắm.</small></div><div class="touch-orientation-note">Xoay điện thoại ngang để chơi thoải mái.</div></footer>
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
        <div id="crosshair" class="crosshair" aria-hidden="true"><i></i><i></i><i></i><i></i><b></b></div><div id="hit-marker" class="hit-marker" aria-hidden="true">×</div>
        <div id="interaction-hint" class="interaction-hint" hidden></div><div id="action-progress" class="action-progress" hidden></div>
        <div class="health-panel"><div class="player-label"><span class="status-dot"></span>BẠN <span id="health-number">100</span><small>HP</small></div><div class="health-track"><div id="health-bar"></div></div><div class="health-meta"><span>${icon('medkit')}<strong id="medkits">1</strong> TÚI CỨU THƯƠNG <kbd>H</kbd></span><span id="health-status">SẴN SÀNG</span></div></div>
        <div id="weapon-panel" class="weapon-panel"><div class="weapon-active"><div class="weapon-label"><span id="weapon-name">${WEAPONS.rifle.label}</span><small id="weapon-mode">${FIRE_MODE_LABELS[WEAPONS.rifle.fireMode]}</small><em id="weapon-category">${WEAPONS.rifle.category}</em></div><div class="ammo-count"><strong id="ammo-loaded">${WEAPONS.rifle.magazine}</strong><span>/ <b id="ammo-reserve">0</b></span></div></div><button id="touch-inventory-toggle" class="touch-inventory-toggle" type="button" aria-expanded="false" aria-controls="weapon-inventory">Kho súng ${icon('arrow')}</button><div id="weapon-inventory" class="weapon-slots" aria-label="8 ô vũ khí; chọn súng đã nhặt">${WEAPON_ORDER.map((weapon, index) => `<button id="${weapon}-slot" class="weapon-slot unowned" type="button" data-weapon="${weapon}" aria-label="${WEAPONS[weapon].label}, ${WEAPONS[weapon].category}" aria-pressed="false" disabled title="${index + 1} · ${WEAPONS[weapon].label} · ${WEAPONS[weapon].category}" style="--weapon-color:${WEAPONS[weapon].color}"><kbd>${index + 1}</kbd><span>${WEAPONS[weapon].label}</span><i>—</i></button>`).join('')}</div><div id="ammo-message" class="ammo-message">R · NẠP ĐẠN</div><div class="weapon-cycle-help">1–8 · CHỌN SÚNG <span>Q / CUỘN · ĐỔI SÚNG</span></div></div>
        <div class="minimap-panel"><div class="map-header"><span>BẢN ĐỒ</span><span id="map-stage">VÒNG 1</span></div><canvas id="minimap" width="208" height="208" aria-label="Bản đồ: vị trí của bạn, địa hình và vùng an toàn"></canvas><div class="map-footer"><span><i></i>Vùng an toàn</span><span class="map-north">N ↑</span></div></div>
        <div class="pause-tip"><kbd>ESC</kbd> TẠM DỪNG</div>
        <div class="orientation-hint">Xoay điện thoại ngang để chơi</div>
      </section>
      <section id="pause-screen" class="overlay-screen" aria-labelledby="pause-title" hidden><div class="dialog pause-dialog"><div class="eyebrow"><span class="orange-dash"></span>TRẬN ĐẤU ĐÃ TẠM DỪNG</div><h2 id="pause-title">NGHỈ MỘT NHỊP.</h2><p>Chiến trường đang chờ bạn quay lại.</p><button id="resume-button" class="button button-primary" type="button">TIẾP TỤC TRẬN ${icon('arrow')}</button><button id="pause-restart" class="button button-secondary" type="button">CHƠI LẠI</button><button id="pause-menu" class="text-button" type="button">VỀ MÀN HÌNH CHÍNH</button><small class="dialog-hint">Nhấn ESC để tiếp tục</small></div></section>
      <section id="result-screen" class="overlay-screen results-screen" aria-labelledby="result-title" hidden><div class="result-backdrop-mark" aria-hidden="true">01</div><div class="dialog result-dialog"><div id="result-eyebrow" class="eyebrow"><span class="orange-dash"></span>TRẬN ĐẤU KẾT THÚC</div><span id="result-rank" class="result-rank">#1</span><h2 id="result-title">NGƯỜI SỐNG CUỐI.</h2><p id="result-copy">Bạn đã giữ vững vị trí cho đến giây cuối cùng.</p><div class="result-stats"><div><strong id="result-kills">0</strong><span>HẠ GỤC</span></div><div><strong id="result-time">00:00</strong><span>SỐNG SÓT</span></div><div><strong id="result-accuracy">0%</strong><span>CHÍNH XÁC</span></div></div><button id="restart-button" class="button button-primary" type="button">VÀO TRẬN MỚI ${icon('arrow')}</button><button id="result-menu" class="text-button" type="button">VỀ MÀN HÌNH CHÍNH</button></div></section>
      <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
      <div id="error-banner" class="error-banner" role="alert" hidden></div>
      <div id="loading-screen" class="loading-screen" role="status" aria-live="polite" hidden><div class="loading-spinner"></div><span id="loading-text">ĐANG CHUẨN BỊ CHIẾN TRƯỜNG</span></div>
    `;
    root.querySelectorAll<HTMLElement>('[id]').forEach(element => this.elements.set(element.id, element));
    this.el('difficulty').addEventListener('change', () => this.changeSettings({ difficulty: (this.el('difficulty') as HTMLSelectElement).value === 'easy' ? 'easy' : 'normal' }));
    this.el('bot-count').addEventListener('change', () => this.changeSettings({ botCount: (this.el('bot-count') as HTMLSelectElement).value === '7' ? 7 : 5 }));
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
    this.el('pause-menu').addEventListener('click', callbacks.onMenu);
    this.el('result-menu').addEventListener('click', callbacks.onMenu);
    this.el('touch-inventory-toggle').addEventListener('click', () => {
      const open = this.el('weapon-panel').classList.toggle('touch-picker-open');
      this.el('touch-inventory-toggle').setAttribute('aria-expanded', `${open}`);
    });
    for (const weapon of WEAPON_ORDER) {
      this.el(`${weapon}-slot`).addEventListener('click', () => {
        this.callbacks.onSelectWeapon?.(weapon);
        this.closeInventory();
      });
    }
    if (this.touchMode) {
      this.el('sensitivity').setAttribute('aria-label', 'Độ nhạy vuốt camera');
      const sensitivityLabel = this.el('sensitivity').closest('label')?.querySelector('span > span');
      if (sensitivityLabel) sensitivityLabel.innerHTML = 'Độ nhạy vuốt<small>Giá trị thấp giúp ngắm chính xác hơn</small>';
      const pauseHint = root.querySelector('.dialog-hint');
      if (pauseHint) pauseHint.textContent = 'Chạm Tiếp tục trận để quay lại';
    }
    this.syncSettings();
    this.updateBest();
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
    (this.el('difficulty') as HTMLSelectElement).value = this.settings.difficulty;
    (this.el('bot-count') as HTMLSelectElement).value = `${this.settings.botCount}`;
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
    this.text('health-status', player.healing > 0 ? 'ĐANG HỒI MÁU' : player.health < 35 ? 'CẦN HỒI MÁU' : 'SẴN SÀNG');
    const weaponConfig = WEAPONS[player.weapon];
    this.text('weapon-name', weaponConfig.label);
    this.text('weapon-mode', `${FIRE_MODE_LABELS[weaponConfig.fireMode]} · ${weaponConfig.zoom}×`);
    this.text('weapon-category', weaponConfig.category);
    this.text('ammo-loaded', `${player.ammo[player.weapon]}`);
    this.text('ammo-reserve', `${player.reserve[player.weapon]}`);
    this.text('ammo-message', player.reloading > 0 ? `ĐANG NẠP ĐẠN · ${player.reloading.toFixed(1)}s` : player.ammo[player.weapon] === 0 ? this.touchMode ? 'HẾT ĐẠN · CHẠM NẠP' : 'HẾT ĐẠN · NHẤN R' : this.touchMode ? 'ĐẠN SẴN SÀNG' : 'R · NẠP ĐẠN');
    this.el('weapon-panel').classList.toggle('empty', player.ammo[player.weapon] === 0);
    for (const weapon of WEAPON_ORDER) {
      const slot = this.el(`${weapon}-slot`) as HTMLButtonElement;
      const owned = player.ownedWeapons.includes(weapon);
      slot.classList.toggle('active', player.weapon === weapon);
      slot.classList.toggle('unowned', !owned);
      if (slot.disabled === owned) slot.disabled = !owned;
      const pressed = `${player.weapon === weapon}`;
      if (slot.getAttribute('aria-pressed') !== pressed) slot.setAttribute('aria-pressed', pressed);
      const marker = slot.querySelector('i');
      const markerText = owned ? '●' : '—';
      if (marker && marker.textContent !== markerText) marker.textContent = markerText;
    }
    this.text('interaction-hint', this.touchMode ? hint.replace('[E]', 'CHẠM NHẶT ·') : hint);
    this.hide('interaction-hint', !hint);
    this.hide('action-progress', player.reloading <= 0 && player.healing <= 0);
    this.text('action-progress', player.healing > 0 ? `HỒI MÁU · ${player.healing.toFixed(1)}s` : `NẠP ĐẠN · ${player.reloading.toFixed(1)}s`);
    const outside = Math.hypot(player.position.x - state.zone.center.x, player.position.z - state.zone.center.z) > state.zone.radius;
    this.el('zone-banner').classList.toggle('danger', outside);
    this.text('zone-title', outside ? 'BẠN ĐANG NGOÀI VÙNG AN TOÀN' : state.zone.isShrinking ? 'VÒNG BO ĐANG THU HẸP' : 'VÙNG AN TOÀN');
    this.text('zone-description', outside ? 'Di chuyển vào vòng bo để tránh mất máu' : `Vòng ${state.zone.stage + 1} · ${state.zone.isShrinking ? 'Hãy di chuyển vào vùng mới' : 'Chuẩn bị cho vòng bo tiếp theo'}`);
    this.text('zone-time', formatTime(state.zone.timeRemaining));
    this.text('map-stage', `VÒNG ${state.zone.stage + 1}`);
    this.updateCompass(player.yaw);
    if (now - this.lastMapDraw > 90 || phaseChanged) {
      this.lastMapDraw = now;
      this.drawMinimap(state, world);
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
      this.text('scope-zoom', `${config.zoom}×`);
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

  private drawMinimap(state: GameState, world: WorldConfig): void {
    const canvas = this.el('minimap') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const size = canvas.width;
    const padding = 9;
    const scale = (size - padding * 2) / (world.halfSize * 2);
    const mapX = (x: number) => size / 2 + x * scale;
    const mapY = (z: number) => size / 2 - z * scale;
    ctx.clearRect(0, 0, size, size);
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
    const player = state.actors.find(actor => actor.isPlayer);
    if (player) {
      ctx.save(); ctx.translate(mapX(player.position.x), mapY(player.position.z)); ctx.rotate(player.yaw);
      ctx.fillStyle = '#ffad65'; ctx.strokeStyle = '#151b17'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 5); ctx.lineTo(0, 3); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    }
    ctx.strokeStyle = '#ffffff20'; ctx.lineWidth = 1; ctx.strokeRect(padding, padding, size - padding * 2, size - padding * 2);
  }

  private showResults(state: GameState): void {
    const won = state.phase === 'won';
    this.el('result-screen').classList.toggle('victory', won);
    this.text('result-rank', won ? '#1' : `#${Math.max(2, state.actors.filter(actor => actor.alive).length + 1)}`);
    this.text('result-title', won ? 'NGƯỜI SỐNG CUỐI.' : 'HẸN Ở TRẬN SAU.');
    this.text('result-copy', won ? 'Bạn đã giữ vững vị trí cho đến giây cuối cùng.' : 'Mỗi lần trở lại, bạn sẽ hiểu chiến trường hơn.');
    this.text('result-kills', `${state.kills}`);
    this.text('result-time', formatTime(state.elapsed));
    this.text('result-accuracy', `${state.shots > 0 ? Math.min(100, Math.round(state.hits / state.shots * 100)) : 0}%`);
    if (!this.resultSaved) {
      this.resultSaved = true;
      this.best = { wins: this.best.wins + (won ? 1 : 0), kills: Math.max(this.best.kills, state.kills), survival: Math.max(this.best.survival, state.elapsed) };
      saveJson(BEST_KEY, this.best);
      this.updateBest();
    }
  }

  public notify(message: string): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.text('toast', message);
    this.hide('toast', false);
    this.toastTimer = setTimeout(() => this.hide('toast', true), 3200);
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
