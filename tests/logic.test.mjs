/**
 * 规则层单测：不加载 three / DOM，直接跑 Node。
 * 覆盖：布雷确定性、首击安全、连锁展开、旗子规则、胜负判定、撤销、提示、种子校验。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { Game, HIDDEN, REVEALED, FLAGGED, UNDO_LIMIT, HINT_LIMIT } from '../src/logic.js';
import { createRng, randomSeed, normalizeSeed, hashSeed } from '../src/rng.js';
import { LEVELS } from '../src/config.js';

const EASY = LEVELS.easy;
const MEDIUM = LEVELS.medium;
const HARD = LEVELS.hard;

function newGame(level = MEDIUM, seed = 'testseed') {
  return new Game(level, seed);
}

/** 找一个安全的可挖格（避开已挖开/已插旗）。 */
function firstSafe(game) {
  for (let i = 0; i < game.size; i++) {
    if (game.mine[i]) continue;
    if (game.state[i] === HIDDEN) return i;
  }
  return -1;
}

function countMines(game) {
  let n = 0;
  for (let i = 0; i < game.size; i++) n += game.mine[i];
  return n;
}

test('种子随机数：同种子同序列，不同种子不同序列', () => {
  const a = createRng('abc123');
  const b = createRng('abc123');
  const c = createRng('abc124');
  const sa = Array.from({ length: 20 }, a);
  const sb = Array.from({ length: 20 }, b);
  const sc = Array.from({ length: 20 }, c);
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  for (const v of sa) assert.ok(v >= 0 && v < 1);
  assert.equal(hashSeed('abc123'), hashSeed('abc123'));
});

test('种子：长度与字符合法，非法输入被拒', () => {
  assert.equal(randomSeed().length, 6);
  assert.match(randomSeed(), /^[23456789abcdefghjkmnpqrstuvwxyz]{6}$/);
  assert.equal(normalizeSeed('ABC234'), 'abc234');
  assert.equal(normalizeSeed('ab'), null);
  assert.equal(normalizeSeed('abc 123'), null);
  assert.equal(normalizeSeed('abc0'), null); // 0 是易混字符，被排除
  assert.equal(normalizeSeed(null), null);
});

test('布雷：数量精确、同种子同首击完全复现', () => {
  const g1 = newGame(HARD, 'repro');
  g1.reveal(g1.indexOf(15, 8));
  const mines1 = Array.from(g1.mine);

  const g2 = newGame(HARD, 'repro');
  g2.reveal(g2.indexOf(15, 8));
  const mines2 = Array.from(g2.mine);

  assert.deepEqual(mines1, mines2);
  assert.equal(countMines(g1), HARD.mines);

  const g3 = newGame(HARD, 'repro');
  g3.reveal(g3.indexOf(0, 0)); // 首击不同 → 雷位不同（首击安全区跟着移动）
  assert.notDeepEqual(Array.from(g3.mine), mines1);
});

test('布雷：首击格与 8 邻域无雷，且首击 adj 必为 0', () => {
  for (const level of [EASY, MEDIUM, HARD]) {
    for (const seed of ['a2', 'b3', 'c4', 'd5']) {
      const g = newGame(level, seed);
      const idx = Math.floor(level.rows / 2) * level.cols + Math.floor(level.cols / 2);
      g.reveal(idx);
      assert.equal(g.mine[idx], 0);
      assert.equal(g.adj[idx], 0);
      for (const nb of g.neighbors(idx)) assert.equal(g.mine[nb], 0);
    }
  }
});

test('邻域计数与雷区实际一致（随机抽 200 格核对）', () => {
  const g = newGame(MEDIUM, 'adjcheck');
  g.reveal(g.indexOf(8, 8));
  const rng = createRng('sample');
  for (let k = 0; k < 200; k++) {
    const i = Math.floor(rng() * g.size);
    let expected = 0;
    for (const nb of g.neighbors(i)) expected += g.mine[nb];
    assert.equal(g.adj[i], expected, `格 ${i} 邻域计数错误`);
  }
});

