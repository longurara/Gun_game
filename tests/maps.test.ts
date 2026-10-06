import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { GameSimulation } from '../src/game/simulation.ts';
import { createMapWorld, mapData, OPEN_MAPS, zoneSeconds } from '../src/game/world.ts';
import { Lobby } from '../src/net/lobby.ts';
import { LoopbackNetwork } from '../src/net/transport.ts';
import type { RoomConfig } from '../src/net/lobby.ts';
import type { MapId } from '../src/types.ts';
import type { GameUI as GameUIType } from '../src/ui.ts';

const LONG: MapId[] = ['desert', 'pines', 'metro'];
const idle = { moveX: 0, moveZ: 0, sprint: false, jump: false };
const segDist = (x: number, z: number, a: { x: number; z: number }, b: { x: number; z: number }) => {
  const dx = b.x - a.x, dz = b.z - a.z, t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
};

test('there are five open maps, and the three long ones are generated once, the same every time', () => {
  assert.deepEqual([...OPEN_MAPS].sort(), ['desert', 'island', 'metro', 'pines', 'valley']);
  for (const id of LONG) {
    assert.equal(mapData(id), mapData(id), `${id} is cached`);
    const a = createMapWorld(id)!, b = createMapWorld(id)!;
    assert.equal(a.id, id);
    assert.deepEqual(a.towns, b.towns);
    assert.equal(a.obstacles.length, b.obstacles.length);
    assert.notEqual(a.obstacles, b.obstacles, 'each match gets its own obstacle list');
  }
  assert.equal(createMapWorld('arena'), null, 'the arena is built by hand');
});

test('the long maps last about twenty minutes: eight circles that shrink steadily and cover the whole map', () => {
  for (const id of LONG) {
    const world = createMapWorld(id)!, zone = world.zone;
    const seconds = zoneSeconds(zone);
    assert.ok(seconds >= 1100 && seconds <= 1350, `${id}: ${(seconds / 60).toFixed(1)} min`);
    assert.equal(zone.radii.length, 8);
    assert.equal(zone.waits.length, 8);
    assert.equal(zone.shrinks.length, 8);
    assert.ok(zone.radii.every((r, i) => i === 0 || r < zone.radii[i - 1]) && zone.radii.at(-1) === 0, `${id}: radii shrink to nothing`);
    assert.ok(zone.start >= world.halfSize * Math.SQRT2 - 1, `${id}: the first circle covers the corners`);
    assert.ok(zone.radii[0] < zone.start);
  }
  // The older maps keep their pace.
  assert.ok(zoneSeconds(createMapWorld('island')!.zone) < 700 && zoneSeconds(createMapWorld('valley')!.zone) < 450);
});

test('every long map has its own character: size, towns, forest, a theme, and enough to find and to drive', () => {
  const stats = new Map<string, { trees: number; cities: number; loot: number; towers: number; half: number }>();
  for (const id of LONG) {
    const w = createMapWorld(id)!;
    assert.ok(w.towns.length >= 10 && w.roads.length >= 30 && w.water!.lakes.length >= 3, `${id} is thin`);
    assert.ok(w.lootSpots.length >= 800 && w.vehicleSpawns.length >= 40 && w.spawns.length >= 250, `${id}: loot ${w.lootSpots.length}, cars ${w.vehicleSpawns.length}, spawns ${w.spawns.length}`);
    assert.ok(w.towns.every(t => Math.max(Math.abs(t.x), Math.abs(t.z)) + t.radius < w.halfSize), `${id}: a town hangs off the map`);
    assert.ok(w.theme && w.theme.haze.every(c => c > 0 && c < 1) && w.theme.fogDensity > 0 && w.theme.tint.every(c => c > 0.5 && c < 1.5), `${id} theme`);
    stats.set(id, { trees: w.obstacles.filter(o => o.kind === 'tree').length, cities: w.towns.filter(t => t.tier === 'city').length, loot: w.lootSpots.length, towers: w.floors!.filter(f => f.y0 > -30 && !f.id.startsWith('hot-')).length, half: w.halfSize });
  }
  const d = stats.get('desert')!, p = stats.get('pines')!, m = stats.get('metro')!;
  assert.ok(p.trees > d.trees * 5, `pines ${p.trees} trees against ${d.trees} in the desert`);
  assert.ok(m.cities >= 5 && m.cities > d.cities && m.towers > d.towers * 2, 'the metropolis is built up');
  assert.ok(d.half > p.half && p.half > m.half);
  assert.ok(createMapWorld('desert')!.theme!.sand > 0.5 && createMapWorld('pines')!.theme!.sand === 0);
  assert.equal(createMapWorld('island')!.theme, undefined, 'the island keeps its original look');
});

