import { randomId } from './transport';
import type { NetMessage, Transport, TransportStatus } from './transport';
import { MAX_PLAYERS } from './protocol';

export interface PeerStats {
  id: string; state: 'connecting' | 'open' | 'failed'; route: 'direct' | 'relay' | 'unknown';
  rttMs: number | null; bufferedBytes: number;
  error?: string;
}
interface Peer {
  id: string; session: string; pc: RTCPeerConnection; channel: RTCDataChannel | null;
  state: PeerStats['state']; route: PeerStats['route']; rttMs: number | null;
  created: number; seen: number; disconnected: number | null; restarted: boolean;
  ping: { seq: number; at: number } | null; seq: number;
  assembly: { id: number; total: number; next: number; size: number; parts: string[] } | null;
  chain: Promise<void>; ice: RTCIceCandidateInit[]; outgoingIce: RTCIceCandidateInit[]; descriptionSent: boolean;
  revision: number; remoteKey: string; lastDescription: number; localIce: RTCIceCandidateInit[];
  relayCandidate: boolean; error?: string;
}
export interface WebRTCOptions {
  configuration?: RTCConfiguration;
  /** Injected in tests; production uses the browser's native implementation. */
  peerConnection?: (configuration: RTCConfiguration) => RTCPeerConnection;
  clock?: () => number;
  handshakeTimeoutMs?: number;
}

const LOBBY = new Set(['hello', 'roster', 'reject']);
const MAX_MESSAGE = 256 * 1024;
const MAX_BUFFER = 512 * 1024;
const LINK_ERROR = 'Không kết nối được với người chơi. Thử đổi mạng; mạng hạn chế có thể cần TURN.';

/** Supabase carries discovery/signaling only. A reliable, ordered channel per guest carries the entire match.
 * Keeping commands/events reliable preserves the existing protocol's one-shot inventory and fire semantics. */
export class WebRTCTransport implements Transport {
  readonly clientId: string;
  private hostId: string | null;
  private members = new Set<string>();
  private peers = new Map<string, Peer>();
  private messages: Array<(message: NetMessage, from: string) => void> = [];
  private statuses: Array<(status: TransportStatus, detail?: string) => void> = [];
  private changes: Array<() => void> = [];
  private closed = false;
  private playing = false;
  private nextOfferAt = -Infinity;
  private readonly now: () => number;
  private readonly timeout: number;
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly configuration: RTCConfiguration;

  constructor(private readonly signaling: Transport, readonly role: 'host' | 'client', private readonly options: WebRTCOptions = {}) {
    this.clientId = signaling.clientId;
    this.hostId = role === 'host' ? this.clientId : null;
    this.members.add(this.clientId);
    this.now = options.clock ?? (() => performance.now());
    this.timeout = options.handshakeTimeoutMs ?? 30000;
    this.configuration = options.configuration ?? { iceServers: [] };
    signaling.onMessage((message, from) => this.signal(message, from));
    signaling.onStatus((status, detail) => {
      // An established match survives an outage of the signaling service.
      if (!this.playing) this.emit(status, detail);
    });
    this.timer = setInterval(() => this.health(), 1000);
    if (!options.peerConnection && typeof RTCPeerConnection === 'undefined') {
      queueMicrotask(() => this.emit('error', 'Trình duyệt này không hỗ trợ WebRTC. Hãy dùng Chrome, Edge hoặc Safari mới.'));
    }
  }

  onMessage(handler: (message: NetMessage, from: string) => void): void { this.messages.push(handler); }
  onStatus(handler: (status: TransportStatus, detail?: string) => void): void { this.statuses.push(handler); }
  onChange(handler: () => void): void { this.changes.push(handler); }
  private changed(): void { for (const handler of this.changes) handler(); }
  private emit(status: TransportStatus, detail?: string): void { for (const handler of this.statuses) handler(status, detail); }
  private deliver(message: NetMessage, from: string): void { for (const handler of this.messages) handler(message, from); }

  get ready(): boolean {
    if (this.closed || (this.role === 'client' && !this.hostId)) return false;
    const wanted = this.role === 'host' ? [...this.members].filter(id => id !== this.clientId) : [this.hostId!];
    return wanted.every(id => this.peers.get(id)?.state === 'open');
  }

