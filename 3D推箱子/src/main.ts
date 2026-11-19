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

// 是否触屏设备：只有「粗指针 + 支持 hover 为假」才显示屏幕方向键。
// 用媒体查询而非屏幕宽度判定：横屏的桌面小窗口不该冒出方向键，
// 真机（含带触摸的平板）才需要实体按键式走位。
const isTouch = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
if (isTouch) document.body.classList.add('touch');

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
let paused = false;
let winTimer = 0;

/** 竖屏抽屉：选完关自动收起，避免关卡列表一直压在画面上 */
function closeLevels(): void {
  document.getElementById('app')?.classList.remove('levels-open');
  document.getElementById('btn-levels')?.setAttribute('aria-expanded', 'false');
}

const ui = new Ui({
  selectLevel: (id) => {
    loadLevel(id);
    closeLevels();
  },
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
  paused = false;
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
    paused = false;
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

/**
 * 屏幕方向键 → 移动队列。
 *
 * 为什么选方向键而不是滑动手势（第一性原则）：
 *  1. 棋盘是离散四方向格网，方向键把「屏幕上/下/左/右」直接映射成格子的
 *     上/右/下/左（DIRS 0..3），与相机朝向无关；滑动方向则要随相机旋转做坐标变换，
 *     多一层换算就多一处错。
 *  2. 拖拽旋转本来就在同一个画布上用 pointer 事件。若再加滑动走位，二者必须靠
 *     位移阈值争抢同一串 pointermove，正是「旋转后误走一步」的根因。方向键是独立
 *     DOM 按钮，彻底不碰画布，从构造上消除了误触。
 *  3. 每次按键只 queue.push(dir)，随后由 tick() 按 MOVE_MS 节奏调 game.move()：
 *     走位、推箱、撤销、胜利判定全部复用既有规则引擎，没有第二套移动逻辑。
 *
 * 触摸用 pointerdown（不用 click）：点下就走，不需要等抬起，连点跟手；
 * setPointerCapture 保证手指滑出按钮也不会把事件丢给画布导致误旋转。
 */
const dpad = document.getElementById('dpad');
if (dpad) {
  dpad.querySelectorAll<HTMLButtonElement>('button[data-dir]').forEach((btn) => {
    const dir = Number(btn.dataset.dir);
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      btn.setPointerCapture(e.pointerId);
      if (!finished && !paused) queue.push(dir);
    });
  });
}

/** 关卡抽屉开关：竖屏下点 HUD 里的列表按钮切类，CSS 负责抽屉的滑入/滑出。 */
{
  const app = document.getElementById('app');
  const toggle = document.getElementById('btn-levels');
  const backdrop = document.getElementById('stage');
  toggle?.addEventListener('click', () => {
    app?.classList.toggle('levels-open');
    toggle.setAttribute('aria-expanded', String(app?.classList.contains('levels-open') ?? false));
  });
  // 点遮罩（抽屉外的画面）收起抽屉；backdrop 是 stage，抽屉在 sidebar 里，不会误伤
  backdrop?.addEventListener('click', (e) => {
    if (app?.classList.contains('levels-open') && e.target === backdrop) {
      app.classList.remove('levels-open');
      toggle?.setAttribute('aria-expanded', 'false');
    }
  });
  // 选了关卡后自动收起抽屉：Ui 的 selectLevel 回调里也顺手关掉
}

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
    // 暂停 / 继续：Esc 与 P 都接受（设计语言规范 §二）
    case 'escape':
    case 'p':
      e.preventDefault();
      if (!finished) setPaused(!paused);
      break;
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

/**
 * 暂停 / 继续。
 *
 * 推箱子是回合制、没有计时，暂停的全部意义就是「挡住输入」：
 * 键盘排队、点击寻路、拖拽旋转都停下，避免误触把箱子推错。
 * 已排队的移动一并清掉——继续后不该因为暂停前的按队列而冲出几步。
 */
function setPaused(next: boolean): void {
  if (paused === next) return;
  paused = next;
  queue = [];
  const el = document.getElementById('pause');
  if (el) (el as HTMLElement).hidden = !paused;
}

function tick(now: number): void {
  // 暂停时不消费移动队列：已排队的按键也一并丢掉，继续后不会突然冲出几步
  if (!finished && !paused && queue.length > 0 && now - lastStepAt >= MOVE_MS) {
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
