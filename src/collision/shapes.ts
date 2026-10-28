import { Vec3, closestOnSegment, eulerYXZAxes } from '../math/vec3';

/**
 * Level geometry is built only from primitives (spec: "Building levels from primitives
 * instead of arbitrary meshes is the key simplification"). Each primitive answers two
 * questions exactly: closest point to a point, and ray intersection.
 */
export abstract class Shape {
  id = -1;
  /** Scratch stamp used by the spatial hash to dedupe shapes spanning several cells. */
  mark = 0;
  readonly tags: Set<string>;
  readonly min = new Vec3();
  readonly max = new Vec3();

  constructor(tags: Iterable<string> = []) {
    this.tags = new Set(tags);
  }

  has(tag: string): boolean {
    return this.tags.has(tag);
  }

  /** Writes the closest point on the shape's surface to `out`. Returns true if `p` is inside. */
  abstract closestPoint(p: Vec3, out: Vec3): boolean;

  /**
   * Ray from `o` along unit `d`. Returns the hit distance in [0, maxT] and writes the
   * surface normal, or returns -1. Rays starting inside the shape do not hit it.
   */
  abstract raycast(o: Vec3, d: Vec3, maxT: number, outNormal: Vec3): number;
}

/** Oriented box. Ramps are boxes with a pitch. */
export class Box extends Shape {
  readonly c: Vec3;
  readonly h: Vec3;
  readonly axes: [Vec3, Vec3, Vec3];
  readonly rot: [number, number, number];

  constructor(center: Vec3, size: Vec3, rotDeg: [number, number, number] = [0, 0, 0], tags: Iterable<string> = []) {
    super(tags);
    this.c = center.clone();
    this.h = size.clone().scale(0.5);
    this.rot = rotDeg;
    this.axes = eulerYXZAxes(rotDeg[0], rotDeg[1], rotDeg[2]);
    const [ax, ay, az] = this.axes;
    const ex = Math.abs(ax.x) * this.h.x + Math.abs(ay.x) * this.h.y + Math.abs(az.x) * this.h.z;
    const ey = Math.abs(ax.y) * this.h.x + Math.abs(ay.y) * this.h.y + Math.abs(az.y) * this.h.z;
    const ez = Math.abs(ax.z) * this.h.x + Math.abs(ay.z) * this.h.y + Math.abs(az.z) * this.h.z;
    this.min.set(this.c.x - ex, this.c.y - ey, this.c.z - ez);
    this.max.set(this.c.x + ex, this.c.y + ey, this.c.z + ez);
  }

  closestPoint(p: Vec3, out: Vec3): boolean {
    const [ax, ay, az] = this.axes;
    const dx = p.x - this.c.x, dy = p.y - this.c.y, dz = p.z - this.c.z;
    const l = [dx * ax.x + dy * ax.y + dz * ax.z, dx * ay.x + dy * ay.y + dz * ay.z, dx * az.x + dy * az.y + dz * az.z];
    const h = [this.h.x, this.h.y, this.h.z];
    const inside = Math.abs(l[0]) < h[0] && Math.abs(l[1]) < h[1] && Math.abs(l[2]) < h[2];
    if (inside) {
      // Push to the nearest face.
      let best = 0, bestGap = Infinity;
      for (let i = 0; i < 3; i++) {
        const gap = h[i] - Math.abs(l[i]);
        if (gap < bestGap) { bestGap = gap; best = i; }
      }
      l[best] = l[best] >= 0 ? h[best] : -h[best];
    } else {
      for (let i = 0; i < 3; i++) l[i] = Math.max(-h[i], Math.min(h[i], l[i]));
    }
    out.set(
      this.c.x + ax.x * l[0] + ay.x * l[1] + az.x * l[2],
      this.c.y + ax.y * l[0] + ay.y * l[1] + az.y * l[2],
      this.c.z + ax.z * l[0] + ay.z * l[1] + az.z * l[2],
    );
    return inside;
  }

  raycast(o: Vec3, d: Vec3, maxT: number, outNormal: Vec3): number {
    const axes = this.axes;
    const ox = o.x - this.c.x, oy = o.y - this.c.y, oz = o.z - this.c.z;
    const h = [this.h.x, this.h.y, this.h.z];
    let tMin = -Infinity, tMax = maxT, hitAxis = -1, hitSign = 1;
    for (let i = 0; i < 3; i++) {
      const a = axes[i];
      const ol = ox * a.x + oy * a.y + oz * a.z;
      const dl = d.x * a.x + d.y * a.y + d.z * a.z;
      if (Math.abs(dl) < 1e-12) {
        if (ol < -h[i] || ol > h[i]) return -1;
        continue;
      }
      let t1 = (-h[i] - ol) / dl, t2 = (h[i] - ol) / dl;
      let sign = -1; // entering through the -h face
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; sign = 1; }
      if (t1 > tMin) { tMin = t1; hitAxis = i; hitSign = sign; }
      if (t2 < tMax) tMax = t2;
      if (tMin > tMax) return -1;
    }
    if (hitAxis < 0 || tMin < 0 || tMin > maxT) return -1;
    outNormal.copy(axes[hitAxis]).scale(hitSign);
    return tMin;
  }
}

