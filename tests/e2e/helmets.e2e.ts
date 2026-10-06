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
  server = await createServer({ root: process.cwd(), cacheDir: mkdtempSync(join(tmpdir(), 'lastlight-helmets-')), logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
  await server.listen(); const address = server.httpServer!.address();
  url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 5173}`;
  browser = await chromium.launch({ executablePath: ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync), headless: true });
  mkdirSync('output/playwright', { recursive: true });
});
after(async () => { await browser?.close(); await server?.close(); });

test('SWAT helmets use the head skin, preserve mask geometry and isolate each equipment tier', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 540 } });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(url + '/tests/fixtures/helmet-gallery.html');
  await page.waitForFunction(() => !!(window as any).__HELMET_GALLERY__, undefined, { timeout: 60000 });
  const inspect = () => page.evaluate(() => {
    const gallery = (window as any).__HELMET_GALLERY__;
    return gallery.actors.map((actor: any) => {
      const shell = actor.importedMeshes.find((mesh: any) => mesh.name.endsWith('-Swat_Helmet'));
      const head = actor.importedMeshes.find((mesh: any) => mesh.name.endsWith('-Swat_Head_primitive1'));
      const face = actor.importedMeshes.find((mesh: any) => mesh.name.endsWith('-Swat_Head_primitive0'));
      const visor = actor.importedMeshes.find((mesh: any) => mesh.name.endsWith('-Swat_Head_primitive2'));
      const shellIndices = shell.getIndices(), remaining = new Set(head.getIndices());
      shell.computeWorldMatrix(true); head.computeWorldMatrix(true);
      const shellPositions = shell.getVerticesData('position'), originalPositions = head.getVerticesData('position');
      return {
        color: actor.swat.helmet.diffuseColor.asArray(), base: actor.swat.helmetBase.asArray(),
        procedural: actor.helmet.some((mesh: any) => mesh.isEnabled()),
        sameSkin: shell.skeleton === head.skeleton,
        sameTransform: shell.getWorldMatrix().equalsWithEpsilon(head.getWorldMatrix(), 1e-6),
        sameWeights: ['matricesIndices','matricesWeights'].every(kind => JSON.stringify(shell.getVerticesData(kind)) === JSON.stringify(head.getVerticesData(kind))),
        originalVertices: shellIndices.every((index: number) => [0,1,2].every(axis => shellPositions[index*3+axis] === originalPositions[index*3+axis])),
        overlapping: shellIndices.some((index: number) => remaining.has(index)),
        count: shellIndices.length + head.getTotalIndices(),
        maskVisible: face.isEnabled() && visor.isEnabled(),
        maskCount: face.getTotalIndices() + visor.getTotalIndices(),
        privateMaterial: shell.material !== head.material,
      };
    });
  });
  for (const pose of ['stand','showcase','run','crouch','prone']) {
    await page.evaluate(pose => (window as any).__HELMET_GALLERY__.setPose(pose), pose);
    await page.waitForTimeout(220);
    const actors = await inspect();
    assert.ok(actors.every((actor: any) => !actor.procedural && actor.sameSkin && actor.sameTransform && actor.sameWeights && actor.originalVertices && !actor.overlapping && actor.maskVisible && actor.privateMaterial), `${pose}: ${JSON.stringify(actors)}`);
    assert.ok(actors.every((actor: any) => actor.count === 2790 && actor.maskCount === 4134), 'all original face/helmet triangles remain exactly once');
    for (const [tier, color] of [[1,[.55,.6,.5]],[2,[.3,.52,.88]],[3,[.92,.7,.22]]] as const) assert.deepEqual(actors[tier].color, color);
    assert.deepEqual(actors[0].color, actors[0].base);
    if (pose === 'stand' || pose === 'showcase') await page.screenshot({ path: `output/playwright/helmets-${pose}.png` });
  }
  await page.evaluate(() => (window as any).__HELMET_GALLERY__.actors[2].setGear(0,0));
  const actors = await inspect();
  assert.deepEqual(actors[2].color, actors[2].base);
  assert.deepEqual(actors[3].color, [.92,.7,.22], 'unequipping one actor does not recolor another');
  await page.evaluate(() => {
    const gallery = (window as any).__HELMET_GALLERY__;
    gallery.engine.stopRenderLoop();
    gallery.actors[2].setGear(1,0); gallery.actors[1].dispose();
  });
  assert.equal(await page.evaluate(() => { const gallery = (window as any).__HELMET_GALLERY__; return gallery.scene.materials.includes(gallery.actors[2].swat.helmet); }), true);
  await page.evaluate(() => {
    const gallery = (window as any).__HELMET_GALLERY__; gallery.engine.stopRenderLoop();
    gallery.actors.filter((_: any,index: number) => index !== 1).forEach((actor: any) => actor.dispose());
  });
  assert.equal(await page.evaluate(() => (window as any).__HELMET_GALLERY__.scene.materials.filter((material: any) => /helmet-test-.*-swat-helmet/.test(material.name)).length), 0);
  assert.deepEqual(errors, []); await page.close();
});

test('missing SWAT assets keep the procedural helmet equip and removal working', async () => {
  const page = await browser.newPage(); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/assets/free/swat.glb', route => route.fulfill({ status: 404, body: '' }));
  await page.goto(url + '/tests/fixtures/helmet-gallery.html');
  await page.waitForFunction(() => !!(window as any).__HELMET_GALLERY__, undefined, { timeout: 60000 });
  assert.deepEqual(await page.evaluate(() => (window as any).__HELMET_GALLERY__.actors.map((actor: any) => ({ imported: !!actor.swat, helmet: actor.helmet.every((mesh: any) => mesh.isEnabled()) }))), [false,true,true,true].map(helmet => ({ imported: false, helmet })));
  await page.evaluate(() => (window as any).__HELMET_GALLERY__.actors[2].setGear(0,0));
  assert.equal(await page.evaluate(() => (window as any).__HELMET_GALLERY__.actors[2].helmet.some((mesh: any) => mesh.isEnabled())), false);
  assert.deepEqual(errors, []); await page.close();
});


test('SWAT palms grip every imported gun through stance, reload and recoil changes', async () => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 750 } });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(url + '/tests/fixtures/helmet-gallery.html');
  await page.waitForFunction(() => !!(window as any).__HELMET_GALLERY__, undefined, { timeout: 60000 });
  const roster = await page.evaluate(async () => {
    const { WEAPONS } = await import('/src/game/weapons.ts' as string);
    const { freeGun } = await import('/src/free-assets.ts' as string);
    const gallery = (window as any).__HELMET_GALLERY__, seen = new Set(), weapons: string[] = [];
    gallery.engine.stopRenderLoop();
    gallery.actors.forEach((actor: any, index: number) => actor.setEnabled(index === 2));
    const actor = gallery.actors[2]; actor.root.position.setAll(0); actor.root.rotation.y = .45;
    gallery.camera.position.set(3,1.9,.9); gallery.camera.orthoLeft=-.65;gallery.camera.orthoRight=.65;
    gallery.camera.orthoTop=.4875;gallery.camera.orthoBottom=-.4875;
    gallery.camera.setTarget(gallery.camera.position.constructor.FromArray([0,1.35,.18]));
    for (const weapon of Object.values(WEAPONS) as any[]) {
      const model = freeGun(gallery.scene, weapon.kind, weapon.look);
      if (!model) continue;
      const id = model.meshes[0].name.split('-')[2];
      if (!seen.has(id)) { seen.add(id); weapons.push(weapon.id); }
    }
    return weapons;
  });
  assert.equal(roster.length, 13);
  const report: any[] = [];
  for (const weapon of roster) for (const pose of ['stand','run','crouch','prone','showcase','reload','recoil']) {
    const hands = await page.evaluate(({ weapon, pose }) => {
      const gallery = (window as any).__HELMET_GALLERY__, actor = gallery.actors[2];
      actor.setWeapon(weapon); if (pose === 'recoil') actor.fire();
      actor.root.rotation.x = pose === 'prone' ? Math.PI / 2 - .12 : 0;
      actor.pose(.016, { moving:pose==='run'?4:0,stride:2,alive:true,reloading:pose==='reload',healing:false,time:2,crouch:pose==='crouch'?1:0,prone:pose==='prone'?1:0,showcase:pose==='showcase' });
      gallery.scene.render(); actor.gun.computeWorldMatrix(true);
      const Vec = actor.gun.position.constructor, pistol = actor.current.root.metadata.category.startsWith('Súng lục');
      return actor.swat.hands.map((hand: any, side: number) => {
        const knuckle = hand.fingers.find((finger: any) => finger.node.name.endsWith(`-Middle4.${side?'R':'L'}`)).node;
        hand.wrist.computeWorldMatrix(true); knuckle.computeWorldMatrix(true);
        const hold = side ? actor.current.grip : actor.current.fore;
        const target = Vec.TransformCoordinates(hold, actor.gun.getWorldMatrix());
        const desired = Vec.TransformNormal(side || pistol ? new Vec(0,-.25,1) : new Vec(1,0,0),actor.gun.getWorldMatrix()).normalize();
        const actual = Vec.TransformNormal(new Vec(0,1,0),hand.wrist.getWorldMatrix()).normalize();
        return { contactError:knuckle.getAbsolutePosition().subtract(target).length(), alignment:Vec.Dot(actual,desired), scale:hand.wrist.scaling.divide(hand.scale).asArray(), fingersClosed:hand.fingers.every((finger: any) => Math.abs(finger.node.rotationQuaternion.dot(finger.grip)) > .99999) };
      });
    }, { weapon, pose });
    report.push({weapon,pose,hands});
    assert.ok(hands.every((hand: any) => hand.contactError < .12 && hand.alignment > .999 && hand.fingersClosed && hand.scale.every((value: number) => Math.abs(value-.75)<1e-5)), `${weapon}/${pose}: ${JSON.stringify(hands)}`);
    if (['rifle','pistol','shotgun','sniper'].includes(weapon) && pose==='stand') {
      await page.waitForTimeout(100); await page.evaluate(() => (window as any).__HELMET_GALLERY__.scene.render());
      await page.screenshot({ path:`output/playwright/verified-grip-${weapon}.png` });
    }
  }
  writeFileSync('output/playwright/hand-grip-report.json',JSON.stringify(report,null,2));
  await page.evaluate(() => {
    const gallery = (window as any).__HELMET_GALLERY__, bot = gallery.createSwatBot();
    bot.setGear(2,0); bot.setDetail(true);
    (window as any).__HELMET_BOT__ = bot;
  });
  assert.deepEqual(await page.evaluate(() => { const bot = (window as any).__HELMET_BOT__; return { imported:!!bot.swat.helmet, procedural:bot.helmet.some((mesh: any)=>mesh.isEnabled()), color:bot.swat.helmet.diffuseColor.asArray() }; }), { imported:true, procedural:false, color:[.3,.52,.88] });
  await page.evaluate(() => (window as any).__HELMET_BOT__.setDetail(false));
  assert.equal(await page.evaluate(() => (window as any).__HELMET_BOT__.helmet.every((mesh: any)=>mesh.isEnabled())), true);
  await page.evaluate(() => { const bot = (window as any).__HELMET_BOT__; bot.setDetail(true);bot.setGear(2,0); });
  assert.equal(await page.evaluate(() => (window as any).__HELMET_BOT__.helmet.some((mesh: any)=>mesh.isEnabled())), false);
  await page.evaluate(() => (window as any).__HELMET_BOT__.dispose());
  assert.deepEqual(errors, []); await page.close();
});
