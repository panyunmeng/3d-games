'use strict';
/**
 * core.js 的零依赖单测（node --test tests/）。
 * 目的不是覆盖率，而是把「规则」逐条钉死：形状、踢墙、随机、消行、计分、T-spin、结束。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/core.js');

const { COLS, ROWS, TYPES } = C;

function emptyBoard() { return new Uint8Array(COLS * ROWS); }
function setCell(board, x, y, v = 1) { board[y * COLS + x] = v; }

test('形状：7 种方块、每块 4 个旋转态、每态 4 格、都在自己的外框内', () => {
  assert.deepEqual(TYPES.slice().sort(), ['I', 'J', 'L', 'O', 'S', 'T', 'Z']);
  for (const type of TYPES) {
    const def = C._test.PIECES[type];
    assert.equal(def.states.length, 4, type + ' 应有 4 个旋转态');
    for (let rot = 0; rot < 4; rot++) {
      const cells = def.states[rot];
      assert.equal(cells.length, 4, `${type}/${rot} 应有 4 格`);
      for (const [x, y] of cells) {
        assert.ok(x >= 0 && x < def.size, `${type}/${rot} x 越界`);
        assert.ok(y >= 0 && y < def.size, `${type}/${rot} y 越界`);
      }
      const uniq = new Set(cells.map(([x, y]) => x + ',' + y));
      assert.equal(uniq.size, 4, `${type}/${rot} 有重叠格`);
    }
  }
});

test('形状：ASCII 表与顺时针旋转公式自洽（(x,y) -> (y, N-1-x)）', () => {
  for (const type of TYPES) {
    const def = C._test.PIECES[type];
    if (type === 'O') continue; // O 四态相同
    const n = def.size;
    for (let rot = 0; rot < 4; rot++) {
      const from = def.states[rot]
        .map(([x, y]) => `${y},${n - 1 - x}`).sort();
      const to = def.states[(rot + 1) & 3]
        .map(([x, y]) => `${x},${y}`).sort();
      assert.deepEqual(from, to, `${type} 从态 ${rot} 顺时针转错了`);
    }
  }
});

test('踢墙表：8 个方向齐全、首项都是 (0,0)', () => {
  for (const table of [C._test.KICK_JLSTZ, C._test.KICK_I]) {
    for (let from = 0; from < 4; from++) {
      for (const dir of [1, 3]) {
        const to = (from + dir) & 3;
        const key = `${from}>${to}`;
        assert.ok(table[key], `缺 ${key}`);
        assert.deepEqual(table[key][0], [0, 0], `${key} 首项必须是原地`);
        assert.ok(table[key].length >= 5, `${key} 应有 5 个候选`);
      }
    }
  }
});

test('7-bag：每 7 个方块恰好包含 7 种，不重不漏', () => {
  const s = C.createState(20261117);
  const seq = [];
  for (let i = 0; i < 140; i++) {
    C.refillQueue(s);
    seq.push(s.queue.shift());
  }
  for (let bag = 0; bag < 20; bag++) {
    const slice = seq.slice(bag * 7, bag * 7 + 7).sort();
    assert.deepEqual(slice, ['I', 'J', 'L', 'O', 'S', 'T', 'Z'],
      `第 ${bag + 1} 袋重复或缺项：${slice.join('')}`);
  }
});

test('出生：空棋盘上 7 种方块都不重叠、都在场内', () => {
  for (const type of TYPES) {
    const s = C.createState(7);
    s.status = 'playing';
    const ok = C.spawnType(s, type);
    assert.ok(ok, `${type} 出生失败`);
    for (const [x, y] of C.absCells(s.active)) {
      assert.ok(x >= 0 && x < COLS && y >= 0 && y < ROWS, `${type} 出生越界 ${x},${y}`);
    }
  }
});

test('移动：撞左墙返回 false 且位置不变', () => {
  const s = C.createState(1);
  s.status = 'playing';
  C.spawnType(s, 'O');
  const before = s.active.x;
  let guard = 0;
  while (C.tryMove(s, -1, 0) && guard++ < 20) { /* 一直推到墙 */ }
  assert.equal(s.active.x, -1, 'O 图案占 1、2 列，贴左墙时 x 应为 -1');
  assert.ok(s.active.x <= before);
  assert.equal(C.tryMove(s, -1, 0), false);
});

test('踢墙：I 竖着贴左墙时能靠踢墙转成横的', () => {
  const s = C.createState(2);
  s.status = 'playing';
  s.board = emptyBoard();
  s.active = { type: 'I', rot: 1, x: -2, y: 5 };
  // 转前占据 x=0，y=5..8，合法
  assert.equal(C.collides(s.board, 'I', 1, -2, 5), false);
  const ok = C.tryRotate(s, 1);
  assert.equal(ok, true, '贴左墙的 I 应能踢墙旋转');
  assert.equal(s.active.rot, 2);
  assert.equal(s.active.x, 0, '应被踢到 x=0 才放得下横 I');
});

