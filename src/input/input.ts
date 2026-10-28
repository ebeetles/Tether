import { emptyInput, type InputFrame } from '../sim/input';
import type { Tuning } from '../config';

export type Action = 'forward' | 'back' | 'left' | 'right' | 'jump' | 'fire' | 'reelIn' | 'reelOut' | 'crouch' | 'sprint' | 'restart';

/** Keyboard codes (KeyboardEvent.code) and mouse buttons ("Mouse0"). All remappable. */
export const DEFAULT_BINDINGS: Record<Action, string[]> = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  fire: ['Mouse0'],
  reelIn: ['KeyE'],
  reelOut: ['KeyQ'],
  // Left Ctrl per the spec; C as well because Ctrl+W closes the tab on Windows/Linux.
  crouch: ['ControlLeft', 'KeyC'],
  sprint: ['ShiftLeft'],
  restart: ['KeyR'],
};

// Standard gamepad mapping.
const PAD = { A: 0, B: 1, LB: 4, RB: 5, RT: 7, BACK: 8, L3: 10 } as const;
const DEADZONE = 0.15;

/**
 * Collects keyboard/mouse (Pointer Lock) and gamepad state and turns it into one
 * InputFrame per fixed sim step. Press/release edges are latched until sampled.
 */
export class InputSource {
  bindings: Record<Action, string[]> = structuredClone(DEFAULT_BINDINGS);
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly released = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  private padPrev: boolean[] = [];
  private padPressed = new Set<number>();
  private padReleased = new Set<number>();
  private padSprint = false;
  /** Playing without pointer lock (the browser refused it): plain mouse movement aims. */
  unlockedPlay = false;

  constructor(private readonly target: HTMLElement, private readonly T: Tuning) {
    const isField = (e: Event) => e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
    window.addEventListener('keydown', (e) => {
      if (isField(e)) return;
      if (this.active || this.bound(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.press(e.code);
    });
    window.addEventListener('keyup', (e) => this.release(e.code));
    target.addEventListener('mousedown', (e) => {
      if (!this.active) return;
      this.press(`Mouse${e.button}`);
    });
    window.addEventListener('mouseup', (e) => this.release(`Mouse${e.button}`));
    window.addEventListener('mousemove', (e) => {
      if (!this.active) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener('blur', () => {
      for (const c of [...this.down]) this.release(c);
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get locked(): boolean {
    return document.pointerLockElement === this.target;
  }

  /** True while the game has the player's input (overlay closed). */
  get active(): boolean {
    return this.locked || this.unlockedPlay;
  }

  private bound(code: string): boolean {
    return Object.values(this.bindings).some((b) => b.includes(code));
  }

  private press(code: string) {
    if (this.down.has(code)) return;
    this.down.add(code);
    this.pressed.add(code);
  }

  private release(code: string) {
    if (!this.down.has(code)) return;
    this.down.delete(code);
    this.released.add(code);
  }

  private held(a: Action) { return this.bindings[a].some((c) => this.down.has(c)); }
  private wasPressed(a: Action) { return this.bindings[a].some((c) => this.pressed.has(c)); }
  private wasReleased(a: Action) { return this.bindings[a].some((c) => this.released.has(c)); }

  private pollPad(): Gamepad | null {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = [...pads].find((p): p is Gamepad => !!p && p.connected) ?? null;
    if (!pad) return null;
    pad.buttons.forEach((b, i) => {
      const now = b.value > 0.5;
      if (now && !this.padPrev[i]) this.padPressed.add(i);
      if (!now && this.padPrev[i]) this.padReleased.add(i);
      this.padPrev[i] = now;
    });
    return pad;
  }

  /** Build the input for one sim step of length `dt` and clear latched edges. */
  sample(dt: number): InputFrame {
    const f = emptyInput();
    const pad = this.pollPad();
    const C = this.T.camera;

    let mx = (this.held('right') ? 1 : 0) - (this.held('left') ? 1 : 0);
    let my = (this.held('forward') ? 1 : 0) - (this.held('back') ? 1 : 0);
    const kl = Math.hypot(mx, my);
    if (kl > 1) { mx /= kl; my /= kl; }
    f.moveX = mx;
    f.moveY = my;
    f.lookX = this.mouseDX * C.mouseSensitivity;
    f.lookY = this.mouseDY * C.mouseSensitivity;
    this.mouseDX = this.mouseDY = 0;

    f.jump = this.held('jump');
    f.jumpPressed = this.wasPressed('jump');
    f.fire = this.held('fire');
    f.firePressed = this.wasPressed('fire');
    f.fireReleased = this.wasReleased('fire');
    f.reelIn = this.held('reelIn');
    f.reelOut = this.held('reelOut');
    f.crouch = this.held('crouch');
    f.crouchPressed = this.wasPressed('crouch');
    f.sprint = this.held('sprint');
    f.restartPressed = this.wasPressed('restart');

    if (pad) {
      const ax = (i: number) => pad.axes[i] ?? 0;
      const lx = ax(0), ly = -ax(1);
      const lm = Math.hypot(lx, ly);
      if (lm > DEADZONE) {
        const s = Math.min(1, (lm - DEADZONE) / (1 - DEADZONE)) / lm;
        f.moveX = lx * s;
        f.moveY = ly * s;
        f.analog = true;
      }
      const rx = ax(2), ry = ax(3);
      if (Math.hypot(rx, ry) > DEADZONE) {
        f.lookX += rx * C.padSensitivity * dt;
        f.lookY += ry * C.padSensitivity * dt;
      }
      const btn = (i: number) => (pad.buttons[i]?.value ?? 0) > 0.5;
      if (this.padPressed.has(PAD.L3)) this.padSprint = !this.padSprint;
      if (f.analog && Math.hypot(f.moveX, f.moveY) < 0.2) this.padSprint = false;
      f.jump ||= btn(PAD.A);
      f.jumpPressed ||= this.padPressed.has(PAD.A);
      f.fire ||= btn(PAD.RT);
      f.firePressed ||= this.padPressed.has(PAD.RT);
      f.fireReleased ||= this.padReleased.has(PAD.RT);
      f.reelIn ||= btn(PAD.RB);
      f.reelOut ||= btn(PAD.LB);
      f.crouch ||= btn(PAD.B);
      f.crouchPressed ||= this.padPressed.has(PAD.B);
      f.sprint ||= this.padSprint;
      f.restartPressed ||= this.padPressed.has(PAD.BACK);
    }

    this.pressed.clear();
    this.released.clear();
    this.padPressed.clear();
    this.padReleased.clear();
    return f;
  }
}