  netStats(): PeerStats[] {
    return [...this.peers.values()].map(peer => ({ id: peer.id, state: peer.state, route: peer.route,
      rttMs: peer.rttMs, bufferedBytes: peer.channel?.bufferedAmount ?? 0, ...(peer.error ? { error: peer.error } : {}) }));
  }

  private roster(message: NetMessage, from: string): boolean {
    if (!Array.isArray(message.players) || message.players.length > MAX_PLAYERS) return false;
    const ids = message.players.map(player => player && typeof player.id === 'string' ? player.id : '');
    if (ids.some(id => !id || id.length > 64) || new Set(ids).size !== ids.length || ids[0] !== from || !ids.includes(this.clientId)) return false;
    if (this.hostId && this.hostId !== from) return false;
    this.hostId = from;
    this.members = new Set(ids);
    for (const [id, peer] of this.peers) if (!this.members.has(id)) { this.disposePeer(peer); this.peers.delete(id); }
    this.changed();
    return true;
  }

  send(message: NetMessage): void {
    if (this.closed) return;
    if (LOBBY.has(message.k) || (!this.playing && (message.k === 'bye' || message.k === 'closed'))) {
      const packet = { ...message, rtc: 1 };
      if (message.k === 'roster' && this.role === 'host') {
        if (!this.roster(packet, this.clientId)) return;
        this.signaling.send(packet);
        this.nextOffer();
      } else this.signaling.send(packet);
      return;
    }
    if (message.k === 'start') {
      if (this.role !== 'host' || !this.ready) throw new Error('Chờ mọi người kết nối trước khi bắt đầu.');
      this.playing = true;
    }
    const text = JSON.stringify(message);
    for (const peer of this.peers.values()) {
      if (this.role === 'client' && peer.id !== this.hostId) continue;
      this.sendData(peer, text);
    }
  }

  private signal(message: NetMessage, from: string): void {
    if (this.closed || from === this.clientId) return;
    if (message.k === 'rtc-signal') {
      if (message.to !== this.clientId || !this.members.has(from) || typeof message.session !== 'string' || message.session.length > 64) return;
      const description = message.description as RTCSessionDescriptionInit | undefined;
      if (description && (typeof description.sdp !== 'string' || description.sdp.length > 65536)) return;
      if (message.revision !== undefined && (!Number.isSafeInteger(message.revision) || (message.revision as number) < 0)) return;
      if (this.role === 'client' && from === this.hostId && description?.type === 'offer') {
        let peer = this.peers.get(from);
        if (peer && peer.session !== message.session) { this.disposePeer(peer); this.peers.delete(from); peer = undefined; }
        peer ??= this.createPeer(from, message.session);
        if (!peer) return;
        const revision = (message.revision as number | undefined) ?? 0;
        if (revision < peer.revision) return;
        this.enqueue(peer, async () => {
          if (revision < peer!.revision) return;
          const key = this.descriptionKey(description);
          // Repeated offers acknowledge delivery without renegotiating a stable connection.
          if (peer!.remoteKey === key && peer!.revision === revision) {
            await this.bundledIce(peer!, message); this.sendDescription(peer!); return;
          }
          peer!.revision = revision;
          peer!.descriptionSent = false;
          await peer!.pc.setRemoteDescription(description);
          peer!.remoteKey = key;
          await this.flushIce(peer!);
          await this.bundledIce(peer!, message);
          await peer!.pc.setLocalDescription(await peer!.pc.createAnswer());
          this.sendDescription(peer!);
        });
        return;
      }
      const peer = this.peers.get(from);
      if (!peer || peer.session !== message.session || peer.state === 'failed') return;
      if (message.revision !== undefined && message.revision !== peer.revision) return;
      if (this.role === 'host' && description?.type === 'answer') {
        this.enqueue(peer, async () => {
          if (message.revision !== undefined && message.revision !== peer.revision) return;
          const key = this.descriptionKey(description);
          if (peer.remoteKey !== key) { await peer.pc.setRemoteDescription(description); peer.remoteKey = key; }
          await this.flushIce(peer); await this.bundledIce(peer, message);
        });
      } else if (message.candidate && typeof message.candidate === 'object') {
        const candidate = message.candidate as RTCIceCandidateInit;
        if (typeof candidate.candidate !== 'string' || candidate.candidate.length > 8192) return;
        this.enqueue(peer, async () => {
          if (peer.pc.remoteDescription) await this.addIce(peer, candidate);
          else if (peer.ice.length < 128) peer.ice.push(candidate);
        });
      }
      return;
    }
    if (this.playing && this.role === 'host' && message.k === 'hello') {
      this.signaling.send({ k: 'reject', to: from, why: 'started' }); return;
    }
    // Never accept gameplay from the broadcast channel, even if a sender labels itself as the host.
    if (this.playing || !LOBBY.has(message.k) && message.k !== 'bye' && message.k !== 'closed') return;
    if (message.k === 'hello' && this.role === 'host' && message.rtc !== 1) {
      this.signaling.send({ k: 'reject', to: from, why: 'webrtc' }); return;
    }
    if (message.k === 'roster' && this.role === 'client') {
      if (message.rtc !== 1) { this.emit('error', 'Chủ phòng dùng phiên bản cũ. Cả nhóm hãy tải lại game.'); return; }
      if (!this.roster(message, from)) return;
    }
    this.deliver(message, from);
  }

