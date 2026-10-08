import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

test('range batches pickup models and restores full detail for selecting and collecting a distant gun', { timeout: 120000 }, async () => {
  const server = await createServer({ envFile: false, cacheDir: mkdtempSync(join(tmpdir(), 'range-loot-')), logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  const browser = await chromium.launch({ executablePath: ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*.supabase.co/**', route => route.abort());
    await page.addInitScript(() => localStorage.setItem('lastlight.settings.v1', JSON.stringify({ map: 'range', botCount: 0, quality: 'low' })));
    await page.goto(`http://127.0.0.1:${(server.httpServer!.address() as any).port}`, { waitUntil: 'commit' });
    await page.waitForFunction(() => !!(window as any).__LASTLIGHT__, undefined, { timeout: 60000 });
    await page.click('#map-choice button[data-value="range"]'); await page.click('#bot-choice button[data-value="0"]'); await page.click('#start-button');
    await page.waitForFunction(() => (window as any).__LASTLIGHT__.simulation.state.phase === 'playing', undefined, { timeout: 60000 });
    await page.evaluate(() => {
      const g = (window as any).__LASTLIGHT__;
      g.simulation.botsFrozen = true; g.simulation.player.position = { x: 0, y: 0, z: -155 }; g.setCamera(Math.PI, -.32);
    });
    await page.waitForTimeout(5000);
    const initial = await page.evaluate(() => {
      const g = (window as any).__LASTLIGHT__;
      const pickups = g.scene.meshes.filter((m: any) => m.sourceMesh && m.name.startsWith('loot-'));
      const distant = pickups.filter((m: any) => m.sourceMesh.name.startsWith('loot-template-distant:'));
      const gun = g.simulation.state.loot.find((l: any) => l.kind === 'heavySniper');
      const source = g.scene.meshes.find((m: any) => m.name.startsWith('free-gun-18-') && m.getTotalVertices() > 0);
      return { pickups: pickups.length, active: g.simulation.state.loot.filter((l: any) => l.active).length,
        sources: new Set(pickups.map((m: any) => m.sourceMesh.uniqueId)).size, distant: distant.length,
        cheap: distant.every((m: any) => m.getTotalVertices() <= 300 && m.subMeshes.length === 1 && !m.material.diffuseTexture && m.isWorldMatrixFrozen),
        gun: { id: gun.id, kind: gun.kind, position: gun.position },
        source: { name: source.name, positions: Array.from(source.getVerticesData('position')), indices: Array.from(source.getIndices()) } };
    });
    assert.equal(initial.pickups, initial.active, 'all range pickups remain available');
    assert.ok(initial.pickups > 200);
    assert.ok(initial.sources < initial.pickups / 2, 'different weapon names share actual model batches');
    assert.ok(initial.distant > 50); assert.equal(initial.cheap, true);
    await page.evaluate(gun => {
      const s = (window as any).__LASTLIGHT__.simulation;
      s.player.position = { ...gun.position, z: gun.position.z + .6 }; s.player.vy = 0; s.player.speed = 0;
    }, initial.gun);
    await page.waitForFunction(id => {
      const g = (window as any).__LASTLIGHT__, node = g.scene.getMeshByName(`loot-${id}`);
      return node?.sourceMesh?.name.startsWith('loot-template-gun:') && node.scaling.x === 1.3 && !node.isWorldMatrixFrozen;
    }, initial.gun.id);
    await page.evaluate(() => { (window as any).__LASTLIGHT__.simulation.player.position = { x: 0, y: 0, z: -155 }; });
    await page.waitForFunction(id => {
      const node = (window as any).__LASTLIGHT__.scene.getMeshByName(`loot-${id}`);
      return node?.sourceMesh?.name.startsWith('loot-template-distant:') && node.isWorldMatrixFrozen;
    }, initial.gun.id);
    await page.evaluate(gun => {
      const s = (window as any).__LASTLIGHT__.simulation;
      s.player.position = { ...gun.position, z: gun.position.z + .6 }; s.player.vy = 0; s.player.speed = 0;
    }, initial.gun);
    await page.waitForFunction(id => {
      const node = (window as any).__LASTLIGHT__.scene.getMeshByName(`loot-${id}`);
      return node?.sourceMesh?.name.startsWith('loot-template-gun:') && node.scaling.x === 1.3;
    }, initial.gun.id);
    await page.keyboard.press('e');
    await page.waitForFunction(kind => (window as any).__LASTLIGHT__.simulation.player.ownedWeapons.includes(kind), initial.gun.kind);
    const after = await page.evaluate(name => {
      const source = (window as any).__LASTLIGHT__.scene.getMeshByName(name);
      return { positions: Array.from(source.getVerticesData('position')), indices: Array.from(source.getIndices()) };
    }, initial.source.name);
    assert.deepEqual(after, { positions: initial.source.positions, indices: initial.source.indices }, 'LOD transitions leave the shared gun geometry intact');
    await page.waitForFunction(id => !(window as any).__LASTLIGHT__.scene.getMeshByName(`loot-${id}`), initial.gun.id);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.close(); }
});
