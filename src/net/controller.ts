import type { LobbyModel, LobbyView } from '../lobby-ui';
import { Lobby, makeRoomCode, normalizeRoomCode } from './lobby';
import type { RoomConfig } from './lobby';
import type { MatchSetup } from './session';
import { SupabaseTransport } from './transport';
import type { Transport } from './transport';
import { SUPABASE, rtcConfiguration } from './config';
import { WebRTCTransport } from './webrtc';

/** Everything the game needs to begin a match once the lobby is done. */
export interface MatchStart { setup: MatchSetup; role: 'host' | 'client'; transport: Transport; hostId: string; me: string }

export interface ControllerOptions {
  /** The map, bot count and difficulty currently chosen on the main screen: the host's room settings. */
  config(): RoomConfig;
  begin(start: MatchStart): void;
  /** The signed-in account, if any: it decides the player's name and lets friends recognise them. */
  identity?(): { name: string; uid: string } | null;
  /** The outfit the player has chosen, shown to the others in the match. */
  skin?(): string | undefined;
  /** Friends to mark in the roster and online friends who can be invited. */
  friends?(): { friendIds: string[]; invitable: Array<{ id: string; name: string }> };
  /** The room code the player is waiting in (null when none), so friends can see and join it. */
  onRoom?(code: string | null): void;
  /** Tests and tools may supply another transport. */
  makeTransport?(room: string): Transport;
}

/** Glue between the lobby view, the lobby logic and the real network. */
export class MultiplayerController {
  private lobby: Lobby | null = null;
  private transport: Transport | null = null;
  private code = '';
  private timer = 0;
  private localError = '';

  constructor(private readonly view: LobbyView, private readonly options: ControllerOptions) {}

  create(name: string): void { this.open(makeRoomCode(), name, 'host'); }

  join(codeText: string, name: string): void {
    const code = normalizeRoomCode(codeText);
    if (code.length !== 5) { this.localError = 'Mã phòng gồm 5 ký tự.'; this.render(); return; }
    this.open(code, name, 'client');
  }

  /** Host: begin the match for everybody in the room. */
  start(): void {
    if (this.transport instanceof WebRTCTransport && !this.transport.ready) return;
    this.lobby?.start(performance.now());
  }

  /** The host changed the map or bots on the main screen while the room is open. */
  refreshConfig(): void { if (this.lobby?.role === 'host') this.lobby.setConfig(this.options.config()); }

  /** Close the room and the connection (before a match starts). */
  leave(): void {
    window.clearInterval(this.timer);
    if (this.lobby && this.lobby.phase !== 'starting') this.lobby.leave();
    else if (this.transport && this.lobby?.phase !== 'starting') this.transport.close();
    this.lobby = null; this.transport = null; this.code = ''; this.localError = '';
    this.options.onRoom?.(null);
    this.render();
  }

  private open(code: string, name: string, role: 'host' | 'client'): void {
    this.leave();
    this.localError = '';
    let transport: Transport;
    try {
      const configuration = this.options.makeTransport ? undefined : rtcConfiguration();
      transport = this.options.makeTransport ? this.options.makeTransport(code)
        : new WebRTCTransport(new SupabaseTransport(SUPABASE, code), role, { configuration });
    } catch { this.localError = 'Cấu hình kết nối WebRTC không hợp lệ.'; this.render(); return; }
    this.transport = transport;
    this.code = code;
    const who = this.options.identity?.();
    const lobby = new Lobby(transport, who?.name ?? name, role, this.options.config(), Math.random, who?.uid);
    this.lobby = lobby;
    if (transport instanceof WebRTCTransport) transport.onChange(() => this.render());
    lobby.setSkin(this.options.skin?.());
    lobby.onChange(() => this.render());
    lobby.onStart(setup => {
      window.clearInterval(this.timer);
      this.options.onRoom?.(null);
      this.options.begin({ setup, role, transport, hostId: lobby.hostId ?? transport.clientId, me: transport.clientId });
      // The transport now belongs to the match.
      this.lobby = null; this.transport = null; this.code = '';
    });
    this.timer = window.setInterval(() => lobby.tick(performance.now()), 400);
    lobby.tick(performance.now());
    this.options.onRoom?.(code);
    this.render();
  }

  /** Redraw (the friend list or the account changed). */
  refresh(): void { this.render(); }

  /** Invite one friend into the room we are in. */
  get roomCode(): string { return this.code; }

  private render(): void {
    const lobby = this.lobby;
    const phase = lobby?.phase ?? null;
    const rtc = this.transport instanceof WebRTCTransport ? this.transport : null;
    const links = rtc?.netStats() ?? [];
    const failed = links.some(link => link.state === 'failed');
    const status = phase === 'connecting' ? 'Đang kết nối tới máy chủ…'
      : phase === 'joining' ? 'Đang tìm phòng…'
        : phase === 'waiting' ? (lobby!.role === 'host' ? 'Gửi mã phòng hoặc link cho bạn bè, rồi bấm bắt đầu.' : 'Đã vào phòng.')
          : phase === 'starting' ? 'Đang vào trận…' : '';
    const model: LobbyModel = {
      phase, code: this.code, players: lobby?.players ?? [], me: lobby?.me ?? '', isHost: lobby?.role === 'host',
      error: lobby?.error || this.localError || (failed ? 'Không kết nối được với một người chơi. Hãy rời/vào lại phòng hoặc thử mạng khác; một số mạng cần TURN.' : ''),
      config: lobby?.config ?? this.options.config(),
      status: phase === 'waiting' && rtc && !rtc.ready ? 'Đang kết nối với người chơi…' : status,
      connections: links, connectionReady: rtc?.ready ?? true,
      friendIds: this.options.friends?.().friendIds ?? [], invitable: this.options.friends?.().invitable ?? [],
    };
    this.view.render(model);
  }
}
