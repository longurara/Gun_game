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
  server = await createServer({ root: process.cwd(), cacheDir: mkdtempSync(join(tmpdir(), 'lastlight-assets-')), logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  const address = server.httpServer!.address();
  url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 5173}/`;
  const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
  browser = await chromium.launch({ executablePath, headless: true });
  mkdirSync('output/playwright', { recursive: true });
});
after(async () => { await browser?.close(); await server?.close(); });

async function ready(page: Page) {
  await page.goto(url);
  await page.waitForFunction(() => !!(window as any).__LASTLIGHT__, undefined, { timeout: 45000 });
  await page.waitForFunction(() => (window as any).__LASTLIGHT__.scene.meshes.some((m: any) => m.metadata?.freeAsset === 'swat'));
}

test('local CC0 models render in the menu, match and inventory and survive restarting', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    const decoded = new WeakSet<AudioBuffer>();
    const probe = { decoded: 0, played: 0 };
    (window as any).__MENU_AUDIO__ = probe;
    const decode = AudioContext.prototype.decodeAudioData;
    AudioContext.prototype.decodeAudioData = async function(bytes: ArrayBuffer) {
      const buffer = await decode.call(this, bytes);
      decoded.add(buffer); probe.decoded++;
      return buffer;
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function(...args: Parameters<typeof start>) {
      if (this.buffer && decoded.has(this.buffer)) probe.played++;
      start.apply(this, args);
    };
  });
  await ready(page);
  assert.ok(await page.locator('#start-button').evaluate(el => getComputedStyle(el).borderImageSource.includes('svg')));
  assert.ok(await page.locator('#start-button').evaluate(async el => {
    const url = getComputedStyle(el).borderImageSource.match(/url\(["']?(.*?)["']?\)$/)?.[1];
    const svg = url ? await fetch(url).then(response => response.text()) : '';
    return svg.includes('#f5b50a') || svg.includes('#ffc52c');
  }));
  assert.equal(await page.locator('#start-button').evaluate(el => getComputedStyle(el).color), 'rgb(33, 26, 7)');
  assert.equal(await page.locator('.input-prompt img').count(), 15);
  assert.ok(await page.locator('.input-prompt img').evaluateAll(images => images.every(image => (image as HTMLImageElement).naturalWidth > 0)));
  await page.screenshot({ path: 'output/playwright/assets-menu.png' });
  await page.click('#asset-credits-button');
  await page.waitForSelector('#asset-credits[open]');
  assert.match(await page.locator('#asset-credits').innerText(), /Oğuzhan Girgin.*CC BY 4.0/);
  await page.waitForFunction(() => (window as any).__MENU_AUDIO__.decoded === 4);
  await page.screenshot({ path: 'output/playwright/assets-credits.png' });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#asset-credits').evaluate(el => (el as HTMLDialogElement).open), false);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'asset-credits-button');
  await page.waitForTimeout(120);
  await page.click('#tab-settings');
  await page.waitForFunction(() => (window as any).__MENU_AUDIO__.played > 0);
  await page.locator('#volume').evaluate(el => { (el as HTMLInputElement).value = '0'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(120);
  const beforeMuteClick = await page.evaluate(() => (window as any).__MENU_AUDIO__.played);
  await page.click('#back-play');
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => (window as any).__MENU_AUDIO__.played), beforeMuteClick, 'menu obeys volume=0');
  await page.click('#map-choice button[data-value="range"]');
  await page.click('#start-button');
  await page.waitForFunction(() => (window as any).__LASTLIGHT__.simulation.state.phase === 'playing');
  await page.waitForTimeout(800);
  const meshes = await page.evaluate(() => {
    const app = (window as any).__LASTLIGHT__;
    return app.scene.meshes.filter((m: any) => m.isEnabled() && m.metadata?.actorId === app.simulation.localId).map((m: any) => ({ name: m.name, vertices: m.getTotalVertices() }));
  });
  assert.ok(meshes.some((m: any) => m.name.includes('swat') && m.vertices > 0));
  assert.ok(meshes.some((m: any) => m.name.includes('free-gun') && m.vertices > 0));
  await page.keyboard.press('KeyC'); await page.waitForTimeout(350);
  await page.screenshot({ path: 'output/playwright/assets-crouch.png' });
  await page.keyboard.press('KeyZ'); await page.waitForTimeout(350);
  await page.screenshot({ path: 'output/playwright/assets-prone.png' });
  await page.keyboard.press('KeyZ');
  await page.keyboard.press('KeyI');
  await page.waitForSelector('#inventory-screen:not([hidden])');
  await page.waitForTimeout(2200);
  await page.screenshot({ path: 'output/playwright/assets-inventory.png' });
  await page.keyboard.press('KeyI');
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.waitForSelector('#pause-screen:not([hidden])');
  await page.waitForFunction(() => document.pointerLockElement === null);
  await page.screenshot({ path: 'output/playwright/assets-pause.png' });
  await page.click('#pause-restart');
  await page.waitForTimeout(800);
  assert.deepEqual(errors, []);
  await page.close();
});

test('missing GLBs fall back to procedural models without preventing play', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/assets/free/*.glb', route => route.fulfill({ status: 404, body: '' }));
  await page.goto(url);
  await page.waitForFunction(() => !!(window as any).__LASTLIGHT__, undefined, { timeout: 45000 });
  await page.click('#map-choice button[data-value="range"]'); await page.click('#start-button');
  await page.waitForFunction(() => (window as any).__LASTLIGHT__.simulation.state.phase === 'playing');
  assert.deepEqual(errors, []);
  await page.close();
});

test('Bunker controls and touch prompts fit the phone menu and credits close with touch', async () => {
  const context = await browser.newContext({ viewport: { width: 740, height: 360 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await ready(page);
  await page.locator('#start-button').scrollIntoViewIfNeeded();
  const box = await page.locator('#start-button').boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= 740 && box.height >= 44);
  assert.equal(await page.locator('.touch-guide img').count(), 4);
  await page.screenshot({ path: 'output/playwright/assets-phone.png' });
  await page.locator('#asset-credits-button').tap();
  const creditBox = await page.locator('#asset-credits').boundingBox();
  assert.ok(creditBox && creditBox.x >= 0 && creditBox.x + creditBox.width <= 740 && creditBox.height <= 360);
  await page.locator('#asset-credits-close').tap();
  assert.equal(await page.locator('#asset-credits').evaluate(el => (el as HTMLDialogElement).open), false);
  assert.deepEqual(errors, []);
  await context.close();
});

test('missing interface audio cannot block menu, credits or starting a match', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*.ogg*', route => route.request().resourceType() === 'script' ? route.continue() : route.fulfill({ status: 404, body: '' }));
  await ready(page);
  await page.click('#asset-credits-button');
  await page.click('#asset-credits-close');
  await page.click('#map-choice button[data-value="range"]');
  await page.click('#start-button');
  await page.waitForFunction(() => (window as any).__LASTLIGHT__.simulation.state.phase === 'playing');
  assert.deepEqual(errors, []);
  await page.close();
});