test('首击连锁展开：至少打开首击的 3×3 区域', () => {
  const g = newGame(MEDIUM, 'flood1');
  const idx = g.indexOf(5, 5);
  const res = g.reveal(idx);
  assert.equal(res.ok, true);
  assert.ok(res.opened.length >= 9, `只打开了 ${res.opened.length} 格`);
  assert.equal(g.status, 'playing');
  for (const i of res.opened) assert.equal(g.state[i], REVEALED);
  assert.equal(g.revealedSafe, res.opened.length);
});

test('已插旗的格不会被连锁打开，且必须先撤旗才能挖', () => {
  const g = newGame(MEDIUM, 'flagflood');
  const first = g.indexOf(8, 8);
  g.reveal(first);
  // 挑一个未挖开的安全格插旗，再从它旁边挖 0 格不该动它
  const flagged = firstSafe(g);
  g.state[flagged] = HIDDEN;
  assert.equal(g.toggleFlag(flagged).ok, true);
  assert.equal(g.state[flagged], FLAGGED);

  // 从任意 0 格连锁，不能打开旗子
  const zeroIndex = [...g.nbrs[flagged]].find((i) => g.adj[i] === 0 && g.state[i] === HIDDEN);
  if (zeroIndex !== undefined) {
    g.reveal(zeroIndex);
    assert.equal(g.state[flagged], FLAGGED);
  }
  const r = g.reveal(flagged);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'flagged');
});

test('旗子上限 = 雷数，超出被拒', () => {
  const g = newGame(EASY, 'flagcap');
  g.reveal(g.indexOf(4, 4));
  let flagged = 0;
  for (let i = 0; i < g.size && flagged < EASY.mines; i++) {
    if (g.state[i] !== HIDDEN) continue;
    const r = g.toggleFlag(i);
    if (r.ok) flagged += 1;
  }
  assert.equal(g.flags, EASY.mines);
  assert.equal(g.remaining, 0);
  const extra = [...Array(g.size).keys()].find((i) => g.state[i] === HIDDEN);
  assert.equal(g.toggleFlag(extra).reason, 'limit');
});

test('胜利判定：所有非雷格挖开即赢，且插错的旗不算赢', () => {
  const g = newGame(EASY, 'wincheck');
  g.reveal(g.indexOf(4, 4));
  // 给一个安全格插旗，制造「还有安全格没挖开」
  const safeHidden = firstSafe(g);
  g.toggleFlag(safeHidden);
  for (let i = 0; i < g.size; i++) {
    if (g.mine[i] || g.state[i] !== HIDDEN) continue;
    g.reveal(i);
  }
  assert.equal(g.status, 'playing'); // 旗子还插着，没赢
  g.toggleFlag(safeHidden);
  g.reveal(safeHidden);
  assert.equal(g.status, 'won');
  assert.equal(g.revealedSafe, g.totalSafe);
  // 胜利后剩余雷自动插旗：剩余雷数归零，所有雷格都是旗
  assert.equal(g.flags, g.mineCount);
  assert.equal(g.remaining, 0);
  for (let i = 0; i < g.size; i++) {
    if (g.mine[i]) assert.equal(g.state[i], FLAGGED);
  }
});

test('踩雷：立即失败，标记爆炸格，其它雷在结算视图里可见', () => {
  const g = newGame(MEDIUM, 'boom');
  g.reveal(g.indexOf(8, 8));
  const mineIndex = [...Array(g.size).keys()].find((i) => g.mine[i]);
  const res = g.reveal(mineIndex);
  assert.equal(res.ok, true);
  assert.equal(res.mine, true);
  assert.equal(g.status, 'lost');
  assert.equal(g.explodedIndex, mineIndex);
  assert.equal(g.cellVisual(mineIndex), 'exploded');
  const other = [...Array(g.size).keys()].find((i) => g.mine[i] && i !== mineIndex);
  assert.equal(g.cellVisual(other), 'mine');
});

