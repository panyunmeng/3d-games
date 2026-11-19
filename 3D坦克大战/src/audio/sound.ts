/**
 * 程序合成音效：不加载任何音频文件（需求 A10）。
 * 全部用 WebAudio 的振荡器 + 噪声 + 包络现场合成，零资源、零授权风险。
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private musicTimer: number | null = null;
  private musicStep = 0;

  sfxEnabled = true;
  musicEnabled = false;
  volume = 0.7;

  /** 必须在用户手势里调用一次（浏览器自动播放策略）。 */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.master);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.22;
    this.musicBus.connect(this.master);

    // 1 秒白噪声，复用于炮击/爆炸/引擎。
    const len = Math.floor(ctx.sampleRate);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buffer;

    this.startEngine();
    if (this.musicEnabled) this.startMusic();
    const resume = (): void => {
      void this.ctx?.resume();
      window.removeEventListener('pointerdown', resume);
      window.removeEventListener('keydown', resume);
    };
    window.addEventListener('pointerdown', resume);
    window.addEventListener('keydown', resume);
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.volume;
  }

  setSfxEnabled(on: boolean): void {
    this.sfxEnabled = on;
    if (this.sfxBus) this.sfxBus.gain.value = on ? 0.9 : 0;
  }

  setMusicEnabled(on: boolean): void {
    this.musicEnabled = on;
    if (!this.ctx) return;
    if (on) this.startMusic();
    else this.stopMusic();
  }

  private noiseSource(duration: number): AudioBufferSourceNode | null {
    if (!this.ctx || !this.noise) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start();
    src.stop(this.ctx.currentTime + duration);
    return src;
  }

  private env(gain: GainNode, peak: number, attack: number, decay: number): void {
    const t = this.ctx!.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  /** 炮击：噪声爆破 + 低频冲击，玩家比敌人更脆亮。 */
  shot(team: 'player' | 'enemy'): void {
    if (!this.ctx || !this.sfxEnabled || !this.sfxBus || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const src = this.noiseSource(0.22);
    if (src) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(team === 'player' ? 2600 : 1800, t);
      filter.frequency.exponentialRampToValueAtTime(320, t + 0.2);
      const gain = ctx.createGain();
      this.env(gain, team === 'player' ? 0.55 : 0.32, 0.005, 0.18);
      src.connect(filter).connect(gain).connect(this.sfxBus);
    }

    const thump = ctx.createOscillator();
    thump.type = 'triangle';
    thump.frequency.setValueAtTime(team === 'player' ? 150 : 110, t);
    thump.frequency.exponentialRampToValueAtTime(48, t + 0.16);
    const tg = ctx.createGain();
    this.env(tg, 0.45, 0.004, 0.16);
    thump.connect(tg).connect(this.sfxBus);
    thump.start(t);
    thump.stop(t + 0.24);
  }

  explosion(big: boolean): void {
    if (!this.ctx || !this.sfxEnabled || !this.sfxBus || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = this.noiseSource(big ? 0.9 : 0.4);
    if (src) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1400, t);
      filter.frequency.exponentialRampToValueAtTime(big ? 90 : 160, t + (big ? 0.8 : 0.35));
      const gain = ctx.createGain();
      this.env(gain, big ? 0.85 : 0.42, 0.01, big ? 0.75 : 0.3);
      src.connect(filter).connect(gain).connect(this.sfxBus);
    }
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(big ? 90 : 130, t);
    sub.frequency.exponentialRampToValueAtTime(28, t + 0.5);
    const sg = ctx.createGain();
    this.env(sg, big ? 0.6 : 0.3, 0.01, big ? 0.6 : 0.25);
    sub.connect(sg).connect(this.sfxBus);
    sub.start(t);
    sub.stop(t + 0.8);
  }

  /** 子弹打在钢墙上：金属叮声。 */
  clank(): void {
    if (!this.ctx || !this.sfxEnabled || !this.sfxBus || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1800, t);
    osc.frequency.exponentialRampToValueAtTime(700, t + 0.12);
    const g = ctx.createGain();
    this.env(g, 0.18, 0.002, 0.12);
    osc.connect(g).connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + 0.16);
  }

  pickup(): void {
    if (!this.ctx || !this.sfxEnabled || !this.sfxBus || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    [660, 880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      const start = t + i * 0.07;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.22, start + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
      osc.connect(g).connect(this.sfxBus!);
      osc.start(start);
      osc.stop(start + 0.2);
    });
  }

  /** 过关：上行五声音阶。 */
  levelClear(): void {
    if (!this.ctx || !this.sfxEnabled || !this.sfxBus || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      const start = t + i * 0.11;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.3, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.4);
      osc.connect(g).connect(this.sfxBus!);
      osc.start(start);
      osc.stop(start + 0.45);
    });
  }

  gameOver(): void {
    if (!this.ctx || !this.sfxEnabled || !this.sfxBus || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    [392, 329.63, 261.63, 196].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 900;
      const g = ctx.createGain();
      const start = t + i * 0.17;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.22, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
      osc.connect(filter).connect(g).connect(this.sfxBus!);
      osc.start(start);
      osc.stop(start + 0.55);
    });
  }

  /* ── 引擎循环 ─────────────────────────────────────────────────── */

  private startEngine(): void {
    if (!this.ctx || !this.sfxBus || this.engineOsc) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 42;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 260;
    filter.Q.value = 3;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    osc.connect(filter).connect(gain).connect(this.sfxBus);
    osc.start();
    this.engineOsc = osc;
    this.engineGain = gain;
    this.engineFilter = filter;
  }

  /** 速度比 0～1：音高与音量随车速变化，停车时几乎无声。 */
  setEngine(ratio: number, active: boolean): void {
    if (!this.ctx || !this.engineOsc || !this.engineGain || !this.engineFilter) return;
    if (this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const target = active ? 44 + ratio * 46 : 30;
    this.engineOsc.frequency.setTargetAtTime(target, t, 0.08);
    this.engineFilter.frequency.setTargetAtTime(active ? 220 + ratio * 420 : 140, t, 0.1);
    this.engineGain.gain.setTargetAtTime(active ? 0.06 + ratio * 0.05 : 0.0001, t, 0.12);
  }

  /* ── 背景音乐（极简循环，默认可关） ────────────────────────────── */

  private startMusic(): void {
    if (!this.ctx || !this.musicBus || this.musicTimer !== null) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.musicStep = 0;
    const tick = (): void => {
      if (!this.ctx || !this.musicBus) return;
      const ctx = this.ctx;
      const t = ctx.currentTime;
      // A 小调低音进行：A1 A1 F1 G1，每 0.5 s 一拍
      const bass = [55, 55, 43.65, 49];
      const freq = bass[this.musicStep % bass.length];
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 320;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5, t + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      osc.connect(filter).connect(g).connect(this.musicBus);
      osc.start(t);
      osc.stop(t + 0.55);

      // 每两拍加一个高音点缀
      if (this.musicStep % 2 === 1) {
        const lead = ctx.createOscillator();
        lead.type = 'sine';
        lead.frequency.value = freq * 6;
        const lg = ctx.createGain();
        lg.gain.setValueAtTime(0.0001, t);
        lg.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
        lg.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
        lead.connect(lg).connect(this.musicBus!);
        lead.start(t);
        lead.stop(t + 0.4);
      }
      this.musicStep++;
    };
    tick();
    this.musicTimer = window.setInterval(tick, 500);
  }

  private stopMusic(): void {
    if (this.musicTimer !== null) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }
}
