import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { GameAudio } from '../src/audio.ts';
import { gunSoundFor } from '../src/gun-sounds.ts';
import type { GunSoundBank } from '../src/gun-sounds.ts';
import { WEAPONS } from '../src/game/weapons.ts';
import type { WeaponType } from '../src/types.ts';

class AudioNodeStub {
  outs: AudioNodeStub[] = [];
  buffer: { url?: string } | null = null;
  onended: (() => void) | null = null;
  started = false; stopped = false; type = '';
  gain = this.param(); frequency = this.param(); playbackRate = this.param(); pan = this.param(); Q = this.param();
  threshold = this.param(); knee = this.param(); ratio = this.param(); attack = this.param(); release = this.param();
  constructor(public kind: string, public ctx: AudioContextStub) { ctx.nodes.push(this); }
  private param() { return { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime(v: number) { this.value = v; } }; }
  connect(node: AudioNodeStub) { this.outs.push(node); return node; }
  disconnect() { this.outs = []; }
  start() { this.started = true; }
  stop() { this.stopped = true; this.onended?.(); }
}
class AudioContextStub {
  nodes: AudioNodeStub[] = []; state = 'running'; sampleRate = 8000; currentTime = 0; decodes = 0;
  destination = new AudioNodeStub('destination', this);
  createGain() { return new AudioNodeStub('gain', this); }
  createBufferSource() { return new AudioNodeStub('source', this); }
  createOscillator() { return new AudioNodeStub('osc', this); }
  createBiquadFilter() { return new AudioNodeStub('filter', this); }
  createDynamicsCompressor() { return new AudioNodeStub('compressor', this); }
  createConvolver() { return new AudioNodeStub('convolver', this); }
  createStereoPanner() { return new AudioNodeStub('panner', this); }
  createBuffer(_channels: number, length: number) { return { getChannelData: () => new Float32Array(length) }; }
  async decodeAudioData(raw: ArrayBuffer) { this.decodes++; return { url: new TextDecoder().decode(raw) }; }
  async resume() { this.state = 'running'; }
  async close() { this.state = 'closed'; }
  samples() { return this.nodes.filter(n => n.kind === 'source' && n.buffer?.url); }
}
const bank: GunSoundBank = Object.fromEntries(['pistol', 'rifle556', 'rifle762', 'dmr', 'sniper', 'shotgun', 'lmg', 'suppressed'].map(key => [key, `/${key}.ogg`]));
async function setup(t: TestContext, fetcher?: typeof fetch, foley: Record<string, string> = {}) {
  const context = new AudioContextStub();
  const oldWindow = (globalThis as any).window, oldFetch = globalThis.fetch;
  (globalThis as any).window = { AudioContext: function () { return context; } };
  const requests: string[] = [];
  globalThis.fetch = fetcher ?? (async url => { requests.push(String(url)); return new Response(String(url)); }) as typeof fetch;
  const audio = new GameAudio(bank, foley); audio.localId = 'me';
  t.after(() => { audio.dispose(); (globalThis as any).window = oldWindow; globalThis.fetch = oldFetch; });
  return { audio, context, requests };
}
const origin = { x: 0, y: 0, z: 0 };
function shot(audio: GameAudio, weapon: WeaponType = 'rifle', from = origin, actorId = 'me', silenced = false) {
  audio.handle({ type: 'shot', weapon, from, to: { x: 0, y: 2, z: 20 }, actorId, silenced }, origin);
}

test('gun samples load only after unlock, and concurrent/repeated preloads fetch and decode once', async t => {
  const { audio, context, requests } = await setup(t);
  await audio.prepareGunSounds(); assert.equal(requests.length, 0);
  await audio.unlock();
  await Promise.all([audio.prepareGunSounds(), audio.prepareGunSounds()]);
  await audio.prepareGunSounds();
  assert.equal(requests.length, 8); assert.equal(context.decodes, 8);
  assert.equal(context.samples().length, 0, 'loading never plays a shot');
});

