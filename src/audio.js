/**
 * 音效：全部用 WebAudio 现场合成，不依赖任何音频文件。
 *
 * 为什么不用素材：一个贪吃蛇的三种反馈（吃/拾取/死亡）用两三个振荡器就能做准，
 * 引入 mp3 只会带来加载失败、授权、体积三类问题。音量刻意做小，避免盖住音乐。
 */

let ctx = null;
let master = null;
let muted = false;

const STORAGE_KEY = 'jelly-snake-muted';

try {
  muted = localStorage.getItem(STORAGE_KEY) === '1';
} catch { /* 隐私模式下 localStorage 可能不可用，忽略 */ }

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.22;
  master.connect(ctx.destination);
  return ctx;
}

/** 浏览器要求音频必须由用户手势解锁，第一次按键/点击时调一次。 */
export function unlock() {
  const c = ensure();
  if (c && c.state === 'suspended') c.resume();
}

export function setMuted(v) {
  muted = !!v;
  try { localStorage.setItem(STORAGE_KEY, muted ? '1' : '0'); } catch { /* ignore */ }
}
export function isMuted() { return muted; }
export function toggleMute() { setMuted(!muted); return muted; }

function tone({ type = 'sine', from = 440, to = from, dur = 0.14, gain = 0.5, delay = 0 }) {
  const c = ensure();
  if (!c || muted) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

function noise({ dur = 0.2, gain = 0.25, freq = 900, q = 1, delay = 0 }) {
  const c = ensure();
  if (!c || muted) return;
  const t0 = c.currentTime + delay;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(bp).connect(g).connect(master);
  src.start(t0);
}

export const sfx = {
  eat() {
    tone({ type: 'triangle', from: 760, to: 1180, dur: 0.09, gain: 0.5 });
    tone({ type: 'sine', from: 1180, to: 1500, dur: 0.07, gain: 0.25, delay: 0.05 });
  },
  item(kind) {
    const base = kind === 'speed' ? 620 : kind === 'slow' ? 420 : 880;
    tone({ type: 'square', from: base, to: base, dur: 0.07, gain: 0.22 });
    tone({ type: 'square', from: base * 1.26, to: base * 1.26, dur: 0.07, gain: 0.22, delay: 0.07 });
    tone({ type: 'square', from: base * 1.5, to: base * 1.5, dur: 0.1, gain: 0.22, delay: 0.14 });
  },
  speed() { tone({ type: 'sawtooth', from: 300, to: 620, dur: 0.12, gain: 0.12 }); },
  wrap() { noise({ dur: 0.16, gain: 0.12, freq: 1600, q: 0.8 }); },
  obstacle() { tone({ type: 'square', from: 180, to: 90, dur: 0.16, gain: 0.18 }); },
  die() {
    tone({ type: 'sawtooth', from: 380, to: 55, dur: 0.55, gain: 0.32 });
    tone({ type: 'square', from: 190, to: 40, dur: 0.6, gain: 0.18, delay: 0.03 });
    noise({ dur: 0.45, gain: 0.2, freq: 320, q: 0.6 });
  },
  levelclear() {
    [523, 659, 784, 1047].forEach((f, i) =>
      tone({ type: 'triangle', from: f, to: f, dur: 0.22, gain: 0.28, delay: i * 0.09 }));
  },
  click() { tone({ type: 'sine', from: 520, to: 700, dur: 0.06, gain: 0.2 }); },
  start() {
    [392, 523, 659].forEach((f, i) =>
      tone({ type: 'triangle', from: f, to: f, dur: 0.16, gain: 0.24, delay: i * 0.07 }));
  },
};
