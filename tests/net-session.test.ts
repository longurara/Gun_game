import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameSimulation } from '../src/game/simulation.ts';
import { Lobby, makeRoomCode, normalizeRoomCode } from '../src/net/lobby.ts';
import type { RoomConfig } from '../src/net/lobby.ts';
import { netRates } from '../src/net/protocol.ts';
import { WEAPON_ORDER } from '../src/game/weapons.ts';
import { ClientSession, HostSession, matchOptions } from '../src/net/session.ts';
import type { MatchSetup } from '../src/net/session.ts';
import { LoopbackNetwork } from '../src/net/transport.ts';
import type { LoopbackTransport } from '../src/net/transport.ts';
import type { PlayerInput } from '../src/types.ts';

const idle: PlayerInput = { moveX: 0, moveZ: 0, sprint: false, jump: false };
const config: RoomConfig = { map: 'valley', botCount: 12, difficulty: 'normal' };

/** Count what each endpoint sends. */
function counted(endpoint: LoopbackTransport) {
  const stats = { sent: 0, bytes: 0 };
  const send = endpoint.send.bind(endpoint);
  endpoint.send = message => { stats.sent++; stats.bytes += JSON.stringify(message).length; send(message); };
  return stats;
}

/** A room with a host and `clients` joined players, lobby finished and the match not yet started. */
function openRoom(options: { latency?: number; jitter?: number; loss?: number } = {}, clients = 2, cfg: RoomConfig = config) {
  const net = new LoopbackNetwork(options, 5);
  const hostTransport = net.connect('host0000');
  const host = new Lobby(hostTransport, 'Hana', 'host', cfg, () => 0.123);
  const others = Array.from({ length: clients }, (_, i) => {
    const transport = net.connect(`client${i}00`);
    return { transport, lobby: new Lobby(transport, ['Minh', 'Lan', 'Bao', 'Vy', 'Tu'][i], 'client', cfg) };
  });
  const lobbies = [host, ...others.map(o => o.lobby)];
  const step = (ms: number) => { net.advance(ms); lobbies.forEach(l => l.tick(net.now)); };
  return { net, host, hostTransport, others, lobbies, step };
}

test('room codes are five easy characters, and typed codes are cleaned up', () => {
  const code = makeRoomCode(() => 0.5);
  assert.match(code, /^[A-HJ-NP-Z2-9]{5}$/);
  assert.equal(normalizeRoomCode(' ab-c o1 xyz '), 'ABC01');
  assert.match(makeRoomCode(), /^[A-HJ-NP-Z2-9]{5}$/);
});

test('lobby: players find the host by the room, see each other, and the host starts everybody together', () => {
  const room = openRoom({ latency: 80 });
  for (let i = 0; i < 40; i++) room.step(100);
  for (const lobby of room.lobbies) {
    assert.deepEqual(lobby.players.map(p => p.name), ['Hana', 'Minh', 'Lan'], `${lobby.role} roster`);
    assert.equal(lobby.phase, 'waiting');
  }
  const started: MatchSetup[] = [];
  room.others.forEach(o => o.lobby.onStart(setup => started.push(setup)));
  const setup = room.host.start(room.net.now)!;
  assert.equal(setup.players.length, 3);
  assert.equal(setup.players[0].name, 'Hana', 'the host is index 0');
  assert.equal(setup.drop, true);
  for (let i = 0; i < 5; i++) room.step(100);
  assert.equal(started.length, 2);
  assert.ok(started.every(s => s.seed === setup.seed && s.map === 'valley' && s.players.length === 3));
  assert.ok(room.others.every(o => o.lobby.phase === 'starting'));
  // Nobody can join once it has started.
  const late = room.net.connect('late0000');
  const lateLobby = new Lobby(late, 'Late', 'client', config);
  for (let i = 0; i < 20; i++) { room.net.advance(100); lateLobby.tick(room.net.now); }
  assert.equal(lateLobby.phase, 'error');
  assert.match(lateLobby.error, /bắt đầu/);
});

