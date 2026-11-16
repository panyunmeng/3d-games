// 像素纹理生成：全部用 Canvas 现画，不加载任何外部图片。
//
// 为什么这样画：像素风的关键不是「糊」，而是「采样点少」。
// 所以纹理一律 32×32、NearestFilter、关闭 mipmap，让每个纹素都是一个硬方块；
// 抖动也只落在整像素上，不用渐变。

import * as THREE from 'three';

const SIZE = 32;

/** 固定种子伪随机，保证每次打开画面一致（贴图不应随机漂移）。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function px(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x | 0, y | 0, w | 0, h | 0);
}

function canvas(draw: (ctx: CanvasRenderingContext2D, rand: () => number) => void, seed: number): THREE.CanvasTexture {
  const el = document.createElement('canvas');
  el.width = SIZE;
  el.height = SIZE;
  const ctx = el.getContext('2d');
  if (!ctx) throw new Error('2D canvas 不可用');
  ctx.imageSmoothingEnabled = false;
  draw(ctx, mulberry32(seed));
  const tex = new THREE.CanvasTexture(el);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** 地板：冷灰石砖，2×2 块、2px 勾缝，加零散噪点。 */
function drawFloor(ctx: CanvasRenderingContext2D, rand: () => number, tint: 'normal' | 'goal' = 'normal'): void {
  px(ctx, 0, 0, SIZE, SIZE, '#525968');
  const shades = tint === 'goal' ? ['#585a54', '#54564f', '#5c5e57', '#50524b'] : ['#646b7b', '#5f6676', '#6a7181', '#5a6170'];
  const blocks = [
    [0, 0],
    [16, 0],
    [0, 16],
    [16, 16],
  ];
  blocks.forEach(([bx, by], i) => {
    px(ctx, bx!, by!, 15, 15, shades[i]!);
  });
  // 勾缝
  px(ctx, 15, 0, 1, SIZE, '#3a3f48');
  px(ctx, 0, 15, SIZE, 1, '#3a3f48');
  px(ctx, 31, 0, 1, SIZE, '#33373f');
  px(ctx, 0, 31, SIZE, 1, '#33373f');
  // 噪点
  for (let i = 0; i < 26; i++) {
    const x = (rand() * SIZE) | 0;
    const y = (rand() * SIZE) | 0;
    px(ctx, x, y, 1, 1, rand() > 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.16)');
  }
  // 四角高光
  px(ctx, 1, 1, 3, 1, 'rgba(255,255,255,0.05)');
  px(ctx, 17, 17, 3, 1, 'rgba(255,255,255,0.05)');
}

/** 墙：砖块，错缝砌法，砖缝 2px。 */
function drawWall(ctx: CanvasRenderingContext2D, rand: () => number): void {
  px(ctx, 0, 0, SIZE, SIZE, '#332e28');
  const brickShades = ['#6b6355', '#615a4d', '#736b5c', '#5a5347', '#675f51', '#6f6759'];
  const bh = 8;
  for (let row = 0; row < 4; row++) {
    const offset = row % 2 === 0 ? 0 : 8;
    for (let k = -1; k < 3; k++) {
      const x = offset + k * 16;
      const y = row * bh;
      const c = brickShades[(rand() * brickShades.length) | 0]!;
      px(ctx, x + 1, y + 1, 14, bh - 2, c);
      px(ctx, x + 1, y + 1, 14, 1, 'rgba(255,255,255,0.10)');
      px(ctx, x + 1, y + bh - 2, 14, 1, 'rgba(0,0,0,0.22)');
    }
  }
  for (let i = 0; i < 30; i++) {
    const x = (rand() * SIZE) | 0;
    const y = (rand() * SIZE) | 0;
    px(ctx, x, y, 1, 1, rand() > 0.5 ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.06)');
  }
}

/** 墙顶石板：浅灰整石 + 边框 + 裂纹，和砖侧拉开层次。 */
function drawWallTop(ctx: CanvasRenderingContext2D, rand: () => number): void {
  px(ctx, 0, 0, SIZE, SIZE, '#7f786b');
  for (let i = 0; i < 60; i++) {
    const x = (rand() * SIZE) | 0;
    const y = (rand() * SIZE) | 0;
    px(ctx, x, y, 1, 1, rand() > 0.45 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.12)');
  }
  // 整石边框：上亮下暗，读作一块压出来的石板
  px(ctx, 0, 0, SIZE, 2, '#958d7d');
  px(ctx, 0, 0, 2, SIZE, '#8d8576');
  px(ctx, 0, SIZE - 2, SIZE, 2, '#5f594f');
  px(ctx, SIZE - 2, 0, 2, SIZE, '#645e53');
  // 两道裂纹
  px(ctx, 7, 6, 1, 7, 'rgba(0,0,0,0.22)');
  px(ctx, 8, 12, 4, 1, 'rgba(0,0,0,0.22)');
  px(ctx, 22, 9, 1, 9, 'rgba(0,0,0,0.20)');
  px(ctx, 17, 21, 6, 1, 'rgba(0,0,0,0.18)');
}