test('插错的旗在失败后显示为 wrongflag', () => {
  const g = newGame(MEDIUM, 'wrongflag');
  g.reveal(g.indexOf(8, 8));
  const safe = [...Array(g.size).keys()].find((i) => !g.mine[i] && g.state[i] === HIDDEN);
  g.toggleFlag(safe);
  const mineIndex = [...Array(g.size).keys()].find((i) => g.mine[i]);
  g.reveal(mineIndex);
  assert.equal(g.cellVisual(safe), 'wrongflag');
});

test('撤销：恢复到展开前，标记练习局，最多 3 次', () => {
  const g = newGame(MEDIUM, 'undo1');
  g.reveal(g.indexOf(8, 8));
  // 再挖一个安全格，记下前后状态
  const next = [...Array(g.size).keys()].find((i) => !g.mine[i] && g.state[i] === HIDDEN);
  const before = Uint8Array.from(g.state);
  const beforeRevealed = g.revealedSafe;
  g.reveal(next);
  assert.ok(g.revealedSafe > beforeRevealed);

  assert.equal(g.undo(), true);
  assert.deepEqual(Array.from(g.state), Array.from(before));
  assert.equal(g.revealedSafe, beforeRevealed);
  assert.equal(g.assisted, true);
  assert.equal(g.undoUsed, 1);

  // 已经撤销过 1 次，剩下只能再撤 UNDO_LIMIT − 1 次
  for (let k = 0; k < 6; k++) {
    const i = [...Array(g.size).keys()].find((x) => !g.mine[x] && g.state[x] === HIDDEN);
    if (i === undefined) break;
    g.reveal(i);
  }
  let undone = 0;
  while (g.undo()) undone += 1;
  assert.equal(undone, UNDO_LIMIT - 1);
  assert.equal(g.undo(), false);
  assert.equal(g.undoUsed, UNDO_LIMIT);
});

test('撤销：踩雷后不能撤销，快照是深拷贝不被后续改动污染', () => {
  const g = newGame(MEDIUM, 'undosafety');
  g.reveal(g.indexOf(8, 8));
  const next = [...Array(g.size).keys()].find((i) => !g.mine[i] && g.state[i] === HIDDEN);
  g.reveal(next);
  // 快照里的 state 与实时 state 必须是两份内存
  const snap = g.undoStack[0];
  g.state[next] = FLAGGED;
  assert.notEqual(snap.state[next], FLAGGED);

  const mineIndex = [...Array(g.size).keys()].find((i) => g.mine[i]);
  g.reveal(mineIndex);
  assert.equal(g.status, 'lost');
  assert.equal(g.undo(), false);
});

test('提示：只给安全格、计次、标记练习局、最多 3 次', () => {
  const g = newGame(MEDIUM, 'hint');
  g.reveal(g.indexOf(8, 8));
  for (let k = 0; k < HINT_LIMIT; k++) {
    const h = g.hint();
    assert.ok(h, `第 ${k + 1} 次提示不该为空`);
    assert.equal(g.mine[h.index], 0);
    assert.equal(g.state[h.index], REVEALED);
    assert.equal(g.assisted, true);
  }
  assert.equal(g.hint(), null);
  assert.equal(g.hintUsed, HINT_LIMIT);
});

test('提示：首击前使用也安全（会在提示格周围布雷）', () => {
  const g = newGame(MEDIUM, 'hintfirst');
  const h = g.hint();
  assert.ok(h);
  assert.equal(g.mine[h.index], 0);
  assert.equal(g.minesPlaced, true);
  for (const nb of g.neighbors(h.index)) assert.equal(g.mine[nb], 0);
});

test('reset 用新种子重建棋盘', () => {
  const g = newGame(EASY, 'resetA');
  g.reveal(g.indexOf(4, 4));
  const minesA = Array.from(g.mine);
  g.reset('resetB');
  assert.equal(g.status, 'idle');
  assert.equal(g.revealedSafe, 0);
  assert.equal(countMines(g), 0);
  g.reveal(g.indexOf(4, 4));
  assert.notDeepEqual(Array.from(g.mine), minesA);
  assert.equal(countMines(g), EASY.mines);
});