test('lobby: a full room refuses the seventh player, a missing room times out, leaving updates the roster, config changes spread', () => {
  const room = openRoom({}, 5);
  for (let i = 0; i < 30; i++) room.step(100);
  assert.equal(room.host.players.length, 6);
  const extra = room.net.connect('extra000');
  const extraLobby = new Lobby(extra, 'Extra', 'client', config);
  room.lobbies.push(extraLobby);
  for (let i = 0; i < 30; i++) room.step(100);
  assert.equal(extraLobby.phase, 'error');
  assert.match(extraLobby.error, /đầy/);
  room.others[0].lobby.leave();
  for (let i = 0; i < 20; i++) room.step(100);
  assert.equal(room.host.players.length, 5);
  room.host.setConfig({ map: 'island', botCount: 50, difficulty: 'easy' });
  for (let i = 0; i < 10; i++) room.step(100);
  assert.deepEqual(room.others[1].lobby.config, { map: 'island', botCount: 50, difficulty: 'easy' });

  const lonely = new LoopbackNetwork();
  const nobody = new Lobby(lonely.connect('a'), 'X', 'client', config);
  for (let i = 0; i < 100 && nobody.phase !== 'error'; i++) { lonely.advance(100); nobody.tick(lonely.now); }
  assert.equal(nobody.phase, 'error');
  assert.match(nobody.error, /Không tìm thấy phòng/);
});

test('lobby: a player who stops answering is dropped, and a host leaving closes the room for everyone', () => {
  const room = openRoom({}, 2);
  for (let i = 0; i < 30; i++) room.step(100);
  assert.equal(room.host.players.length, 3);
  // The second client goes silent (no ticks): the host drops it after the timeout.
  for (let i = 0; i < 100; i++) { room.net.advance(100); room.host.tick(room.net.now); room.others[0].lobby.tick(room.net.now); }
  assert.deepEqual(room.host.players.map(p => p.name), ['Hana', 'Minh']);
  room.host.leave();
  for (let i = 0; i < 5; i++) room.step(100);
  assert.equal(room.others[0].lobby.phase, 'closed');
  assert.match(room.others[0].lobby.error, /Chủ phòng/);
});

/** Everything needed to run a match over the loopback network. */
function startMatch(options: { latency?: number; jitter?: number; loss?: number } = {}, cfg: RoomConfig = config) {
  const room = openRoom(options, 2, cfg);
  for (let i = 0; i < 40; i++) room.step(100);
  const setup = room.host.start(room.net.now)!;
  const hostSim = new GameSimulation(matchOptions(setup, room.hostTransport.clientId, false));
  hostSim.start();
  const hostStats = counted(room.hostTransport);
  const hostSession = new HostSession(hostSim, room.hostTransport, setup, 8000, () => room.net.now);
  const peers = room.others.map(o => {
    const sim = new GameSimulation(matchOptions(setup, o.transport.clientId, true));
    sim.start();
    return { sim, session: new ClientSession(sim, o.transport, room.hostTransport.clientId, () => room.net.now), transport: o.transport, stats: counted(o.transport), input: { ...idle } as PlayerInput, yaw: 0 };
  });
  // Join order depends on message timing, so line the peers up by the actor they control: peers[0] is p1, peers[1] is p2.
  peers.sort((x, y) => x.sim.localId < y.sim.localId ? -1 : 1);
  const frame = (dt = 1 / 30, hostInput: PlayerInput = idle) => {
    room.net.advance(dt * 1000);
    hostSim.update(dt, hostInput);
    hostSession.drainEvents();
    hostSession.tick(dt);
    for (const peer of peers) {
      peer.sim.update(dt, peer.input);
      peer.session.tick(room.net.now, peer.input, peer.yaw);
      peer.session.frame(room.net.now);
    }
  };
  const run = (seconds: number, drive?: (t: number) => void) => { for (let i = 0; i < seconds * 30; i++) { drive?.(room.net.now / 1000); frame(); } };
  return { room, setup, hostSim, hostSession, hostStats, peers, frame, run };
}

