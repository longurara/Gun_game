import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameSimulation } from '../src/game/simulation.ts';
import { SnapshotBuilder } from '../src/net/protocol.ts';
import { fragment, MAX_WIRE_BYTES, MissingBaseline, WireAssembly, WireDecoder, WireEncoder, WIRE_VERSION } from '../src/net/wire.ts';
import type { NetMessage } from '../src/net/transport.ts';

test('binary frames preserve UTF-8, decimal rounding, large numbers and command arrays exactly', () => {
  const message = { k: 'in', seq: 123, name: 'đồng bộ 🪂', values: [null, true, false, -0, -1, 2147483647, -2147483647, 2 ** 40, .01, -.001, 1234.567, Math.PI, 1e-12],
    cmds: [['switch', 'ak'], ['inventory-drop', { kind: 'ammo:rifle', amount: 21 }]], empty: {} };
  assert.deepEqual(new WireDecoder().decode(new WireEncoder().encode(message)), message);
  const input = { k: 'in', seq: 99999, ct: 1234567, mx: 1, mz: 1, sp: 1, ju: 0, th: 0, st: 0, yaw: 3.141, edge: 0, jumpId: 3 };
  assert.ok(new WireEncoder().encode(input).length < Buffer.byteLength(JSON.stringify(input)) * .6);
});

test('delta snapshots restore changed fields, removed sections, row reordering, one-shot events and keyframes', () => {
  const encoder = new WireEncoder(), decoder = new WireDecoder();
  let deltas = 0, full = 0;
  for (let seq = 1; seq <= 120; seq++) {
    const message = { k: 'snap', echo: { guest: seq * 50 }, s: { seq, t: seq * .05, a: Array.from({ length: seq === 60 ? 3 : 4 }, (_, i) => [seq === 61 ? 3 - i : i, 100 + seq, 0, 30, .11, 100, 1, 5, 0, 0]),
      priv: [{ id: 'p0', owned: [0, 1], ammo: [[0, 30]], reserve: [[0, 100]], unchanged: 'x'.repeat(300) }], loot: { add: seq === 25 ? [[100, 'new-loot', 'medkit', 1, 2, 3]] : [], off: seq === 26 ? [100] : [] },
      ev: seq === 20 ? [{ type: 'shot', actorId: 'p0' }] : [], ...(seq === 20 ? { sm: [[1, 2, 3]] } : {}), ...(seq >= 119 ? { over: 'p0' } : {}) } };
    const bytes = encoder.encode(message);
    bytes[3] === 2 ? deltas++ : full++;
    assert.deepEqual(decoder.decode(bytes), message);
  }
  assert.ok(deltas > 100); assert.ok(full >= 3, 'full frames bound the delta chain');
});

test('a missing delta baseline never reaches the simulation and recovers with a forced full frame', () => {
  const encoder = new WireEncoder(), decoder = new WireDecoder();
  const make = (seq: number) => ({ k: 'snap', s: { seq, t: seq / 20, inventory: Array(100).fill('same') } });
  decoder.decode(encoder.encode(make(1)));
  encoder.encode(make(2)); // Simulate a lost/corrupt frame (the real channel is ordered and reliable).
  const third = encoder.encode(make(3)); assert.equal(third[3], 2);
  assert.throws(() => decoder.decode(third), MissingBaseline);
  encoder.reset(); assert.deepEqual(decoder.decode(encoder.encode(make(4))), make(4));
});

test('baseline ownership survives callers mutating outgoing or received objects', () => {
  const encoder = new WireEncoder(), decoder = new WireDecoder();
  const message = { k: 'snap', s: { seq: 1, a: [[1, 2, 3]], text: 'same'.repeat(100) } };
  const result = decoder.decode(encoder.encode(message));
  message.s.a[0][1] = 9; message.s.seq = 2;
  (result.s as any).a[0][2] = 100;
  assert.deepEqual(decoder.decode(encoder.encode(message)), message);
});

test('optional undefined fields stay absent through deltas and negative zero remains exact', () => {
  const encoder = new WireEncoder(), decoder = new WireDecoder();
  for (let seq = 1; seq <= 4; seq++) {
    const message = { k: 'snap', s: { seq, optional: undefined, a: [[1, -0, seq]], unchanged: 'same'.repeat(100) } };
    const decoded = decoder.decode(encoder.encode(message));
    assert.deepEqual(decoded, { k: 'snap', s: { seq, a: [[1, -0, seq]], unchanged: 'same'.repeat(100) } });
  }
});

