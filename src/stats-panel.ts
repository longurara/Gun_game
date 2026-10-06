/** The statistics screen after a match: a map of the player's route, and tables for the weapons and the highlights. */
import type { MatchSummary, RouteMode } from './match-stats';
import { WEAPONS } from './game/weapons';
import { MELEE } from './game/melee';

const OTHER_LABELS: Record<string, string> = {
  frag: 'Lựu đạn', smoke: 'Lựu đạn khói', flash: 'Lựu đạn chớp', molotov: 'Cocktail Molotov', rocket: 'Rocket', shell: 'Đạn cối',
  vehicle: 'Xe', fire: 'Lửa', fists: 'Tay không', zone: 'Vòng bo', fall: 'Ngã', khác: 'Khác',
};

/** A readable name for whatever did the harm: a gun, a melee weapon, a grenade, a vehicle... */
export function causeLabel(cause: string): string {
  if (!cause) return '—';
  if (Object.hasOwn(WEAPONS, cause)) return WEAPONS[cause as keyof typeof WEAPONS].label;
  if (Object.hasOwn(MELEE, cause)) return MELEE[cause as keyof typeof MELEE].label;
  return OTHER_LABELS[cause] ?? cause;
}

export const formatClock = (seconds: number): string => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export interface WeaponRow { label: string; shots: number; hits: number; accuracy: number | null; heads: number; damage: number; kills: number }

/** One row per weapon used, most damage first. Accuracy is hits over shots (capped at 100%), or null when nothing was fired. */
export function weaponRows(summary: MatchSummary): WeaponRow[] {
  return summary.weapons.map(line => ({
    label: causeLabel(line.weapon), shots: line.shots, hits: line.hits, heads: line.heads, damage: Math.round(line.damage), kills: line.kills,
    accuracy: line.shots > 0 ? Math.min(100, Math.round(line.hits / line.shots * 100)) : null,
  })).filter(row => row.shots > 0 || row.damage > 0 || row.kills > 0);
}

export interface Highlight { label: string; value: string }
/** The numbers worth a line of their own. */
export function highlights(summary: MatchSummary): Highlight[] {
  const out: Highlight[] = [
    { label: 'Sát thương gây ra', value: `${Math.round(summary.dealt)}` },
    { label: 'Sát thương nhận', value: `${Math.round(summary.taken)}` },
    { label: 'Bắn trúng đầu', value: `${summary.headshots}` },
  ];
  if (summary.longest > 0) out.push({ label: 'Hạ gục xa nhất', value: `${Math.round(summary.longest)} m` });
  out.push({ label: 'Quãng đường đi bộ', value: summary.walked >= 1000 ? `${(summary.walked / 1000).toFixed(1)} km` : `${Math.round(summary.walked)} m` });
  if (summary.driven > 20) out.push({ label: 'Quãng đường lái xe', value: summary.driven >= 1000 ? `${(summary.driven / 1000).toFixed(1)} km` : `${Math.round(summary.driven)} m` });
  return out;
}

const MODE_COLOR: Record<RouteMode, string> = { foot: '#8fe39a', car: '#ffb347', air: '#9bd4ff', under: '#8fa8ff' };

export interface RouteMapOptions {
  /** The map's relief and roads, already drawn at this size (the big map's backdrop); a plain grid is used without it. */
  backdrop: CanvasImageSource | null;
  halfSize: number;
  summary: MatchSummary;
  /** The last safe circle, if the map has one. */
  zone?: { x: number; z: number; r: number } | null;
}