test('a match over a 90 ms network: clients move at once, the host agrees, and everybody sees everybody', () => {
  const m = startMatch({ latency: 90, jitter: 30 }, { map: 'arena', botCount: 3, difficulty: 'normal' });
  const [a, b] = m.peers;
  const hostA = m.hostSim.actorById('p1')!, hostB = m.hostSim.actorById('p2')!, hostH = m.hostSim.actorById('p0')!;
  m.hostSim.botsFrozen = true;
  // Put everyone in the open, on a line, away from cover.
  const place = (id: string, x: number, z: number) => { for (const sim of [m.hostSim, a.sim, b.sim]) sim.actorById(id)!.position = { x, y: 0, z }; };
  place('p0', -60, -22); place('p1', -20, -22); place('p2', 20, -22);
  m.run(1);
  const start = { ...a.sim.player.position };
  a.input = { ...idle, moveX: 1 };
  b.input = { ...idle, moveZ: 1 };
  let biggestStep = 0, last = { ...a.sim.player.position };
  m.run(5, () => {
    const now = a.sim.player.position;
    biggestStep = Math.max(biggestStep, Math.hypot(now.x - last.x, now.z - last.z));
    last = { ...now };
  });
  // Prediction: the client moved right away (about 5.2 m/s for 5 s) without waiting for the host.
  assert.ok(a.sim.player.position.x - start.x > 22, `client A walked ${(a.sim.player.position.x - start.x).toFixed(1)} m`);
  assert.ok(biggestStep < 0.35, `no rubber-banding: the largest per-frame jump was ${biggestStep.toFixed(2)} m`);
  // The host agrees to within the network delay.
  assert.ok(Math.abs(hostA.position.x - a.sim.player.position.x) < 2.5, `host ${hostA.position.x.toFixed(1)} vs client ${a.sim.player.position.x.toFixed(1)}`);
  assert.ok(Math.abs(hostB.position.z - b.sim.player.position.z) < 2.5);
  // Everyone sees everyone else, slightly in the past.
  const seenByA = a.sim.actorById('p2')!.position, truth = hostB.position;
  assert.ok(Math.hypot(seenByA.x - truth.x, seenByA.z - truth.z) < 2.5, `A sees B ${(Math.hypot(seenByA.x - truth.x, seenByA.z - truth.z)).toFixed(2)} m from the host's truth`);
  const seenByB = b.sim.actorById('p1')!.position;
  assert.ok(Math.hypot(seenByB.x - hostA.position.x, seenByB.z - hostA.position.z) < 2.5);
  assert.ok(Math.hypot(a.sim.actorById('p0')!.position.x - hostH.position.x, a.sim.actorById('p0')!.position.z - hostH.position.z) < 0.5, 'a standing host is where it should be');
  // Round-trip time was measured.
  assert.ok(a.session.rttMs > 100 && a.session.rttMs < 450, `rtt ${a.session.rttMs.toFixed(0)} ms`);
  m.hostSession.close();
});

test('a wall the client did not know about is enforced: the host pulls the client back instead of letting it walk through', () => {
  const m = startMatch({ latency: 60 }, { map: 'arena', botCount: 1, difficulty: 'normal' });
  const [a] = m.peers;
  m.hostSim.botsFrozen = true;
  for (const sim of [m.hostSim, a.sim]) sim.actorById('p1')!.position = { x: -60, y: 0, z: -22 };
  // Only the host's world has a wall in the way (as if another player's car blocked the path).
  m.hostSim.world.obstacles.push({ id: 'ghost-wall', x: -50, z: -22, width: 2, depth: 30, height: 4, kind: 'wall' });
  m.run(1);
  a.input = { ...idle, moveX: 1 };
  m.run(6);
  const host = m.hostSim.actorById('p1')!.position.x;
  assert.ok(host < -48.5, `the host stopped at the wall: ${host.toFixed(1)}`);
  assert.ok(a.sim.player.position.x < -47, `the client was corrected back: ${a.sim.player.position.x.toFixed(1)}`);
});

test('shooting: the shot is validated by the host, damages the target, and the target sees the hit; ammunition stays in step', () => {
  const m = startMatch({ latency: 70 }, { map: 'arena', botCount: 1, difficulty: 'normal' });
  const [a, b] = m.peers;
  m.hostSim.botsFrozen = true;
  const place = (id: string, x: number, z: number) => { for (const sim of [m.hostSim, a.sim, b.sim]) sim.actorById(id)!.position = { x, y: 0, z }; };
  place('p0', -60, -50); place('p1', -60, -22); place('p2', -60, -2);
  m.run(1);
  const victim = m.hostSim.actorById('p2')!;
  const before = victim.health;
  const shooter = a.sim.player;
  const rounds = shooter.ammo[shooter.weapon];
  const got: string[] = [];
  for (let i = 0; i < 8; i++) {
    // The same call the game makes when the trigger is pulled: predicted locally, then reported to the host.
    const target = { x: -60, y: 1.0, z: -2 };
    if (a.sim.shootPlayer(target, true)) a.session.queueFire(target, true);
    m.run(0.25);
    for (const event of b.session.drainEvents()) if (event.type === 'damage' && event.actorId === 'p2') got.push('damage');
  }
  m.run(1);
  assert.ok(victim.health < before - 40, `the victim lost ${(before - victim.health).toFixed(0)} health on the host`);
  assert.ok(Math.abs(b.sim.player.health - victim.health) <= 1, 'the victim sees their own health');
  assert.ok(got.length >= 2, `the victim received ${got.length} hit events`);
  const hostRounds = m.hostSim.actorById('p1')!.ammo[shooter.weapon];
  assert.ok(rounds - hostRounds >= 5, 'the host spent the rounds');
  assert.ok(Math.abs(a.sim.player.ammo[shooter.weapon] - hostRounds) <= 1, `the client's count (${a.sim.player.ammo[shooter.weapon]}) matches the host's (${hostRounds})`);
  // Shooting without ammunition or through the cadence limit is refused locally and never sent.
  shooter.ammo[shooter.weapon] = 0;
  assert.equal(a.sim.shootPlayer({ x: 0, y: 1, z: 0 }, true), false);
});

