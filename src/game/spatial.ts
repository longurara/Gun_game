/**
 * Uniform grid over the XZ plane. Boxes are stored in every cell they overlap, points in one cell.
 * Queries visit each item at most once per call and never allocate.
 */
export class SpatialGrid<T> {
  private readonly cells = new Map<number, number[]>();
  private items: T[] = [];
  private stamps = new Uint32Array(64);
  private stamp = 0;

  constructor(public readonly cell: number) {}

  get size(): number { return this.items.length; }

  clear(): void {
    this.cells.clear();
    this.items.length = 0;
  }

  private key(cx: number, cz: number): number { return (cx + 32768) * 65536 + (cz + 32768); }

  private add(index: number, cx: number, cz: number): void {
    const key = this.key(cx, cz);
    const bucket = this.cells.get(key);
    if (bucket) bucket.push(index); else this.cells.set(key, [index]);
  }

  private register(item: T): number {
    const index = this.items.length;
    this.items.push(item);
    if (index >= this.stamps.length) {
      const grown = new Uint32Array(this.stamps.length * 2);
      grown.set(this.stamps);
      this.stamps = grown;
    }
    return index;
  }

  insertPoint(item: T, x: number, z: number): void {
    this.add(this.register(item), Math.floor(x / this.cell), Math.floor(z / this.cell));
  }

  insertBox(item: T, minX: number, minZ: number, maxX: number, maxZ: number): void {
    const index = this.register(item);
    const x0 = Math.floor(minX / this.cell), x1 = Math.floor(maxX / this.cell);
    const z0 = Math.floor(minZ / this.cell), z1 = Math.floor(maxZ / this.cell);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) this.add(index, cx, cz);
  }

  private nextStamp(): number {
    this.stamp++;
    if (this.stamp >= 0xfffffff0) { this.stamps.fill(0); this.stamp = 1; }
    return this.stamp;
  }

  /** Visit items whose cells overlap the box. Return true from `visit` to stop early. */
  queryBox(minX: number, minZ: number, maxX: number, maxZ: number, visit: (item: T) => boolean | void): void {
    const stamp = this.nextStamp();
    const x0 = Math.floor(minX / this.cell), x1 = Math.floor(maxX / this.cell);
    const z0 = Math.floor(minZ / this.cell), z1 = Math.floor(maxZ / this.cell);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const bucket = this.cells.get(this.key(cx, cz));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const index = bucket[i];
          if (this.stamps[index] === stamp) continue;
          this.stamps[index] = stamp;
          if (visit(this.items[index]) === true) return;
        }
      }
    }
  }

  queryCircle(x: number, z: number, radius: number, visit: (item: T) => boolean | void): void {
    this.queryBox(x - radius, z - radius, x + radius, z + radius, visit);
  }

  /**
   * Visit items in every cell crossed by the segment (Amanatides–Woo traversal), nearest cells first.
   * `visit` may return true to stop early, which lets ray casts quit once a nearer hit is certain.
   */
  querySegment(x0: number, z0: number, x1: number, z1: number, visit: (item: T) => boolean | void): void {
    const stamp = this.nextStamp();
    const c = this.cell;
    let cx = Math.floor(x0 / c), cz = Math.floor(z0 / c);
    const endX = Math.floor(x1 / c), endZ = Math.floor(z1 / c);
    const dx = x1 - x0, dz = z1 - z0;
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(c / dx) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(c / dz) : Infinity;
    let tMaxX = dx !== 0 ? ((dx > 0 ? (cx + 1) * c - x0 : x0 - cx * c) / Math.abs(dx)) : Infinity;
    let tMaxZ = dz !== 0 ? ((dz > 0 ? (cz + 1) * c - z0 : z0 - cz * c) / Math.abs(dz)) : Infinity;
    const limit = Math.abs(endX - cx) + Math.abs(endZ - cz) + 2;
    for (let n = 0; n < limit; n++) {
      const bucket = this.cells.get(this.key(cx, cz));
      if (bucket) {
        for (let i = 0; i < bucket.length; i++) {
          const index = bucket[i];
          if (this.stamps[index] === stamp) continue;
          this.stamps[index] = stamp;
          if (visit(this.items[index]) === true) return;
        }
      }
      if (cx === endX && cz === endZ) return;
      if (tMaxX < tMaxZ) { cx += stepX; tMaxX += tDeltaX; } else { cz += stepZ; tMaxZ += tDeltaZ; }
    }
  }
}