test('三档难度的雷数与格数都在合法区间', () => {
  for (const level of Object.values(LEVELS)) {
    const g = newGame(level, 'sanity');
    g.reveal(g.indexOf(Math.floor(level.cols / 2), Math.floor(level.rows / 2)));
    assert.equal(countMines(g), level.mines);
    assert.ok(g.progress > 0 && g.progress < 1);
  }
  assert.equal(HARD.mines, 99);
  assert.equal(MEDIUM.cols * MEDIUM.rows, 256);
});

test('和弦：旗数相符时一次展开其余邻格，且只占一个撤销快照', () => {
  const g = newGame(MEDIUM, 'chord-open');
  g.reveal(g.indexOf(8, 8));

  // 找一个已挖开的数字格，且它还有未挖开的安全邻格
  let target = -1;
  for (let i = 0; i < g.size; i++) {
    if (g.state[i] !== REVEALED || g.adj[i] === 0) continue;
    const hiddenSafe = g.neighbors(i).filter((nb) => !g.mine[nb] && g.state[nb] === HIDDEN);
    if (hiddenSafe.length > 0) {
      target = i;
      break;
    }
  }
  assert.ok(target >= 0, '盘面上找不到可和弦的数字格');

  const nbrs = g.neighbors(target);
  for (const nb of nbrs) if (g.mine[nb]) g.toggleFlag(nb);
  const hiddenSafe = nbrs.filter((nb) => !g.mine[nb] && g.state[nb] === HIDDEN);
  const before = Uint8Array.from(g.state);

  const res = g.chord(target);
  assert.equal(res.ok, true);
  assert.equal(res.mine, false);
  for (const h of hiddenSafe) assert.equal(g.state[h], REVEALED);

  // 整次和弦只进一个快照，撤销要能整体退回
  assert.equal(g.undo(), true);
  assert.deepEqual(Array.from(g.state), Array.from(before));
});

test('和弦：旗数不符或格未挖开时什么都不做', () => {
  const g = newGame(MEDIUM, 'chord-reject');
  g.reveal(g.indexOf(8, 8));

  let num = -1;
  for (let i = 0; i < g.size; i++) {
    if (g.state[i] === REVEALED && g.adj[i] > 0) {
      num = i;
      break;
    }
  }
  assert.ok(num >= 0);
  const before = Uint8Array.from(g.state);

  const mismatch = g.chord(num);
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.reason, 'flags-mismatch');
  assert.deepEqual(Array.from(g.state), Array.from(before));

  const hidden = [...Array(g.size).keys()].find((i) => g.state[i] === HIDDEN);
  assert.equal(g.chord(hidden).reason, 'not-open');
});

test('和弦：旗插错会踩雷，与经典一致', () => {
  const g = newGame(MEDIUM, 'chord-boom');
  g.reveal(g.indexOf(8, 8));

  let target = -1;
  for (let i = 0; i < g.size; i++) {
    if (g.state[i] !== REVEALED || g.adj[i] === 0) continue;
    const nbrs = g.neighbors(i);
    const hiddenSafe = nbrs.filter((nb) => !g.mine[nb] && g.state[nb] === HIDDEN);
    const hiddenMine = nbrs.filter((nb) => g.mine[nb] && g.state[nb] === HIDDEN);
    if (hiddenSafe.length >= g.adj[i] && hiddenMine.length > 0) {
      target = i;
      break;
    }
  }
  assert.ok(target >= 0, '盘面上找不到可制造错旗的数字格');

  const nbrs = g.neighbors(target);
  const hiddenSafe = nbrs.filter((nb) => !g.mine[nb] && g.state[nb] === HIDDEN);
  for (const nb of hiddenSafe.slice(0, g.adj[target])) g.toggleFlag(nb);

  const res = g.chord(target);
  assert.equal(res.ok, true);
  assert.equal(res.mine, true);
  assert.equal(g.status, 'lost');
  assert.ok(g.explodedIndex >= 0);
  assert.equal(g.undo(), false); // 结束了不能撤销
});
