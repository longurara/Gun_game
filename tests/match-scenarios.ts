import { GameSimulation } from '../src/game/simulation.ts';

const started = performance.now();
for (const seed of [1, 2, 3, 4, 5, 41, 107, 2026, 72341, 99991]) {
  const game = new GameSimulation({ seed, botCount: 7, difficulty: 'normal' });
  game.start();
  let firstKill: number | null = null;
  let botKills = 0;
  let shots = 0;
  let minimumBots = 7;
  while (game.state.phase === 'playing' && game.state.elapsed < 601) {
    const zone = game.state.zone;
    const destination = zone.isShrinking ? zone.nextCenter : zone.center;
    const distance = Math.hypot(game.player.position.x - destination.x, game.player.position.z - destination.z);
    const shouldMove = distance > (zone.isShrinking ? Math.max(2, zone.nextRadius - 8) : zone.radius - 10);
    game.update(0.1, {
      moveX: shouldMove ? (destination.x - game.player.position.x) / distance : 0,
      moveZ: shouldMove ? (destination.z - game.player.position.z) / distance : 0,
      sprint: true, jump: false,
    });
    for (const event of game.drainEvents()) {
      if (event.type === 'kill') { firstKill ??= game.state.elapsed; if (event.killerId?.startsWith('bot')) botKills++; }
      if (event.type === 'shot') shots++;
    }
    minimumBots = Math.min(minimumBots, game.state.actors.filter(actor => !actor.isPlayer && actor.alive).length);
  }
  console.log(JSON.stringify({ seed, phase: game.state.phase, elapsed: Math.round(game.state.elapsed), firstKill: firstKill === null ? null : Math.round(firstKill), botKills, shots, botsRemaining: minimumBots }));
}
console.log(`10 simulated rounds in ${Math.round(performance.now() - started)}ms`);

// Isolate bot-only pacing: the observer is alive but far outside perception and cannot affect fights.
for (const seed of [1, 2, 3, 4, 5, 41, 107, 2026, 72341, 99991]) {
  const game = new GameSimulation({ seed, botCount: 7, difficulty: 'normal' });
  game.start();
  game.player.position = { x: 999, y: 0, z: 999 };
  game.player.health = 100000;
  let botsAt60 = 7;
  while (game.state.phase === 'playing' && game.state.elapsed < 601) {
    game.update(0.1, { moveX: 0, moveZ: 0, sprint: false, jump: false });
    if (Math.abs(game.state.elapsed - 60) < 0.05) botsAt60 = game.state.actors.filter(actor => !actor.isPlayer && actor.alive).length;
    game.drainEvents();
  }
  console.log(JSON.stringify({ mode: 'bot-only', seed, phase: game.state.phase, elapsed: Math.round(game.state.elapsed), botsAt60 }));
}