test('fragment assembly is bounded, ignores missing/out-of-order pieces and has no Unicode expansion', () => {
  const message = { k: 'large-test', text: 'đồng bộ 🪂'.repeat(8000) }, bytes = new WireEncoder().encode(message);
  const chunks = fragment(bytes, 7, 4096), assembly = new WireAssembly();
  assert.ok(chunks.every(chunk => chunk.length <= 4096));
  assert.equal(chunks.reduce((sum, chunk) => sum + chunk.length, 0), bytes.length + chunks.length * 16);
  assert.equal(assembly.receive(chunks[1]), null);
  let reconstructed: Uint8Array | null = null;
  for (const chunk of chunks) reconstructed = assembly.receive(chunk);
  assert.deepEqual(new WireDecoder().decode(reconstructed!), message);
  const bad = chunks[0].slice(); new DataView(bad.buffer).setUint32(12, MAX_WIRE_BYTES + 1, true);
  assert.throws(() => assembly.receive(bad));
});

test('malformed frames, unbounded lengths, unsafe keys and unsupported versions are rejected', () => {
  const decoder = new WireDecoder(), valid = new WireEncoder().encode({ k: 'in', seq: 1 });
  for (let length = 0; length < valid.length; length++) assert.throws(() => decoder.decode(valid.subarray(0, length)));
  const version = valid.slice(); version[2] = 99; assert.throws(() => decoder.decode(version));
  assert.throws(() => decoder.decode(new Uint8Array([...valid, 0])));
  assert.throws(() => decoder.decode(new Uint8Array([0x4c, 0x4c, WIRE_VERSION, 0, 7, 255, 255, 255, 255, 15])));
  assert.throws(() => new WireEncoder().encode(JSON.parse('{"k":"in","__proto__":{}}')));
  assert.throws(() => new WireEncoder().encode({ k: 'in', invalid: Infinity }));
});

test('invalid delta patches cannot create sparse arrays or exceed reconstructed state limits', () => {
  const decoder = new WireDecoder();
  decoder.decode(new WireEncoder().encode({ k: 'snap', s: { seq: 1, a: [1, 2], text: '' } }));
  const malicious = (patch: unknown) => { const bytes = new WireEncoder().encode({ k: 'snap', base: 1, s: patch }); bytes[3] = 2; return bytes; };
  assert.throws(() => decoder.decode(malicious([1, [['a', [2, 100, []]]], []])));
  assert.throws(() => decoder.decode(malicious([1, [['a', [3, 8, [3]]]], []])));
  assert.throws(() => decoder.decode(malicious([1, [['a', [2, 2, [[-1, [0, 1]]]]]], []])));
  const seed = { k: 'snap', s: { seq: 1, a: [], text: 'a'.repeat(160_000) } };
  decoder.decode(new WireEncoder().encode(seed));
  assert.throws(() => decoder.decode(malicious([1, [['other', [0, 'b'.repeat(160_000)]]], []])));
});

test('real moving, fighting and parachuting snapshots round-trip losslessly and reduce bytes', () => {
  for (const map of ['arena', 'island'] as const) {
    const sim = new GameSimulation({ map, seed: 9123, botCount: 20, humans: 3, difficulty: 'normal', drop: map === 'island' }); sim.start();
    const builder = new SnapshotBuilder(sim), encoder = new WireEncoder(), decoder = new WireDecoder();
    let json = 0, wire = 0, deltas = 0;
    for (let tick = 1; tick <= 180; tick++) {
      sim.update(1 / 20, { moveX: tick < 90 ? 1 : 0, moveZ: 1, sprint: tick < 45, jump: tick === 70 });
      const message: NetMessage = { k: 'snap', s: builder.build(sim.drainEvents()) as any, echo: { guest: tick * 50 } };
      const bytes = encoder.encode(message); json += Buffer.byteLength(JSON.stringify(message)); wire += bytes.length;
      if (bytes[3] === 2) deltas++;
      assert.deepEqual(decoder.decode(bytes), message);
    }
    assert.ok(deltas > 150, `${map}: stateful deltas are used`);
    assert.ok(wire < json * .65, `${map}: ${wire}/${json} bytes`);
  }
});