test('nothing sits on a road, in a wall or under the ground, on any long map', () => {
  for (const id of LONG) {
    const { world: w, terrain } = mapData(id)!;
    for (const o of w.obstacles) {
      if (o.kind === 'tree' || o.kind === 'floor' || (o.base ?? 0) < -30) continue;
      for (const road of w.roads) assert.ok(segDist(o.x, o.z, road.a, road.b) >= road.width / 2 + Math.min(o.width, o.depth) / 2 - 0.5, `${id}: ${o.id} sits on a road`);
    }
    const floors = w.floors ?? [];
    let buried = 0;
    for (const l of w.lootSpots) {
      if (Math.abs(l.y - terrain(l.x, l.z)) < 0.6) continue;
      if (!floors.some(f => Math.abs(l.x - f.x) <= f.width / 2 + 0.3 && Math.abs(l.z - f.z) <= f.depth / 2 + 0.3)) buried++;
    }
    assert.ok(buried <= 2, `${id}: ${buried} loot spots float or are buried`);
    for (const v of w.vehicleSpawns) assert.ok(terrain(v.x, v.z) > 1.8, `${id}: a car is parked in a hole`);
  }
});

test('a match on each long map starts, drops everyone on land and runs without trouble', () => {
  for (const id of LONG) {
    const game = new GameSimulation({ seed: 3, botCount: 100, map: id, drop: true });
    game.start();
    assert.equal(game.world.id, id);
    assert.ok(game.state.plane, `${id}: no transport plane`);
    for (let i = 0; i < 30 * 40; i++) game.update(1 / 30, idle);
    game.drainEvents();
    assert.equal(game.state.actors.length, 101);
    assert.ok(game.state.actors.every(a => [a.position.x, a.position.y, a.position.z, a.health].every(Number.isFinite)), `${id}: a bad number`);
    assert.ok(game.state.actors.every(a => Math.abs(a.position.x) <= game.world.halfSize + 5 && Math.abs(a.position.z) <= game.world.halfSize + 5), `${id}: someone left the map`);
    assert.equal(game.state.zone.radius, game.world.zone.start);
    assert.ok(game.state.zone.timeRemaining > 100, `${id}: the first circle should be a long wait`);
  }
});

test('the long maps drop supply crates three times as the circles close', () => {
  const game = new GameSimulation({ seed: 5, botCount: 30, map: 'metro', drop: true });
  game.start();
  game.botsFrozen = true;
  const stages = new Set<number>();
  let crates = 0;
  for (let i = 0; i < 30 * 60 * 20 && game.state.zone.stage < 7; i++) {
    game.update(1 / 30, idle);
    for (const e of game.drainEvents()) if (e.type === 'airdrop' && e.stage === 'incoming') { crates++; stages.add(game.state.zone.stage); }
    game.player.health = 100; game.player.alive = true;
  }
  assert.ok(crates >= 3, `${crates} crates`);
  assert.deepEqual([...stages].sort(), [1, 3, 5]);
});

test('a room can host any long map: it travels to everyone, with the drop switched on', () => {
  for (const map of LONG) {
    const cfg: RoomConfig = { map, botCount: 50, difficulty: 'normal' };
    const net = new LoopbackNetwork({ latency: 30 }, 5);
    const host = new Lobby(net.connect('host0000'), 'Hana', 'host', cfg, () => 0.1);
    const guest = new Lobby(net.connect('guest000'), 'Minh', 'client', { ...cfg, map: 'island' });
    for (let i = 0; i < 40; i++) { net.advance(100); host.tick(net.now); guest.tick(net.now); }
    assert.equal(guest.config.map, map, 'the guest sees the host\'s map');
    const setup = host.start(net.now)!;
    assert.equal(setup.map, map);
    assert.equal(setup.drop, true);
  }
});

let GameUI: typeof GameUIType;
let dom: JSDOM;
before(async () => {
  dom = new JSDOM('<!doctype html><html><body><div id="ui-root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, HTMLElement: dom.window.HTMLElement });
  ({ GameUI } = await import('../src/ui.ts'));
});

test('the menu offers every map, shows its time and size, and keeps the choice', () => {
  const ui = new GameUI({ onStart() {}, onResume() {}, onRestart() {}, onMenu() {}, onSettings() {}, onSelectWeapon() {} });
  const doc = dom.window.document;
  const tabs = [...doc.querySelectorAll<HTMLButtonElement>('#map-choice button')].map(b => b.dataset.value);
  assert.deepEqual(tabs.sort(), ['arena', 'desert', 'island', 'metro', 'pines', 'range', 'valley']);
  const click = (value: string) => doc.querySelector<HTMLButtonElement>(`#map-choice button[data-value="${value}"]`)!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  click('desert');
  assert.equal(ui.settings.map, 'desert');
  assert.equal(ui.settings.botCount, 100);
  assert.match(doc.getElementById('preview-title')!.textContent!, /SA MẠC/);
  assert.match(doc.getElementById('preview-time')!.textContent!, /20/);
  assert.match(doc.getElementById('preview-size')!.textContent!, /5/);
  click('metro');
  assert.equal(ui.settings.map, 'metro');
  const again = new GameUI({ onStart() {}, onResume() {}, onRestart() {}, onMenu() {}, onSettings() {}, onSelectWeapon() {} });
  assert.equal(again.settings.map, 'metro', 'the choice is remembered');
  localStorage.setItem('lastlight.settings.v1', JSON.stringify({ map: 'constructor' }));
  assert.equal(new GameUI({ onStart() {}, onResume() {}, onRestart() {}, onMenu() {}, onSettings() {}, onSelectWeapon() {} }).settings.map, 'island', 'junk falls back to the island');
});
