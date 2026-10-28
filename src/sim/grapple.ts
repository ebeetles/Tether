import { makeRayHit } from '../collision/world';
import { DEG, Vec3, clamp } from '../math/vec3';
import type { InputFrame } from './input';
import type { Anchor } from './level';
import type { Sim } from './sim';

const hit = makeRayHit();
const T1 = new Vec3(), T2 = new Vec3(), N = new Vec3(), REL = new Vec3(), VA = new Vec3();
const ZERO: Readonly<Vec3> = Object.freeze(new Vec3());

/**
 * One hook, held as an inextensible rope: a one-way distance constraint solved by
 * projection every fixed step (spec: Grappling hook, Swing physics).
 */
export class Hook {
  attached = false;
  zipping = false;
  /** Attached anchor, or null when attached to a grapple surface at `point`. */
  anchor: Anchor | null = null;
  readonly point = new Vec3();
  /** Rope length. */
  L = 0;
  taut = false;
  /** Time since the rope was last taut. */
  tautAge = 99;

  private smoothing = 0;
  private clearanceTarget = -1;
  private clearanceRate = 0;
  private blockedTime = 0;
  private groundTime = 0;
  private bottomAge = 99;
  private refSpeed = 0;
  private prevVy = 0;
  private zipTime = 0;
  private zipMaxTime = 0;
  private sinceRelease = 99;
  private lastAnchor: Anchor | null = null;
  private readonly lastPoint = new Vec3();
  private hasLast = false;

  /** Best anchor this step — what the hook hits if fired now. */
  target: Anchor | null = null;
  /** When no anchor qualifies: a grapple surface under the aim ray. */
  hasSurface = false;
  readonly surfacePoint = new Vec3();

  constructor(private readonly sim: Sim) {}

  anchorPos(): Vec3 {
    return this.anchor ? this.anchor.pos : this.point;
  }

  private anchorVel(): Readonly<Vec3> {
    return this.anchor ? this.anchor.vel : ZERO;
  }

  /** Where the rope leaves the player's body. */
  hand(out: Vec3): Vec3 {
    const pl = this.sim.player;
    return out.set(pl.p.x, pl.p.y + pl.height / 2 - 0.25, pl.p.z);
  }

  // ---------------------------------------------------------------- targeting

  updateTargeting(): void {
    const T = this.sim.T;
    const cam = this.sim.cam;
    const pl = this.sim.player;
    const range = T.hook.range;
    const cone = T.hook.coneAngle * DEG;
    const cosCone = Math.cos(cone);
    const hand = this.hand(T1);
    const speed = pl.v.len();
    let best: Anchor | null = null;
    let bestScore = -Infinity;

    for (const a of this.sim.level.anchors) {
      const toA = T2.subVectors(a.pos, hand);
      const dist = toA.len();
      if (dist > range || dist < 1) continue;
      const camTo = N.subVectors(a.pos, cam.pos).normalize();
      const c = camTo.dot(cam.fwd);
      if (c < cosCone) continue;
      // Closeness to screen centre is the biggest weight.
      let score = T.targeting.centreWeight * (1 - Math.acos(Math.min(1, c)) / cone);
      toA.scale(1 / dist);
      if (speed > 2) score += T.assists.anchorAheadWeight * Math.max(0, toA.dot(pl.v) / speed);
      score += T.targeting.heightWeight * clamp((a.pos.y - pl.p.y) / 10, -1, 1);
      if (score <= bestScore) continue;
      if (!this.lineOfSight(hand, a.pos)) continue;
      best = a;
      bestScore = score;
    }
    this.target = best;

    // Nothing qualifies: the hook flies along the aim ray onto a grapple surface, or whiffs.
    this.hasSurface = false;
    if (!best) {
      const maxT = range + cam.pos.distTo(hand) + 1;
      if (this.sim.level.world.raycast(cam.pos, cam.fwd, maxT, hit) && hit.shape && this.canGrapple(hit.shape.tags, hit.normal)) {
        const p = T2.copy(hit.point).addScaled(hit.normal, 0.05);
        if (p.distTo(hand) <= range && this.lineOfSight(hand, p)) {
          this.hasSurface = true;
          this.surfacePoint.copy(p);
        }
      }
    }
  }

