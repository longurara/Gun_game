import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import type { Page, WebSocketRoute } from 'playwright-core';

test('production room selects a guest leader; real WebRTC carries a squad drop; desktop and touch followers can detach', { timeout: 150000 }, async () => {
  const server = await createServer({ envFile: false, cacheDir: mkdtempSync(join(tmpdir(), 'squad-browser-')), logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  const url = `http://127.0.0.1:${(server.httpServer!.address() as any).port}`;
  const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const pages: Page[] = [], sockets = new Map<WebSocketRoute, string>(), errors: string[] = [], broadcasts: any[] = [];
  mkdirSync('output/playwright', { recursive: true });
  try {
    for (let i = 0; i < 3; i++) {
      const page = await browser.newPage({ viewport: { width: i === 1 ? 390 : 1280, height: 844 }, hasTouch: i === 1, isMobile: i === 1 }); pages.push(page);
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*.supabase.co/**', route => route.abort());
      // A local Phoenix broker exercises the production SDK and native WebRTC, without any shared service or TURN quota.
      await page.routeWebSocket('**/realtime/v1/websocket*', socket => {
        sockets.set(socket, ''); socket.onClose(() => sockets.delete(socket));
        socket.onMessage(data => {
          let join: string | null, ref: string | null, topic: string, event: string, payload: any;
          if (typeof data === 'string') [join, ref, topic, event, payload] = JSON.parse(data);
          else {
            assert.equal(data[0], 3);
            const lengths = [data[1], data[2], data[3], data[4], data[5]]; let offset = 7;
            const fields = lengths.map(length => { const value = data.subarray(offset, offset + length).toString(); offset += length; return value; });
            [join, ref, topic] = fields; event = 'broadcast'; payload = { event: fields[3], payload: JSON.parse(data.subarray(offset).toString()) };
          }
          if (event === 'phx_join') sockets.set(socket, topic);
          if (['phx_join', 'heartbeat', 'phx_leave'].includes(event)) { socket.send(JSON.stringify([join, ref, topic, 'phx_reply', { status: 'ok', response: {} }])); return; }
          if (event !== 'broadcast') return;
          broadcasts.push(payload.payload);
          for (const [other, joined] of sockets) if (other !== socket && joined === topic) other.send(JSON.stringify([null, null, topic, 'broadcast', payload]));
        });
      });
      await page.addInitScript(({ name }) => {
        localStorage.setItem('lastlight.settings.v1', JSON.stringify({ map: 'valley', quality: 'low', botCount: 1 }));
        localStorage.setItem('lastlight.name.v1', name);
      }, { name: ['Chủ phòng', 'Đồng đội', 'Người dẫn'][i] });
      await page.goto(url, { waitUntil: 'commit' });
      await page.waitForFunction(() => !!(window as any).__LASTLIGHT__, undefined, { timeout: 60000 });
      await page.click('#multi-button');
    }
    const [host, mate, leader] = pages;
    await host.click('#mp-create'); const code = (await host.locator('#mp-room-code').textContent())!;
    for (const guest of [mate, leader]) { await guest.fill('#mp-code', code); await guest.click('#mp-join'); }
    await host.waitForFunction(() => document.querySelectorAll('#mp-players li').length === 3 && !(document.querySelector('#mp-start') as HTMLButtonElement).disabled, undefined, { timeout: 20000 });
    const leaderId = await host.locator('#mp-drop-leader option').evaluateAll(options => (options.find(option => option.textContent === 'Người dẫn') as HTMLOptionElement).value);
    await host.selectOption('#mp-drop-leader', leaderId);
    await mate.waitForFunction(id => (document.querySelector('#mp-drop-leader') as HTMLSelectElement).value === id, leaderId);
    assert.equal(await mate.locator('#mp-drop-leader').isDisabled(), true);
    await mate.screenshot({ path: 'output/playwright/squad-room-phone.png' });
    await host.click('#mp-start');
    await Promise.all(pages.map(page => page.waitForFunction(() => (window as any).__LASTLIGHT__.simulation.state.phase === 'playing' && !!(window as any).__LASTLIGHT__.net(), undefined, { timeout: 60000 })));
    await host.evaluate(() => { (window as any).__LASTLIGHT__.simulation.botsFrozen = true; });
    await leader.waitForFunction(() => (window as any).__LASTLIGHT__.simulation.state.elapsed > 3);
    const actualLeader = await leader.evaluate(() => (window as any).__LASTLIGHT__.simulation.localId);
    await host.waitForFunction(id => (window as any).__LASTLIGHT__.simulation.player.dropFollowing === id, actualLeader);
    await leader.keyboard.press('Space');
    await host.waitForFunction(() => (window as any).__LASTLIGHT__.simulation.humans.every((actor: any) => actor.air?.mode === 'freefall'));
    await leader.keyboard.down('KeyW'); await leader.waitForTimeout(1200); await leader.keyboard.up('KeyW');
    const formation = await host.evaluate(id => {
      const sim = (window as any).__LASTLIGHT__.simulation, lead = sim.actorById(id);
      return sim.humans.filter((actor: any) => actor !== lead).map((actor: any) => ({ following: actor.dropFollowing,
        distance: Math.hypot(actor.position.x - lead.position.x, actor.position.z - lead.position.z), altitude: actor.position.y - lead.position.y }));
    }, actualLeader);
    assert.ok(formation.every((actor: any) => actor.following === actualLeader && actor.distance < 20 && Math.abs(actor.altitude) < .01));
    await leader.keyboard.press('Space');
    await host.waitForFunction(() => (window as any).__LASTLIGHT__.simulation.humans.every((actor: any) => actor.air?.mode === 'chute'));
    await Promise.all(pages.map(page => page.waitForFunction(() =>
      (window as any).__LASTLIGHT__.simulation.player.air?.mode === 'chute'
      && document.querySelector('#air-stage')?.textContent === 'DÙ ĐÃ MỞ')));
    await mate.waitForFunction(() => document.querySelector('#air-leader')?.textContent?.includes('Người dẫn'));
    await mate.screenshot({ path: 'output/playwright/squad-canopy-phone.png' });
    await host.screenshot({ path: 'output/playwright/squad-canopy-desktop.png' });
    const mobileControl = await mate.locator('#air-detach').boundingBox();
    assert.ok(mobileControl && mobileControl.x >= 0 && mobileControl.x + mobileControl.width <= 390 && mobileControl.y + mobileControl.height <= 844);
    const overlaps = await mate.evaluate(() => ['#air-team', '#air-prompt'].flatMap(selector => {
      const box = document.querySelector(selector)!.getBoundingClientRect();
      return ['#network-badge', '#inventory-toggle'].filter(other => { const r = document.querySelector(other)!.getBoundingClientRect();
        return box.left < r.right && box.right > r.left && box.top < r.bottom && box.bottom > r.top;
      }).map(other => `${selector} covers ${other}`);
    }));
    assert.deepEqual(overlaps, []);
    await mate.tap('#air-detach');
    const mateId = await mate.evaluate(() => (window as any).__LASTLIGHT__.simulation.localId);
    await host.waitForFunction(id => !(window as any).__LASTLIGHT__.simulation.actorById(id).dropFollowing, mateId);
    await mate.waitForFunction(() => !(window as any).__LASTLIGHT__.simulation.player.dropFollowing);
    assert.equal(await host.evaluate(() => !!(window as any).__LASTLIGHT__.simulation.player.dropFollowing), true);
    await host.keyboard.press('KeyJ');
    await host.waitForFunction(() => !(window as any).__LASTLIGHT__.simulation.player.dropFollowing);
    await host.waitForFunction(() => (document.querySelector('#air-detach') as HTMLElement).hidden);
    assert.ok(broadcasts.every(message => ['hello', 'roster', 'rtc-signal', 'reject'].includes(message.k)), 'follow and detach use data channels, not Supabase gameplay messages');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.close(); }
});
