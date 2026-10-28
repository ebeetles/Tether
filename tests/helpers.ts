import { makeTuning, type DeepPartial, type Tuning } from '../src/config';
import { emptyInput, type InputFrame } from '../src/sim/input';
import { Level, type LevelData, type PrimitiveData } from '../src/sim/level';
import { STEP, Sim } from '../src/sim/sim';

export const floor = (y = 0, size = 400): PrimitiveData => ({ type: 'box', pos: [0, y - 0.5, 0], size: [size, 1, size] });

export function makeSim(
  primitives: PrimitiveData[],
  opts: { spawn?: [number, number, number]; anchors?: LevelData['anchors']; tuning?: DeepPartial<Tuning> } = {},
): Sim {
  const level = new Level({
    name: 'test',
    spawn: { pos: opts.spawn ?? [0, 0, 0] },
    primitives,
    anchors: opts.anchors ?? [],
    killY: -1000,
  });
  return new Sim(level, makeTuning(opts.tuning));
}

/** Run for `seconds`, calling `input` each step to build that step's input. */
export function run(sim: Sim, seconds: number, input: (sim: Sim, i: number) => Partial<InputFrame> = () => ({}), each?: (sim: Sim) => void): void {
  const n = Math.round(seconds / STEP);
  for (let i = 0; i < n; i++) {
    sim.step(STEP, { ...emptyInput(), ...input(sim, i) });
    each?.(sim);
  }
}

export const settle = (sim: Sim) => run(sim, 0.5);
export const eventTypes = (sim: Sim) => sim.events.map((e) => e.type);