  /** Grapple surfaces: tagged undersides and sides — never tops (the ground), glass or no-grapple. */
  private canGrapple(tags: Set<string>, normal: Vec3): boolean {
    return tags.has('grappleable') && !tags.has('no-grapple') && !tags.has('glass') && normal.y < 0.3;
  }

  private lineOfSight(from: Vec3, to: Vec3): boolean {
    const dir = N.subVectors(to, from);
    const dist = dir.len();
    if (dist < 0.4) return true;
    dir.scale(1 / dist);
    return !this.sim.level.world.raycast(from, dir, dist - 0.3, hit);
  }

  // ---------------------------------------------------------------- input

  handleInput(inp: InputFrame, dt: number): void {
    const T = this.sim.T;
    this.sinceRelease += dt;
    let fire = false;
    let release = false;
    if (T.hook.toggleMode) {
      if (inp.firePressed) {
        if (this.attached) release = true;
        else fire = true;
      }
    } else {
      if (inp.firePressed && !this.attached) fire = true;
      else if (this.attached && !inp.fire && !this.zipping) release = true;
    }

    if (release) this.release(true);
    if (fire) {
      // Fire again right after a release: zip to the same anchor.
      if (T.hook.zipEnabled && this.hasLast && this.sinceRelease <= T.hook.zipWindow) {
        this.attachTo(this.lastAnchor, this.lastPoint);
        if (this.attached) this.startZip();
      } else if (this.target) {
        this.attachTo(this.target, null);
      } else if (this.hasSurface) {
        this.attachTo(null, this.surfacePoint);
      } else {
        const cam = this.sim.cam;
        this.sim.emit('whiff', 1, cam.pos.clone().addScaled(cam.fwd, T.hook.range + cam.dist));
      }
    }
  }

  attachTo(anchor: Anchor | null, point: Vec3 | null): void {
    const T = this.sim.T;
    const pl = this.sim.player;
    this.anchor = anchor;
    if (!anchor && point) this.point.copy(point);
    const a = this.anchorPos();
    const d = T1.subVectors(pl.p, a);
    const dist = d.len();
    this.attached = true;
    this.zipping = false;
    this.L = Math.max(dist, T.hook.minLength);
    this.taut = false;
    this.tautAge = 99;
    this.blockedTime = 0;
    this.groundTime = 0;
    this.bottomAge = 99;
    this.prevVy = pl.v.y;
    this.refSpeed = Math.max(pl.v.len(), T.swing.pumpFloorSpeed);

    // Attach smoothing: blend a yank of more than the threshold angle over a short time.
    this.smoothing = 0;
    if (T.assists.attachSmoothing && dist >= this.L - 1e-3 && dist > 1e-3) {
      N.copy(d).scale(1 / dist);
      const rel = REL.subVectors(pl.v, this.anchorVel());
      const vn = rel.dot(N);
      if (vn > 0) {
        const after = T2.copy(rel).addScaled(N, -vn);
        const s = rel.len(), sa = after.len();
        const angle = sa < 1e-3 ? 90 : Math.acos(clamp(rel.dot(after) / (s * sa), -1, 1)) / DEG;
        if (angle > T.assists.attachSmoothAngle) this.smoothing = T.assists.attachSmoothTime;
      }
    }

    // Ground clearance: shorten the rope so the bottom of the arc clears the ground.
    this.clearanceTarget = -1;
    if (T.assists.groundClearance) {
      const down = T2.set(0, -1, 0);
      if (this.sim.level.world.raycast(a, down, this.L + pl.height + T.assists.groundClearanceHeight + 2, hit)) {
        const target = a.y - hit.point.y - T.assists.groundClearanceHeight - pl.height / 2;
        if (target < this.L) {
          this.clearanceTarget = Math.max(target, T.hook.minLength);
          this.clearanceRate = (this.L - this.clearanceTarget) / Math.max(T.assists.groundClearanceTime, 1e-3);
        }
      }
    }

    if (pl.state === 'wallrun' || pl.state === 'climb' || pl.state === 'ledge' || pl.state === 'mantle' || pl.state === 'vault') {
      pl.setState('air');
    }
    pl.peakY = pl.p.y;
    this.sim.emit('fire');
    this.sim.emit('attach', 1, a.clone());
  }

