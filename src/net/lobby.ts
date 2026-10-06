/**
 * The waiting room: players find each other by a short room code, the host picks the map and starts the match. Pure
 * message passing over a `Transport`, driven by `tick(nowMs)` so tests can run it on a virtual clock.
 */
import { MAX_PLAYERS } from './protocol';
import type { MatchSetup } from './session';
import type { NetMessage, Transport } from './transport';

export interface RoomConfig { map: MatchSetup['map']; botCount: number; difficulty: MatchSetup['difficulty'] }
/** `uid` is the player's account id when they are signed in (used to recognise friends and send invites). */
export interface RosterEntry { id: string; name: string; uid?: string; skin?: string }
const cleanSkin = (value: unknown): string | undefined => typeof value === 'string' && /^[a-z0-9_-]{1,24}$/.test(value) ? value : undefined;
export type LobbyPhase = 'connecting' | 'joining' | 'waiting' | 'starting' | 'closed' | 'error';

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function makeRoomCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < 5; i++) code += ROOM_ALPHABET[Math.floor(random() * ROOM_ALPHABET.length)];
  return code;
}
/** Room codes are typed by hand: ignore case, spaces and the letters that look like digits. */
export function normalizeRoomCode(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/I/g, '1').slice(0, 5);
}

const HELLO_INTERVAL = 1500;
const ROSTER_INTERVAL = 1500;
const PLAYER_TIMEOUT = 6000;
const JOIN_TIMEOUT = 8000;

export class Lobby {
  phase: LobbyPhase = 'connecting';
  players: RosterEntry[] = [];
  hostId: string | null = null;
  error = '';
  setup: MatchSetup | null = null;
  private changeHandlers: Array<() => void> = [];
  private startHandlers: Array<(setup: MatchSetup) => void> = [];
  private lastSeen = new Map<string, number>();
  private lastHello = -Infinity;
  private lastRoster = -Infinity;
  private startedAt: number | null = null;
  private skin: string | undefined;
  /** The time of the latest tick: a heartbeat is stamped with it. */
  private now = 0;

  constructor(private readonly transport: Transport, private name: string, readonly role: 'host' | 'client', public config: RoomConfig, private readonly random: () => number = Math.random, private readonly uid?: string) {
    if (role === 'host') { this.hostId = transport.clientId; this.players = [{ id: transport.clientId, name, ...(uid ? { uid } : {}) }]; this.phase = 'waiting'; }
    transport.onMessage((message, from) => this.receive(message, from));
    transport.onStatus((status, detail) => {
      if (status === 'error') this.fail(`Không kết nối được máy chủ: ${detail ?? 'lỗi mạng'}`);
      else if (status === 'closed' && this.phase !== 'starting' && this.phase !== 'closed') this.phase = 'closed';
      this.changed();
    });
  }

  get me(): string { return this.transport.clientId; }
  onChange(handler: () => void): void { this.changeHandlers.push(handler); }
  onStart(handler: (setup: MatchSetup) => void): void { this.startHandlers.push(handler); }
  private changed(): void { for (const handler of this.changeHandlers) handler(); }
  private fail(why: string): void { if (this.phase === 'starting') return; this.phase = 'error'; this.error = why; this.changed(); }

  setName(name: string): void { this.name = name; }
  /** The outfit this player chose; it travels with the roster so everybody draws them in it. */
  setSkin(skin: string | undefined): void {
    this.skin = cleanSkin(skin);
    const mine = this.players.find(player => player.id === this.me);
    if (mine) mine.skin = this.skin;
  }
  setConfig(config: RoomConfig): void {
    if (this.role !== 'host') return;
    this.config = config;
    this.broadcastRoster();
    this.changed();
  }

  /** Host: close the room to newcomers and tell everybody to begin. */
  start(nowMs = 0): MatchSetup | null {
    if (this.role !== 'host' || this.phase !== 'waiting') return null;
    const seed = Math.floor(this.random() * 2 ** 31);
    const setup: MatchSetup = { seed, map: this.config.map, botCount: this.config.botCount, difficulty: this.config.difficulty, drop: this.config.map !== 'arena' && this.config.map !== 'range', players: this.players.map(player => ({ clientId: player.id, name: player.name, ...(player.skin ? { skin: player.skin } : {}) })) };
    this.setup = setup;
    this.phase = 'starting';
    this.startedAt = nowMs;
    this.transport.send({ k: 'start', setup: setup as unknown as Record<string, unknown> });
    this.changed();
    for (const handler of this.startHandlers) handler(setup);
    return setup;
  }

