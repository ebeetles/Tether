import { makeContact, type Contact } from '../collision/shapes';
import { makeRayHit } from '../collision/world';
import { DEG, Vec3, angleDiff, clamp, lerp } from '../math/vec3';
import type { InputFrame } from './input';
import type { Sim } from './sim';

/**
 * One movement state machine. Every state shares the same position and velocity, which
 * is why momentum carries across every transition (spec: Core movement).
 */
export type MoveState =
  | 'ground' | 'slide' | 'stumble'
  | 'air' | 'wallrun' | 'climb'
  | 'ledge' | 'mantle' | 'vault';

const GROUNDED: ReadonlySet<MoveState> = new Set<MoveState>(['ground', 'slide', 'stumble']);

// Scratch vectors (the sim is single-threaded and non-reentrant).
const A = new Vec3(), B = new Vec3(), H = new Vec3(), T1 = new Vec3(), T2 = new Vec3();
const hit = makeRayHit(), hit2 = makeRayHit();
const contact = makeContact();
const contacts: Contact[] = [];

export class Player {
  readonly p = new Vec3();
  readonly v = new Vec3();
  state: MoveState = 'air';
  stateTime = 0;
  height: number;
  /** Yaw the body faces, for rendering. */
  facing = 0;

  /** World-space horizontal wish direction from the stick, magnitude ≤ 1. */
  readonly wish = new Vec3();
  sprinting = false;
  private fullStickTime = 0;

  readonly groundNormal = new Vec3(0, 1, 0);
  readonly wallNormal = new Vec3(1, 0, 0);
  sinceGround = 99;
  sinceWall = 99;
  private jumpAge = 99;
  private crouchAge = 99;
  private jumpedSinceGround = false;
  private jumpRising = false;
  private jumpStartY = 0;
  /** Highest point since last touching something that resets fall height. */
  peakY = 0;

  private wallCooldown = 0;
  private readonly lastWallJumpNormal = new Vec3();
  private climbUsed = false;
  private climbStartY = 0;

  readonly ledgeDir = new Vec3();
  private readonly mantleFrom = new Vec3();
  private readonly mantleTo = new Vec3();
  private storedSpeed = 0;
  private ledgeCooldown = 0;

  private vaultTargetY = 0;
  private vaultLift = 0;
  private readonly vaultVel = new Vec3();

  private slideCooldown = 0;

  // Contact summary for the current step.
  hitGround = false;
  hitWall = false;
  hitCeiling = false;
  readonly hitWallNormal = new Vec3();
  /** Velocity before this step's collisions; transitions read intent from it. */
  readonly vPre = new Vec3();

  constructor(private readonly sim: Sim) {
    this.height = sim.T.capsule.height;
  }

  get grounded(): boolean {
    return GROUNDED.has(this.state);
  }

  get feetY(): number {
    return this.p.y - this.height / 2;
  }

  get handY(): number {
    return this.p.y + this.height / 2;
  }

  get crouched(): boolean {
    return this.height < this.sim.T.capsule.height - 1e-6;
  }

  setState(s: MoveState): void {
    if (s === this.state) return;
    this.state = s;
    this.stateTime = 0;
  }

  reset(feet: Vec3): void {
    this.height = this.sim.T.capsule.height;
    this.p.set(feet.x, feet.y + this.height / 2 + 0.01, feet.z);
    this.v.set(0, 0, 0);
    this.state = 'air';
    this.stateTime = 0;
    this.peakY = this.p.y;
    this.jumpAge = this.crouchAge = 99;
    this.jumpRising = false;
    this.jumpedSinceGround = true;
    this.sinceGround = 99;
  }

  // ---------------------------------------------------------------- step

