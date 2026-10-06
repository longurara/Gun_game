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
  server = await createServer({ root: process.cwd(), cacheDir: mkdtempSync(join(tmpdir(), 'lastlight-loading-')), logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
  await server.listen(); const address = server.httpServer!.address();
  url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 5173}`;
  browser = await chromium.launch({ executablePath: ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync), headless: true });
  mkdirSync('output/playwright', { recursive: true });
});
after(async () => { await browser?.close(); await server?.close(); });

for (const device of [
  { name:'desktop', width:1440, height:900, map:'island', reduced:false },
  { name:'phone', width:390, height:844, map:'range', reduced:true },
  { name:'small-phone', width:320, height:568, map:'desert', reduced:false },
  { name:'landscape', width:844, height:390, map:'range', reduced:false },
]) test(`loading briefing fits ${device.name}, follows real stages and clears when ready`, async () => {
  const page = await browser.newPage({ viewport:{width:device.width,height:device.height}, reducedMotion:device.reduced?'reduce':'no-preference' });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/assets/free/swat.glb', async route => {
    await gate;
    if (device.name==='small-phone') await route.fulfill({ status:404,body:'' });
    else await route.continue();
  });
  await page.addInitScript(({map}) => {
    localStorage.setItem('lastlight.settings.v1',JSON.stringify({map,botCount:10,quality:'low'}));
    const steps: string[] = [];
    (window as any).__LOADING_STEPS__ = steps;
    new MutationObserver(() => {
      const screen = document.getElementById('loading-screen');
      const count = document.getElementById('loading-step-count')?.textContent;
      if (screen && !screen.hidden && count && !steps.includes(count)) steps.push(count);
    }).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden']});
  }, { map:device.map });
  try {
    await page.goto(url, {waitUntil:'commit'});
    await page.waitForFunction(() => document.getElementById('loading-step-count')?.textContent === '02 / 03',undefined,{timeout:45000});
    await page.waitForTimeout(350);
    assert.equal(await page.locator('#loading-screen').isVisible(),true);
    assert.equal(await page.locator('.loading-steps [data-state="active"]').count(),1);
    assert.equal(await page.locator('.loading-steps [data-state="complete"]').count(),1);
    assert.equal(await page.locator('#loading-map-code').textContent(),device.map.toUpperCase());
    const layout = await page.evaluate(() => {
      const screen = document.getElementById('loading-screen')!;
      const boxes = ['.loading-header','.loading-copy','.loading-intel','.loading-transfer'].map(selector => {const box=document.querySelector(selector)!.getBoundingClientRect();return {x:box.x,y:box.y,right:box.right,bottom:box.bottom};});
      const canvas = document.getElementById('loading-map-canvas') as HTMLCanvasElement;
      return { boxes, width:innerWidth,height:innerHeight,scroll:screen.scrollHeight>screen.clientHeight+1, overflow:screen.scrollWidth>screen.clientWidth, pixels:canvas.getContext('2d')!.getImageData(160,160,1,1).data[3],animation:getComputedStyle(document.querySelector('.loading-radar-sweep')!).animationName };
    });
    assert.equal(layout.overflow,false,JSON.stringify(layout));
    assert.equal(layout.scroll,false,JSON.stringify(layout));
    assert.ok(layout.boxes.every(box=>box.x>=0&&box.y>=0&&box.right<=layout.width+1&&box.bottom<=layout.height+1),JSON.stringify(layout));
    assert.equal(layout.pixels,255,'radar reuses the actual map preview');
    if (device.reduced) assert.equal(layout.animation,'none');
    await page.screenshot({path:`output/playwright/loading-${device.name}.png`});
    // It remains on the real asset stage while the download is held.
    assert.equal(await page.locator('#loading-step-count').textContent(),'02 / 03');
    release();
    await page.waitForFunction(() => document.getElementById('loading-screen')?.hidden,undefined,{timeout:45000});
    assert.deepEqual(await page.evaluate(() => (window as any).__LOADING_STEPS__),['01 / 03','02 / 03','03 / 03']);
    await page.waitForFunction(() => !!(window as any).__LASTLIGHT__,undefined,{timeout:45000});
    assert.deepEqual(errors,[]);
  } finally { release(); await page.close(); }
});
