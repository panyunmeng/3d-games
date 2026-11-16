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

function startLevel(key, seed) {
  const lvl = LEVELS[key];
  levelKey = key;
  game = new Game(lvl, seed || randomSeed());

  board.build(lvl.cols, lvl.rows);
  board.sync(game);

  stage.setMenuFocus(false);
  stage.setAutoRotate(false);
  stage.resetView();

  state = 'playing';
  elapsed = 0;
  timerRunning = false;
  started = false;
  pendingSeed = null;

  ui.hideMenu();
  ui.hideResult();
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
  timerRunning = false;
  ui.hideResult();
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
  if (state !== 'playing') return;
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
  if (state !== 'playing') return;
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

let drag = null;
let hoverRaf = 0;
let hoverEvent = null;

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
  if (i >= 0) reveal(i);
});

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

// ---------------------------------------------------------------- UI 回调

ui.on('onLevel', (key) => startLevel(key, pendingSeed))
  .on('onRestart', () => {
    if (state === 'playing') startLevel(levelKey, null);
  })
  .on('onUndo', doUndo)
  .on('onHint', doHint)
  .on('onShare', shareLink)
  .on('onSound', () => {
    sound.setMuted(!sound.muted);
    saveMuted(sound.muted);
    ui.setSoundMuted(sound.muted);
  })
  .on('onMenu', () => {
    if (state === 'playing') goMenu();
  })
  .on('onAgain', () => startLevel(levelKey, null))
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
