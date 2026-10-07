import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import { chromium } from 'playwright-core';
import type { Browser, Page, WebSocketRoute } from 'playwright-core';

let server: ViteDevServer, browser: Browser, url: string;
before(async () => {
  // Local tests must not consume a developer's TURN quota or depend on their credential endpoint.
  server = await createServer({ envFile: false, cacheDir: mkdtempSync(join(tmpdir(), 'lastlight-rtc-')), logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
  await server.listen(); const address = server.httpServer!.address();
  url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 5173}`;
  browser = await chromium.launch({ executablePath: ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync), headless: true });
  mkdirSync('output/playwright', { recursive: true });
});
after(async () => { await browser?.close(); await server?.close(); });

async function captureWire(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const stats = { binary: 0, strings: 0, delta: 0, full: 0, bytes: 0 };
    (window as any).__WIRE_STATS__ = stats;
    const send = RTCDataChannel.prototype.send;
    RTCDataChannel.prototype.send = function(data: any) {
      if (data instanceof ArrayBuffer) {
        const bytes = new Uint8Array(data); stats.binary++; stats.bytes += bytes.length;
        if (bytes[3] === 2) stats.delta++; if (bytes[3] === 1) stats.full++;
      } else if (typeof data === 'string') stats.strings++;
      return send.call(this, data);
    };
  });
}

async function room(size: number, noIce = false, loseSignals = false, varyAnswer = false) {
  const pages: Page[] = [], signals: Array<{ from: string; message: any }> = [], errors: string[] = [];
  const dropped = new Set<string>();
  for (let i = 0; i < size; i++) {
    const page = await browser.newPage({ viewport: { width: i ? 390 : 1280, height: 720 } });
    await captureWire(page);
    page.on('pageerror', e => errors.push(e.message));
    await page.exposeBinding('rtcSignal', async (_source, packet) => {
      signals.push(packet);
      if (loseSignals && packet.message.k === 'rtc-signal') {
        const type = packet.message.description?.type;
        if (packet.message.candidate) return; // All standalone trickle messages are lost.
        if (type && !dropped.has(type)) { dropped.add(type); return; }
      }
      const recipients = pages.filter(p => p !== page && !p.isClosed());
      await Promise.all(recipients.map(p => p.evaluate(packet => {
        (window as any).__SIGNAL_RECEIVE__?.(packet.message, packet.from);
      }, packet).catch(() => {})));
      if (varyAnswer && packet.message.description?.type === 'answer' && !dropped.has('varied-answer')) {
        dropped.add('varied-answer');
        const duplicate = structuredClone(packet);
        // A gathering browser may rewrite connection lines while replaying the same answer.
        duplicate.message.description.sdp = duplicate.message.description.sdp.replace(/^c=IN IP4 .*$/m, 'c=IN IP4 127.0.0.1\r');
        await Promise.all(recipients.map(p => p.evaluate(packet => {
          (window as any).__SIGNAL_RECEIVE__?.(packet.message, packet.from);
        }, duplicate)));
      }
    });
    pages.push(page);
    await page.goto(`${url}/tests/fixtures/webrtc.html?id=p${i}&role=${i ? 'client' : 'host'}${noIce ? '&no-ice=1' : ''}${loseSignals ? '&loss=1' : ''}`);
    await page.waitForFunction(() => !!(window as any).__RTC_FIXTURE__);
  }
  const host = pages[0]; await host.click('#mp-create');
  const code = await host.locator('#mp-room-code').textContent();
  for (const guest of pages.slice(1)) { await guest.fill('#mp-code', code!); await guest.click('#mp-join'); }
  await host.waitForFunction(size => document.querySelectorAll('#mp-players li').length === size, size);
  return { pages, host, signals, errors, close: async () => {
    for (const page of pages) { if (!page.isClosed()) { await page.evaluate(() => (window as any).__RTC_FIXTURE__.close()); await page.close(); } }
  } };
}

test('native WebRTC ignores a changed duplicate answer after the first answer reaches stable', async () => {
  const r = await room(2, false, false, true);
  try {
    await r.host.waitForFunction(() => (window as any).__RTC_FIXTURE__.transport.ready);
    await r.pages[1].waitForFunction(() => (window as any).__RTC_FIXTURE__.transport.ready);
    assert.equal(await r.host.locator('#mp-error').textContent(), '');
    await r.host.click('#mp-start');
    await r.pages[1].waitForFunction(() => (window as any).__RTC_FIXTURE__.client?.netStats().snapshotsPerSecond > 0);
    assert.deepEqual(r.errors, []);
  } finally { await r.close(); }
});

test('native channels recover lost initial offer, answer and all standalone ICE signals', async () => {
  // Use the production handshake deadline: the fixture's 2s failure shortcut cannot cover a 3s replay.
  const r = await room(2, false, true);
  try {
    await r.host.waitForFunction(() => !(document.querySelector('#mp-start') as HTMLButtonElement).disabled, undefined, { timeout: 15000 });
    await r.pages[1].waitForFunction(() => (window as any).__RTC_FIXTURE__.transport.ready);
    assert.ok(r.signals.filter(p => p.message.description?.type === 'offer').length > 1);
    assert.ok(r.signals.filter(p => p.message.description?.type === 'answer').length > 1);
    await r.host.click('#mp-start');
    await r.pages[1].waitForFunction(() => (window as any).__RTC_FIXTURE__.client?.netStats().snapshotsPerSecond > 0);
    assert.deepEqual(r.errors, []);
  } finally { await r.close(); }
});

test('six native WebRTC peers start a match, exchange gameplay without signaling, report ping and isolate a guest leaving', async () => {
  const r = await room(6);
  try {
    await r.host.waitForFunction(() => !(document.querySelector('#mp-start') as HTMLButtonElement).disabled, undefined, { timeout: 15000 });
    await Promise.all(r.pages.map(page => page.waitForFunction(() => (window as any).__RTC_FIXTURE__.transport.ready)));
    await r.host.waitForFunction(() => (window as any).__RTC_FIXTURE__.transport.netStats().every((p: any) => p.rttMs !== null && p.route === 'direct'));
    await r.host.screenshot({ path: 'output/playwright/webrtc-room-six.png' });
    await r.pages[1].screenshot({ path: 'output/playwright/webrtc-room-phone.png' });
    await r.host.click('#mp-start');
    await Promise.all(r.pages.map(page => page.waitForFunction(() => (window as any).__RTC_FIXTURE__.sim?.state.phase === 'playing')));
    await r.pages[1].waitForFunction(() => (window as any).__RTC_FIXTURE__.client.netStats().snapshotsPerSecond > 0);
    await r.host.waitForFunction(() => (window as any).__WIRE_STATS__.delta > 5);
    assert.equal(await r.host.evaluate(() => (window as any).__WIRE_STATS__.strings), 0);
    assert.ok(await r.pages[1].evaluate(() => (window as any).__WIRE_STATS__.binary > 0));
    const signalCount = r.signals.length;
    await Promise.all(r.pages.map(page => page.evaluate(() => (window as any).__RTC_FIXTURE__.blockSignaling())));
    const before = await r.host.evaluate(() => (window as any).__RTC_FIXTURE__.sim.actorById('p1').position.z);
    await r.pages[1].evaluate(() => (window as any).__RTC_FIXTURE__.move(1));
    await r.host.waitForFunction(before => (window as any).__RTC_FIXTURE__.sim.actorById('p1').position.z > before + 1, before);
    await r.pages[1].evaluate(() => (window as any).__RTC_FIXTURE__.move(0));
    await r.pages[1].evaluate(() => { const f = (window as any).__RTC_FIXTURE__; f.client.queueCommand('stance', 'crouch'); });
    await r.host.waitForFunction(() => (window as any).__RTC_FIXTURE__.sim.actorById('p1').stance === 'crouch');
    assert.equal(r.signals.length, signalCount, 'an ongoing match requires no Supabase traffic');
    assert.ok(r.signals.every(p => ['hello', 'roster', 'rtc-signal', 'reject'].includes(p.message.k)), 'start, snapshots and inputs never use signaling');
    // Exercise fragmentation through the native SCTP channel as well as the unit codec.
    await r.host.evaluate(() => (window as any).__RTC_FIXTURE__.transport.send({ k: 'large-test', text: 'đồng bộ 🪂'.repeat(8000) }));
    await r.pages[2].waitForFunction(() => (window as any).__RTC_FIXTURE__.received.some((m: any) => m.k === 'large-test'));
    await r.pages[1].evaluate(() => (window as any).__RTC_FIXTURE__.close());
    await r.host.waitForFunction(() => !(window as any).__RTC_FIXTURE__.sim.actorById('p1').alive);
    assert.equal(await r.pages[2].evaluate(() => (window as any).__RTC_FIXTURE__.transport.ready), true);
    assert.equal(await r.pages[2].evaluate(() => (window as any).__RTC_FIXTURE__.client.connectionLost), false);
    await r.host.evaluate(() => (window as any).__RTC_FIXTURE__.close());
    await r.pages[2].waitForFunction(() => { const f = (window as any).__RTC_FIXTURE__; return f.client.closedByHost || f.client.connectionLost; });
    assert.deepEqual(r.errors, []);
  } finally { await r.close(); }
});

test('unreachable peers time out visibly and cannot start a match or send gameplay through signaling', async () => {
  const r = await room(2, true);
  try {
    await r.host.waitForFunction(() => (window as any).__RTC_FIXTURE__.transport.netStats().some((p: any) => p.state === 'failed'), undefined, { timeout: 10000 });
    assert.equal(await r.host.locator('#mp-start').isDisabled(), true);
    assert.match(await r.host.locator('#mp-error').textContent() ?? '', /TURN/);
    await r.host.evaluate(() => (window as any).__RTC_FIXTURE__.controller.start());
    assert.equal(await r.host.evaluate(() => (window as any).__RTC_FIXTURE__.sim), null);
    assert.ok(r.signals.every(p => !['start', 'snap', 'in'].includes(p.message.k)));
    assert.deepEqual(r.errors, []);
  } finally { await r.close(); }
});

test('production game uses the Supabase SDK for handshake, then survives its WebSocket closing', async () => {
  const pages: Page[] = [], sockets = new Map<WebSocketRoute, string>();
  const broadcasts: any[] = [], errors: string[] = [];
  try {
    for (let i = 0; i < 2; i++) {
      const page = await browser.newPage({ viewport: { width: i ? 390 : 1280, height: 844 }, hasTouch: i === 1, isMobile: i === 1 }); pages.push(page);
      await captureWire(page);
      page.on('pageerror', e => errors.push(e.message));
      // Local Phoenix broker: exercise the installed Supabase SDK, without touching the shared project.
      await page.route('**/*.supabase.co/**', route => route.abort());
      await page.routeWebSocket('**/realtime/v1/websocket*', socket => {
        sockets.set(socket, '');
        socket.onClose(() => { sockets.delete(socket); });
        socket.onMessage(data => {
          let join: string | null, ref: string | null, topic: string, event: string, payload: any;
          if (typeof data === 'string') [join, ref, topic, event, payload] = JSON.parse(data);
          else {
            // Realtime v2 encodes JSON Broadcast pushes as binary kind 3.
            assert.equal(data[0], 3);
            const lengths = [data[1], data[2], data[3], data[4], data[5]]; let offset = 7;
            const fields = lengths.map(length => { const value = data.subarray(offset, offset + length).toString(); offset += length; return value; });
            [join, ref, topic] = fields; event = 'broadcast'; payload = { event: fields[3], payload: JSON.parse(data.subarray(offset).toString()) };
          }
          if (event === 'phx_join') sockets.set(socket, topic);
          if (event === 'phx_join' || event === 'heartbeat' || event === 'phx_leave') {
            socket.send(JSON.stringify([join, ref, topic, 'phx_reply', { status: 'ok', response: {} }])); return;
          }
          if (event !== 'broadcast') return;
          broadcasts.push(payload.payload);
          for (const [other, joined] of sockets) if (other !== socket && joined === topic) {
            other.send(JSON.stringify([null, null, topic, 'broadcast', payload]));
          }
        });
      });
      await page.addInitScript(() => localStorage.setItem('lastlight.settings.v1', JSON.stringify({ map: 'arena', quality: 'low', botCount: 3, showFps: false })));
      await page.goto(url, { waitUntil: 'commit' });
      await page.waitForFunction(() => !!(window as any).__LASTLIGHT__, undefined, { timeout: 60000 });
      await page.click('#multi-button');
    }
    const [host, guest] = pages;
    await host.click('#mp-create'); const code = await host.locator('#mp-room-code').textContent();
    await guest.fill('#mp-code', code!); await guest.click('#mp-join');
    await host.waitForFunction(() => document.querySelectorAll('#mp-players li').length === 2 && !(document.querySelector('#mp-start') as HTMLButtonElement).disabled, undefined, { timeout: 20000 });
    await guest.waitForFunction(() => document.querySelector('#mp-players')?.textContent?.includes('ms'));
    await guest.screenshot({ path: 'output/playwright/webrtc-production-phone.png' });
    await host.click('#mp-start');
    await Promise.all(pages.map(page => page.waitForFunction(() => !!(window as any).__LASTLIGHT__.net())));
    await host.evaluate(() => { (window as any).__LASTLIGHT__.simulation.botsFrozen = true; });
    await guest.waitForFunction(() => (window as any).__LASTLIGHT__.net().client.netStats().snapshotsPerSecond > 0);
    await host.waitForFunction(() => (window as any).__WIRE_STATS__.delta > 5);
    assert.equal(await host.evaluate(() => (window as any).__WIRE_STATS__.strings), 0);
    for (const [index, page] of pages.entries()) {
      await page.waitForFunction(() => !document.querySelector<HTMLElement>('#network-badge')!.hidden && document.querySelector('#network-badge')!.textContent!.includes('ms'));
      assert.equal(await page.locator('#network-badge').isVisible(), true, 'multiplayer ping is visible with FPS disabled');
      assert.equal(await page.locator('#perf-meter').isVisible(), false);
      assert.equal(await page.locator('#network-badge .net-signal svg rect').count(), 4);
      const overlaps = await page.evaluate(() => {
        const badge = document.querySelector('#network-badge')!.getBoundingClientRect();
        return ['#inventory-toggle', '.compass', '.match-stats', '.minimap-panel', '.touch-top-actions', '.zone-banner'].filter(selector => {
          const element = document.querySelector(selector);
          if (!element) return false;
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && badge.left < rect.right && badge.right > rect.left && badge.top < rect.bottom && badge.bottom > rect.top;
        });
      });
      assert.deepEqual(overlaps, [], 'ping does not cover HUD controls');
      await page.screenshot({ path: `output/playwright/network-signal-${index ? 'phone' : 'desktop'}.png` });
    }
    await guest.setViewportSize({ width: 844, height: 390 });
    await guest.screenshot({ path: 'output/playwright/network-signal-phone-landscape.png' });
    assert.ok(broadcasts.every(m => ['hello', 'roster', 'rtc-signal', 'reject'].includes(m.k)));
    for (const socket of [...sockets.keys()]) await socket.close();
    const elapsed = await guest.evaluate(() => (window as any).__LASTLIGHT__.simulation.state.elapsed);
    await guest.waitForFunction(elapsed => (window as any).__LASTLIGHT__.simulation.state.elapsed > elapsed + .5, elapsed);
    assert.equal(await guest.evaluate(() => (window as any).__LASTLIGHT__.net().client.connectionLost), false);
    await host.evaluate(() => { (window as any).__LASTLIGHT__.net().host.close(); });
    await guest.waitForFunction(() => (window as any).__LASTLIGHT__.net() === null);
    await guest.waitForFunction(() => document.querySelector<HTMLElement>('#network-badge')!.hidden);
    assert.deepEqual(errors, []);
  } finally { for (const page of pages) await page.close(); }
});
