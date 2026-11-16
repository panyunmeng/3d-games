/**
 * 主循环 / 状态机 / 输入。
 *
 * 时钟三件事必须分清，否则手感会飘：
 *  1) 渲染帧（每帧 dt）：只驱动动画与插值；
 *  2) 逻辑 tick：以 tickMs 为步长的累加器驱动，速度变化不会让一帧走两格；
 *  3) 计时钟（道具/关卡倒计时）：按真实毫秒推进，和 tick 解耦。
 */
import * as THREE from '../vendor/three.module.js';
import { createStage } from './scene.js';
import { createView } from './view.js';
import { createUI } from './ui.js';
import { sfx, unlock, toggleMute, isMuted } from './audio.js';
import {
  newGame, tick, updateTimers, tickMs, queueDirection, advanceLevel, speedFactor,
} from './logic.js';
import { MODE_LABEL, WALL_LABEL, COLS, ROWS } from './config.js';

const canvas = document.getElementById('stage');
const stage = createStage(canvas);
const view = createView(stage);

/** 运行时状态机：menu → playing ⇄ paused → (levelclear) → over → menu */
let phase = 'menu';
let state = null;
let accumulator = 0;
let lastTs = 0;
let animTime = 0;
let runId = 0;
let hasPlayed = false;

const ui = createUI({
  onStart: (sel) => startGame(sel),
  onResume: () => resume(),
  onQuit: () => toMenu(),
  onAgain: () => startGame({ mode: ui.selection.mode, wall: ui.selection.wall }),
  onSelect: () => sfx.click(),
});

/* ---------------- 开局 / 结算 ---------------- */

function startGame(sel) {
  unlock();
  runId += 1;
  state = newGame({ mode: sel.mode, wall: sel.wall, seed: (Date.now() ^ (runId * 2654435761)) >>> 0 });
  ui.selection.mode = sel.mode;
  ui.selection.wall = sel.wall;
  stage.setWallMode(sel.wall);
  view.reset();
  accumulator = -900;   // 起步缓冲：先让玩家看清棋盘再开始走
  phase = 'playing';
  ui.showPlaying();
  ui.update(state, 0);
  sfx.start();
  if (!hasPlayed) {
    hasPlayed = true;
    ui.banner('用 WASD / 方向键 转向', '鼠标拖拽可旋转视角', 2200);
  } else {
    ui.banner(MODE_LABEL[sel.mode], WALL_LABEL[sel.wall], 1200);
  }
}

function toMenu() {
  runId += 1;
  phase = 'menu';
  state = null;
  view.reset();
  ui.showMenu();
}

function resume() {
  if (phase !== 'paused') return;
  phase = 'playing';
  ui.hidePause();
  lastTs = performance.now();
}

function pause() {
  if (phase !== 'playing') return;
  phase = 'paused';
  ui.showPause();
}

function gameOver() {
  if (phase === 'over') return;
  phase = 'over';
  accumulator = tickMs(state);
  const newBest = ui.submitScore(state);
  sfx.die();
  setTimeout(() => {
    if (phase === 'over') ui.showOver(state, newBest);
  }, 620);
}

/* ---------------- 事件分发 ---------------- */

function handleEvents(events) {
  if (!events || !events.length) return;
  view.onEvents(events, state);
  for (const ev of events) {
    switch (ev.type) {
      case 'eat':
        sfx.eat();
        break;
      case 'item':
        sfx.item(ev.kind);
        ui.banner(`${ev.label}！`, itemSub(ev.kind, state), 900);
        break;
      case 'expire':
        if (ev.kind === 'speed' || ev.kind === 'slow' || ev.kind === 'double') sfx.click();
        break;
      case 'wrap':
        sfx.wrap();
        break;
      case 'obstacle':
        sfx.obstacle();
        break;
      case 'die':
        gameOver();
        break;
      case 'levelclear':
        onLevelClear(ev);
        break;
      case 'levelstart':
        sfx.start();
        break;
      default:
        break;
    }
  }
}

function itemSub(kind, s) {
  if (kind === 'speed') return '步长缩短，注意别冲太快';
  if (kind === 'slow') return '更容易走位';
  return s.mode === 'level' ? '关卡时间 +8s' : '8 秒内双倍得分';
}

function onLevelClear(ev) {
  phase = 'levelclear';
  const myRun = runId;
  sfx.levelclear();
  ui.banner(`第 ${state.level} 关通过`, `剩余时间奖励 +${ev.bonus} 分`, 1400);
  setTimeout(() => {
    if (phase !== 'levelclear' || runId !== myRun || !state) return;
    const events = advanceLevel(state);
    accumulator = 0;
    phase = 'playing';
    handleEvents(events);
    ui.banner(`第 ${state.level} 关`, bannerSub(state), 1400);
  }, 1450);
}

