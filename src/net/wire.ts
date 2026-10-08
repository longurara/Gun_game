/** Versioned binary packets and lossless snapshot deltas for an ordered, reliable DataChannel.
 * The simulation still receives full JSON-shaped messages. No gzip latency, dependencies or reduced tick rates.
 */
import type { NetMessage } from './transport';

export const WIRE_VERSION = 3;
export const MAX_WIRE_BYTES = 256 * 1024;
const MAX_NODES = 100_000;
const MAX_DEPTH = 64;
const KEYS = ('k s echo v seq t zone plane a c loot add off all drops pr sm fi priv humans ev over id weapon owned ammo reserve medkits helmet vest reload heal sup boost hk tk bl pk ps att ml br hb air vy speed setup seed map botCount difficulty drop players clientId name skin type actorId sourceId from to position damage amount kind x y z yaw mx mz sp ju th st edge jumpId ct fires cmds rtc-ping rtc-pong in snap start closed why host shot explosion throw smoke fire flash portal view pub watch alive').split(' ');
const KEY_INDEX = new Map(KEYS.map((key, index) => [key, index]));
const utf8 = new TextEncoder();
const text = new TextDecoder('utf-8', { fatal: true });
type Value = null | boolean | number | string | Value[] | { [key: string]: Value };
type ObjectValue = { [key: string]: Value };
type Patch = [0, Value] | [1, Array<[string, Patch]>, string[]] | [2, number, Array<[number, Patch]>] | [3, number, Value[]];
const object = (value: unknown): value is ObjectValue => !!value && typeof value === 'object' && !Array.isArray(value);
const safeKey = (key: string) => !['__proto__', 'constructor', 'prototype'].includes(key);

class Writer {
  private bytes = new Uint8Array(1024);
  private offset = 0;
  private nodes = 0;
  private reserve(length: number): void {
    if (this.offset + length > MAX_WIRE_BYTES) throw new Error('Packet too large');
    if (this.offset + length > this.bytes.length) {
      const next = new Uint8Array(Math.min(MAX_WIRE_BYTES, Math.max(this.bytes.length * 2, this.offset + length)));
      next.set(this.bytes); this.bytes = next;
    }
  }
  byte(value: number): void { this.reserve(1); this.bytes[this.offset++] = value; }
  uint(value: number): void {
    do { const next = value % 128; value = Math.floor(value / 128); this.byte(next | (value ? 128 : 0)); } while (value);
  }
  value(value: unknown, depth = 0): void {
    if (++this.nodes > MAX_NODES || depth > MAX_DEPTH) throw new Error('Packet too complex');
    if (value === null || value === undefined) { this.byte(0); return; }
    if (typeof value === 'boolean') { this.byte(value ? 2 : 1); return; }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error('Non-finite number');
      const integer = Number.isInteger(value);
      const scaled = integer ? value : Math.round(value * 1000);
      // Encode existing centimetre/millimetre rounding exactly; never introduce new quantization.
      if (!Object.is(value, -0) && Math.abs(scaled) <= 0x7fffffff && (integer || scaled / 1000 === value)) {
        this.byte(integer ? 3 : 4); this.uint(scaled >= 0 ? scaled * 2 : -scaled * 2 - 1);
      } else {
        this.byte(5); this.reserve(8); new DataView(this.bytes.buffer).setFloat64(this.offset, value, true); this.offset += 8;
      }
      return;
    }
    if (typeof value === 'string') {
      const index = KEY_INDEX.get(value);
      if (index !== undefined) { this.byte(9); this.uint(index); return; }
      if (value.length > MAX_WIRE_BYTES) throw new Error('String too large');
      const bytes = utf8.encode(value); this.byte(6); this.uint(bytes.length); this.reserve(bytes.length); this.bytes.set(bytes, this.offset); this.offset += bytes.length; return;
    }
    if (Array.isArray(value)) {
      this.byte(7); this.uint(value.length); for (const item of value) this.value(item, depth + 1); return;
    }
    if (!object(value)) throw new Error('Unsupported value');
    const entries = Object.entries(value).filter(([, item]) => item !== undefined);
    this.byte(8); this.uint(entries.length);
    for (const [key, item] of entries) {
      if (!safeKey(key)) throw new Error('Unsafe key');
      this.value(key, depth + 1); this.value(item, depth + 1);
    }
  }
  finish(): Uint8Array { return this.bytes.slice(0, this.offset); }
}