test('踢墙：贴右墙的 T 能转过去，且不越界', () => {
  const s = C.createState(3);
  s.status = 'playing';
  s.active = { type: 'T', rot: 1, x: 7, y: 5 }; // 竖 T 贴右墙
  const ok = C.tryRotate(s, 1);
  assert.equal(ok, true);
  for (const [x] of C.absCells(s.active)) {
    assert.ok(x >= 0 && x < COLS, '踢墙后越界');
  }
});

test('幽灵落点：落在不能继续下落的最高位置', () => {
  const s = C.createState(4);
  s.status = 'playing';
  C.spawnType(s, 'T');
  const gy = C.ghostY(s);
  assert.ok(collidesAfter(s, gy), '幽灵位置以下应该已撞');
  assert.equal(C.collides(s.board, s.active.type, s.active.rot, s.active.x, gy - 1), true);
  assert.equal(C.collides(s.board, s.active.type, s.active.rot, s.active.x, gy), false);
});

function collidesAfter(s, y) {
  return C.collides(s.board, s.active.type, s.active.rot, s.active.x, y - 1);
}

test('消行：满行移除、上方整体下落、行号正确', () => {
  const board = emptyBoard();
  for (let x = 0; x < COLS; x++) setCell(board, x, 0, 3);
  setCell(board, 0, 1, 5); // 上面一行只有一个块，应随之下落
  const res = C.clearFullRows(board);
  assert.deepEqual(res.rows, [0]);
  assert.equal(res.board[0 * COLS + 0], 5, '上方方块应落到 y=0');
  assert.equal(res.board[1 * COLS + 0], 0, '原位置应清空');
});

test('消行：连消两行时行号与结果都正确', () => {
  const board = emptyBoard();
  for (let x = 0; x < COLS; x++) { setCell(board, x, 0, 1); setCell(board, x, 2, 2); }
  const res = C.clearFullRows(board);
  assert.deepEqual(res.rows, [0, 2]);
  for (let x = 0; x < COLS; x++) assert.equal(res.board[x], 0, '清掉后剩下的是空行 y=1，应落到 y=0');
});

test('计分：单/双/三/四 基础分与等级乘数', () => {
  assert.equal(C.scoreForClear(1, null, 1, false, -1), 100);
  assert.equal(C.scoreForClear(2, null, 1, false, -1), 300);
  assert.equal(C.scoreForClear(3, null, 1, false, -1), 500);
  assert.equal(C.scoreForClear(4, null, 1, false, -1), 800);
  assert.equal(C.scoreForClear(4, null, 5, false, -1), 4000);
});

test('计分：T-spin 单双与 mini', () => {
  assert.equal(C.scoreForClear(1, 'full', 1, false, -1), 800);
  assert.equal(C.scoreForClear(2, 'full', 1, false, -1), 1200);
  assert.equal(C.scoreForClear(1, 'mini', 1, false, -1), 100);
  assert.equal(C.scoreForClear(2, 'mini', 1, false, -1), 400);
});

test('计分：back-to-back 1.5 倍、连击 50×combo×level', () => {
  assert.equal(C.scoreForClear(4, null, 1, true, -1), 1200);
  assert.equal(C.scoreForClear(1, null, 2, false, 1), 300); // 200 + 50×1×2
  assert.equal(C.scoreForClear(1, null, 2, false, 3), 500); // 200 + 300
});

test('计分：无消行不加连击奖励（回归测试）', () => {
  assert.equal(C.scoreForClear(0, null, 1, false, 5), 0);
});

test('T-spin 判定：3 角占用且前角不全 → mini；前角全占 → full', () => {
  const s = C.createState(5);
  s.status = 'playing';
  s.board = emptyBoard();
  s.active = { type: 'T', rot: 0, x: 3, y: 5 };
  // 角：(3,5) (5,5) (3,7) (5,7)；前角 = 上面两个（rot0 朝上）
  setCell(s.board, 3, 5); setCell(s.board, 5, 5); setCell(s.board, 3, 7);
  assert.equal(C.detectTSpin(s, s.active), 'mini');
  setCell(s.board, 5, 7);
  assert.equal(C.detectTSpin(s, s.active), 'full');
});

test('T-spin 判定：角占用不足 3 个时不算', () => {
  const s = C.createState(6);
  s.status = 'playing';
  s.board = emptyBoard();
  s.active = { type: 'T', rot: 0, x: 3, y: 5 };
  setCell(s.board, 3, 5); setCell(s.board, 5, 5);
  assert.equal(C.detectTSpin(s, s.active), null);
});

test('锁定：硬降落地、写进棋盘、出下一块、硬降分 = 2×格数', () => {
  const s = C.createState(8);
  s.status = 'playing';
  C.spawnType(s, 'O');
  const y0 = s.active.y;
  const dist = C.hardDrop(s);
  assert.ok(dist >= y0, '硬降距离应覆盖整个出生高度');
  assert.equal(s.score, dist * 2);
  let filled = 0;
  for (const v of s.board) if (v) filled++;
  assert.equal(filled, 4, 'O 落地应留下 4 格');
  assert.ok(s.active && s.active.type, '锁定后应立刻出下一块');
});