/** 木箱：四块竖板 + 深色框 + 铁角。 */
function drawCrate(ctx: CanvasRenderingContext2D, rand: () => number): void {
  px(ctx, 0, 0, SIZE, SIZE, '#a06f38');
  // 竖板
  for (let i = 0; i < 4; i++) {
    const x = i * 8;
    const shade = i % 2 === 0 ? '#b8834a' : '#ab7741';
    px(ctx, x, 2, 7, 28, shade);
    px(ctx, x, 2, 7, 1, 'rgba(255,235,200,0.16)');
    // 木纹
    for (let g = 0; g < 3; g++) {
      const gy = 4 + ((rand() * 23) | 0);
      px(ctx, x + 1, gy, 5, 1, 'rgba(90,52,20,0.28)');
    }
  }
  // 外框
  px(ctx, 0, 0, SIZE, 2, '#7d5222');
  px(ctx, 0, 30, SIZE, 2, '#6d461b');
  px(ctx, 0, 0, 2, SIZE, '#7d5222');
  px(ctx, 30, 0, 2, SIZE, '#6d461b');
  // 铁角
  const corners = [
    [2, 2],
    [24, 2],
    [2, 24],
    [24, 24],
  ];
  for (const [cx, cy] of corners) {
    px(ctx, cx!, cy!, 6, 6, '#8d8c84');
    px(ctx, cx!, cy!, 6, 1, '#c9c7bd');
    px(ctx, cx! + 1, cy! + 1, 4, 4, '#6f6e67');
    px(ctx, cx! + 4, cy! + 2, 1, 1, '#3f3e39');
  }
  // 麻点
  for (let i = 0; i < 18; i++) {
    px(ctx, (rand() * SIZE) | 0, (rand() * SIZE) | 0, 1, 1, 'rgba(60,35,12,0.25)');
  }
}

/** 目标点：地板上画一个琥珀色符文环。 */
function drawGoal(ctx: CanvasRenderingContext2D, rand: () => number): void {
  drawFloor(ctx, rand, 'goal');
  const cx = 16;
  const cy = 16;
  // 环：用像素方块沿圆周摆，保证不出现抗锯齿
  const ring = (r: number, color: string) => {
    for (let a = 0; a < 64; a++) {
      const ang = (a / 64) * Math.PI * 2;
      const x = Math.round(cx + Math.cos(ang) * r - 1);
      const y = Math.round(cy + Math.sin(ang) * r - 1);
      px(ctx, x, y, 2, 2, color);
    }
  };
  ring(9, '#8a5a17');
  ring(8, '#e3a636');
  ring(3, '#f6cf6a');
  px(ctx, 15, 15, 2, 2, '#fff0b8');
  // 四向短刻
  px(ctx, 15, 3, 2, 4, '#c98a22');
  px(ctx, 15, 25, 2, 4, '#c98a22');
  px(ctx, 3, 15, 4, 2, '#c98a22');
  px(ctx, 25, 15, 4, 2, '#c98a22');
}

/** 脸：贴在头部 +Z 面。 */
function drawFace(ctx: CanvasRenderingContext2D): void {
  px(ctx, 0, 0, 32, 32, '#e8bb8e');
  px(ctx, 0, 0, 32, 2, '#c99a70');
  // 眼睛
  px(ctx, 7, 12, 5, 6, '#2b2118');
  px(ctx, 20, 12, 5, 6, '#2b2118');
  px(ctx, 8, 13, 2, 2, '#ffffff');
  px(ctx, 21, 13, 2, 2, '#ffffff');
  // 眉
  px(ctx, 6, 9, 7, 2, '#5b3f2a');
  px(ctx, 19, 9, 7, 2, '#5b3f2a');
  // 嘴
  px(ctx, 13, 22, 6, 2, '#8e3b32');
  px(ctx, 14, 24, 4, 1, '#c46a5e');
  // 腮红
  px(ctx, 4, 19, 3, 2, 'rgba(214,110,96,0.55)');
  px(ctx, 25, 19, 3, 2, 'rgba(214,110,96,0.55)');
}

/** 衣服（身体正反面）用木纹布感：细横条。 */
function drawCloth(ctx: CanvasRenderingContext2D, rand: () => number): void {
  px(ctx, 0, 0, SIZE, SIZE, '#2f6b9e');
  for (let y = 0; y < SIZE; y += 2) {
    px(ctx, 0, y, SIZE, 1, '#35749f');
  }
  for (let i = 0; i < 20; i++) {
    px(ctx, (rand() * SIZE) | 0, (rand() * SIZE) | 0, 1, 1, 'rgba(255,255,255,0.10)');
  }
  // 腰带
  px(ctx, 0, 24, SIZE, 3, '#5b3f2a');
  px(ctx, 14, 24, 4, 3, '#d9b45a');
}

export interface Textures {
  floor: THREE.CanvasTexture;
  wall: THREE.CanvasTexture;
  wallTop: THREE.CanvasTexture;
  crate: THREE.CanvasTexture;
  goal: THREE.CanvasTexture;
  face: THREE.CanvasTexture;
  cloth: THREE.CanvasTexture;
}

export function createTextures(): Textures {
  return {
    floor: canvas((ctx, rand) => drawFloor(ctx, rand), 1337),
    wall: canvas((ctx, rand) => drawWall(ctx, rand), 4242),
    wallTop: canvas((ctx, rand) => drawWallTop(ctx, rand), 6060),
    crate: canvas((ctx, rand) => drawCrate(ctx, rand), 90210),
    goal: canvas((ctx, rand) => drawGoal(ctx, rand), 555),
    face: canvas((ctx) => drawFace(ctx), 1),
    cloth: canvas((ctx, rand) => drawCloth(ctx, rand), 777),
  };
}