/** Draw the route (green fading to amber with time; orange by car, dashed from the air and underground), kills numbered in red, and where the player fell. */
export function drawRouteMap(ctx: CanvasRenderingContext2D, size: number, options: RouteMapOptions): void {
  const { summary, halfSize } = options;
  const pad = 9, scale = (size - pad * 2) / (halfSize * 2);
  const mx = (x: number) => size / 2 + x * scale, my = (z: number) => size / 2 - z * scale;
  ctx.clearRect(0, 0, size, size);
  if (options.backdrop) ctx.drawImage(options.backdrop, 0, 0, size, size);
  else {
    ctx.fillStyle = '#182723'; ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = '#ffffff10'; ctx.lineWidth = 1;
    for (let i = 0; i <= 6; i++) { const p = pad + i * (size - pad * 2) / 6; ctx.beginPath(); ctx.moveTo(p, pad); ctx.lineTo(p, size - pad); ctx.moveTo(pad, p); ctx.lineTo(size - pad, p); ctx.stroke(); }
  }
  // Dim the map a little so the route stands out.
  ctx.fillStyle = '#0a110e66'; ctx.fillRect(0, 0, size, size);
  if (options.zone && options.zone.r > 0) {
    ctx.strokeStyle = '#b7dbc3'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.arc(mx(options.zone.x), my(options.zone.z), options.zone.r * scale, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  }
  const route = summary.route, total = Math.max(1, route.length > 1 ? route[route.length - 1].t - route[0].t : 1);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i];
    const mode = b.mode === 'air' || a.mode === 'air' ? 'air' : b.mode;
    const age = (b.t - route[0].t) / total;
    ctx.strokeStyle = mode === 'foot' ? `hsl(${Math.round(125 - 80 * age)} 70% 62%)` : MODE_COLOR[mode];
    ctx.lineWidth = mode === 'car' ? 3.2 : 2.4;
    ctx.setLineDash(mode === 'air' || mode === 'under' ? [2, 5] : []);
    ctx.beginPath(); ctx.moveTo(mx(a.x), my(a.z)); ctx.lineTo(mx(b.x), my(b.z)); ctx.stroke();
  }
  ctx.setLineDash([]);
  const label = (text: string, x: number, y: number, color: string) => {
    ctx.font = '700 11px "Segoe UI", Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 3; ctx.strokeStyle = '#0b100dcc'; ctx.strokeText(text, x, y); ctx.fillStyle = color; ctx.fillText(text, x, y);
  };
  const first = route[0], last = route[route.length - 1];
  if (first) { ctx.fillStyle = '#6fe08a'; ctx.strokeStyle = '#0b100d'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(mx(first.x), my(first.z), 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  summary.kills.forEach((kill, i) => {
    const x = mx(kill.x), y = my(kill.z);
    ctx.fillStyle = '#e8503a'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    label(`${i + 1}`, x, y + 0.5, '#fff');
  });
  if (summary.death) {
    const x = mx(summary.death.x), y = my(summary.death.z);
    ctx.strokeStyle = '#0b100d'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(x - 7, y - 7); ctx.lineTo(x + 7, y + 7); ctx.moveTo(x + 7, y - 7); ctx.lineTo(x - 7, y + 7); ctx.stroke();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x - 7, y - 7); ctx.lineTo(x + 7, y + 7); ctx.moveTo(x + 7, y - 7); ctx.lineTo(x - 7, y + 7); ctx.stroke();
  } else if (last && last !== first) {
    ctx.fillStyle = '#ffd24a'; ctx.strokeStyle = '#0b100d'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(mx(last.x), my(last.z), 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The weapon table and highlights as HTML for the statistics screen. */
export function statsHtml(summary: MatchSummary): { weapons: string; highlights: string; kills: string } {
  const rows = weaponRows(summary);
  const weapons = rows.length
    ? `<table class="stats-table"><thead><tr><th>VŨ KHÍ</th><th>PHÁT</th><th>TRÚNG</th><th>CHÍNH XÁC</th><th>ĐẦU</th><th>SÁT THƯƠNG</th><th>HẠ</th></tr></thead><tbody>${rows.map(r =>
      `<tr><td>${escapeHtml(r.label)}</td><td>${r.shots}</td><td>${r.hits}</td><td>${r.accuracy === null ? '—' : `${r.accuracy}%`}</td><td>${r.heads}</td><td>${r.damage}</td><td>${r.kills}</td></tr>`).join('')}</tbody></table>`
    : '<p class="stats-empty">Bạn chưa bắn phát nào trong trận này.</p>';
  const lights = `<div class="stats-lights">${highlights(summary).map(h => `<div><strong>${escapeHtml(h.value)}</strong><span>${escapeHtml(h.label)}</span></div>`).join('')}</div>`;
  const kills = summary.kills.length
    ? `<ol class="stats-kills">${summary.kills.map(k => `<li><b>${escapeHtml(k.victim)}</b> · ${escapeHtml(causeLabel(k.weapon))}${k.head ? ' · đầu' : ''} · ${Math.round(k.distance)} m <small>${formatClock(k.t)}</small></li>`).join('')}</ol>`
    : '';
  return { weapons, highlights: lights, kills };
}
