// 规则引擎：经典推箱子。
//
// 事实约束（不是惯例，是规则本身）：
//   1. 棋盘是 2D 正交格网，玩家每步移动到四邻格之一；
//   2. 玩家不能进墙、不能进箱子；
//   3. 玩家只能「推」不能「拉」：箱子后面那一格必须空（非墙非箱）；
//   4. 全部箱子都压在目标点上即胜利。
// 这些约束与 3D 渲染完全解耦：渲染层只读 state，不参与判定。

import { LEVELS, type RawLevel } from './levels';

export const DIRS = [
  [0, -1], // 0 up
  [1, 0], // 1 right
  [0, 1], // 2 down
  [-1, 0], // 3 left
] as const;

export const DIR_NAME = ['上', '右', '下', '左'] as const;

export interface Level {
  id: number;
  name: string;
  width: number;
  height: number;
  /** 1 = 墙 */
  wall: Uint8Array;
  /** 1 = 有地板（从玩家位置洪泛得到的内部区域），墙格为 0 */
  inside: Uint8Array;
  /** 1 = 目标点 */
  goal: Uint8Array;
  /** 初始箱子格索引 */
  boxes: number[];
  /** 初始玩家格索引 */
  player: number;
}

const WALL = '#';

export function cellIndex(level: Level, col: number, row: number): number {
  return row * level.width + col;
}

export function cellCol(level: Level, idx: number): number {
  return idx % level.width;
}

export function cellRow(level: Level, idx: number): number {
  return (idx / level.width) | 0;
}

/** 把 .sok 文本展开成 Level；做边界闭合校验，发现漏口直接报错而不是画歪。 */
export function parseLevel(raw: RawLevel): Level {
  const height = raw.rows.length;
  const width = Math.max(...raw.rows.map((r) => r.length));
  const wall = new Uint8Array(width * height);
  const goal = new Uint8Array(width * height);
  const boxes: number[] = [];
  let player = -1;

  for (let row = 0; row < height; row++) {
    const line = raw.rows[row] ?? '';
    for (let col = 0; col < width; col++) {
      const ch = line[col] ?? ' ';
      const idx = cellIndex({ width } as Level, col, row);
      if (ch === WALL) wall[idx] = 1;
      if (ch === '.' || ch === '*' || ch === '+') goal[idx] = 1;
      if (ch === '$' || ch === '*') boxes.push(idx);
      if (ch === '@' || ch === '+') player = idx;
    }
  }

  if (player < 0) throw new Error(`关卡 ${raw.id} 没有玩家`);

  // 内部区域：从玩家开始，只走非墙格。关卡若是闭合的，这里不会漏到边界外。
  const inside = new Uint8Array(width * height);
  const queue: number[] = [player];
  inside[player] = 1;
  for (let head = 0; head < queue.length; head++) {
    const idx = queue[head]!;
    const col = idx % width;
    const row = (idx / width) | 0;
    for (const [dx, dy] of DIRS) {
      const nc = col + dx;
      const nr = row + dy;
      if (nc < 0 || nr < 0 || nc >= width || nr >= height) continue;
      const nidx = nr * width + nc;
      if (inside[nidx] || wall[nidx]) continue;
      inside[nidx] = 1;
      queue.push(nidx);
    }
  }

  return {
    id: raw.id,
    name: raw.name,
    width,
    height,
    wall,
    inside,
    goal,
    boxes,
    player,
  };
}

export const LEVEL_CACHE: Level[] = LEVELS.map(parseLevel);

export interface Step {
  dir: number;
  from: number;
  to: number;
  boxFrom: number;
  boxTo: number;
}

export interface GameState {
  player: number;
  /** 升序无关，只用来遍历；占用判定走 occupied */
  boxes: number[];
  occupied: Uint8Array;
}

export function initialState(level: Level): GameState {
  const occupied = new Uint8Array(level.width * level.height);
  for (const b of level.boxes) occupied[b] = 1;
  return { player: level.player, boxes: [...level.boxes], occupied };
}

export class Game {
  readonly level: Level;
  state: GameState;
  moves = 0;
  pushes = 0;
  private readonly undoStack: Step[] = [];

  constructor(level: Level) {
    this.level = level;
    this.state = initialState(level);
  }

  reset(): void {
    this.state = initialState(this.level);
    this.moves = 0;
    this.pushes = 0;
    this.undoStack.length = 0;
  }

  /** 判断某方向能否走；能走返回这一步的完整信息，不能返回 null。 */
  probe(dir: number): Step | null {
    const { level, state } = this;
    const { width, wall, height } = level;
    const { occupied } = state;
    const step = DIRS[dir];
    if (!step) return null;
    const [dx, dy] = step;
    const col = this.state.player % width;
    const row = (this.state.player / width) | 0;
    const nc = col + dx;
    const nr = row + dy;
    if (nc < 0 || nr < 0 || nc >= width || nr >= height) return null;
    const to = nr * width + nc;
    if (wall[to]) return null;

    let boxFrom = -1;
    let boxTo = -1;
    if (occupied[to]) {
      const bc = nc + dx;
      const br = nr + dy;
      if (bc < 0 || br < 0 || bc >= width || br >= height) return null;
      const beyond = br * width + bc;
      if (wall[beyond] || occupied[beyond]) return null; // 推不动：后面是墙或箱子
      boxFrom = to;
      boxTo = beyond;
    }
    return { dir, from: this.state.player, to, boxFrom, boxTo };
  }

  /** 执行一步（先 probe 再走），写入撤销栈。 */
  move(dir: number): Step | null {
    const step = this.probe(dir);
    if (!step) return null;
    this.apply(step);
    return step;
  }

  private apply(step: Step): void {
    const { occupied } = this.state;
    if (step.boxFrom >= 0) {
      occupied[step.boxFrom] = 0;
      occupied[step.boxTo] = 1;
      const i = this.state.boxes.indexOf(step.boxFrom);
      if (i >= 0) this.state.boxes[i] = step.boxTo;
      this.pushes++;
    }
    this.state.player = step.to;
    this.moves++;
    this.undoStack.push(step);
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /** 回退一步，返回被撤销的步骤（调用方据此让渲染层同步位置）。 */
  undo(): Step | null {
    const step = this.undoStack.pop();
    if (!step) return null;
    const { occupied } = this.state;
    if (step.boxFrom >= 0) {
      occupied[step.boxTo] = 0;
      occupied[step.boxFrom] = 1;
      const i = this.state.boxes.indexOf(step.boxTo);
      if (i >= 0) this.state.boxes[i] = step.boxFrom;
      this.pushes = Math.max(0, this.pushes - 1);
    }
    this.state.player = step.from;
    this.moves = Math.max(0, this.moves - 1);
    return step;
  }

  isSolved(): boolean {
    if (this.state.boxes.length !== this.goalCount()) return false;
    for (const b of this.state.boxes) if (!this.level.goal[b]) return false;
    return true;
  }

  private goalCache = -1;
  goalCount(): number {
    if (this.goalCache < 0) {
      let n = 0;
      for (let i = 0; i < this.level.goal.length; i++) n += this.level.goal[i]!;
      this.goalCache = n;
    }
    return this.goalCache;
  }
}
