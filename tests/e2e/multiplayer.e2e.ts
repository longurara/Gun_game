/**
 * Three real browsers play one match through Supabase Realtime (the project's public broadcast service): create a room,
 * join it with the code, start, move, shoot, die, win. Needs Edge or Chrome and an internet connection.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import { chromium } from 'playwright-core';
import type { Browser, BrowserContext, Page } from 'playwright-core';

let server: ViteDevServer;
let browser: Browser;
let url = '';

function browserExecutable(): string | undefined {
  return [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].find(path => existsSync(path));
}

before(async () => {
  server = await createServer({ root: process.cwd(), cacheDir: mkdtempSync(join(tmpdir(), 'lastlight-vite-')), logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  const address = server.httpServer!.address();
  url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 5173}/`;
  const executablePath = browserExecutable();
  assert.ok(executablePath, 'install Microsoft Edge or Google Chrome to run the end-to-end tests');
  browser = await chromium.launch({ executablePath, headless: true });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

type Game = { simulation: any; net: () => any };
const game = (page: Page) => <T>(fn: (g: Game) => T) => page.evaluate(fn as never) as Promise<T>;

interface Player { page: Page; context: BrowserContext; errors: string[]; ev: <T>(fn: (g: Game) => T) => Promise<T> }

async function newPlayer(): Promise<Player> {
  const context = await browser.newContext({ viewport: { width: 1000, height: 600 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.waitForSelector('#multi-button', { state: 'visible' });
  const evaluate = <T>(fn: (g: Game) => T) => page.evaluate(`(${fn.toString()})(window.__LASTLIGHT__)`) as Promise<T>;
  return { page, context, errors, ev: evaluate };
}

const waitFor = async (what: string, check: () => Promise<boolean>, timeoutMs = 30000) => {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { if (await check()) return; await new Promise(r => setTimeout(r, 250)); }
  assert.fail(`timed out waiting for ${what}`);
};

test('three players meet in a room, start together, see each other move, shoot, die and the last one standing wins', { timeout: 150000 }, async () => {
  const [host, minh, lan] = [await newPlayer(), await newPlayer(), await newPlayer()];
  try {
    // The host chooses the small arena (fast to load) before opening the lobby.
    { await host.page.click('#map-picker'); await host.page.click('#map-choice button[data-value="arena"]'); }
    await host.page.click('#multi-button');
    await host.page.fill('#mp-name', 'Hana');
    await host.page.click('#mp-create');
    await host.page.waitForFunction(() => /^[A-Z0-9]{5}$/.test(document.querySelector('#mp-room-code')?.textContent ?? ''));
    const code = (await host.page.textContent('#mp-room-code'))!;
    assert.match(code, /^[A-HJ-NP-Z2-9]{5}$/);

    for (const [player, name] of [[minh, 'Minh'], [lan, 'Lan']] as const) {
      await player.page.click('#multi-button');
      await player.page.fill('#mp-name', name);
      await player.page.fill('#mp-code', code);
      await player.page.click('#mp-join');
    }
    // Everyone sees all three names.
    for (const player of [host, minh, lan]) {
      await player.page.waitForFunction(() => document.querySelectorAll('#mp-players li').length === 3, undefined, { timeout: 40000 });
    }
    const names = await host.page.$$eval('#mp-players li b', items => items.map(item => item.textContent));
    assert.deepEqual(names.slice().sort(), ['Hana', 'Lan', 'Minh']);
    assert.equal(await minh.page.isVisible('#mp-start'), false, 'only the host can start');

    await host.page.click('#mp-start');
    for (const player of [host, minh, lan]) {
      await waitFor('the match to begin', async () => await player.ev(g => !!g?.simulation && g.simulation.state.phase === 'playing' && g.simulation.multiplayer), 40000);
    }
    const ids = await Promise.all([host, minh, lan].map(p => p.ev(g => g.simulation.localId)));
    assert.deepEqual(ids.slice().sort(), ['p0', 'p1', 'p2']);
    assert.equal(ids[0], 'p0', 'the host is the first human');
    for (const player of [host, minh, lan]) assert.deepEqual(await player.ev(g => g.simulation.humans.map((h: any) => h.name).slice().sort()), ['Hana', 'Lan', 'Minh']);
    assert.equal(await host.ev(g => g.net().role), 'host');
    assert.equal(await minh.ev(g => g.net().role), 'client');

    // Put everybody in the open, facing each other, on every machine (the host is the authority; clients are told).
    const place = (id: string, x: number, z: number) => `(g) => { const a = g.simulation.actorById('${id}'); a.position = { x: ${x}, y: 0, z: ${z} }; }`;
    for (const player of [host, minh, lan]) {
      await player.page.evaluate(`(${place('p0', -60, -22)})(window.__LASTLIGHT__)`);
      await player.page.evaluate(`(${place('p1', -40, -22)})(window.__LASTLIGHT__)`);
      await player.page.evaluate(`(${place('p2', -20, -22)})(window.__LASTLIGHT__)`);
    }
    await host.ev(g => { g.simulation.botsFrozen = true; });
    const clientIdOf = async (player: Player) => player.ev(g => g.simulation.localId);
    const [mid, lid] = await Promise.all([clientIdOf(minh), clientIdOf(lan)]);
    const attacker = mid === 'p1' ? minh : lan, victim = mid === 'p1' ? lan : minh, victimId = mid === 'p1' ? 'p2' : 'p1', attackerId = mid === 'p1' ? 'p1' : 'p2';
    void lid;

    // Movement: the attacker walks forward; the host's copy and the victim's copy both see it.
    await attacker.page.bringToFront();
    const before = await host.ev(g => 0) ?? 0; void before;
    const startX = await host.page.evaluate(`window.__LASTLIGHT__.simulation.actorById('${attackerId}').position.x`) as number;
    await attacker.page.keyboard.down('KeyD');
    await attacker.page.waitForTimeout(2500);
    await attacker.page.keyboard.up('KeyD');
    await attacker.page.waitForTimeout(800);
    const hostSees = await host.page.evaluate(`window.__LASTLIGHT__.simulation.actorById('${attackerId}').position`) as { x: number; z: number };
    const victimSees = await victim.page.evaluate(`window.__LASTLIGHT__.simulation.actorById('${attackerId}').position`) as { x: number; z: number };
    const moved = Math.hypot(hostSees.x - startX, 0);
    const own = await attacker.page.evaluate(`window.__LASTLIGHT__.simulation.player.position`) as { x: number; z: number };
    assert.ok(Math.hypot(own.x - startX, 0) > 3 || Math.abs(own.z + 22) > 3, `the attacker moved on their own screen (${JSON.stringify(own)})`);
    assert.ok(Math.hypot(hostSees.x - own.x, hostSees.z - own.z) < 4, `the host agrees where the attacker is: ${JSON.stringify(hostSees)} vs ${JSON.stringify(own)}`);
    assert.ok(Math.hypot(victimSees.x - own.x, victimSees.z - own.z) < 5, 'and the victim sees the attacker in about the same place');
    void moved;

    // Shooting: the attacker fires at the victim until they are dead (the real client path: predicted shot + report to the host).
    const shoot = `(() => { const L = window.__LASTLIGHT__; const s = L.simulation; const v = s.actorById('${victimId}'); const t = { x: v.position.x, y: v.position.y + 1.0, z: v.position.z };
      s.player.ammo[s.player.weapon] = 30; if (s.shootPlayer(t, true)) { const c = L.net().client; if (c) c.queueFire(t, true); } return s.player.ammo[s.player.weapon]; })()`;
    // Make sure the victim is within the rifle's range of the attacker on the host's world, then fire.
    for (const p of [host, minh, lan]) await p.page.evaluate(`(() => { const s = window.__LASTLIGHT__.simulation; s.actorById('${attackerId}').position = { x: -60, y: 0, z: -22 }; s.actorById('${victimId}').position = { x: -60, y: 0, z: -2 }; })()`);
    await host.page.waitForTimeout(600);
    for (let i = 0; i < 40; i++) {
      await attacker.page.evaluate(shoot);
      await attacker.page.waitForTimeout(220);
      const health = await host.page.evaluate(`window.__LASTLIGHT__.simulation.actorById('${victimId}').health`) as number;
      if (health <= 0) break;
    }
    const victimHealthOnHost = await host.page.evaluate(`window.__LASTLIGHT__.simulation.actorById('${victimId}').health`) as number;
    assert.equal(victimHealthOnHost, 0, 'the host killed the victim');
    await waitFor('the victim to know they are dead', async () => await victim.ev(g => !g.simulation.player.alive), 15000);
    await waitFor('the victim to start watching', async () => await victim.page.isVisible('#spectate-bar'), 10000);
    assert.equal(await victim.ev(g => g.simulation.state.phase), 'playing', 'the match goes on for the others');
    assert.equal(await attacker.ev(g => g.simulation.state.kills), 1, 'the attacker is credited with the kill');
    assert.deepEqual(await attacker.page.$$eval('#kill-feed *', els => els.length > 0), true, 'a kill feed line appeared');

    // The host removes the rest (bots and the last human) so the attacker wins.
    await host.ev(g => { for (const a of g.simulation.state.actors) if (a.id !== 'p0' && a.alive) { /* keep */ } });
    await host.page.evaluate(`(() => { const s = window.__LASTLIGHT__.simulation; for (const a of s.state.actors) if (a.id !== '${attackerId}' && a.alive) s.eliminate(a.id); })()`);
    await waitFor('the attacker to win', async () => await attacker.ev(g => g.simulation.state.phase === 'won'), 15000);
    await attacker.page.waitForSelector('#result-screen', { state: 'visible', timeout: 10000 });
    for (const player of [host, minh, lan]) {
      await waitFor('everybody to see the end', async () => await player.ev(g => g.simulation.state.phase !== 'playing'), 15000);
    }
    const loserTitle = await victim.page.textContent('#result-title');
    assert.match(loserTitle ?? '', /CHIẾN THẮNG/, 'the others are told who won');
    assert.equal(await attacker.page.textContent('#result-title'), 'NGƯỜI SỐNG CUỐI.');

    for (const player of [host, minh, lan]) assert.deepEqual(player.errors, [], 'no page errors');
  } finally {
    for (const player of [host, minh, lan]) await player.context.close();
  }
});

