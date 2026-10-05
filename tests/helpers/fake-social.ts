/**
 * An in-memory stand-in for the Supabase project, faithful to the rules in supabase/setup.sql (which sql.test.ts proves
 * on a real Postgres): accounts with unique usernames, friend requests that only the addressee can accept, a
 * leaderboard, presence and invites between several signed-in "browsers".
 */
import { SocialError } from '../../src/social/api.ts';
import type { Account, FriendEdge, Invite, Person, PresenceHandle, PresenceHandlers, PresenceInfo, Readiness, SocialApi } from '../../src/social/api.ts';

interface User { id: string; email: string; password: string; username: string; confirmed: boolean; matches: number; wins: number; kills: number; bestRank: number | null }
interface Edge { id: number; requester: string; addressee: string; status: 'pending' | 'accepted' }

export class FakeSocialServer {
  users: User[] = [];
  edges: Edge[] = [];
  /** Turn off to simulate a project without the SQL applied. */
  tables = true;
  /** Turn on to make new accounts need an email confirmation (the default for a fresh Supabase project). */
  confirmEmail = false;
  online = new Map<string, { info: PresenceInfo; handlers: PresenceHandlers }>();
  private nextEdge = 1;
  private nextUser = 1;
  failNext: string | null = null;

  /** One browser talking to the server. */
  client(): FakeSocialApi { return new FakeSocialApi(this); }

  confirm(email: string): void { const user = this.users.find(u => u.email === email); if (user) user.confirmed = true; }
  person(user: User): Person { return { id: user.id, username: user.username, matches: user.matches, wins: user.wins, kills: user.kills, bestRank: user.bestRank }; }

  /** @internal */
  addUser(username: string, email: string, password: string): User {
    const user: User = { id: `u${this.nextUser++}`, email, password, username, confirmed: !this.confirmEmail, matches: 0, wins: 0, kills: 0, bestRank: null };
    this.users.push(user);
    return user;
  }
  /** @internal */
  newEdge(requester: string, addressee: string): Edge { const edge: Edge = { id: this.nextEdge++, requester, addressee, status: 'pending' }; this.edges.push(edge); return edge; }
}

export class FakeSocialApi implements SocialApi {
  private me: User | null = null;
  private authHandlers: Array<(account: Account | null) => void> = [];
  constructor(private readonly server: FakeSocialServer) {}

  private maybeFail(): void { if (this.server.failNext) { const message = this.server.failNext; this.server.failNext = null; throw new SocialError(message); } }
  private account(user: User | null): Account | null { return user ? { id: user.id, email: user.email, username: user.username } : null; }
  private need(): User { if (!this.me) throw new SocialError('Hãy đăng nhập trước.'); return this.me; }

  async ready(): Promise<Readiness> { return this.server.tables ? 'ok' : 'no-tables'; }
  async currentAccount() { return this.account(this.me); }
  onAuthChange(handler: (account: Account | null) => void) { this.authHandlers.push(handler); }
  private signedAs(user: User | null) { this.me = user; for (const handler of this.authHandlers) handler(this.account(user)); }

  async usernameAvailable(name: string) { this.maybeFail(); return /^[A-Za-z0-9_]{3,16}$/.test(name) && !this.server.users.some(u => u.username.toLowerCase() === name.toLowerCase()); }
  async signUp(username: string, email: string, password: string) {
    this.maybeFail();
    if (this.server.users.some(u => u.email === email)) throw new SocialError('Email này đã được đăng ký. Hãy đăng nhập.');
    if (password.length < 6) throw new SocialError('Mật khẩu cần ít nhất 6 ký tự.');
    const user = this.server.addUser(username, email, password);
    if (user.confirmed) { this.signedAs(user); return { needsConfirmation: false }; }
    return { needsConfirmation: true };
  }
  async signIn(email: string, password: string) {
    this.maybeFail();
    const user = this.server.users.find(u => u.email === email);
    if (!user || user.password !== password) throw new SocialError('Sai email hoặc mật khẩu.');
    if (!user.confirmed) throw new SocialError('Email chưa được xác nhận. Mở thư xác nhận rồi đăng nhập lại.');
    this.signedAs(user);
  }
  async signOut() { this.signedAs(null); }
  async myProfile() { return this.me ? this.server.person(this.me) : null; }

  async friends(): Promise<FriendEdge[]> {
    const me = this.need();
    return this.server.edges.filter(e => e.requester === me.id || e.addressee === me.id).map(e => {
      const other = this.server.users.find(u => u.id === (e.requester === me.id ? e.addressee : e.requester))!;
      return { id: e.id, person: this.server.person(other), status: e.status === 'accepted' ? 'accepted' as const : e.requester === me.id ? 'outgoing' as const : 'incoming' as const };
    });
  }
  async search(prefix: string) {
    const me = this.need();
    const clean = prefix.trim();
    if (clean.length < 1) return [];
    return this.server.users.filter(u => u.id !== me.id && u.username.toLowerCase().startsWith(clean.toLowerCase())).slice(0, 12).map(u => this.server.person(u));
  }
  async request(userId: string): Promise<'sent' | 'accepted'> {
    this.maybeFail();
    const me = this.need();
    const existing = this.server.edges.find(e => (e.requester === me.id && e.addressee === userId) || (e.requester === userId && e.addressee === me.id));
    if (existing) {
      if (existing.requester === userId && existing.status === 'pending') { existing.status = 'accepted'; return 'accepted'; }
      throw new SocialError(existing.status === 'accepted' ? 'Hai bạn đã là bạn bè.' : 'Bạn đã gửi lời mời rồi.');
    }
    this.server.newEdge(me.id, userId);
    return 'sent';
  }
  async accept(edgeId: number) {
    const me = this.need();
    const edge = this.server.edges.find(e => e.id === edgeId);
    if (!edge || edge.addressee !== me.id || edge.status !== 'pending') throw new SocialError('Lời mời không còn nữa.');
    edge.status = 'accepted';
  }
  async remove(edgeId: number) {
    const me = this.need();
    const index = this.server.edges.findIndex(e => e.id === edgeId && (e.requester === me.id || e.addressee === me.id));
    if (index >= 0) this.server.edges.splice(index, 1);
  }
  async leaderboard() { return this.server.users.filter(u => u.matches > 0).sort((a, b) => b.wins - a.wins || b.kills - a.kills).slice(0, 10).map(u => this.server.person(u)); }
  async recordMatch(won: boolean, kills: number, rank: number) {
    const me = this.need();
    me.matches++; if (won) me.wins++; me.kills += Math.max(0, Math.min(100, kills));
    me.bestRank = me.bestRank === null ? rank : Math.min(me.bestRank, rank);
  }

  joinPresence(me: { id: string; username: string }, handlers: PresenceHandlers): PresenceHandle {
    const server = this.server;
    const entry = { info: { username: me.username, room: null as string | null }, handlers };
    server.online.set(me.id, entry);
    const broadcastPresence = () => { for (const { handlers: h } of server.online.values()) h.onPresence(Object.fromEntries([...server.online].map(([id, e]) => [id, { ...e.info }]))); };
    broadcastPresence();
    return {
      setRoom(room) { entry.info = { ...entry.info, room }; broadcastPresence(); },
      invite(toUserId, room) { server.online.get(toUserId)?.handlers.onInvite({ from: me.id, name: me.username, room } satisfies Invite); },
      nudge(toUserId) { server.online.get(toUserId)?.handlers.onNudge(); },
      leave() { server.online.delete(me.id); broadcastPresence(); },
    };
  }
}
