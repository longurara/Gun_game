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
  { map: 'range', bots: 10, players: 6 },
] as const;
const wireBytes = (bytes: Uint8Array) => bytes.length <= 32768 ? bytes.length : fragment(bytes, 1, 32768).reduce((sum, part) => sum + part.length, 0);
const round = (value: number) => Math.round(value * 100) / 100;
console.log('15-second deterministic runs, seed 9123, all humans moving and bots active. Average across guest links. Gameplay payload including binary fragment headers; excludes network headers, retransmits, ping/ICE traffic and TURN billing multipliers.');
for (const scenario of scenarios) {
  const sim = new GameSimulation({ map: scenario.map, seed: 9123, botCount: scenario.bots, humans: scenario.players, difficulty: 'normal', drop: false }); sim.start();
  const builder = new SnapshotBuilder(sim), previousEncoder = new WireEncoder(), rates = netRates(scenario.players);
  const peers = sim.humans.slice(1).map(actor => ({ actor, builder: new SnapshotBuilder(sim, actor.id), encoder: new WireEncoder(), decoder: new WireDecoder() }));
  const duration = 15;
  let json = 0, binary = 0, previous = 0, optimized = 0, samples = 0, oldRows = 0, newRows = 0, deltas = 0, encodeMs = 0, decodeMs = 0, pending: any[] = [];
  for (let tick = 1; tick <= duration * 60; tick++) {
    for (const [i, actor] of sim.humans.entries()) sim.setHumanInput(actor.id, { moveX: i % 2 ? .2 : -.2, moveZ: 1, sprint: tick < 150, jump: tick === 240 });
    sim.update(1 / 60, { moveX: -.2, moveZ: 1, sprint: tick < 150, jump: tick === 240 }); pending.push(...sim.drainEvents());
    if (tick % (60 / rates.snapshotHz)) continue;
    const echo = Object.fromEntries(peers.map(({ actor }) => [actor.id, Math.round(tick / 60 * 1000)]));
    const state = builder.build(pending), oldMessage: NetMessage = { k: 'snap', s: state, echo };
    oldRows += state.a.length;
    json += Buffer.byteLength(JSON.stringify(oldMessage)); previous += wireBytes(previousEncoder.encode(oldMessage));
    for (const peer of peers) {
      const snapshot = peer.builder.build(pending), message: NetMessage = { k: 'snap', to: peer.actor.id, s: snapshot, echo: { [peer.actor.id]: echo[peer.actor.id] } };
      newRows += snapshot.a.length; binary += wireBytes(new WireEncoder().encode(message));
      const at = performance.now(), bytes = peer.encoder.encode(message); encodeMs += performance.now() - at;
      optimized += wireBytes(bytes); samples++; if (bytes[3] === 2) deltas++;
      const decodeAt = performance.now(), restored = peer.decoder.decode(bytes); decodeMs += performance.now() - decodeAt;
      assert.deepEqual(restored, message);
    }
    pending = [];
  }
  let jsonInput = 0, binaryInput = 0;
  const inputEncoder = new WireEncoder();
  for (let seq = 1; seq <= duration * rates.inputHz; seq++) {
    const input = { k: 'in', seq, ct: Math.round(seq / rates.inputHz * 1000), mx: .2, mz: 1, sp: 1, ju: 0, th: 0, st: 0, yaw: 3.141, edge: 0, jumpId: 3 };
    jsonInput += Buffer.byteLength(JSON.stringify(input)); binaryInput += inputEncoder.encode(input).length;
  }
  const oldPayload = previous + binaryInput, after = optimized / peers.length + binaryInput, before = json + jsonInput;
  console.log(JSON.stringify({ ...scenario, actualHumans: sim.humans.length, actualBots: sim.state.actors.filter(a => !a.isPlayer && !a.dummy).length, actualTargets: sim.state.actors.filter(a => a.dummy).length,
    avgActorRows: { previous: round(oldRows / (samples / peers.length)), optimized: round(newRows / samples) }, snapshotHz: rates.snapshotHz, snapshotsPerGuest: samples / peers.length, deltaSnapshots: deltas,
    avgSnapshotBytes: { json: round(json / (samples / peers.length)), binaryFull: round(binary / samples), previousDelta: round(previous / (samples / peers.length)), optimizedDelta: round(optimized / samples) },
    payloadKBpsPerHostGuestLink: { json: round(before / duration / 1000), previous: round(oldPayload / duration / 1000), optimized: round(after / duration / 1000) },
    payloadMBPerRoomHour: { previous: round(oldPayload / duration * peers.length * 3600 / 1e6), optimized: round(after / duration * peers.length * 3600 / 1e6) },
    additionalSavedPercent: round((1 - after / oldPayload) * 100), savedVsJsonPercent: round((1 - after / before) * 100), codecMsPerSnapshot: { encode: round(encodeMs / samples), decode: round(decodeMs / samples) } }));
}