  private createPeer(id: string, session: string): Peer | undefined {
    try {
      const pc = this.options.peerConnection ? this.options.peerConnection(this.configuration) : new RTCPeerConnection(this.configuration);
      const now = this.now();
      const peer: Peer = { id, session, pc, channel: null, state: 'connecting', route: 'unknown', rttMs: null,
        created: now, seen: now, disconnected: null, restarted: false, ping: null, seq: 0, assembly: null,
        chain: Promise.resolve(), ice: [], outgoingIce: [], descriptionSent: false,
        revision: 0, remoteKey: '', lastDescription: -Infinity, localIce: [], relayCandidate: false };
      this.peers.set(id, peer);
      pc.onicecandidate = event => {
        if (!event.candidate || !this.current(peer)) return;
        const candidate = event.candidate.toJSON();
        if (peer.localIce.length < 128) peer.localIce.push(candidate);
        peer.relayCandidate ||= event.candidate.type === 'relay';
        if (peer.descriptionSent) this.signaling.send({ k: 'rtc-signal', to: id, session, revision: peer.revision, candidate });
        else if (peer.outgoingIce.length < 128) peer.outgoingIce.push(candidate);
      };
      pc.ondatachannel = event => this.attach(peer, event.channel);
      pc.onconnectionstatechange = () => {
        if (!this.current(peer)) return;
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') peer.disconnected ??= this.now();
        else if (pc.connectionState === 'connected') { peer.disconnected = null; peer.restarted = false; }
      };
      this.changed();
      return peer;
    } catch { this.emit('error', LINK_ERROR); return undefined; }
  }

  private current(peer: Peer): boolean { return !this.closed && this.peers.get(peer.id) === peer && peer.state !== 'failed'; }
  private enqueue(peer: Peer, work: () => Promise<void>): void {
    peer.chain = peer.chain.then(async () => { if (this.current(peer)) await work(); }).catch(() => { if (this.current(peer)) this.fail(peer); });
  }
  private async addIce(peer: Peer, candidate: RTCIceCandidateInit): Promise<void> {
    try { await peer.pc.addIceCandidate(candidate); } catch { /* Late candidates from a previous ICE generation are harmless. */ }
  }
  private async flushIce(peer: Peer): Promise<void> { for (const candidate of peer.ice.splice(0)) await this.addIce(peer, candidate); }
  private descriptionKey(description: RTCSessionDescriptionInit): string {
    // localDescription grows as ICE gathering progresses; that is still the same negotiation.
    return `${description.type}:${description.sdp?.replace(/^a=(?:candidate:.*|end-of-candidates)\r?\n/gm, '')}`;
  }
  private async bundledIce(peer: Peer, message: NetMessage): Promise<void> {
    if (!Array.isArray(message.candidates) || message.candidates.length > 128) return;
    for (const candidate of message.candidates) {
      if (candidate && typeof candidate.candidate === 'string' && candidate.candidate.length <= 8192) await this.addIce(peer, candidate);
    }
  }
  private sendDescription(peer: Peer): void {
    if (!this.current(peer) || !peer.pc.localDescription) return;
    peer.lastDescription = this.now();
    // Replay gathered candidates with SDP in one broadcast, recovering lost trickle packets without a burst.
    this.signaling.send({ k: 'rtc-signal', to: peer.id, session: peer.session, revision: peer.revision,
      description: peer.pc.localDescription.toJSON(), candidates: peer.localIce });
    peer.descriptionSent = true;
    for (const candidate of peer.outgoingIce.splice(0)) this.signaling.send({ k: 'rtc-signal', to: peer.id, session: peer.session, revision: peer.revision, candidate });
  }
  private offer(id: string): void {
    const peer = this.createPeer(id, randomId(16));
    if (!peer) return;
    try { this.attach(peer, peer.pc.createDataChannel('lastlight', { ordered: true })); }
    catch { this.fail(peer); return; }
    this.enqueue(peer, async () => { peer.revision++; await peer.pc.setLocalDescription(await peer.pc.createOffer()); this.sendDescription(peer); });
  }

