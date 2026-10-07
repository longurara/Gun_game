/** Deterministic application-payload comparison; no Supabase/TURN connections or credential usage. */
import assert from 'node:assert/strict';
import { GameSimulation } from '../src/game/simulation.ts';
import { netRates, SnapshotBuilder } from '../src/net/protocol.ts';
import { fragment, WireDecoder, WireEncoder } from '../src/net/wire.ts';
import type { NetMessage } from '../src/net/transport.ts';

const scenarios = [
  { map: 'arena', bots: 10, players: 2 },
  { map: 'arena', bots: 10, players: 6 },
  { map: 'valley', bots: 100, players: 6 },
  { map: 'island', bots: 100, players: 6 },
  { map: 'island', bots: 100, players: 2 },
] as const;
const wireBytes = (bytes: Uint8Array) => bytes.length <= 32768 ? bytes.length : fragment(bytes, 1, 32768).reduce((sum, part) => sum + part.length, 0);
const round = (value: number) => Math.round(value * 100) / 100;
console.log('15-second deterministic runs, seed 9123. Gameplay payload only (including binary fragment headers). Excludes network headers, retransmits, ping/ICE traffic and TURN billing multipliers.');
for (const scenario of scenarios) {
  const sim = new GameSimulation({ map: scenario.map, seed: 9123, botCount: scenario.bots, humans: scenario.players, difficulty: 'normal', drop: false }); sim.start();
  const builder = new SnapshotBuilder(sim), encoder = new WireEncoder(), decoder = new WireDecoder(), inputEncoder = new WireEncoder(), rates = netRates(scenario.players);
  const duration = 15;
  let json = 0, binary = 0, delta = 0, samples = 0, actorRows = 0, deltas = 0, encodeMs = 0, decodeMs = 0, pending: any[] = [];
  for (let tick = 1; tick <= duration * 60; tick++) {
    sim.update(1 / 60, { moveX: tick < 450 ? 1 : 0, moveZ: 1, sprint: tick < 150, jump: tick === 240 }); pending.push(...sim.drainEvents());
    if (tick % (60 / rates.snapshotHz)) continue;
    const echo = Object.fromEntries(Array.from({ length: scenario.players - 1 }, (_, i) => [`guest00${i}`, Math.round(tick / 60 * 1000)]));
    const state = builder.build(pending); actorRows += state.a.length;
    const message: NetMessage = { k: 'snap', s: state as any, echo }; pending = [];
    json += Buffer.byteLength(JSON.stringify(message)); binary += wireBytes(new WireEncoder().encode(message));
    const at = performance.now(), bytes = encoder.encode(message); encodeMs += performance.now() - at;
    delta += wireBytes(bytes); samples++; if (bytes[3] === 2) deltas++;
    const decodeAt = performance.now(), restored = decoder.decode(bytes); decodeMs += performance.now() - decodeAt;
    assert.deepEqual(restored, message);
  }
  let jsonInput = 0, binaryInput = 0;
  for (let seq = 1; seq <= duration * rates.inputHz; seq++) {
    const input = { k: 'in', seq, ct: Math.round(seq / rates.inputHz * 1000), mx: 1, mz: 1, sp: 1, ju: 0, th: 0, st: 0, yaw: 3.141, edge: 0, jumpId: 3 };
    jsonInput += Buffer.byteLength(JSON.stringify(input)); binaryInput += inputEncoder.encode(input).length;
  }
  const before = json + jsonInput, after = delta + binaryInput;
  console.log(JSON.stringify({ ...scenario, actualHumans: sim.humans.length, actualBots: sim.state.actors.length - sim.humans.length, avgActorRows: round(actorRows / samples), snapshotHz: rates.snapshotHz, snapshots: samples, deltaSnapshots: deltas,
    avgSnapshotBytes: { json: round(json / samples), binaryFull: round(binary / samples), binaryDelta: round(delta / samples) },
    payloadKBpsPerHostGuestLink: { before: round(before / duration / 1000), after: round(after / duration / 1000) },
    payloadMBPerRoomHour: { before: round(before / duration * (scenario.players - 1) * 3600 / 1e6), after: round(after / duration * (scenario.players - 1) * 3600 / 1e6) },
    savedPercent: round((1 - after / before) * 100), codecMsPerSnapshot: { encode: round(encodeMs / samples), decode: round(decodeMs / samples) } }));
}
