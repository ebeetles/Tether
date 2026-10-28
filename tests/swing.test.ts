import { describe, expect, it } from 'vitest';
import { Box } from '../src/collision/shapes';
import { Vec3 } from '../src/math/vec3';
import { eventTypes, floor, makeSim, run } from './helpers';

const noAssists = {
  assists: { groundClearance: false, releaseBoost: false, releaseLift: false, attachSmoothing: false },
};

/** A player held still with a horizontal rope to an anchor 15 m away. */
function pendulum(opts: Parameters<typeof makeSim>[1] = {}) {
  const sim = makeSim([floor(-20)], {
    spawn: [15, 20, 0],
    anchors: [{ pos: [0, 20.9 + 0.01, 0] }],
    tuning: noAssists,
    ...opts,
  });
  sim.hook.attachTo(sim.level.anchors[0], null);
  return sim;
}

describe('rope', () => {
  it('a 15 m drop gives √(2gh) ≈ 17 m/s at the bottom of the arc', () => {
    const sim = pendulum();
    let maxSpeed = 0;
    // A quarter swing from horizontal on a 15 m rope takes ~2.3 s.
    run(sim, 3, () => ({ fire: true }), (s) => { maxSpeed = Math.max(maxSpeed, s.player.v.len()); });
    expect(maxSpeed).toBeGreaterThan(17.15 * 0.98);
    expect(maxSpeed).toBeLessThan(17.15 * 1.01);
  });

  it('never adds energy: the swing never climbs above its start', () => {
    const sim = pendulum();
    const startY = sim.player.p.y;
    let maxLater = -Infinity;
    run(sim, 6, () => ({ fire: true }), (s) => { if (s.time > 1) maxLater = Math.max(maxLater, s.player.p.y); });
    expect(maxLater).toBeLessThan(startY + 0.02);
    expect(sim.hook.attached).toBe(true);
  });

  it('can pull but never push: a player inside the rope length moves freely', () => {
    const sim = pendulum();
    sim.player.v.set(-10, 0, 0); // toward the anchor
    run(sim, 0.3, () => ({ fire: true }));
    expect(sim.player.v.x).toBeCloseTo(-10, 0);
    expect(sim.player.p.distTo(sim.level.anchors[0].pos)).toBeLessThan(sim.hook.L);
  });

  it('reeling in at the bottom shortens the rope and speeds the swing up', () => {
    const plain = pendulum();
    const reeled = pendulum();
    let a = 0, b = 0;
    run(plain, 3, () => ({ fire: true }), (s) => { a = Math.max(a, s.player.v.len()); });
    run(reeled, 3, (s) => ({ fire: true, reelIn: s.time > 2.1 && s.time < 2.6 }), (s) => { b = Math.max(b, s.player.v.len()); });
    expect(reeled.hook.L).toBeLessThan(plain.hook.L);
    expect(b).toBeGreaterThan(a);
  });

  it('a moving anchor drags the player with it', () => {
    const sim = makeSim([floor(-50)], {
      spawn: [0, 10, 0],
      anchors: [{ pos: [0, 20, 0], motion: { type: 'linear', to: [40, 20, 0], period: 8 } }],
      tuning: noAssists,
    });
    run(sim, 0.01);
    sim.hook.attachTo(sim.level.anchors[0], null);
    run(sim, 2, () => ({ fire: true }));
    expect(sim.player.p.x).toBeGreaterThan(3);
  });

  it('releasing in hold mode keeps all velocity', () => {
    const sim = pendulum();
    run(sim, 1, () => ({ fire: true }));
    const v = sim.player.v.clone();
    run(sim, 1 / 120, () => ({ fire: false, fireReleased: true }));
    expect(sim.hook.attached).toBe(false);
    expect(sim.player.v.distTo(v)).toBeLessThan(0.2);
  });
});

describe('assists', () => {
  it('ground clearance shortens a rope that would scrape the floor', () => {
    const sim = makeSim([floor(0)], { spawn: [12, 10, 0], anchors: [{ pos: [0, 12, 0] }] });
    sim.hook.attachTo(sim.level.anchors[0], null);
    run(sim, 0.3, () => ({ fire: true }));
    // Lowest feet position must clear the ground by ~1.5 m.
    expect(12 - sim.hook.L - 0.9).toBeGreaterThan(1.4);
  });

  it('release just past the bottom of the arc adds a boost and lift', () => {
    const sim = pendulum({ tuning: {} });
    let releasedAt = -1;
    let before = 0;
    let after = 0;
    run(sim, 4, (s, i) => {
      if (releasedAt < 0 && s.player.v.y > 0 && s.player.p.y < 7) { releasedAt = i; before = s.player.v.len(); }
      return releasedAt >= 0 ? { fire: false, fireReleased: i === releasedAt } : { fire: true };
    }, (s) => { if (releasedAt >= 0 && after === 0) after = s.player.v.len(); });
    expect(eventTypes(sim)).toContain('boost');
    expect(after).toBeGreaterThan(before * 1.08);
  });

  it('double-tapping fire zips to the anchor and pops up over it', () => {
    const sim = pendulum({ tuning: {} });
    run(sim, 0.4, () => ({ fire: true }));
    run(sim, 1 / 120, () => ({ fire: false, fireReleased: true }));
    run(sim, 1 / 120, () => ({ fire: true, firePressed: true }));
    expect(sim.hook.zipping).toBe(true);
    run(sim, 2, () => ({ fire: true }));
    expect(eventTypes(sim)).toContain('zipPop');
  });

  it('targets the anchor nearest screen centre and fires at it', () => {
    const sim = makeSim([floor()], {
      anchors: [{ pos: [0, 15, -20] }, { pos: [15, 15, -20] }],
    });
    run(sim, 0.5);
    sim.cam.pitch = Math.atan2(15 - 3, 20);
    run(sim, 0.1);
    expect(sim.hook.target?.id).toBe(0);
    run(sim, 1 / 120, () => ({ fire: true, firePressed: true }));
    expect(sim.hook.attached).toBe(true);
    expect(sim.hook.anchor?.id).toBe(0);
  });

  it('the rope cuts when geometry blocks it for more than 0.2 s', () => {
    const sim = pendulum({ tuning: noAssists });
    sim.level.world.add(new Box(new Vec3(4, 21.0, 0), new Vec3(1, 0.6, 4)));
    run(sim, 0.15, () => ({ fire: true }));
    expect(sim.hook.attached).toBe(true);
    run(sim, 0.15, () => ({ fire: true }));
    expect(sim.hook.attached).toBe(false);
    expect(eventTypes(sim)).toContain('cut');
  });
});