test('every eligible weapon gets one family sample; special weapons retain synthesis and snipers retain bolt sounds', async t => {
  const { audio, context } = await setup(t);
  await audio.unlock(); await audio.prepareGunSounds();
  for (const weapon of Object.keys(WEAPONS) as WeaponType[]) {
    const before = context.samples().length;
    shot(audio, weapon);
    const voice = gunSoundFor(weapon, WEAPONS[weapon].loudness < WEAPONS[WEAPONS[weapon].voice].loudness * .7);
    assert.equal(context.samples().length - before, voice ? 1 : 0, weapon);
    if (voice) assert.equal(context.samples().at(-1)!.buffer!.url, bank[voice.key], weapon);
  }
  const oscillators = context.nodes.filter(n => n.kind === 'osc').length;
  shot(audio, 'sniper');
  assert.equal(context.nodes.filter(n => n.kind === 'osc').length - oscillators, 2, 'bolt action remains audible');
  const rifle762 = Object.keys(WEAPONS).find(id => WEAPONS[id as WeaponType].kind === 'ar' && WEAPONS[id as WeaponType].ammoType === '762') as WeaponType;
  assert.equal(gunSoundFor(rifle762, false)!.key, 'rifle762');
});

test('recorded gunfire obeys distance cutoff, stereo direction, bunker echo, suppressor and mute', async t => {
  const { audio, context } = await setup(t);
  await audio.unlock(); await audio.prepareGunSounds();
  shot(audio);
  const own = context.samples().at(-1)!;
  const ownLevel = own.outs[0].outs[0].gain.value;
  assert.equal(own.outs[0].frequency.value, 4500);
  shot(audio, 'rifle', { x: 22, y: 0, z: 0 }, 'bot');
  const distant = context.samples().at(-1)!;
  const level = distant.outs[0].outs[0];
  assert.equal(level.gain.value, ownLevel / 2);
  assert.equal(level.outs[0].kind, 'panner'); assert.equal(level.outs[0].pan.value, 1);
  assert.ok(distant.outs[0].frequency.value < own.outs[0].frequency.value);
  audio.cave(true); shot(audio, 'rifle', { x: -6, y: 0, z: 0 }, 'bot');
  const panner = context.samples().at(-1)!.outs[0].outs[0].outs[0];
  assert.equal(panner.pan.value, -1);
  assert.ok(panner.outs.some(n => n.outs.some(output => output.kind === 'convolver')));
  shot(audio, 'rifle', origin, 'me', true);
  const silenced = context.samples().at(-1)!;
  assert.equal(silenced.buffer!.url, bank.suppressed);
  assert.ok(silenced.outs[0].frequency.value <= 1800);
  assert.ok(silenced.outs[0].outs[0].gain.value < ownLevel);
  const before = context.samples().length;
  shot(audio, 'rifle', { x: 171, y: 0, z: 0 }, 'bot');
  audio.setVolume(0); shot(audio);
  assert.equal(context.samples().length, before);
  audio.setVolume(.65); audio.cave(false); shot(audio);
  assert.equal(context.samples().length, before + 1);
});

test('rapid fire bounds active voices and ended/paused nodes disconnect', async t => {
  const { audio, context } = await setup(t);
  await audio.unlock(); await audio.prepareGunSounds();
  for (let i = 0; i < 180; i++) shot(audio, 'smg');
  const samples = context.samples();
  assert.equal(samples.filter(n => !n.stopped).length, 96);
  assert.equal(samples[0].outs.length, 0);
  const last = samples.at(-1)!;
  const filter = last.outs[0], level = filter.outs[0];
  last.onended?.(); assert.equal(last.outs.length, 0); assert.equal(filter.outs.length, 0); assert.equal(level.outs.length, 0);
  audio.pause();
  assert.ok(samples.every(n => n.stopped || n === last));
});

test('pending, missing and undecodable samples fall back immediately with no late replay', async t => {
  let resolve!: (response: Response) => void;
  const pending = new Promise<Response>(done => { resolve = done; });
  const { audio, context } = await setup(t, (async url => String(url).includes('rifle556') ? pending : new Response('', { status: 404 })) as typeof fetch);
  await audio.unlock(); const loading = audio.prepareGunSounds();
  shot(audio); assert.equal(context.samples().length, 0);
  const sources = context.nodes.filter(n => n.kind === 'source').length;
  assert.ok(sources > 0, 'procedural fire starts while sample loads');
  resolve(new Response('/rifle556.ogg')); await loading;
  assert.equal(context.nodes.filter(n => n.kind === 'source').length, sources, 'no replay after loading');
  shot(audio); assert.equal(context.samples().length, 1);
  shot(audio, 'pistol'); assert.equal(context.samples().length, 1, '404 uses synthesis');
});

