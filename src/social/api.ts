/**
 * Accounts, friends, stats and "who is online" for the game. The rest of the code talks to the `SocialApi` interface;
 * `SupabaseSocialApi` is the real thing (Supabase Auth + the tables in supabase/setup.sql + a Realtime channel for
 * presence and invites) and tests use an in-memory stand-in.
 */
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

export interface Account { id: string; email: string; username: string }
export interface Person { id: string; username: string; matches: number; wins: number; kills: number; bestRank: number | null }
/** A line of the friend list: `incoming` = they asked you, `outgoing` = you asked them. */
export interface FriendEdge { id: number; person: Person; status: 'accepted' | 'incoming' | 'outgoing' }
export interface PresenceInfo { username: string; room: string | null }
export interface Invite { from: string; name: string; room: string }
/** `no-tables`: the SQL in supabase/setup.sql has not been run on this project yet. */
export type Readiness = 'ok' | 'no-tables' | 'offline';

export interface PresenceHandle {
  /** Say where you are now (a room code, or null). */
  setRoom(room: string | null): void;
  invite(toUserId: string, room: string): void;
  /** Tell somebody to look at their friend list again (a request was sent or accepted). */
  nudge(toUserId: string): void;
  leave(): void;
}
export interface PresenceHandlers {
  onPresence(online: Record<string, PresenceInfo>): void;
  onInvite(invite: Invite): void;
  onNudge(): void;
}

export interface SocialApi {
  ready(): Promise<Readiness>;
  currentAccount(): Promise<Account | null>;
  onAuthChange(handler: (account: Account | null) => void): void;
  usernameAvailable(name: string): Promise<boolean>;
  signUp(username: string, email: string, password: string): Promise<{ needsConfirmation: boolean }>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  myProfile(): Promise<Person | null>;
  friends(): Promise<FriendEdge[]>;
  search(prefix: string): Promise<Person[]>;
  /** Ask somebody to be friends; if they had already asked you, this accepts instead. Returns which happened. */
  request(userId: string): Promise<'sent' | 'accepted'>;
  accept(edgeId: number): Promise<void>;
  remove(edgeId: number): Promise<void>;
  leaderboard(): Promise<Person[]>;
  recordMatch(won: boolean, kills: number, rank: number): Promise<void>;
  joinPresence(me: { id: string; username: string }, handlers: PresenceHandlers): PresenceHandle;
}

/** A failure with a message fit to show the player. */
export class SocialError extends Error {
  constructor(message: string, readonly code = '') { super(message); }
}

/** Turn what Supabase says into something a player can act on. */
export function friendlyError(error: unknown): SocialError {
  const raw = error as { message?: string; code?: string; status?: number } | null;
  const message = String(raw?.message ?? error ?? '');
  const code = String(raw?.code ?? '');
  const text = (vi: string) => new SocialError(vi, code);
  if (/invalid login credentials/i.test(message)) return text('Sai email hoặc mật khẩu.');
  if (/email not confirmed/i.test(message)) return text('Email chưa được xác nhận. Mở thư xác nhận rồi đăng nhập lại.');
  if (/already registered|already been registered/i.test(message)) return text('Email này đã được đăng ký. Hãy đăng nhập.');
  if (/password should be at least|weak password|password.*characters/i.test(message)) return text('Mật khẩu cần ít nhất 6 ký tự.');
  if (/rate limit|too many|over_email_send_rate_limit|429/i.test(message) || raw?.status === 429) return text('Bạn thử quá nhiều lần. Hãy đợi một lúc rồi thử lại.');
  if (/unable to validate email|invalid.*email/i.test(message)) return text('Email không hợp lệ.');
  if (/signups? (not allowed|disabled)/i.test(message)) return text('Máy chủ đang tắt đăng ký tài khoản mới.');
  if (code === '23505') return text('Đã có yêu cầu hoặc đã là bạn bè.');
  if (code === '42P01' || code === 'PGRST205' || /schema cache|does not exist|relation .* does not exist/i.test(message)) return text('Máy chủ chưa được thiết lập cho tài khoản và bạn bè (chạy supabase/setup.sql).');
  if (/failed to fetch|network|fetch failed|timeout/i.test(message)) return text('Không kết nối được máy chủ. Kiểm tra mạng.');
  return text(message || 'Có lỗi xảy ra.');
}

