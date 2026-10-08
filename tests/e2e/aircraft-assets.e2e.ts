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
  server = await createServer({ cacheDir: mkdtempSync(join(tmpdir(), 'lastlight-aircraft-')), logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
  await server.listen(); const address = server.httpServer!.address();
  url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 5173}`;
  browser = await chromium.launch({ executablePath: ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync), headless: true });
  mkdirSync('output/playwright', { recursive: true });
});
after(async () => { await browser?.close(); await server?.close(); });

async function startDrop(page: Page) {
  await page.goto(url);
  await page.waitForFunction(() => !!(window as any).__LASTLIGHT__, undefined, { timeout: 45000 });
  { await page.click('#map-picker'); await page.click('#map-choice button[data-value="valley"]'); } await page.click('#start-button');
  await page.waitForFunction(() => (window as any).__LASTLIGHT__.simulation.player.air?.mode === 'plane');
}
const readyAircraft = (page: Page) => page.waitForFunction(() => (window as any).__LASTLIGHT__.scene.meshes.some((mesh: any) => mesh.metadata?.freeAsset === 'airplane' && mesh.getTotalVertices() > 0 && mesh.isEnabled() && mesh.material?.diffuseTexture?.isReady()), undefined, { timeout: 45000 });

test('textured aircraft replaces the fallback, aligns with the route and reuses its model after restart', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  let requests = 0; page.on('request', request => { if (request.url().endsWith('/aircraft/airplane.glb')) requests++; });
  await startDrop(page); await readyAircraft(page); await page.waitForTimeout(500);
  const info = await page.evaluate(() => {
    const {scene,simulation} = (window as any).__LASTLIGHT__, root = scene.getTransformNodeByName('transport-plane');
    const mesh = scene.meshes.find((mesh: any) => mesh.metadata?.freeAsset === 'airplane' && mesh.getTotalVertices() > 0);
    const inverse = root.computeWorldMatrix(true).clone().invert(), transform = mesh.computeWorldMatrix(true).multiply(inverse), positions = mesh.getVerticesData('position');
    let minX = Infinity, maxX = -Infinity, finY = -Infinity, finZ = 0;
    for (let i = 0; i < positions.length; i += 3) {
      const point = root.position.constructor.TransformCoordinates(root.position.constructor.FromArray(positions, i), transform);
      minX = Math.min(minX,point.x); maxX = Math.max(maxX,point.x);
      if (point.y > finY) { finY = point.y; finZ = point.z; }
    }
    return { width:maxX-minX, finZ, yaw:root.rotation.y, routeYaw:simulation.state.plane.yaw, position:root.position.asArray(), plane:[simulation.state.plane.x,simulation.state.plane.y,simulation.state.plane.z], fallback:scene.getMeshByName('plane-fuselage').isEnabled(), pickable:mesh.isPickable, active:scene.getActiveMeshes().data.includes(mesh), count:scene.meshes.filter((m: any)=>m.metadata?.freeAsset==='airplane' && m.getTotalVertices()>0).length };
  });
  assert.ok(Math.abs(info.width-34)<.01);
  assert.ok(info.finZ < 0, 'tail fin stays aft; nose points along the route');
  assert.equal(info.yaw, info.routeYaw); assert.deepEqual(info.position,info.plane);
  assert.equal(info.fallback,false); assert.equal(info.pickable,false); assert.equal(info.active,true); assert.equal(info.count,1);
  await page.screenshot({ path:'output/playwright/aircraft-desktop.png' });
  await page.keyboard.press('Escape'); await page.waitForSelector('#pause-screen:not([hidden])'); await page.click('#pause-restart'); await readyAircraft(page);
  assert.equal(requests,1);
  assert.equal(await page.evaluate(()=>(window as any).__LASTLIGHT__.scene.meshes.filter((m: any)=>m.metadata?.freeAsset==='airplane'&&m.getTotalVertices()>0).length),1);
  await page.waitForTimeout(1700); await page.keyboard.press('Space');
  await page.waitForFunction(()=>(window as any).__LASTLIGHT__.simulation.player.air?.mode==='freefall');
  assert.equal(await page.isVisible('#crosshair'),false);
  assert.deepEqual(errors,[]); await page.close();
});

test('a failed aircraft download preserves a playable transport and jump', async () => {
  const page = await browser.newPage({ viewport:{width:1280,height:720} });
  const errors: string[] = [];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/assets/aircraft/airplane.glb',route=>route.fulfill({status:404,body:''}));
  await startDrop(page); await page.waitForTimeout(1800);
  assert.equal(await page.evaluate(()=>(window as any).__LASTLIGHT__.scene.getMeshByName('plane-fuselage').isEnabled()),true);
  assert.equal(await page.evaluate(()=>(window as any).__LASTLIGHT__.scene.meshes.some((m: any)=>m.metadata?.freeAsset==='airplane')),false);
  await page.keyboard.press('Space'); await page.waitForFunction(()=>(window as any).__LASTLIGHT__.simulation.player.air?.mode==='freefall');
  assert.deepEqual(errors,[]);await page.close();
});

test('aircraft texture and flight view render on a landscape touch screen', async () => {
  const page = await browser.newPage({ viewport:{width:740,height:360},hasTouch:true,isMobile:true,deviceScaleFactor:2 });
  const errors: string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await startDrop(page);await readyAircraft(page);await page.waitForTimeout(500);
  assert.equal(await page.isVisible('#air-hud'),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:'output/playwright/aircraft-touch.png'});
  assert.deepEqual(errors,[]);await page.close();
});
