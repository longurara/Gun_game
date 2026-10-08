/**
 * How messages get between the players. Everything above this file only needs "send to everyone else in the room" and
 * "tell me when something arrives", so the same game code runs over WebRTC in the browser and over an
 * in-memory network with fake latency in the tests.
 */
export interface NetMessage { k: string; [field: string]: unknown }
export type TransportStatus = 'connecting' | 'open' | 'reconnecting' | 'closed' | 'error';
export type PeerState = 'open' | 'reconnecting' | 'failed';
export const RECONNECT_GRACE_MS = 30_000;
export const CONNECTION_STALE_MS = 3_000;

export interface Transport {
  /** This machine's id in the room (random per visit). */
  readonly clientId: string;
  send(message: NetMessage): void;
  /** `from` is the sender's client id. */
  onMessage(handler: (message: NetMessage, from: string) => void): void;
  onStatus(handler: (status: TransportStatus, detail?: string) => void): void;
  onPeerState?(handler: (id: string, state: PeerState) => void): void;
  reconnectPeer?(id: string): void;
  forgetPeer?(id: string): void;
  /** Host flow control: build a snapshot only when the recipient can accept one. */
  snapshotReady?(id: string): boolean;
  close(): void;
}

export function randomId(length = 8): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let id = '';
  const bytes = new Uint8Array(length);
  (globalThis.crypto ?? { getRandomValues: (a: Uint8Array) => a.map(() => Math.floor(Math.random() * 256)) }).getRandomValues(bytes);
  for (const byte of bytes) id += alphabet[byte % alphabet.length];
  return id;
}

// ---------------------------------------------------------------------------------------------------------------------
// In-memory network for tests: a virtual clock, per-message latency and optional loss.
// ---------------------------------------------------------------------------------------------------------------------

export interface LoopbackOptions { latency?: number; jitter?: number; loss?: number }

interface Queued { at: number; to: LoopbackTransport; message: NetMessage; from: string }

/** A room whose messages are delivered when the test advances its virtual clock. */
export class LoopbackNetwork {
  now = 0;
  private queue: Queued[] = [];
  readonly endpoints: LoopbackTransport[] = [];
  private random: () => number;
  constructor(private readonly options: LoopbackOptions = {}, seed = 1) {
    let s = seed;
    this.random = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  }

  connect(clientId = randomId()): LoopbackTransport {
    const endpoint = new LoopbackTransport(clientId, this);
    this.endpoints.push(endpoint);
    queueMicrotask(() => endpoint.setStatus('open'));
    return endpoint;
  }

  /** @internal */
  deliver(from: LoopbackTransport, message: NetMessage): void {
    for (const to of this.endpoints) {
      if (to === from || to.closed) continue;
      if (typeof message.to === 'string' && message.to !== to.clientId) continue;
      if (this.options.loss && this.random() < this.options.loss) continue;
      const delay = (this.options.latency ?? 0) + this.random() * (this.options.jitter ?? 0);
      // JSON round trip: the real network never shares objects between machines.
      this.queue.push({ at: this.now + delay, to, message: JSON.parse(JSON.stringify(message)), from: from.clientId });
    }
  }

  /** Move the clock forward and hand over every message that is due, in order. */
  advance(ms: number): void {
    this.now += ms;
    this.queue.sort((a, b) => a.at - b.at);
    while (this.queue.length && this.queue[0].at <= this.now) {
      const item = this.queue.shift()!;
      if (!item.to.closed) item.to.receive(item.message, item.from);
    }
  }
}

export class LoopbackTransport implements Transport {
  closed = false;
  private messageHandlers: Array<(message: NetMessage, from: string) => void> = [];
  private statusHandlers: Array<(status: TransportStatus, detail?: string) => void> = [];
  constructor(readonly clientId: string, private readonly network: LoopbackNetwork) {}
  send(message: NetMessage): void { if (!this.closed) this.network.deliver(this, message); }
  onMessage(handler: (message: NetMessage, from: string) => void): void { this.messageHandlers.push(handler); }
  onStatus(handler: (status: TransportStatus, detail?: string) => void): void { this.statusHandlers.push(handler); }
  close(): void { this.closed = true; this.setStatus('closed'); }
  /** @internal */ receive(message: NetMessage, from: string): void { for (const handler of this.messageHandlers) handler(message, from); }
  /** @internal */ setStatus(status: TransportStatus, detail?: string): void { for (const handler of this.statusHandlers) handler(status, detail); }
}

