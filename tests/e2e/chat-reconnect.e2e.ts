import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import type { Page, WebSocketRoute } from 'playwright-core';

test('native P2P room chat and reconnect restore a protected client without interrupting another guest', { timeout: 180000 }, async () => {
  const server = await createServer({ envFile: false, cacheDir: mkdtempSync(join(tmpdir(), 'chat-reconnect-')), logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
  await server.listen(); const url = `http://127.0.0.1:${(server.httpServer!.address() as any).port}`;
  const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const pages: Page[] = [], sockets = new Map<WebSocketRoute, { topic: string; page: Page }>(), blocked = new Set<Page>();
  const broadcasts: any[] = [], errors: string[] = [];
  mkdirSync('output/playwright', { recursive: true });
  try {
    for (let i = 0; i < 3; i++) {
      const page = await browser.newPage({ viewport: { width: i === 2 ? 390 : 1280, height: 844 }, hasTouch: i === 2, isMobile: i === 2 }); pages.push(page);
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*.supabase.co/**', route => route.abort());
      await page.routeWebSocket('**/realtime/v1/websocket*', socket => {
        sockets.set(socket, { topic: '', page }); socket.onClose(() => sockets.delete(socket));
        socket.onMessage(data => {
          let join: string | null, ref: string | null, topic: string, event: string, payload: any;
          if (typeof data === 'string') [join, ref, topic, event, payload] = JSON.parse(data);
          else {
            assert.equal(data[0], 3);
            const lengths = [data[1], data[2], data[3], data[4], data[5]]; let offset = 7;
            const fields = lengths.map(length => { const value = data.subarray(offset, offset + length).toString(); offset += length; return value; });
            [join, ref, topic] = fields; event = 'broadcast'; payload = { event: fields[3], payload: JSON.parse(data.subarray(offset).toString()) };
          }
          if (event === 'phx_join') sockets.set(socket, { topic, page });
          if (['phx_join', 'heartbeat', 'phx_leave'].includes(event)) { socket.send(JSON.stringify([join, ref, topic, 'phx_reply', { status: 'ok', response: {} }])); return; }
          if (event !== 'broadcast') return;
          broadcasts.push(payload.payload);
          if (blocked.has(page)) return;
          for (const [other, joined] of sockets) if (other !== socket && joined.topic === topic && !blocked.has(joined.page)) other.send(JSON.stringify([null, null, topic, 'broadcast', payload]));
        });
      });
      await page.addInitScript(({ name }) => {
        localStorage.setItem('lastlight.settings.v1', JSON.stringify({ map: 'arena', quality: 'low', botCount: 1 }));
        localStorage.setItem('lastlight.name.v1', name);
        const Native = RTCPeerConnection;
        (window as any).__TEST_PCS__ = [];
        window.RTCPeerConnection = class extends Native {
          constructor(configuration?: RTCConfiguration) { super(configuration); (window as any).__TEST_PCS__.push(this); }
        };
      }, { name: ['Chủ phòng', 'Minh', 'Lan'][i] });
      await page.goto(url, { waitUntil: 'commit' });
      await page.waitForFunction(() => !!(window as any).__LASTLIGHT__, undefined, { timeout: 60000 });
      if (i === 0) await page.click('#map-choice button[data-value="arena"]');
      await page.click('#multi-button');
    }
    const [host, guest, mate] = pages;
    await host.click('#mp-create'); const code = (await host.locator('#mp-room-code').textContent())!;
    for (const page of [guest, mate]) { await page.fill('#mp-code', code); await page.click('#mp-join'); }
    await host.waitForFunction(() => document.querySelectorAll('#mp-players li').length === 3 && !(document.querySelector('#mp-start') as HTMLButtonElement).disabled, undefined, { timeout: 20000 });
    await host.click('#mp-start');
    await Promise.all(pages.map(page => page.waitForFunction(() => (window as any).__LASTLIGHT__.simulation.state.phase === 'playing' && !!(window as any).__LASTLIGHT__.net(), undefined, { timeout: 60000 })));
    await host.evaluate(() => (window as any).__LASTLIGHT__.simulation.botsFrozen = true);
    const actorId = await guest.evaluate(() => (window as any).__LASTLIGHT__.simulation.localId);
    const clientId = await guest.evaluate(() => (window as any).__LASTLIGHT__.net().transport.clientId);
    await guest.keyboard.press('Enter');
    assert.equal(await guest.locator('#chat-input').evaluate(el => el === document.activeElement), true);
    const text = '<img src=x onerror=alert(1)> Chào đồng đội 👋';
    await guest.fill('#chat-input', text); await guest.keyboard.press('Enter');
    await Promise.all(pages.map(page => page.waitForFunction(text => document.querySelector('#chat-log')?.textContent?.includes(text), text)));
    assert.equal(await host.locator('#chat-log img').count(), 0);
    assert.equal(await host.locator('#chat-unread').textContent(), '1');
    await mate.tap('#chat-toggle');
    await mate.fill('#chat-input', 'Lan đã sẵn sàng'); await mate.tap('#chat-send');
    await host.waitForFunction(() => document.querySelector('#chat-log')?.textContent?.includes('Lan đã sẵn sàng'));
    const mobilePanel = await mate.locator('#chat-panel').boundingBox(); assert.ok(mobilePanel && mobilePanel.x >= 0 && mobilePanel.x + mobilePanel.width <= 390);
    await mate.screenshot({ path: 'output/playwright/chat-phone.png' });
    await mate.tap('#chat-close'); await guest.keyboard.press('Escape');
    await host.keyboard.press('Enter');
    await host.screenshot({ path: 'output/playwright/chat-desktop.png' });
    await host.evaluate(id => {
      const actor = (window as any).__LASTLIGHT__.simulation.actorById(id);
      actor.health = 70; actor.helmet = 2; actor.helmetHp = 70; actor.vest = 2; actor.vestHp = 80;
    }, actorId);
    blocked.add(guest); await guest.context().setOffline(true);
    await guest.evaluate(() => (window as any).__TEST_PCS__.filter((pc: RTCPeerConnection) => pc.connectionState !== 'closed').forEach((pc: RTCPeerConnection) => pc.close()));
    await host.waitForFunction(id => (window as any).__LASTLIGHT__.simulation.actorById(id).reconnecting === true, actorId);
    await guest.waitForFunction(() => !(document.querySelector('#reconnect-banner') as HTMLElement).hidden);
    await guest.screenshot({ path: 'output/playwright/reconnect-desktop.png' });
    const protectedState = await host.evaluate(id => {
      const sim = (window as any).__LASTLIGHT__.simulation, actor = sim.actorById(id);
      const absorbed = sim.absorb(actor, 500, false);
      for (const cause of ['rifle', 'zone', 'fall']) sim.damage(actor, 500, 'p0', { cause });
      return { absorbed, health: actor.health, armour: actor.vestHp, alive: actor.alive };
    }, actorId);
    assert.deepEqual(protectedState, { absorbed: 0, health: 70, armour: 80, alive: true });
    await host.fill('#chat-input', 'Tin nhắn khi Minh mất mạng'); await host.keyboard.press('Enter');
    const before = await mate.evaluate(() => (window as any).__LASTLIGHT__.simulation.state.elapsed);
    await host.waitForTimeout(6500);
    assert.ok(await mate.evaluate(t => (window as any).__LASTLIGHT__.simulation.state.elapsed > t + 4, before), 'other guest keeps playing');
    assert.equal(await guest.evaluate(() => (window as any).__LASTLIGHT__.simulation.state.phase), 'playing');
    blocked.delete(guest); await guest.context().setOffline(false);
    await guest.waitForFunction(() => !(window as any).__LASTLIGHT__.net().client.reconnecting && (document.querySelector('#reconnect-banner') as HTMLElement).hidden, undefined, { timeout: 20000 });
    await host.waitForFunction(id => !(window as any).__LASTLIGHT__.simulation.actorById(id).reconnecting, actorId);
    assert.equal(await guest.evaluate(() => (window as any).__LASTLIGHT__.simulation.localId), actorId);
    assert.equal(await guest.evaluate(() => (window as any).__LASTLIGHT__.simulation.player.health), 70);
    assert.ok(await host.evaluate(id => (window as any).__LASTLIGHT__.net().transport.peers.get(id).generation >= 1, clientId));
    await guest.waitForFunction(() => document.querySelector('#chat-log')?.textContent?.includes('Tin nhắn khi Minh mất mạng'));
    assert.equal(await guest.locator('#chat-log p').filter({ hasText: text }).count(), 1);
    await guest.keyboard.press('Enter'); await guest.fill('#chat-input', 'Đã nối lại rồi!'); await guest.keyboard.press('Enter');
    await mate.waitForFunction(() => document.querySelector('#chat-log')?.textContent?.includes('Đã nối lại rồi!'));
    assert.ok(broadcasts.every(message => ['hello', 'roster', 'rtc-signal', 'rtc-reconnect', 'reject'].includes(message.k)), 'chat and resync never use Supabase broadcasts');
    assert.ok(broadcasts.every(message => !message.token), 'reconnect proofs do not expose the private ticket');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.close(); }
});