  step(dt: number, inp: InputFrame): void {
    const T = this.sim.T;
    this.stateTime += dt;
    this.jumpAge = inp.jumpPressed ? 0 : this.jumpAge + dt;
    this.crouchAge = inp.crouchPressed ? 0 : this.crouchAge + dt;
    this.sinceGround = this.grounded ? 0 : this.sinceGround + dt;
    this.sinceWall += dt;
    this.wallCooldown -= dt;
    this.ledgeCooldown -= dt;
    this.slideCooldown -= dt;
    this.computeWish(inp);
    this.fullStickTime = inp.analog && this.wish.len() > 0.95 ? this.fullStickTime + dt : 0;
    this.sprinting = inp.sprint || this.fullStickTime >= T.run.sprintStickTime;
    this.hitGround = this.hitWall = this.hitCeiling = false;

    let physical = true;
    switch (this.state) {
      case 'ground':
      case 'stumble': this.updateGround(dt, inp); break;
      case 'slide': this.updateSlide(dt, inp); break;
      case 'air': this.updateAir(dt, inp); break;
      case 'wallrun': this.updateWallrun(dt, inp); break;
      case 'climb': this.updateClimb(inp); break;
      case 'vault': this.updateVault(); break;
      case 'ledge': physical = this.updateLedge(inp); break;
      case 'mantle': physical = this.updateMantle(); break;
    }

    if (physical) {
      this.applySoftCap(dt);
      this.vPre.copy(this.v);
      this.moveAndCollide(dt);
      if (this.sim.hook.constrain(dt, inp)) this.resolve();
      this.postMove(inp);
    }

    if (this.v.hLen() > 0.5 && this.state !== 'ledge') this.facing = Math.atan2(-this.v.x, -this.v.z);
    else if (this.state === 'ledge') this.facing = Math.atan2(-this.ledgeDir.x, -this.ledgeDir.z);
  }

  private computeWish(inp: InputFrame): void {
    const yaw = this.sim.cam.yaw;
    let mx = inp.moveX, my = inp.moveY;
    const m = Math.hypot(mx, my);
    if (m > 1) { mx /= m; my /= m; }
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    this.wish.set(fx * my + rx * mx, 0, fz * my + rz * mx);
  }

  // ---------------------------------------------------------------- states

  private updateGround(dt: number, inp: InputFrame): void {
    const T = this.sim.T;
    const stumbling = this.state === 'stumble';
    if (stumbling && this.stateTime >= T.landing.stumbleTime) this.setState('ground');

    if (!stumbling) {
      if (this.jumpAge <= T.jump.bufferTime) { this.doJump(); return; }
      if (inp.crouchPressed && this.v.hLen() >= T.slide.minSpeed) { this.enterSlide(); return; }
      if (this.tryVaultOrStep(dt)) return;
    }

    this.setCrouch(inp.crouch && !stumbling);
    const cap = this.crouched ? T.run.crouchSpeed : this.sprinting ? T.run.sprintSpeed : T.run.speed;
    this.groundAccel(dt, cap, stumbling ? null : this.wish);
    this.alignToGround();
  }

  /** Accelerate toward the wish velocity; above the cap, bleed speed slowly instead of snapping. */
  private groundAccel(dt: number, cap: number, wish: Vec3 | null): void {
    const T = this.sim.T;
    const h = H.set(this.v.x, 0, this.v.z);
    const speed = h.len();
    const wl = wish ? wish.len() : 0;
    if (wish && wl > 0.01) {
      if (speed <= cap + 1e-6) {
        moveTowards(h, T1.copy(wish).scale(cap), T.run.accel * dt);
      } else if (h.dot(wish) / (speed * wl) < -0.3) {
        // Pushing against travel brakes at full ground accel.
        moveTowards(h, T1.copy(wish).scale(cap), T.run.accel * dt);
      } else {
        // Over speed: steer with the same lateral grip as ground accel, decay the excess.
        const newSpeed = Math.max(cap, speed - T.run.overSpeedDecay * dt);
        rotateTowards(h, wish, (T.run.accel / speed) * dt);
        h.setLen(newSpeed);
      }
    } else if (speed > cap) {
      h.setLen(Math.max(cap, speed - T.run.overSpeedDecay * dt));
    } else {
      moveTowards(h, T1.set(0, 0, 0), T.run.accel * dt);
    }
    this.v.x = h.x;
    this.v.z = h.z;
  }

  /** Keep velocity tangent to the ground so slopes are walked, not bounced on. */
  private alignToGround(): void {
    const n = this.groundNormal;
    this.v.y = -(n.x * this.v.x + n.z * this.v.z) / Math.max(n.y, 0.1);
  }

  private doJump(): void {
    const T = this.sim.T;
    this.setCrouch(false);
    this.v.y = Math.max(this.v.y, 0) + Math.sqrt(2 * T.physics.gravity * T.jump.fullHeight);
    this.jumpStartY = this.p.y;
    this.jumpRising = true;
    this.jumpedSinceGround = true;
    this.jumpAge = 99;
    this.peakY = this.p.y;
    this.setState('air');
    this.sim.emit('jump');
  }

