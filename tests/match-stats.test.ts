import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameSimulation } from '../src/game/simulation.ts';
import { MatchStats } from '../src/match-stats.ts';
import { causeLabel, drawRouteMap, highlights, statsHtml, weaponRows } from '../src/stats-panel.ts';
import { FIRING_Z } from '../src/game/range.ts';
import type { GameEvent } from '../src/types.ts';

const ctx = (t = 0) => ({ localId: 'player', t, nameOf: (id: string) => (id === 'bot-3' ? 'Kẻ <thù> & "bạn"' : id) });
const at = (x: number, z: number) => ({ x, y: 0, z });

test('the sim says what did the harm: a gun, its headshot, and where the victim fell and the killer stood', () => {
  const game = new GameSimulation({ seed: 4, botCount: 0, map: 'range' });
  game.start();
  const dummy = game.state.actors.find(a => a.dummy && Math.abs(a.position.z - (FIRING_Z + 15)) < 1)!;
  const events: GameEvent[] = [];
  for (let i = 0; i < 40 && dummy.alive; i++) {
    game.player.yaw = Math.atan2(dummy.position.x - game.player.position.x, dummy.position.z - game.player.position.z);
    game.shootPlayer({ x: dummy.position.x, y: 1.72, z: dummy.position.z }, true);
    game.update(0.3, { moveX: 0, moveZ: 0, sprint: false, jump: false });
    events.push(...game.drainEvents());
  }
  const damage = events.filter(e => e.type === 'damage' && e.sourceId === 'player');
  assert.ok(damage.length > 0 && damage.every(e => e.type === 'damage' && e.cause === game.player.weapon), 'every hit names the gun');
  assert.ok(damage.some(e => e.type === 'damage' && e.head), 'a shot at head height is a headshot');
  const kill = events.find(e => e.type === 'kill' && e.actorId === dummy.id);
  assert.ok(kill && kill.type === 'kill' && kill.killerId === 'player' && kill.cause === game.player.weapon);
  assert.ok(kill.type === 'kill' && kill.at && Math.abs(kill.at.z - dummy.position.z) < 1e-6 && kill.from && Math.abs(kill.from.z - game.player.position.z) < 1e-6);
});

test('statistics: shots and hits per weapon, damage, headshots, kills with their distance, and the longest', () => {
  const stats = new MatchStats();
  const fire = (weapon: 'rifle' | 'sniper', hit: boolean) => stats.event({ type: 'shot', actorId: 'player', weapon, from: at(0, 0), to: at(0, 10), ...(hit ? { hitId: 'bot-1' } : {}) }, ctx());
  for (let i = 0; i < 10; i++) fire('rifle', i < 4);
  fire('sniper', true);
  stats.event({ type: 'shot', actorId: 'bot-2', weapon: 'rifle', from: at(0, 0), to: at(5, 5) }, ctx());
  stats.event({ type: 'damage', actorId: 'bot-1', amount: 30, sourceId: 'player', cause: 'rifle' }, ctx());
  stats.event({ type: 'damage', actorId: 'bot-1', amount: 50, sourceId: 'player', cause: 'rifle', head: true }, ctx());
  stats.event({ type: 'damage', actorId: 'bot-9', amount: 99, sourceId: 'bot-2', cause: 'rifle' }, ctx());
  stats.event({ type: 'kill', actorId: 'bot-1', killerId: 'player', cause: 'sniper', head: true, at: at(300, 400), from: at(0, 0) }, ctx(61));
  stats.event({ type: 'kill', actorId: 'bot-3', killerId: 'player', cause: 'rifle', at: at(30, 40), from: at(0, 0) }, ctx(80));
  stats.event({ type: 'throw', actorId: 'player', kind: 'frag', from: at(0, 0), to: at(8, 8) }, ctx());
  stats.event({ type: 'damage', actorId: 'bot-4', amount: 40, sourceId: 'player', cause: 'frag' }, ctx());
  stats.event({ type: 'melee', actorId: 'player', at: at(0, 0), weapon: 'fists', hitId: 'bot-4' }, ctx());
  stats.event({ type: 'damage', actorId: 'bot-4', amount: 8, sourceId: 'player', cause: 'fists' }, ctx());
  const s = stats.summary();
  const line = (w: string) => s.weapons.find(l => l.weapon === w)!;
  assert.deepEqual([line('rifle').shots, line('rifle').hits, line('rifle').heads, line('rifle').damage, line('rifle').kills], [10, 4, 1, 80, 1], 'another soldier\'s shots do not count');
  assert.deepEqual([line('sniper').shots, line('sniper').hits, line('sniper').kills], [1, 1, 1]);
  assert.deepEqual([line('frag').shots, line('frag').hits, line('frag').damage], [1, 1, 40], 'a grenade counts its hits when it hurts someone');
  assert.deepEqual([line('fists').shots, line('fists').hits], [1, 1], 'a punch is counted once, from the swing');
  assert.equal(s.dealt, 128);
  assert.equal(s.headshots, 1);
  assert.equal(s.kills.length, 2);
  assert.equal(Math.round(s.longest), 500, 'the 300/400 kill is 500 m away');
  assert.equal(s.kills[0].t, 61);
  assert.equal(s.kills[1].victim, 'Kẻ <thù> & "bạn"');
  assert.equal(s.weapons[0].weapon, 'rifle', 'most damage first');
});

