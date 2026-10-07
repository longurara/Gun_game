import type { PeerStats } from './net/webrtc';

type Link = Pick<PeerStats, 'state' | 'rttMs' | 'route'>;

/** Round-trip time measured by the gameplay DataChannel, not the signaling socket. */
export function signalMarkup(link: Link): string {
  const ping = link.rttMs === null || !Number.isFinite(link.rttMs) ? null : Math.max(0, Math.round(link.rttMs));
  const measured = link.state === 'open' && ping !== null;
  const bars = measured ? ping <= 100 ? 4 : ping <= 180 ? 3 : ping <= 300 ? 2 : 1 : 0;
  const quality = link.state === 'failed' ? 'offline' : !measured ? 'pending' : bars >= 3 ? 'good' : bars === 2 ? 'fair' : 'poor';
  const label = link.state === 'failed' ? 'Mất kết nối' : link.state !== 'open' ? 'Đang kết nối' : ping === null ? 'Đang đo ping' : `Ping ${ping} mili giây`;
  const value = link.state === 'failed' ? 'OFF' : measured ? `${ping}<span class="net-signal-unit">ms</span>` : '…';
  const rectangles = [5, 8, 11, 14].map((height, index) => `<rect x="${index * 5}" y="${15 - height}" width="3" height="${height}" rx=".6" opacity="${index < bars ? 1 : .22}"/>`).join('');
  return `<span class="net-signal" data-quality="${quality}" role="img" aria-label="${label}" title="${label}"><svg viewBox="0 0 19 16" aria-hidden="true">${rectangles}${link.state === 'failed' ? '<path d="M1 1 18 15" stroke="currentColor" stroke-width="1.5"/>' : ''}</svg><span class="net-signal-value" aria-hidden="true">${value}</span></span>`;
}

/** Hosts show the worst link; an unmeasured or failing peer must not look healthy. */
export function networkBadgeMarkup(links: readonly PeerStats[], isHost: boolean): string {
  if (!links.length) return '';
  const link = links.find(p => p.state === 'failed') ?? links.find(p => p.state !== 'open') ??
    links.find(p => p.rttMs === null) ?? links.reduce((worst, p) => (p.rttMs ?? 0) > (worst.rttMs ?? 0) ? p : worst);
  const route = links.some(p => p.route === 'relay') ? 'TURN' : links.every(p => p.route === 'direct') ? 'P2P' : 'ONLINE';
  return `${signalMarkup(link)}<span class="network-badge-route">${isHost ? 'HOST · ' : ''}${route}</span>`;
}
