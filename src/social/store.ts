/**
 * The player's social state in one place: who is signed in, the friend list, who is online and where, invites that came
 * in, and the leaderboard. The screens only read from here and call its methods; it talks to a `SocialApi`.
 */
import { friendlyError } from './api';
import type { Account, FriendEdge, Invite, Person, PresenceHandle, PresenceInfo, Readiness, SocialApi } from './api';

export interface SocialState {
  /** `unknown` until the first check finishes. */
  readiness: Readiness | 'unknown';
  account: Account | null;
  profile: Person | null;
  edges: FriendEdge[];
  online: Record<string, PresenceInfo>;
  invites: Invite[];
  leaderboard: Person[];
  results: Person[];
  busy: boolean;
  /** The latest thing to tell the player: an error, or good news (`ok`). */
  message: { text: string; ok: boolean } | null;
}

const USERNAME = /^[A-Za-z0-9_]{3,16}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class SocialStore {
  state: SocialState = { readiness: 'unknown', account: null, profile: null, edges: [], online: {}, invites: [], leaderboard: [], results: [], busy: false, message: null };
  private handlers: Array<() => void> = [];
  private presence: PresenceHandle | null = null;
  private room: string | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private reported = false;

  constructor(private readonly api: SocialApi) {}

  onChange(handler: () => void): void { this.handlers.push(handler); }
  private emit(): void { for (const handler of this.handlers) handler(); }
  private set(patch: Partial<SocialState>): void { this.state = { ...this.state, ...patch }; this.emit(); }
  private say(text: string, ok = false): void { this.set({ message: { text, ok } }); }

  /** Check the server and pick up a saved session. Call once at start. */
  async start(): Promise<void> {
    const readiness = await this.api.ready();
    this.set({ readiness });
    this.api.onAuthChange(account => { void this.accountChanged(account); });
    if (readiness === 'offline') return;
    const account = await this.api.currentAccount().catch(() => null);
    if (account) await this.accountChanged(account);
  }

  get signedIn(): boolean { return this.state.account !== null; }
  /** The name to play under: the account's username (from the profile once loaded). */
  get displayName(): string | null { return this.state.profile?.username ?? this.state.account?.username ?? null; }
  get friends(): FriendEdge[] { return this.state.edges.filter(edge => edge.status === 'accepted'); }
  get incoming(): FriendEdge[] { return this.state.edges.filter(edge => edge.status === 'incoming'); }
  get outgoing(): FriendEdge[] { return this.state.edges.filter(edge => edge.status === 'outgoing'); }
  isFriend(userId: string | undefined): boolean { return !!userId && this.friends.some(edge => edge.person.id === userId); }
  /** Friends who are online right now, with where they are. */
  onlineFriends(): Array<{ edge: FriendEdge; info: PresenceInfo }> {
    return this.friends.flatMap(edge => { const info = this.state.online[edge.person.id]; return info ? [{ edge, info }] : []; });
  }

  private async accountChanged(account: Account | null): Promise<void> {
    if (account?.id === this.state.account?.id) return;
    this.presence?.leave(); this.presence = null;
    if (this.refreshTimer) { clearInterval(this.refreshTimer); this.refreshTimer = null; }
    if (!account) { this.set({ account: null, profile: null, edges: [], online: {}, invites: [], results: [], message: null }); return; }
    this.set({ account });
    this.presence = this.api.joinPresence({ id: account.id, username: account.username }, {
      onPresence: online => this.set({ online }),
      onInvite: invite => { if (this.isFriend(invite.from) || !this.state.edges.length) this.set({ invites: [...this.state.invites.filter(i => i.from !== invite.from), invite] }); },
      onNudge: () => { void this.refresh(); },
    });
    this.presence.setRoom(this.room);
    await this.refresh();
    this.refreshTimer = setInterval(() => { void this.refresh(); }, 30000);
    // Do not keep a Node process (the tests) alive just for this timer.
    (this.refreshTimer as unknown as { unref?: () => void }).unref?.();
  }

  /** Reload the profile and friend list. */
  async refresh(): Promise<void> {
    if (!this.state.account) return;
    try {
      const [profile, edges] = await Promise.all([this.api.myProfile(), this.api.friends()]);
      this.set({ profile, edges });
    } catch (error) { this.say(friendlyError(error).message); }
  }

  private async run(action: () => Promise<void>): Promise<boolean> {
    this.set({ busy: true, message: null });
    try { await action(); return true; }
    catch (error) { this.say(friendlyError(error).message); return false; }
    finally { this.set({ busy: false }); }
  }

  /** Create an account. Returns true when the player can carry on (signed in, or told to confirm their email). */
  async register(username: string, email: string, password: string): Promise<boolean> {
    username = username.trim(); email = email.trim();
    if (!USERNAME.test(username)) { this.say('Tên người chơi gồm 3–16 ký tự: chữ, số và dấu gạch dưới.'); return false; }
    if (!EMAIL.test(email)) { this.say('Email không hợp lệ.'); return false; }
    if (password.length < 6) { this.say('Mật khẩu cần ít nhất 6 ký tự.'); return false; }
    return this.run(async () => {
      if (!await this.api.usernameAvailable(username)) throw new Error('Tên này đã có người dùng. Hãy chọn tên khác.');
      const { needsConfirmation } = await this.api.signUp(username, email, password);
      if (needsConfirmation) this.say(`Đã gửi thư xác nhận tới ${email}. Bấm vào liên kết trong thư, rồi quay lại đây để đăng nhập.`, true);
      else this.say('Đã tạo tài khoản. Chào mừng!', true);
    });
  }

  async login(email: string, password: string): Promise<boolean> {
    if (!EMAIL.test(email.trim())) { this.say('Email không hợp lệ.'); return false; }
    if (!password) { this.say('Nhập mật khẩu.'); return false; }
    return this.run(async () => { await this.api.signIn(email.trim(), password); });
  }

  async logout(): Promise<void> {
    await this.run(async () => { await this.api.signOut(); });
    await this.accountChanged(null);
  }

  async search(prefix: string): Promise<void> {
    await this.run(async () => {
      const results = await this.api.search(prefix);
      this.set({ results });
      if (!results.length && prefix.trim().length >= 2) this.say('Không tìm thấy ai với tên đó.');
    });
  }

  async addFriend(person: Person): Promise<void> {
    await this.run(async () => {
      const outcome = await this.api.request(person.id);
      this.presence?.nudge(person.id);
      await this.refresh();
      this.say(outcome === 'accepted' ? `Bạn và ${person.username} đã là bạn bè!` : `Đã gửi lời mời kết bạn tới ${person.username}.`, true);
    });
  }

  async accept(edge: FriendEdge): Promise<void> {
    await this.run(async () => {
      await this.api.accept(edge.id);
      this.presence?.nudge(edge.person.id);
      await this.refresh();
      this.say(`Bạn và ${edge.person.username} đã là bạn bè!`, true);
    });
  }

  /** Decline a request, cancel your own, or end a friendship. */
  async remove(edge: FriendEdge): Promise<void> {
    await this.run(async () => {
      await this.api.remove(edge.id);
      this.presence?.nudge(edge.person.id);
      await this.refresh();
    });
  }

  async loadLeaderboard(): Promise<void> {
    await this.run(async () => { this.set({ leaderboard: await this.api.leaderboard() }); });
  }

  /** Tell friends which room you are in (or null when you are not in one). */
  setRoom(room: string | null): void { this.room = room; this.presence?.setRoom(room); }

  invite(friend: Person): void {
    if (!this.room) { this.say('Hãy tạo hoặc vào một phòng trước khi mời bạn.'); return; }
    this.presence?.invite(friend.id, this.room);
    this.say(`Đã mời ${friend.username} vào phòng ${this.room}.`, true);
  }

  dismissInvite(from: string): void { this.set({ invites: this.state.invites.filter(invite => invite.from !== from) }); }

  /** Add a finished match to the player's record, once per match. */
  async reportMatch(won: boolean, kills: number, rank: number): Promise<void> {
    if (!this.state.account || this.reported) return;
    this.reported = true;
    try { await this.api.recordMatch(won, kills, rank); await this.refresh(); } catch { /* the record is a nicety: never get in the way of the game */ }
  }
  /** A new match is starting: its result may be reported again. */
  newMatch(): void { this.reported = false; }
}