  private updateAir(dt: number, inp: InputFrame): void {
    const T = this.sim.T;
    const hook = this.sim.hook;
    if (hook.zipping) { hook.zipVelocity(this.v); return; }

    if (this.jumpAge <= T.jump.bufferTime) {
      if (!this.jumpedSinceGround && this.sinceGround <= T.jump.coyoteTime) this.doJump();
      else if (this.sinceWall <= T.wallrun.wallJumpGrace && !hook.attached) this.wallJump(this.wallNormal);
    }

    if (this.jumpRising) {
      if (this.v.y <= 0) this.jumpRising = false;
      else if (!inp.jump) {
        // Early release cuts the jump so the total height is at least the tap height.
        const remaining = Math.max(0, T.jump.tapHeight - (this.p.y - this.jumpStartY));
        this.v.y = Math.min(this.v.y, Math.sqrt(2 * T.physics.gravity * remaining));
        this.jumpRising = false;
      }
    }

    this.v.y -= T.physics.gravity * dt;
    if (hook.attached) hook.steer(this.v, this.p, this.wish, dt);
    else this.airControl(dt);
    this.setCrouch(false);
    if (this.p.y > this.peakY) this.peakY = this.p.y;
  }

  /** Steers without adding speed past the current horizontal speed. */
  private airControl(dt: number): void {
    const T = this.sim.T;
    if (this.wish.len() < 0.01) return;
    const h = H.set(this.v.x, 0, this.v.z);
    const limit = Math.max(h.len(), T.air.minControlSpeed);
    h.addScaled(this.wish, T.run.accel * T.air.controlFraction * dt);
    if (h.len() > limit) h.setLen(limit);
    this.v.x = h.x;
    this.v.z = h.z;
  }

  private wallJump(n: Vec3): void {
    const T = this.sim.T;
    const along = H.set(this.v.x, 0, this.v.z).projectOnPlane(n);
    this.v.set(along.x + n.x * T.wallJump.offWall, Math.max(this.v.y, T.wallJump.up), along.z + n.z * T.wallJump.offWall);
    this.lastWallJumpNormal.copy(n);
    this.wallCooldown = T.wallrun.sameWallCooldown;
    this.jumpAge = 99;
    this.jumpRising = false;
    this.sinceWall = 99;
    this.climbUsed = false;
    this.peakY = this.p.y;
    this.setState('air');
    this.sim.emit('wallJump');
  }

  private updateWallrun(dt: number, inp: InputFrame): void {
    const T = this.sim.T;
    const n = this.wallNormal;
    if (this.jumpAge <= T.jump.bufferTime) { this.wallJump(n); return; }
    if (inp.crouchPressed || !this.probeWall(n)) {
      this.v.addScaled(n, 2);
      this.setState('air');
      return;
    }
    const t = clamp(this.stateTime / T.wallrun.maxTime, 0, 1);
    this.v.y -= T.physics.gravity * lerp(T.wallrun.gravityStart, T.wallrun.gravityEnd, t) * dt;

    // Run along the wall, keeping horizontal speed; input can bring it up to run speed.
    const h = H.set(this.v.x, 0, this.v.z);
    let speed = h.len();
    h.projectOnPlane(n);
    if (h.len() > 1e-3) {
      if (speed < T.run.speed && this.wish.dot(T1.copy(h).normalize()) > 0.3) speed = Math.min(T.run.speed, speed + T.run.accel * T.air.controlFraction * dt);
      h.setLen(speed);
    }
    if (this.stateTime > T.wallrun.maxTime || speed < T.wallrun.exitSpeed) {
      this.v.set(h.x + n.x, this.v.y, h.z + n.z);
      this.setState('air');
      return;
    }
    // Press gently into the wall so contact is kept; the collision response removes it.
    this.v.set(h.x - n.x * 1.5, this.v.y, h.z - n.z * 1.5);
  }

