import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import { chromium } from 'playwright-core';
import type { Browser } from 'playwright-core';
let server: ViteDevServer, browser: Browser, url: string;
before(async () => {
  server = await createServer({ cacheDir: mkdtempSync(join(tmpdir(),'lastlight-coverage-')), logLevel:'error', server:{host:'127.0.0.1',port:0} });
  await server.listen(); url = `http://127.0.0.1:${(server.httpServer!.address() as any).port}`;
  browser = await chromium.launch({executablePath:process.env.BROWSER_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  mkdirSync('output/playwright',{recursive:true});
});
after(async()=>{await browser?.close();await server?.close();});

test('all coverage models load; weapon baking preserves cached geometry; alpha sprites render', async () => {
  const page = await browser.newPage({viewport:{width:1440,height:900}}), errors: string[] = [];
  page.on('pageerror',e=>errors.push(e.message));
  let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/assets/coverage/crossbow.glb', async route => { await pending; await route.continue(); });
  await page.goto(url+'/tests/fixtures/coverage-gallery.html', {waitUntil:'commit'});
  await page.waitForFunction(()=>!!(window as any).__COVERAGE_GALLERY__,undefined,{timeout:60000});
  assert.equal(await page.evaluate(()=>{ const g=(window as any).__COVERAGE_GALLERY__;g.actor=g.makeSoldier();g.actor.setWeapon('xbow');return !!g.actor.current.root.metadata.coverageAsset; }),false);
  release();
  const loaded = await page.evaluate(async()=> {
    const g=(window as any).__COVERAGE_GALLERY__;await g.loading;
    return g.keys.filter((key: string)=>g.scene.meshes.some((m: any)=>m.metadata?.template&&m.metadata.coverageAsset===key));
  });
  assert.equal(loaded.length,49);
  assert.equal(await page.evaluate(()=>{const g=(window as any).__COVERAGE_GALLERY__;g.actor.setWeapon('xbow');const key=g.actor.current.root.metadata.coverageAsset;g.actor.dispose();return key;}),'crossbow');
  await page.waitForTimeout(600); await page.screenshot({path:'output/playwright/coverage-special.png'});
  const geometry = await page.evaluate(()=>{
    const g=(window as any).__COVERAGE_GALLERY__;
    const before=g.scene.meshes.find((m:any)=>m.metadata?.template&&m.metadata.coverageAsset==='crossbow').getVerticesData('position').slice();
    g.weapons(['xbow','m79','panzer']);
    const after=g.scene.meshes.find((m:any)=>m.metadata?.template&&m.metadata.coverageAsset==='crossbow').getVerticesData('position');
    return {same:before.every((v:number,i:number)=>v===after[i]),models:g.scene.transformNodes.filter((r:any)=>r.metadata?.coverageAsset).map((r:any)=>r.metadata.coverageAsset)};
  });
  assert.equal(geometry.same,true); assert.deepEqual(geometry.models.sort(),['crossbow','grenadeLauncher','rocketLauncher'].sort());
  await page.waitForTimeout(600); await page.screenshot({path:'output/playwright/coverage-weapons.png'});
  const alpha = await page.evaluate(async()=>{
    return Promise.all(['smoke','flame','flash','fire','puff'].map(async key=>{
      const image=new Image(); image.src='/assets/coverage/'+key+'.png'; await image.decode();
      const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
      const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);return ctx.getImageData(0,0,1,1).data[3];
    }));
  });
  assert.ok(alpha.every(value=>value<5), 'particle corners must be transparent');
  await page.evaluate(()=>(window as any).__COVERAGE_GALLERY__.effects());
  await page.waitForFunction(()=>(window as any).__COVERAGE_GALLERY__.scene.meshes.filter((m:any)=>m.metadata?.coverageVfx).every((m:any)=>m.material.diffuseTexture.isReady()));
  await page.waitForTimeout(400); await page.screenshot({path:'output/playwright/coverage-vfx.png'});
  assert.deepEqual(errors,[]);await page.close();
});

test('range integrates nine vehicle models and three wheel kits; download failures keep all twelve playable',async()=>{
  for(const missing of [false,true]){
    const page=await browser.newPage({viewport:{width:1280,height:720}}),errors:string[]=[];
    page.on('pageerror',e=>errors.push(e.message));
    if(missing)await page.route('**/assets/coverage/*.glb',r=>r.fulfill({status:404,body:''}));
    await page.goto(url);await page.waitForFunction(()=>!!(window as any).__LASTLIGHT__,undefined,{timeout:60000});
    await page.evaluate(async()=>{const m=await import('../../src/coverage-assets.ts');await m.prepareCoverageAssets((window as any).__LASTLIGHT__.scene);});
    await page.click('#map-choice button[data-value="range"]');await page.click('#start-button');
    await page.waitForFunction(()=>(window as any).__LASTLIGHT__.simulation.state.phase==='playing');await page.waitForTimeout(700);
    const vehicles=await page.evaluate(()=>{const {simulation,scene}=(window as any).__LASTLIGHT__;return simulation.state.vehicles.map((v:any)=>{
      const root=scene.getTransformNodeByName('car-'+v.id),parts=root.getChildMeshes();
      return {kind:v.kind,imported:parts.some((m:any)=>m.metadata?.coverageAsset),vertices:parts.reduce((n:number,m:any)=>n+m.getTotalVertices(),0)};
    });});
    assert.equal(vehicles.length,12);assert.ok(vehicles.every((v:any)=>v.vertices>0));
    assert.equal(vehicles.filter((v:any)=>v.imported).length,missing?0:12);
    assert.deepEqual(errors,[]);await page.close();
  }
});

test('island streams kit buildings near player and retains textured sky',async()=>{
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.waitForFunction(()=>!!(window as any).__LASTLIGHT__,undefined,{timeout:60000});
  await page.evaluate(async()=>{const m=await import('../../src/coverage-assets.ts');await m.prepareCoverageAssets((window as any).__LASTLIGHT__.scene);});
  await page.click('#start-button');await page.waitForFunction(()=>(window as any).__LASTLIGHT__.simulation.state.phase==='playing');
  await page.evaluate(()=>{const {simulation:s}=(window as any).__LASTLIGHT__;const wall=s.world.obstacles.find((o:any)=>o.kind==='wall'&&!o.id.includes('bunker'));s.player.air=undefined;s.player.position={x:wall.x+8,y:s.heightAt(wall.x+8,wall.z),z:wall.z};});
  await page.waitForFunction(()=>(window as any).__LASTLIGHT__.scene.meshes.some((m:any)=>m.metadata?.coverageEnvironment&&m.isEnabled()),undefined,{timeout:30000});
  const info=await page.evaluate(()=>{const scene=(window as any).__LASTLIGHT__.scene;return {chunks:scene.meshes.filter((m:any)=>m.metadata?.coverageEnvironment&&m.isEnabled()).length,textures:scene.textures.some((t:any)=>t.url?.endsWith('sky-day.png')&&t.isReady())};});
  assert.ok(info.chunks>0);assert.equal(info.textures,true);
  await page.evaluate(()=>{ const g=(window as any).__LASTLIGHT__,wall=g.simulation.world.obstacles.find((o:any)=>o.kind==='wall'&&!o.id.includes('bunker')),camera=g.scene.activeCamera;
    g.engine.stopRenderLoop();camera.position.set(wall.x+20,(wall.base??0)+14,wall.z-20);camera.setTarget(camera.position.constructor.FromArray([wall.x,(wall.base??0)+2,wall.z]));g.scene.render();
  });
  await page.waitForTimeout(1000);await page.evaluate(()=>(window as any).__LASTLIGHT__.scene.render());
  await page.screenshot({path:'output/playwright/coverage-island.png'});assert.deepEqual(errors,[]);await page.close();
});