// ---------------------------------------------------------------------------------------------------------------------
// Supabase Realtime (broadcast only: no tables, no accounts; anyone with the room code can join).
// ---------------------------------------------------------------------------------------------------------------------

export interface SupabaseConfig { url: string; key: string }

/** The small part of a Realtime channel this file uses. */
interface ChannelLike {
  on(type: string, filter: object, callback: (event: { payload?: NetMessage & { f?: string } }) => void): ChannelLike;
  subscribe(callback: (status: string, error?: { message?: string }) => void): unknown;
  send(args: unknown): unknown;
  unsubscribe(): unknown;
}

/** One broadcast channel per room. Messages carry the sender's id in `f`. */
export class SupabaseTransport implements Transport {
  readonly clientId: string;
  private messageHandlers: Array<(message: NetMessage, from: string) => void> = [];
  private statusHandlers: Array<(status: TransportStatus, detail?: string) => void> = [];
  private client: unknown = null;
  private channel: ChannelLike | null = null;
  private closed = false;
  private queued: NetMessage[] = [];
  private ready = false;

  constructor(private readonly config: SupabaseConfig, readonly room: string, clientId = randomId()) {
    this.clientId = clientId;
    void this.open();
  }

  private async open(): Promise<void> {
    try {
      const { RealtimeClient } = await import('@supabase/realtime-js');
      if (this.closed) return;
      const socketUrl = `${this.config.url.replace(/^http/, 'ws').replace(/\/$/, '')}/realtime/v1`;
      const client = new RealtimeClient(socketUrl, { params: { apikey: this.config.key, eventsPerSecond: 100 } });
      this.client = client;
      const channel = client.channel(`lastlight:${this.room}`, { config: { broadcast: { self: false, ack: false } } }) as unknown as ChannelLike;
      channel.on('broadcast', { event: 'm' }, (event: { payload?: NetMessage & { f?: string } }) => {
        const payload = event.payload;
        if (!payload || typeof payload.k !== 'string' || payload.f === this.clientId) return;
        for (const handler of this.messageHandlers) handler(payload, payload.f ?? '');
      });
      channel.subscribe((status: string, error?: { message?: string }) => {
        if (status === 'SUBSCRIBED') {
          this.ready = true;
          this.emit('open');
          for (const message of this.queued.splice(0)) this.send(message);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { this.ready = false; this.emit('error', error?.message ?? status); }
        else if (status === 'CLOSED') { this.ready = false; this.emit(this.closed ? 'closed' : 'connecting'); }
      });
      this.channel = channel;
      this.emit('connecting');
    } catch (error) {
      this.emit('error', error instanceof Error ? error.message : String(error));
    }
  }

  private emit(status: TransportStatus, detail?: string): void { for (const handler of this.statusHandlers) handler(status, detail); }

  send(message: NetMessage): void {
    if (this.closed) return;
    if (!this.ready || !this.channel) { this.queued.push(message); if (this.queued.length > 200) this.queued.shift(); return; }
    void this.channel.send({ type: 'broadcast', event: 'm', payload: { ...message, f: this.clientId } });
  }
  onMessage(handler: (message: NetMessage, from: string) => void): void { this.messageHandlers.push(handler); }
  onStatus(handler: (status: TransportStatus, detail?: string) => void): void { this.statusHandlers.push(handler); }

  close(): void {
    this.closed = true;
    try { void this.channel?.unsubscribe(); } catch { /* already closed */ }
    try { (this.client as { disconnect?: () => unknown } | null)?.disconnect?.(); } catch { /* already closed */ }
    this.emit('closed');
  }
}