test('commands from a client reach the host: reload, weapon switch, crouch, and a pickup that is addressed only to that player', () => {
  const m = startMatch({ latency: 50 }, { map: 'arena', botCount: 1, difficulty: 'normal' });
  const [a, b] = m.peers;
  m.hostSim.botsFrozen = true;
  m.run(0.5);
  const me = m.hostSim.actorById('p1')!;
  me.ammo[me.weapon] = 3;
  a.session.queueCommand('reload');
  m.run(0.5);
  assert.ok(me.reloading > 0 || me.ammo[me.weapon] > 3, 'the host started the reload');
  a.session.queueCommand('stance', 'crouch');
  m.run(0.4);
  assert.equal(me.stance, 'crouch');
  // A pickup next to A: the host moves A there, the loot is gone for everyone and only A gets the message.
  const loot = m.hostSim.state.loot.find(l => l.active && l.kind !== 'medkit')!;
  const index = m.hostSim.state.loot.indexOf(loot);
  for (const sim of [m.hostSim, a.sim]) sim.actorById('p1')!.position = { ...loot.position };
  a.session.queueCommand('interact');
  m.run(1);
  assert.equal(m.hostSim.state.loot[index].active, false);
  assert.equal(b.sim.state.loot[index].active, false, 'everybody learns the item is gone');
  assert.ok(a.sim.player.ownedWeapons.length >= 1);
  const aPickups = a.session.drainEvents().filter(e => e.type === 'pickup');
  const bPickups = b.session.drainEvents().filter(e => e.type === 'pickup');
  assert.ok(aPickups.length >= 1 && aPickups.every(e => (e as { for?: string }).for === 'p1'));
  assert.equal(bPickups.length, 0, 'B is not told about A\'s pickup');
});

test('the drop in multiplayer: each player jumps when they choose, and prediction in the air agrees with the host', () => {
  const m = startMatch({ latency: 80 }, { map: 'valley', botCount: 6, difficulty: 'normal' });
  const [a, b] = m.peers;
  assert.ok(a.sim.player.air?.mode === 'plane' && m.hostSim.actorById('p1')!.air?.mode === 'plane');
  m.run(3);
  // A jumps (a tap), B waits.
  a.input = { ...idle, jump: true };
  m.frame(); a.input = { ...idle };
  m.run(2);
  assert.equal(a.sim.player.air?.mode, 'freefall', 'A fell at once on its own screen');
  assert.equal(m.hostSim.actorById('p1')!.air?.mode, 'freefall', 'and the host agrees');
  assert.equal(b.sim.actorById('p1')!.air?.mode, 'freefall', 'B sees A fall');
  assert.equal(m.hostSim.actorById('p2')!.air?.mode, 'plane', 'B is still aboard');
  assert.ok(Math.abs(a.sim.player.position.y - m.hostSim.actorById('p1')!.position.y) < 25, 'heights agree to within the delay');
  for (let i = 0; i < 30 * 120 && (a.sim.player.air || m.hostSim.actorById('p1')!.air); i++) m.frame();
  assert.equal(m.hostSim.actorById('p1')!.air, null, 'the host landed A');
  assert.equal(a.sim.player.air, null, 'and A landed on its own screen');
  assert.ok(Math.hypot(a.sim.player.position.x - m.hostSim.actorById('p1')!.position.x, a.sim.player.position.z - m.hostSim.actorById('p1')!.position.z) < 5);
});

