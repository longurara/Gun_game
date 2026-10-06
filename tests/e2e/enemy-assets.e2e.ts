import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import { chromium } from 'playwright-core';
import type { Browser } from 'playwright-core';

let server: ViteDevServer, browser: Browser, url: string;
before(async () => {
  server = await createServer({ root: process.cwd(), cacheDir: mkdtempSync(join(tmpdir(), 'lastlight-enemies-')), logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
  await server.listen(); const address = server.httpServer!.address();
  url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 5173}`;
  browser = await chromium.launch({ executablePath: ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync), headless: true });
  mkdirSync('output/playwright', { recursive: true });
});
after(async () => { await browser?.close(); await server?.close(); });

test('all twelve enemy appearances render, hold guns, change stance, obey detail switches and dispose cleanly', async () => {
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(url + '/tests/fixtures/enemy-gallery.html');
  await page.waitForFunction(() => !!(window as any).__ENEMY_GALLERY__, undefined, { timeout: 60000 });
  await page.waitForTimeout(700);
  const inspect = () => page.evaluate(() => {
    const gallery = (window as any).__ENEMY_GALLERY__;
    return gallery.actors.map((actor: any) => {
      const avatar = actor.soldier.swat;
      const meshes = actor.soldier.root.getChildMeshes().filter((mesh: any) => mesh.metadata?.enemyAsset);
      actor.soldier.gun.computeWorldMatrix(true);
      const hands = avatar?.arms.map((arm: any, side: number) => {
        arm.end.computeWorldMatrix(true);
        const p = arm.end.getAbsolutePosition(), anchor = side ? actor.soldier.current.grip : actor.soldier.current.fore;
        const target = anchor.constructor.TransformCoordinates(anchor, actor.soldier.gun.getWorldMatrix());
        return {x:p.x,y:p.y,z:p.z, gripError:p.subtract(target).length()};
      });
      return { id: actor.model.id, imported: !!avatar, visible: meshes.filter((mesh: any) => mesh.isEnabled()).length, vertices: meshes.reduce((sum: number, mesh: any) => sum+mesh.getTotalVertices(),0), hands, clip: actor.soldier.swatClip?.name, textured: meshes.some((mesh: any) => mesh.material?.diffuseTexture?.isReady()), scale: avatar?.wrapper?.scaling.y };
    });
  });
  let avatars = await inspect();
  writeFileSync('output/playwright/enemy-model-report.json', JSON.stringify(avatars, null, 2));
  assert.ok(avatars.every((avatar: any) => avatar.hands.every((hand: any) => hand.gripError < .12)), JSON.stringify(avatars));
  assert.ok(avatars.filter((avatar: any) => /survivor|zombie/.test(avatar.id)).every((avatar: any) => avatar.scale > .4 && avatar.scale < .6), 'Kenney skin common ancestor preserves unit/axis conversion');
  assert.equal(avatars.length, 12);
  assert.ok(avatars.every((avatar: any) => avatar.imported && avatar.visible > 0 && avatar.vertices > 0), JSON.stringify(avatars));
  assert.ok(avatars.filter((avatar: any) => /survivor|zombie/.test(avatar.id)).every((avatar: any) => avatar.textured));
  await page.screenshot({ path: 'output/playwright/enemies-standing.png' });
  for (const pose of ['run','crouch','prone']) {
    await page.click(`[data-pose="${pose}"]`); await page.waitForTimeout(250);
    avatars = await inspect();
    assert.ok(avatars.every((avatar: any) => avatar.hands.every((hand: any) => [hand.x,hand.y,hand.z].every(Number.isFinite))));
    assert.ok(avatars.every((avatar: any) => avatar.hands.every((hand: any) => hand.gripError < .18)), `${pose}: ${JSON.stringify(avatars)}`);
    await page.screenshot({ path: `output/playwright/enemies-${pose}.png` });
  }
  await page.evaluate(() => (window as any).__ENEMY_GALLERY__.actors.forEach((actor: any) => actor.soldier.setDetail(false)));
  assert.ok((await inspect()).every((avatar: any) => avatar.visible === 0));
  await page.evaluate(() => (window as any).__ENEMY_GALLERY__.actors.forEach((actor: any) => { actor.soldier.setDetail(true); actor.soldier.setGear(2,3); }));
  assert.ok((await inspect()).every((avatar: any) => avatar.visible > 0));
  await page.evaluate(() => (window as any).__ENEMY_GALLERY__.dispose());
  assert.equal(await page.evaluate(() => (window as any).__ENEMY_GALLERY__.scene.meshes.filter((mesh: any) => mesh.metadata?.enemyAsset).length), 0);
  assert.deepEqual(errors, []); await page.close();
});

test('real range bots gain imported appearances while missing enemy files keep procedural fallback playable', async () => {
  for (const missing of [false, true]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    if (missing) await page.route('**/assets/enemies/*.glb', route => route.fulfill({ status: 404, body: '' }));
    await page.goto(url);
    await page.waitForFunction(() => !!(window as any).__LASTLIGHT__, undefined, { timeout: 45000 });
    await page.click('#map-choice button[data-value="range"]'); await page.click('#start-button');
    await page.waitForFunction(() => (window as any).__LASTLIGHT__.simulation.state.phase === 'playing');
    // Bring a few real bots close enough to need a detailed model; preserve actor ids and AI.
    await page.evaluate(() => {
      const sim = (window as any).__LASTLIGHT__.simulation, p = sim.player.position;
      sim.state.actors.filter((actor: any) => !actor.isPlayer && !actor.id.startsWith('dummy')).slice(0,16).forEach((actor: any,index: number)=>{actor.position={x:p.x+5+index,y:p.y,z:p.z+10};});
    });
    if (!missing) await page.waitForFunction(() => (window as any).__LASTLIGHT__.scene.meshes.some((mesh: any) => mesh.metadata?.enemyAsset && mesh.metadata.enemyAsset !== 'swat' && mesh.isEnabled()), undefined, { timeout: 45000 });
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => (window as any).__LASTLIGHT__.simulation.state.phase), 'playing');
    assert.deepEqual(errors, []); await page.close();
  }
});
