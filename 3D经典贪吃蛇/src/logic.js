/**
 * 纯逻辑层：不 import three.js，不碰 DOM，可在 node 里直接跑单测。
 *
 * 为什么这样切：蛇的规则是离散的（格坐标、每 tick 走一格、碰撞是集合判定），
 * 视觉是连续的（每帧插值）。把两者混在一个 update() 里，速度变化会污染碰撞结果，
 * 也没法给规则写确定性测试。这里只输出“状态 + 事件”，渲染层消费事件做表现。
 *
 * 坐标约定：x 向右，y 向下（渲染时 y→世界 z），所以“向上走”是 dir={x:0,y:-1}。
 * snake[0] 永远是头。
 */
import {
  COLS, ROWS, TICK_MIN, TICK_MAX,
  LEVEL_TUNING, ENDLESS_TUNING, ITEM_TYPES, ITEM_SPAWN_EVERY, ITEM_TTL, SCORE,
} from './config.js';

export const DIRS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export const cellKey = (x, y) => `${x},${y}`;
export const sameCell = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** 可复现随机：同一 seed 的同一串操作必然得到同一局，测试和回放都靠它。 */
export function createRng(seed = 1) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------- 难度曲线（纯函数，便于单测） ---------------- */

export function levelTarget(level) {
  return LEVEL_TUNING.baseTarget + LEVEL_TUNING.targetStep * (level - 1);
}
export function levelTimeLimit(level) {
  return LEVEL_TUNING.baseTime + LEVEL_TUNING.timeStep * (level - 1);
}
export function obstaclesForLevel(level) {
  if (level <= 1) return 0;
  return Math.min(LEVEL_TUNING.maxObstacles, 4 + LEVEL_TUNING.obstaclesStep * (level - 2));
}
export function clearBonus(state) {
  return Math.max(0, Math.round(state.levelTimeLeft / 1000) * LEVEL_TUNING.clearBonusPerSec);
}

/** 分数随进度涨，让“多活一会儿”不是唯一得分方式。 */
export function foodValue(state) {
  if (state.mode === 'level') return SCORE.food + SCORE.foodPerLevel * (state.level - 1);
  return SCORE.food + ENDLESS_TUNING.scoreStep * Math.floor(state.totalEaten / ENDLESS_TUNING.scoreEvery);
}

/** 不含道具加成的基础步长：无尽模式按累计食物数分档，关卡制按关卡数。 */
export function baseTick(state) {
  if (state.mode === 'level') {
    return Math.max(72, LEVEL_TUNING.baseTick - LEVEL_TUNING.tickStep * (state.level - 1));
  }
  return Math.max(72, ENDLESS_TUNING.baseTick -
    ENDLESS_TUNING.tickStep * Math.floor(state.totalEaten / ENDLESS_TUNING.foodsPerStep));
}

/** 实际步长 = 基础步长 × 道具倍率，并夹在安全区间内。 */
export function tickMs(state) {
  let mul = 1;
  if (state.timers.speed > 0) mul *= ITEM_TYPES.speed.mul;
  if (state.timers.slow > 0) mul *= ITEM_TYPES.slow.mul;
  return clamp(baseTick(state) * mul, TICK_MIN, TICK_MAX);
}

/* ---------------- 开局 ---------------- */

export function newGame({ mode = 'endless', wall = 'classic', seed = 20260101 } = {}) {
  const cx = Math.floor(COLS / 2);
  // 出生点放在下方而不是正中心：正中心朝上只剩 10 格 ≈ 1.7s，
  // 低于“看到画面 + 判断 + 按键”的实际反应时间，第一局几乎必死。
  // 下移 5 格后是 15 格 ≈ 2.5s，才算给了玩家一次正常的开局。
  const cy = ROWS - 6;
  // 长度 4，头在最上面，身体朝 +y 排开，初始朝上，第一 tick 才有伸展感
  const snake = [];
  for (let i = 0; i < 4; i++) snake.push({ x: cx, y: cy + i });

  const state = {
    mode,
    wall,
    seed,
    rng: createRng(seed),
    cols: COLS,
    rows: ROWS,
    snake,
    prevSnake: snake.map((c) => ({ ...c })),
    dir: { ...DIRS.up },
    pending: [],
    grow: 0,
    food: null,
    item: null,
    obstacles: [],
    eaten: 0,          // 本关（关卡制）或本局（无尽）已吃数
    totalEaten: 0,     // 本局累计，用于无尽难度曲线
    score: 0,
    level: 1,
    levelTarget: mode === 'level' ? levelTarget(1) : 0,
    levelTimeLimit: mode === 'level' ? levelTimeLimit(1) : 0,
    levelTimeLeft: mode === 'level' ? levelTimeLimit(1) : 0,
    timers: { speed: 0, slow: 0, double: 0 },
    foodsSinceItem: 0,
    status: 'playing', // playing | levelclear | dead | timeout
    reason: null,
  };

  if (mode === 'level') addObstacles(state, obstaclesForLevel(1));
  spawnFood(state);
  return state;
}