test('joining a room that does not exist says so; a malformed code is rejected before any network call', { timeout: 60000 }, async () => {
  const player = await newPlayer();
  try {
    await player.page.click('#multi-button');
    await player.page.fill('#mp-code', 'AB');
    await player.page.click('#mp-join');
    assert.match(await player.page.textContent('#mp-error') ?? '', /5 ký tự/);
    await player.page.fill('#mp-code', 'ZZZZ9');
    await player.page.click('#mp-join');
    await player.page.waitForFunction(() => /Không tìm thấy phòng/.test(document.querySelector('#mp-error')?.textContent ?? ''), undefined, { timeout: 30000 });
    assert.equal(await player.page.isVisible('#mp-error'), true);
    // Leaving brings back the entry form.
    await player.page.click('#mp-leave');
    assert.equal(await player.page.isVisible('#lobby-screen'), false);
  } finally {
    await player.context.close();
  }
});

test('a shared link opens the lobby with the room code filled in', { timeout: 60000 }, async () => {
  const context = await browser.newContext({ viewport: { width: 1000, height: 600 } });
  const page = await context.newPage();
  await page.goto(`${url}?room=ab-c9z`);
  await page.waitForSelector('#lobby-screen', { state: 'visible' });
  assert.equal(await page.inputValue('#mp-code'), 'ABC9Z');
  await context.close();
});

