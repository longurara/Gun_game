import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import type { WebSocketRoute } from 'playwright-core';

test('production join selector forces TURN at both ends and direct joins work without the credential service', { timeout: 120000 }, async () => {
  const endpoint = 'https://turn-credentials.invalid/api';
  const server = await createServer({ envFile: false, cacheDir: mkdtempSync(join(tmpdir(), 'connection-modes-')), define: { 'import.meta.env.VITE_WEBRTC_ICE_URL': JSON.stringify(endpoint) }, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
  await server.listen(); const url = `http://127.0.0.1:${(server.httpServer!.address() as any).port}`;
  const browser = await chromium.launch({ executablePath: ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync), headless: true });
  const sockets = new Map<WebSocketRoute, string>(), requests = [0, 0], errors: string[] = [];
  let endpointAvailable = true;
  mkdirSync('output/playwright', { recursive: true });
  try {
    const pages = [];
    for (let index = 0; index < 2; index++) {
      const page = await browser.newPage({ viewport: { width: index ? 390 : 1280, height: 844 }, hasTouch: !!index, isMobile: !!index }); pages.push(page);
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*.supabase.co/**', route => route.abort());
      await page.route(endpoint, route => {
        requests[index]++;
        return route.fulfill(endpointAvailable ? { json: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'turn:relay.invalid:3478', username: 'test', credential: 'test' }] } : { status: 503, body: 'Unavailable' });
      });
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
      await page.addInitScript(() => {
        localStorage.setItem('lastlight.settings.v1', JSON.stringify({ map: 'arena', quality: 'low', botCount: 1 }));
        const Native = RTCPeerConnection;
        (window as any).__PCS__ = [];
        window.RTCPeerConnection = class extends Native {
          constructor(configuration?: RTCConfiguration) { super(configuration); (window as any).__PCS__.push(this); }
        };
      });
      await page.goto(url, { waitUntil: 'commit' });
      await page.waitForFunction(() => !!(window as any).__LASTLIGHT__, undefined, { timeout: 60000 });
      await page.click('#multi-button');
    }
    const [host, guest] = pages;
    await guest.selectOption('#mp-mode', 'turn');
    await guest.screenshot({ path: 'output/playwright/join-turn-phone.png' });
    const bounds = await guest.locator('#mp-mode').boundingBox(); assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390);
    await host.click('#mp-create'); const code = (await host.locator('#mp-room-code').textContent())!;
    await guest.fill('#mp-code', code); await guest.click('#mp-join');
    await Promise.all(pages.map(page => page.waitForFunction(() => (window as any).__PCS__.length > 0)));
    for (const page of pages) assert.equal(await page.evaluate(() => (window as any).__PCS__.at(-1).getConfiguration().iceTransportPolicy), 'relay');
    assert.deepEqual(requests, [1, 1]);
    await guest.click('#mp-leave');
    await host.waitForFunction(() => document.querySelectorAll('#mp-players li').length === 1);
    endpointAvailable = false;
    await guest.selectOption('#mp-mode', 'turn'); await guest.click('#mp-join');
    await guest.waitForFunction(() => document.querySelector('#mp-error')?.textContent?.includes('Không tải được cấu hình TURN'));
    assert.equal(await guest.evaluate(() => (window as any).__PCS__.length), 1, 'failed TURN loading must not silently create a direct connection');
    await guest.selectOption('#mp-mode', 'p2p');
    await guest.screenshot({ path: 'output/playwright/join-p2p-phone.png' });
    await guest.click('#mp-join');
    await host.waitForFunction(() => document.querySelectorAll('#mp-players li').length === 2 && !(document.querySelector('#mp-start') as HTMLButtonElement).disabled, undefined, { timeout: 20000 });
    assert.deepEqual(requests, [1, 2], 'P2P must skip the unavailable TURN endpoint');
    for (const page of pages) {
      const config = await page.evaluate(() => (window as any).__PCS__.at(-1).getConfiguration());
      assert.equal(config.iceTransportPolicy, 'all');
      assert.ok(config.iceServers?.every(server => (Array.isArray(server.urls) ? server.urls : [server.urls]).every(url => !/^turns?:/i.test(url))));
    }
    await host.click('#mp-start');
    await Promise.all(pages.map(page => page.waitForFunction(() => (window as any).__LASTLIGHT__.simulation.state.phase === 'playing', undefined, { timeout: 60000 })));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.close(); }
});
