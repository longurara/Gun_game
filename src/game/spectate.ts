import type { Actor } from '../types';

/** Humans can be watched globally; bots require a current view near a surviving human. */
export function onlineSpectateCandidates(actors: readonly Actor[], localId: string): Actor[] {
  const people = actors.filter(actor => actor.isPlayer && actor.alive && actor.id !== localId);
  return actors.filter(actor => actor.id !== localId && actor.alive
    && (actor.isPlayer || !actor.air && !actor.hidden && actor.netVisible !== false
      && people.some(person => Math.hypot(person.position.x - actor.position.x, person.position.z - actor.position.z) < 300)));
}