test('statistics: damage taken, and where and to whom the player fell', () => {
  const stats = new MatchStats();
  stats.event({ type: 'damage', actorId: 'player', amount: 40, sourceId: 'bot-3', cause: 'shotgun' }, ctx());
  stats.event({ type: 'damage', actorId: 'player', amount: 60, sourceId: 'bot-3', cause: 'shotgun' }, ctx());
  stats.event({ type: 'kill', actorId: 'player', at: at(12, -7) }, ctx(200));
  stats.event({ type: 'kill', actorId: 'player', at: at(99, 99) }, ctx(300));
  const s = stats.summary();
  assert.equal(s.taken, 100);
  assert.deepEqual(s.death, { t: 200, x: 12, z: -7, killer: 'Kẻ <thù> & "bạn"', cause: 'shotgun' }, 'the first fall counts, and the last blow names the killer');
  const zone = new MatchStats();
  zone.event({ type: 'kill', actorId: 'player', at: at(1, 1), cause: 'zone' }, ctx(50));
  assert.equal(zone.summary().death!.killer, 'Vòng bo');
});

test('the route is a point every couple of seconds, closed at the end, and tells foot from car', () => {
  const stats = new MatchStats();
  for (let t = 0; t <= 20; t += 0.1) stats.sample(t, { x: t * 5, z: 0 }, t < 10 ? 'foot' : 'car');
  stats.finish(20.05, { x: 100.25, z: 0 }, 'car');
  const s = stats.summary();
  assert.ok(s.route.length >= 10 && s.route.length <= 13, `${s.route.length} points`);
  assert.equal(s.route[s.route.length - 1].t, 20.05);
  assert.ok(s.walked > 40 && s.walked < 60, `walked ${s.walked}`);
  assert.ok(s.driven > 40 && s.driven < 60, `driven ${s.driven}`);
  stats.finish(20.05, { x: 1, z: 1 }, 'car');
  assert.equal(stats.summary().route.length, s.route.length, 'closing twice adds nothing');
  stats.reset();
  assert.deepEqual(stats.summary().route, []);
});

test('the panel: labels, rows without idle weapons, escaped names, and a map that draws every mark', () => {
  assert.equal(causeLabel('rifle'), 'AR-26');
  assert.equal(causeLabel('frag'), 'Lựu đạn');
  assert.equal(causeLabel('vehicle'), 'Xe');
  assert.equal(causeLabel('nonsense'), 'nonsense');
  const stats = new MatchStats();
  stats.event({ type: 'shot', actorId: 'player', weapon: 'rifle', from: at(0, 0), to: at(0, 5), hitId: 'x' }, ctx());
  stats.event({ type: 'kill', actorId: 'bot-3', killerId: 'player', cause: 'rifle', at: at(30, 40), from: at(0, 0) }, ctx(10));
  stats.sample(0, { x: 0, z: 0 }, 'air'); stats.sample(3, { x: 10, z: 10 }, 'foot'); stats.sample(6, { x: 20, z: 5 }, 'car');
  stats.event({ type: 'kill', actorId: 'player', killerId: 'bot-3', at: at(25, 5), cause: 'rifle' }, ctx(9));
  const summary = stats.summary();
  const rows = weaponRows(summary);
  assert.deepEqual(rows.map(r => [r.label, r.shots, r.hits, r.accuracy, r.kills]), [['AR-26', 1, 1, 100, 1]]);
  const html = statsHtml(summary);
  assert.ok(html.kills.includes('Kẻ &lt;thù&gt; &amp; &quot;bạn&quot;') && !html.kills.includes('<thù>'), 'names are escaped');
  assert.ok(highlights(summary).some(h => h.label.includes('xa nhất') && h.value === '50 m'));
  assert.ok(statsHtml(new MatchStats().summary()).weapons.includes('chưa bắn'));
  // A recording canvas: every call is noted.
  const calls: string[] = [];
  const proxy = new Proxy({}, { get: (_t, name) => (name === 'canvas' ? {} : (...args: unknown[]) => { calls.push(`${String(name)}`); void args; }), set: () => true });
  drawRouteMap(proxy as unknown as CanvasRenderingContext2D, 400, { backdrop: null, halfSize: 100, summary, zone: { x: 0, z: 0, r: 60 } });
  assert.ok(calls.filter(c => c === 'stroke').length >= 5, 'segments, the zone and the death mark are drawn');
  assert.ok(calls.includes('fillText'), 'kills are numbered');
});
