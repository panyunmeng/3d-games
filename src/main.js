/**
 * 入口：串起「规则层 / 渲染层 / 输入 / UI / 音效」。
 *
 * 状态机只有两个态：menu（菜单，相机自动环绕）与 playing（对局中）。
 * 所有对局内的变更都走同一条路径：改 game → board.sync(game) → refreshHud()，
 * 保证 HUD、撤销按钮、练习局标记永远和规则层一致。
 */
import * as THREE from '../vendor/three.module.js';

import { LEVELS, DEFAULT_LEVEL, UNDO_LIMIT, HINT_LIMIT } from './config.js';
import { Game } from './logic.js';
import { normalizeSeed, randomSeed } from './rng.js';
import { Stage } from './scene.js';
import { Board } from './board3d.js';
import { Sound } from './audio.js';
import { UI } from './ui.js';
import { loadBest, saveBest, loadMuted, saveMuted } from './storage.js';
import { formatTime } from './format.js';

const canvas = document.getElementById('stage');
const loading = document.getElementById('loading');

const ui = new UI();
const sound = new Sound();

let stage;
let board;
const raycaster = new THREE.Raycaster();

try {
  stage = new Stage(canvas);
  board = new Board(stage);
} catch (err) {
  console.error(err);
  if (loading) loading.textContent = '无法启动 WebGL：' + (err?.message || err);
  throw err;
}

// ---------------------------------------------------------------- 对局状态

let game = null;
let levelKey = DEFAULT_LEVEL;
let state = 'menu'; // menu | playing
let elapsed = 0;
let startedAt = 0;
let timerRunning = false;
let started = false;
let paused = false;
let pendingSeed = null;

const bestTable = loadBest();
sound.setMuted(loadMuted());
ui.setSoundMuted(sound.muted);
ui.setBestTable(bestTable);

// ---------------------------------------------------------------- URL 参数

const params = new URLSearchParams(location.search);
pendingSeed = normalizeSeed(params.get('seed'));
const levelParam = LEVELS[params.get('level')] ? params.get('level') : null;

// ---------------------------------------------------------------- 对局控制

function refreshHud() {
  if (!game) return;
  ui.setMines(game.remaining);
  ui.setProgress(game.progress);
  ui.setAssisted(game.assisted);

  const over = game.isOver;
  const undoLeft = UNDO_LIMIT - game.undoUsed;
  const hintLeft = HINT_LIMIT - game.hintUsed;
  ui.setUndoEnabled(!over && undoLeft > 0 && game.undoStack.length > 0, Math.max(0, undoLeft));
  ui.setHintEnabled(!over && hintLeft > 0, Math.max(0, hintLeft));
}

function startLevel(key, seed, keepView = false) {
  const lvl = LEVELS[key];
  levelKey = key;
  game = new Game(lvl, seed || randomSeed());

  board.build(lvl.cols, lvl.rows);
  board.sync(game);

  stage.setMenuFocus(false);
  stage.setAutoRotate(false);
  if (!keepView) stage.resetView();

  state = 'playing';
  elapsed = 0;
  timerRunning = false;
  started = false;
  paused = false;
  pendingSeed = null;
  lastClick = null;

  ui.hideMenu();
  ui.hideResult();
  ui.hidePause();
  ui.showHud(true);
  ui.setLevel(key, lvl.name);
  ui.setBest(bestTable[key]);
  ui.setClock(0);
  ui.setMines(lvl.mines);
  ui.setProgress(0);
  ui.setAssisted(false);
  ui.setUndoEnabled(false, UNDO_LIMIT);
  ui.setHintEnabled(true, HINT_LIMIT);
}

function goMenu() {
  state = 'menu';
  lastClick = null;
  timerRunning = false;
  paused = false;
  ui.hideResult();
  ui.hidePause();
  ui.showMenu(
    pendingSeed
      ? `已载入挑战种子 ${pendingSeed}。选一档难度即可开局；首击位置不同，雷位会有差异。`
      : '',
  );
  ui.showHud(false);
  stage.setMenuFocus(true);
  stage.setAutoRotate(true);
  board.hideHover();
}