  private startZip(): void {
    const pl = this.sim.player;
    this.zipping = true;
    this.zipTime = 0;
    this.zipMaxTime = pl.p.distTo(this.anchorPos()) / this.sim.T.hook.zipSpeed + 0.5;
    pl.setState('air');
    this.sim.emit('zip');
  }

  zipVelocity(v: Vec3): void {
    const dir = T1.subVectors(this.anchorPos(), this.sim.player.p).normalize();
    v.copy(this.anchorVel()).addScaled(dir, this.sim.T.hook.zipSpeed);
  }

  /** Let go on purpose: keeps all velocity, plus the release assists. */
  release(assists: boolean): void {
    if (!this.attached) return;
    const T = this.sim.T;
    const pl = this.sim.player;
    if (assists && !this.zipping) {
      const s = pl.v.len();
      if (T.assists.releaseBoost && this.tautAge < 0.1 && this.bottomAge <= T.assists.releaseBoostWindow && pl.v.y > 0 && s > 1e-3) {
        const boost = Math.min(s * T.assists.releaseBoostFraction, T.assists.releaseBoostMax);
        pl.v.addScaled(pl.v, boost / s);
        this.sim.emit('boost', boost / T.assists.releaseBoostMax);
      }
      if (T.assists.releaseLift && this.tautAge < 0.15) pl.v.y += T.assists.releaseLiftSpeed;
    }
    this.lastAnchor = this.anchor;
    this.lastPoint.copy(this.point);
    this.hasLast = true;
    this.sinceRelease = 0;
    this.clear();
    pl.peakY = pl.p.y;
    this.sim.emit('release');
  }

  /** Drop the rope with no assists and no zip follow-up (cut, wallrun entry, respawn). */
  detach(): void {
    if (!this.attached) return;
    this.hasLast = false;
    this.clear();
    this.sim.emit('release');
  }

  private clear(): void {
    this.attached = false;
    this.zipping = false;
    this.taut = false;
    this.anchor = null;
    this.smoothing = 0;
    this.clearanceTarget = -1;
  }

  // ---------------------------------------------------------------- physics

  /**
   * Stick input projected onto the plane tangent to the rope: widens, narrows or curves
   * the arc. Pushing along the travel direction pumps, capped per swing.
   */
  steer(v: Vec3, p: Vec3, wish: Vec3, dt: number): void {
    const T = this.sim.T;
    const n = N.subVectors(p, this.anchorPos()).normalize();
    const a = T1.copy(wish).addScaled(n, -wish.dot(n)).scale(T.swing.steerAccel);
    const s = v.len();
    if (s > 1e-3) {
      const along = a.dot(v) / s;
      if (along > 0 && s > this.refSpeed * (1 + T.swing.pumpCap)) a.addScaled(v, -along / s);
    }
    v.addScaled(a, dt);
  }

