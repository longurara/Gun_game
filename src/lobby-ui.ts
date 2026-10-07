import type { LobbyPhase, RoomConfig, RosterEntry } from './net/lobby';
import type { PeerStats } from './net/webrtc';
import { signalMarkup } from './network-signal';
import type { ConnectionMode } from './net/connection-mode';

/** What the waiting room should show. */
export interface LobbyModel {
  /** null until a room has been created or joined. */
  phase: LobbyPhase | null;
  code: string;
  players: RosterEntry[];
  me: string;
  isHost: boolean;
  error: string;
  config: RoomConfig;
  dropLeader?: string;
  /** A short line under the room code, e.g. "Đang kết nối…". */
  status: string;
  connections?: PeerStats[];
  connectionReady?: boolean;
  /** Account ids of the player's friends, and online friends who could be invited to this room. */
  friendIds: string[];
  invitable: Array<{ id: string; name: string }>;
}

export interface LobbyCallbacks {
  onCreate(name: string): void;
  onJoin(code: string, name: string, mode: ConnectionMode): void;
  onStart(): void;
  onLeave(): void;
  onClose(): void;
  onInvite?(friendId: string): void;
  onDropLeader?(id: string): void;
}

const MAP_NAMES: Record<RoomConfig['map'], string> = { island: 'Đảo 4 × 4 km', valley: 'Đấu trường 1 × 1 km', arena: 'Sân tập 200 m', desert: 'Sa mạc 5 × 5 km', pines: 'Rừng thông 4,5 × 4,5 km', metro: 'Đô thị 3 × 3 km', range: 'Trường bắn' };
const NAME_KEY = 'lastlight.name.v1';

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));

/** The "play with friends" screen: pick a name, create or join a room by code, see who is in, start. */
export class LobbyView {
  private readonly root: HTMLElement;
  private model: LobbyModel | null = null;

