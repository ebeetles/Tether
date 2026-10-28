import type { SimEvent } from '../sim/events';
import type { Sim } from '../sim/sim';
import type { Renderer } from './renderer';

const GAUGE_ARC = 197.9; // 270° of the gauge circle's circumference
const GAUGE_FULL = 263.9;
const GAUGE_MAX = 35; // the soft speed cap

/** How the state ribbon names each way of moving. */
const STATE_NAMES: Record<string, string> = {
  ground: 'Afoot', slide: 'Sliding', stumble: 'Stumbled', air: 'Aloft', wallrun: 'Wallrunning',
  climb: 'Climbing', ledge: 'Hanging', mantle: 'Mantling', vault: 'Vaulting',
  swing: 'Swinging', slack: 'Tethered', zip: 'Zipping',
};

/** DOM overlay: speed medallion, state ribbon, reticle, toasts and speed lines. */
export class Hud {
  private readonly speed = el('hud-speed');
  private readonly state = el('hud-state');
  private readonly gauge = el('gauge');
  private readonly debug = el('hud-debug');
  private readonly reticle = el('reticle');
  private readonly toast = el('toast');
  private readonly lines = el('speedlines') as HTMLCanvasElement;
  private readonly ctx = this.lines.getContext('2d')!;
  private toastTimer = 0;
  private lastState = '';
  showDebug = false;

  resize(w: number, h: number): void {
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.lines.width = w * dpr;
    this.lines.height = h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  onEvent(e: SimEvent): void {
    if (e.type === 'checkpoint') this.showToast('Waystone Attuned', 'You will return here should you fall');
  }

  showToast(title: string, subtitle: string): void {
    this.toast.querySelector('.t1')!.textContent = title;
    this.toast.querySelector('.t2')!.textContent = subtitle;
    this.toast.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove('show'), 2600);
  }

  update(sim: Sim, r: Renderer, fps: number): void {
    const v = r.view.speed;
    this.speed.textContent = v.toFixed(0);
    this.gauge.setAttribute('stroke-dasharray', `${(GAUGE_ARC * Math.min(v / GAUGE_MAX, 1)).toFixed(1)} ${GAUGE_FULL}`);
    const pl = sim.player, hook = sim.hook;
    const key = hook.zipping ? 'zip' : hook.attached ? (hook.taut ? 'swing' : 'slack') : pl.state;
    if (key !== this.lastState) {
      this.state.textContent = STATE_NAMES[key] ?? key;
      this.lastState = key;
    }

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

  /** Wind streaks above 20 m/s. */
  private drawSpeedLines(speed: number): void {
    const w = this.lines.clientWidth, h = this.lines.clientHeight;
    this.ctx.clearRect(0, 0, w, h);
    const k = Math.min(1, (speed - 20) / 15);
    if (k <= 0) return;
    const cx = w / 2, cy = h / 2, R = Math.hypot(cx, cy);
    this.ctx.strokeStyle = `rgba(255, 238, 210, ${0.3 * k})`;
    this.ctx.lineWidth = 1.4;
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
