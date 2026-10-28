import type { SimEvent } from '../sim/events';

/**
 * Placeholder synthesized audio on the Web Audio API: distinct hook fire / hit / taut /
 * release sounds and a wind loop pitched by speed. The taut sound matters most — it tells
 * the player the swing has started.
 */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  volume = 0.6;

  /** Must be called from a user gesture. */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    const wind = ctx.createBufferSource();
    wind.buffer = this.noise;
    wind.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.Q.value = 0.8;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.master);
    wind.start();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx) this.master.gain.value = v;
  }

  update(speed: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = Math.min(speed / 35, 1);
    this.windGain.gain.setTargetAtTime(Math.max(0, s - 0.15) * 0.5, t, 0.15);
    this.windFilter.frequency.setTargetAtTime(300 + s * 1800, t, 0.15);
  }

  play(e: SimEvent): void {
    if (!this.ctx) return;
    const k = e.strength ?? 1;
    switch (e.type) {
      case 'jump': this.tone('sine', 320, 520, 0.09, 0.08); break;
      case 'wallJump': this.tone('triangle', 380, 640, 0.1, 0.1); break;
      case 'land': this.thump(160, 0.08, 0.1 + 0.25 * k); break;
      case 'hardLand': this.thump(110, 0.25, 0.5); break;
      case 'roll': this.whoosh(600, 0.18, 0.18); break;
      case 'vault':
      case 'mantle': this.whoosh(900, 0.12, 0.12); break;
      case 'slide': this.whoosh(500, 0.35, 0.12); break;
      case 'wallrun': this.whoosh(1200, 0.25, 0.08); break;
      case 'grab': this.thump(300, 0.05, 0.15); break;
      case 'fire': this.whoosh(2500, 0.1, 0.14); break;
      case 'whiff': this.whoosh(1800, 0.25, 0.08); break;
      case 'attach': this.tone('square', 1400, 900, 0.035, 0.06); break;
      case 'taut':
        this.tone('sine', 95, 55, 0.25, 0.4 * k);
        this.tone('triangle', 230, 200, 0.2, 0.12 * k);
        break;
      case 'release': this.whoosh(1400, 0.12, 0.08); break;
      case 'boost': this.tone('sine', 500, 900, 0.15, 0.12); break;
      case 'zip': this.tone('sawtooth', 200, 900, 0.3, 0.06); break;
      case 'zipPop': this.tone('sine', 600, 1000, 0.1, 0.1); break;
      case 'cut': this.thump(900, 0.06, 0.2); break;
      case 'checkpoint': this.tone('sine', 660, 990, 0.25, 0.1); break;
      default: break;
    }
  }

  private env(gain: number, dur: number): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.master);
    return g;
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, gain: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const t = ctx.currentTime;
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    o.connect(this.env(gain, dur));
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noiseBurst(filterType: BiquadFilterType, freq: number, dur: number, gain: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    const t = ctx.currentTime;
    src.connect(f).connect(this.env(gain, dur));
    src.start(t, Math.random());
    src.stop(t + dur + 0.02);
  }

  private thump(freq: number, dur: number, gain: number) { this.noiseBurst('lowpass', freq, dur, gain); }
  private whoosh(freq: number, dur: number, gain: number) { this.noiseBurst('bandpass', freq, dur, gain); }
}