/* ---------------- 生成器 ---------------- */

function blockedSet(state, extra = []) {
  const set = new Set();
  for (const c of state.snake) set.add(cellKey(c.x, c.y));
  for (const o of state.obstacles) set.add(cellKey(o.x, o.y));
  if (state.food) set.add(cellKey(state.food.x, state.food.y));
  if (state.item) set.add(cellKey(state.item.x, state.item.y));
  for (const c of extra) set.add(cellKey(c.x, c.y));
  return set;
}

/** 随机取空位；先随机采样 400 次，失败再顺序扫，保证一定能返回（除非棋盘真的满了）。 */
function pickFreeCell(state, extra = []) {
  const blocked = blockedSet(state, extra);
  const rng = state.rng;
  for (let i = 0; i < 400; i++) {
    const x = Math.floor(rng() * COLS);
    const y = Math.floor(rng() * ROWS);
    if (!blocked.has(cellKey(x, y))) return { x, y };
  }
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (!blocked.has(cellKey(x, y))) return { x, y };
    }
  }
  return null;
}

export function spawnFood(state) {
  const cell = pickFreeCell(state);
  state.food = cell;
  return cell;
}

export function spawnItem(state) {
  const kinds = Object.keys(ITEM_TYPES);
  const kind = kinds[Math.floor(state.rng() * kinds.length)];
  const cell = pickFreeCell(state);
  if (!cell) return null;
  state.item = { ...cell, kind, ttl: ITEM_TTL };
  return state.item;
}

/**
 * 静止障碍。必须避开蛇头周围 2 格：否则新障碍可能直接刷在蛇头前方一格，
 * 玩家没有任何反应余地，那不是难度是不讲理。
 */
export function addObstacles(state, n) {
  const head = state.snake[0];
  for (let i = 0; i < n; i++) {
    let placed = null;
    for (let attempt = 0; attempt < 300; attempt++) {
      const cell = pickFreeCell(state);
      if (!cell) break;
      const dx = Math.abs(cell.x - head.x);
      const dy = Math.abs(cell.y - head.y);
      if (Math.max(dx, dy) <= 2) continue;      // 蛇头 5×5 范围不清场就不放
      placed = cell;
      break;
    }
    if (!placed) return state.obstacles.length;
    state.obstacles.push(placed);
  }
  return state.obstacles.length;
}

/* ---------------- 输入 ---------------- */

/**
 * 方向入队（最多缓存 2 个）：
 * - 拒绝反向：直接从脖子钻进身体，等于自杀，经典规则不允许。
 * - 缓存两个是为了“快速转向 + 下一格就转”不丢输入，键盘抖动时不至于漏操作。
 */
export function queueDirection(state, dir) {
  if (state.status !== 'playing') return false;
  if (!dir) return false;
  const last = state.pending.length ? state.pending[state.pending.length - 1] : state.dir;
  if (dir.x === -last.x && dir.y === -last.y) return false;
  if (dir.x === last.x && dir.y === last.y) return false;
  if (state.pending.length >= 2) return false;
  state.pending.push({ x: dir.x, y: dir.y });
  return true;
}

/* ---------------- 推进一 tick ---------------- */

function die(state, reason) {
  state.status = 'dead';
  state.reason = reason;
  return [{ type: 'die', reason }];
}

function applyItem(state, events) {
  const it = state.item;
  const cfg = ITEM_TYPES[it.kind];
  if (it.kind === 'speed') {
    state.timers.speed = cfg.dur;
    state.timers.slow = 0;      // 加速/减速互斥，取最后一次拾取
  } else if (it.kind === 'slow') {
    state.timers.slow = cfg.dur;
    state.timers.speed = 0;
  } else {
    // 关卡制给时间，无尽制没有倒计时可加，改为双倍分数
    if (state.mode === 'level') state.levelTimeLeft += cfg.bonus;
    else state.timers.double = cfg.dur;
  }
  state.score += SCORE.item;
  state.item = null;
  events.push({ type: 'item', kind: it.kind, label: cfg.label, cell: { x: it.x, y: it.y } });
}