  private broadcastRoster(): void {
    this.transport.send({ k: 'roster', players: this.players as unknown as Record<string, unknown>[], config: this.config as unknown as Record<string, unknown>, open: this.phase === 'waiting' && this.players.length < MAX_PLAYERS });
  }

  private receive(message: NetMessage, from: string): void {
    if (this.role === 'host') {
      if (message.k === 'hello') {
        const name = String(message.name ?? 'Người chơi').slice(0, 16);
        if (this.phase !== 'waiting') { this.transport.send({ k: 'reject', to: from, why: 'started' }); return; }
        const uid = typeof message.uid === 'string' && message.uid.length < 60 ? message.uid : undefined;
        const known = this.players.find(player => player.id === from);
        if (!known && this.players.length >= MAX_PLAYERS) { this.transport.send({ k: 'reject', to: from, why: 'full' }); return; }
        this.lastSeen.set(from, this.now);
        const skin = cleanSkin(message.skin);
        if (known) { known.name = name; if (uid) known.uid = uid; if (skin) known.skin = skin; } else this.players.push({ id: from, name, ...(uid ? { uid } : {}), ...(skin ? { skin } : {}) });
        this.broadcastRoster();
        this.changed();
      } else if (message.k === 'bye') {
        this.players = this.players.filter(player => player.id !== from || player.id === this.me);
        if (this.phase === 'waiting') this.broadcastRoster();
        this.changed();
      }
      return;
    }
    if (message.k === 'roster') {
      if (this.hostId === null) this.hostId = from;
      if (from !== this.hostId) return;
      this.players = (message.players as RosterEntry[]) ?? [];
      this.config = (message.config as unknown as RoomConfig) ?? this.config;
      if (this.players.some(player => player.id === this.me) && this.phase !== 'starting') this.phase = 'waiting';
      this.changed();
    } else if (message.k === 'start' && from === this.hostId) {
      this.setup = message.setup as unknown as MatchSetup;
      this.phase = 'starting';
      this.changed();
      for (const handler of this.startHandlers) handler(this.setup);
    } else if (message.k === 'reject' && message.to === this.me) {
      this.fail(message.why === 'full' ? 'Phòng đã đầy.' : 'Trận đã bắt đầu, không thể vào nữa.');
    } else if (message.k === 'closed' && from === this.hostId && this.phase !== 'starting') {
      this.phase = 'closed';
      this.error = 'Chủ phòng đã đóng phòng.';
      this.changed();
    }
  }

  /** Call a couple of times a second. */
  tick(nowMs: number): void {
    this.now = nowMs;
    if (this.phase === 'starting' || this.phase === 'closed' || this.phase === 'error') return;
    if (this.role === 'host') {
      for (const player of [...this.players]) {
        if (player.id === this.me) continue;
        const seen = this.lastSeen.get(player.id) ?? nowMs;
        this.lastSeen.set(player.id, seen);
      }
      if (nowMs - this.lastRoster >= ROSTER_INTERVAL) {
        // Players who stopped saying hello have left.
        const before = this.players.length;
        this.players = this.players.filter(player => player.id === this.me || nowMs - (this.lastSeen.get(player.id) ?? nowMs) < PLAYER_TIMEOUT);
        this.lastRoster = nowMs;
        this.broadcastRoster();
        if (this.players.length !== before) this.changed();
      }
      return;
    }
    if (this.startedAt === null) this.startedAt = nowMs;
    if (nowMs - this.lastHello >= HELLO_INTERVAL) {
      this.lastHello = nowMs;
      this.transport.send({ k: 'hello', name: this.name, ...(this.uid ? { uid: this.uid } : {}), ...(this.skin ? { skin: this.skin } : {}) });
    }
    if (this.phase === 'connecting' || this.phase === 'joining') {
      this.phase = 'joining';
      if (nowMs - this.startedAt > JOIN_TIMEOUT) this.fail('Không tìm thấy phòng này. Kiểm tra lại mã phòng.');
    }
  }

  leave(): void {
    if (this.phase === 'starting') return;
    this.transport.send(this.role === 'host' ? { k: 'closed', why: 'host' } : { k: 'bye' });
    this.transport.close();
    this.phase = 'closed';
  }
}
