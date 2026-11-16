/**
 * 粒子池：一个 Points 对象 + 固定容量环形缓冲，所有爆炸/扬尘/烟花共用。
 *
 * 为什么不用「每次爆炸 new 一个 Points」：挖开 0 格会一次掀开几十个格子，
 * 每格发一个对象会让 GC 抖动；固定池只更新属性缓冲，帧率稳定。
 * 淡出用「颜色乘以剩余寿命」实现：加色混合下颜色归零就是不可见，省掉自定义 shader。
 */
import * as THREE from '../vendor/three.module.js';

const TMP = new THREE.Color();

export class Particles {
  constructor(scene, capacity = 2200) {
    this.capacity = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.base = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.cursor = 0;

    // 初始全部藏到地下，颜色为黑（加色混合下即不可见）
    for (let i = 0; i < capacity; i++) this.pos[i * 3 + 1] = -999;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));

    const mat = new THREE.PointsMaterial({
      size: 0.17,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.geo = geo;
    this.mat = mat;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {{count?:number, color?:THREE.Color|number|string, speed?:number, spread?:number,
   *          rise?:number, gravity?:number, life?:number, lifeJitter?:number}} [opts]
   */
  spawn(x, y, z, opts = {}) {
    const count = opts.count ?? 10;
    const base = opts.color !== undefined ? TMP.set(opts.color) : TMP.set(0xffb066);
    const speed = opts.speed ?? 2.2;
    const spread = opts.spread ?? 0.3;
    const rise = opts.rise ?? 1.6;
    const gravity = opts.gravity ?? 6;
    const life = opts.life ?? 0.7;
    const jitter = opts.lifeJitter ?? 0.35;

    for (let k = 0; k < count; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;
      const p = i * 3;

      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * spread;
      this.pos[p] = x + Math.cos(a) * r;
      this.pos[p + 1] = y + Math.random() * 0.12;
      this.pos[p + 2] = z + Math.sin(a) * r;

      const sp = speed * (0.35 + Math.random() * 0.9);
      this.vel[p] = Math.cos(a) * sp;
      this.vel[p + 1] = rise * (0.2 + Math.random());
      this.vel[p + 2] = Math.sin(a) * sp;

      const b = 0.55 + Math.random() * 0.75;
      this.base[p] = Math.min(1, base.r * b);
      this.base[p + 1] = Math.min(1, base.g * b);
      this.base[p + 2] = Math.min(1, base.b * b);
      this.col[p] = this.base[p];
      this.col[p + 1] = this.base[p + 1];
      this.col[p + 2] = this.base[p + 2];

      const l = Math.max(0.08, life * (1 - jitter + Math.random() * jitter * 2));
      this.life[i] = l;
      this.maxLife[i] = l;
      this.gravity[i] = gravity;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }

  update(dt) {
    let anyAlive = false;
    for (let i = 0; i < this.capacity; i++) {
      const l = this.life[i];
      if (l <= 0) continue;
      anyAlive = true;
      const p = i * 3;
      const nl = l - dt;
      this.life[i] = nl;

      if (nl <= 0) {
        this.pos[p + 1] = -999;
        this.col[p] = this.col[p + 1] = this.col[p + 2] = 0;
        continue;
      }

      this.vel[p + 1] -= this.gravity[i] * dt;
      this.pos[p] += this.vel[p] * dt;
      this.pos[p + 1] += this.vel[p + 1] * dt;
      this.pos[p + 2] += this.vel[p + 2] * dt;

      // 生命末段压暗到黑，加色混合下等于淡出
      const k = Math.min(1, nl / Math.max(0.0001, this.maxLife[i]));
      const f = k * k;
      this.col[p] = this.base[p] * f;
      this.col[p + 1] = this.base[p + 1] * f;
      this.col[p + 2] = this.base[p + 2] * f;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    return anyAlive;
  }

  clear() {
    for (let i = 0; i < this.capacity; i++) {
      this.life[i] = 0;
      this.pos[i * 3 + 1] = -999;
      this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }

  dispose() {
    this.points.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}