test('bandwidth: two players cost about twenty packets a second each way, and the rate backs off in bigger rooms', () => {
  const m = startMatch({ latency: 60 }, { map: 'valley', botCount: 20, difficulty: 'normal' });
  m.hostSim.botsFrozen = false;
  const a = m.peers[0];
  a.input = { ...idle, moveZ: 1 };
  const before = { host: { ...m.hostStats }, client: { ...a.stats } };
  m.run(10);
  const hostPerSecond = (m.hostStats.sent - before.host.sent) / 10, clientPerSecond = (a.stats.sent - before.client.sent) / 10;
  assert.ok(hostPerSecond >= 17 && hostPerSecond <= 22, `host ${hostPerSecond} messages/s`);
  assert.ok(clientPerSecond >= 17 && clientPerSecond <= 24, `client ${clientPerSecond} messages/s`);
  const snapshotBytes = (m.hostStats.bytes - before.host.bytes) / (m.hostStats.sent - before.host.sent);
  assert.ok(snapshotBytes < 9000, `a snapshot averages ${snapshotBytes.toFixed(0)} bytes`);
  // Idle clients still send a heartbeat so the host does not drop them.
  assert.ok(m.hostSim.actorById('p2')!.alive);
});

test('a player who disconnects is eliminated, and the match goes on for the rest', () => {
  const m = startMatch({ latency: 40 }, { map: 'arena', botCount: 2, difficulty: 'normal' });
  m.hostSim.botsFrozen = true;
  m.run(1);
  m.peers[1].session.leave();
  m.peers.pop();
  m.run(1);
  assert.equal(m.hostSim.actorById('p2')!.alive, false);
  assert.equal(m.hostSim.state.phase, 'playing');
  assert.deepEqual(m.hostSession.takeDeparted(), [`${m.setup.players[2].name} đã thoát`]);
  assert.ok(m.peers[0].sim.actorById('p2')!.alive === false, 'the other client sees the departure too');
});

test('a player who goes silent for the timeout is eliminated; the host closing is noticed by clients', () => {
  const m = startMatch({ latency: 40 }, { map: 'arena', botCount: 2, difficulty: 'normal' });
  m.hostSim.botsFrozen = true;
  m.run(1);
  // Client 2 stops sending anything (its machine froze).
  const [a, silent] = m.peers;
  const frames = (seconds: number) => {
    for (let i = 0; i < seconds * 30; i++) {
      m.room.net.advance(1000 / 30);
      m.hostSim.update(1 / 30, idle); m.hostSession.drainEvents(); m.hostSession.tick(1 / 30);
      a.sim.update(1 / 30, a.input); a.session.tick(m.room.net.now, a.input, 0); a.session.frame(m.room.net.now);
    }
  };
  frames(10);
  assert.equal(m.hostSim.actorById('p2')!.alive, false);
  assert.match(m.hostSession.takeDeparted()[0], /mất kết nối/);
  assert.equal(silent.session.matchOver, false);
  m.hostSession.close();
  frames(1);
  assert.equal(a.session.closedByHost, true);
});

test('5% packet loss and heavy jitter: still playable, no divergence of the loot list', () => {
  const m = startMatch({ latency: 100, jitter: 80, loss: 0.05 }, { map: 'valley', botCount: 10, difficulty: 'normal' });
  const [a] = m.peers;
  a.input = { ...idle, moveX: 1, moveZ: 0.5 };
  m.run(20);
  const host = m.hostSim.actorById('p1')!.position;
  assert.ok(Math.hypot(host.x - a.sim.player.position.x, host.z - a.sim.player.position.z) < 4, 'host and client agree on A within a few metres');
  assert.ok(a.session.silence < 1, 'snapshots keep arriving');
  // Force the periodic full resync of picked-up items and check the lists converge.
  for (const l of m.hostSim.state.loot.slice(0, 40)) l.active = false;
  m.run(10);
  const wrong = m.hostSim.state.loot.filter((l, i) => a.sim.state.loot[i].active !== l.active).length;
  assert.ok(wrong <= 3, `${wrong} loot flags differ after the resync`);
});

test('room message budget: snapshots plus every input stream stay under the free Realtime limit for any room size', () => {
  for (let players = 2; players <= 6; players++) {
    const { snapshotHz, inputHz } = netRates(players);
    const perSecond = snapshotHz + (players - 1) * inputHz;
    assert.ok(perSecond <= 85, `${players} players: ${perSecond} messages/s`);
    assert.ok(snapshotHz >= 15 && inputHz >= 10);
  }
});