interface ProfileRow { id: string; username: string; matches: number; wins: number; kills: number; best_rank: number | null }
const toPerson = (row: ProfileRow): Person => ({ id: row.id, username: row.username, matches: row.matches, wins: row.wins, kills: row.kills, bestRank: row.best_rank });
const PROFILE_COLUMNS = 'id, username, matches, wins, kills, best_rank';

/** Characters that would change the meaning of a LIKE pattern. */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, ch => `\\${ch}`);

export class SupabaseSocialApi implements SocialApi {
  private client: SupabaseClient | null = null;
  constructor(private readonly config: { url: string; key: string }, private readonly createClient: (url: string, key: string, options: object) => SupabaseClient) {}

  private get db(): SupabaseClient {
    this.client ??= this.createClient(this.config.url, this.config.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }, realtime: { params: { eventsPerSecond: 20 } } });
    return this.client;
  }

  async ready(): Promise<Readiness> {
    try {
      const { error } = await this.db.from('profiles').select('id', { head: true, count: 'exact' }).limit(1);
      if (!error) return 'ok';
      // Signed out the table is hidden from us ("permission denied" or empty); a missing table is a different error.
      if (error.code === '42P01' || error.code === 'PGRST205' || /schema cache|does not exist/i.test(error.message)) return 'no-tables';
      if (error.code === '42501' || error.code === 'PGRST301' || /permission denied|JWT/i.test(error.message)) return 'ok';
      return 'ok';
    } catch { return 'offline'; }
  }

  private toAccount(user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> } | null | undefined): Account | null {
    if (!user) return null;
    return { id: user.id, email: user.email ?? '', username: String(user.user_metadata?.username ?? user.email?.split('@')[0] ?? 'player') };
  }

  async currentAccount(): Promise<Account | null> {
    const { data } = await this.db.auth.getSession();
    return this.toAccount(data.session?.user);
  }

  onAuthChange(handler: (account: Account | null) => void): void {
    this.db.auth.onAuthStateChange((_event, session) => handler(this.toAccount(session?.user)));
  }

  async usernameAvailable(name: string): Promise<boolean> {
    const { data, error } = await this.db.rpc('username_available', { name });
    if (error) throw friendlyError(error);
    return data === true;
  }

  async signUp(username: string, email: string, password: string): Promise<{ needsConfirmation: boolean }> {
    const { data, error } = await this.db.auth.signUp({ email, password, options: { data: { username }, emailRedirectTo: typeof location !== 'undefined' ? `${location.origin}${location.pathname}` : undefined } });
    if (error) throw friendlyError(error);
    // An address that is already registered comes back as a user with no identities (so sign-ups cannot probe emails).
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) throw new SocialError('Email này đã được đăng ký. Hãy đăng nhập.');
    return { needsConfirmation: !data.session };
  }

  async signIn(email: string, password: string): Promise<void> {
    const { error } = await this.db.auth.signInWithPassword({ email, password });
    if (error) throw friendlyError(error);
  }

  async signOut(): Promise<void> { await this.db.auth.signOut(); }

  async myProfile(): Promise<Person | null> {
    const account = await this.currentAccount();
    if (!account) return null;
    const { data, error } = await this.db.from('profiles').select(PROFILE_COLUMNS).eq('id', account.id).maybeSingle();
    if (error) throw friendlyError(error);
    return data ? toPerson(data as ProfileRow) : null;
  }

  async friends(): Promise<FriendEdge[]> {
    const account = await this.currentAccount();
    if (!account) return [];
    const { data, error } = await this.db.from('friendships').select('id, requester, addressee, status').order('id');
    if (error) throw friendlyError(error);
    const rows = (data ?? []) as Array<{ id: number; requester: string; addressee: string; status: 'pending' | 'accepted' }>;
    if (!rows.length) return [];
    const others = rows.map(row => row.requester === account.id ? row.addressee : row.requester);
    const { data: people, error: peopleError } = await this.db.from('profiles').select(PROFILE_COLUMNS).in('id', others);
    if (peopleError) throw friendlyError(peopleError);
    const byId = new Map((people as ProfileRow[]).map(row => [row.id, toPerson(row)]));
    const edges: FriendEdge[] = [];
    for (const row of rows) {
      const otherId = row.requester === account.id ? row.addressee : row.requester;
      const person = byId.get(otherId);
      if (!person) continue;
      edges.push({ id: row.id, person, status: row.status === 'accepted' ? 'accepted' : row.requester === account.id ? 'outgoing' : 'incoming' });
    }
    return edges;
  }

  async search(prefix: string): Promise<Person[]> {
    const clean = prefix.trim().replace(/[^A-Za-z0-9_]/g, '').slice(0, 16);
    if (clean.length < 2) return [];
    const account = await this.currentAccount();
    const { data, error } = await this.db.from('profiles').select(PROFILE_COLUMNS).ilike('username', `${escapeLike(clean)}%`).limit(12);
    if (error) throw friendlyError(error);
    return (data as ProfileRow[]).filter(row => row.id !== account?.id).map(toPerson);
  }

  async request(userId: string): Promise<'sent' | 'accepted'> {
    const account = await this.currentAccount();
    if (!account) throw new SocialError('Hãy đăng nhập trước.');
    const existing = (await this.friends()).find(edge => edge.person.id === userId);
    if (existing?.status === 'incoming') { await this.accept(existing.id); return 'accepted'; }
    if (existing) throw new SocialError(existing.status === 'accepted' ? 'Hai bạn đã là bạn bè.' : 'Bạn đã gửi lời mời rồi.');
    const { error } = await this.db.from('friendships').insert({ requester: account.id, addressee: userId });
    if (error) throw friendlyError(error);
    return 'sent';
  }

  async accept(edgeId: number): Promise<void> {
    const { data, error } = await this.db.from('friendships').update({ status: 'accepted' }).eq('id', edgeId).select('id');
    if (error) throw friendlyError(error);
    if (!data?.length) throw new SocialError('Lời mời không còn nữa.');
  }

  async remove(edgeId: number): Promise<void> {
    const { error } = await this.db.from('friendships').delete().eq('id', edgeId);
    if (error) throw friendlyError(error);
  }

  async leaderboard(): Promise<Person[]> {
    const { data, error } = await this.db.from('profiles').select(PROFILE_COLUMNS).gt('matches', 0).order('wins', { ascending: false }).order('kills', { ascending: false }).limit(10);
    if (error) throw friendlyError(error);
    return (data as ProfileRow[]).map(toPerson);
  }

  async recordMatch(won: boolean, kills: number, rank: number): Promise<void> {
    const { error } = await this.db.rpc('record_match', { won, kill_count: Math.max(0, Math.floor(kills)), final_rank: Math.max(1, Math.floor(rank)) });
    if (error) throw friendlyError(error);
  }

  joinPresence(me: { id: string; username: string }, handlers: PresenceHandlers): PresenceHandle {
    const db = this.db;
    const channel: RealtimeChannel = db.channel('lastlight:online', { config: { presence: { key: me.id }, broadcast: { self: false } } });
    let room: string | null = null;
    let subscribed = false;
    const track = () => { if (subscribed) void channel.track({ username: me.username, room, at: Date.now() }); };
    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState() as Record<string, Array<{ username?: string; room?: string | null }>>;
      const online: Record<string, PresenceInfo> = {};
      for (const [id, entries] of Object.entries(state)) {
        const latest = entries[entries.length - 1];
        if (latest) online[id] = { username: String(latest.username ?? ''), room: latest.room ?? null };
      }
      handlers.onPresence(online);
    });
    channel.on('broadcast', { event: 'invite' }, ({ payload }) => {
      if (payload && payload.to === me.id && typeof payload.room === 'string') handlers.onInvite({ from: String(payload.from ?? ''), name: String(payload.name ?? 'Một người bạn'), room: payload.room });
    });
    channel.on('broadcast', { event: 'nudge' }, ({ payload }) => { if (payload && payload.to === me.id) handlers.onNudge(); });
    channel.subscribe(status => { if (status === 'SUBSCRIBED') { subscribed = true; track(); } });
    return {
      setRoom(next) { room = next; track(); },
      invite(toUserId, code) { void channel.send({ type: 'broadcast', event: 'invite', payload: { to: toUserId, from: me.id, name: me.username, room: code } }); },
      nudge(toUserId) { void channel.send({ type: 'broadcast', event: 'nudge', payload: { to: toUserId } }); },
      leave() { void channel.untrack(); void db.removeChannel(channel); },
    };
  }
}
