// Every tunable number from the design spec, grouped the way the debug panel shows them.
// Values are the spec's starting values ("tune in playtests").

export const DEFAULT_TUNING = {
  physics: {
    gravity: 9.81,
    /** Soft speed cap: drag is added above this speed (m/s). */
    softCap: 35,
    softCapDrag: 2,
    /** Max distance moved per collision substep (m); keeps fast movement from tunnelling. */
    maxSubstepMove: 0.2,
    killY: -40,
  },
  capsule: {
    radius: 0.4,
    height: 1.8,
    crouchHeight: 1.0,
    /** Steepest walkable slope (deg). */
    maxSlope: 50,
    stepHeight: 0.45,
    groundSnap: 0.3,
  },
  run: {
    speed: 9,
    accel: 60,
    overSpeedDecay: 4,
    sprintSpeed: 12,
    sprintStickTime: 0.5,
    crouchSpeed: 4,
  },
  jump: {
    fullHeight: 1.6,
    tapHeight: 0.8,
    coyoteTime: 0.12,
    bufferTime: 0.12,
  },
  air: {
    controlFraction: 0.35,
    /** Air control may always steer up to this speed, so a standing jump can still drift. */
    minControlSpeed: 4,
  },
  wallrun: {
    minSpeed: 6,
    maxAngle: 50,
    maxTime: 1.6,
    gravityStart: 0.25,
    gravityEnd: 1,
    exitSpeed: 3,
    /** Window after touching a wall in which a jump becomes a wall jump (s). */
    wallJumpGrace: 0.15,
    sameWallCooldown: 0.35,
  },
  wallJump: {
    offWall: 7,
    up: 5,
  },
  wallClimb: {
    maxHeight: 3,
    speed: 6,
    /** Within this angle of the wall normal counts as head-on (deg). */
    headOnAngle: 35,
  },
  vault: {
    minHeight: 0.6,
    maxHeight: 1.2,
    liftTime: 0.14,
  },
  ledge: {
    grabWindow: 0.4,
    mantleTime: 0.25,
    regrabCooldown: 0.35,
  },
  slide: {
    entryBoost: 2,
    friction: 3,
    minSpeed: 5,
    exitSpeed: 3,
    boostCooldown: 0.6,
    turnRate: 1.5,
  },
  landing: {
    rollWindow: 0.2,
    hardFallHeight: 8,
    stumbleTime: 0.35,
  },
  hook: {
    range: 40,
    coneAngle: 25,
    travelSpeed: 120,
    reelIn: 12,
    reelOut: 8,
    minLength: 3,
    zipEnabled: true,
    zipSpeed: 25,
    zipPopUp: 8,
    zipPopForward: 6,
    /** Fire pressed again within this time of a release zips to the same anchor (s). */
    zipWindow: 0.2,
    toggleMode: false,
    cutTime: 0.2,
    groundReleaseTime: 0.5,
  },
  swing: {
    steerAccel: 6,
    /** Max speed gain from pumping per swing, as a fraction. */
    pumpCap: 0.15,
    pumpFloorSpeed: 5,
    /** How much reeling in speeds up a swing: 1 = conserve angular momentum, 0 = none. */
    reelMomentum: 0.5,
    wallBounce: 0.3,
  },
  assists: {
    groundClearance: true,
    groundClearanceHeight: 1.5,
    groundClearanceTime: 0.15,
    releaseBoost: true,
    releaseBoostWindow: 0.15,
    releaseBoostFraction: 0.1,
    releaseBoostMax: 3,
    releaseLift: true,
    releaseLiftSpeed: 2,
    anchorAheadWeight: 0.3,
    attachSmoothing: true,
    attachSmoothAngle: 60,
    attachSmoothTime: 0.1,
  },
  targeting: {
    centreWeight: 1,
    heightWeight: 0.15,
  },
  camera: {
    distance: 4.5,
    height: 1.2,
    side: 0.45,
    swingDistance: 6,
    fovMin: 75,
    fovMax: 95,
    fovSpeed: 30,
    fovSmoothing: 0.3,
    wallrunTilt: 8,
    recentreDelay: 1.5,
    recentreRate: 1.5,
    swingPitchBias: 10,
    mouseSensitivity: 0.0022,
    padSensitivity: 3,
  },
  graphics: {
    bloom: true,
    bloomStrength: 0.55,
    shadows: true,
    torchLights: true,
    exposure: 1.15,
  },
};

export type Tuning = typeof DEFAULT_TUNING;

export function makeTuning(overrides?: DeepPartial<Tuning>): Tuning {
  const t = structuredClone(DEFAULT_TUNING);
  if (overrides) mergeInto(t, overrides);
  return t;
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** Copies matching keys from `src` into `dst`, ignoring unknown keys and type mismatches. */
export function mergeInto(dst: any, src: any): void {
  if (!src || typeof src !== 'object') return;
  for (const k of Object.keys(dst)) {
    if (!(k in src)) continue;
    if (typeof dst[k] === 'object' && dst[k] !== null) mergeInto(dst[k], src[k]);
    else if (typeof dst[k] === typeof src[k]) dst[k] = src[k];
  }
}
