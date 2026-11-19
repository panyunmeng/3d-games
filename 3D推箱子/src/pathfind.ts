// 点击寻路：只做「玩家能走到哪里」，不做求解器。
//
// 约束：箱子是障碍；寻路只算玩家可走区域。
// 点击箱子的语义：走到能推它的那一侧，再推一步；
// 多个可推方向时取总步数最少的一个（同分按 上/右/下/左 稳定排序）。

import { DIRS, type Game } from './sokoban';

export interface Plan {
  /** 依次要执行的方向，最后一步可能是推动 */
  dirs: number[];
  /** 最后一步是否推箱（用于 UI 提示） */
  pushes: boolean;
}

const MAX_CELLS = 64 * 64;

/** 单次 BFS 得到全图距离场；prevDir[cell] 表示从哪一步进来。 */
function field(game: Game): { dist: Int32Array; prevDir: Int8Array } {
  const { level, state } = game;
  const n = level.width * level.height;
  const dist = new Int32Array(n).fill(-1);
  const prevDir = new Int8Array(n).fill(-1);
  if (n > MAX_CELLS) throw new Error('关卡过大');
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  const start = state.player;
  dist[start] = 0;
  queue[tail++] = start;
  while (head < tail) {
    const cur = queue[head++]!;
    const col = cur % level.width;
    const row = (cur / level.width) | 0;
    const d = dist[cur]! + 1;
    for (let dir = 0; dir < 4; dir++) {
      const [dx, dy] = DIRS[dir]!;
      const nc = col + dx;
      const nr = row + dy;
      if (nc < 0 || nr < 0 || nc >= level.width || nr >= level.height) continue;
      const next = nr * level.width + nc;
      if (dist[next] !== -1) continue;
      if (level.wall[next] || state.occupied[next]) continue;
      dist[next] = d;
      prevDir[next] = dir;
      queue[tail++] = next;
    }
  }
  return { dist, prevDir };
}

function trace(game: Game, f: { dist: Int32Array; prevDir: Int8Array }, target: number): number[] | null {
  if (f.dist[target]! < 0) return null;
  const dirs: number[] = [];
  let cur = target;
  while (cur !== game.state.player) {
    const dir = f.prevDir[cur]!;
    if (dir < 0) return null;
    dirs.push(dir);
    const [dx, dy] = DIRS[dir]!;
    cur = cur - (dy * game.level.width + dx);
  }
  return dirs.reverse();
}

/** 点击某格后的行动计划；不可达 / 不是有效目标时返回 null。 */
export function planClick(game: Game, target: number): Plan | null {
  const { level, state } = game;
  if (target === state.player) return null;
  if (level.wall[target]) return null;
  const f = field(game);

  // 空地：直接走过去
  if (!state.occupied[target]) {
    const dirs = trace(game, f, target);
    return dirs && dirs.length ? { dirs, pushes: false } : null;
  }

  // 箱子：找一个能站住、且推得动的方向，取总步数最少的
  let best: { dirs: number[]; cost: number } | null = null;
  for (let dir = 0; dir < 4; dir++) {
    const [dx, dy] = DIRS[dir]!;
    const bx = target % level.width;
    const by = (target / level.width) | 0;
    const sx = bx - dx;
    const sy = by - dy;
    const tx = bx + dx;
    const ty = by + dy;
    if (sx < 0 || sy < 0 || sx >= level.width || sy >= level.height) continue;
    if (tx < 0 || ty < 0 || tx >= level.width || ty >= level.height) continue;
    const stand = sy * level.width + sx;
    const dest = ty * level.width + tx;
    if (level.wall[stand] || state.occupied[stand]) continue;
    if (level.wall[dest] || state.occupied[dest]) continue;
    const walk = trace(game, f, stand);
    if (!walk) continue;
    const cost = walk.length + 1;
    if (!best || cost < best.cost) best = { dirs: [...walk, dir], cost };
  }
  return best ? { dirs: best.dirs, pushes: true } : null;
}
