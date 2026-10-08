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
  server = await createServer({ envFile: false, cacheDir: mkdtempSync(join(tmpdir(), 'menu-layout-')), logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
  await server.listen(); url = `http://127.0.0.1:${(server.httpServer!.address() as any).port}`;
  browser = await chromium.launch({ executablePath: ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync), headless: true });
  mkdirSync('output/playwright', { recursive: true });
});
after(async () => { await browser?.close(); await server?.close(); });

async function fits(page: Page, height: number) {
  const metrics = await page.evaluate(() => {
    const menu = document.getElementById('menu-screen')!, panel = document.querySelector<HTMLElement>('.lobby-panel')!;
    const top = document.querySelector('.lobby-top')!.getBoundingClientRect(), foot = document.querySelector('.lobby-foot')!.getBoundingClientRect(), box = panel.getBoundingClientRect();
    const start = document.getElementById('start-button')!.getBoundingClientRect();
    return { startTop: start.top, startBottom: start.bottom, scrollHeight: menu.scrollHeight, height: menu.clientHeight, panelWidth: panel.clientWidth, panelScrollWidth: panel.scrollWidth,
      top: top.top, topBottom: top.bottom, footTop: foot.top, footBottom: foot.bottom, panelTop: box.top, panelBottom: box.bottom, panelLeft: box.left, panelRight: box.right, width: innerWidth };
  });
  assert.ok(metrics.scrollHeight <= metrics.height + 1, `menu stays in viewport: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.panelScrollWidth <= metrics.panelWidth + 1, `panel has no horizontal clipping: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.top >= 0 && metrics.footBottom <= height && metrics.panelTop >= metrics.topBottom && metrics.panelBottom <= metrics.footTop + 1);
  assert.ok(metrics.panelLeft >= 0 && metrics.panelRight <= metrics.width);
  assert.ok(metrics.startTop >= metrics.panelTop && metrics.startBottom <= metrics.footTop, `start stays visible: ${JSON.stringify(metrics)}`);
}

for (const viewport of [{ width: 1366, height: 768 }, { width: 1280, height: 600 }, { width: 1920, height: 1080 }, { width: 900, height: 700 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`Chrome 100% menu keeps settings and all map options reachable at ${viewport.width}x${viewport.height}`, { timeout: 120000 }, async () => {
    const touch = viewport.width === 390 || viewport.height === 390;
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*.supabase.co/**', route => route.abort());
    await page.addInitScript(() => localStorage.setItem('lastlight.settings.v1', JSON.stringify({ map: 'range', botCount: 0, quality: 'low' })));
    try {
      await page.goto(url, { waitUntil: 'commit' });
      await page.waitForFunction(() => !!(window as any).__LASTLIGHT__, undefined, { timeout: 60000 });
      await page.screenshot({ path: `output/playwright/menu-${viewport.width}-${viewport.height}-play.png` });
      await fits(page, viewport.height);
      for (const map of ['range', 'island', 'valley', 'desert', 'pines', 'metro', 'arena']) {
        await page.click('#map-picker');
        await page.click(`#map-choice button[data-value="${map}"]`);
        assert.equal(await page.locator('#menu-map-dialog').isVisible(), false);
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'map-picker');
        await fits(page, viewport.height);
        const buttons = await page.locator('.panel-row button').evaluateAll(nodes => nodes.filter(node => !(node as HTMLElement).closest('[hidden]')).map(node => {
          const r = node.getBoundingClientRect(), panel = node.closest('.lobby-panel')!.getBoundingClientRect();
          return { text: node.textContent, left: r.left, right: r.right, panelLeft: panel.left, panelRight: panel.right };
        }));
        assert.ok(buttons.every(b => b.left >= b.panelLeft && b.right <= b.panelRight), `${map} option buttons fit: ${JSON.stringify(buttons)}`);
        await page.locator('#multi-button').scrollIntoViewIfNeeded();
        const online = await page.locator('#multi-button').boundingBox(); assert.ok(online && online.y >= 0 && online.y + online.height <= viewport.height);
      }
      await page.click('#map-picker'); await page.click('#map-choice button[data-value="range"]');
      await page.screenshot({ path: `output/playwright/command-menu-${viewport.width}-${viewport.height}.png` });
      await page.click('#tab-maps');
      await page.screenshot({ path: `output/playwright/command-maps-${viewport.width}-${viewport.height}.png` });
      await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => document.activeElement?.id), 'tab-maps');
      await page.click('#tab-settings');
      assert.equal(await page.locator('.lobby-stage').evaluate(el => (el as HTMLElement).inert), true);
      for (const category of ['character', 'audio', 'controls', 'graphics', 'help']) {
        await page.click(`#settings-category-${category}`);
        assert.equal(await page.locator('[data-settings-group]:not([hidden])').count(), 1);
        const metrics = await page.locator('#settings-panel .menu-modal-card').evaluate(el => {
          const r = el.getBoundingClientRect(), b = el.querySelector('#back-play')!.getBoundingClientRect(), c = el.querySelector('.settings-content')!;
          return { left:r.left,right:r.right,top:r.top,bottom:r.bottom,bt:b.top,bb:b.bottom,bl:b.left,br:b.right,w:innerWidth,h:innerHeight,cw:c.clientWidth,csw:c.scrollWidth };
        });
        assert.ok(metrics.left >= 0 && metrics.right <= metrics.w && metrics.top >= 0 && metrics.bottom <= metrics.h && metrics.bt >= metrics.top && metrics.bb <= metrics.bottom, JSON.stringify(metrics));
        assert.ok(metrics.bl >= metrics.left && metrics.br <= metrics.right, 'settings footer fits horizontally');
        assert.ok(metrics.csw <= metrics.cw + 1, JSON.stringify(metrics));
      }
      await page.click('#settings-category-audio'); await page.locator('#volume').fill('0.35');
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('lastlight.settings.v1')!).volume), 0.35);
      await page.click('#settings-category-controls');
      if (touch) { await page.locator('#assist-choice').scrollIntoViewIfNeeded(); assert.ok(await page.locator('#assist-choice').isVisible()); }
      await page.screenshot({ path: `output/playwright/command-settings-${viewport.width}-${viewport.height}.png` });
      await page.locator('#back-play').focus(); await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'menu-settings-close');
      await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => document.activeElement?.id), 'tab-settings');
      assert.equal(await page.locator('.lobby-stage').evaluate(el => (el as HTMLElement).inert), false);
      await page.click('#tab-character'); assert.ok(await page.locator('#settings-group-character').isVisible());
      await page.click('#back-play');
      await fits(page, viewport.height); assert.deepEqual(errors, []);
      await page.click('#multi-button'); assert.ok(await page.locator('#lobby-screen').isVisible());
    } finally { await page.close(); }
  });
}