test('decode failures remain playable and disposing during a decode cannot populate or play the closed context', async t => {
  const { audio, context } = await setup(t);
  await audio.unlock();
  let resolve!: (buffer: { url: string }) => void;
  context.decodeAudioData = async raw => {
    if (new TextDecoder().decode(raw) !== bank.rifle556) throw new Error('invalid codec');
    return new Promise(done => { resolve = done; });
  };
  const loading = audio.prepareGunSounds();
  // Let fetch + arrayBuffer reach the decoder.
  while (!resolve) await new Promise(done => setImmediate(done));
  shot(audio, 'pistol'); assert.equal(context.samples().length, 0);
  assert.ok(context.nodes.some(n => n.kind === 'osc'));
  audio.dispose(); resolve({ url: bank.rifle556! }); await loading;
  const count = context.nodes.length; shot(audio); await audio.prepareGunSounds();
  assert.equal(context.nodes.length, count); assert.equal(context.state, 'closed');
});

test('installed sound files match provenance hashes and remain small one-shots', () => {
  const directory = new URL('../src/assets/audio/guns/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8'));
  assert.equal(manifest.length, 8);
  let bytes = 0;
  for (const entry of manifest) {
    const data = readFileSync(new URL(entry.file, directory)); bytes += data.length;
    assert.equal(data.subarray(0, 4).toString(), 'OggS');
    assert.equal(createHash('sha256').update(data).digest('hex'), entry.sha256);
    assert.equal(data.length, entry.bytes);
    assert.ok(entry.seconds > .1 && entry.seconds <= 1.3);
  }
  assert.ok(bytes < 90000);
  const lmg = manifest.find((entry: any) => entry.file === 'lmg.ogg');
  assert.equal(lmg.author, 'KuraiWolf'); assert.equal(lmg.license, 'CC BY 4.0');
});

const foley = Object.fromEntries(['engine', 'hum', 'wind', 'drip', 'breath', 'step-grass', 'step-metal', 'step-concrete', 'reload', 'reload-pistol', 'reload-shotgun', 'heal'].map(key => [key, `/${key}.ogg`]));
test('foley samples share unlock/cache, follow surface and reload family, and obey mute', async t => {
  const {audio, context, requests} = await setup(t, undefined, foley);
  await audio.prepareGunSounds(); assert.equal(requests.length, 0);
  await audio.unlock(); await Promise.all([audio.prepareGunSounds(), audio.prepareGunSounds()]);
  assert.equal(requests.length, 8 + Object.keys(foley).length);
  audio.footSurface = 'grass'; audio.footstep(false); assert.equal(context.samples().at(-1)!.buffer!.url, '/step-grass.ogg');
  context.currentTime = 1; audio.footSurface = 'metal'; audio.footstep(false); assert.equal(context.samples().at(-1)!.buffer!.url, '/step-metal.ogg');
  audio.reload('pistol'); assert.equal(context.samples().at(-1)!.buffer!.url, '/reload-pistol.ogg');
  context.currentTime = 2; audio.reload('shotgun'); assert.equal(context.samples().at(-1)!.buffer!.url, '/reload-shotgun.ogg');
  context.currentTime = 3; audio.reload('rifle'); assert.equal(context.samples().at(-1)!.buffer!.url, '/reload.ogg');
  const count = context.samples().length; audio.setVolume(0); context.currentTime = 5;
  audio.footstep(true); audio.reload('rifle'); audio.heal(); audio.engine(20, 1);
  assert.equal(context.samples().length, count);
});
test('engine has one loop, changes pitch without stacking and stops on exit/pause/dispose', async t => {
  const {audio, context} = await setup(t, undefined, foley);
  await audio.unlock(); await audio.prepareGunSounds();
  audio.engine(0, 0); const car = context.samples().at(-1)!; const idle = car.playbackRate.value;
  for(let i=0;i<100;i++) audio.engine(25, 1);
  assert.equal(context.samples().length, 1); assert.ok(car.playbackRate.value > idle);
  audio.engine(8, .2, true); assert.equal(car.stopped, true); const plane = context.samples().at(-1)!;
  assert.equal(plane.buffer!.url, '/hum.ogg'); audio.stopEngine(); assert.equal(plane.stopped, true); assert.equal(plane.outs.length, 0);
  audio.engine(10, .5); audio.pause(); assert.ok(context.samples().every(n=>n.stopped));
  audio.engine(10, .5); const resumed = context.samples().at(-1)!; audio.dispose(); assert.equal(resumed.stopped, true);
});
test('failed foley downloads retain immediate playable footsteps and engines without delayed replay', async t => {
  const {audio, context} = await setup(t, (async()=>new Response('',{status:404})) as typeof fetch, foley);
  await audio.unlock(); await audio.prepareGunSounds(); audio.footstep(false); audio.engine(12, 1);
  assert.equal(context.samples().length, 0); assert.ok(context.nodes.some(n=>n.kind==='osc'&&n.started));
});