  private updateClimb(inp: InputFrame): void {
    const T = this.sim.T;
    const n = this.wallNormal;
    if (this.jumpAge <= T.jump.bufferTime) { this.wallJump(n); return; }
    if (this.tryLedgeGrab(T2.copy(n).scale(-1))) return;
    if (!this.probeWall(n) || this.p.y - this.climbStartY >= T.wallClimb.maxHeight || inp.crouchPressed) {
      this.v.y = Math.min(this.v.y, 1);
      this.setState('air');
      return;
    }
    this.v.set(-n.x, T.wallClimb.speed, -n.z);
  }

  private updateLedge(inp: InputFrame): boolean {
    const T = this.sim.T;
    this.v.set(0, 0, 0);
    if (this.jumpAge <= T.jump.bufferTime) {
      this.jumpAge = 99;
      this.mantleFrom.copy(this.p);
      this.setState('mantle');
      this.sim.emit('mantle');
      return false;
    }
    if (inp.crouchPressed || inp.moveY < -0.5) {
      this.v.copy(this.ledgeDir).scale(-1.5);
      this.ledgeCooldown = T.ledge.regrabCooldown;
      this.peakY = this.p.y;
      this.setState('air');
      return true;
    }
    return false;
  }

  private updateMantle(): boolean {
    const T = this.sim.T;
    const u = clamp(this.stateTime / T.ledge.mantleTime, 0, 1);
    const rise = smooth(clamp(u / 0.6, 0, 1));
    const fwd = smooth(clamp((u - 0.4) / 0.6, 0, 1));
    this.p.set(
      lerp(this.mantleFrom.x, this.mantleTo.x, fwd),
      lerp(this.mantleFrom.y, this.mantleTo.y, rise),
      lerp(this.mantleFrom.z, this.mantleTo.z, fwd),
    );
    if (u >= 1) {
      // Mantles redirect the speed carried into the grab rather than losing it.
      const speed = Math.max(this.storedSpeed, 3);
      this.v.set(this.ledgeDir.x * speed, 0, this.ledgeDir.z * speed);
      this.groundNormal.set(0, 1, 0);
      this.jumpedSinceGround = false;
      this.setState('ground');
    }
    return false;
  }

  private tryVaultOrStep(dt: number): boolean {
    const T = this.sim.T;
    const r = T.capsule.radius;
    const hs = this.v.hLen();
    if (hs < 1) return false;
    const dir = T2.set(this.v.x / hs, 0, this.v.z / hs);
    if (this.wish.dot(dir) < 0.3) return false;

    const feet = this.feetY;
    const probe = r + Math.max(0.25, hs * T.vault.liftTime * 1.2);
    A.set(this.p.x, feet + 0.1, this.p.z);
    // Any face that isn't walkable-ish counts, including the undercut lip of a ramp.
    if (!this.sim.level.world.raycast(A, dir, probe, hit) || hit.normal.y > 0.35) return false;

    // Find the top of the obstacle just beyond the face we hit.
    const inX = -hit.normal.x, inZ = -hit.normal.z;
    const inLen = Math.hypot(inX, inZ) || 1;
    const top = T.vault.maxHeight + 0.4;
    B.set(hit.point.x + (inX / inLen) * 0.25, feet + top, hit.point.z + (inZ / inLen) * 0.25);
    if (!this.sim.level.world.raycast(B, T1.set(0, -1, 0), top - 0.05, hit2)) return false;
    if (hit2.normal.y < this.minGroundY) return false;
    const h = hit2.point.y - feet;

    if (h <= T.capsule.stepHeight) {
      // Small step: only climb it once we're about to touch it.
      if (hit.t - r > hs * dt * 2 + 0.05) return false;
      const newY = hit2.point.y + this.height / 2 + 0.01;
      if (this.overlapsAt(this.p.x, newY, this.p.z, this.height)) return false;
      this.p.y = newY;
      return false;
    }
    if (h > T.vault.maxHeight + 0.05) return false;
    const targetY = hit2.point.y + this.height / 2 + 0.05;
    if (this.overlapsAt(hit2.point.x, targetY, hit2.point.z, this.height)) return false;
    this.vaultVel.set(this.v.x, 0, this.v.z);
    this.vaultTargetY = targetY;
    this.vaultLift = (targetY - this.p.y) / T.vault.liftTime;
    this.setState('vault');
    this.sim.emit('vault');
    return true;
  }

  private updateVault(): void {
    this.v.set(this.vaultVel.x, this.vaultLift, this.vaultVel.z);
  }

