/**
 * 扫雷规则核心：纯数据，不碰 DOM / three，可在 Node 里直接单测。
 *
 * 规则（与经典扫雷一致，唯一差异是首击必定安全）：
 *  R1 格子三态：未挖开 / 已挖开 / 已插旗。插旗不挖开。
 *  R2 首次左键挖开时才布雷，且该格及其 8 邻域必定无雷 —— 保证首击是 0 格，开局必展开一片。
 *  R3 挖到数字格只开这一格；挖到 0 格连锁展开周围，已插旗的格不被连锁打开。
 *  R4 踩雷立即失败，不做任何补救（撤销只在未结束时可用）。
 *  R5 所有非雷格都被挖开即胜利。
 *  R6 旗子数量上限 = 雷数，防止插旗数超过雷数造成「剩余雷数」失真。
 *  R7 撤销 / 提示各限 3 次，且只要用过其一，本局记为「练习局」，不写最佳成绩。
 */

import { createRng, randomSeed } from './rng.js';
import { UNDO_LIMIT, HINT_LIMIT } from './config.js';

export const HIDDEN = 0;
export const REVEALED = 1;
export const FLAGGED = 2;

export { UNDO_LIMIT, HINT_LIMIT };

export class Game {
  /**
   * @param {{cols:number, rows:number, mines:number}} level
   * @param {string} [seed]
   */
  constructor(level, seed) {
    const { cols, rows, mines } = level;
    if (!Number.isInteger(cols) || cols < 3 || !Number.isInteger(rows) || rows < 3) {
      throw new Error('棋盘至少 3×3');
    }
    if (!Number.isInteger(mines) || mines < 1 || mines > cols * rows - 9) {
      throw new Error('雷数与棋盘尺寸不匹配');
    }
    this.cols = cols;
    this.rows = rows;
    this.mineCount = mines;
    this.seed = seed || randomSeed();
    this.reset(this.seed);
  }

  get size() {
    return this.cols * this.rows;
  }

  get totalSafe() {
    return this.size - this.mineCount;
  }

  /** 剩余雷数 = 雷数 − 已插旗数。 */
  get remaining() {
    return this.mineCount - this.flags;
  }

  /** 已完成比例，供进度条用。 */
  get progress() {
    return this.totalSafe === 0 ? 1 : this.revealedSafe / this.totalSafe;
  }

  get isOver() {
    return this.status === 'won' || this.status === 'lost';
  }