  /** Spread joins over time instead of negotiating five guests in one quota-heavy burst. */
  private nextOffer(): void {
    if (this.role !== 'host' || this.playing || this.now() < this.nextOfferAt) return;
    const id = [...this.members].find(id => id !== this.clientId && !this.peers.has(id));
    if (!id) return;
    this.nextOfferAt = this.now() + 1000;
    this.offer(id);
  }

  private attach(peer: Peer, channel: RTCDataChannel): void {
    if (!this.current(peer) || channel.label !== 'lastlight' || peer.channel) { channel.close(); return; }
    peer.channel = channel;
    channel.onopen = () => {
      if (!this.current(peer)) return;
      peer.state = 'open'; peer.seen = this.now();
      this.changed(); this.emit('open'); void this.route(peer);
    };
    channel.onclose = () => { if (this.current(peer)) this.fail(peer); };
    channel.onerror = () => { if (this.current(peer)) this.fail(peer); };
    channel.onmessage = event => { if (typeof event.data === 'string') this.receiveData(peer, event.data); };
  }

  private receiveData(peer: Peer, text: string): void {
    if (!this.current(peer) || text.length > MAX_MESSAGE) return;
    let message: NetMessage;
    try { message = JSON.parse(text); } catch { return; }
    if (!message || typeof message.k !== 'string') return;
    if (message.k === 'rtc-chunk') {
      const { id, total, index, part } = message;
      if (!Number.isSafeInteger(id) || !Number.isInteger(total) || !Number.isInteger(index) || typeof part !== 'string' || part.length > 8192 ||
        (total as number) < 2 || (total as number) > 256 || (index as number) < 0 || (index as number) >= (total as number)) return;
      if (index === 0) peer.assembly = { id: id as number, total: total as number, next: 0, size: 0, parts: [] };
      const frame = peer.assembly;
      if (!frame || frame.id !== id || frame.total !== total || frame.next !== index) { peer.assembly = null; return; }
      frame.parts.push(part); frame.next++; frame.size += part.length;
      if (frame.size > MAX_MESSAGE) { peer.assembly = null; return; }
      if (frame.next === total) { peer.assembly = null; this.receiveData(peer, frame.parts.join('')); }
      return;
    }
    peer.seen = this.now();
    if (message.k === 'rtc-ping') {
      this.sendData(peer, JSON.stringify({ k: 'rtc-pong', seq: message.seq })); return;
    }
    if (message.k === 'rtc-pong') {
      if (peer.ping && message.seq === peer.ping.seq) {
        const sample = Math.max(0, this.now() - peer.ping.at);
        peer.rttMs = peer.rttMs === null ? sample : peer.rttMs * .75 + sample * .25;
        peer.ping = null; this.changed();
      }
      return;
    }
    if (message.k === 'start') { if (this.role !== 'client' || peer.id !== this.hostId) return; this.playing = true; }
    this.deliver(message, peer.id); // Identity comes from the bound connection, never from a payload field.
  }

  private sendData(peer: Peer, text: string): void {
    if (!this.current(peer) || peer.channel?.readyState !== 'open') return;
    const bytes = new TextEncoder().encode(text).length;
    if (bytes > MAX_MESSAGE || peer.channel.bufferedAmount > MAX_BUFFER) { this.fail(peer); return; }
    // Browser SCTP limits differ. Small chunks also avoid one large resync blocking every other message.
    const limit = peer.pc.sctp?.maxMessageSize || 65536;
    try {
      if (bytes <= Math.min(32768, limit)) peer.channel.send(text);
      else {
        const size = Math.min(8192, Math.floor((limit - 1024) / 6));
        if (size < 1024) { this.fail(peer); return; }
        const total = Math.ceil(text.length / size), id = ++peer.seq;
        for (let index = 0; index < total; index++) {
          if (peer.channel.bufferedAmount > MAX_BUFFER) { this.fail(peer); return; }
          peer.channel.send(JSON.stringify({ k: 'rtc-chunk', id, index, total, part: text.slice(index * size, (index + 1) * size) }));
        }
      }
    } catch { this.fail(peer); }
  }

