import type { Sim } from '../sim/sim';
import type { Renderer } from './renderer';

/** DOM overlay: speed, state, reticle on the current hook target, and speed lines. */
export class Hud {
  private readonly speed = el('hud-speed');
  private readonly state = el('hud-state');
  private readonly debug = el('hud-debug');
  private readonly reticle = el('reticle');
  private readonly lines = el('speedlines') as HTMLCanvasElement;
  private readonly ctx = this.lines.getContext('2d')!;
  showDebug = false;

  resize(w: number, h: number): void {
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.lines.width = w * dpr;
    this.lines.height = h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  update(sim: Sim, r: Renderer, fps: number): void {
    const v = r.view.speed;
    this.speed.textContent = v.toFixed(1);
    const pl = sim.player, hook = sim.hook;
    this.state.textContent = hook.zipping ? 'zip' : hook.attached ? (hook.taut ? 'swing' : 'rope slack') : pl.state;

    const ret = r.view.reticle;
    if (ret) {
      this.reticle.style.display = 'block';
      this.reticle.style.transform = `translate(${ret.x}px, ${ret.y}px) translate(-50%, -50%)`;
      this.reticle.dataset.kind = ret.kind;
    } else {
      this.reticle.style.display = 'none';
    }

    if (this.showDebug) {
      const a = hook.attached ? hook.anchorPos() : null;
      this.debug.textContent = [
        `fps ${fps.toFixed(0)}  step ${sim.steps}`,
        `pos ${pl.p.x.toFixed(1)} ${pl.p.y.toFixed(1)} ${pl.p.z.toFixed(1)}`,
        `vel ${pl.v.x.toFixed(1)} ${pl.v.y.toFixed(1)} ${pl.v.z.toFixed(1)}  h ${pl.v.hLen().toFixed(1)}`,
        `state ${pl.state} ${pl.stateTime.toFixed(2)}s  height ${pl.height.toFixed(2)}`,
        a ? `rope L ${hook.L.toFixed(2)}  dist ${pl.p.distTo(a).toFixed(2)}  ${hook.taut ? 'taut' : 'slack'}` : 'rope —',
        `target ${hook.target ? `anchor ${hook.target.id}` : hook.hasSurface ? 'surface' : '—'}`,
      ].join('\n');
      this.debug.style.display = 'block';
    } else {
      this.debug.style.display = 'none';
    }

    this.drawSpeedLines(v);
  }

  /** Speed lines above 20 m/s. */
  private drawSpeedLines(speed: number): void {
    const w = this.lines.clientWidth, h = this.lines.clientHeight;
    this.ctx.clearRect(0, 0, w, h);
    const k = Math.min(1, (speed - 20) / 15);
    if (k <= 0) return;
    const cx = w / 2, cy = h / 2, R = Math.hypot(cx, cy);
    this.ctx.strokeStyle = `rgba(255,255,255,${0.35 * k})`;
    this.ctx.lineWidth = 1.5;
    this.ctx.beginPath();
    const n = Math.floor(20 + 50 * k);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r0 = R * (0.55 + Math.random() * 0.25);
      const r1 = r0 + R * (0.1 + 0.25 * k * Math.random());
      this.ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      this.ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    }
    this.ctx.stroke();
  }
}

function el(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (!e) throw new Error(`missing #${id}`);
  return e;
}