function toggleFlag(index) {
  const res = game.toggleFlag(index);
  if (!res.ok) {
    if (res.reason === 'limit') ui.toast('旗子用完了，先右键取消一面');
    return;
  }
  board.sync(game);
  if (res.flagged) sound.flag();
  else sound.unflag();
  refreshHud();
}

function startTimer() {
  if (timerRunning) return;
  timerRunning = true;
  startedAt = performance.now() - elapsed;
}

function stopTimer() {
  if (!timerRunning) return;
  elapsed = performance.now() - startedAt;
  timerRunning = false;
}

/**
 * 暂停 / 继续（Esc 与 P 共用，也接暂停面板的「继续」按钮）。
 *
 * 计时的做法：不变量是「`elapsed` 是权威值，`startedAt` 只是这次计时的基准」。
 * 暂停 = stopTimer()，把 performance.now() - startedAt 写回 elapsed；
 * 恢复 = startTimer()，把 startedAt 重新定成 now - elapsed。
 * 于是暂停这段墙钟时间天然落在两次基准之间、不会被计入，
 * **不需要另外累计暂停时长**，也**不需要停 rAF**（画面继续渲染）。
 *
 * 为什么不靠 rAF 累加 dt：后台标签页 rAF 会被节流到约 1fps，
 * 累加 dt 会让计时走慢。这里始终用 performance.now() 差值，与帧率无关。
 */
function setPaused(next) {
  if (state !== 'playing' || !game || game.isOver) return;
  if (paused === next) return;

  paused = next;
  if (paused) {
    stopTimer();
    ui.setClock(elapsed);
    drag = null;
    board.hideHover();
    ui.showPause();
    sound.click();
  } else {
    ui.hidePause();
    // 只有本局已经开始计时（首次挖开过）才恢复走表；
    // 未开局时暂停再继续，应该仍然是 0:00 等着首击。
    if (started) startTimer();
    sound.click();
  }
}

function togglePause() {
  setPaused(!paused);
}

/** 静音开关：与 HUD 上 ♪ 按钮走同一条路径。 */
function toggleSound() {
  sound.setMuted(!sound.muted);
  saveMuted(sound.muted);
  ui.setSoundMuted(sound.muted);
  if (!sound.muted) sound.click();
}

function reveal(index) {
  const res = game.reveal(index);
  if (!res.ok) {
    if (res.reason === 'flagged') ui.toast('这格插了旗，先右键取消');
    return;
  }

  if (!started) {
    started = true;
    startTimer();
  }

  board.sync(game);

  if (res.mine) {
    sound.boom();
    finishGame(false);
    return;
  }

  if (res.opened.length >= 3) sound.openArea();
  else sound.tap();

  if (game.status === 'won') {
    sound.win();
    board.celebrate();
    finishGame(true);
    return;
  }

  refreshHud();
}

/** 双击数字 / 中键：旗数与数字相符时一次展开周围。 */
function doChord(index) {
  const res = game.chord(index);
  if (!res.ok) return;

  if (!started) {
    started = true;
    startTimer();
  }

  board.sync(game);

  if (res.mine) {
    sound.boom();
    finishGame(false);
    return;
  }
  if (res.opened.length >= 3) sound.openArea();
  else sound.tap();

  if (game.status === 'won') {
    sound.win();
    board.celebrate();
    finishGame(true);
    return;
  }
  refreshHud();
}

