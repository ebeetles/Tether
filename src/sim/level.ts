import { Box, Cylinder, Shape } from '../collision/shapes';
import { CollisionWorld } from '../collision/world';
import { DEG, Vec3 } from '../math/vec3';

// Maps are JSON lists of primitives, anchors and checkpoints (spec: Tech stack › Levels).

type V3 = [number, number, number];

export type PrimitiveData =
  | { type: 'box'; pos: V3; size: V3; rot?: V3; tags?: string[]; color?: string }
  | { type: 'cylinder'; pos: V3; radius: number; height: number; tags?: string[]; color?: string };

export type MotionData =
  /** Swings about `pivot` in a vertical plane; `pos` is the rest position below the pivot. */
  | { type: 'pendulum'; pivot: V3; amplitude: number; period: number; yaw?: number }
  /** Eases back and forth between `pos` and `to`. */
  | { type: 'linear'; to: V3; period: number }
  /** Circles `center` at the radius given by `pos`. */
  | { type: 'circle'; center: V3; period: number };

export interface AnchorData {
  pos: V3;
  motion?: MotionData;
  /** Render a support cable this many metres straight up from the anchor. */
  cable?: number;
}

export interface CheckpointData {
  pos: V3;
  size: V3;
  yaw?: number;
}

export interface LevelData {
  name: string;
  spawn: { pos: V3; yaw?: number };
  killY?: number;
  primitives: PrimitiveData[];
  anchors: AnchorData[];
  checkpoints?: CheckpointData[];
}

export class Anchor {
  readonly pos: Vec3;
  readonly prevPos: Vec3;
  readonly vel = new Vec3();
  private readonly tmp = new Vec3();

  constructor(readonly id: number, readonly data: AnchorData) {
    this.pos = Vec3.from(data.pos);
    this.prevPos = this.pos.clone();
  }

  get moving(): boolean {
    return !!this.data.motion;
  }

  update(time: number, dt: number): void {
    this.prevPos.copy(this.pos);
    if (!this.data.motion) return;
    this.evaluate(time, this.pos);
    this.evaluate(time - dt, this.tmp);
    this.vel.subVectors(this.pos, this.tmp).scale(1 / dt);
  }

  evaluate(time: number, out: Vec3): Vec3 {
    const m = this.data.motion;
    const base = this.data.pos;
    if (!m) return out.set(base[0], base[1], base[2]);
    const phase = (time / m.period) * Math.PI * 2;
    switch (m.type) {
      case 'pendulum': {
        const [px, py, pz] = m.pivot;
        const len = Math.hypot(base[0] - px, base[1] - py, base[2] - pz);
        const theta = m.amplitude * DEG * Math.sin(phase);
        const yaw = (m.yaw ?? 0) * DEG;
        const sx = Math.sin(yaw), sz = Math.cos(yaw);
        return out.set(px + sx * Math.sin(theta) * len, py - Math.cos(theta) * len, pz + sz * Math.sin(theta) * len);
      }
      case 'linear': {
        const s = 0.5 - 0.5 * Math.cos(phase);
        return out.set(
          base[0] + (m.to[0] - base[0]) * s,
          base[1] + (m.to[1] - base[1]) * s,
          base[2] + (m.to[2] - base[2]) * s,
        );
      }
      case 'circle': {
        const [cx, , cz] = m.center;
        const dx = base[0] - cx, dz = base[2] - cz;
        const r = Math.hypot(dx, dz);
        const a0 = Math.atan2(dz, dx);
        return out.set(cx + Math.cos(a0 + phase) * r, base[1], cz + Math.sin(a0 + phase) * r);
      }
    }
  }
}

export interface Checkpoint {
  index: number;
  min: Vec3;
  max: Vec3;
  /** Respawn point: feet position at the bottom centre of the volume. */
  spawn: Vec3;
  yaw: number;
}

export function makePrimitive(p: PrimitiveData): Shape {
  if (p.type === 'box') return new Box(Vec3.from(p.pos), Vec3.from(p.size), p.rot ?? [0, 0, 0], p.tags ?? []);
  return new Cylinder(Vec3.from(p.pos), p.radius, p.height, p.tags ?? []);
}

export class Level {
  readonly world = new CollisionWorld();
  readonly anchors: Anchor[];
  readonly checkpoints: Checkpoint[];
  readonly spawn: Vec3;
  readonly spawnYaw: number;
  readonly killY: number | undefined;

  constructor(readonly data: LevelData) {
    for (const p of data.primitives) this.world.add(makePrimitive(p));
    this.anchors = data.anchors.map((a, i) => new Anchor(i, a));
    this.spawn = Vec3.from(data.spawn.pos);
    this.spawnYaw = (data.spawn.yaw ?? 0) * DEG;
    this.killY = data.killY;
    this.checkpoints = (data.checkpoints ?? []).map((c, i) => {
      const pos = Vec3.from(c.pos), half = Vec3.from(c.size).scale(0.5);
      return {
        index: i,
        min: pos.clone().sub(half),
        max: pos.clone().add(half),
        spawn: new Vec3(pos.x, pos.y - half.y, pos.z),
        yaw: (c.yaw ?? 0) * DEG,
      };
    });
  }

  update(time: number, dt: number): void {
    for (const a of this.anchors) a.update(time, dt);
  }
}
