import { makeTuning, type Tuning } from '../config';
import { Vec3 } from '../math/vec3';
import { CameraRig } from './camera';
import type { SimEvent, SimEventType } from './events';
import { Hook } from './grapple';
import type { InputFrame } from './input';
import { Level } from './level';
import { Player } from './player';

export const STEP = 1 / 120;

/** State captured at the start of each step so the renderer can blend the last two. */
export interface Snapshot {
  p: Vec3;
  height: number;
  camPos: Vec3;
  yaw: number;
  pitch: number;
  roll: number;
  fov: number;
}

const makeSnapshot = (): Snapshot => ({ p: new Vec3(), height: 1.8, camPos: new Vec3(), yaw: 0, pitch: 0, roll: 0, fov: 75 });

/**
 * The whole game simulation. Deterministic given its inputs, has no Three.js or DOM
 * dependency, and is stepped at a fixed 120 Hz.
 */
export class Sim {
  readonly player: Player;
  readonly hook: Hook;
  readonly cam: CameraRig;
  time = 0;
  steps = 0;
  readonly events: SimEvent[] = [];
  readonly prev = makeSnapshot();
  readonly respawnPos = new Vec3();
  respawnYaw = 0;
  checkpoint = -1;

  constructor(public level: Level, readonly T: Tuning = makeTuning()) {
    this.player = new Player(this);
    this.hook = new Hook(this);
    this.cam = new CameraRig(this);
    this.respawnPos.copy(level.spawn);
    this.respawnYaw = level.spawnYaw;
    this.respawn();
    // Attune the waystone you start on without announcing it.
    this.checkVolumes();
    this.events.length = 0;
  }

  emit(type: SimEventType, strength?: number, pos?: Vec3): void {
    this.events.push({ type, strength, pos });
  }

  step(dt: number, inp: InputFrame): void {
    this.capture(this.prev);
    this.time += dt;
    this.steps++;
    this.level.update(this.time, dt);
    if (inp.restartPressed) this.respawn();

    this.cam.look(inp, dt);
    this.hook.updateTargeting();
    this.hook.handleInput(inp, dt);
    this.player.step(dt, inp);
    this.hook.post(dt);
    this.checkVolumes();
    this.cam.update(dt);
  }

  respawn(): void {
    this.hook.detach();
    this.player.reset(this.respawnPos);
    this.player.facing = this.respawnYaw;
    this.cam.yaw = this.respawnYaw;
    this.cam.pitch = -0.12;
    this.cam.update(0);
    this.capture(this.prev);
    this.emit('respawn');
  }

  /** Swap in a reloaded level (live reload), keeping the player where they are. */
  setLevel(level: Level): void {
    this.level = level;
    this.hook.detach();
    this.hook.target = null;
    if (this.checkpoint >= level.checkpoints.length) this.checkpoint = -1;
  }

  private checkVolumes(): void {
    const p = this.player.p;
    if (p.y < (this.level.killY ?? this.T.physics.killY)) {
      this.respawn();
      return;
    }
    for (const c of this.level.checkpoints) {
      if (c.index === this.checkpoint) continue;
      if (p.x < c.min.x || p.x > c.max.x || p.y < c.min.y || p.y > c.max.y || p.z < c.min.z || p.z > c.max.z) continue;
      this.checkpoint = c.index;
      this.respawnPos.copy(c.spawn);
      this.respawnYaw = c.yaw;
      this.emit('checkpoint', 1, c.spawn.clone());
    }
  }

  private capture(s: Snapshot): void {
    s.p.copy(this.player.p);
    s.height = this.player.height;
    s.camPos.copy(this.cam.pos);
    s.yaw = this.cam.yaw;
    s.pitch = this.cam.viewPitch;
    s.roll = this.cam.roll;
    s.fov = this.cam.fov;
  }
}
