import type { FriendEdge, Person } from './social/api';
import type { SocialStore } from './social/store';

export interface AccountCallbacks {
  /** Go to a friend's room (the view closes itself first). */
  onJoinRoom(room: string): void;
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
type Tab = 'friends' | 'search' | 'board';

/**
 * The account window: sign in or register, then friends, finding people and the leaderboard. Also the banner that
 * offers a room when a friend invites you. All state lives in the `SocialStore`.
 */
export class AccountView {
  private readonly root: HTMLElement;
  private readonly banner: HTMLElement;
  private mode: 'login' | 'register' = 'login';
  private tab: Tab = 'friends';
  /** What the window is currently built for; the skeleton is only rebuilt when this changes, so typing is never wiped. */
  private shape = '';
  private lastQuery = '';

  constructor(parent: HTMLElement, private readonly store: SocialStore, private readonly callbacks: AccountCallbacks) {
    this.root = document.createElement('section');
    this.root.id = 'account-screen';
    this.root.className = 'overlay-screen account-screen';
    this.root.hidden = true;
    this.root.setAttribute('aria-labelledby', 'acc-title');
    this.root.innerHTML = '<div class="dialog account-dialog"><button id="acc-close" class="acc-close" type="button" aria-label="Đóng">×</button><div id="acc-body"></div></div>';
    parent.appendChild(this.root);
    this.banner = document.createElement('div');
    this.banner.id = 'invite-banner';
    this.banner.className = 'invite-banner';
    this.banner.hidden = true;
    parent.appendChild(this.banner);
    this.root.addEventListener('click', event => this.click(event));
    this.root.addEventListener('keydown', event => { if (event.key === 'Enter' && (event.target as HTMLElement).tagName === 'INPUT') { event.preventDefault(); this.submit(); } });
    this.banner.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
      if (!button) return;
      const from = button.dataset.from!;
      if (button.dataset.act === 'join-invite') { const invite = this.store.state.invites.find(i => i.from === from); this.store.dismissInvite(from); if (invite) { this.show(false); this.callbacks.onJoinRoom(invite.room); } }
      else this.store.dismissInvite(from);
    });
    store.onChange(() => this.render());
    this.render();
  }

  private $<T extends HTMLElement = HTMLElement>(id: string): T | null { return this.root.querySelector<T>(`#${id}`); }

  show(open: boolean): void {
    this.root.hidden = !open;
    if (open) { this.render(); void this.store.refresh(); if (this.tab === 'board') void this.store.loadLeaderboard(); }
  }
  get open(): boolean { return !this.root.hidden; }

  private click(event: Event): void {
    const target = event.target as HTMLElement;
    if (target === this.root || target.closest('#acc-close')) { this.show(false); return; }
    const button = target.closest<HTMLButtonElement>('[data-act]');
    if (!button) return;
    const act = button.dataset.act!, id = button.dataset.id ?? '';
    const edge = () => this.store.state.edges.find(e => String(e.id) === id);
    const person = () => this.store.state.results.find(p => p.id === id) ?? this.store.state.edges.find(e => e.person.id === id)?.person;
    switch (act) {
      case 'mode-login': this.mode = 'login'; this.render(); break;
      case 'mode-register': this.mode = 'register'; this.render(); break;
      case 'submit': this.submit(); break;
      case 'logout': void this.store.logout(); break;
      case 'tab-friends': case 'tab-search': case 'tab-board':
        this.tab = act.slice(4) as Tab; this.render(); if (this.tab === 'board') void this.store.loadLeaderboard(); break;
      case 'search': void this.runSearch(); break;
      case 'add': { const p = person(); if (p) void this.store.addFriend(p); break; }
      case 'accept': { const e = edge(); if (e) void this.store.accept(e); break; }
      case 'remove': { const e = edge(); if (e) void this.store.remove(e); break; }
      case 'invite': { const p = person(); if (p) this.store.invite(p); break; }
      case 'join': { const room = button.dataset.room; if (room) { this.show(false); this.callbacks.onJoinRoom(room); } break; }
    }
  }

  private value(id: string): string { return this.$<HTMLInputElement>(id)?.value ?? ''; }

  private submit(): void {
    if (this.store.signedIn) { if (this.tab === 'search') void this.runSearch(); return; }
    if (this.mode === 'login') void this.store.login(this.value('acc-email'), this.value('acc-password'));
    else void this.store.register(this.value('acc-username'), this.value('acc-email'), this.value('acc-password'));
  }

  private async runSearch(): Promise<void> {
    this.lastQuery = this.value('acc-query');
    await this.store.search(this.lastQuery);
  }

  /** Redraw from the store. */
  render(): void {
    this.renderBanner();
    if (this.root.hidden) return;
    const state = this.store.state;
    const kind = state.readiness === 'no-tables' ? 'setup' : state.readiness === 'offline' ? 'offline' : state.account ? `in:${this.tab}` : `out:${this.mode}`;
    if (kind !== this.shape) { this.shape = kind; this.build(kind); }
    this.fill(kind);
  }

  private build(kind: string): void {
    const body = this.$('acc-body')!;
    if (kind === 'setup') {
      body.innerHTML = `<div class="eyebrow"><span class="orange-dash"></span>TÀI KHOẢN</div><h2 id="acc-title">CHƯA BẬT TÀI KHOẢN</h2>
        <p class="acc-note">Máy chủ trò chơi chưa có bảng dữ liệu cho tài khoản và bạn bè. Người quản trị chỉ cần dán tệp <code>supabase/setup.sql</code> vào <b>Supabase → SQL Editor</b> rồi bấm Run một lần. Chơi online bằng mã phòng vẫn dùng được.</p>`;
      return;
    }
    if (kind === 'offline') {
      body.innerHTML = '<div class="eyebrow"><span class="orange-dash"></span>TÀI KHOẢN</div><h2 id="acc-title">KHÔNG CÓ MẠNG</h2><p class="acc-note">Không kết nối được máy chủ tài khoản. Hãy kiểm tra mạng rồi mở lại.</p>';
      return;
    }
    if (!this.store.state.account) {
      const register = this.mode === 'register';
      body.innerHTML = `<div class="eyebrow"><span class="orange-dash"></span>TÀI KHOẢN</div><h2 id="acc-title">${register ? 'TẠO TÀI KHOẢN' : 'ĐĂNG NHẬP'}</h2>
        <div class="acc-tabs"><button type="button" data-act="mode-login" class="${register ? '' : 'on'}">ĐĂNG NHẬP</button><button type="button" data-act="mode-register" class="${register ? 'on' : ''}">ĐĂNG KÝ</button></div>
        ${register ? '<label class="acc-field"><span>TÊN NGƯỜI CHƠI</span><input id="acc-username" type="text" maxlength="16" autocomplete="username" spellcheck="false" placeholder="3–16 ký tự: chữ, số, _"></label>' : ''}
        <label class="acc-field"><span>EMAIL</span><input id="acc-email" type="email" autocomplete="email" spellcheck="false" placeholder="ban@vi-du.com"></label>
        <label class="acc-field"><span>MẬT KHẨU</span><input id="acc-password" type="password" autocomplete="${register ? 'new-password' : 'current-password'}" placeholder="Ít nhất 6 ký tự"></label>
        <button id="acc-submit" class="button button-primary" type="button" data-act="submit">${register ? 'TẠO TÀI KHOẢN' : 'ĐĂNG NHẬP'}</button>
        <div id="acc-msg" class="acc-msg" role="status" hidden></div>
        <small class="acc-note">${register ? 'Bạn sẽ có thể kết bạn, mời bạn vào phòng và lưu thành tích. Có thể phải xác nhận email trước khi đăng nhập.' : 'Chưa cần tài khoản để chơi: tài khoản chỉ để kết bạn và lưu thành tích.'}</small>`;
      return;
    }
    body.innerHTML = `<div class="eyebrow"><span class="orange-dash"></span>TÀI KHOẢN</div>
      <div class="acc-head"><div><h2 id="acc-title"></h2><small id="acc-email-line"></small></div><button class="text-button" type="button" data-act="logout">ĐĂNG XUẤT</button></div>
      <dl id="acc-stats" class="acc-stats"></dl>
      <div class="acc-tabs"><button type="button" data-act="tab-friends" class="${this.tab === 'friends' ? 'on' : ''}">BẠN BÈ <em id="acc-badge" hidden></em></button><button type="button" data-act="tab-search" class="${this.tab === 'search' ? 'on' : ''}">TÌM NGƯỜI</button><button type="button" data-act="tab-board" class="${this.tab === 'board' ? 'on' : ''}">XẾP HẠNG</button></div>
      ${this.tab === 'search' ? '<div class="acc-search"><input id="acc-query" type="text" maxlength="16" autocomplete="off" spellcheck="false" placeholder="Nhập tên người chơi"><button class="button button-secondary" type="button" data-act="search">TÌM</button></div>' : ''}
      <div id="acc-list" class="acc-list"></div>
      <div id="acc-msg" class="acc-msg" role="status" hidden></div>`;
    if (this.tab === 'search') { const box = this.$<HTMLInputElement>('acc-query'); if (box) box.value = this.lastQuery; }
  }

  private fill(kind: string): void {
    const state = this.store.state;
    const message = this.$('acc-msg');
    if (message) {
      message.hidden = !state.message;
      message.textContent = state.message?.text ?? '';
      message.classList.toggle('ok', !!state.message?.ok);
    }
    for (const id of ['acc-submit']) { const button = this.$<HTMLButtonElement>(id); if (button) button.disabled = state.busy; }
    if (!kind.startsWith('in:')) return;
    const profile = state.profile;
    this.$('acc-title')!.textContent = (this.store.displayName ?? '').toUpperCase();
    this.$('acc-email-line')!.textContent = state.account?.email ?? '';
    this.$('acc-stats')!.innerHTML = profile
      ? [['TRẬN', profile.matches], ['THẮNG', profile.wins], ['HẠ GỤC', profile.kills], ['HẠNG TỐT NHẤT', profile.bestRank ? `#${profile.bestRank}` : '–']].map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')
      : '';
    const incoming = this.store.incoming.length;
    const badge = this.$('acc-badge');
    if (badge) { badge.hidden = incoming === 0; badge.textContent = String(incoming); }
    const list = this.$('acc-list')!;
    list.innerHTML = this.tab === 'friends' ? this.friendsHtml() : this.tab === 'search' ? this.searchHtml(state.results) : this.boardHtml(state.leaderboard);
  }

  private friendsHtml(): string {
    const store = this.store;
    const row = (edge: FriendEdge, actions: string, sub = '') => `<li><div class="acc-who"><b>${escapeHtml(edge.person.username)}</b>${sub}</div><div class="acc-actions">${actions}</div></li>`;
    const parts: string[] = [];
    if (store.incoming.length) parts.push(`<h3>LỜI MỜI KẾT BẠN</h3><ul>${store.incoming.map(e => row(e, `<button class="button button-primary" type="button" data-act="accept" data-id="${e.id}">CHẤP NHẬN</button><button class="text-button" type="button" data-act="remove" data-id="${e.id}">TỪ CHỐI</button>`)).join('')}</ul>`);
    const friends = store.friends;
    const online = (e: FriendEdge) => store.state.online[e.person.id];
    const ordered = [...friends].sort((a, b) => Number(!!online(b)) - Number(!!online(a)) || a.person.username.localeCompare(b.person.username));
    parts.push(`<h3>BẠN BÈ · ${store.onlineFriends().length}/${friends.length} ĐANG ONLINE</h3>`);
    parts.push(ordered.length ? `<ul>${ordered.map(e => {
      const info = online(e);
      const status = info ? (info.room ? `<span class="dot on"></span>Đang trong phòng <b>${escapeHtml(info.room)}</b>` : '<span class="dot on"></span>Đang online') : '<span class="dot"></span>Ngoại tuyến';
      const actions = [
        info?.room ? `<button class="button button-primary" type="button" data-act="join" data-room="${escapeHtml(info.room)}">THAM GIA</button>` : '',
        info && !info.room ? `<button class="button button-secondary" type="button" data-act="invite" data-id="${e.person.id}">MỜI</button>` : '',
        `<button class="text-button" type="button" data-act="remove" data-id="${e.id}" title="Xóa bạn">XÓA</button>`,
      ].join('');
      return row(e, actions, `<small>${status} · ${e.person.wins} thắng</small>`);
    }).join('')}</ul>` : '<p class="acc-empty">Chưa có bạn bè. Qua tab <b>TÌM NGƯỜI</b> để kết bạn.</p>');
    if (store.outgoing.length) parts.push(`<h3>ĐÃ GỬI LỜI MỜI</h3><ul>${store.outgoing.map(e => row(e, `<button class="text-button" type="button" data-act="remove" data-id="${e.id}">HỦY</button>`, '<small>Đang chờ trả lời</small>')).join('')}</ul>`);
    return parts.join('');
  }

  private searchHtml(results: Person[]): string {
    if (!results.length) return '<p class="acc-empty">Nhập ít nhất 2 ký tự của tên người chơi rồi bấm TÌM.</p>';
    const store = this.store;
    return `<ul>${results.map(p => {
      const edge = store.state.edges.find(e => e.person.id === p.id);
      const action = edge ? `<span class="acc-tag">${edge.status === 'accepted' ? 'ĐÃ LÀ BẠN' : edge.status === 'incoming' ? 'ĐANG CHỜ BẠN' : 'ĐÃ GỬI'}</span>` : `<button class="button button-secondary" type="button" data-act="add" data-id="${p.id}">KẾT BẠN</button>`;
      return `<li><div class="acc-who"><b>${escapeHtml(p.username)}</b><small>${p.wins} thắng · ${p.kills} hạ gục</small></div><div class="acc-actions">${action}</div></li>`;
    }).join('')}</ul>`;
  }

  private boardHtml(people: Person[]): string {
    if (!people.length) return '<p class="acc-empty">Chưa có ai trên bảng xếp hạng. Chơi một trận khi đã đăng nhập để ghi tên mình.</p>';
    const me = this.store.state.account?.id;
    return `<ol class="acc-board">${people.map(p => `<li class="${p.id === me ? 'me' : ''}"><b>${escapeHtml(p.username)}</b><span>${p.wins} thắng</span><span>${p.kills} hạ gục</span><span>${p.matches} trận</span></li>`).join('')}</ol>`;
  }

  private renderBanner(): void {
    const invites = this.store.state.invites;
    this.banner.hidden = invites.length === 0;
    if (!invites.length) return;
    const invite = invites[invites.length - 1];
    this.banner.innerHTML = `<span><b>${escapeHtml(invite.name)}</b> mời bạn vào phòng <b>${escapeHtml(invite.room)}</b></span><button class="button button-primary" type="button" data-act="join-invite" data-from="${escapeHtml(invite.from)}">THAM GIA</button><button class="text-button" type="button" data-act="dismiss-invite" data-from="${escapeHtml(invite.from)}">BỎ QUA</button>`;
  }
}