  private enterSlide(): void {
    const T = this.sim.T;
    this.setCrouch(true);
    if (this.slideCooldown <= 0) {
      const h = H.set(this.v.x, 0, this.v.z);
      h.setLen(h.len() + T.slide.entryBoost);
      this.v.x = h.x;
      this.v.z = h.z;
      this.slideCooldown = T.slide.boostCooldown;
    }
    this.setState('slide');
    this.sim.emit('slide');
  }

  private updateSlide(dt: number, inp: InputFrame): void {
    const T = this.sim.T;
    if (this.jumpAge <= T.jump.bufferTime) { this.doJump(); return; }
    if (!inp.crouch && this.setCrouch(false)) { this.setState('ground'); this.alignToGround(); return; }

    const n = this.groundNormal;
    const g = T.physics.gravity;
    // Gravity along the slope: gains speed downhill, nothing on flat ground.
    this.v.x += g * n.y * n.x * dt;
    this.v.y += (-g + g * n.y * n.y) * dt;
    this.v.z += g * n.y * n.z * dt;
    this.v.projectOnPlane(n);
    const s = Math.max(0, this.v.len() - T.slide.friction * dt);
    this.v.setLen(s);
    if (this.wish.len() > 0.1) {
      const h = H.set(this.v.x, 0, this.v.z);
      const hl = h.len();
      rotateTowards(h, this.wish, T.slide.turnRate * dt);
      h.setLen(hl);
      this.v.x = h.x;
      this.v.z = h.z;
    }
    if (s < T.slide.exitSpeed) this.setState('ground');
  }

  /** Change capsule height keeping the feet in place. Returns false if there is no room to stand. */
  setCrouch(want: boolean): boolean {
    const C = this.sim.T.capsule;
    const target = want ? C.crouchHeight : C.height;
    if (Math.abs(this.height - target) < 1e-6) return true;
    const newY = this.p.y + (target - this.height) / 2;
    if (!want && this.overlapsAt(this.p.x, newY, this.p.z, target)) return false;
    this.p.y = newY;
    this.height = target;
    return true;
  }

  // ---------------------------------------------------------------- after the move

  private postMove(inp: InputFrame): void {
    const T = this.sim.T;
    const hook = this.sim.hook;
    switch (this.state) {
      case 'ground':
      case 'slide':
      case 'stumble': {
        const snap = hook.attached && hook.taut ? 0.05 : T.capsule.groundSnap;
        if (!this.probeGround(snap)) {
          this.jumpedSinceGround = false;
          this.jumpRising = false;
          this.peakY = this.p.y;
          this.setState('air');
        } else if (this.state !== 'slide') {
          this.alignToGround();
        }
        break;
      }
      case 'vault':
        this.v.x = this.vaultVel.x;
        this.v.z = this.vaultVel.z;
        if (this.p.y >= this.vaultTargetY - 0.01) {
          this.v.y = 0;
          this.peakY = this.p.y;
          this.jumpedSinceGround = true;
          this.setState('air');
        }
        break;
      case 'air':
      case 'wallrun':
      case 'climb':
        if (this.hitGround && this.vPre.y <= 0.5) { this.land(inp); break; }
        if (this.state !== 'air' || hook.zipping) break;
        if (this.hitWall) this.tryWallEntry();
        if (this.state === 'air' && !hook.attached && this.v.y <= 0.5 && this.ledgeCooldown <= 0) {
          const dir = this.wish.len() > 0.3 ? T2.copy(this.wish).normalize()
            : this.vPre.hLen() > 1 ? this.vPre.horizontal(T2).normalize() : null;
          if (dir) this.tryLedgeGrab(dir);
        }
        break;
    }
  }

  private land(inp: InputFrame): void {
    const T = this.sim.T;
    const fall = this.peakY - this.p.y;
    const rolled = inp.crouch || this.crouchAge <= T.landing.rollWindow;
    const hs = this.v.hLen();
    this.jumpedSinceGround = false;
    this.jumpRising = false;
    this.climbUsed = false;
    this.sinceGround = 0;

    if (fall > T.landing.hardFallHeight && !rolled) {
      if (hs > T.run.speed) {
        this.v.x *= T.run.speed / hs;
        this.v.z *= T.run.speed / hs;
      }
      this.setState('stumble');
      this.alignToGround();
      this.sim.emit('hardLand', 1);
      this.sim.cam.addDip(3);
      return;
    }
    if (fall > T.landing.hardFallHeight) this.sim.emit('roll');
    else this.sim.emit('land', clamp(-this.vPre.y / 15, 0, 1));
    this.sim.cam.addDip(clamp(-this.vPre.y / 8, 0, 1.5));

    if (inp.crouch && hs >= T.slide.minSpeed) {
      this.enterSlide();
      return;
    }
    this.setState('ground');
    this.alignToGround();
    if (this.jumpAge <= T.jump.bufferTime) this.doJump();
  }