function finishGame(won) {
  stopTimer();
  ui.setClock(elapsed);
  refreshHud();

  const finished = game;
  const time = elapsed;
  let newBest = false;

  if (!finished.assisted) {
    const prev = bestTable[levelKey];
    if (typeof prev !== 'number' || time < prev) {
      if (saveBest(levelKey, time)) {
        bestTable[levelKey] = time;
        ui.setBestTable(bestTable);
        newBest = true;
      }
    }
  }

  setTimeout(() => {
    if (game !== finished) return;
    ui.showResult({
      won,
      time,
      best: bestTable[levelKey],
      progress: finished.progress,
      assisted: finished.assisted,
      newBest,
    });
  }, won ? 950 : 1050);
}

function doUndo() {
  if (!canPlay()) return;
  if (!game.undo()) {
    ui.toast(game.isOver ? '本局已结束，不能撤销' : '没有可撤销的挖开记录');
    return;
  }
  board.sync(game);
  board.hideHover();
  sound.undo();
  refreshHud();
}

function doHint() {
  if (!canPlay()) return;
  const h = game.hint();
  if (!h) {
    ui.toast(game.isOver ? '本局已结束' : '提示次数已用完');
    return;
  }
  if (!started) {
    started = true;
    startTimer();
  }
  board.sync(game);
  sound.tap();
  refreshHud();
  if (game.status === 'won') {
    sound.win();
    board.celebrate();
    finishGame(true);
  }
}

function shareLink() {
  if (!game) return;
  const url = new URL(location.href);
  url.search = '';
  url.searchParams.set('seed', game.seed);
  url.searchParams.set('level', levelKey);
  const text = url.toString();

  const fallback = () => {
    // 不用 window.prompt：它会阻塞页面，且后台标签页里体验很差
    ui.toast(`复制失败，手动复制这条链接：${text}`, 6000);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => ui.toast('挑战链接已复制'), fallback);
  } else {
    fallback();
  }
}

// ---------------------------------------------------------------- 输入

/** 现在能否对棋盘下操作：对局中、未结束、且没被暂停。 */
function canPlay() {
  return state === 'playing' && !!game && !game.isOver && !paused;
}

let drag = null;
let hoverRaf = 0;
let hoverEvent = null;
let lastClick = null;

function pick(e) {
  const ndc = stage.toNdc(e.clientX, e.clientY);
  raycaster.setFromCamera(ndc, stage.camera);
  return board.pick(raycaster);
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('pointerdown', () => sound.unlock());

canvas.addEventListener('pointerdown', (e) => {
  if (state !== 'playing' || game.isOver) return;

  if (e.button === 2) {
    const i = pick(e);
    if (i >= 0) toggleFlag(i);
    return;
  }
  if (e.button === 1) {
    e.preventDefault();
    const i = pick(e);
    if (i >= 0) doChord(i);
    return;
  }
  if (e.button !== 0) return;

  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false };
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    /* 某些浏览器在合成事件上会抛，忽略 */
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (drag && drag.id === e.pointerId) {
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 6) {
      drag.moved = true;
      board.hideHover();
    }
    if (drag.moved) stage.orbit(dx, dy);
    drag.x = e.clientX;
    drag.y = e.clientY;
    return;
  }

  if (state !== 'playing' || !game || game.isOver) return;
  hoverEvent = e;
  if (hoverRaf) return;
  hoverRaf = requestAnimationFrame(() => {
    hoverRaf = 0;
    if (!hoverEvent || state !== 'playing') return;
    const i = pick(hoverEvent);
    hoverEvent = null;
    board.setHover(i, game);
  });
});

canvas.addEventListener('pointerup', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const wasDrag = drag.moved;
  drag = null;
  try {
    canvas.releasePointerCapture(e.pointerId);
  } catch {
    /* 忽略 */
  }
  if (wasDrag) return;
  if (state !== 'playing' || game.isOver) return;
  const i = pick(e);
  if (i < 0) return;

  const now = performance.now();
  if (lastClick && lastClick.index === i && now - lastClick.time < 350) {
    lastClick = null;
    doChord(i);
    return;
  }
  lastClick = { index: i, time: now };
  reveal(i);
});