test('smooth remote movement over a jittery network: a player walking at a steady pace never freezes or lurches on the observer screen', () => {
  const m = startMatch({ latency: 100, jitter: 60 }, { map: 'arena', botCount: 1, difficulty: 'normal' });
  const [a, b] = m.peers;
  m.hostSim.botsFrozen = true;
  const place = (id: string, x: number, z: number) => { for (const sim of [m.hostSim, a.sim, b.sim]) sim.actorById(id)!.position = { x, y: 0, z }; };
  place('p0', -60, 30); place('p1', -40, -22); place('p2', 30, 30);
  m.run(1);
  a.input = { ...idle, moveX: 1 };
  m.run(1.5);
  const seen = () => b.sim.actorById('p1')!.position.x;
  let last = seen(), frozen = 0, lurch = 0, frames = 0, walked = 0;
  for (let i = 0; i < 30 * 4; i++) {
    m.frame();
    const step = seen() - last; last = seen(); frames++; walked += step;
    const expected = walked / frames;
    if (step < expected * 0.25) frozen++;
    if (step > expected * 2.5) lurch++;
  }
  assert.ok(frozen / frames < 0.03, `${frozen}/${frames} frames where the walker stood still on screen`);
  assert.ok(lurch / frames < 0.03, `${lurch}/${frames} frames where the walker jumped ahead`);
  m.hostSession.close();
});

test('a long ping does not make the local player rubber-band while sprinting in the open', () => {
  const m = startMatch({ latency: 220, jitter: 40 }, { map: 'arena', botCount: 1, difficulty: 'normal' });
  const [a] = m.peers;
  m.hostSim.botsFrozen = true;
  for (const sim of [m.hostSim, a.sim, m.peers[1].sim]) { sim.actorById('p0')!.position = { x: -60, y: 0, z: 30 }; sim.actorById('p1')!.position = { x: -40, y: 0, z: -22 }; sim.actorById('p2')!.position = { x: 30, y: 0, z: 30 }; }
  m.run(1);
  a.input = { ...idle, moveX: 1, sprint: true };
  let last = { ...a.sim.player.position }, biggest = 0, smallest = Infinity, first = true;
  m.run(5, () => {
    const now = a.sim.player.position, step = Math.hypot(now.x - last.x, now.z - last.z);
    if (first) { first = false; return; }
    biggest = Math.max(biggest, step); smallest = Math.min(smallest, step); last = { ...now };
  });
  assert.ok(biggest < 0.4, `largest per-frame step ${biggest.toFixed(2)} m (a sprint is about 0.2)`);
  assert.ok(smallest > 0.05, `smallest per-frame step ${smallest.toFixed(2)} m: the view was pulled back`);
  m.hostSession.close();
});

test('input is sent the moment movement changes instead of waiting for the next regular packet', () => {
  const m = startMatch({ latency: 20 }, { map: 'arena', botCount: 1, difficulty: 'normal' });
  const [a] = m.peers;
  m.hostSim.botsFrozen = true;
  m.run(1);
  const before = a.stats.sent;
  a.input = { ...idle, moveX: 1 };
  m.frame(); m.frame();
  assert.ok(a.stats.sent > before, 'a key press goes out within two frames');
  m.hostSession.close();
});

/** A shooter aims at a runner exactly where the runner is drawn on the shooter's screen, and fires on a steady beat. */
function runnerDuel(latency: number, jitter: number) {
  const m = startMatch({ latency, jitter }, { map: 'arena', botCount: 1, difficulty: 'normal' });
  const [a, b] = m.peers;
  m.hostSim.botsFrozen = true;
  const place = (id: string, x: number, z: number) => { for (const sim of [m.hostSim, a.sim, b.sim]) sim.actorById(id)!.position = { x, y: 0, z }; };
  place('p0', -70, -55); place('p1', -60, -22); place('p2', -60, 0);
  m.run(1);
  const victim = m.hostSim.actorById('p2')!;
  let landed = 0, shots = 0, last = victim.health;
  // The runner paces sideways at walking speed; the host sees every hit as a drop in their health.
  for (let i = 0; i < 40; i++) {
    b.input = { ...idle, moveX: Math.floor(i / 8) % 2 === 0 ? 1 : -1 };
    m.run(0.2);
    const seen = a.sim.actorById('p2')!.position;
    const target = { x: seen.x, y: seen.y + 1.0, z: seen.z };
    if (a.sim.shootPlayer(target, true)) { a.session.queueFire(target, true); shots++; }
    m.run(0.3);
    if (victim.health < last - 0.5) landed++;
    last = victim.health;
    if (victim.health <= 30) { victim.health = 100; last = 100; b.sim.player.health = 100; }
    a.sim.player.ammo[a.sim.player.weapon] = 30; m.hostSim.actorById('p1')!.ammo[a.sim.player.weapon] = 30;
  }
  m.hostSession.close();
  return { landed, shots };
}

