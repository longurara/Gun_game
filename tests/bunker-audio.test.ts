import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameAudio } from '../src/audio.ts';

/** Just enough of Web Audio to see what gets made and what is wired to what. */
class Node {
  outs: Node[] = [];
  kind: string;
  constructor(kind: string, public ctx: Fake) { this.kind = kind; ctx.nodes.push(this); }
  connect(to: Node): Node { this.outs.push(to); return to; }
  disconnect(): void { this.outs = []; }
  start(): void { /* nothing */ }
  stop(): void { /* nothing */ }
  onended: (() => void) | null = null;
  gain = { value: 1, setValueAtTime() { /* nothing */ }, exponentialRampToValueAtTime() { /* nothing */ }, cancelScheduledValues() { /* nothing */ }, setTargetAtTime: (v: number) => { this.gain.value = v; } };
  frequency = { value: 0, setValueAtTime() { /* nothing */ }, exponentialRampToValueAtTime() { /* nothing */ } };
  pan = { value: 0 };
  Q = { value: 0 };
  threshold = { value: 0 }; knee = { value: 0 }; ratio = { value: 0 }; attack = { value: 0 }; release = { value: 0 };
  type = ''; buffer: unknown = null;
}
class Fake {
  nodes: Node[] = [];
  currentTime = 0; sampleRate = 8000; state = 'running'; destination = new Node('destination', this);
  made(kind: string): Node[] { return this.nodes.filter(n => n.kind === kind); }
  createGain() { return new Node('gain', this); }
  createOscillator() { return new Node('osc', this); }
  createBufferSource() { return new Node('noise', this); }
  createBiquadFilter() { return new Node('filter', this); }
  createDynamicsCompressor() { return new Node('compressor', this); }
  createConvolver() { return new Node('convolver', this); }
  createStereoPanner() { return new Node('panner', this); }
  createBuffer(channels: number, length: number) { return { getChannelData: () => new Float32Array(length), channels }; }
  async resume() { /* running */ }
  async close() { /* closed */ }
}

async function audioWith(): Promise<{ audio: GameAudio; ctx: Fake }> {
  const ctx = new Fake();
  (globalThis as unknown as { window: unknown }).window = { AudioContext: function () { return ctx; } };
  const audio = new GameAudio();
  await audio.unlock();
  return { audio, ctx };
}
const at = (x: number, y: number, z: number) => ({ x, y, z });

test('taking the stairs makes a hatch-and-footsteps sound: your own at full volume, a bot\'s only when it is close', async () => {
  const { audio, ctx } = await audioWith();
  audio.localId = 'me';
  audio.handle({ type: 'portal', actorId: 'me', down: true, from: at(0, 0, 0), to: at(0, -42, 0) }, at(0, -42, 0));
  const own = ctx.made('osc').length + ctx.made('noise').length;
  assert.ok(own >= 8, `${own} sound sources for your own descent`);
  const before = ctx.nodes.length;
  audio.handle({ type: 'portal', actorId: 'bot-1', down: true, from: at(500, 0, 0), to: at(500, -42, 0) }, at(0, 0, 0));
  assert.equal(ctx.nodes.length, before, 'a bot half a kilometre away is silent');
  audio.handle({ type: 'portal', actorId: 'bot-1', down: false, from: at(10, -42, 0), to: at(14, 0, 0) }, at(0, -42, 0));
  assert.ok(ctx.nodes.length > before, 'a bot using the stairs nearby is heard');
  audio.dispose();
});

test('in a bunker every sound also goes through the echo, and the place hums and drips; outside it does not', async () => {
  const { audio, ctx } = await audioWith();
  const convolver = ctx.made('convolver')[0];
  assert.ok(convolver, 'the echo exists');
  const feedsEcho = (n: Node) => n.outs.some(o => o.outs.includes(convolver));
  audio.footstep(false);
  assert.ok(!ctx.nodes.some(feedsEcho), 'nothing is echoed in the open');
  audio.cave(true);
  const humming = ctx.made('osc').length;
  assert.ok(humming >= 2, 'the hum starts');
  ctx.currentTime = 1;
  audio.footstep(true);
  assert.ok(ctx.nodes.some(feedsEcho), 'a footstep in the bunker is echoed');
  audio.cave(false);
  const echoed = ctx.nodes.filter(feedsEcho).length;
  ctx.currentTime = 2;
  audio.footstep(true);
  assert.equal(ctx.nodes.filter(feedsEcho).length, echoed, 'back outside, new sounds are dry again');
  audio.dispose();
});
