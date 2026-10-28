import { Vec3 } from '../math/vec3';
import { Contact, Shape, capsuleVsShape, makeContact } from './shapes';

export interface RayHit {
  t: number;
  point: Vec3;
  normal: Vec3;
  shape: Shape | null;
}

export const makeRayHit = (): RayHit => ({ t: 0, point: new Vec3(), normal: new Vec3(), shape: null });

export type ShapeFilter = (s: Shape) => boolean;

/**
 * All static collision shapes, bucketed in a 2D (xz) grid spatial hash. Maps are mostly
 * spread horizontally, so a column grid keeps lookups cheap without a full 3D structure.
 */
export class CollisionWorld {
  readonly shapes: Shape[] = [];
  private readonly grid = new Map<number, Shape[]>();
  private stamp = 0;
  private readonly scratch: Shape[] = [];
  private readonly contact = makeContact();
  private readonly n = new Vec3();

  constructor(readonly cellSize = 8) {}

  private key(ix: number, iz: number): number {
    return (ix + 32768) * 65536 + (iz + 32768);
  }

  add(shape: Shape): Shape {
    shape.id = this.shapes.length;
    this.shapes.push(shape);
    const cs = this.cellSize;
    const x0 = Math.floor(shape.min.x / cs), x1 = Math.floor(shape.max.x / cs);
    const z0 = Math.floor(shape.min.z / cs), z1 = Math.floor(shape.max.z / cs);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = this.key(ix, iz);
        let cell = this.grid.get(k);
        if (!cell) this.grid.set(k, (cell = []));
        cell.push(shape);
      }
    }
    return shape;
  }

  /** Shapes whose bounds overlap the box. The returned array is reused between calls. */
  queryAABB(min: Vec3, max: Vec3): Shape[] {
    const out = this.scratch;
    out.length = 0;
    const stamp = ++this.stamp;
    const cs = this.cellSize;
    const x0 = Math.floor(min.x / cs), x1 = Math.floor(max.x / cs);
    const z0 = Math.floor(min.z / cs), z1 = Math.floor(max.z / cs);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const cell = this.grid.get(this.key(ix, iz));
        if (!cell) continue;
        for (const s of cell) {
          if (s.mark === stamp) continue;
          s.mark = stamp;
          if (s.max.x < min.x || s.min.x > max.x || s.max.y < min.y || s.min.y > max.y || s.max.z < min.z || s.min.z > max.z) continue;
          out.push(s);
        }
      }
    }
    return out;
  }

  private readonly qMin = new Vec3();
  private readonly qMax = new Vec3();

  private capsuleBounds(a: Vec3, b: Vec3, r: number) {
    this.qMin.set(Math.min(a.x, b.x) - r, Math.min(a.y, b.y) - r, Math.min(a.z, b.z) - r);
    this.qMax.set(Math.max(a.x, b.x) + r, Math.max(a.y, b.y) + r, Math.max(a.z, b.z) + r);
    return this.queryAABB(this.qMin, this.qMax);
  }

  /** The single deepest contact between the capsule and the world. */
  deepestContact(a: Vec3, b: Vec3, r: number, out: Contact): boolean {
    let found = false;
    out.depth = 0;
    for (const s of this.capsuleBounds(a, b, r)) {
      if (!capsuleVsShape(a, b, r, s, this.contact)) continue;
      if (this.contact.depth > out.depth) {
        out.depth = this.contact.depth;
        out.normal.copy(this.contact.normal);
        out.point.copy(this.contact.point);
        out.shape = s;
        found = true;
      }
    }
    return found;
  }

  /** Every contact between the capsule and the world. `out` is grown as needed. */
  allContacts(a: Vec3, b: Vec3, r: number, out: Contact[]): number {
    let n = 0;
    for (const s of this.capsuleBounds(a, b, r)) {
      if (n >= out.length) out.push(makeContact());
      if (capsuleVsShape(a, b, r, s, out[n])) n++;
    }
    return n;
  }

  overlapsCapsule(a: Vec3, b: Vec3, r: number): boolean {
    for (const s of this.capsuleBounds(a, b, r)) {
      if (capsuleVsShape(a, b, r, s, this.contact) && this.contact.depth > 1e-3) return true;
    }
    return false;
  }

  /**
   * Nearest hit along a ray. Walks the grid with a 2D DDA, so long grapple rays only
   * test shapes in the cells they actually pass through.
   */
  raycast(o: Vec3, d: Vec3, maxT: number, out: RayHit, filter?: ShapeFilter): boolean {
    const cs = this.cellSize;
    let ix = Math.floor(o.x / cs), iz = Math.floor(o.z / cs);
    const stepX = d.x > 0 ? 1 : d.x < 0 ? -1 : 0;
    const stepZ = d.z > 0 ? 1 : d.z < 0 ? -1 : 0;
    const tDeltaX = stepX !== 0 ? Math.abs(cs / d.x) : Infinity;
    const tDeltaZ = stepZ !== 0 ? Math.abs(cs / d.z) : Infinity;
    let tMaxX = stepX > 0 ? ((ix + 1) * cs - o.x) / d.x : stepX < 0 ? (ix * cs - o.x) / d.x : Infinity;
    let tMaxZ = stepZ > 0 ? ((iz + 1) * cs - o.z) / d.z : stepZ < 0 ? (iz * cs - o.z) / d.z : Infinity;
    const stamp = ++this.stamp;
    let best = maxT, hit = false;

    for (let guard = 0; guard < 4096; guard++) {
      const cell = this.grid.get(this.key(ix, iz));
      if (cell) {
        for (const s of cell) {
          if (s.mark === stamp) continue;
          s.mark = stamp;
          if (filter && !filter(s)) continue;
          const t = s.raycast(o, d, best, this.n);
          if (t >= 0 && t <= best) {
            best = t;
            hit = true;
            out.normal.copy(this.n);
            out.shape = s;
          }
        }
      }
      const tExit = Math.min(tMaxX, tMaxZ);
      if (tExit >= best || tExit > maxT) break;
      if (tMaxX < tMaxZ) { ix += stepX; tMaxX += tDeltaX; }
      else { iz += stepZ; tMaxZ += tDeltaZ; }
    }
    if (hit) {
      out.t = best;
      out.point.copy(o).addScaled(d, best);
    }
    return hit;
  }
}
