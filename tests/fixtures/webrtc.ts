import { MultiplayerController } from '../../src/net/controller';
import { LobbyView } from '../../src/lobby-ui';
import { WebRTCTransport } from '../../src/net/webrtc';
import { GameSimulation } from '../../src/game/simulation';
import { HostSession, ClientSession, matchOptions } from '../../src/net/session';
import type { NetMessage, Transport, TransportStatus } from '../../src/net/transport';
import '../../src/lobby.css';

const params = new URLSearchParams(location.search);
const id = params.get('id')!;
const harness = window as any;
let transport: WebRTCTransport | null = null, sim: GameSimulation | null = null;
let host: HostSession | null = null, client: ClientSession | null = null;
let input = { moveX: 0, moveZ: 0, sprint: false, jump: false };
let blocked = false;
const received: Array<{ k: string; from: string }> = [];
class Signaling implements Transport {
  clientId = id;
  private handlers: Array<(message: NetMessage, from: string) => void> = [];
  private statuses: Array<(status: TransportStatus, detail?: string) => void> = [];
  constructor() {
    harness.__SIGNAL_RECEIVE__ = (message: NetMessage, from: string) => {
      if (!blocked) for (const fn of this.handlers) fn(message, from);
    };
    harness.__SIGNAL_STATUS__ = (status: TransportStatus) => { for (const fn of this.statuses) fn(status); };
    queueMicrotask(() => { for (const fn of this.statuses) fn('open'); });
  }
  send(message: NetMessage) { if (!blocked) void harness.rtcSignal({ message, from: id }); }
  onMessage(fn: (message: NetMessage, from: string) => void) { this.handlers.push(fn); }
  onStatus(fn: (status: TransportStatus, detail?: string) => void) { this.statuses.push(fn); }
  close() { blocked = true; }
}
const view = new LobbyView(document.getElementById('ui-root')!, {
  onCreate: name => controller.create(name), onJoin: (code, name) => controller.join(code, name),
  onStart: () => controller.start(), onLeave: () => controller.leave(), onClose: () => view.show(false),
});
const controller = new MultiplayerController(view, {
  config: () => ({ map: 'arena', botCount: 3, difficulty: 'normal' }),
  makeTransport: () => {
    blocked = false;
    transport = new WebRTCTransport(new Signaling(), params.get('role') === 'host' ? 'host' : 'client', {
      configuration: { iceServers: [] }, handshakeTimeoutMs: 2000,
      ...(params.has('no-ice') ? { peerConnection: () => {
        const pc = new RTCPeerConnection({ iceServers: [] });
        // Native SDP/data channel negotiation, but no reachable remote candidates.
        const add = pc.addIceCandidate.bind(pc);
        pc.addIceCandidate = candidate => candidate ? Promise.resolve() : add(candidate);
        const set = pc.setRemoteDescription.bind(pc);
        pc.setRemoteDescription = description => set({ ...description, sdp: description?.sdp?.replace(/^a=candidate:.*\r?\n/gm, '') });
        return pc;
      } } : {}),
    });
    transport.onMessage((message, from) => received.push({ k: message.k, from }));
    return transport;
  },
  begin: info => {
    sim = new GameSimulation(matchOptions(info.setup, info.me, info.role === 'client'));
    sim.start(); sim.botsFrozen = true;
    host = info.role === 'host' ? new HostSession(sim, info.transport, info.setup) : null;
    client = info.role === 'client' ? new ClientSession(sim, info.transport, info.hostId) : null;
    view.show(false);
  },
});
view.show(true);
let clock = performance.now();
const timer = setInterval(() => {
  const now = performance.now(), dt = Math.min(.1, (now - clock) / 1000); clock = now;
  if (!sim) return;
  sim.update(dt, input);
  if (host) { host.drainEvents(); host.tick(dt); }
  if (client) { client.tick(now, input, 0); client.frame(now); }
}, 16);
harness.__RTC_FIXTURE__ = {
  controller, get transport() { return transport; }, get sim() { return sim; }, get client() { return client; }, get host() { return host; }, received,
  move: (z: number) => { input.moveZ = z; },
  blockSignaling: () => { blocked = true; harness.__SIGNAL_STATUS__('error'); },
  close: () => { clearInterval(timer); if (host) host.close(); else if (client) client.leave(); else controller.leave(); },
};