test('the drop online: two players ride the same plane, one jumps and lands by parachute, the host agrees where they came down', { timeout: 150000 }, async () => {
  const [host, guest] = [await newPlayer(), await newPlayer()];
  try {
    { await host.page.click('#map-picker'); await host.page.click('#map-choice button[data-value="valley"]'); }
    await host.page.click('#multi-button');
    await host.page.fill('#mp-name', 'Hana');
    await host.page.click('#mp-create');
    await host.page.waitForFunction(() => /^[A-Z0-9]{5}$/.test(document.querySelector('#mp-room-code')?.textContent ?? ''));
    const code = (await host.page.textContent('#mp-room-code'))!;
    await guest.page.click('#multi-button');
    await guest.page.fill('#mp-name', 'Minh');
    await guest.page.fill('#mp-code', code);
    await guest.page.click('#mp-join');
    await host.page.waitForFunction(() => document.querySelectorAll('#mp-players li').length === 2, undefined, { timeout: 40000 });
    await host.page.click('#mp-start');
    await waitFor('the match', async () => await guest.ev(g => !!g?.simulation && g.simulation.state.phase === 'playing' && g.simulation.multiplayer), 40000);
    // Both start in the plane, on both machines, and the flight readout is on screen.
    for (const player of [host, guest]) {
      assert.deepEqual(await player.ev(g => g.simulation.humans.map((h: any) => h.air?.mode)), ['plane', 'plane']);
      assert.equal(await player.page.isVisible('#air-hud'), true);
      assert.equal(await player.page.isVisible('#crosshair'), false, 'no crosshair in the plane');
    }
    await guest.page.waitForTimeout(2000);
    // The guest jumps with the real key; the host sees them fall while the host is still aboard.
    await guest.page.bringToFront();
    await guest.page.keyboard.press('Space');
    await waitFor('the guest to be falling on the host', async () => (await host.ev(g => g.simulation.actorById('p1').air?.mode)) === 'freefall', 10000);
    assert.equal(await host.ev(g => g.simulation.actorById('p0').air?.mode), 'plane', 'the host has not jumped');
    assert.equal(await guest.ev(g => g.simulation.player.air?.mode), 'freefall');
    // Wait for the parachute landing (a couple of dozen seconds), checking nothing breaks on the way.
    await waitFor('the guest to land', async () => (await guest.ev(g => g.simulation.player.air)) === null, 90000);
    await guest.page.waitForTimeout(1500);
    const a = await guest.page.evaluate(`window.__LASTLIGHT__.simulation.player.position`) as { x: number; y: number; z: number };
    const b = await host.page.evaluate(`window.__LASTLIGHT__.simulation.actorById('p1').position`) as { x: number; y: number; z: number };
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 8, `landing spots agree: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
    assert.equal(await host.ev(g => g.simulation.actorById('p1').air), null, 'the host landed them too');
    assert.equal(await guest.page.isVisible('#crosshair'), true, 'the gun HUD is back after landing');
    assert.equal(await guest.page.evaluate(() => document.documentElement.hasAttribute('data-air')), false);
    assert.deepEqual(guest.errors, []);
    assert.deepEqual(host.errors, []);
  } finally {
    await host.context.close();
    await guest.context.close();
  }
});

test('phone layout of the lobby: the name, room code, player list and start button are all on screen without scrolling', { timeout: 60000 }, async () => {
  const context = await browser.newContext({ viewport: { width: 740, height: 360 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.goto(url);
  await page.waitForSelector('#multi-button');
  await page.tap('#multi-button');
  await page.fill('#mp-name', 'Hana');
  await page.tap('#mp-create');
  await page.waitForFunction(() => /^[A-Z0-9]{5}$/.test(document.querySelector('#mp-room-code')?.textContent ?? ''));
  const rects = await page.evaluate(() => Object.fromEntries(['#mp-name', '#mp-room-code', '#mp-players', '#mp-start', '#mp-leave'].map(sel => { const r = document.querySelector(sel)!.getBoundingClientRect(); return [sel, { top: r.top, bottom: r.bottom, left: r.left, right: r.right }]; })));
  for (const [selector, r] of Object.entries(rects)) assert.ok(r.top >= 0 && r.bottom <= 361 && r.left >= 0 && r.right <= 741, `${selector} is off screen: ${JSON.stringify(r)}`);
  await context.close();
});