// 中键的默认行为（Windows 自动滚动）要一并拦掉
canvas.addEventListener('auxclick', (e) => e.preventDefault());

canvas.addEventListener('pointercancel', () => {
  drag = null;
});

canvas.addEventListener(
  'wheel',
  (e) => {
    if (state !== 'playing') return;
    e.preventDefault();
    stage.zoomBy(e.deltaY);
  },
  { passive: false },
);

/**
 * 键盘：Esc/P 暂停、R 重开本局、M 静音（《设计语言规范》§二）。
 *
 * 本游戏原来是纯鼠标的（pointerdown/move/up、wheel、contextmenu）。合集里
 * 其余 6 个游戏都能用键盘，只有它不能，手感会明显断裂，所以必须补上。
 *
 * 两个细节：
 *   1. 命中判定用 e.code 而不是 e.key——键盘布局不同（如俄文/中文输入法
 *      激活时）e.key 会变，e.code 始终是物理键位。
 *   2. 输入框聚焦时不拦截，否则将来若加种子输入框，按 R 会连带着重开一局。
 */
function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (isTypingTarget(e.target)) return;

  switch (e.code) {
    case 'Escape':
    case 'KeyP':
      // 已在菜单/结算页时不做事（那两个页面本来就不计时）
      if (state !== 'playing') return;
      e.preventDefault();
      togglePause();
      break;

    case 'KeyR':
      if (state !== 'playing') return;
      e.preventDefault();
      // 重开本局保留当前视角（与 HUD 上的 ↻ 按钮、暂停面板的「重开」同一路径）
      startLevel(levelKey, null, true);
      break;

    case 'KeyM':
      e.preventDefault();
      toggleSound();
      break;

    default:
      break;
  }
});

// ---------------------------------------------------------------- UI 回调

ui.on('onLevel', (key) => startLevel(key, pendingSeed))
  .on('onRestart', () => {
    if (state === 'playing') startLevel(levelKey, null, true);
  })
  .on('onUndo', doUndo)
  .on('onHint', doHint)
  .on('onShare', shareLink)
  .on('onSound', toggleSound)
  .on('onResume', () => setPaused(false))
  .on('onMenu', () => {
    if (state === 'playing') goMenu();
  })
  .on('onAgain', () => startLevel(levelKey, null, true))
  .on('onChange', () => goMenu());

// ---------------------------------------------------------------- 主循环

let lastFrame = performance.now();
let clockText = '';


function frame(now) {
  const dt = Math.min(0.06, (now - lastFrame) / 1000);
  lastFrame = now;

  if (timerRunning) {
    elapsed = performance.now() - startedAt;
  }
  const text = formatTime(elapsed);
  if (text !== clockText) {
    clockText = text;
    ui.setClock(elapsed);
  }

  stage.update(dt);
  board.update(dt);
  stage.render();
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- 启动

function boot() {
  board.build(LEVELS.easy.cols, LEVELS.easy.rows);

  if (pendingSeed && levelParam) {
    startLevel(levelParam, pendingSeed);
  } else {
    // 菜单背景放一局已经挖开几格的「样品」，纯展示、不可操作
    const demo = new Game(LEVELS.easy, randomSeed());
    demo.reveal(demo.indexOf(4, 4));
    const safe = [];
    for (let i = 0; i < demo.size && safe.length < 2; i++) {
      if (!demo.mine[i] && demo.state[i] === 0) safe.push(i);
    }
    for (const i of safe) demo.toggleFlag(i);
    board.sync(demo);
    stage.setAutoRotate(true);
    stage.setMenuFocus(true);
    stage.resetView();
    goMenu();
  }

  requestAnimationFrame((t) => {
    lastFrame = t;
    requestAnimationFrame(frame);
  });

  // 首帧渲染完再撤载入层，避免闪白
  requestAnimationFrame(() => {
    loading?.classList.add('hide');
    setTimeout(() => loading?.remove(), 600);
  });
}

boot();