class Reader {
  offset = 4;
  private nodes = 0;
  constructor(private readonly bytes: Uint8Array) {}
  private take(length: number): number {
    if (this.offset + length > this.bytes.length) throw new Error('Truncated packet');
    const at = this.offset; this.offset += length; return at;
  }
  private byte(): number { return this.bytes[this.take(1)]; }
  private uint(): number {
    let value = 0, scale = 1;
    for (let i = 0; i < 5; i++) { const byte = this.byte(); value += (byte & 127) * scale; if (!(byte & 128)) { if (value > 0xffffffff) break; return value; } scale *= 128; }
    throw new Error('Invalid integer');
  }
  value(depth = 0): Value {
    if (++this.nodes > MAX_NODES || depth > MAX_DEPTH) throw new Error('Packet too complex');
    switch (this.byte()) {
      case 0: return null;
      case 1: return false;
      case 2: return true;
      case 3: case 4: {
        const tag = this.bytes[this.offset - 1], value = this.uint(), signed = value % 2 ? -(value + 1) / 2 : value / 2;
        return tag === 4 ? signed / 1000 : signed;
      }
      case 5: { const at = this.take(8), value = new DataView(this.bytes.buffer, this.bytes.byteOffset + at, 8).getFloat64(0, true); if (!Number.isFinite(value)) throw new Error('Invalid number'); return value; }
      case 6: { const length = this.uint(), at = this.take(length); return text.decode(this.bytes.subarray(at, at + length)); }
      case 9: { const index = this.uint(); if (index >= KEYS.length) throw new Error('Invalid dictionary'); return KEYS[index]; }
      case 7: {
        const length = this.uint(); if (length > MAX_NODES || length > this.bytes.length - this.offset) throw new Error('Invalid array length');
        const array: Value[] = []; for (let i = 0; i < length; i++) array.push(this.value(depth + 1)); return array;
      }
      case 8: {
        const length = this.uint(); if (length > MAX_NODES || length * 2 > this.bytes.length - this.offset) throw new Error('Invalid object length');
        const result: ObjectValue = {};
        for (let i = 0; i < length; i++) { const key = this.value(depth + 1); if (typeof key !== 'string' || !safeKey(key) || Object.hasOwn(result, key)) throw new Error('Invalid key'); result[key] = this.value(depth + 1); }
        return result;
      }
      default: throw new Error('Invalid value tag');
    }
  }
}

function difference(previous: Value, current: Value): Patch | null {
  if (Object.is(previous, current)) return null;
  if (Array.isArray(previous) && Array.isArray(current)) {
    // Actor/vehicle coordinate rows use a field mask instead of a patch per scalar.
    if (current.length <= 30 && current.length === previous.length && current.every(v => typeof v === 'number') && previous.every(v => typeof v === 'number')) {
      let mask = 0; const values: Value[] = [];
      current.forEach((value, index) => { if (!Object.is(value, previous[index])) { mask |= 1 << index; values.push(value); } });
      return mask ? [3, mask, values] : null;
    }
    const changes: Array<[number, Patch]> = [];
    current.forEach((value, index) => { const patch = index >= previous.length ? [0, value] as Patch : difference(previous[index], value); if (patch) changes.push([index, patch]); });
    return changes.length || previous.length !== current.length ? [2, current.length, changes] : null;
  }
  if (object(previous) && object(current)) {
    const changes: Array<[string, Patch]> = [];
    for (const [key, value] of Object.entries(current)) { const patch = Object.hasOwn(previous, key) ? difference(previous[key], value) : [0, value] as Patch; if (patch) changes.push([key, patch]); }
    const removed = Object.keys(previous).filter(key => !Object.hasOwn(current, key));
    return changes.length || removed.length ? [1, changes, removed] : null;
  }
  return [0, current];
}

