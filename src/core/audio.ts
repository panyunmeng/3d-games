/**
 * 程序化音效：全部用 Web Audio 的振荡器 + 噪声实时合成，没有任何音频文件。
 * 浏览器自动播放策略要求首次用户手势后才能出声，所以由界面统一调用 unlock()。
 */
export type SfxName =
  | 'shot-gatling'
  | 'shot-mortar'
  | 'shot-tesla'
  | 'shot-laser'
  | 'explosion'
  | 'hit'
  | 'kill'
  | 'build'
  | 'upgrade'
  | 'sell'
  | 'wave'
  | 'leak'
  | 'victory'
  | 'defeat'
  | 'click'
  | 'error'
  | 'boss';

const COOLDOWN: Partial<Record<SfxName, number>> = {
  'shot-gatling': 0.04,
  'shot-mortar': 0.06,
  'shot-tesla': 0.05,
  'shot-laser': 0.06,
  hit: 0.035,
  kill: 0.03,
  explosion: 0.05,
  leak: 0.25,
};

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private lastAt = new Map<SfxName, number>();

  volume = { master: 0.75, sfx: 0.85 };
  muted = false;

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** 必须在用户手势回调里调用一次 */
  unlock(): void {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume.master;
      this.master.connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = this.volume.sfx;
      this.sfxBus.connect(this.master);
      this.noiseBuffer = this.makeNoise(this.ctx);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setVolumes(master: number, sfx: number): void {
    this.volume.master = master;
    this.volume.sfx = sfx;
    if (this.master) this.master.gain.value = this.muted ? 0 : master;
    if (this.sfxBus) this.sfxBus.gain.value = sfx;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : this.volume.master, this.ctx.currentTime, 0.02);
    }
  }

  play(name: SfxName, opts: { volume?: number; rate?: number; pan?: number } = {}): void {
    const ctx = this.ctx;
    const bus = this.sfxBus;
    if (!ctx || !bus || ctx.state !== 'running' || this.muted) return;

    const now = ctx.currentTime;
    const cool = COOLDOWN[name] ?? 0;
    if (cool > 0) {
      const last = this.lastAt.get(name) ?? -1;
      if (now - last < cool) return;
      this.lastAt.set(name, now);
    }

    const vol = opts.volume ?? 1;
    const rate = opts.rate ?? 1;
    const out = ctx.createGain();
    out.gain.value = vol;
    if (opts.pan) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, opts.pan));
      out.connect(panner).connect(bus);
    } else {
      out.connect(bus);
    }

    switch (name) {
      case 'shot-gatling':
        this.tone(ctx, out, { type: 'square', from: 420 * rate, to: 150 * rate, dur: 0.055, gain: 0.16 });
        this.noise(ctx, out, { dur: 0.04, gain: 0.07, type: 'highpass', freq: 1800 });
        break;
      case 'shot-mortar':
        this.tone(ctx, out, { type: 'sine', from: 150 * rate, to: 52 * rate, dur: 0.22, gain: 0.3 });
        this.noise(ctx, out, { dur: 0.12, gain: 0.12, type: 'lowpass', freq: 480 });
        break;
      case 'shot-tesla':
        this.tone(ctx, out, { type: 'sawtooth', from: 900 * rate, to: 240 * rate, dur: 0.14, gain: 0.11 });
        this.tone(ctx, out, { type: 'square', from: 1700 * rate, to: 700 * rate, dur: 0.09, gain: 0.05 });
        break;
      case 'shot-laser':
        this.tone(ctx, out, { type: 'sawtooth', from: 1500 * rate, to: 420 * rate, dur: 0.13, gain: 0.09 });
        this.tone(ctx, out, { type: 'sine', from: 2200 * rate, to: 900 * rate, dur: 0.1, gain: 0.05 });
        break;
      case 'explosion':
        this.noise(ctx, out, { dur: 0.55, gain: 0.36, type: 'lowpass', freq: 900, freqEnd: 90 });
        this.tone(ctx, out, { type: 'sine', from: 90, to: 34, dur: 0.4, gain: 0.26 });
        break;
      case 'hit':
        this.noise(ctx, out, { dur: 0.05, gain: 0.05, type: 'bandpass', freq: 2400 });
        break;
      case 'kill':
        this.noise(ctx, out, { dur: 0.16, gain: 0.11, type: 'lowpass', freq: 1600, freqEnd: 200 });
        this.tone(ctx, out, { type: 'triangle', from: 260, to: 90, dur: 0.14, gain: 0.07 });
        break;
      case 'build':
        this.tone(ctx, out, { type: 'triangle', from: 330, to: 330, dur: 0.09, gain: 0.16, when: 0 });
        this.tone(ctx, out, { type: 'triangle', from: 494, to: 494, dur: 0.09, gain: 0.16, when: 0.07 });
        this.tone(ctx, out, { type: 'triangle', from: 660, to: 660, dur: 0.14, gain: 0.16, when: 0.14 });
        break;
      case 'upgrade':
        this.tone(ctx, out, { type: 'square', from: 520, to: 780, dur: 0.12, gain: 0.13 });
        this.tone(ctx, out, { type: 'square', from: 780, to: 1180, dur: 0.16, gain: 0.12, when: 0.1 });
        break;
      case 'sell':
        this.tone(ctx, out, { type: 'triangle', from: 660, to: 400, dur: 0.1, gain: 0.14 });
        this.tone(ctx, out, { type: 'triangle', from: 400, to: 240, dur: 0.14, gain: 0.12, when: 0.08 });
        break;
      case 'wave':
        this.tone(ctx, out, { type: 'sawtooth', from: 160, to: 160, dur: 0.5, gain: 0.1, filter: 700 });
        this.tone(ctx, out, { type: 'sawtooth', from: 202, to: 202, dur: 0.5, gain: 0.09, filter: 700 });
        this.tone(ctx, out, { type: 'sawtooth', from: 240, to: 240, dur: 0.5, gain: 0.08, filter: 900, when: 0.12 });
        break;
      case 'leak':
        this.tone(ctx, out, { type: 'square', from: 740, to: 740, dur: 0.14, gain: 0.14 });
        this.tone(ctx, out, { type: 'square', from: 560, to: 560, dur: 0.2, gain: 0.14, when: 0.16 });
        break;
      case 'victory':
        [523, 659, 784, 1046].forEach((f, i) =>
          this.tone(ctx, out, { type: 'triangle', from: f, to: f, dur: 0.22, gain: 0.16, when: i * 0.13 }),
        );
        break;
      case 'defeat':
        [392, 330, 262, 196].forEach((f, i) =>
          this.tone(ctx, out, { type: 'sawtooth', from: f, to: f * 0.98, dur: 0.3, gain: 0.12, when: i * 0.18, filter: 900 }),
        );
        break;
      case 'boss':
        this.tone(ctx, out, { type: 'sawtooth', from: 70, to: 70, dur: 1.4, gain: 0.16, filter: 320 });
        this.tone(ctx, out, { type: 'sawtooth', from: 105, to: 105, dur: 1.4, gain: 0.1, filter: 400, when: 0.05 });
        break;
      case 'click':
        this.tone(ctx, out, { type: 'sine', from: 880, to: 660, dur: 0.06, gain: 0.1 });
        break;
      case 'error':
        this.tone(ctx, out, { type: 'square', from: 180, to: 140, dur: 0.12, gain: 0.12 });
        break;
    }
  }

  private tone(
    ctx: AudioContext,
    out: GainNode,
    o: {
      type: OscillatorType;
      from: number;
      to: number;
      dur: number;
      gain: number;
      when?: number;
      filter?: number;
    },
  ): void {
    const t0 = ctx.currentTime + (o.when ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type;
    osc.frequency.setValueAtTime(Math.max(20, o.from), t0);
    if (o.to !== o.from) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + o.dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(o.gain, t0 + Math.min(0.012, o.dur * 0.3));
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    let node: AudioNode = osc;
    if (o.filter) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = o.filter;
      node = node.connect(lp);
    }
    node.connect(env).connect(out);
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.02);
  }

  private noise(
    ctx: AudioContext,
    out: GainNode,
    o: { dur: number; gain: number; type: BiquadFilterType; freq: number; freqEnd?: number },
  ): void {
    const buf = this.noiseBuffer;
    if (!buf) return;
    const t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = o.type;
    filter.frequency.setValueAtTime(o.freq, t0);
    if (o.freqEnd) filter.frequency.exponentialRampToValueAtTime(Math.max(40, o.freqEnd), t0 + o.dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(o.gain, t0 + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    src.connect(filter).connect(env).connect(out);
    src.start(t0);
    src.stop(t0 + o.dur + 0.02);
  }

  private makeNoise(ctx: AudioContext): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * 1.2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }
}