  reset(seed = this.seed) {
    this.seed = seed;
    const n = this.size;
    this.state = new Uint8Array(n); // HIDDEN / REVEALED / FLAGGED
    this.mine = new Uint8Array(n); // 0 / 1
    this.adj = new Uint8Array(n); // 邻域雷数 0..8

    // 8 邻域表：一次算好，后续 flood / 胜负判定都直接查
    this.nbrs = new Array(n);
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const list = [];
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const rr = r + dr;
            const cc = c + dc;
            if (rr < 0 || rr >= this.rows || cc < 0 || cc >= this.cols) continue;
            list.push(rr * this.cols + cc);
          }
        }
        this.nbrs[r * this.cols + c] = list;
      }
    }

    this.flags = 0;
    this.revealedSafe = 0;
    this.status = 'idle'; // idle | playing | won | lost
    this.minesPlaced = false;
    this.firstIndex = -1;
    this.explodedIndex = -1;
    this.assisted = false;
    this.undoUsed = 0;
    this.hintUsed = 0;
    this.undoStack = [];
    this.rng = createRng(this.seed);
  }

  indexOf(col, row) {
    return row * this.cols + col;
  }

  /** 把 8 邻域表暴露出去给渲染层做悬停提示等只读用途。 */
  neighbors(index) {
    return this.nbrs[index];
  }

  /** 玩家看到的格子形态（含结算后翻开的雷、插错的旗）。渲染层直接消费它。 */
  cellVisual(index) {
    const st = this.state[index];
    if (this.status === 'lost') {
      if (this.mine[index]) return index === this.explodedIndex ? 'exploded' : 'mine';
      if (st === FLAGGED) return 'wrongflag';
    }
    if (this.status === 'won' && this.mine[index]) return 'flag';
    if (st === REVEALED) return 'open';
    if (st === FLAGGED) return 'flag';
    return 'hidden';
  }

  /** 左键挖开。返回 {ok, opened, status, reason, mine}。 */
  reveal(index) {
    if (this.isOver) return { ok: false, reason: 'over' };
    if (!Number.isInteger(index) || index < 0 || index >= this.size) {
      return { ok: false, reason: 'range' };
    }
    const st = this.state[index];
    if (st === FLAGGED) return { ok: false, reason: 'flagged' };
    if (st === REVEALED) return { ok: false, reason: 'revealed' };

    const isFirstReveal = !this.minesPlaced;
    if (isFirstReveal) {
      this.minesPlaced = true;
      this.firstIndex = index;
      this.placeMines(index);
      this.status = 'playing';
    }

    if (this.mine[index]) {
      this.state[index] = REVEALED;
      this.explodedIndex = index;
      this.status = 'lost';
      return { ok: true, opened: [index], status: 'lost', mine: true };
    }

    // 快照在展开之前取：撤销要能退回到这次展开之前
    const snap = this.snapshot();
    const opened = this.flood(index);
    // 首击没有「更早的状态」可回退，不占撤销次数（否则会退回空盘）
    if (!isFirstReveal) {
      this.undoStack.push(snap);
      if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    }

    this.checkWin();
    return { ok: true, opened, status: this.status, mine: false };
  }

  /** 右键插旗 / 取消插旗。 */
  toggleFlag(index) {
    if (this.isOver) return { ok: false, reason: 'over' };
    if (!Number.isInteger(index) || index < 0 || index >= this.size) {
      return { ok: false, reason: 'range' };
    }
    const st = this.state[index];
    if (st === REVEALED) return { ok: false, reason: 'revealed' };
    if (st === FLAGGED) {
      this.state[index] = HIDDEN;
      this.flags -= 1;
      return { ok: true, flagged: false };
    }
    if (this.flags >= this.mineCount) return { ok: false, reason: 'limit' };
    this.state[index] = FLAGGED;
    this.flags += 1;
    return { ok: true, flagged: true };
  }

  /**
   * 提示一格：优先挑贴着已挖开区域的未挖开安全格（对推进有用），否则随便挑一个安全格。
   * 返回 {index, result} 或 null（次数用完 / 已结束 / 没得提示）。
   */
  hint() {
    if (this.isOver) return null;
    if (this.hintUsed >= HINT_LIMIT) return null;

    const frontier = [];
    const rest = [];
    for (let i = 0; i < this.size; i++) {
      if (this.state[i] !== HIDDEN || this.mine[i]) continue;
      rest.push(i);
      const hasOpen = this.nbrs[i].some((nb) => this.state[nb] === REVEALED);
      if (hasOpen) frontier.push(i);
    }
    const pool = frontier.length ? frontier : rest;
    if (!pool.length) return null;

    const pick = pool[Math.floor(this.rng() * pool.length)];
    this.hintUsed += 1;
    this.assisted = true;
    const result = this.reveal(pick);
    return { index: pick, result };
  }

  /** 撤销最近一次挖开（不撤销插旗，不能撤销爆炸）。 */
  undo() {
    if (this.isOver) return false;
    if (this.undoUsed >= UNDO_LIMIT) return false;
    const snap = this.undoStack.pop();
    if (!snap) return false;
    this.state.set(snap.state);
    this.flags = snap.flags;
    this.revealedSafe = snap.revealedSafe;
    this.status = snap.status;
    this.explodedIndex = -1;
    this.undoUsed += 1;
    this.assisted = true;
    return true;
  }

  snapshot() {
    return {
      state: Uint8Array.from(this.state),
      flags: this.flags,
      revealedSafe: this.revealedSafe,
      status: this.status,
    };
  }

  /** 布雷：首击格及其 8 邻域留空，其余格洗牌后取前 N 个。 */
  placeMines(safeIndex) {
    const blocked = new Set(this.nbrs[safeIndex]);
    blocked.add(safeIndex);
    let candidates = [];
    for (let i = 0; i < this.size; i++) if (!blocked.has(i)) candidates.push(i);

    // 极端小盘可能凑不够；退化到只排除首击格本身
    if (candidates.length < this.mineCount) {
      candidates = [];
      for (let i = 0; i < this.size; i++) if (i !== safeIndex) candidates.push(i);
    }
    if (candidates.length < this.mineCount) {
      throw new Error('棋盘太小，放不下这么多雷');
    }

    const rng = this.rng;
    for (let k = 0; k < this.mineCount; k++) {
      const j = k + Math.floor(rng() * (candidates.length - k));
      const tmp = candidates[k];
      candidates[k] = candidates[j];
      candidates[j] = tmp;
      this.mine[candidates[k]] = 1;
    }

    const adj = this.adj;
    adj.fill(0);
    for (let i = 0; i < this.size; i++) {
      if (!this.mine[i]) continue;
      for (const nb of this.nbrs[i]) adj[nb] += 1;
    }
  }

  /** 连锁展开：0 格把邻居压栈，数字格只自己开。已插旗的格保持不动。 */
  flood(start) {
    const opened = [];
    const stack = [start];
    while (stack.length) {
      const c = stack.pop();
      if (this.state[c] !== HIDDEN || this.mine[c]) continue;
      this.state[c] = REVEALED;
      this.revealedSafe += 1;
      opened.push(c);
      if (this.adj[c] === 0) {
        for (const nb of this.nbrs[c]) {
          if (this.state[nb] === HIDDEN && !this.mine[nb]) stack.push(nb);
        }
      }
    }
    return opened;
  }

  checkWin() {
    if (this.revealedSafe !== this.totalSafe) return;
    this.status = 'won';
    // 胜利时把剩余雷自动插旗：HUD 的「剩余雷数」要归零，不能还挂着未插旗的雷数
    for (let i = 0; i < this.size; i++) {
      if (this.mine[i]) this.state[i] = FLAGGED;
    }
    this.flags = this.mineCount;
  }
}
