import { describe, expect, it } from 'vitest';
import { Box, Cylinder } from '../src/collision/shapes';
import { CollisionWorld, makeRayHit } from '../src/collision/world';
import { Vec3 } from '../src/math/vec3';
import type { PrimitiveData } from '../src/sim/level';
import { floor, makeSim, run } from './helpers';

// The spec's collision test suite: corners, seams between boxes, steep ramps, tunnelling.

describe('primitives', () => {
  it('box closest point and raycast, including rotated boxes', () => {
    const b = new Box(new Vec3(0, 0, 0), new Vec3(2, 2, 2));
    const out = new Vec3();
    expect(b.closestPoint(new Vec3(3, 0, 0), out)).toBe(false);
    expect(out.x).toBeCloseTo(1);
    expect(b.closestPoint(new Vec3(0.9, 0, 0), out)).toBe(true);
    expect(out.x).toBeCloseTo(1);

    const n = new Vec3();
    expect(b.raycast(new Vec3(-5, 0, 0), new Vec3(1, 0, 0), 10, n)).toBeCloseTo(4);
    expect(n.x).toBeCloseTo(-1);
    expect(b.raycast(new Vec3(0, 0, 0), new Vec3(1, 0, 0), 10, n)).toBe(-1); // starts inside

    const ramp = new Box(new Vec3(0, 0, 0), new Vec3(2, 2, 2), [0, 45, 0]);
    expect(ramp.raycast(new Vec3(-5, 0, 0), new Vec3(1, 0, 0), 10, n)).toBeCloseTo(5 - Math.SQRT2);
  });

  it('cylinder raycast hits side and caps', () => {
    const c = new Cylinder(new Vec3(0, 0, 0), 1, 4);
    const n = new Vec3();
    expect(c.raycast(new Vec3(-5, 0, 0), new Vec3(1, 0, 0), 10, n)).toBeCloseTo(4);
    expect(n.x).toBeCloseTo(-1);
    expect(c.raycast(new Vec3(0, 10, 0), new Vec3(0, -1, 0), 20, n)).toBeCloseTo(8);
    expect(n.y).toBeCloseTo(1);
    expect(c.raycast(new Vec3(-5, 3, 0), new Vec3(1, 0, 0), 10, n)).toBe(-1);
  });

  it('grid raycast finds the nearest shape across many cells', () => {
    const w = new CollisionWorld(8);
    w.add(new Box(new Vec3(100, 0, 37), new Vec3(2, 2, 2)));
    w.add(new Box(new Vec3(60, 0, -22), new Vec3(2, 2, 2)));
    const o = new Vec3(0, 0, 0);
    const d = new Vec3(100, 0, 37).normalize();
    const hit = makeRayHit();
    expect(w.raycast(o, d, 200, hit)).toBe(true);
    expect(hit.point.x).toBeGreaterThan(97);
    // Nearer box on the same line wins.
    const d2 = new Vec3(60, 0, -22).normalize();
    expect(w.raycast(o, d2, 200, hit)).toBe(true);
    expect(hit.point.x).toBeLessThan(60);
  });
});

describe('capsule collision', () => {
  it('falls onto a floor and rests at the right height', () => {
    const sim = makeSim([floor()], { spawn: [0, 3, 0] });
    run(sim, 2);
    expect(sim.player.state).toBe('ground');
    expect(sim.player.feetY).toBeCloseTo(0, 2);
    expect(sim.player.v.len()).toBeLessThan(0.01);
  });

  it('runs across seams between boxes without snagging', () => {
    const tiles: PrimitiveData[] = [];
    for (let i = 0; i < 40; i++) tiles.push({ type: 'box', pos: [0, -0.5, -i * 2], size: [4, 1, 2] });
    const sim = makeSim(tiles, { spawn: [0, 0, 1] });
    let minSpeed = Infinity;
    run(sim, 4, () => ({ moveY: 1 }), (s) => {
      if (s.time > 0.5 && s.player.p.z > -70) {
        expect(s.player.state).toBe('ground');
        minSpeed = Math.min(minSpeed, s.player.v.hLen());
      }
    });
    expect(minSpeed).toBeGreaterThan(8.9);
    expect(sim.player.feetY).toBeCloseTo(0, 2);
  });

  it('pushes cleanly into a corner without penetrating', () => {
    const sim = makeSim([
      floor(),
      { type: 'box', pos: [3, 2, 0], size: [2, 4, 20] },
      { type: 'box', pos: [0, 2, -3], size: [20, 4, 2] },
    ]);
    sim.cam.yaw = -Math.PI / 4; // face the corner
    run(sim, 2, () => ({ moveY: 1 }));
    const r = sim.T.capsule.radius;
    expect(sim.player.p.x).toBeLessThanOrEqual(2 - r + 1e-3);
    expect(sim.player.p.z).toBeGreaterThanOrEqual(-2 + r - 1e-3);
    expect(sim.player.p.isFinite()).toBe(true);
  });

  const ramp = (deg: number): PrimitiveData => {
    const s = Math.sin((deg * Math.PI) / 180), c = Math.cos((deg * Math.PI) / 180);
    // Sunk so the low end's top surface is flush with the floor.
    return { type: 'box', pos: [0, 10 * s - 0.25 * c + 0.02, -12], size: [6, 0.5, 20], rot: [deg, 0, 0] };
  };

  it('walks up a 30° ramp while staying grounded', () => {
    const sim = makeSim([floor(), ramp(30)], { spawn: [0, 0, 2] });
    run(sim, 1.6, () => ({ moveY: 1 }));
    expect(sim.player.state).toBe('ground');
    expect(sim.player.feetY).toBeGreaterThan(3);
  });

  it('cannot walk up a 60° ramp', () => {
    const sim = makeSim([floor(), ramp(60)], { spawn: [0, 0, 2] });
    run(sim, 3, () => ({ moveY: 1 }));
    expect(sim.player.feetY).toBeLessThan(1.5);
  });

  it.each([35, 60])('does not tunnel through a 0.1 m wall at %d m/s', (speed) => {
    const sim = makeSim([floor(), { type: 'box', pos: [0, 3, -5], size: [10, 6, 0.1] }], { spawn: [0, 1, 0] });
    sim.player.v.set(0, 0, -speed);
    run(sim, 0.5);
    expect(sim.player.p.z).toBeGreaterThan(-5);
  });

  it('does not tunnel through a thin pole at speed', () => {
    const sim = makeSim([floor(), { type: 'cylinder', pos: [0, 3, -5], radius: 0.1, height: 6 }], { spawn: [0, 1, 0] });
    sim.player.v.set(0, 0, -35);
    run(sim, 0.3);
    expect(sim.player.p.z).toBeGreaterThan(-5);
  });
});
