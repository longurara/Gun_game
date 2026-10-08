import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';

let server: ViteDevServer, browser: Browser, url: string;
before(async () => {
  server = await createServer({ envFile: false, cacheDir: mkdtempSync(join(tmpdir(), 'ui-overlays-')), logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
  await server.listen(); url = `http://127.0.0.1:${(server.httpServer!.address() as any).port}`;
  browser = await chromium.launch({ executablePath: ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync), headless: true });
  mkdirSync('output/playwright', { recursive: true });
});
after(async () => { await browser?.close(); await server?.close(); });

async function open(online = false, touch = false): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: touch ? { width: 390, height: 844 } : { width: 1280, height: 720 }, hasTouch: touch, isMobile: touch });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*.supabase.co/**', route => route.abort());
  if (online) await page.routeWebSocket('**/realtime/v1/websocket*', socket => {
    socket.onMessage(data => {
      if (typeof data !== 'string') return;
      const [join, ref, topic, event] = JSON.parse(data);
      if (['phx_join', 'heartbeat', 'phx_leave'].includes(event)) socket.send(JSON.stringify([join, ref, topic, 'phx_reply', { status: 'ok', response: {} }]));
    });
  });
  await page.addInitScript(() => localStorage.setItem('lastlight.settings.v1', JSON.stringify({ map: 'range', botCount: 0, quality: 'low' })));
  await page.goto(url, { waitUntil: 'commit' });
  await page.waitForFunction(() => !!(window as any).__LASTLIGHT__, undefined, { timeout: 60000 });
  if (online) {
    await page.click('#multi-button'); await page.click('#mp-create');
    await page.waitForFunction(() => !(document.querySelector('#mp-start') as HTMLButtonElement).disabled);
    await page.click('#mp-start');
  } else await page.click('#start-button');
  await page.waitForFunction(() => (window as any).__LASTLIGHT__.simulation.state.phase === 'playing' && (document.querySelector('#loading-screen') as HTMLElement)?.hidden !== false, undefined, { timeout: 60000 });
  await page.evaluate(() => (window as any).__LASTLIGHT__.simulation.botsFrozen = true);
  return { page, errors };
}

test('desktop map releases the mouse, Escape closes only the map, and closing restores game focus', { timeout: 120000 }, async () => {
  const { page, errors } = await open();
  try {
    await page.click('#game-canvas', { position: { x: 650, y: 350 } });
    await page.waitForFunction(() => !!document.pointerLockElement);
    await page.keyboard.press('KeyM');
    await page.waitForSelector('#map-screen', { state: 'visible' });
    assert.equal(await page.evaluate(() => !!document.pointerLockElement), false, 'map must provide a mouse cursor');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'map-close');
    await page.screenshot({ path: 'output/playwright/ui-map-desktop.png' });
    await page.keyboard.press('Escape');
    await page.waitForSelector('#map-screen', { state: 'hidden' });
    assert.equal(await page.evaluate(() => (window as any).__LASTLIGHT__.simulation.state.phase), 'playing');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'game-canvas');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('Tab navigation stays in the armoury and death closes its focused search', { timeout: 120000 }, async () => {
  const { page, errors } = await open();
  try {
    await page.keyboard.press('KeyB'); await page.waitForSelector('#range-armoury', { state: 'visible' });
    await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
    assert.equal(await page.locator('#inventory-screen').isVisible(), false, 'Tab navigates the armoury instead of opening inventory');
    assert.equal(await page.evaluate(() => !!document.activeElement?.closest('#range-armoury')), true);
    await page.locator('#armoury-search').focus();
    await page.evaluate(() => { const s = (window as any).__LASTLIGHT__.simulation; s.damage(s.player, 1000); });
    await page.waitForSelector('#range-armoury', { state: 'hidden' }, { timeout: 5000 });
    assert.equal(await page.evaluate(() => document.activeElement?.id === 'armoury-search'), false);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('online Enter activates armoury buttons and chat switching leaves only one active window', { timeout: 120000 }, async () => {
  const { page, errors } = await open(true);
  try {
    await page.keyboard.press('KeyB'); await page.waitForSelector('#range-armoury', { state: 'visible' });
    await page.locator('#armoury-grid button[data-weapon="pistol"]').focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => (window as any).__LASTLIGHT__.simulation.player.weapon === 'pistol', undefined, { timeout: 3000 });
    assert.equal(await page.locator('#chat-panel').isVisible(), false);
    await page.click('#armoury-close');
    await page.keyboard.press('KeyI'); await page.waitForSelector('#inventory-screen', { state: 'visible' });
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#chat-panel').isVisible(), false, 'Enter on inventory close activates its button');
    await page.waitForSelector('#inventory-screen', { state: 'hidden' });
    await page.keyboard.press('Enter'); await page.waitForSelector('#chat-panel', { state: 'visible' });
    await page.keyboard.press('Escape'); await page.keyboard.press('KeyM');
    await page.click('#chat-toggle');
    assert.equal(await page.locator('#map-screen').isVisible(), false, 'opening chat closes the map');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'chat-input');
    await page.screenshot({ path: 'output/playwright/ui-chat-desktop.png' });
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'game-canvas');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

for (const touch of [false, true]) test(`large map fits ${touch ? 'phone portrait and landscape' : 'desktop and short desktop'} without clipping its legend or stretching the canvas`, { timeout: 120000 }, async () => {
  const { page, errors } = await open(false, touch);
  try {
    await page.keyboard.press('KeyM'); await page.waitForSelector('#map-screen', { state: 'visible' });
    assert.equal(await page.evaluate(() => Number(getComputedStyle(document.querySelector('#map-screen')!).zIndex) > Number(getComputedStyle(document.querySelector('#toast')!).zIndex)), true, 'gameplay toast must not cover the map header');
    for (const viewport of touch ? [{ width: 390, height: 844 }, { width: 844, height: 390 }] : [{ width: 1280, height: 720 }, { width: 1024, height: 600 }]) {
      await page.setViewportSize(viewport);
      const card = await page.locator('.map-card').boundingBox(), canvas = await page.locator('#bigmap').boundingBox(), legend = await page.locator('.map-legend').boundingBox();
      assert.ok(card && canvas && legend);
      await page.screenshot({ path: `output/playwright/ui-map-${touch ? 'phone' : 'desktop'}-${viewport.height}.png` });
      assert.ok(card.y >= 8 && card.y + card.height <= viewport.height - 8, `map card fits ${JSON.stringify(viewport)}: ${JSON.stringify(card)}`);
      assert.ok(legend.y >= card.y && legend.y + legend.height <= card.y + card.height, 'legend remains fully visible');
      assert.ok(Math.abs(canvas.width - canvas.height) < 1, 'map canvas stays square for waypoint coordinates');
      assert.ok(canvas.x >= card.x && canvas.x + canvas.width <= card.x + card.width && canvas.y >= card.y && canvas.y + canvas.height <= card.y + card.height);
    }
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