export function tick(state) {
  if (state.status !== 'playing') return [];
  const events = [];

  if (state.pending.length) state.dir = state.pending.shift();
  const head = state.snake[0];
  let nx = head.x + state.dir.x;
  let ny = head.y + state.dir.y;

  // 1) 边界：经典规则判死，穿墙规则回绕
  if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) {
    if (state.wall !== 'wrap') return die(state, 'wall');
    nx = (nx + COLS) % COLS;
    ny = (ny + ROWS) % ROWS;
    events.push({ type: 'wrap', from: { x: head.x, y: head.y }, to: { x: nx, y: ny } });
  }

  // 2) 障碍
  if (state.obstacles.some((o) => o.x === nx && o.y === ny)) return die(state, 'obstacle');

  const eats = sameCell(state.food, { x: nx, y: ny });
  const keepTail = eats || state.grow > 0;

  // 3) 自身碰撞：不吃食物时尾格这一 tick 会腾出来，可以踩
  const checkLen = keepTail ? state.snake.length : state.snake.length - 1;
  for (let i = 0; i < checkLen; i++) {
    if (sameCell(state.snake[i], { x: nx, y: ny })) return die(state, 'self');
  }

  // 4) 提交新身体，并记录上一 tick 的坐标供渲染插值
  const old = state.snake;
  const next = [{ x: nx, y: ny }, ...old];
  if (!keepTail) next.pop();
  else if (!eats && state.grow > 0) state.grow--;

  state.prevSnake = next.map((_, i) => ({ ...old[Math.min(i, old.length - 1)] }));
  state.snake = next;

  // 5) 吃到食物
  if (eats) {
    state.eaten += 1;
    state.totalEaten += 1;
    const value = foodValue(state);
    state.score += value;
    events.push({ type: 'eat', cell: { x: nx, y: ny }, value, length: next.length });
    if (state.mode === 'level') {
      state.levelTimeLeft = Math.min(
        state.levelTimeLeft + LEVEL_TUNING.foodRefill,
        state.levelTimeLimit * 2,
      );
    }
    spawnFood(state);

    state.foodsSinceItem += 1;
    if (!state.item && state.foodsSinceItem >= ITEM_SPAWN_EVERY) {
      if (spawnItem(state)) state.foodsSinceItem = 0;
    }

    if (state.mode === 'level' && state.eaten >= state.levelTarget) {
      const bonus = clearBonus(state);
      state.score += bonus;
      state.status = 'levelclear';
      events.push({ type: 'levelclear', bonus, level: state.level });
    } else if (state.mode === 'endless'
      && state.totalEaten >= ENDLESS_TUNING.obstacleAfter
      && state.totalEaten % ENDLESS_TUNING.foodsPerObstacle === 0
      && state.obstacles.length < ENDLESS_TUNING.maxObstacles) {
      addObstacles(state, 1);
      events.push({ type: 'obstacle', count: state.obstacles.length });
    }
  }

  // 6) 拾取道具
  if (state.item && state.item.x === nx && state.item.y === ny) applyItem(state, events);

  // 7) 无尽模式的“双倍分数”也要过期
  return events;
}

/* ---------------- 计时器（按真实毫秒推进，不受 tick 影响） ---------------- */

export function updateTimers(state, dtMs) {
  if (state.status !== 'playing' || dtMs <= 0) return [];
  const events = [];
  for (const k of ['speed', 'slow', 'double']) {
    if (state.timers[k] > 0) {
      state.timers[k] = Math.max(0, state.timers[k] - dtMs);
      if (state.timers[k] === 0) events.push({ type: 'expire', kind: k });
    }
  }
  if (state.item) {
    state.item.ttl -= dtMs;
    if (state.item.ttl <= 0) {
      state.item = null;
      events.push({ type: 'itemgone' });
    }
  }
  if (state.mode === 'level') {
    state.levelTimeLeft -= dtMs;
    if (state.levelTimeLeft <= 0) {
      state.levelTimeLeft = 0;
      state.status = 'timeout';
      state.reason = 'time';
      events.push({ type: 'die', reason: 'time' });
    }
  }
  return events;
}

/** 关卡通过后进入下一关：保留蛇身，换掉障碍/食物/道具，重置本关计时。 */
export function advanceLevel(state) {
  if (state.mode !== 'level') return [];
  state.level += 1;
  state.eaten = 0;
  state.levelTarget = levelTarget(state.level);
  state.levelTimeLimit = levelTimeLimit(state.level);
  state.levelTimeLeft = state.levelTimeLimit;
  state.timers = { speed: 0, slow: 0, double: 0 };
  state.item = null;
  state.obstacles = [];
  state.status = 'playing';
  addObstacles(state, obstaclesForLevel(state.level));
  spawnFood(state);
  return [{
    type: 'levelstart',
    level: state.level,
    target: state.levelTarget,
    obstacles: state.obstacles.length,
  }];
}

/**
 * HUD 用的速度倍率：以“第 1 档的 168ms”为 1.0× 基准。
 * 用 baseTick/tickMs 会永远显示 1.0×（两者同步变化），对玩家没有信息量。
 */
export function speedFactor(state) {
  return LEVEL_TUNING.baseTick / tickMs(state);
}
