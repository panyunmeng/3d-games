// 入口：把规则、寻路、渲染、UI 接起来。
//
// 时序只有一个来源：requestAnimationFrame 里按 MOVE_MS 的节奏从队列取一步。
// 键盘与点击都只是「往队列里塞方向」，这样连按不会丢步、也不会和动画打架。

import './style.css';
import { LEVEL_CACHE, Game } from './sokoban';
import { planClick } from './pathfind';
import { MOVE_MS, World } from './scene';
import { Ui } from './ui';

const canvas = document.querySelector<HTMLCanvasElement>('#view');
if (!canvas) throw new Error('缺少 #view');
const world = new World(canvas);

const levelById = new Map(LEVEL_CACHE.map((lv) => [lv.id, lv] as const));

const SOLVED_KEY = 'sokoban3d.solved.v1';

function loadSolved(): Set<number> {
  try {
    const raw = localStorage.getItem(SOLVED_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(arr) ? arr.filter((n): n is number => typeof n === 'number') : []);
  } catch {
    return new Set();
  }
}

function saveSolved(set: ReadonlySet<number>): void {
  try {
    localStorage.setItem(SOLVED_KEY, JSON.stringify([...set]));
  } catch {
    /* 隐私模式下写不了，不影响玩 */
  }
}

const solved = loadSolved();
let game = new Game(LEVEL_CACHE[0]!);
let queue: number[] = [];
let lastStepAt = 0;
let finished = false;
let winTimer = 0;

const ui = new Ui({
  selectLevel: (id) => loadLevel(id),
  prev: () => stepLevel(-1),
  next: () => stepLevel(1),
  undo: () => undo(),
  reset: () => reset(),
  winRetry: () => reset(),
  winNext: () => stepLevel(1),
});

function goalCount(): number {
  let n = 0;
  for (let i = 0; i < game.level.goal.length; i++) n += game.level.goal[i]!;
  return n;
}

function boxesLeft(): number {
  let onGoal = 0;
  for (const b of game.state.boxes) if (game.level.goal[b]) onGoal++;
  return goalCount() - onGoal;
}

function refreshStats(): void {
  ui.setStats(game.moves, game.pushes, boxesLeft(), game.canUndo);
}

function currentIndex(): number {
  return LEVEL_CACHE.findIndex((lv) => lv.id === game.level.id);
}

function levelFromHash(): number | null {
  const n = Number.parseInt(location.hash.replace('#', ''), 10);
  return Number.isFinite(n) && levelById.has(n) ? n : null;
}

function loadLevel(id: number): void {
  const level = levelById.get(id);
  if (!level) return;
  if (location.hash !== `#${id}`) history.replaceState(null, '', `#${id}`);
  queue = [];
  finished = false;
  clearTimeout(winTimer);
  ui.hideWin();
  game = new Game(level);
  world.buildLevel(level, game.state.boxes, game.state.player);
  ui.setCurrent(level, solved);
  refreshStats();
}

function stepLevel(delta: number): void {
  const i = currentIndex();
  if (i < 0) return;
  const next = LEVEL_CACHE[(i + delta + LEVEL_CACHE.length) % LEVEL_CACHE.length];
  if (next) loadLevel(next.id);
}

function undo(): void {
  queue = [];
  // 过关后再按撤销：先关掉弹窗，同时把最后一步真的退回去
  if (finished) {
    finished = false;
    clearTimeout(winTimer);
    ui.hideWin();
  }
  const step = game.undo();
  if (!step) return;
  world.undoStep(step, game.state);
  refreshStats();
}

function reset(): void {
  queue = [];
  finished = false;
  clearTimeout(winTimer);
  ui.hideWin();
  game.reset();
  world.syncAll(game.state);
  refreshStats();
}

function onSolved(): void {
  finished = true;
  queue = [];
  solved.add(game.level.id);
  saveSolved(solved);
  ui.setCurrent(game.level, solved);
  const hasNext = currentIndex() < LEVEL_CACHE.length - 1;
  winTimer = window.setTimeout(() => ui.showWin(game.level.id, game.moves, game.pushes, hasNext), 260);
}

world.onCellClick = (cell) => {
  if (finished) return;
  const plan = planClick(game, cell);
  if (!plan) return;
  queue = plan.dirs;
  // 点击后立刻走第一步，别等下一个节奏点
  lastStepAt = performance.now() - MOVE_MS;
};

const KEY_DIRS: Record<string, number> = {
  arrowup: 0,
  w: 0,
  arrowright: 1,
  d: 1,
  arrowdown: 2,
  s: 2,
  arrowleft: 3,
  a: 3,
};

window.addEventListener('keydown', (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const key = e.key.toLowerCase();
  const dir = KEY_DIRS[key];
  if (dir !== undefined) {
    e.preventDefault();
    if (finished) return;
    queue.push(dir);
    return;
  }
  switch (key) {
    case 'z':
    case 'u':
      e.preventDefault();
      undo();
      break;
    case 'r':
      e.preventDefault();
      reset();
      break;
    case ',':
      stepLevel(-1);
      break;
    case '.':
      stepLevel(1);
      break;
    default:
      break;
  }
});

function tick(now: number): void {
  if (!finished && queue.length > 0 && now - lastStepAt >= MOVE_MS) {
    const dir = queue.shift()!;
    const step = game.move(dir);
    if (!step) {
      queue = [];
    } else {
      lastStepAt = now;
      world.applyStep(step, game.state);
      refreshStats();
      if (game.isSolved()) onSolved();
    }
  }
  world.update();
  requestAnimationFrame(tick);
}

ui.buildLevelList(LEVEL_CACHE);
loadLevel(levelFromHash() ?? LEVEL_CACHE[0]!.id);

window.addEventListener('hashchange', () => {
  const id = levelFromHash();
  if (id !== null && id !== game.level.id) loadLevel(id);
});

const ro = new ResizeObserver(() => world.resize());
ro.observe(canvas);
window.addEventListener('resize', () => world.resize());

requestAnimationFrame(tick);