  private tryWallEntry(): void {
    const T = this.sim.T;
    const n = this.hitWallNormal;
    const h = this.vPre.horizontal(H);
    const speed = h.len();
    if (speed < 0.5) return;
    if (this.wallCooldown > 0 && n.dot(this.lastWallJumpNormal) > 0.7) return;
    const into = -h.dot(n) / speed; // 1 = straight into the wall
    if (into >= Math.cos(T.wallClimb.headOnAngle * DEG)) {
      if (!this.climbUsed && !this.sim.hook.attached && this.wish.dot(T1.copy(n).scale(-1)) > 0.5 && this.vPre.y > -4) {
        this.climbUsed = true;
        this.climbStartY = this.p.y;
        this.wallNormal.copy(n);
        this.v.set(-n.x, T.wallClimb.speed, -n.z);
        this.setState('climb');
        this.sim.emit('climb');
      }
      return;
    }
    const angleFromWall = Math.asin(clamp(Math.abs(into), 0, 1)) / DEG;
    if (speed < T.wallrun.minSpeed || angleFromWall >= T.wallrun.maxAngle || into < -0.05) return;

    // Redirect the full horizontal speed along the wall.
    h.projectOnPlane(n).setLen(speed);
    this.v.set(h.x, clamp(this.vPre.y, -1, 6), h.z);
    this.wallNormal.copy(n);
    if (this.sim.hook.attached) this.sim.hook.detach();
    this.climbUsed = false;
    this.peakY = this.p.y;
    this.setState('wallrun');
    this.sim.emit('wallrun');
  }

  private tryLedgeGrab(dir: Vec3): boolean {
    const T = this.sim.T;
    const r = T.capsule.radius;
    const world = this.sim.level.world;
    const handY = this.handY;
    A.set(this.p.x, handY - 0.05, this.p.z);
    if (!world.raycast(A, dir, r + 0.45, hit) || Math.abs(hit.normal.y) > 0.35) return false;
    const wn = T1.set(hit.normal.x, 0, hit.normal.z).normalize();
    B.set(hit.point.x - wn.x * 0.3, handY + 0.6, hit.point.z - wn.z * 0.3);
    if (!world.raycast(B, H.set(0, -1, 0), 0.7 + T.ledge.grabWindow, hit2)) return false;
    if (hit2.normal.y < this.minGroundY) return false;
    const topY = hit2.point.y;
    if (topY < handY - T.ledge.grabWindow || topY > handY + 0.3) return false;

    const fullH = T.capsule.height;
    const standX = hit.point.x - wn.x * (r + 0.2), standZ = hit.point.z - wn.z * (r + 0.2);
    const standY = topY + fullH / 2 + 0.05;
    if (this.overlapsAt(standX, standY, standZ, fullH)) return false;

    this.storedSpeed = this.vPre.hLen();
    this.setCrouch(false);
    this.p.set(hit.point.x + wn.x * (r + 0.01), topY - this.height / 2, hit.point.z + wn.z * (r + 0.01));
    this.ledgeDir.set(-wn.x, 0, -wn.z);
    this.mantleTo.set(standX, standY, standZ);
    this.v.set(0, 0, 0);
    this.peakY = this.p.y;
    this.setState('ledge');
    this.sim.emit('grab');
    return true;
  }

  // ---------------------------------------------------------------- collision

  get minGroundY(): number {
    return Math.cos(this.sim.T.capsule.maxSlope * DEG);
  }

  private segment(x: number, y: number, z: number, height: number): void {
    const half = height / 2 - this.sim.T.capsule.radius;
    A.set(x, y - half, z);
    B.set(x, y + half, z);
  }