function apply(previous: Value, patch: Value, depth = 0): Value {
  if (depth > MAX_DEPTH || !Array.isArray(patch)) throw new Error('Invalid patch');
  if (patch[0] === 0 && patch.length === 2) return patch[1];
  if (patch[0] === 1 && patch.length === 3 && object(previous) && Array.isArray(patch[1]) && Array.isArray(patch[2])) {
    const result = { ...previous };
    for (const key of patch[2]) { if (typeof key !== 'string' || !safeKey(key)) throw new Error('Invalid removal'); delete result[key]; }
    for (const entry of patch[1]) { if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !safeKey(entry[0])) throw new Error('Invalid entry'); result[entry[0]] = apply(result[entry[0]] ?? null, entry[1], depth + 1); }
    return result;
  }
  if (patch[0] === 2 && patch.length === 3 && Array.isArray(previous) && Number.isInteger(patch[1]) && typeof patch[1] === 'number' && patch[1] >= 0 && patch[1] <= MAX_NODES && Array.isArray(patch[2])) {
    const result = previous.slice(0, patch[1]);
    // No holes in the reconstructed arrays, even with a malicious delta.
    for (const entry of patch[2]) { if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'number' || !Number.isInteger(entry[0]) || entry[0] < 0 || entry[0] >= patch[1]) throw new Error('Invalid index'); result[entry[0]] = apply(result[entry[0]] ?? null, entry[1], depth + 1); }
    if (result.length !== patch[1] || Object.keys(result).length !== result.length) throw new Error('Incomplete array');
    return result;
  }
  if (patch[0] === 3 && patch.length === 3 && Array.isArray(previous) && previous.length <= 30 && typeof patch[1] === 'number' && Number.isInteger(patch[1]) && patch[1] > 0 && patch[1] < 2 ** previous.length && Array.isArray(patch[2])) {
    const result = [...previous]; let next = 0;
    result.forEach((_, index) => { if ((patch[1] as number) & (1 << index)) { if (next >= (patch[2] as Value[]).length) throw new Error('Missing field'); result[index] = (patch[2] as Value[])[next++]; } });
    if (next !== patch[2].length) throw new Error('Extra field'); return result;
  }
  throw new Error('Invalid patch');
}

function packet(kind: number, value: unknown): Uint8Array {
  const writer = new Writer(); writer.byte(0x4c); writer.byte(0x4c); writer.byte(WIRE_VERSION); writer.byte(kind); writer.value(value); return writer.finish();
}
const snapshot = (message: NetMessage): ObjectValue | null => message.k === 'snap' && object(message.s) && Number.isSafeInteger(message.s.seq) ? message.s : null;
function clone(value: Value): Value {
  if (Array.isArray(value)) return Array.from(value, item => item === undefined ? null : clone(item));
  if (!object(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, clone(item)]));
}

export class WireEncoder {
  private previous: ObjectValue | null = null;
  private sinceFull = 0;
  reset(): void { this.previous = null; this.sinceFull = 0; }
  encode(message: NetMessage): Uint8Array {
    const source = snapshot(message);
    // Snapshot state follows JSON's optional-field semantics, while retaining exact finite numbers.
    // Validate before cloning so arbitrary deep/oversized input cannot overflow the clone recursion.
    const full = packet(source ? 1 : 0, message);
    const current = source ? clone(source) as ObjectValue : null;
    if (!current) return full;
    let result = full;
    if (this.previous && this.sinceFull < 49 && (current.seq as number) > (this.previous.seq as number)) {
      const patch = difference(this.previous, current);
      if (patch) {
        const delta = packet(2, { ...message, s: patch, base: this.previous.seq });
        if (delta.length < full.length) result = delta;
      }
    }
    this.sinceFull = result === full ? 0 : this.sinceFull + 1;
    // Own the baseline: simulation code may mutate a message after send().
    this.previous = current;
    return result;
  }
}

