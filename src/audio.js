/**
 * 音效：WebAudio 现场合成，不加载任何音频文件。
 *
 * 为什么不用采样：项目要求零外部资源；这些音效都是短促的敲击/爆炸/琶音，
 * 用振荡器 + 噪声 + 包络生成，体积极小，还能随场景调参。
 * AudioContext 必须等第一次用户手势后再创建，否则会被浏览器挂起。
 */
export class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.muted = false;
  }

  /** 首次用户手势时调用：把 AudioContext 建好并 resume，绕开自动播放限制。 */
  unlock() {
    if (this.muted) return;
    const ctx = this.#ensure();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.55;
  }

  #ensure() {
    if (this.muted) return null;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);

      const len = Math.floor(this.ctx.sampleRate * 0.6);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  #tone(freq, dur, opts = {}) {
    const ctx = this.#ensure();
    if (!ctx) return;
    const { type = 'sine', gain = 0.12, slideTo = null, delay = 0 } = opts;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);

    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.03, dur * 0.25));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  #noise(dur, opts = {}) {
    const ctx = this.#ensure();
    if (!ctx || !this.noiseBuf) return;
    const { gain = 0.2, freq = 1200, sweepTo = null, q = 0.8, delay = 0 } = opts;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(freq, t0);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), t0 + dur);
    filter.Q.value = q;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(filter).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  tap() {
    this.#noise(0.09, { gain: 0.12, freq: 1400, sweepTo: 500 });
    this.#tone(190, 0.08, { type: 'sine', gain: 0.07 });
  }

  openArea() {
    this.#noise(0.16, { gain: 0.16, freq: 900, sweepTo: 320 });
    this.#tone(150, 0.14, { type: 'sine', gain: 0.08 });
    this.#tone(300, 0.1, { type: 'triangle', gain: 0.04, delay: 0.04 });
  }

  flag() {
    this.#tone(660, 0.07, { type: 'square', gain: 0.055 });
    this.#tone(990, 0.08, { type: 'square', gain: 0.045, delay: 0.06 });
  }

  unflag() {
    this.#tone(520, 0.07, { type: 'square', gain: 0.045 });
    this.#tone(350, 0.08, { type: 'square', gain: 0.04, delay: 0.06 });
  }

  boom() {
    this.#noise(0.75, { gain: 0.62, freq: 900, sweepTo: 90, q: 0.5 });
    this.#tone(90, 0.7, { type: 'sine', gain: 0.32, slideTo: 28 });
    this.#tone(180, 0.35, { type: 'sawtooth', gain: 0.1, slideTo: 40 });
  }

  win() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      this.#tone(f, 0.34, { type: 'triangle', gain: 0.1, delay: i * 0.11 });
      this.#tone(f / 2, 0.3, { type: 'sine', gain: 0.05, delay: i * 0.11 });
    });
  }

  undo() {
    this.#tone(420, 0.06, { type: 'sine', gain: 0.05 });
  }

  click() {
    this.#tone(880, 0.04, { type: 'sine', gain: 0.035 });
  }
}
