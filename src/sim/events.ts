import type { Vec3 } from '../math/vec3';

export type SimEventType =
  | 'jump' | 'land' | 'hardLand' | 'roll'
  | 'wallrun' | 'wallJump' | 'climb' | 'grab' | 'mantle' | 'vault' | 'slide'
  | 'fire' | 'whiff' | 'attach' | 'taut' | 'release' | 'boost' | 'zip' | 'zipPop' | 'cut'
  | 'checkpoint' | 'respawn';

/** Things that happened during a step, drained by audio / effects each frame. */
export interface SimEvent {
  type: SimEventType;
  /** 0..1-ish intensity, event specific. */
  strength?: number;
  pos?: Vec3;
}