export class MissingBaseline extends Error {}
export class WireDecoder {
  private previous: ObjectValue | null = null;
  decode(bytes: Uint8Array): NetMessage {
    if (bytes.length < 5 || bytes.length > MAX_WIRE_BYTES || bytes[0] !== 0x4c || bytes[1] !== 0x4c || bytes[2] !== WIRE_VERSION || bytes[3] > 2) throw new Error('Invalid frame');
    const reader = new Reader(bytes), value = reader.value();
    if (reader.offset !== bytes.length || !object(value) || typeof value.k !== 'string') throw new Error('Invalid message');
    if (bytes[3] === 2) {
      if (value.k !== 'snap' || !Number.isSafeInteger(value.base)) throw new Error('Invalid delta');
      if (!this.previous || value.base !== this.previous.seq) { this.previous = null; throw new MissingBaseline('Snapshot baseline missing'); }
      value.s = apply(this.previous, value.s); delete value.base;
    }
    const current = snapshot(value as NetMessage);
    if (bytes[3] !== 0 && !current) throw new Error('Invalid snapshot');
    // A chain of small deltas cannot grow the reconstructed state beyond the full-frame limits.
    if (bytes[3] === 2) packet(1, value);
    if (current) this.previous = clone(current) as ObjectValue;
    return value as NetMessage;
  }
}

/** Fragment binary packets without JSON/base64 expansion. Each peer owns one bounded assembly. */
export function fragment(bytes: Uint8Array, id: number, limit: number): Uint8Array[] {
  if (bytes.length > MAX_WIRE_BYTES) throw new Error('Packet too large');
  const size = Math.min(8192, limit - 16);
  if (size < 1024) throw new Error('SCTP message limit too small');
  const total = Math.ceil(bytes.length / size);
  return Array.from({ length: total }, (_, index) => {
    const part = bytes.subarray(index * size, (index + 1) * size), out = new Uint8Array(16 + part.length), view = new DataView(out.buffer);
    out.set([0x4c, 0x4c, WIRE_VERSION, 3]); view.setUint32(4, id, true); view.setUint16(8, index, true); view.setUint16(10, total, true); view.setUint32(12, bytes.length, true); out.set(part, 16); return out;
  });
}

export class WireAssembly {
  private frame: { id: number; total: number; next: number; offset: number; bytes: Uint8Array } | null = null;
  receive(bytes: Uint8Array): Uint8Array | null {
    if (bytes[3] !== 3) { this.frame = null; return bytes; }
    if (bytes.length < 17 || bytes.length > 32768 || bytes[0] !== 0x4c || bytes[1] !== 0x4c || bytes[2] !== WIRE_VERSION) throw new Error('Invalid fragment');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), id = view.getUint32(4, true), index = view.getUint16(8, true), total = view.getUint16(10, true), length = view.getUint32(12, true);
    if (total < 2 || total > 256 || index >= total || length > MAX_WIRE_BYTES || length < total) throw new Error('Invalid fragment length');
    if (index === 0) this.frame = { id, total, next: 0, offset: 0, bytes: new Uint8Array(length) };
    const frame = this.frame;
    if (!frame || frame.id !== id || frame.total !== total || frame.next !== index || frame.bytes.length !== length) { this.frame = null; return null; }
    const part = bytes.subarray(16);
    if (frame.offset + part.length > length) { this.frame = null; throw new Error('Fragment overflow'); }
    frame.bytes.set(part, frame.offset); frame.offset += part.length; frame.next++;
    if (frame.next !== total) return null;
    this.frame = null; if (frame.offset !== length) throw new Error('Incomplete frame'); return frame.bytes;
  }
}