  private overlapsAt(x: number, y: number, z: number, height: number): boolean {
    this.segment(x, y, z, height);
    return this.sim.level.world.overlapsCapsule(A, B, this.sim.T.capsule.radius);
  }

  /** Move in substeps short enough that the capsule can never pass through thin walls. */
  private moveAndCollide(dt: number): void {
    const steps = Math.max(1, Math.ceil((this.v.len() * dt) / this.sim.T.physics.maxSubstepMove));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.p.addScaled(this.v, h);
      this.resolve();
    }
  }

  /** Push out of the deepest contact until free, removing velocity into each surface. */
  resolve(): void {
    const T = this.sim.T;
    const hook = this.sim.hook;
    const minGround = this.minGroundY;
    for (let i = 0; i < 6; i++) {
      this.segment(this.p.x, this.p.y, this.p.z, this.height);
      if (!this.sim.level.world.deepestContact(A, B, T.capsule.radius, contact)) break;
      const n = contact.normal;
      this.p.addScaled(n, contact.depth + 1e-4);
      let wall = false;
      if (n.y >= minGround) {
        this.hitGround = true;
        this.groundNormal.copy(n);
      } else if (n.y < -0.5) {
        this.hitCeiling = true;
      } else if (Math.abs(n.y) < 0.35) {
        wall = true;
        this.hitWall = true;
        this.hitWallNormal.set(n.x, 0, n.z).normalize();
        this.wallNormal.copy(this.hitWallNormal);
        this.sinceWall = 0;
      }
      const vn = this.v.dot(n);
      if (vn < 0) {
        // A swinging player bounces off walls a little instead of sticking.
        const e = wall && hook.attached && hook.taut ? T.swing.wallBounce : 0;
        this.v.addScaled(n, -(1 + e) * vn);
      }
    }
  }

  /** Look for walkable ground within `snap` below the feet and settle onto it. */
  private probeGround(snap: number): boolean {
    const r = this.sim.T.capsule.radius;
    this.segment(this.p.x, this.p.y - snap, this.p.z, this.height);
    const n = this.sim.level.world.allContacts(A, B, r, contacts);
    const minGround = this.minGroundY;
    let best: Contact | null = null;
    for (let i = 0; i < n; i++) {
      const c = contacts[i];
      if (c.normal.y >= minGround && (!best || c.depth > best.depth)) best = c;
    }
    if (!best) return false;
    const newY = this.p.y - snap + best.depth / best.normal.y;
    if (newY < this.p.y) this.p.y = newY + 1e-4;
    this.groundNormal.copy(best.normal);
    return true;
  }

  /** Re-find the wall we're running on; follows curved walls by updating the normal. */
  private probeWall(n: Vec3): boolean {
    const dir = T1.copy(n).scale(-1);
    if (!this.sim.level.world.raycast(this.p, dir, this.sim.T.capsule.radius + 0.4, hit)) return false;
    if (Math.abs(hit.normal.y) > 0.35) return false;
    this.wallNormal.set(hit.normal.x, 0, hit.normal.z).normalize();
    return true;
  }

  private applySoftCap(dt: number): void {
    const T = this.sim.T.physics;
    const s = this.v.len();
    if (s > T.softCap) this.v.setLen(s - (s - T.softCap) * T.softCapDrag * dt);
  }
}

function moveTowards(v: Vec3, target: Vec3, maxStep: number): void {
  const dx = target.x - v.x, dy = target.y - v.y, dz = target.z - v.z;
  const d = Math.hypot(dx, dy, dz);
  if (d <= maxStep || d < 1e-9) v.copy(target);
  else v.set(v.x + (dx / d) * maxStep, v.y + (dy / d) * maxStep, v.z + (dz / d) * maxStep);
}

/** Rotate horizontal vector `h` toward direction `to` by at most `maxAngle` radians, keeping its length. */
function rotateTowards(h: Vec3, to: Vec3, maxAngle: number): void {
  const len = h.hLen();
  if (len < 1e-6 || to.hLen() < 1e-6) return;
  const a = Math.atan2(h.z, h.x);
  const d = angleDiff(a, Math.atan2(to.z, to.x));
  const na = a + clamp(d, -maxAngle, maxAngle);
  h.set(Math.cos(na) * len, 0, Math.sin(na) * len);
}

const smooth = (t: number) => t * t * (3 - 2 * t);
