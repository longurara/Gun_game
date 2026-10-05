/**
 * Real-browser checks of what the player actually sees (CSS included), unlike the jsdom tests. Needs Microsoft Edge or
 * Google Chrome installed; run with `npm run test:e2e`. The game is served by a throwaway Vite server.
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
  const candidates = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  return candidates.find(path => existsSync(path));
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

async function open(context: BrowserContext, map: 'arena' | 'island' | 'valley'): Promise<Page> {
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.waitForSelector('#start-button', { state: 'visible' });
  await page.click(`#map-choice button[data-value="${map}"]`);
  await page.click('#start-button');
  await page.waitForFunction(() => (window as unknown as { __LASTLIGHT__?: { simulation: { state: { phase: string } } } }).__LASTLIGHT__?.simulation.state.phase === 'playing');
  (page as Page & { errors: string[] }).errors = errors;
  return page;
}

const visible = (page: Page, selector: string) => page.evaluate(sel => {
  const element = document.querySelector(sel);
  if (!element) return false;
  const style = getComputedStyle(element);
  const box = element.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' && !(element as HTMLElement).hidden && box.width > 0 && box.height > 0;
}, selector);

/** Advance the simulation directly (the browser keeps rendering), then give the page a few frames to catch up. */
const advance = (page: Page, seconds: number, stopWhen = 'false') => page.evaluate(([s, stop]) => {
  const sim = (window as unknown as { __LASTLIGHT__: { simulation: { update(dt: number, input: object): void; airborne: boolean } } }).__LASTLIGHT__.simulation;
  const idle = { moveX: 0, moveZ: 0, sprint: false, jump: false };
  const check = new Function('sim', `return ${stop}`) as (sim: unknown) => boolean;
  for (let i = 0; i < Number(s) * 30 && !check(sim); i++) sim.update(1 / 30, idle);
}, [seconds, stopWhen] as const);

test('on the ground the crosshair, weapon panel, health bar and map are all visible', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await open(context, 'arena');
  await page.waitForTimeout(500);
  for (const selector of ['#crosshair', '.weapon-panel', '.health-panel', '#minimap', '.match-stats']) assert.ok(await visible(page, selector), `${selector} is not visible`);
  assert.deepEqual((page as Page & { errors: string[] }).errors, []);
  await context.close();
});

test('crouching and lying down show a badge, change the crosshair gap, and standing hides it again', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await open(context, 'arena');
  await page.waitForTimeout(300);
  assert.equal(await visible(page, '#stance-badge'), false);
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(250);
  assert.ok(await visible(page, '#stance-badge'));
  assert.match(await page.textContent('#stance-badge') ?? '', /NGỒI/);
  await page.keyboard.press('KeyZ');
  await page.waitForTimeout(250);
  assert.match(await page.textContent('#stance-badge') ?? '', /NẰM/);
  await page.keyboard.press('KeyZ');
  await page.waitForTimeout(250);
  assert.equal(await visible(page, '#stance-badge'), false);
  await context.close();
});

test('the drop: the gun HUD is hidden in the plane and in the air, the flight readout shows, and everything is back after landing', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await open(context, 'island');
  await page.waitForTimeout(600);
  assert.ok(await visible(page, '#air-hud'), 'flight readout in the plane');
  assert.equal(await visible(page, '#crosshair'), false, 'no crosshair in the plane');
  assert.equal(await visible(page, '.weapon-panel'), false, 'no weapon panel in the plane');
  await page.keyboard.press('Space');
  await page.waitForTimeout(400);
  assert.equal(await visible(page, '#crosshair'), false, 'no crosshair while falling');
  await advance(page, 120, 'sim.airborne === false');
  await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-air')), false, 'data-air is gone after landing');
  for (const selector of ['#crosshair', '.weapon-panel', '.health-panel']) assert.ok(await visible(page, selector), `${selector} did not come back after landing`);
  assert.equal(await visible(page, '#air-hud'), false);
  assert.deepEqual((page as Page & { errors: string[] }).errors, []);
  await context.close();
});

test('phone layout: every touch button is on screen, none sits on top of another, and the stance buttons work', async () => {
  const context = await browser.newContext({ viewport: { width: 740, height: 360 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await open(context, 'arena');
  await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.input), 'touch');
  const boxes = await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('#mobile-controls .touch-button')]
    .filter(b => !b.hidden && getComputedStyle(b).display !== 'none')
    .map(b => { const r = b.getBoundingClientRect(); return { id: b.id, x: r.left, y: r.top, w: r.width, h: r.height }; }));
  assert.ok(boxes.length >= 9, `${boxes.length} buttons`);
  for (const b of boxes) {
    assert.ok(b.w > 20 && b.h > 20, `${b.id} has no size`);
    assert.ok(b.x >= -1 && b.y >= -1 && b.x + b.w <= 741 && b.y + b.h <= 361, `${b.id} is off screen: ${JSON.stringify(b)}`);
  }
  const overlap = (a: typeof boxes[number], b: typeof boxes[number]) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const shared = overlap(boxes[i], boxes[j]);
    assert.ok(shared < 0.15 * Math.min(boxes[i].w * boxes[i].h, boxes[j].w * boxes[j].h), `${boxes[i].id} overlaps ${boxes[j].id}`);
  }
  await page.tap('#touch-crouch');
  await page.waitForTimeout(250);
  assert.match(await page.textContent('#stance-badge') ?? '', /NGỒI/);
  assert.equal(await page.evaluate(() => document.querySelector('#touch-crouch')!.classList.contains('is-active')), true);
  assert.deepEqual((page as Page & { errors: string[] }).errors, []);
  await context.close();
});

test('settings: the recoil slider and aim-assist choice appear on a phone, and the gyroscope rows are hidden on a desktop', async () => {
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const dpage = await desktop.newPage();
  await dpage.goto(url);
  await dpage.click('#tab-settings');
  assert.ok(await visible(dpage, '#recoil-scale'));
  assert.equal(await visible(dpage, '#gyro-choice'), false, 'gyroscope settings are touch-only');
  assert.equal(await visible(dpage, '#assist-choice'), false, 'aim assist settings are touch-only');
  await desktop.close();
  const phone = await browser.newContext({ viewport: { width: 740, height: 360 }, hasTouch: true, isMobile: true });
  const ppage = await phone.newPage();
  await ppage.goto(url);
  await ppage.click('#tab-settings');
  await ppage.locator('#assist-choice').scrollIntoViewIfNeeded();
  assert.ok(await visible(ppage, '#assist-choice'));
  assert.ok(await visible(ppage, '#gyro-choice'));
  await phone.close();
});
