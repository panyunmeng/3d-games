import * as THREE from 'three';

/** 程序化生成贴图，全部用 Canvas 画，不加载任何图片文件 */

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

/** 地面：暗金属网格 + 高光接缝 */
export function makeGroundTexture(accent: number): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const bg = ctx.createLinearGradient(0, 0, size, size);
  bg.addColorStop(0, '#22303f');
  bg.addColorStop(1, '#131c26');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  // 噪点
  for (let i = 0; i < 2600; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const a = Math.random() * 0.05;
    ctx.fillStyle = `rgba(180,220,255,${a})`;
    ctx.fillRect(x, y, 2, 2);
  }

  // 细网格
  ctx.strokeStyle = 'rgba(120,175,215,0.22)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= size; i += 64) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(size, i);
    ctx.stroke();
  }

  // 主网格 + 发光接缝
  ctx.strokeStyle = `rgba(${(accent >> 16) & 255},${(accent >> 8) & 255},${accent & 255},0.22)`;
  ctx.lineWidth = 2;
  for (let i = 0; i <= size; i += 256) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(size, i);
    ctx.stroke();
  }

  // 角落铆钉
  ctx.fillStyle = 'rgba(140,200,255,0.18)';
  for (let x = 32; x < size; x += 128) {
    for (let y = 32; y < size; y += 128) {
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 行进带：中间虚线 + 两侧亮边 */
export function makePathTexture(accent: number): THREE.CanvasTexture {
  const w = 64;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#243140';
  ctx.fillRect(0, 0, w, h);

  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(0.18, 'rgba(0,0,0,0)');
  grad.addColorStop(0.82, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = hex(accent);
  ctx.globalAlpha = 0.32;
  ctx.fillRect(0, 0, 3, h);
  ctx.fillRect(w - 3, 0, 3, h);
  ctx.globalAlpha = 1;

  // 中央虚线（沿 v 方向循环）
  ctx.fillStyle = hex(accent);
  ctx.globalAlpha = 0.34;
  ctx.fillRect(w / 2 - 1.5, 40, 3, 56);
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 径向辉光，用于粒子与光斑 */
export function makeGlowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 建造点圆盘 */
export function makePadTexture(accent: number): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
  const c = size / 2;

  ctx.strokeStyle = hex(accent);
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(c, c, c - 14, 0, Math.PI * 2);
  ctx.stroke();

  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(c, c, c - 34, 0, Math.PI * 2);
  ctx.stroke();

  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 6;
  for (let i = 0; i < 4; i++) {
    const a0 = (i * Math.PI) / 2 + Math.PI / 4;
    ctx.beginPath();
    ctx.arc(c, c, c - 52, a0 - 0.28, a0 + 0.28);
    ctx.stroke();
  }

  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(c - 18, c);
  ctx.lineTo(c + 18, c);
  ctx.moveTo(c, c - 18);
  ctx.lineTo(c, c + 18);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
