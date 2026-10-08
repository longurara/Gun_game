import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import { chromium } from 'playwright-core';
import type { Browser } from 'playwright-core';
let server: ViteDevServer, browser: Browser, url: string;
before(async () => {
  server = await createServer({ envFile: false, cacheDir: mkdtempSync(join(tmpdir(), 'compounds-')), logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
  await server.listen(); url = `http://127.0.0.1:${(server.httpServer!.address() as any).port}`;
  browser = await chromium.launch({ executablePath: ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync), headless: true });
  mkdirSync('output/playwright', { recursive: true });
});
after(async () => { await browser?.close(); await server?.close(); });

test('four compounds render textured modules in native Chrome; distance detail streams without errors', { timeout: 180000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(url + '/tests/fixtures/compounds-gallery.html', { waitUntil: 'commit' });
    await page.waitForFunction(() => !!(window as any).__COMPOUNDS_GALLERY__, undefined, { timeout: 60000 });
    for (const kind of ['temple', 'depot', 'garden', 'citadel']) {
      const info = await page.evaluate(async kind => (window as any).__COMPOUNDS_GALLERY__.show(kind), kind);
      assert.ok(info.meshes > 20 && info.vertices > 10000, kind + ': map and modules rendered');
      await page.waitForTimeout(350);
      await page.screenshot({ path: `output/playwright/compound-${kind}.png` });
      console.log(kind, JSON.stringify(info));
    }
    await page.evaluate(async () => (window as any).__COMPOUNDS_GALLERY__.show('temple', true));
    await page.screenshot({ path: 'output/playwright/compound-temple-far.png' });
    assert.deepEqual(errors, []);
  } finally {
    await page.evaluate(() => (window as any).__COMPOUNDS_GALLERY__?.engine.dispose()).catch(() => {});
    await page.close();
  }
});

test('the island menu describes four destinations and the live match loads all four', { timeout: 120000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } }), errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*.supabase.co/**', r => r.abort());
  await page.addInitScript(() => localStorage.setItem('lastlight.settings.v1', JSON.stringify({ map: 'island', botCount: 3, quality: 'low' })));
  try {
    await page.goto(url, { waitUntil: 'commit' });
    await page.waitForFunction(() => !!(window as any).__LASTLIGHT__, undefined, { timeout: 60000 });
    await page.click('#map-picker');
    await page.click('#map-choice button[data-value="island"]');
    await page.click('#start-button');
    await page.waitForFunction(() => (window as any).__LASTLIGHT__.simulation.state.phase === 'playing', undefined, { timeout: 60000 });
    const kinds = await page.evaluate(() => (window as any).__LASTLIGHT__.simulation.world.hotAreas.map((h: any) => h.kind));
    assert.deepEqual(kinds, ['temple', 'depot', 'garden', 'citadel']);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
