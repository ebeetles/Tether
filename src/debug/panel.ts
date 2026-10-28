import { DEFAULT_TUNING, mergeInto, type Tuning } from '../config';

const STORAGE_KEY = 'tetherline.tuning.v1';

export interface DebugState {
  paused: boolean;
  stepRequested: boolean;
  timeScale: number;
  showCollision: boolean;
  showRope: boolean;
  showStats: boolean;
}

/**
 * Live tuning panel for every number in the spec, plus overlays and frame stepping.
 * Toggle with the backquote key. Tweaks persist in localStorage.
 */
export class DebugPanel {
  readonly state: DebugState = { paused: false, stepRequested: false, timeScale: 1, showCollision: false, showRope: false, showStats: false };
  private readonly root: HTMLElement;
  private readonly inputs: { group: string; key: string; input: HTMLInputElement }[] = [];

  constructor(private readonly T: Tuning, private readonly onOverlayChange: () => void) {
    this.load();
    this.root = document.getElementById('debug')!;
    this.build();
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'Backquote') this.toggle();
      else if (e.code === 'KeyP') this.setPaused(!this.state.paused);
      else if (e.code === 'Period' && this.state.paused) this.state.stepRequested = true;
    });
  }

  toggle(): void {
    this.root.classList.toggle('open');
  }

  private setPaused(p: boolean): void {
    this.state.paused = p;
    const btn = this.root.querySelector<HTMLButtonElement>('[data-act=pause]');
    if (btn) btn.textContent = p ? 'Resume (P)' : 'Pause (P)';
  }

  private build(): void {
    const r = this.root;
    r.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'dbg-head';
    head.innerHTML = `
      <strong>Tuning</strong>
      <div class="dbg-row">
        <button data-act="pause">Pause (P)</button>
        <button data-act="step" title="Step one 1/120 s frame while paused (.)">Step (.)</button>
      </div>
      <label class="dbg-row">time scale <input data-act="scale" type="range" min="0.05" max="1" step="0.05" value="1"><span data-out="scale">1.00</span></label>
      <label class="dbg-check"><input type="checkbox" data-act="collision"> collision overlay</label>
      <label class="dbg-check"><input type="checkbox" data-act="rope"> rope overlay</label>
      <label class="dbg-check"><input type="checkbox" data-act="stats"> stats</label>
      <div class="dbg-row">
        <button data-act="copy">Copy JSON</button>
        <button data-act="reset">Reset all</button>
      </div>`;
    r.appendChild(head);

    head.querySelector('[data-act=pause]')!.addEventListener('click', () => this.setPaused(!this.state.paused));
    head.querySelector('[data-act=step]')!.addEventListener('click', () => { this.setPaused(true); this.state.stepRequested = true; });
    const scale = head.querySelector<HTMLInputElement>('[data-act=scale]')!;
    scale.addEventListener('input', () => {
      this.state.timeScale = Number(scale.value);
      head.querySelector('[data-out=scale]')!.textContent = this.state.timeScale.toFixed(2);
    });
    const check = (act: string, key: 'showCollision' | 'showRope' | 'showStats') => {
      const box = head.querySelector<HTMLInputElement>(`[data-act=${act}]`)!;
      box.addEventListener('change', () => { this.state[key] = box.checked; this.onOverlayChange(); });
    };
    check('collision', 'showCollision');
    check('rope', 'showRope');
    check('stats', 'showStats');
    head.querySelector('[data-act=copy]')!.addEventListener('click', () => {
      void navigator.clipboard?.writeText(JSON.stringify(this.T, null, 2));
    });
    head.querySelector('[data-act=reset]')!.addEventListener('click', () => {
      mergeInto(this.T, structuredClone(DEFAULT_TUNING));
      this.save();
      this.refresh();
    });

    const groups = this.T as unknown as Record<string, Record<string, number | boolean>>;
    const defaults = DEFAULT_TUNING as unknown as Record<string, Record<string, number | boolean>>;
    for (const [group, values] of Object.entries(groups)) {
      const det = document.createElement('details');
      const sum = document.createElement('summary');
      sum.textContent = group;
      det.appendChild(sum);
      for (const key of Object.keys(values)) {
        const row = document.createElement('label');
        row.className = 'dbg-field';
        const name = document.createElement('span');
        name.textContent = key;
        name.title = `default ${defaults[group][key]}`;
        const input = document.createElement('input');
        const isBool = typeof values[key] === 'boolean';
        input.type = isBool ? 'checkbox' : 'number';
        if (!isBool) input.step = String(stepFor(defaults[group][key] as number));
        input.addEventListener(isBool ? 'change' : 'input', () => {
          if (isBool) values[key] = input.checked;
          else if (input.value !== '' && Number.isFinite(Number(input.value))) values[key] = Number(input.value);
          row.classList.toggle('changed', values[key] !== defaults[group][key]);
          this.save();
        });
        row.append(name, input);
        det.appendChild(row);
        this.inputs.push({ group, key, input });
      }
      r.appendChild(det);
    }
    this.refresh();
  }

  private refresh(): void {
    const groups = this.T as unknown as Record<string, Record<string, number | boolean>>;
    const defaults = DEFAULT_TUNING as unknown as Record<string, Record<string, number | boolean>>;
    for (const { group, key, input } of this.inputs) {
      const v = groups[group][key];
      if (typeof v === 'boolean') input.checked = v;
      else input.value = String(v);
      input.parentElement!.classList.toggle('changed', v !== defaults[group][key]);
    }
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) mergeInto(this.T, JSON.parse(raw));
    } catch {
      // Storage unavailable or corrupt: keep defaults.
    }
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.T));
    } catch {
      // Ignore: tuning still applies for this session.
    }
  }
}

function stepFor(v: number): number {
  const a = Math.abs(v);
  if (a === 0) return 0.1;
  if (a < 0.01) return 0.0001;
  if (a < 1) return 0.01;
  if (a < 10) return 0.1;
  return 1;
}