function bannerSub(s) {
  const parts = [`目标 ${s.levelTarget} 个`, `${Math.round(s.levelTimeLimit / 1000)}s`];
  if (s.obstacles.length) parts.push(`障碍 ${s.obstacles.length}`);
  return parts.join(' · ');
}

/* ---------------- 输入 ---------------- */

const KEY_TO_DIR = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
};

/**
 * 把屏幕方向投影成世界四方向：相机转了，按键语义要跟着转，
 * 否则玩家转了视角就“上下反了”。量化到主导轴，保证永远是四向之一。
 */
function screenDirToGrid(name) {
  const th = stage.azimuth;
  const forward = { x: -Math.sin(th), z: -Math.cos(th) };   // 屏幕上方
  const right = { x: Math.cos(th), z: -Math.sin(th) };      // 屏幕右方
  let v;
  if (name === 'up') v = forward;
  else if (name === 'down') v = { x: -forward.x, z: -forward.z };
  else if (name === 'right') v = right;
  else v = { x: -right.x, z: -right.z };
  if (Math.abs(v.x) >= Math.abs(v.z)) return { x: Math.sign(v.x), y: 0 };
  return { x: 0, y: Math.sign(v.z) };
}

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  if (e.code === 'Enter' || e.code === 'NumpadEnter') {
    if (phase === 'menu') { startGame({ ...ui.selection }); e.preventDefault(); return; }
    if (phase === 'over') { startGame({ ...ui.selection }); e.preventDefault(); return; }
    if (phase === 'paused') { resume(); e.preventDefault(); return; }
  }

  if (e.code === 'Space') {
    e.preventDefault();
    if (phase === 'playing') pause();
    else if (phase === 'paused') resume();
    else if (phase === 'menu') startGame({ ...ui.selection });
    return;
  }

  if (e.code === 'KeyP' || e.code === 'Escape') {
    if (phase === 'playing') { pause(); return; }
    if (phase === 'paused') { resume(); return; }
  }

  if (e.code === 'KeyR') {
    if (phase === 'playing' || phase === 'paused' || phase === 'over' || phase === 'levelclear') {
      startGame({ ...ui.selection });
    }
    return;
  }

  if (e.code === 'KeyM') {
    const m = toggleMute();
    ui.banner(m ? '已静音' : '声音开启', '', 700);
    return;
  }

  const name = KEY_TO_DIR[e.code];
  if (!name) return;
  e.preventDefault();
  unlock();
  if (phase === 'menu') { startGame({ ...ui.selection }); }  // 直接按键开局
  if (phase === 'playing' && state) {
    const dir = screenDirToGrid(name);
    queueDirection(state, dir);
  }
});

/* ---------------- 主循环 ---------------- */

function frame(ts) {
  requestAnimationFrame(frame);
  if (!lastTs) lastTs = ts;
  const rawDt = Math.min(ts - lastTs, 100);   // 切后台回来时不要一次补几十帧
  lastTs = ts;
  const dt = rawDt / 1000;
  animTime += dt;

  stage.update(dt);
  view.update(dt);

  // 菜单里让镜头缓慢自转，别像一张静止渲染图
  if (phase === 'menu') {
    stage.cam.theta += dt * 0.05;
    stage.placeCamera();
  }

  if (phase === 'playing' && state) {
    const dtMs = rawDt;
    const timerEvents = updateTimers(state, dtMs);
    if (timerEvents.length) handleEvents(timerEvents);

    if (phase === 'playing') {
      accumulator += dtMs;
      let guard = 0;
      while (phase === 'playing' && accumulator >= tickMs(state) && guard++ < 8) {
        const step = tickMs(state);
        accumulator -= step;
        handleEvents(tick(state));
        if (state.status === 'levelclear' || state.status === 'dead' || state.status === 'timeout') break;
      }
    }
  }

  if (state) {
    const u = (phase === 'playing' || phase === 'paused')
      ? Math.max(0, Math.min(1, accumulator / Math.max(1, tickMs(state))))
      : 1;
    view.sync(state, u, animTime);
  }
  if (state) ui.update(state, dt);
  stage.render();
}

/* ---------------- 启动 ---------------- */

window.addEventListener('visibilitychange', () => {
  if (document.hidden && phase === 'playing') pause();
});

requestAnimationFrame((ts) => {
  lastTs = ts;
  requestAnimationFrame(frame);
});
ui.showMenu();
ui.setLoading(false);


/* ---------------- 演示 / 验收场景（?scene=...） ---------------- */
/**
 * 只是为了“不按一千次键就能看到某个状态”而存在：验收截图、给别人演示某一关、
 * 或复现一个概率很低的局面。参数缺失时什么都不做，正常玩家完全碰不到。
 */
