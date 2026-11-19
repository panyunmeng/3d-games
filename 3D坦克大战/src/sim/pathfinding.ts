import { GRID_H, GRID_W, TILE, TILE_BRICK, TILE_FOREST, TILE_STEEL, TILE_WATER } from './constants';
import { inBounds, idx, tileAt } from './map';
import type { Cell, MapState } from './types';

/** 寻路用可走性：砖墙可穿但代价高（AI 会朝它开炮开路），钢墙与水不可走。 */
function stepCost(map: MapState, cx: number, cz: number): number {
  if (!inBounds(cx, cz)) return Infinity;
  const t = tileAt(map, cx, cz);
  if (t === TILE_STEEL || t === TILE_WATER) return Infinity;
  if (t === TILE_BRICK) return 8;
  return 1;
}

const NEIGHBORS: ReadonlyArray<[number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

class MinHeap {
  private heap: number[] = [];
  private keys: number[] = [];

  get size(): number {
    return this.heap.length;
  }

  push(node: number, key: number): void {
    this.heap.push(node);
    this.keys.push(key);
    let i = this.heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= this.keys[i]) break;
      this.swap(parent, i);
      i = parent;
    }
  }

  pop(): number {
    const top = this.heap[0];
    const lastNode = this.heap.pop() as number;
    const lastKey = this.keys.pop() as number;
    if (this.heap.length > 0) {
      this.heap[0] = lastNode;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let smallest = i;
        if (l < this.heap.length && this.keys[l] < this.keys[smallest]) smallest = l;
        if (r < this.heap.length && this.keys[r] < this.keys[smallest]) smallest = r;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const n = this.heap[a];
    this.heap[a] = this.heap[b];
    this.heap[b] = n;
    const k = this.keys[a];
    this.keys[a] = this.keys[b];
    this.keys[b] = k;
  }
}

const OCTILE = Math.SQRT2 - 2; // 八向启发式常数

function heuristic(ax: number, az: number, bx: number, bz: number): number {
  const dx = Math.abs(ax - bx);
  const dz = Math.abs(az - bz);
  return Math.max(dx, dz) + OCTILE * Math.min(dx, dz);
}

export interface PathOptions {
  /** 是否允许穿砖（默认允许，代价高）。 */
  allowBrick?: boolean;
  /** 找路失败时放宽：允许走到目标相邻格。 */
  adjacentGoal?: boolean;
}

/**
 * A* 寻路。返回从起点（不含）到终点（含）的格子序列；不可达返回 null。
 * 网格 26×26，单次寻路成本极低（敌人 0.5～1 s 重算一次）。
 */
export function findPath(
  map: MapState,
  start: Cell,
  goal: Cell,
  opts: PathOptions = {},
): Cell[] | null {
  if (!inBounds(start.cx, start.cz) || !inBounds(goal.cx, goal.cz)) return null;
  const allowBrick = opts.allowBrick ?? true;
  const cost = (cx: number, cz: number): number => {
    const c = stepCost(map, cx, cz);
    if (c === Infinity) return c;
    if (!allowBrick && c > 1) return Infinity;
    return c;
  };
  if (cost(goal.cx, goal.cz) === Infinity) {
    if (!opts.adjacentGoal) return null;
    // 目标被占（例如另一辆坦克停在上面）：退而求其次，走到它旁边。
    let best: Cell | null = null;
    let bestD = Infinity;
    for (const [dx, dz] of NEIGHBORS) {
      const cx = goal.cx + dx;
      const cz = goal.cz + dz;
      if (cost(cx, cz) === Infinity) continue;
      const d = Math.hypot(cx - start.cx, cz - start.cz);
      if (d < bestD) {
        bestD = d;
        best = { cx, cz };
      }
    }
    if (!best) return null;
    return findPath(map, start, best, { ...opts, adjacentGoal: false });
  }

  const n = GRID_W * GRID_H;
  const gScore = new Float64Array(n).fill(Infinity);
  const fScore = new Float64Array(n).fill(Infinity);
  const cameFrom = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);

  const startIdx = idx(start.cx, start.cz);
  const goalIdx = idx(goal.cx, goal.cz);
  gScore[startIdx] = 0;
  fScore[startIdx] = heuristic(start.cx, start.cz, goal.cx, goal.cz);
  const open = new MinHeap();
  open.push(startIdx, fScore[startIdx]);

  while (open.size > 0) {
    const cur = open.pop();
    if (cur === goalIdx) {
      const path: Cell[] = [];
      let node = cur;
      while (node !== startIdx && node !== -1) {
        path.push({ cx: node % GRID_W, cz: Math.floor(node / GRID_W) });
        node = cameFrom[node];
      }
      return path.reverse();
    }
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % GRID_W;
    const cz = Math.floor(cur / GRID_W);
    for (const [dx, dz, base] of NEIGHBORS) {
      const nx = cx + dx;
      const nz = cz + dz;
      const c = cost(nx, nz);
      if (c === Infinity) continue;
      // 斜走时两肩都不能被挡，避免贴角穿墙。
      if (dx !== 0 && dz !== 0) {
        if (cost(cx + dx, cz) === Infinity || cost(cx, cz + dz) === Infinity) continue;
      }
      const ni = idx(nx, nz);
      if (closed[ni]) continue;
      const tentative = gScore[cur] + base * c;
      if (tentative < gScore[ni]) {
        cameFrom[ni] = cur;
        gScore[ni] = tentative;
        fScore[ni] = tentative + heuristic(nx, nz, goal.cx, goal.cz);
        open.push(ni, fScore[ni]);
      }
    }
  }
  return null;
}

/** 视线：子弹与观察共用。树林挡视线（AI 看不见林中的对手），水不挡。 */
export function hasLineOfSight(
  map: MapState,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
): boolean {
  const dist = Math.hypot(x1 - x0, z1 - z0);
  const steps = Math.max(1, Math.ceil(dist / 0.4));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t;
    const z = z0 + (z1 - z0) * t;
    const cx = Math.floor(x / 2);
    const cz = Math.floor(z / 2);
    const tile = tileAt(map, cx, cz);
    if (tile === TILE_BRICK || tile === TILE_STEEL || tile === TILE_FOREST) return false;
  }
  return true;
}

/** 格子中心世界坐标（供 AI 沿路径行走）。 */
export function cellToWorld(cell: Cell): { x: number; z: number } {
  return { x: (cell.cx + 0.5) * TILE, z: (cell.cz + 0.5) * TILE };
}
