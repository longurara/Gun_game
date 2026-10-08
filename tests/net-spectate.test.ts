import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameSimulation } from '../src/game/simulation.ts';
import { onlineSpectateCandidates } from '../src/game/spectate.ts';

function room() {
  const sim = new GameSimulation({ seed: 77, map: 'valley', humans: 3, botCount: 2, drop: true, localId: 'p0' });
  sim.start(); sim.player.alive = false; return sim;
}

test('a dead online player can spectate surviving humans on the plane, in freefall and under a canopy', () => {
  const sim = room(), mate = sim.humans[1];
  sim.humans[2].alive = false;
  for (const mode of ['plane', 'freefall', 'chute'] as const) {
    mate.air = { mode, vx: 0, vy: -6, vz: 0, time: 1 };
    assert.deepEqual(onlineSpectateCandidates(sim.state.actors, sim.localId).map(actor => actor.id), [mate.id]);
  }
});

test('spectate skips hidden range targets and stale/far bots while keeping visible nearby opponents', () => {
  const sim = new GameSimulation({ seed: 77, map: 'range', humans: 3, botCount: 2, localId: 'p0' });
  sim.start(); sim.player.alive = false;
  const mate = sim.humans[1], bots = sim.state.actors.filter(actor => !actor.isPlayer);
  mate.air = null; sim.humans[2].alive = false;
  for (const actor of bots) { actor.air = null; actor.position = { ...mate.position }; actor.netVisible = false; }
  const target = bots.find(actor => actor.dummy)!;
  target.hidden = true; target.netVisible = true;
  assert.deepEqual(onlineSpectateCandidates(sim.state.actors, sim.localId).map(actor => actor.id), [mate.id]);
  target.hidden = false;
  assert.ok(onlineSpectateCandidates(sim.state.actors, sim.localId).includes(target));
  target.position.x += 301;
  assert.deepEqual(onlineSpectateCandidates(sim.state.actors, sim.localId).map(actor => actor.id), [mate.id]);
});
