import { randomId } from './transport';
import type { NetMessage, Transport, TransportStatus } from './transport';
import { RECONNECT_GRACE_MS } from './transport';
import type { PeerState } from './transport';
import { reconnectProof, verifyReconnectProof } from './reconnect-auth';
import { connectionConfiguration } from './connection-mode';
import type { ConnectionMode } from './connection-mode';
import { MAX_PLAYERS } from './protocol';
import { MAX_WIRE_BYTES, MissingBaseline, WireAssembly, WireDecoder, WireEncoder, WIRE_VERSION, fragment } from './wire';

export interface PeerStats {
  id: string; state: 'connecting' | 'open' | 'reconnecting' | 'failed'; route: 'direct' | 'relay' | 'unknown';
  rttMs: number | null; bufferedBytes: number;
  error?: string;
}
interface Peer {
  id: string; session: string; pc: RTCPeerConnection; channel: RTCDataChannel | null;
  state: PeerStats['state']; route: PeerStats['route']; rttMs: number | null;
  created: number; seen: number; disconnected: number | null; restarted: boolean;
  ping: { seq: number; at: number } | null; seq: number;
  encoder: WireEncoder; decoder: WireDecoder; assembly: WireAssembly;
  chain: Promise<void>; ice: RTCIceCandidateInit[]; outgoingIce: RTCIceCandidateInit[]; descriptionSent: boolean;
  revision: number; remoteKey: string; lastDescription: number; localIce: RTCIceCandidateInit[];
  acceptedRevision: number | null; description: RTCSessionDescriptionInit | null;
  relayCandidate: boolean; error?: string;
  generation: number; token: string; disposed: boolean;
  snapshotAt: number;
}
export interface WebRTCOptions {
  configuration?: RTCConfiguration;
  mode?: ConnectionMode;
  /** Injected in tests; production uses the browser's native implementation. */
  peerConnection?: (configuration: RTCConfiguration) => RTCPeerConnection;
  clock?: () => number;
  handshakeTimeoutMs?: number;
}

const LOBBY = new Set(['hello', 'roster', 'reject']);
const MAX_MESSAGE = MAX_WIRE_BYTES;
const MAX_BUFFER = 512 * 1024;
const LINK_STALE_MS = 8000; // Longer than the four-second idle ping interval.
const LINK_ERROR = 'Không kết nối được với người chơi. Thử đổi mạng; mạng hạn chế có thể cần TURN.';

/** Supabase carries discovery/signaling only. A reliable, ordered channel per guest carries the entire match.
 * Keeping commands/events reliable preserves the existing protocol's one-shot inventory and fire semantics. */
