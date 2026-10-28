// Small mutable 3D vector used by the simulation. The sim never imports Three.js,
// so it can run headless in tests and stays decoupled from the renderer.

export class Vec3 {
  constructor(public x = 0, public y = 0, public z = 0) {}

  set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  copy(v: Vec3): this {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }

  clone(): Vec3 {
    return new Vec3(this.x, this.y, this.z);
  }

  add(v: Vec3): this {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }

  sub(v: Vec3): this {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }

  scale(s: number): this {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }

  addScaled(v: Vec3, s: number): this {
    this.x += v.x * s;
    this.y += v.y * s;
    this.z += v.z * s;
    return this;
  }

  /** this = a - b */
  subVectors(a: Vec3, b: Vec3): this {
    this.x = a.x - b.x;
    this.y = a.y - b.y;
    this.z = a.z - b.z;
    return this;
  }

  dot(v: Vec3): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  /** this = this × v */
  cross(v: Vec3): this {
    const x = this.y * v.z - this.z * v.y;
    const y = this.z * v.x - this.x * v.z;
    const z = this.x * v.y - this.y * v.x;
    return this.set(x, y, z);
  }

  lenSq(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  len(): number {
    return Math.sqrt(this.lenSq());
  }

  hLen(): number {
    return Math.hypot(this.x, this.z);
  }

  distTo(v: Vec3): number {
    return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z);
  }

  normalize(): this {
    const l = this.len();
    if (l > 1e-9) this.scale(1 / l);
    return this;
  }

  setLen(l: number): this {
    return this.normalize().scale(l);
  }

  lerp(v: Vec3, t: number): this {
    this.x += (v.x - this.x) * t;
    this.y += (v.y - this.y) * t;
    this.z += (v.z - this.z) * t;
    return this;
  }

  /** this = lerp(a, b, t) */
  lerpVectors(a: Vec3, b: Vec3, t: number): this {
    this.x = a.x + (b.x - a.x) * t;
    this.y = a.y + (b.y - a.y) * t;
    this.z = a.z + (b.z - a.z) * t;
    return this;
  }

  /** Remove the component along unit vector n. */
  projectOnPlane(n: Vec3): this {
    return this.addScaled(n, -this.dot(n));
  }

  /** Copy with y zeroed. */
  horizontal(out = new Vec3()): Vec3 {
    return out.set(this.x, 0, this.z);
  }

  isFinite(): boolean {
    return Number.isFinite(this.x) && Number.isFinite(this.y) && Number.isFinite(this.z);
  }

  toArray(): [number, number, number] {
    return [this.x, this.y, this.z];
  }

  static from(a: readonly number[]): Vec3 {
    return new Vec3(a[0] ?? 0, a[1] ?? 0, a[2] ?? 0);
  }
}

export const UP: Readonly<Vec3> = Object.freeze(new Vec3(0, 1, 0));

export const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const DEG = Math.PI / 180;

/** Frame-rate independent exponential approach; `tau` is the time constant in seconds. */
export const approach = (current: number, target: number, tau: number, dt: number) =>
  tau <= 0 ? target : current + (target - current) * (1 - Math.exp(-dt / tau));

/** Shortest signed angle from a to b, in radians. */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Closest point on segment ab to p. Returns the segment parameter t in [0, 1]. */
export function closestOnSegment(a: Vec3, b: Vec3, p: Vec3, out: Vec3): number {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const lenSq = abx * abx + aby * aby + abz * abz;
  let t = lenSq > 1e-12 ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / lenSq : 0;
  t = clamp(t, 0, 1);
  out.set(a.x + abx * t, a.y + aby * t, a.z + abz * t);
  return t;
}

/**
 * Rotation matrix for Euler angles applied in Y, X, Z order (same convention as
 * Three.js Euler order 'YXZ'), so collision boxes and their meshes line up.
 * Returns the three local axes expressed in world space.
 */
export function eulerYXZAxes(xDeg: number, yDeg: number, zDeg: number): [Vec3, Vec3, Vec3] {
  const cx = Math.cos(xDeg * DEG), sx = Math.sin(xDeg * DEG);
  const cy = Math.cos(yDeg * DEG), sy = Math.sin(yDeg * DEG);
  const cz = Math.cos(zDeg * DEG), sz = Math.sin(zDeg * DEG);
  // M = Ry * Rx * Rz, row-major
  const m00 = cy * cz + sy * sx * sz, m01 = -cy * sz + sy * sx * cz, m02 = sy * cx;
  const m10 = cx * sz, m11 = cx * cz, m12 = -sx;
  const m20 = -sy * cz + cy * sx * sz, m21 = sy * sz + cy * sx * cz, m22 = cy * cx;
  return [new Vec3(m00, m10, m20), new Vec3(m01, m11, m21), new Vec3(m02, m12, m22)];
}