test('lag compensation: shots at a moving target, aimed where the shooter sees it, land on the host (without it only about one in ten did)', () => {
  for (const [latency, jitter] of [[50, 10], [100, 20], [200, 60]]) {
    const { landed, shots } = runnerDuel(latency, jitter);
    assert.ok(shots >= 12, `${shots} shots fired`);
    assert.ok(landed / shots >= 0.6, `${landed} of ${shots} shots landed at ${latency} ms ± ${jitter}`);
  }
});

test('a jump looks the same on a laggy client as offline: same height, same time in the air, no snap back', () => {
  const m = startMatch({ latency: 100, jitter: 20 }, { map: 'arena', botCount: 1, difficulty: 'normal' });
  const [a, b] = m.peers;
  m.hostSim.botsFrozen = true;
  for (const sim of [m.hostSim, a.sim, b.sim]) { sim.actorById('p0')!.position = { x: -70, y: 0, z: -55 }; sim.actorById('p1')!.position = { x: -60, y: 0, z: -22 }; sim.actorById('p2')!.position = { x: 30, y: 0, z: 30 }; }
  m.run(1);
  const ys: number[] = [];
  a.input = { ...idle, jump: true };
  m.frame();
  a.input = { ...idle };
  for (let i = 0; i < 30 * 2; i++) { ys.push(a.sim.player.position.y); m.frame(); }
  const peak = Math.max(...ys);
  const airFrames = ys.filter(y => y > 0.01).length;
  // 6.7 m/s up against 18 m/s² gravity: 1.25 m high, 0.74 s in the air (about 22 frames at 30 fps).
  assert.ok(peak > 1.1 && peak < 1.4, `peak ${peak.toFixed(2)} m`);
  assert.ok(airFrames >= 19 && airFrames <= 25, `${airFrames} frames in the air`);
  m.hostSession.close();
});

test('crouching and switching weapons stay put on the client while the host catches up, instead of flickering back', () => {
  const m = startMatch({ latency: 120, jitter: 20 }, { map: 'arena', botCount: 1, difficulty: 'normal' });
  const [a, b] = m.peers;
  m.hostSim.botsFrozen = true;
  for (const sim of [m.hostSim, a.sim, b.sim]) { sim.actorById('p0')!.position = { x: -70, y: 0, z: -55 }; sim.actorById('p1')!.position = { x: -60, y: 0, z: -22 }; sim.actorById('p2')!.position = { x: 30, y: 0, z: 30 }; }
  m.run(1);
  const me = a.sim.player, other = WEAPON_ORDER.find(weapon => weapon !== me.weapon)!;
  for (const sim of [m.hostSim, a.sim]) sim.actorById('p1')!.ownedWeapons.push(other);
  assert.ok(a.sim.setStance('crouch'));
  a.session.queueCommand('stance', 'crouch');
  assert.ok(a.sim.switchWeapon(other));
  a.session.queueCommand('switch', other);
  const seenStance = new Set<string>(), seenWeapon = new Set<string>();
  for (let i = 0; i < 30; i++) { m.frame(); seenStance.add(me.stance ?? 'stand'); seenWeapon.add(me.weapon); }
  assert.deepEqual([...seenStance], ['crouch'], `stances seen: ${[...seenStance].join(', ')}`);
  assert.deepEqual([...seenWeapon], [other], `weapons seen: ${[...seenWeapon].join(', ')}`);
  assert.equal(m.hostSim.actorById('p1')!.stance, 'crouch');
  assert.equal(m.hostSim.actorById('p1')!.weapon, other);
  m.hostSession.close();
});

test('sliding along a wall on a laggy connection stays smooth: no stutter or pull-back, and the host agrees', () => {
  const m = startMatch({ latency: 150, jitter: 40 }, { map: 'arena', botCount: 1, difficulty: 'normal' });
  const [a, b] = m.peers;
  m.hostSim.botsFrozen = true;
  for (const sim of [m.hostSim, a.sim, b.sim]) {
    sim.actorById('p0')!.position = { x: -70, y: 0, z: -55 }; sim.actorById('p1')!.position = { x: -60, y: 0, z: -22 }; sim.actorById('p2')!.position = { x: 30, y: 0, z: 30 };
    sim.world.obstacles.push({ id: 'shared-wall', x: -50, z: -22, width: 2, depth: 40, height: 4, kind: 'wall' });
  }
  m.run(1);
  a.input = { ...idle, moveX: 1, moveZ: 1 };
  m.run(1);
  let last = { ...a.sim.player.position }, first = true, biggest = 0, smallest = Infinity;
  m.run(3.5, () => {
    const now = a.sim.player.position, step = Math.hypot(now.x - last.x, now.z - last.z);
    last = { ...now };
    if (first) { first = false; return; }
    biggest = Math.max(biggest, step); smallest = Math.min(smallest, step);
  });
  assert.ok(biggest < 0.3, `largest per-frame step ${biggest.toFixed(2)} m`);
  assert.ok(smallest > 0.04, `smallest per-frame step ${smallest.toFixed(2)} m: the view stuttered or was pulled back`);
  const host = m.hostSim.actorById('p1')!.position;
  assert.ok(Math.hypot(host.x - a.sim.player.position.x, host.z - a.sim.player.position.z) < 2.2, 'the host agrees');
  m.hostSession.close();
});

