/**
 * 程序化贴图：岩石、铜色数字、烧焦痕迹、错误的旗。
 *
 * 为什么全用 canvas 现画：项目零构建、零外部资源，贴图必须是代码生成的；
 * 也避免 480 个方块共用一张「看起来很平」的纯色材质。
 */
import * as THREE from '../vendor/three.module.js';
import { PALETTE } from './config.js';

function makeCanvas(w, h = w) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

function toTexture(canvas, { repeat = 1, srgb = true } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 4;
  return tex;
}

/** 粗颗粒岩石：底色 + 深浅碎屑 + 几道裂缝。 */
export function makeRockTexture(seed = 7) {
  const size = 256;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  let s = seed;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };

  ctx.fillStyle = '#6b5a48';
  ctx.fillRect(0, 0, size, size);

  // 大块斑驳
  for (let i = 0; i < 26; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 18 + rand() * 52;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const light = rand() > 0.5;
    g.addColorStop(0, light ? 'rgba(140,118,90,0.30)' : 'rgba(30,24,18,0.34)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // 碎屑颗粒
  for (let i = 0; i < 2600; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const w = 1 + rand() * 2.6;
    const v = rand();
    ctx.fillStyle =
      v > 0.72
        ? `rgba(158,134,104,${0.10 + rand() * 0.24})`
        : `rgba(24,19,14,${0.10 + rand() * 0.28})`;
    ctx.fillRect(x, y, w, w * (0.6 + rand()));
  }

  // 裂缝
  ctx.strokeStyle = 'rgba(10,8,6,0.45)';
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    let x = rand() * size;
    let y = rand() * size;
    ctx.lineWidth = 0.6 + rand() * 1.4;
    ctx.moveTo(x, y);
    for (let k = 0; k < 5; k++) {
      x += (rand() - 0.5) * 40;
      y += (rand() - 0.5) * 40;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  return toTexture(canvas);
}

/** 湿土 / 砂砾地面（已挖开格子的底板）。 */
export function makeSoilTexture(seed = 21) {
  const size = 128;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return s / 4294967296;
  };
  ctx.fillStyle = '#4a3a2a';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 900; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const v = rand();
    ctx.fillStyle =
      v > 0.6 ? `rgba(78,62,44,${0.08 + rand() * 0.16})` : `rgba(8,6,4,${0.10 + rand() * 0.2})`;
    ctx.fillRect(x, y, 1 + rand() * 2, 1 + rand() * 2);
  }
  return toTexture(canvas);
}

/** 铜色数字 1..8：透明底 + 内嵌铜牌 + 描边 + 暖光晕。 */
export function makeNumberTexture(digit) {
  const size = 256;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const text = String(digit);

  // 内嵌的深色铜牌：数字落在深色底上才不会被岩层吃掉对比
  const pad = 18;
  const r = 34;
  ctx.beginPath();
  ctx.moveTo(pad + r, pad);
  ctx.arcTo(size - pad, pad, size - pad, size - pad, r);
  ctx.arcTo(size - pad, size - pad, pad, size - pad, r);
  ctx.arcTo(pad, size - pad, pad, pad, r);
  ctx.arcTo(pad, pad, size - pad, pad, r);
  ctx.closePath();
  ctx.fillStyle = 'rgba(9,6,4,0.62)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(200,134,60,0.42)';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '800 186px Georgia, "Times New Roman", serif';

  // 外发光
  ctx.shadowColor = 'rgba(255,168,72,0.9)';
  ctx.shadowBlur = 20;
  ctx.fillStyle = '#d79a52';
  ctx.fillText(text, size / 2, size / 2 + 4);
  ctx.shadowBlur = 0;

  // 铜面渐变
  const grad = ctx.createLinearGradient(0, size * 0.2, 0, size * 0.84);
  grad.addColorStop(0, '#ffe3b8');
  grad.addColorStop(0.42, '#e8ac63');
  grad.addColorStop(0.76, '#b4712f');
  grad.addColorStop(1, '#8a511d');

  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(22,12,5,0.92)';
  ctx.strokeText(text, size / 2, size / 2 + 4);

  ctx.fillStyle = grad;
  ctx.fillText(text, size / 2, size / 2 + 4);

  // 顶部高光
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = 'rgba(255,236,205,0.14)';
  ctx.fillText(text, size / 2, size / 2 - 2);

  return toTexture(canvas);
}

/** 爆炸焦痕：中心黑烟 → 边缘透明，带几点余烬。 */
export function makeScorchTexture() {
  const size = 192;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const cx = size / 2;
  const grad = ctx.createRadialGradient(cx, cx, 2, cx, cx, cx);
  grad.addColorStop(0, 'rgba(0,0,0,0.92)');
  grad.addColorStop(0.45, 'rgba(12,8,6,0.7)');
  grad.addColorStop(0.75, 'rgba(30,18,10,0.25)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  let s = 5;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < 26; i++) {
    const a = rand() * Math.PI * 2;
    const r = 4 + rand() * 60;
    const x = cx + Math.cos(a) * r;
    const y = cx + Math.sin(a) * r;
    ctx.fillStyle = `rgba(255,${90 + rand() * 90 | 0},30,${0.35 + rand() * 0.5})`;
    ctx.beginPath();
    ctx.arc(x, y, 1 + rand() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  return toTexture(canvas);
}

/** 插错的旗：红色叉。 */
export function makeWrongTexture() {
  const size = 128;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(255,60,40,0.9)';
  ctx.shadowBlur = 14;
  ctx.strokeStyle = PALETTE.wrong;
  ctx.lineWidth = 16;
  const p = 30;
  ctx.beginPath();
  ctx.moveTo(p, p);
  ctx.lineTo(size - p, size - p);
  ctx.moveTo(size - p, p);
  ctx.lineTo(p, size - p);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,150,120,0.85)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(p, p);
  ctx.lineTo(size - p, size - p);
  ctx.stroke();
  return toTexture(canvas);
}

/** 圆形柔光点，用于粒子与旗面高光（可选）。 */
export function makeGlowTexture() {
  const size = 64;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,210,150,0.5)');
  g.addColorStop(1, 'rgba(255,200,120,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
