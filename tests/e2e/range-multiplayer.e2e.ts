import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import type { Page, WebSocketRoute } from 'playwright-core';

test('three production browsers train together over native P2P with personal loadouts, drills and respawns', { timeout: 180000 }, async () => {
  const server = await createServer({ envFile: false, cacheDir: mkdtempSync(join(tmpdir(), 'range-multiplayer-')), logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
  await server.listen(); const url = `http://127.0.0.1:${(server.httpServer!.address() as any).port}`;
  const browser = await chromium.launch({ executablePath: ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync), headless: true });
  const pages: Page[] = [], sockets = new Map<WebSocketRoute, string>(), errors: string[] = [];
  mkdirSync('output/playwright', { recursive: true });
  try {
    for (let index = 0; index < 3; index++) {
      const page = await browser.newPage({ viewport: { width: index === 2 ? 390 : 1280, height: 844 }, hasTouch: index === 2, isMobile: index === 2 }); pages.push(page);
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*.supabase.co/**', route => route.abort());
      await page.routeWebSocket('**/realtime/v1/websocket*', socket => {
        sockets.set(socket, ''); socket.onClose(() => sockets.delete(socket));
        socket.onMessage(data => {
          let joinRef: string | null, ref: string | null, topic: string, event: string, payload: any;
          if (typeof data === 'string') [joinRef, ref, topic, event, payload] = JSON.parse(data);
          else {
            const lengths = [data[1], data[2], data[3], data[4], data[5]]; let offset = 7;
            const fields = lengths.map(length => { const value = data.subarray(offset, offset + length).toString(); offset += length; return value; });
            [joinRef, ref, topic] = fields; event = 'broadcast'; payload = { event: fields[3], payload: JSON.parse(data.subarray(offset).toString()) };
          }
          if (event === 'phx_join') sockets.set(socket, topic);
          if (['phx_join', 'heartbeat', 'phx_leave'].includes(event)) { socket.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }])); return; }
          if (event === 'broadcast') for (const [other, joined] of sockets) if (other !== socket && joined === topic) other.send(JSON.stringify([null, null, topic, 'broadcast', payload]));
        });
      });
      await page.addInitScript(index => {
        localStorage.setItem('lastlight.settings.v1', JSON.stringify({ map: 'range', botCount: 0, quality: 'low' }));
        localStorage.setItem('lastlight.name.v1', ['Host', 'Minh', 'Lan'][index]);
      }, index);
      await page.goto(url, { waitUntil: 'commit' });
      await page.waitForFunction(() => !!(window as any).__LASTLIGHT__, undefined, { timeout: 60000 });
      if (!index) { await page.click('#map-choice button[data-value="range"]'); await page.click('#bot-choice button[data-value="0"]'); }
      await page.click('#multi-button');
    }
    const [host, guest, mobile] = pages;
    await host.click('#mp-create'); const code = (await host.locator('#mp-room-code').textContent())!;
    assert.match((await host.locator('#mp-config').textContent())!, /Trường bắn · 0 bot/);
    for (const page of [guest, mobile]) { await page.fill('#mp-code', code); await page.click('#mp-join'); }
    await host.waitForFunction(() => document.querySelectorAll('#mp-players li').length === 3 && !(document.querySelector('#mp-start') as HTMLButtonElement).disabled, undefined, { timeout: 20000 });
    await host.click('#mp-start');
    await Promise.all(pages.map(page => page.waitForFunction(() => (window as any).__LASTLIGHT__.simulation.state.phase === 'playing', undefined, { timeout: 60000 })));
    for (const [index, page] of pages.entries()) {
      const state = await page.evaluate(() => { const s = (window as any).__LASTLIGHT__.simulation; return { map: s.world.id, id: s.localId, humans: s.humans.map((a: any) => a.name), drop: !!s.state.plane }; });
      assert.deepEqual(state, { map: 'range', id: `p${index}`, humans: ['Host', 'Minh', 'Lan'], drop: false });
    }
    await guest.keyboard.press('t'); await mobile.tap('[data-drill="moving"]');
    await host.waitForFunction(() => { const s = (window as any).__LASTLIGHT__.simulation; return s.actorById('p1').practice.drill?.id === 'warm' && s.actorById('p2').practice.drill?.id === 'moving'; });
    await guest.keyboard.press('b'); await guest.click('#armoury-grid button[data-weapon="pistol"]'); await guest.click('#armoury-close');
    await host.waitForFunction(() => (window as any).__LASTLIGHT__.simulation.actorById('p1').weapon === 'pistol');
    await mobile.tap('#range-immortal');
    await host.waitForFunction(() => (window as any).__LASTLIGHT__.simulation.actorById('p2').practice.immortal);
    assert.equal(await host.evaluate(() => (window as any).__LASTLIGHT__.simulation.player.practice.immortal), false);
    const before = await host.evaluate(() => (window as any).__LASTLIGHT__.simulation.actorById('p1').position.z);
    await guest.keyboard.down('w'); await guest.waitForTimeout(700); await guest.keyboard.up('w');
    await host.waitForFunction(z => (window as any).__LASTLIGHT__.simulation.actorById('p1').position.z > z + 1, before);
    // Place only the guest beside a counting target, then fire through the actual client session.
    const target = await host.evaluate(() => {
      const s = (window as any).__LASTLIGHT__.simulation, t = s.actorById('dummy-3-15'), p = s.actorById('p1');
      t.health = 1;
      p.position = { x: t.position.x, y: 0, z: t.position.z - 8 }; p.yaw = 0;
      return { x: t.position.x, y: 1.1, z: t.position.z };
    });
    await guest.waitForFunction(z => Math.abs((window as any).__LASTLIGHT__.simulation.player.position.z - (z - 8)) < 1, target.z);
    await guest.evaluate(() => {
      const sim = (window as any).__LASTLIGHT__.simulation;
      (window as any).__COUNT_OVERRUNS__ = [];
      for (const field of ['hits', 'kills']) {
        let count = sim.state[field];
        Object.defineProperty(sim.state, field, { configurable: true,
          get() { return count; },
          set(value) {
            count = value;
            const authoritative = field === 'hits' ? sim.player.practice.hits : sim.player.kills ?? 0;
            if (value > authoritative) (window as any).__COUNT_OVERRUNS__.push({ field, value, authoritative });
          },
        });
      }
    });
    await guest.evaluate(target => { const h = (window as any).__LASTLIGHT__; h.simulation.shootPlayer(target, true); h.net().client.queueFire(target, true); }, target);
    await guest.waitForFunction(() => (window as any).__LASTLIGHT__.simulation.state.drill?.score > 0);
    const overcounts = await guest.evaluate(() => (window as any).__COUNT_OVERRUNS__);
    assert.deepEqual(overcounts, [], 'authoritative range hit/kill counts must not be incremented again when processing shot echoes');
    assert.equal(await mobile.evaluate(() => (window as any).__LASTLIGHT__.simulation.state.drill?.score), 0);
    await guest.screenshot({ path: 'output/playwright/range-multiplayer-desktop.png' });
    await mobile.screenshot({ path: 'output/playwright/range-multiplayer-phone.png' });
    await host.evaluate(() => { const s = (window as any).__LASTLIGHT__.simulation; s.damage(s.actorById('p1'), 1000, 'p0'); });
    await guest.waitForFunction(() => !(window as any).__LASTLIGHT__.simulation.player.alive);
    await guest.waitForFunction(() => (window as any).__LASTLIGHT__.simulation.player.alive && !(window as any).__LASTLIGHT__.simulation.state.spectating, undefined, { timeout: 10000 });
    assert.equal(await guest.evaluate(() => (window as any).__LASTLIGHT__.simulation.state.playerRank), undefined);
    await guest.keyboard.down('w'); await guest.waitForTimeout(500); await guest.keyboard.up('w');
    await host.waitForFunction(() => (window as any).__LASTLIGHT__.simulation.actorById('p1').position.z > -150);
    await guest.keyboard.press('Enter'); await guest.fill('#chat-input', 'Cùng luyện tập!'); await guest.keyboard.press('Enter');
    await mobile.waitForFunction(() => document.querySelector('#chat-log')?.textContent?.includes('Cùng luyện tập!'));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.close(); }
});