  /**
   * Reel, then the rope itself: if the player is farther than L, snap them back onto the
   * sphere and remove only the outward part of the velocity relative to the anchor.
   * Returns true if the player was moved (so collisions need resolving again).
   */
  constrain(dt: number, inp: InputFrame): boolean {
    if (!this.attached || this.zipping) return false;
    const T = this.sim.T;
    const pl = this.sim.player;
    const p = pl.p, v = pl.v;

    if (inp.reelIn) {
      const before = this.L;
      this.L = Math.max(T.hook.minLength, this.L - T.hook.reelIn * dt);
      this.clearanceTarget = -1;
      if (this.taut && this.L < before) this.spinUp(before / this.L);
    } else if (inp.reelOut) {
      this.L = Math.min(T.hook.range, this.L + T.hook.reelOut * dt);
    }
    if (this.clearanceTarget > 0) {
      this.L = Math.max(this.clearanceTarget, this.L - this.clearanceRate * dt);
      if (this.L <= this.clearanceTarget) this.clearanceTarget = -1;
    }

    const a = this.anchorPos();
    const va = VA.copy(this.anchorVel());
    const d = N.subVectors(p, a);
    const dist = d.len();
    const n = dist > 1e-6 ? d.scale(1 / dist) : d.set(0, -1, 0);
    let moved = false;
    let tautNow = dist > this.L - 0.02;
    let outward = 0;

    if (this.smoothing > 0) this.smoothing -= dt;
    if (dist > this.L) {
      const rel = REL.subVectors(v, va);
      const vn = rel.dot(n);
      if (this.smoothing > 0) {
        // Rope pays out while the turn blends in.
        const frac = this.smoothing / T.assists.attachSmoothTime;
        this.L = dist;
        if (vn > 0) rel.addScaled(n, -vn * (1 - frac));
      } else {
        p.copy(a).addScaled(n, this.L);
        if (vn > 0) rel.addScaled(n, -vn);
        moved = true;
      }
      v.copy(va).add(rel);
      outward = Math.max(vn, 0);
      tautNow = true;
    }

    if (tautNow && !this.taut && outward > 1.5) this.sim.emit('taut', clamp(outward / 12, 0.2, 1));
    this.taut = tautNow;
    this.tautAge = tautNow ? 0 : this.tautAge + dt;

    // Bottom of the arc: vertical velocity crosses from falling to rising below the anchor.
    this.bottomAge += dt;
    const relVy = v.y - va.y;
    if (this.taut && n.y < -0.5 && this.prevVy < 0 && relVy >= 0) {
      this.bottomAge = 0;
      this.refSpeed = Math.max(v.len(), T.swing.pumpFloorSpeed);
    }
    this.prevVy = relVy;
    pl.peakY = p.y;
    return moved;
  }

  /**
   * Reeling in on a taut rope pulls against the swing, so the tangential speed grows like a
   * skater pulling their arms in. `reelMomentum` = 1 conserves angular momentum exactly;
   * 0 keeps tangential speed unchanged.
   */
  private spinUp(ratio: number): void {
    const pl = this.sim.player;
    const n = T1.subVectors(pl.p, this.anchorPos()).normalize();
    const rel = REL.subVectors(pl.v, this.anchorVel());
    const vn = rel.dot(n);
    rel.addScaled(n, -vn).scale(Math.pow(ratio, this.sim.T.swing.reelMomentum)).addScaled(n, vn);
    pl.v.copy(this.anchorVel()).add(rel);
  }

  /** Per-step checks after the player moved: zip arrival, rope cut, ground auto-release. */
  post(dt: number): void {
    if (!this.attached) return;
    const T = this.sim.T;
    const pl = this.sim.player;
    const a = this.anchorPos();

    if (this.zipping) {
      this.zipTime += dt;
      if (pl.p.distTo(a) < 1.6 || this.zipTime > this.zipMaxTime) {
        // Pop up over the anchor.
        const dir = T1.subVectors(a, pl.p).horizontal(T1);
        if (dir.len() < 0.1) pl.v.horizontal(dir);
        dir.normalize();
        const va = this.anchorVel();
        pl.v.set(va.x + dir.x * T.hook.zipPopForward, va.y + T.hook.zipPopUp, va.z + dir.z * T.hook.zipPopForward);
        this.hasLast = false;
        this.clear();
        pl.peakY = pl.p.y;
        this.sim.emit('zipPop');
      }
      return;
    }

    // The rope cuts if it passes through level geometry for too long.
    this.blockedTime = this.lineOfSight(this.hand(T2), a) ? 0 : this.blockedTime + dt;
    if (this.blockedTime > T.hook.cutTime) {
      this.detach();
      this.sim.emit('cut');
      return;
    }

    // Touching the ground with the rope taut: keep running, then auto-release.
    this.groundTime = pl.grounded && this.taut ? this.groundTime + dt : 0;
    if (this.groundTime > T.hook.groundReleaseTime) this.detach();
  }
}
