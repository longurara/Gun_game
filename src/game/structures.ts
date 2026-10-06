import type { Field, LootSpot, Obstacle, RoadSegment, StructurePlacement, Town } from '../types';
import { LANDMARK_SPECS } from '../building-assets';
import type { LandmarkKind } from '../building-assets';
import { SpatialGrid } from './spatial';

interface StructureSite {
  half: number; towns: Town[]; fields: Field[]; roads: RoadSegment[]; obstacles: Obstacle[]; loot: LootSpot[];
  terrain: (x: number, z: number) => number;
  landOk: (x: number, z: number, margin: number) => boolean;
  riverNear: (x: number, z: number, margin: number) => boolean;
}
/** Local deterministic placement; never consumes the terrain/loot/vehicle generator's RNG. */
export function addBuildingLandmarks(site: StructureSite): StructurePlacement[] {
  const structures: StructurePlacement[] = [], occupied = new SpatialGrid<Obstacle>(32);
  const register = (o: Obstacle) => occupied.insertBox(o, o.x - o.width / 2, o.z - o.depth / 2, o.x + o.width / 2, o.z + o.depth / 2);
  site.obstacles.forEach(register);
  const roadDistance = (x: number, z: number, r: RoadSegment) => {
    const dx = r.b.x - r.a.x, dz = r.b.z - r.a.z;
    const t = Math.max(0, Math.min(1, ((x - r.a.x) * dx + (z - r.a.z) * dz) / (dx * dx + dz * dz || 1)));
    return Math.hypot(x - r.a.x - dx * t, z - r.a.z - dz * t);
  };
  const tryPlace = (kind: LandmarkKind, cx: number, cz: number, radius: number, phase: number): boolean => {
    const spec = LANDMARK_SPECS[kind], w = spec.width, d = spec.depth, clearance = Math.hypot(w, d) / 2 + 3;
    for (let attempt = 0; attempt < 48; attempt++) {
      const angle = phase + attempt * 2.399963, reach = radius * (0.65 + (attempt % 7) * 0.065);
      const x = cx + Math.cos(angle) * reach, z = cz + Math.sin(angle) * reach, base = site.terrain(x, z);
      if (Math.max(Math.abs(x) + w / 2, Math.abs(z) + d / 2) > site.half - 30 || !site.landOk(x, z, clearance) || site.riverNear(x, z, clearance)) continue;
      if (site.roads.some(r => roadDistance(x, z, r) < r.width / 2 + clearance)) continue;
      if (site.loot.some(l => Math.abs(l.x - x) < w / 2 + 3 && Math.abs(l.z - z) < d / 2 + 3)) continue;
      if ([-1, 0, 1].some(ox => [-1, 0, 1].some(oz => Math.abs(site.terrain(x + ox * w / 2, z + oz * d / 2) - base) > 0.25))) continue;
      let blocked = false;
      occupied.queryBox(x - w / 2 - 3, z - d / 2 - 3, x + w / 2 + 3, z + d / 2 + 3, o => {
        if ((o.base ?? 0) + o.height < base - 0.5) return;
        if (Math.abs(o.x - x) < (o.width + w) / 2 + 3 && Math.abs(o.z - z) < (o.depth + d) / 2 + 3) { blocked = true; return true; }
      });
      if (blocked) continue;
      const id = 'landmark-' + structures.length + '-' + kind;
      structures.push({ id, kind, x, z, base });
      spec.solids.forEach((solid, i) => {
        const o: Obstacle = { ...solid, id: id + '-solid' + i, kind: 'wall', x: x + solid.x, z: z + solid.z, base, structureId: id };
        site.obstacles.push(o); register(o);
      });
      if (kind === 'crypt') {
        const ceiling: Obstacle = { id: id + '-ceiling', structureId: id, kind: 'roof', x, z, width: 5.4, depth: 5.6, bottom: 4, height: 4.25, base };
        site.obstacles.push(ceiling); register(ceiling);
      }
      // Reserve the whole visual footprint as well as its pillars, so later props cannot overlap open frames.
      register({ id: id + '-reservation', kind: 'building', x, z, width: w, depth: d, height: spec.height, base });
      return true;
    }
    return false;
  };
  site.towns.forEach((town, i) => {
    const kinds: LandmarkKind[] = town.tier === 'city' ? ['fountain', 'scaffold', 'obelisk']
      : town.tier === 'town' ? ['waterTower', 'fountain', 'crypt'] : ['crypt', 'stoneCourt'];
    kinds.forEach((kind, k) => tryPlace(kind, town.x, town.z, town.radius * (k === 0 ? 0.75 : 0.9), i * 0.83 + k * 1.7));
  });
  site.fields.forEach((f, i) => { if (i % 3 === 0) tryPlace('waterTower', f.x, f.z, Math.max(f.w, f.d) * 0.7, i * 1.41); });
  return structures;
}
