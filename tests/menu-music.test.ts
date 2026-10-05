import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOOP_STEPS, midiToHz, stepEvents } from '../src/menu-music.ts';

const loopEvents = (loop: number) => Array.from({ length: LOOP_STEPS }, (_, i) => stepEvents(loop * LOOP_STEPS + i));

test('the menu theme is a four-bar loop that repeats exactly', () => {
  assert.deepEqual(loopEvents(0).map(e => e.filter(x => x.voice === 'pad' || x.voice === 'bass' && x.steps === 8)), loopEvents(2).map(e => e.filter(x => x.voice === 'pad' || x.voice === 'bass' && x.steps === 8)));
  assert.deepEqual(loopEvents(1), loopEvents(3));
});

test('the song builds: the first pass has no drums or lead, the second has a beat, the third has the lead', () => {
  const voices = (loop: number) => new Set(loopEvents(loop).flat().map(e => e.voice));
  assert.ok(!voices(0).has('kick') && !voices(0).has('lead'));
  assert.ok(voices(1).has('kick') && voices(1).has('snare') && voices(1).has('hat') && voices(1).has('lead'));
  assert.ok(voices(2).has('kick') && !voices(2).has('lead'));
});

test('every note is a sensible pitch, length and loudness, and the bass follows the chords Am F C G', () => {
  for (let step = 0; step < LOOP_STEPS * 4; step++) {
    for (const event of stepEvents(step)) {
      assert.ok(event.steps >= 1 && event.gain > 0 && event.gain < 1);
      if (['pad', 'bass', 'arp', 'lead'].includes(event.voice)) assert.ok(midiToHz(event.midi) > 40 && midiToHz(event.midi) < 2000, `${event.voice} ${event.midi}`);
    }
  }
  const bassRoots = [0, 16, 32, 48].map(step => stepEvents(step).find(e => e.voice === 'bass')!.midi % 12);
  assert.deepEqual(bassRoots, [9, 5, 0, 7]); // A, F, C, G
});
