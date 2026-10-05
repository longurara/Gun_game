import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameSimulation } from '../src/game/simulation.ts';
import { Lobby, makeRoomCode, normalizeRoomCode } from '../src/net/lobby.ts';
import type { RoomConfig } from '../src/net/lobby.ts';
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

test('bandwidth: a client sends about ten packets a second, the host about ten snapshots a second, each small', () => {
  const m = startMatch({ latency: 60 }, { map: 'valley', botCount: 20, difficulty: 'normal' });
  m.hostSim.botsFrozen = false;
  const a = m.peers[0];
  a.input = { ...idle, moveZ: 1 };
  const before = { host: { ...m.hostStats }, client: { ...a.stats } };
  m.run(10);
  const hostPerSecond = (m.hostStats.sent - before.host.sent) / 10, clientPerSecond = (a.stats.sent - before.client.sent) / 10;
  assert.ok(hostPerSecond >= 8 && hostPerSecond <= 11, `host ${hostPerSecond} messages/s`);
  assert.ok(clientPerSecond >= 8 && clientPerSecond <= 12, `client ${clientPerSecond} messages/s`);
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