export class WebRTCTransport implements Transport {
  readonly clientId: string;
  private hostId: string | null;
  private members = new Set<string>();
  private modes = new Map<string, ConnectionMode>();
  private peers = new Map<string, Peer>();
  private messages: Array<(message: NetMessage, from: string) => void> = [];
  private statuses: Array<(status: TransportStatus, detail?: string) => void> = [];
  private changes: Array<() => void> = [];
  private peerChanges: Array<(id: string, state: PeerState) => void> = [];
  private recovery = new Map<string, { until: number; retryAt: number; requestedAt: number }>();
  private reconnectAttempt = 0;
  private acceptedAttempts = new Map<string, number>();
  private readonly online = () => { for (const item of this.recovery.values()) item.requestedAt = -Infinity; this.health(); };
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
      else if (status === 'open') this.online();
    });
    this.timer = setInterval(() => this.health(), 1000);
    if (typeof window !== 'undefined') window.addEventListener('online', this.online);
    if (!options.peerConnection && typeof RTCPeerConnection === 'undefined') {
      queueMicrotask(() => this.emit('error', 'Trình duyệt này không hỗ trợ WebRTC. Hãy dùng Chrome, Edge hoặc Safari mới.'));
    }
  }

  onMessage(handler: (message: NetMessage, from: string) => void): void { this.messages.push(handler); }
  onStatus(handler: (status: TransportStatus, detail?: string) => void): void { this.statuses.push(handler); }
  onChange(handler: () => void): void { this.changes.push(handler); }
  onPeerState(handler: (id: string, state: PeerState) => void): void { this.peerChanges.push(handler); }
  private peerChanged(id: string, state: PeerState): void { for (const handler of this.peerChanges) handler(id, state); }
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

  snapshotReady(id: string): boolean {
    const peer = this.peers.get(id);
    if (!peer || peer.state !== 'open' || peer.channel?.readyState !== 'open') return false;
    const buffered = peer.channel.bufferedAmount;
    if (buffered >= 16 * 1024) return false;
    const gap = buffered >= 8 * 1024 ? 200 : buffered >= 4 * 1024 ? 100 : 0;
    return this.now() - peer.snapshotAt >= gap;
  }

  private roster(message: NetMessage, from: string): boolean {
    if (!Array.isArray(message.players) || message.players.length > MAX_PLAYERS) return false;
    const ids = message.players.map(player => player && typeof player.id === 'string' ? player.id : '');
    if (ids.some(id => !id || id.length > 64) || new Set(ids).size !== ids.length || ids[0] !== from || !ids.includes(this.clientId)) return false;
    if (this.hostId && this.hostId !== from) return false;
    this.hostId = from;
    this.members = new Set(ids);
    for (const [id, peer] of this.peers) if (!this.members.has(id)) { this.disposePeer(peer); this.peers.delete(id); }
    for (const id of this.modes.keys()) if (!this.members.has(id)) this.modes.delete(id);
    this.changed();
    return true;
  }

  send(message: NetMessage): void {
    if (this.closed) return;
    if (LOBBY.has(message.k) || (!this.playing && (message.k === 'bye' || message.k === 'closed'))) {
      const packet: NetMessage = { ...message, rtc: WIRE_VERSION };
      if (message.k === 'hello' && this.role === 'client' && this.options.mode) packet.connectionMode = this.options.mode;
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
    for (const peer of this.peers.values()) {
      if (this.role === 'client' && peer.id !== this.hostId) continue;
      if (typeof message.to === 'string' && message.to !== peer.id) continue;
      this.sendData(peer, message);
    }
  }

  private signal(message: NetMessage, from: string): void {
    if (this.closed || from === this.clientId) return;
    if (message.k === 'rtc-reconnect') {
      const peer = this.peers.get(from);
      if (this.playing && this.role === 'host' && message.to === this.clientId && peer && peer.state !== 'failed'
        && peer.token && typeof message.proof === 'string' && Number.isSafeInteger(message.attempt)
        && (message.attempt as number) > (this.acceptedAttempts.get(from) ?? 0)) {
        const attempt = message.attempt as number;
        void verifyReconnectProof(peer.token, from, this.clientId, attempt, message.proof).then(valid => {
          if (!valid || this.closed || this.peers.get(from) !== peer || attempt <= (this.acceptedAttempts.get(from) ?? 0)) return;
          this.acceptedAttempts.set(from, attempt);
          // Old queued requests must not disturb a link that already recovered.
          if (peer.state !== 'open' || peer.disconnected !== null || this.now() - peer.seen > LINK_STALE_MS) this.reconnectPeer(from);
        }).catch(() => {});
      }
      return;
    }
    if (message.k === 'rtc-signal') {
      if (message.to !== this.clientId || !this.members.has(from) || typeof message.session !== 'string' || message.session.length > 64) return;
      const description = message.description as RTCSessionDescriptionInit | undefined;
      if (description && (typeof description.sdp !== 'string' || description.sdp.length > 65536)) return;
      if (message.revision !== undefined && (!Number.isSafeInteger(message.revision) || (message.revision as number) < 0)) return;
      if (this.role === 'client' && from === this.hostId && description?.type === 'offer') {
        let peer = this.peers.get(from);
        const generation = message.generation === undefined ? 0 : message.generation;
        if (!Number.isSafeInteger(generation) || (generation as number) < 0) return;
        if (peer && ((generation as number) < peer.generation || peer.state === 'failed' && this.playing)) return;
        if (peer && peer.session !== message.session) {
          if ((generation as number) <= peer.generation) return;
          if (this.playing) this.recover(peer);
          const token = peer.token;
          this.disposePeer(peer); this.peers.delete(from);
          peer = this.createPeer(from, message.session, generation as number, token);
        }
        peer ??= this.createPeer(from, message.session, generation as number);
        if (!peer) return;
        const revision = (message.revision as number | undefined) ?? 0;
        if (revision < peer.revision) return;
        this.enqueue(peer, async () => {
          if (revision < peer!.revision) return;
          const key = this.descriptionKey(description);
          // Repeated offers acknowledge delivery without renegotiating a stable connection.
          const duplicate = message.revision !== undefined ? peer!.acceptedRevision === revision : peer!.remoteKey === key;
          if (duplicate && peer!.revision === revision) {
            await this.bundledIce(peer!, message); this.sendDescription(peer!); return;
          }
          peer!.revision = revision;
          peer!.descriptionSent = false; peer!.description = null;
          await peer!.pc.setRemoteDescription(description);
          peer!.remoteKey = key;
          peer!.acceptedRevision = revision;
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
          // A gathered/reformatted SDP answer is still the answer to the same offer.
          // Applying it again after reaching stable throws InvalidStateError in native browsers.
          if (peer.acceptedRevision !== peer.revision) {
            await peer.pc.setRemoteDescription(description); peer.remoteKey = key; peer.acceptedRevision = peer.revision;
          }
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
    if (message.k === 'hello' && this.role === 'host' && message.rtc !== WIRE_VERSION) {
      this.signaling.send({ k: 'reject', to: from, why: 'webrtc' }); return;
    }
    if (message.k === 'roster' && this.role === 'client') {
      if (message.rtc !== WIRE_VERSION) { this.emit('error', 'Chủ phòng dùng phiên bản khác. Cả nhóm hãy tải lại game.'); return; }
      if (!this.roster(message, from)) return;
    }
    if (message.k === 'hello' && this.role === 'host' && !this.peers.has(from) && (this.modes.has(from) || this.modes.size < MAX_PLAYERS - 1)) {
      if (message.connectionMode === 'p2p' || message.connectionMode === 'turn') this.modes.set(from, message.connectionMode);
    }
    this.deliver(message, from);
  }

  private createPeer(id: string, session: string, generation = 0, token = ''): Peer | undefined {
    try {
      const configuration = connectionConfiguration(this.configuration, this.role === 'host' ? this.modes.get(id) : this.options.mode);
      const pc = this.options.peerConnection ? this.options.peerConnection(configuration) : new RTCPeerConnection(configuration);
      const now = this.now();
      const peer: Peer = { id, session, pc, channel: null, state: 'connecting', route: 'unknown', rttMs: null,
        snapshotAt: -Infinity,
        created: now, seen: now, disconnected: null, restarted: false, ping: null, seq: 0,
        encoder: new WireEncoder(), decoder: new WireDecoder(), assembly: new WireAssembly(),
        chain: Promise.resolve(), ice: [], outgoingIce: [], descriptionSent: false,
        revision: 0, remoteKey: '', lastDescription: -Infinity, localIce: [], relayCandidate: false,
        acceptedRevision: null, description: null, generation, token: token || (this.role === 'host' ? randomId(32) : ''), disposed: false };
      if (this.recovery.has(id)) peer.state = 'reconnecting';
      this.peers.set(id, peer);
      pc.onicecandidate = event => {
        if (!event.candidate || !this.current(peer)) return;
        const candidate = event.candidate.toJSON();
        if (peer.localIce.length < 128) peer.localIce.push(candidate);
        peer.relayCandidate ||= event.candidate.type === 'relay';
        if (peer.descriptionSent) this.signaling.send({ k: 'rtc-signal', to: id, session, generation, revision: peer.revision, candidate });
        else if (peer.outgoingIce.length < 128) peer.outgoingIce.push(candidate);
      };
      pc.ondatachannel = event => this.attach(peer, event.channel);
      pc.onconnectionstatechange = () => {
        if (!this.current(peer)) return;
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
          peer.disconnected ??= this.now();
          if (this.playing) this.recover(peer);
        }
        else if (pc.connectionState === 'connected') { peer.disconnected = null; peer.restarted = false; }
      };
      this.changed();
      return peer;
    } catch { this.emit('error', LINK_ERROR); return undefined; }
  }

  private current(peer: Peer): boolean { return !this.closed && !peer.disposed && this.peers.get(peer.id) === peer && peer.state !== 'failed'; }
  private enqueue(peer: Peer, work: () => Promise<void>): void {
    peer.chain = peer.chain.then(async () => { if (this.current(peer)) await work(); }).catch(error => {
      if (this.current(peer)) this.fail(peer, this.operationError('Thương lượng WebRTC', error));
    });
  }
  private operationError(operation: string, error: unknown): string {
    const name = error && typeof error === 'object' && 'name' in error && typeof error.name === 'string' && /^[a-zA-Z-]{1,48}$/.test(error.name) ? error.name : 'RTCError';
    return `${operation} thất bại (${name}). Cả nhóm hãy tải lại game rồi tạo phòng mới.`;
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
    peer.description ??= peer.pc.localDescription.toJSON();
    this.signaling.send({ k: 'rtc-signal', to: peer.id, session: peer.session, generation: peer.generation, revision: peer.revision,
      description: peer.description, candidates: [...peer.localIce] });
    peer.descriptionSent = true;
    for (const candidate of peer.outgoingIce.splice(0)) this.signaling.send({ k: 'rtc-signal', to: peer.id, session: peer.session, generation: peer.generation, revision: peer.revision, candidate });
  }
  private offer(id: string): void {
    const previous = this.peers.get(id);
    if (previous) this.disposePeer(previous);
    const peer = this.createPeer(id, randomId(16), previous ? previous.generation + 1 : 0, previous?.token);
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
      peer.error = undefined; peer.disconnected = null; peer.restarted = false;
      this.recovery.delete(peer.id);
      if (this.role === 'host') this.sendData(peer, { k: 'rtc-ticket', token: peer.token });
      this.peerChanged(peer.id, 'open');
      this.changed(); this.emit('open'); void this.route(peer);
    };
    channel.onclose = () => {
      if (this.current(peer)) this.fail(peer, peer.state === 'connecting'
        ? `Kênh dữ liệu đóng trước khi kết nối hoàn tất (ICE: ${peer.pc.iceConnectionState ?? 'unknown'}). Cả nhóm hãy tải lại game và thử vào lại phòng.`
        : 'Kênh dữ liệu với người chơi đã đóng. Kiểm tra tab game và mạng của cả hai.');
    };
    channel.onerror = event => { if (this.current(peer)) this.fail(peer, this.operationError('Kênh dữ liệu', (event as RTCErrorEvent).error)); };
    channel.binaryType = 'arraybuffer';
    channel.onmessage = event => { if (event.data instanceof ArrayBuffer) this.receiveData(peer, new Uint8Array(event.data)); };
  }

  private receiveData(peer: Peer, bytes: Uint8Array): void {
    if (!this.current(peer) || bytes.length > MAX_MESSAGE) return;
    let message: NetMessage;
    try {
      const frame = peer.assembly.receive(bytes);
      if (!frame) return;
      message = peer.decoder.decode(frame);
    } catch (error) {
      if (error instanceof MissingBaseline) this.sendData(peer, { k: 'rtc-resync' });
      else this.fail(peer, 'Dữ liệu mạng không hợp lệ. Cả nhóm hãy tải lại game rồi vào lại phòng.');
      return;
    }
    peer.seen = this.now();
    if (peer.state === 'reconnecting') {
      peer.state = 'open'; peer.disconnected = null; peer.restarted = false; peer.error = undefined;
      this.recovery.delete(peer.id); this.peerChanged(peer.id, 'open'); this.changed(); this.emit('open');
    }
    if (message.k === 'rtc-ticket') {
      if (this.role === 'client' && peer.id === this.hostId && typeof message.token === 'string' && message.token.length === 32) peer.token = message.token;
      return;
    }
    if (message.k === 'rtc-resync') { peer.encoder.reset(); return; }
    if (message.k === 'rtc-ping') {
      this.sendData(peer, { k: 'rtc-pong', seq: message.seq }); return;
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

  private sendData(peer: Peer, message: NetMessage): void {
    if (!this.current(peer) || peer.channel?.readyState !== 'open') return;
    if (peer.channel.bufferedAmount > MAX_BUFFER) { this.fail(peer); return; }
    // Browser SCTP limits differ. Small chunks also avoid one large resync blocking every other message.
    const limit = peer.pc.sctp?.maxMessageSize || 65536;
    try {
      const bytes = peer.encoder.encode(message);
      if (bytes.length <= Math.min(32768, limit)) peer.channel.send(bytes.buffer as ArrayBuffer);
      else {
        for (const part of fragment(bytes, ++peer.seq, Math.min(32768, limit))) {
          if (peer.channel.bufferedAmount > MAX_BUFFER) { this.fail(peer); return; }
          peer.channel.send(part.buffer as ArrayBuffer);
        }
      }
      if (message.k === 'snap') peer.snapshotAt = this.now();
    } catch (error) { this.fail(peer, this.operationError('Gửi dữ liệu WebRTC', error)); }
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
      if (peer.state === 'failed') continue;
      if (this.playing && (peer.disconnected !== null || now - peer.seen > LINK_STALE_MS)) this.recover(peer);
      const recovery = this.recovery.get(peer.id);
      if (recovery && now >= recovery.until) { this.terminal(peer, 'Hết 30 giây chờ kết nối lại.'); continue; }
      if (recovery && this.role === 'client' && peer.token && now - recovery.requestedAt >= 3000) {
        recovery.requestedAt = now;
        const attempt = ++this.reconnectAttempt;
        void reconnectProof(peer.token, this.clientId, peer.id, attempt).then(proof => {
          if (!this.closed && this.recovery.has(peer.id)) this.signaling.send({ k: 'rtc-reconnect', to: peer.id, attempt, proof });
        }).catch(() => {}); // Host-initiated retry still works if Web Crypto is unavailable.
      }
      if (recovery && this.role === 'host' && now >= recovery.retryAt) {
        recovery.retryAt = now + 8000; this.offer(peer.id); continue;
      }
      if (!this.current(peer)) continue;
      if (peer.disconnected !== null && now - peer.disconnected > 2000 && !peer.restarted && this.role === 'host') {
        peer.restarted = true;
        this.enqueue(peer, async () => {
          peer.descriptionSent = false; peer.revision++; peer.localIce = []; peer.outgoingIce = [];
          peer.acceptedRevision = null; peer.description = null;
          await peer.pc.setLocalDescription(await peer.pc.createOffer({ iceRestart: true })); this.sendDescription(peer);
        });
      }
      if (!recovery && (peer.state === 'connecting' && now - peer.created > this.timeout || !this.playing && peer.state === 'open' && now - peer.seen > 8000)) {
        this.fail(peer, peer.state === 'connecting' ? this.handshakeError(peer)
          : 'Không nhận được phản hồi từ người chơi trong 8 giây. Hãy giữ tab game hoạt động và kiểm tra mạng của cả hai.'); continue;
      }
      if ((peer.state === 'connecting' || peer.state === 'reconnecting') && peer.descriptionSent && now - peer.lastDescription >= 3000) this.sendDescription(peer);
      if ((peer.state === 'open' || peer.state === 'reconnecting') && (!peer.ping || now - peer.ping.at > 4000)) {
        peer.ping = { seq: ++peer.seq, at: now };
        this.sendData(peer, { k: 'rtc-ping', seq: peer.seq });
        void this.route(peer);
      }
    }
  }

  private handshakeError(peer: Peer): string {
    if (!peer.pc.remoteDescription) return 'Chưa nhận được phản hồi handshake từ người chơi. Cả nhóm hãy tải lại game và kiểm tra kết nối phòng chờ.';
    if ((this.role === 'host' ? this.modes.get(peer.id) : this.options.mode) === 'p2p') return 'Không mở được kết nối P2P trực tiếp. Hãy rời phòng, chọn TURN rồi vào lại.';
    const hasTurn = this.configuration.iceServers?.some(server => (Array.isArray(server.urls) ? server.urls : [server.urls]).some(url => /^turns?:/i.test(url)));
    if (!hasTurn) return 'Đã trao đổi handshake nhưng chưa mở được đường truyền tới người chơi. Chưa cấu hình TURN; hai mạng khác nhau có thể cần TURN để kết nối.';
    if (!peer.relayCandidate) return 'Không lấy được đường truyền TURN. Kiểm tra credential, quota dịch vụ TURN và kết nối tới TURN qua TCP/TLS 443.';
    return 'Đã nhận đường truyền TURN nhưng chưa kết nối được người chơi. Kiểm tra mạng của cả hai và thử vào lại phòng.';
  }
  private fail(peer: Peer, error = LINK_ERROR): void {
    if (this.playing) { this.recover(peer); peer.error = error; this.disposePeer(peer); return; }
    this.terminal(peer, error);
  }
  private recover(peer: Peer): void {
    if (this.closed || peer.state === 'failed') return;
    if (!this.recovery.has(peer.id)) this.recovery.set(peer.id, { until: this.now() + RECONNECT_GRACE_MS, retryAt: this.now() + 8000, requestedAt: -Infinity });
    if (peer.state !== 'reconnecting') {
      peer.state = 'reconnecting'; peer.disconnected ??= this.now(); this.changed(); this.peerChanged(peer.id, 'reconnecting');
      if (this.role === 'client') this.emit('reconnecting');
    }
  }
  reconnectPeer(id: string): void {
    const peer = this.peers.get(id);
    if (!this.playing || !peer || peer.state === 'failed') return;
    this.recover(peer);
    const recovery = this.recovery.get(id)!;
    if (this.role === 'host' && (peer.disposed || this.now() >= recovery.retryAt)) {
      recovery.retryAt = this.now() + 8000; this.offer(id);
    }
  }
  forgetPeer(id: string): void {
    const peer = this.peers.get(id);
    if (peer && peer.state !== 'failed') this.terminal(peer, 'Người chơi đã rời trận.');
  }
  private terminal(peer: Peer, error: string): void {
    peer.error = error;
    this.recovery.delete(peer.id);
    peer.state = 'failed'; this.disposePeer(peer); this.changed();
    this.peerChanged(peer.id, 'failed');
    // One guest failing must not terminate the other guests' connections.
    if (this.role === 'client') this.emit('error', error);
  }
  private disposePeer(peer: Peer): void {
    peer.disposed = true;
    peer.pc.onicecandidate = null; peer.pc.ondatachannel = null; peer.pc.onconnectionstatechange = null;
    if (peer.channel) { peer.channel.onopen = null; peer.channel.onmessage = null; peer.channel.onclose = null; peer.channel.onerror = null; peer.channel.close(); }
    peer.pc.close();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true; clearInterval(this.timer);
    if (typeof window !== 'undefined') window.removeEventListener('online', this.online);
    for (const peer of this.peers.values()) this.disposePeer(peer);
    this.peers.clear(); this.signaling.close(); this.emit('closed'); this.changed();
  }
}