const demoQ = new URLSearchParams(location.search);
if (demoQ.has('scene')) {
  const name = demoQ.get('scene');
  const mode = demoQ.get('mode') || (name === 'level' ? 'level' : 'endless');
  const wall = demoQ.get('wall') || 'classic';
  const n = Number(demoQ.get('n') || 0);
  startGame({ mode, wall });

  // 演示用的“安全喂食”：每口之前先改成不会撞墙/撞身体的方向，
  // 否则喂到第 10 口蛇就一路顶到边框，看不到长蛇。
  const freeAt = (x, y) => {
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return false;
    if (state.obstacles.some((o) => o.x === x && o.y === y)) return false;
    return !state.snake.some((c) => c.x === x && c.y === y);
  };
  const feed = (times) => {
    for (let i = 0; i < times && state && state.status === 'playing'; i++) {
      const d = state.dir;
      const candidates = [d, { x: -d.y, y: d.x }, { x: d.y, y: -d.x }, { x: -d.x, y: -d.y }];
      const pick = candidates.find((c) => freeAt(state.snake[0].x + c.x, state.snake[0].y + c.y));
      if (!pick) break;
      state.dir = { ...pick };
      state.pending = [];
      const h = state.snake[0];
      state.food = { x: h.x + state.dir.x, y: h.y + state.dir.y };
      handleEvents(tick(state));
    }
  };

  if (name === 'level') {
    for (let i = 1; i < Math.max(2, n || 2); i++) {
      state.status = 'playing';
      advanceLevel(state);
    }
    feed(Math.min(3, state.levelTarget - 1));
  } else if (name === 'long') {
    feed(demoQ.has('n') ? n : 16);
  } else if (name === 'obstacles') {
    feed(demoQ.has('n') ? n : 40);
  } else if (name === 'items') {
    feed(2);
    const h = state.snake[0];
    state.item = {
      x: h.x + state.dir.x * 3,
      y: h.y + state.dir.y * 3,
      kind: demoQ.get('kind') || 'speed',
      ttl: 15000,
    };
  } else if (name === 'over') {
    state.snake = [{ x: 0, y: 10 }, { x: 1, y: 10 }, { x: 2, y: 10 }, { x: 3, y: 10 }];
    state.prevSnake = state.snake.map((c) => ({ ...c }));
    state.dir = { x: -1, y: 0 };
    state.score = 180;
    state.totalEaten = 12;
    handleEvents(tick(state));
  } else if (name === 'pause') {
    pause();
  }

  // 场景摆好后冻结逻辑 tick（不弹暂停面板），否则截图前蛇会自己继续走
  if (name !== 'over' && name !== 'pause') {
    phase = 'paused';
    ui.hidePause();
  }

  if (demoQ.has('theta') || demoQ.has('phi') || demoQ.has('zoom')) {
    stage.cam.theta = Number(demoQ.get('theta') ?? stage.cam.theta);
    stage.cam.phi = Number(demoQ.get('phi') ?? stage.cam.phi);
    stage.cam.radius = Number(demoQ.get('zoom') ?? stage.cam.radius);
    stage.placeCamera();
  }
}

/* 调试/自测入口：不依赖按键也能驱动一局，便于截图验收 */
window.__snake = {
  get phase() { return phase; },
  get state() { return state; },
  start(sel = {}) { startGame({ mode: sel.mode || 'endless', wall: sel.wall || 'classic', ...sel }); },
  step(n = 1) {
    if (!state) return;
    for (let i = 0; i < n; i++) {
      const events = tick(state);
      handleEvents(events);
      if (state.status !== 'playing') break;
    }
  },
  feed(n = 1) {
    if (!state) return;
    for (let i = 0; i < n; i++) {
      const h = state.snake[0];
      state.food = { x: h.x + state.dir.x, y: h.y + state.dir.y };
      handleEvents(tick(state));
      if (state.status !== 'playing') break;
    }
  },
  dir(name) { if (state) queueDirection(state, screenDirToGrid(name)); },
  set(patch) { if (state) Object.assign(state, patch); },
  camera(theta, phi, radius) {
    stage.cam.theta = theta ?? stage.cam.theta;
    stage.cam.phi = phi ?? stage.cam.phi;
    stage.cam.radius = radius ?? stage.cam.radius;
    stage.placeCamera();
  },
  info() {
    return state ? {
      phase, mode: state.mode, wall: state.wall, score: state.score, level: state.level,
      length: state.snake.length, eaten: state.eaten, totalEaten: state.totalEaten,
      obstacles: state.obstacles.length, status: state.status, reason: state.reason,
      tick: tickMs(state), speed: +speedFactor(state).toFixed(2),
      food: state.food, item: state.item ? { ...state.item } : null,
      items: { ...state.timers }, timeLeft: state.levelTimeLeft,
      best: ui.bestFor(state.mode, state.wall),
    } : { phase };
  },
};

console.log('[3D Snake] ready', { COLS, ROWS, three: THREE.REVISION });