/** Vertical (y-axis) cylinder: posts, trunks, pipes. */
export class Cylinder extends Shape {
  readonly c: Vec3;
  readonly r: number;
  readonly hh: number;

  constructor(center: Vec3, radius: number, height: number, tags: Iterable<string> = []) {
    super(tags);
    this.c = center.clone();
    this.r = radius;
    this.hh = height / 2;
    this.min.set(this.c.x - radius, this.c.y - this.hh, this.c.z - radius);
    this.max.set(this.c.x + radius, this.c.y + this.hh, this.c.z + radius);
  }

  closestPoint(p: Vec3, out: Vec3): boolean {
    const dx = p.x - this.c.x, dy = p.y - this.c.y, dz = p.z - this.c.z;
    const rl = Math.hypot(dx, dz);
    const inside = rl < this.r && Math.abs(dy) < this.hh;
    let rx = dx, rz = dz, y = dy;
    if (inside) {
      const sideGap = this.r - rl;
      const capGap = this.hh - Math.abs(dy);
      if (sideGap < capGap) {
        if (rl > 1e-9) { rx = (dx / rl) * this.r; rz = (dz / rl) * this.r; }
        else { rx = this.r; rz = 0; }
      } else {
        y = dy >= 0 ? this.hh : -this.hh;
      }
    } else {
      if (rl > this.r) { rx = (dx / rl) * this.r; rz = (dz / rl) * this.r; }
      y = Math.max(-this.hh, Math.min(this.hh, dy));
    }
    out.set(this.c.x + rx, this.c.y + y, this.c.z + rz);
    return inside;
  }

  raycast(o: Vec3, d: Vec3, maxT: number, outNormal: Vec3): number {
    const ox = o.x - this.c.x, oy = o.y - this.c.y, oz = o.z - this.c.z;
    const r2 = this.r * this.r;
    if (ox * ox + oz * oz < r2 && Math.abs(oy) < this.hh) return -1;
    let best = Infinity;
    const a = d.x * d.x + d.z * d.z;
    if (a > 1e-12) {
      const b = 2 * (ox * d.x + oz * d.z);
      const c = ox * ox + oz * oz - r2;
      const disc = b * b - 4 * a * c;
      if (disc >= 0) {
        const t = (-b - Math.sqrt(disc)) / (2 * a);
        if (t >= 0 && t <= maxT && Math.abs(oy + t * d.y) <= this.hh) {
          best = t;
          outNormal.set((ox + t * d.x) / this.r, 0, (oz + t * d.z) / this.r);
        }
      }
    }
    if (Math.abs(d.y) > 1e-12) {
      const capY = d.y < 0 ? this.hh : -this.hh; // only the cap facing the ray can be entered
      const t = (capY - oy) / d.y;
      if (t >= 0 && t < best && t <= maxT) {
        const x = ox + t * d.x, z = oz + t * d.z;
        if (x * x + z * z <= r2) {
          best = t;
          outNormal.set(0, Math.sign(capY), 0);
        }
      }
    }
    return best === Infinity ? -1 : best;
  }
}

export interface Contact {
  normal: Vec3;
  depth: number;
  point: Vec3;
  shape: Shape | null;
}

export const makeContact = (): Contact => ({ normal: new Vec3(), depth: 0, point: new Vec3(), shape: null });

const _s = new Vec3();
const _q = new Vec3();

/**
 * Capsule (segment a→b with radius r) against a convex primitive. Alternates between
 * "closest point on shape to segment point" and "closest point on segment to shape
 * point", which converges for convex shapes in a few iterations.
 */
export function capsuleVsShape(a: Vec3, b: Vec3, r: number, shape: Shape, out: Contact): boolean {
  _s.copy(a).add(b).scale(0.5);
  for (let i = 0; i < 4; i++) {
    shape.closestPoint(_s, _q);
    closestOnSegment(a, b, _q, _s);
  }
  const inside = shape.closestPoint(_s, _q);
  const dx = _s.x - _q.x, dy = _s.y - _q.y, dz = _s.z - _q.z;
  const dist = Math.hypot(dx, dy, dz);
  if (inside) {
    if (dist < 1e-9) out.normal.set(0, 1, 0);
    else out.normal.set(-dx / dist, -dy / dist, -dz / dist);
    out.depth = dist + r;
  } else {
    if (dist >= r) return false;
    if (dist < 1e-9) out.normal.set(0, 1, 0);
    else out.normal.set(dx / dist, dy / dist, dz / dist);
    out.depth = r - dist;
  }
  out.point.copy(_q);
  out.shape = shape;
  return true;
}
