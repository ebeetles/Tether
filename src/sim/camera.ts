import { makeRayHit } from '../collision/world';
import { DEG, Vec3, angleDiff, approach, clamp } from '../math/vec3';
import type { InputFrame } from './input';
import type { Sim } from './sim';

const hit = makeRayHit();
const D = new Vec3(), S = new Vec3();
const notThin = (s: { has(tag: string): boolean }) => !s.has('thin');

/**
 * Spring-arm follow camera. It lives in the simulation because its aim drives targeting
 * and the movement basis; the renderer only interpolates it.
 */
export class CameraRig {
  yaw = 0;
  pitch = -0.12;
  /** Extra pitch toward the anchor while swinging, eased in and out. */
  bias = 0;
  roll = 0;
  fov: number;
  dist: number;
  readonly pos = new Vec3();
  readonly fwd = new Vec3(0, 0, -1);
  readonly right = new Vec3(1, 0, 0);
  readonly pivot = new Vec3();
  private sinceLook = 0;
  private dip = 0;
  private dipVel = 0;

  constructor(private readonly sim: Sim) {
    this.fov = sim.T.camera.fovMin;
    this.dist = sim.T.camera.distance;
  }

  get viewPitch(): number {
    return this.pitch + this.bias;
  }

  look(inp: InputFrame, dt: number): void {
    if (inp.lookX !== 0 || inp.lookY !== 0) {
      this.yaw -= inp.lookX;
      this.pitch = clamp(this.pitch - inp.lookY, -1.45, 1.45);
      this.sinceLook = 0;
    } else {
      this.sinceLook += dt;
    }
    // Targeting runs before update(), so aim must reflect this step's look input.
    this.updateBasis();
  }

  private updateBasis(): void {
    const vp = this.viewPitch;
    this.fwd.set(-Math.sin(this.yaw) * Math.cos(vp), Math.sin(vp), -Math.cos(this.yaw) * Math.cos(vp));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  /** Landings add a small dip, not a shake. */
  addDip(amount: number): void {
    this.dipVel -= amount;
  }

  update(dt: number): void {
    const C = this.sim.T.camera;
    const pl = this.sim.player;
    const hook = this.sim.hook;

    // Auto-recentre behind the velocity only after a while without camera input.
    if (this.sinceLook > C.recentreDelay && pl.v.hLen() > 4 && pl.state !== 'wallrun' && pl.state !== 'ledge' && !hook.attached) {
      const target = Math.atan2(-pl.v.x, -pl.v.z);
      this.yaw += angleDiff(this.yaw, target) * (1 - Math.exp(-dt * C.recentreRate));
    }

    let biasTarget = 0;
    if (hook.attached) {
      const el = Math.asin(clamp(D.subVectors(hook.anchorPos(), this.pos).normalize().y, -1, 1));
      biasTarget = clamp(el - this.pitch, 0, C.swingPitchBias * DEG) * 0.5;
    }
    this.bias = approach(this.bias, biasTarget, 0.15, dt);

    this.updateBasis();

    // Wallrun tilts the camera away from the wall.
    const rollTarget = pl.state === 'wallrun' ? -Math.sign(pl.wallNormal.dot(this.right)) * C.wallrunTilt * DEG : 0;
    this.roll = approach(this.roll, rollTarget, 0.12, dt);

    const fovTarget = C.fovMin + (C.fovMax - C.fovMin) * clamp(pl.v.len() / C.fovSpeed, 0, 1);
    this.fov = approach(this.fov, fovTarget, C.fovSmoothing / 3, dt);
    this.dist = approach(this.dist, hook.attached ? C.swingDistance : C.distance, 0.2, dt);

    // Critically damped spring for the landing dip.
    this.dipVel += (-this.dip * 120 - this.dipVel * 22) * dt;
    this.dip += this.dipVel * dt;

    const world = this.sim.level.world;
    const shoulder = S.set(pl.p.x, pl.feetY + pl.height * 0.8, pl.p.z);
    this.pivot.set(shoulder.x, shoulder.y + C.height + this.dip * 0.3, shoulder.z);
    D.subVectors(this.pivot, shoulder);
    let up = D.len();
    D.scale(1 / up);
    if (world.raycast(shoulder, D, up + 0.2, hit, notThin)) up = Math.max(0, hit.t - 0.2);
    this.pivot.copy(shoulder).addScaled(D, up);

    // Desired arm position, pulled in by collision (thin poles and wires are ignored).
    D.copy(this.pivot).addScaled(this.fwd, -this.dist).addScaled(this.right, C.side).sub(this.pivot);
    const len = D.len();
    D.scale(1 / len);
    const t = world.raycast(this.pivot, D, len + 0.25, hit, notThin) ? Math.max(0.2, hit.t - 0.25) : len;
    this.pos.copy(this.pivot).addScaled(D, t);
  }
}
