import { describe, expect, it } from 'vitest';
import { eventTypes, floor, makeSim, run, settle } from './helpers';

describe('run and jump', () => {
  it('accelerates to run speed, and to sprint speed with sprint held', () => {
    const sim = makeSim([floor()]);
    settle(sim);
    run(sim, 0.5, () => ({ moveY: 1 }));
    expect(sim.player.v.hLen()).toBeCloseTo(9, 1);
    run(sim, 0.5, () => ({ moveY: 1, sprint: true }));
    expect(sim.player.v.hLen()).toBeCloseTo(12, 1);
  });

  it('bleeds over-speed slowly instead of snapping to run speed', () => {
    const sim = makeSim([floor()]);
    settle(sim);
    sim.player.v.set(0, 0, -20);
    run(sim, 1, () => ({ moveY: 1 }));
    expect(sim.player.v.hLen()).toBeCloseTo(16, 0);
  });

  it('holding jump reaches full height; a tap reaches about half', () => {
    const peak = (hold: boolean) => {
      const sim = makeSim([floor()]);
      settle(sim);
      let top = 0;
      run(sim, 1.2, (_s, i) => ({ jumpPressed: i === 0, jump: hold || i === 0 }), (s) => { top = Math.max(top, s.player.feetY); });
      return top;
    };
    expect(peak(true)).toBeCloseTo(1.6, 1);
    expect(peak(false)).toBeGreaterThan(0.7);
    expect(peak(false)).toBeLessThan(0.9);
  });

  it('allows a coyote-time jump just after running off a ledge', () => {
    const sim = makeSim([{ type: 'box', pos: [0, -0.5, 0], size: [4, 1, 4] }, floor(-10)], { spawn: [0, 0, 0] });
    settle(sim);
    let walkedOff = -1;
    let jumped = false;
    run(sim, 1, (s, i) => {
      if (walkedOff < 0 && s.player.state === 'air') walkedOff = i;
      const press = walkedOff >= 0 && i === walkedOff + 8; // ~0.07 s after leaving the edge
      return { moveY: 1, jumpPressed: press, jump: press };
    }, (s) => { if (s.events.some((e) => e.type === 'jump')) jumped = true; });
    expect(jumped).toBe(true);
  });

  it('buffers a jump pressed just before landing', () => {
    const sim = makeSim([floor()], { spawn: [0, 1, 0] });
    let pressedAt = -1;
    run(sim, 1, (s, i) => {
      if (pressedAt < 0 && s.player.feetY < 0.1 && s.player.v.y < 0) pressedAt = i;
      return { jumpPressed: i === pressedAt, jump: pressedAt >= 0 };
    });
    expect(eventTypes(sim)).toContain('jump');
  });
});

describe('vault, slide, landing', () => {
  it('vaults a 1 m obstacle with no speed loss', () => {
    const sim = makeSim([floor(), { type: 'box', pos: [0, 0.5, -8], size: [6, 1, 0.6] }], { spawn: [0, 0, 0] });
    settle(sim);
    run(sim, 2, () => ({ moveY: 1 }));
    expect(eventTypes(sim)).toContain('vault');
    expect(sim.player.p.z).toBeLessThan(-10);
    expect(sim.player.v.hLen()).toBeGreaterThan(8.9);
  });

  it('slide adds speed on entry and loses it on flat ground', () => {
    const sim = makeSim([floor()]);
    settle(sim);
    run(sim, 1, () => ({ moveY: 1 }));
    run(sim, 1 / 120, () => ({ moveY: 1, crouch: true, crouchPressed: true }));
    expect(sim.player.state).toBe('slide');
    expect(sim.player.v.hLen()).toBeCloseTo(11, 0);
    run(sim, 1, () => ({ moveY: 1, crouch: true }));
    expect(sim.player.v.hLen()).toBeCloseTo(8, 0);
  });

  it('a fall over 8 m stumbles, a roll keeps speed', () => {
    const fall = (crouch: boolean) => {
      const sim = makeSim([floor()], { spawn: [0, 12, 0] });
      sim.player.v.set(0, 0, -15);
      run(sim, 2, () => ({ crouch, moveY: 1 }));
      return sim;
    };
    const hard = fall(false);
    expect(eventTypes(hard)).toContain('hardLand');
    const rolled = fall(true);
    expect(eventTypes(rolled)).toContain('roll');
    expect(eventTypes(rolled)).not.toContain('hardLand');
  });
});

describe('walls', () => {
  it('jumping into a wall at a shallow angle starts a wallrun; jumping off it launches away', () => {
    const sim = makeSim([floor(), { type: 'box', pos: [-1.7, 4, -30], size: [1, 8, 60] }]);
    settle(sim);
    run(sim, 0.6, () => ({ moveY: 1 }));
    // Jump and drift left into the wall at a shallow angle.
    run(sim, 0.5, (_s, i) => ({ moveY: 1, moveX: -1, jumpPressed: i === 0, jump: true }));
    expect(eventTypes(sim)).toContain('wallrun');
    expect(sim.player.state).toBe('wallrun');
    expect(sim.player.v.hLen()).toBeGreaterThan(8.9); // wallrun keeps the full horizontal speed

    run(sim, 1 / 120, () => ({ jumpPressed: true, jump: true }));
    expect(sim.player.state).toBe('air');
    expect(sim.player.v.x).toBeGreaterThan(6);
    expect(sim.player.v.y).toBeGreaterThan(4);
  });

  it('jumping head-on into a wall climbs and grabs the ledge, then mantles on top', () => {
    const sim = makeSim([floor(), { type: 'box', pos: [0, 2, -6], size: [8, 4, 4] }]);
    settle(sim);
    run(sim, 0.35, () => ({ moveY: 1 }));
    run(sim, 1.2, (_s, i) => ({ moveY: 1, jumpPressed: i === 0, jump: true }));
    expect(eventTypes(sim)).toContain('climb');
    expect(sim.player.state).toBe('ledge');
    run(sim, 0.6, (_s, i) => ({ jumpPressed: i === 0, jump: i === 0 }));
    expect(eventTypes(sim)).toContain('mantle');
    expect(sim.player.feetY).toBeCloseTo(4, 1);
  });
});