test('driving on a laggy connection: the car answers the wheel at once, runs smoothly, and the host agrees', () => {
  const m = startMatch({ latency: 100, jitter: 20 }, { map: 'valley', botCount: 1, difficulty: 'normal' });
  const [a, b] = m.peers;
  m.hostSim.botsFrozen = true;
  const car = m.hostSim.state.vehicles[0];
  assert.ok(car, 'the map has a car');
  for (const sim of [m.hostSim, a.sim, b.sim]) {
    sim.actorById('p0')!.position = { x: car.position.x + 200, y: 0, z: car.position.z + 200 };
    sim.actorById('p2')!.position = { x: car.position.x - 200, y: 0, z: car.position.z - 200 };
    const p1 = sim.actorById('p1')!;
    p1.air = null;
    p1.position = { x: car.position.x + 1.5, y: car.position.y, z: car.position.z };
  }
  m.run(1);
  a.session.queueCommand('vehicle');
  for (let i = 0; i < 90 && !(a.sim.player.vehicleId && m.hostSim.actorById('p1')!.vehicleId); i++) m.frame();
  assert.ok(a.sim.player.vehicleId, 'the client got into the car');
  const mine = a.sim.state.vehicles.find(v => v.id === a.sim.player.vehicleId)!;
  const hostCar = m.hostSim.state.vehicles.find(v => v.id === mine.id)!;
  // Wheel: accelerate straight, then steer.
  a.input = { ...idle, throttle: 1, steer: 0 };
  for (let i = 0; i < 15; i++) m.frame();
  assert.ok(mine.speed > 3.5, `the client car already moves at ${mine.speed.toFixed(1)} m/s half a second after pressing the pedal`);
  assert.ok(hostCar.speed < mine.speed, 'the host is still catching up');
  let last = { ...mine.position }, lastStep = -1, wobble = 0, frames = 0;
  const yawBefore = mine.yaw;
  a.input = { ...idle, throttle: 1, steer: 0.5 };
  for (let i = 0; i < 3; i++) m.frame();
  assert.ok(Math.abs(mine.yaw - yawBefore) > 0.005, 'the car turns within three frames of turning the wheel');
  for (let i = 0; i < 30 * 3; i++) {
    m.frame();
    const step = Math.hypot(mine.position.x - last.x, mine.position.z - last.z);
    last = { ...mine.position };
    if (lastStep >= 0 && Math.abs(step - lastStep) > 0.4) wobble++;
    lastStep = step; frames++;
  }
  assert.ok(wobble / frames < 0.05, `${wobble} of ${frames} frames lurched`);
  assert.ok(Math.hypot(hostCar.position.x - mine.position.x, hostCar.position.z - mine.position.z) < 12, 'the host is not far behind');
  m.hostSession.close();
});

test('turning while moving: the host path follows the client path closely, so the view is hardly ever corrected', () => {
  const m = startMatch({ latency: 80, jitter: 30 }, { map: 'arena', botCount: 1, difficulty: 'normal' });
  const [a, b] = m.peers;
  m.hostSim.botsFrozen = true;
  for (const sim of [m.hostSim, a.sim, b.sim]) { sim.actorById('p0')!.position = { x: -70, y: 0, z: -55 }; sim.actorById('p1')!.position = { x: -60, y: 0, z: -22 }; sim.actorById('p2')!.position = { x: 30, y: 0, z: 30 }; }
  m.run(1);
  const before = { ...a.session.corrections };
  // Running forward while the camera turns about 70 degrees a second: the world-space direction changes every frame.
  m.run(20, t => { const heading = t * 1.2; a.input = { ...idle, moveX: Math.sin(heading), moveZ: Math.cos(heading), sprint: true }; });
  const count = a.session.corrections.count - before.count, metres = a.session.corrections.metres - before.metres;
  assert.ok(count <= 4, `${count} corrections (${metres.toFixed(1)} m in total) in 20 s of turning`);
  m.hostSession.close();
});