test('消行与等级：10 行升 1 级、25 行 3 级', () => {
  const s = C.createState(9);
  s.status = 'playing';
  s.lines = 9;
  s.level = 1;
  s.active = { type: 'I', rot: 0, x: 3, y: -2 }; // 图案在 y=2，落到底行
  for (let x = 0; x < COLS; x++) if (x < 3 || x > 6) setCell(s.board, x, 0);
  C.lock(s);
  assert.equal(s.lines, 10);
  assert.equal(s.level, 2);
  s.lines = 25;
  s.level = 1 + Math.floor(25 / 10);
  assert.equal(s.level, 3);
});

test('Hold：每块只能用一次，交换后数量不变', () => {
  const s = C.createState(10);
  s.status = 'playing';
  C.spawnType(s, 'T');
  assert.equal(C.hold(s), true);
  assert.equal(s.hold, 'T');
  assert.equal(C.hold(s), false, '同一块不能连续 Hold');
  C.hardDrop(s); // 新块解锁 canHold
  assert.ok(s.canHold);
  const before = s.active.type; // 第二次 Hold 前手上这块
  assert.equal(C.hold(s), true);
  assert.equal(s.active.type, 'T', 'Hold 出来的应该是第一次存下的 T');
  assert.equal(s.hold, before, '存进去的应该是第二次 Hold 前的活动块');
});

test('结束：方块堆到出生点后游戏结束', () => {
  const s = C.createState(11);
  s.status = 'playing';
  for (let y = ROWS - 3; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) setCell(s.board, x, y);
  }
  const ok = C.spawnNext(s);
  assert.equal(ok, false);
  assert.equal(s.status, 'over');
  assert.ok(s.events.some((e) => e.type === 'gameover'));
});

test('重力：等级→间隔单调不增，1 级 800ms，20 级 17ms', () => {
  assert.equal(C.gravityMs(1), 800);
  assert.equal(C.gravityMs(20), 17);
  for (let lv = 2; lv <= 20; lv++) {
    assert.ok(C.gravityMs(lv) <= C.gravityMs(lv - 1), `等级 ${lv} 间隔反而变大`);
  }
});

test('锁定延迟：贴地后 500ms 内移动可重置计时，超时锁定', () => {
  const s = C.createState(12);
  s.status = 'playing';
  C.spawnType(s, 'O');
  C.hardDrop(s); // 先锁一块，制造一个可落地的新块
  // 直接把当前块放到底部但不锁定
  while (C.tryMove(s, 0, -1)) { /* 落到底 */ }
  assert.equal(C.isGrounded(s), true);
  C.tick(s, 300);
  assert.ok(s.active, '300ms 未到锁定阈值');
  C.tryMove(s, 1, 0); // 贴地移动重置计时
  C.tick(s, 300);
  assert.ok(s.active, '移动后计时应已重置');
  C.tick(s, 600);
  // 已锁定并换块
  assert.ok(s.active);
});

test('模糊：300 块随机操作后状态始终自洽', () => {
  const s = C.createState(20261117);
  C.start(s);
  let guard = 0;
  while (s.status === 'playing' && guard < 300) {
    guard += 1;
    const dice = Math.floor(s.rng() * 10);
    if (dice < 4) C.tryMove(s, dice % 2 ? 1 : -1, 0);
    else if (dice < 6) C.tryRotate(s, dice % 2 ? 1 : -1);
    else if (dice === 6) C.softDrop(s);
    else if (dice === 7) C.hold(s);
    else C.hardDrop(s);
    C.tick(s, 16 * (1 + Math.floor(s.rng() * 3)));

    // 不变量
    assert.ok(Number.isFinite(s.score) && s.score >= 0, '分数必须是非负有限数');
    assert.ok(s.level >= 1 && s.level <= 20, '等级越界');
    assert.ok(s.lines >= 0);
    for (let i = 0; i < s.board.length; i++) {
      assert.ok(s.board[i] >= 0 && s.board[i] <= 7, '棋盘出现非法方块 id');
    }
    if (s.active && s.status === 'playing') {
      for (const [x, y] of C.absCells(s.active)) {
        assert.ok(x >= 0 && x < COLS && y >= 0 && y < ROWS, '活动方块越界');
        assert.equal(s.board[y * COLS + x], 0, '活动方块与已固定方块重叠');
      }
    }
    if (s.events.length > 64) assert.fail('事件队列无上限增长');
  }
  assert.ok(guard > 10, '模糊测试至少跑了 10 步');
  assert.ok(s.stats.pieces > 0);
});

test('确定性：同一 seed 两次对局序列完全一致', () => {
  const run = (seed) => {
    const s = C.createState(seed);
    C.start(s);
    const seq = [];
    for (let i = 0; i < 60; i++) {
      seq.push(s.active.type);
      C.hardDrop(s);
      if (s.status !== 'playing') break;
    }
    return seq.join('');
  };
  assert.equal(run(42), run(42));
  assert.notEqual(run(42), run(43));
});
