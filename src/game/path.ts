import { clamp } from '../core/math';
import type { Vec2 } from '../core/math';

export interface PathSample {
  x: number;
  z: number;
  /** 单位切向 */
  tx: number;
  tz: number;
}

/** 折线路点轨迹：按弧长采样，供敌人沿路前进 */
export class PathTrack {
  readonly points: Vec2[];
  readonly cumulative: number[];
  readonly total: number;

  constructor(points: Vec2[]) {
    if (points.length < 2) throw new Error('PathTrack 至少需要两个路点');
    this.points = points.map((p) => ({ x: p.x, z: p.z }));
    this.cumulative = [0];
    let sum = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      sum += Math.hypot(b.x - a.x, b.z - a.z);
      this.cumulative.push(sum);
    }
    this.total = sum;
  }

  sample(dist: number): PathSample {
    const d = clamp(dist, 0, this.total);
    let i = 1;
    while (i < this.cumulative.length - 1 && this.cumulative[i]! < d) i++;
    const a = this.points[i - 1]!;
    const b = this.points[i]!;
    const segStart = this.cumulative[i - 1]!;
    const segLen = Math.max(1e-6, this.cumulative[i]! - segStart);
    const t = clamp((d - segStart) / segLen, 0, 1);
    return {
      x: a.x + (b.x - a.x) * t,
      z: a.z + (b.z - a.z) * t,
      tx: (b.x - a.x) / segLen,
      tz: (b.z - a.z) / segLen,
    };
  }

  /** 点到折线的最短距离，以及最近点对应的弧长 */
  nearest(x: number, z: number): { dist: number; along: number } {
    let best = Infinity;
    let along = 0;
    for (let i = 1; i < this.points.length; i++) {
      const a = this.points[i - 1]!;
      const b = this.points[i]!;
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const len2 = abx * abx + abz * abz;
      const t = len2 < 1e-9 ? 0 : clamp(((x - a.x) * abx + (z - a.z) * abz) / len2, 0, 1);
      const px = a.x + abx * t;
      const pz = a.z + abz * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < best) {
        best = d;
        along = this.cumulative[i - 1]! + Math.hypot(px - a.x, pz - a.z);
      }
    }
    return { dist: best, along };
  }
}
