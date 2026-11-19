/*!
 * 3D 俄罗斯方块 · 纯逻辑内核
 *
 * 这里只有规则，没有任何 DOM / WebGL / Three.js 依赖：
 * 判定平面、SRS 旋转与踢墙、7-bag 随机、Guideline 计分、等级与重力。
 *
 * 双端加载：
 *   浏览器（经典 script，file:// 可用）→ globalThis.TetrisCore
 *   node（测试）→ module.exports
 *
 * 坐标约定：x 向右 0..9，y 向上 0..19（y=0 是井底）。
 * 屏幕坐标的「向下」在这个内核里是 y 减小，渲染层负责翻转。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TetrisCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var COLS = 10;
  var ROWS = 20;
  var LOCK_DELAY_MS = 500;
  var MAX_LOCK_RESETS = 15;

  var TYPES = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];
  var PIECE_ID = { I: 1, J: 2, L: 3, O: 4, S: 5, T: 6, Z: 7 };

  // ---------------------------------------------------------------- 形状
  // 每个方块 4 个旋转态，用 ASCII 行定义（第 0 行是视觉最上面一行）。
  // 行 r 换算成内核坐标：y = (N-1) - r，这样 y 向上和视觉方向一致。
  var SHAPE_SRC = {
    I: {
      size: 4,
      states: [
        ['....', 'IIII', '....', '....'],
        ['..I.', '..I.', '..I.', '..I.'],
        ['....', '....', 'IIII', '....'],
        ['.I..', '.I..', '.I..', '.I..']
      ]
    },
    J: {
      size: 3,
      states: [
        ['J..', 'JJJ', '...'],
        ['.JJ', '.J.', '.J.'],
        ['...', 'JJJ', '..J'],
        ['.J.', '.J.', 'JJ.']
      ]
    },
    L: {
      size: 3,
      states: [
        ['..L', 'LLL', '...'],
        ['.L.', '.L.', '.LL'],
        ['...', 'LLL', 'L..'],
        ['LL.', '.L.', '.L.']
      ]
    },
    O: {
      size: 3,
      states: [
        ['.OO', '.OO', '...'],
        ['.OO', '.OO', '...'],
        ['.OO', '.OO', '...'],
        ['.OO', '.OO', '...']
      ]
    },
    S: {
      size: 3,
      states: [
        ['.SS', 'SS.', '...'],
        ['.S.', '.SS', '..S'],
        ['...', '.SS', 'SS.'],
        ['S..', 'SS.', '.S.']
      ]
    },
    T: {
      size: 3,
      states: [
        ['.T.', 'TTT', '...'],
        ['.T.', '.TT', '.T.'],
        ['...', 'TTT', '.T.'],
        ['.T.', 'TT.', '.T.']
      ]
    },
    Z: {
      size: 3,
      states: [
        ['ZZ.', '.ZZ', '...'],
        ['..Z', '.ZZ', '.Z.'],
        ['...', 'ZZ.', '.ZZ'],
        ['.Z.', 'ZZ.', 'Z..']
      ]
    }
  };

  // 预解析成 [x, y] 列表，避免每帧解析字符串。
  var PIECES = {};
  TYPES.forEach(function (type) {
    var def = SHAPE_SRC[type];
    var states = def.states.map(function (rows) {
      var cells = [];
      for (var r = 0; r < rows.length; r++) {
        for (var c = 0; c < rows[r].length; c++) {
          if (rows[r][c] !== '.') cells.push([c, (rows.length - 1) - r]);
        }
      }
      return cells;
    });
    PIECES[type] = { size: def.size, states: states };
  });

  // ---------------------------------------------------------------- 踢墙表
  // SRS 标准表，坐标 y 向上；键是「起始旋转态 > 目标旋转态」。
  var KICK_JLSTZ = {
    '0>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '1>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '1>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '2>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '2>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    '3>2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '3>0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '0>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]]
  };

  var KICK_I = {
    '0>1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '1>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '1>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
    '2>1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '2>3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '3>2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '3>0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '0>3': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]]
  };

  var KICK_O = {
    '0>1': [[0, 0]], '1>0': [[0, 0]], '1>2': [[0, 0]], '2>1': [[0, 0]],
    '2>3': [[0, 0]], '3>2': [[0, 0]], '3>0': [[0, 0]], '0>3': [[0, 0]]
  };

  // 每级每格的下落间隔（ms）。20 级以上按 20 级算，即接近 20G。
  var GRAVITY_MS = [
    800, 717, 633, 550, 467, 383, 300, 217, 133, 100,
    83, 83, 67, 67, 50, 50, 33, 33, 17, 17
  ];

  // ---------------------------------------------------------------- 随机
  // mulberry32：小而稳，给定种子完全可复现，方便测试与 ?seed= 复现。
  function makeRng(seed) {
    var a = (seed >>> 0) || 0x9e3779b9;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------------------------------------------------------------- 工具
  function idx(x, y) { return y * COLS + x; }

  function cellsOf(type, rot) {
    return PIECES[type].states[rot & 3];
  }

  function absCells(active) {
    var src = cellsOf(active.type, active.rot);
    var out = new Array(src.length);
    for (var i = 0; i < src.length; i++) {
      out[i] = [active.x + src[i][0], active.y + src[i][1]];
    }
    return out;
  }

  function collides(board, type, rot, x, y) {
    var cells = cellsOf(type, rot);
    for (var i = 0; i < cells.length; i++) {
      var bx = x + cells[i][0];
      var by = y + cells[i][1];
      if (bx < 0 || bx >= COLS || by < 0 || by >= ROWS) return true;
      if (board[idx(bx, by)] !== 0) return true;
    }
    return false;
  }

  function pushEvent(s, ev) {
    s.events.push(ev);
    // 事件只是给 UI 消费的，长时间不取也不能无限涨。
    if (s.events.length > 64) s.events.splice(0, s.events.length - 64);
  }

  // ---------------------------------------------------------------- 状态
  function createState(seed) {
    var s = {
      board: new Uint8Array(COLS * ROWS),
      queue: [],
      hold: null,
      canHold: true,
      active: null,
      score: 0,
      lines: 0,
      level: 1,
      combo: -1,
      b2b: false,
      status: 'ready', // ready | playing | paused | over
      gravityAcc: 0,
      lockTimer: 0,
      lockResets: 0,
      grounded: false,
      rotatedLast: false,
      lastKick: -1,
      rng: makeRng(seed == null ? (Date.now() & 0xffffffff) : seed),
      events: [],
      stats: { pieces: 0, clears: 0, tetrises: 0, tspins: 0, maxCombo: 0 }
    };
    refillQueue(s);
    return s;
  }

  function refillQueue(s) {
    while (s.queue.length < 7) {
      var bag = TYPES.slice();
      for (var i = bag.length - 1; i > 0; i--) {
        var j = Math.floor(s.rng() * (i + 1));
        var t = bag[i]; bag[i] = bag[j]; bag[j] = t;
      }
      s.queue.push.apply(s.queue, bag);
    }
  }

  function spawnPos(type) {
    // 所有方块出生在顶部两行、水平居中：3×3 占 3..5 列，I 占 3..6 列。
    return { x: 3, y: ROWS - 3 };
  }

  function spawnType(s, type) {
    var p = spawnPos(type);
    s.active = { type: type, rot: 0, x: p.x, y: p.y };
    s.gravityAcc = 0;
    s.lockTimer = 0;
    s.lockResets = 0;
    s.grounded = false;
    s.rotatedLast = false;
    s.lastKick = -1;
    s.stats.pieces += 1;
    if (collides(s.board, type, 0, p.x, p.y)) {
      s.status = 'over';
      pushEvent(s, { type: 'gameover' });
      return false;
    }
    pushEvent(s, { type: 'spawn', piece: type });
    return true;
  }

  function spawnNext(s) {
    refillQueue(s);
    var type = s.queue.shift();
    refillQueue(s);
    return spawnType(s, type);
  }

  function start(s) {
    if (s.status === 'playing') return true;
    s.status = 'playing';
    spawnNext(s);
    return s.status === 'playing';
  }

  function pause(s) {
    if (s.status === 'playing') { s.status = 'paused'; return true; }
    return false;
  }

  function resume(s) {
    if (s.status === 'paused') { s.status = 'playing'; return true; }
    return false;
  }

  function isGrounded(s) {
    var a = s.active;
    return collides(s.board, a.type, a.rot, a.x, a.y - 1);
  }

  function gravityMs(level) {
    var i = Math.max(0, Math.min(GRAVITY_MS.length - 1, level - 1));
    return GRAVITY_MS[i];
  }

  // 落地后每次移动/旋转都能重置锁定计时，但最多 15 次，防止无限拖延。
  function afterManualMove(s) {
    if (!s.active) return;
    if (isGrounded(s)) {
      if (s.lockResets < MAX_LOCK_RESETS) {
        s.lockTimer = 0;
        s.lockResets += 1;
      }
    } else {
      // 离开地面后重新获得完整的重置额度
      s.lockTimer = 0;
      s.lockResets = 0;
    }
  }

  function tryMove(s, dx, dy) {
    if (s.status !== 'playing' || !s.active) return false;
    var a = s.active;
    if (collides(s.board, a.type, a.rot, a.x + dx, a.y + dy)) return false;
    a.x += dx;
    a.y += dy;
    if (dy < 0 || dx !== 0) s.rotatedLast = false;
    afterManualMove(s);
    pushEvent(s, { type: 'move', dx: dx, dy: dy });
    return true;
  }

  function kickTable(type) {
    if (type === 'I') return KICK_I;
    if (type === 'O') return KICK_O;
    return KICK_JLSTZ;
  }

  function tryRotate(s, dir) {
    if (s.status !== 'playing' || !s.active) return false;
    var a = s.active;
    var to = (a.rot + (dir > 0 ? 1 : 3)) & 3;
    var table = kickTable(a.type);
    var kicks = table[a.rot + '>' + to] || [[0, 0]];
    for (var i = 0; i < kicks.length; i++) {
      var nx = a.x + kicks[i][0];
      var ny = a.y + kicks[i][1];
      if (!collides(s.board, a.type, to, nx, ny)) {
        a.rot = to;
        a.x = nx;
        a.y = ny;
        s.rotatedLast = true;
        s.lastKick = i;
        afterManualMove(s);
        pushEvent(s, { type: 'rotate', dir: dir, kick: i });
        return true;
      }
    }
    return false;
  }

  function ghostY(s) {
    if (!s.active) return null;
    var a = s.active;
    var y = a.y;
    while (!collides(s.board, a.type, a.rot, a.x, y - 1)) y -= 1;
    return y;
  }

  function hardDrop(s) {
    if (s.status !== 'playing' || !s.active) return 0;
    var a = s.active;
    var dist = 0;
    while (!collides(s.board, a.type, a.rot, a.x, a.y - 1)) {
      a.y -= 1;
      dist += 1;
    }
    s.rotatedLast = s.rotatedLast && dist === 0;
    s.score += dist * 2; // Guideline：硬降每格 2 分
    lock(s);
    pushEvent(s, { type: 'harddrop', distance: dist });
    return dist;
  }

  function softDrop(s) {
    if (s.status !== 'playing' || !s.active) return false;
    if (tryMove(s, 0, -1)) {
      s.score += 1; // Guideline：软降每格 1 分
      return true;
    }
    return false;
  }

  function hold(s) {
    if (s.status !== 'playing' || !s.active || !s.canHold) return false;
    var cur = s.active.type;
    var swap = s.hold;
    s.hold = cur;
    s.active = null;
    s.canHold = false;
    if (swap) spawnType(s, swap);
    else spawnNext(s);
    pushEvent(s, { type: 'hold', piece: cur });
    return true;
  }

  // ---------------------------------------------------------------- T-spin
  // 判定只看 T 块 4 个对角：占 3 个以上算 T-spin；
  // 两个前角都被占是完整 T-spin，否则按 mini 算。
  function detectTSpin(s, active) {
    var a = active;
    var corners = [[0, 0], [2, 0], [0, 2], [2, 2]];
    var occupied = 0;
    var status = [false, false, false, false];
    for (var i = 0; i < 4; i++) {
      var bx = a.x + corners[i][0];
      var by = a.y + corners[i][1];
      var blocked = bx < 0 || bx >= COLS || by < 0 || by >= ROWS ||
        s.board[idx(bx, by)] !== 0;
      status[i] = blocked;
      if (blocked) occupied += 1;
    }
    if (occupied < 3) return null;
    // 前角：rot0 朝上（前=y+2 的两个角），rot1 朝右，rot2 朝下，rot3 朝左
    var front;
    if (a.rot === 0) front = [status[2], status[3]];
    else if (a.rot === 1) front = [status[1], status[3]];
    else if (a.rot === 2) front = [status[0], status[1]];
    else front = [status[0], status[2]];
    return (front[0] && front[1]) ? 'full' : 'mini';
  }

  // ---------------------------------------------------------------- 消行与计分
  function clearFullRows(board) {
    var rows = [];
    for (var y = 0; y < ROWS; y++) {
      var full = true;
      for (var x = 0; x < COLS; x++) {
        if (board[idx(x, y)] === 0) { full = false; break; }
      }
      if (full) rows.push(y);
    }
    if (rows.length === 0) return { board: board, rows: rows };
    var next = new Uint8Array(COLS * ROWS);
    var writeY = 0;
    for (var src = 0; src < ROWS; src++) {
      if (rows.indexOf(src) !== -1) continue;
      for (var c = 0; c < COLS; c++) next[idx(c, writeY)] = board[idx(c, src)];
      writeY += 1;
    }
    return { board: next, rows: rows };
  }

  // Guideline 基础分：单 100 / 双 300 / 三 500 / 四 800，再乘等级。
  var LINE_SCORE = [0, 100, 300, 500, 800];
  var TSPIN_SCORE = [0, 800, 1200, 1600];
  var TSPIN_MINI_SCORE = [0, 100, 400];

  function scoreForClear(n, tspin, level, b2b, combo) {
    // 没消行就没有任何基础分与连击奖励，这一条必须写死在函数里，
    // 不能依赖调用方传 -1。
    if (n <= 0) return 0;
    var base;
    if (tspin) {
      base = tspin === 'mini'
        ? (TSPIN_MINI_SCORE[n] || 0)
        : (TSPIN_SCORE[n] || 0);
    } else {
      base = LINE_SCORE[n] || 0;
    }
    var difficult = n === 4 || !!tspin;
    var gain = base * level;
    if (difficult && b2b) gain = Math.round(gain * 1.5);
    if (combo > 0) gain += 50 * combo * level;
    return gain;
  }

  function lock(s) {
    var a = s.active;
    if (!a) return null;
    var tspin = (a.type === 'T' && s.rotatedLast) ? detectTSpin(s, a) : null;
    var cells = absCells(a);
    for (var i = 0; i < cells.length; i++) {
      var x = cells[i][0];
      var y = cells[i][1];
      if (y >= 0 && y < ROWS && x >= 0 && x < COLS) {
        s.board[idx(x, y)] = PIECE_ID[a.type];
      }
    }
    var res = clearFullRows(s.board);
    s.board = res.board;
    var n = res.rows.length;

    var levelBefore = s.level;
    // 没有消行时必须传 -1：否则「combo > 0」的连击奖励会凭空叠上去。
    var comboAfter = n > 0 ? s.combo + 1 : -1;
    s.score += scoreForClear(n, tspin, s.level, s.b2b, comboAfter);
    var difficult = n === 4 || !!tspin;
    if (n > 0) {
      s.combo += 1;
      if (s.combo > s.stats.maxCombo) s.stats.maxCombo = s.combo;
    } else {
      s.combo = -1;
    }
    s.b2b = difficult ? true : (n > 0 ? false : s.b2b);
    s.lines += n;
    s.stats.clears += n;
    if (n === 4) s.stats.tetrises += 1;
    if (tspin) s.stats.tspins += 1;
    s.level = Math.min(20, 1 + Math.floor(s.lines / 10));

    var payload = {
      type: 'lock',
      piece: a.type,
      cleared: n,
      rows: res.rows,
      tspin: tspin,
      combo: s.combo,
      b2b: s.b2b,
      levelUp: s.level > levelBefore,
      level: s.level,
      score: s.score
    };
    pushEvent(s, payload);

    s.active = null;
    s.canHold = true;
    s.lockTimer = 0;
    s.lockResets = 0;
    s.gravityAcc = 0;

    spawnNext(s);
    return payload;
  }

  function tick(s, dtMs) {
    if (s.status !== 'playing' || !s.active) return;
    var a = s.active;
    var dt = Math.max(0, Math.min(dtMs, 200));

    s.grounded = isGrounded(s);
    if (s.grounded) {
      s.gravityAcc = 0;
      s.lockTimer += dt;
      if (s.lockTimer >= LOCK_DELAY_MS) lock(s);
      return;
    }

    s.lockTimer = 0;
    s.gravityAcc += dt;
    var interval = gravityMs(s.level);
    var guard = 0;
    while (s.gravityAcc >= interval && guard < 64) {
      guard += 1;
      s.gravityAcc -= interval;
      if (!collides(s.board, a.type, a.rot, a.x, a.y - 1)) {
        a.y -= 1;
        s.rotatedLast = false;
      } else {
        s.gravityAcc = 0;
        break;
      }
    }
  }

  // ---------------------------------------------------------------- 导出
  return {
    COLS: COLS,
    ROWS: ROWS,
    TYPES: TYPES,
    PIECE_ID: PIECE_ID,
    LOCK_DELAY_MS: LOCK_DELAY_MS,
    MAX_LOCK_RESETS: MAX_LOCK_RESETS,
    GRAVITY_MS: GRAVITY_MS,

    createState: createState,
    start: start,
    pause: pause,
    resume: resume,
    spawnNext: spawnNext,
    spawnType: spawnType,
    refillQueue: refillQueue,

    cellsOf: cellsOf,
    absCells: absCells,
    collides: collides,
    tryMove: tryMove,
    tryRotate: tryRotate,
    softDrop: softDrop,
    hardDrop: hardDrop,
    hold: hold,
    ghostY: ghostY,
    isGrounded: isGrounded,
    gravityMs: gravityMs,
    tick: tick,
    lock: lock,

    clearFullRows: clearFullRows,
    scoreForClear: scoreForClear,
    detectTSpin: detectTSpin,

    // 测试用：踢墙表与形状定义要能被断言检查
    _test: {
      PIECES: PIECES,
      SHAPE_SRC: SHAPE_SRC,
      KICK_JLSTZ: KICK_JLSTZ,
      KICK_I: KICK_I,
      idx: idx
    }
  };
});
