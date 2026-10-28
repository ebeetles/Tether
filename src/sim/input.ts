/**
 * One fixed step's worth of player input. Produced by the browser input layer (or by
 * tests / ghost playback), consumed by the simulation. Edges (`*Pressed`) are latched
 * until a sim step consumes them, so a tap shorter than one step is never lost.
 */
export interface InputFrame {
  /** Stick / WASD, x = right, y = forward; magnitude ≤ 1. */
  moveX: number;
  moveY: number;
  /** True when movement came from an analog stick (enables full-stick sprint). */
  analog: boolean;
  /** Camera rotation to apply this step, in radians. */
  lookX: number;
  lookY: number;
  jump: boolean;
  jumpPressed: boolean;
  fire: boolean;
  firePressed: boolean;
  fireReleased: boolean;
  reelIn: boolean;
  reelOut: boolean;
  crouch: boolean;
  crouchPressed: boolean;
  sprint: boolean;
  restartPressed: boolean;
}

export function emptyInput(): InputFrame {
  return {
    moveX: 0, moveY: 0, analog: false, lookX: 0, lookY: 0,
    jump: false, jumpPressed: false,
    fire: false, firePressed: false, fireReleased: false,
    reelIn: false, reelOut: false,
    crouch: false, crouchPressed: false,
    sprint: false, restartPressed: false,
  };
}