  private async route(peer: Peer): Promise<void> {
    try {
      const report = await peer.pc.getStats();
      if (!this.current(peer)) return;
      let selected: string | undefined;
      report.forEach(stat => { if (stat.type === 'transport') selected = stat.selectedCandidatePairId ?? selected; });
      report.forEach(stat => {
        if (stat.type !== 'candidate-pair' || !(selected ? stat.id === selected : stat.nominated && stat.state === 'succeeded')) return;
        const local = report.get(stat.localCandidateId), remote = report.get(stat.remoteCandidateId);
        if (local && remote) peer.route = local.candidateType === 'relay' || remote.candidateType === 'relay' ? 'relay' : 'direct';
      });
      this.changed();
    } catch { /* Route statistics are optional on some browsers. */ }
  }

  private health(): void {
    if (this.closed) return;
    this.nextOffer();
    const now = this.now();
    for (const peer of this.peers.values()) {
      if (!this.current(peer)) continue;
      if (peer.disconnected !== null && now - peer.disconnected > 2000 && !peer.restarted && this.role === 'host') {
        peer.restarted = true;
        this.enqueue(peer, async () => {
          peer.descriptionSent = false; peer.revision++; peer.localIce = []; peer.outgoingIce = [];
          await peer.pc.setLocalDescription(await peer.pc.createOffer({ iceRestart: true })); this.sendDescription(peer);
        });
      }
      if (peer.state === 'connecting' && now - peer.created > this.timeout || peer.state === 'open' && now - peer.seen > 8000) {
        this.fail(peer, peer.state === 'connecting' ? this.handshakeError(peer) : LINK_ERROR); continue;
      }
      if (peer.state === 'connecting' && peer.descriptionSent && now - peer.lastDescription >= 3000) this.sendDescription(peer);
      if (peer.state === 'open' && (!peer.ping || now - peer.ping.at > 4000)) {
        peer.ping = { seq: ++peer.seq, at: now };
        this.sendData(peer, JSON.stringify({ k: 'rtc-ping', seq: peer.seq }));
        void this.route(peer);
      }
    }
  }

  private handshakeError(peer: Peer): string {
    if (!peer.pc.remoteDescription) return 'Chưa nhận được phản hồi handshake từ người chơi. Cả nhóm hãy tải lại game và kiểm tra kết nối phòng chờ.';
    const hasTurn = this.configuration.iceServers?.some(server => (Array.isArray(server.urls) ? server.urls : [server.urls]).some(url => /^turns?:/i.test(url)));
    if (!hasTurn) return 'Đã trao đổi handshake nhưng chưa mở được đường truyền tới người chơi. Chưa cấu hình TURN; hai mạng khác nhau có thể cần TURN để kết nối.';
    if (!peer.relayCandidate) return 'Không lấy được đường truyền TURN. Kiểm tra credential, quota dịch vụ TURN và kết nối tới TURN qua TCP/TLS 443.';
    return 'Đã nhận đường truyền TURN nhưng chưa kết nối được người chơi. Kiểm tra mạng của cả hai và thử vào lại phòng.';
  }
  private fail(peer: Peer, error = LINK_ERROR): void {
    peer.error = error;
    peer.state = 'failed'; this.disposePeer(peer); this.changed();
    // One guest failing must not terminate the other guests' connections.
    if (this.role === 'client') this.emit('error', error);
    else if (this.playing) this.deliver({ k: 'bye' }, peer.id);
  }
  private disposePeer(peer: Peer): void {
    peer.pc.onicecandidate = null; peer.pc.ondatachannel = null; peer.pc.onconnectionstatechange = null;
    if (peer.channel) { peer.channel.onopen = null; peer.channel.onmessage = null; peer.channel.onclose = null; peer.channel.onerror = null; peer.channel.close(); }
    peer.pc.close();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true; clearInterval(this.timer);
    for (const peer of this.peers.values()) this.disposePeer(peer);
    this.peers.clear(); this.signaling.close(); this.emit('closed'); this.changed();
  }
}