  constructor(parent: HTMLElement, private readonly callbacks: LobbyCallbacks) {
    this.root = document.createElement('section');
    this.root.id = 'lobby-screen';
    this.root.className = 'overlay-screen lobby-screen';
    this.root.hidden = true;
    this.root.setAttribute('aria-labelledby', 'lobby-title');
    this.root.innerHTML = `
      <div class="dialog lobby-dialog">
        <div class="eyebrow"><span class="orange-dash"></span>CHƠI CÙNG BẠN BÈ</div>
        <h2 id="lobby-title">PHÒNG CHƠI</h2>
        <label class="mp-field"><span>TÊN CỦA BẠN</span><input id="mp-name" type="text" maxlength="16" autocomplete="nickname" spellcheck="false" placeholder="Tên hiển thị"></label>
        <div id="mp-entry" class="mp-entry">
          <button id="mp-create" class="button button-primary" type="button">TẠO PHÒNG MỚI</button>
          <div class="mp-or">hoặc vào phòng của bạn bè</div>
          <label id="mp-mode-field" class="mp-field"><span>KẾT NỐI VÀO PHÒNG</span><select id="mp-mode" aria-label="Phương thức kết nối"><option value="p2p">P2P · Trực tiếp</option><option value="turn">TURN · Chuyển tiếp</option></select><small id="mp-mode-hint">Kết nối trực tiếp, tiết kiệm dung lượng TURN. Nếu không vào được, hãy chọn TURN.</small></label>
          <div class="mp-join"><input id="mp-code" type="text" maxlength="9" autocomplete="off" spellcheck="false" placeholder="MÃ PHÒNG" aria-label="Mã phòng"><button id="mp-join" class="button button-secondary" type="button">VÀO PHÒNG</button></div>
        </div>
        <div id="mp-room" class="mp-room" hidden>
          <div class="mp-code-row"><div><small>MÃ PHÒNG</small><strong id="mp-room-code">-----</strong></div><button id="mp-copy" class="button button-secondary" type="button">SAO CHÉP LINK</button></div>
          <div id="mp-config" class="mp-config"></div>
          <ul id="mp-players" class="mp-players" aria-label="Người trong phòng"></ul>
          <label id="mp-drop-field" class="mp-field" hidden><span>NGƯỜI DẪN NHẢY DÙ</span><select id="mp-drop-leader" aria-label="Người dẫn nhảy dù"></select><small>Cả đội bám theo người dẫn; có thể tách ra khi đang bay.</small></label>
          <div id="mp-invite" class="mp-invite" hidden><h4>MỜI BẠN BÈ ĐANG ONLINE</h4><ul id="mp-invite-list"></ul></div>
          <button id="mp-start" class="button button-primary" type="button">BẮT ĐẦU TRẬN</button>
          <div id="mp-wait" class="mp-wait" hidden>Đang chờ chủ phòng bắt đầu…</div>
        </div>
        <div id="mp-status" class="mp-status" role="status"></div>
        <div id="mp-error" class="mp-error" role="alert" hidden></div>
        <div class="mp-foot"><button id="mp-leave" class="text-button" type="button">QUAY LẠI</button></div>
        <small class="mp-note">Chủ phòng chạy trận cho cả nhóm: hãy để tab game ở phía trước và mạng ổn định. Tối đa 6 người chơi cùng bot.</small>
      </div>`;
    parent.appendChild(this.root);
    const stored = (() => { try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; } })();
    this.input('mp-name').value = stored || `Người chơi ${Math.floor(100 + Math.random() * 900)}`;
    this.input('mp-code').addEventListener('input', () => { const box = this.input('mp-code'); box.value = box.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5); });
    this.input('mp-code').addEventListener('keydown', event => { if (event.key === 'Enter') this.join(); });
    this.el('mp-create').addEventListener('click', () => callbacks.onCreate(this.name()));
    this.el('mp-join').addEventListener('click', () => this.join());
    this.el('mp-mode').addEventListener('change', () => {
      this.el('mp-mode-hint').textContent = this.connectionMode() === 'turn'
        ? 'Dùng máy chủ TURN để vượt mạng hạn chế. Tiêu thụ dung lượng TURN của phòng.'
        : 'Kết nối trực tiếp, tiết kiệm dung lượng TURN. Nếu không vào được, hãy chọn TURN.';
    });
    this.el('mp-start').addEventListener('click', () => callbacks.onStart());
    this.el('mp-drop-leader').addEventListener('change', () => callbacks.onDropLeader?.((this.el('mp-drop-leader') as HTMLSelectElement).value));
    this.el('mp-copy').addEventListener('click', () => this.copyLink());
    this.el('mp-invite-list').addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-friend]');
      if (button) { callbacks.onInvite?.(button.dataset.friend!); button.disabled = true; button.textContent = 'ĐÃ MỜI'; }
    });
    this.el('mp-leave').addEventListener('click', () => {
      // In a room: leave it (the entry form comes back). Otherwise (entry form or an error): close the screen.
      const inRoom = !!this.model?.phase && this.model.phase !== 'error' && this.model.phase !== 'closed';
      callbacks.onLeave();
      if (!inRoom) callbacks.onClose();
    });
  }

  private el(id: string): HTMLElement { return this.root.querySelector<HTMLElement>(`#${id}`)!; }
  private input(id: string): HTMLInputElement { return this.el(id) as HTMLInputElement; }

  /** Signed-in players play under their account name: show it and stop the box being edited. */
  setLockedName(name: string | null): void {
    const box = this.input('mp-name');
    box.disabled = name !== null;
    if (name !== null) box.value = name;
  }

  /** The name to play under: trimmed, with a fallback, and remembered for next time. */
  name(): string {
    const name = this.input('mp-name').value.trim().slice(0, 16) || 'Người chơi';
    if (!this.input('mp-name').disabled) { try { localStorage.setItem(NAME_KEY, name); } catch { /* private browsing */ } }
    return name;
  }

  connectionMode(): ConnectionMode { return (this.el('mp-mode') as HTMLSelectElement).value === 'turn' ? 'turn' : 'p2p'; }
  private join(): void { this.callbacks.onJoin(this.input('mp-code').value, this.name(), this.connectionMode()); }

  show(open: boolean): void {
    this.root.hidden = !open;
    if (open) (this.model?.phase ? this.el('mp-leave') : this.input('mp-name')).focus({ preventScroll: true });
  }
  get open(): boolean { return !this.root.hidden; }

  prefillCode(code: string): void { this.input('mp-code').value = code; }

  private async copyLink(): Promise<void> {
    if (!this.model) return;
    const url = `${location.origin}${location.pathname}?room=${this.model.code}`;
    try { await navigator.clipboard.writeText(url); this.el('mp-copy').textContent = 'ĐÃ SAO CHÉP'; }
    catch { this.el('mp-copy').textContent = url; }
    setTimeout(() => { this.el('mp-copy').textContent = 'SAO CHÉP LINK'; }, 2500);
  }

  /** Redraw from the model. */
  render(model: LobbyModel): void {
    this.model = model;
    const inRoom = model.phase !== null && model.phase !== 'error' && model.phase !== 'closed';
    this.el('mp-entry').hidden = inRoom;
    this.el('mp-room').hidden = !inRoom;
    this.el('lobby-title').textContent = inRoom ? 'ĐANG CHỜ BẠN BÈ' : 'PHÒNG CHƠI';
    this.el('mp-room-code').textContent = model.code || '-----';
    this.el('mp-config').textContent = `${MAP_NAMES[model.config.map]} · ${model.config.botCount} bot · ${model.config.difficulty === 'easy' ? 'Dễ' : 'Tiêu chuẩn'}${model.isHost ? ' (đổi ở màn hình chính)' : ''}`;
    this.el('mp-drop-field').hidden = !inRoom || model.config.map === 'arena' || model.config.map === 'range';
    const leaderSelect = this.el('mp-drop-leader') as HTMLSelectElement;
    const options = '<option value="">Mỗi người tự nhảy</option>' + model.players.map(player => `<option value="${escapeHtml(player.id)}">${escapeHtml(player.name)}${player.id === model.me ? ' (bạn)' : ''}</option>`).join('');
    if (leaderSelect.innerHTML !== options) leaderSelect.innerHTML = options;
    leaderSelect.value = model.dropLeader ?? '';
    leaderSelect.disabled = !model.isHost || model.phase !== 'waiting';
    this.el('mp-players').innerHTML = model.players.map((player, index) => {
      const link = model.connections?.find(link => link.id === player.id);
      const state = link ? link.state === 'failed' ? 'MẤT KẾT NỐI' : link.state !== 'open' ? 'ĐANG KẾT NỐI' :
        `${link.route === 'relay' ? 'QUA TURN' : link.route === 'direct' ? 'TRỰC TIẾP' : 'ĐÃ KẾT NỐI'}` : '';
      const connection = state || (model.connectionReady === false && player.id !== model.me && (model.isHost || index === 0) ? 'ĐANG KẾT NỐI' : '');
      return `<li class="${player.id === model.me ? 'me' : ''}"><b>${escapeHtml(player.name)}</b>${player.uid && model.friendIds.includes(player.uid) ? '<u>BẠN BÈ</u>' : ''}${index === 0 ? '<em>CHỦ PHÒNG</em>' : ''}${player.id === model.me ? '<i>BẠN</i>' : ''}${connection ? `<small class="mp-connection">${link ? signalMarkup(link) : signalMarkup({ state: 'connecting', rttMs: null, route: 'unknown' })}<span>${connection}</span></small>` : ''}</li>`;
    }).join('');
    const invitable = model.invitable.filter(friend => !model.players.some(player => player.uid === friend.id));
    this.el('mp-invite').hidden = !inRoom || invitable.length === 0;
    this.el('mp-invite-list').innerHTML = invitable.map(friend => `<li><span>${escapeHtml(friend.name)}</span><button type="button" data-friend="${escapeHtml(friend.id)}">MỜI</button></li>`).join('');
    (this.el('mp-start') as HTMLButtonElement).hidden = !model.isHost;
    (this.el('mp-start') as HTMLButtonElement).disabled = model.phase !== 'waiting' || model.connectionReady === false;
    this.el('mp-start').textContent = model.players.length > 1 ? `BẮT ĐẦU TRẬN · ${model.players.length} NGƯỜI` : 'BẮT ĐẦU (CHỈ MỘT NGƯỜI)';
    this.el('mp-wait').hidden = model.isHost || !inRoom;
    this.el('mp-status').textContent = model.status;
    const error = this.el('mp-error');
    error.hidden = !model.error;
    error.textContent = model.error;
    this.el('mp-leave').textContent = inRoom ? 'RỜI PHÒNG' : 'QUAY LẠI';
    (this.el('mp-create') as HTMLButtonElement).disabled = model.phase === 'connecting' || model.phase === 'joining';
    (this.el('mp-join') as HTMLButtonElement).disabled = model.phase === 'connecting' || model.phase === 'joining';
  }
}
