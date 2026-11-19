/**
 * 逻辑层单测：node --test tests/
 *
 * 只测“规则事实”，不测表现。每条断言都对应一个玩家能感知的行为
 * （撞墙死/穿墙/自撞/障碍/成长/关卡达标/超时/道具倍率）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  newGame, tick, queueDirection, updateTimers, advanceLevel,
  tickMs, baseTick, foodValue, levelTarget, levelTimeLimit, obstaclesForLevel,
  spawnFood, cellKey, speedFactor, DIRS,
} from '../src/logic.js';
import { ITEM_TYPES, ITEM_TTL, COLS, ROWS } from '../src/config.js';

const mk = (opts = {}) => newGame({ seed: 42, ...opts });

/** 把食物放到当前前进方向的下一格，方便“喂一口”。 */
function placeFoodAhead(state) {
  const h = state.snake[0];
  state.food = { x: h.x + state.dir.x, y: h.y + state.dir.y };
  return state.food;
}

test('开局：长度 4、头朝上、食物不在蛇身上', () => {
  const s = mk();
  assert.equal(s.snake.length, 4);
  assert.deepEqual(s.dir, DIRS.up);
  assert.ok(s.food);
  const occupied = new Set(s.snake.map((c) => cellKey(c.x, c.y)));
  assert.ok(!occupied.has(cellKey(s.food.x, s.food.y)));
  assert.equal(s.status, 'playing');
});

test('前进一步：头前进一格、尾收缩、长度不变', () => {
  const s = mk();
  const head = { ...s.snake[0] };
  tick(s);
  assert.equal(s.snake[0].x, head.x);
  assert.equal(s.snake[0].y, head.y - 1);
  assert.equal(s.snake.length, 4);
});

test('反向输入被拒绝，同向输入被忽略', () => {
  const s = mk();
  assert.equal(queueDirection(s, DIRS.down), false); // 正在向上，不能立刻向下
  assert.equal(queueDirection(s, DIRS.up), false);   // 同向无意义
  assert.equal(queueDirection(s, DIRS.left), true);
  assert.equal(queueDirection(s, DIRS.right), false); // 与队列最后一项相反
});

test('吃到食物：长度 +1、分数 +10、在原位置重刷食物', () => {
  const s = mk();
  placeFoodAhead(s);
  const before = s.snake.length;
  const events = tick(s);
  assert.ok(events.some((e) => e.type === 'eat'));
  assert.equal(s.snake.length, before + 1);
  assert.equal(s.score, 10);
  assert.equal(s.eaten, 1);
  assert.notDeepEqual(s.food, s.snake[0]);
});

test('经典模式撞墙即死', () => {
  const s = mk({ wall: 'classic' });
  s.snake = [{ x: 0, y: 5 }, { x: 1, y: 5 }, { x: 2, y: 5 }, { x: 3, y: 5 }];
  s.dir = DIRS.left;
  const events = tick(s);
  assert.equal(s.status, 'dead');
  assert.equal(s.reason, 'wall');
  assert.ok(events.some((e) => e.type === 'die' && e.reason === 'wall'));
});

test('穿墙模式从对面出现且不死', () => {
  const s = mk({ wall: 'wrap' });
  s.snake = [{ x: 0, y: 5 }, { x: 1, y: 5 }, { x: 2, y: 5 }, { x: 3, y: 5 }];
  s.dir = DIRS.left;
  const events = tick(s);
  assert.equal(s.status, 'playing');
  assert.deepEqual(s.snake[0], { x: COLS - 1, y: 5 });
  assert.ok(events.some((e) => e.type === 'wrap'));
});

test('穿墙模式撞自己仍然算死', () => {
  const s = mk({ wall: 'wrap' });
  // 身体中段贴右边缘同一行，从左边绕回来会撞上（尾格不算：它这一 tick 会腾空）
  s.snake = [{ x: 0, y: 5 }, { x: 1, y: 5 }, { x: COLS - 1, y: 5 }, { x: COLS - 2, y: 5 }];
  s.dir = DIRS.left;
  tick(s);
  assert.equal(s.status, 'dead');
  assert.equal(s.reason, 'self');
});

test('撞自身判死；踩即将腾空的尾格不算死', () => {
  const s = mk();
  s.snake = [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 6, y: 6 }, { x: 5, y: 6 }];
  s.dir = DIRS.down; // 目标 (5,6) 是尾格
  const keep = tick(s);
  assert.equal(s.status, 'playing', '尾格这一 tick 会腾空，应当允许');

  const s2 = mk();
  s2.snake = [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 6, y: 6 }, { x: 5, y: 6 }, { x: 4, y: 6 }];
  s2.dir = DIRS.down; // 目标 (5,6) 是身体中段
  tick(s2);
  assert.equal(s2.status, 'dead');
  assert.equal(s2.reason, 'self');
  assert.equal(keep.filter((e) => e.type === 'die').length, 0);
});

test('撞障碍判死', () => {
  const s = mk();
  s.obstacles = [{ x: s.snake[0].x, y: s.snake[0].y - 1 }];
  tick(s);
  assert.equal(s.status, 'dead');
  assert.equal(s.reason, 'obstacle');
});

test('关卡制：达标进入 levelclear 并结算剩余时间奖励', () => {
  const s = mk({ mode: 'level' });
  s.levelTarget = 2;
  s.levelTimeLeft = 5000;
  placeFoodAhead(s);
  tick(s);
  placeFoodAhead(s);
  const events = tick(s);
  assert.equal(s.status, 'levelclear');
  const cleared = events.find((e) => e.type === 'levelclear');
  assert.ok(cleared);
  assert.equal(cleared.bonus, Math.round(s.levelTimeLeft / 1000) * 3);
  assert.ok(s.score >= 20);
});

test('关卡推进：关卡 +1、目标/限时提高、障碍出现且不刷在蛇头 2 格内', () => {
  const s = mk({ mode: 'level' });
  for (let i = 0; i < 4; i++) advanceLevel(s);
  assert.equal(s.level, 5);
  assert.equal(s.levelTarget, levelTarget(5));
  assert.equal(s.levelTimeLeft, levelTimeLimit(5));
  assert.ok(s.obstacles.length > 0);
  const head = s.snake[0];
  for (const o of s.obstacles) {
    assert.ok(Math.max(Math.abs(o.x - head.x), Math.abs(o.y - head.y)) > 2,
      `障碍 ${JSON.stringify(o)} 离蛇头 ${JSON.stringify(head)} 太近`);
  }
});

test('关卡制超时判负', () => {
  const s = mk({ mode: 'level' });
  s.levelTimeLeft = 100;
  const events = updateTimers(s, 500);
  assert.equal(s.status, 'timeout');
  assert.ok(events.some((e) => e.type === 'die' && e.reason === 'time'));
});

test('道具：加速缩短步长、减速拉长步长、限时在关卡制加时间', () => {
  const s = mk({ mode: 'level' });
  const base = tickMs(s);
  s.timers.speed = 1000;
  const fast = tickMs(s);
  assert.ok(fast < base, `加速应更快：${fast} < ${base}`);
  assert.ok(Math.abs(fast - base * ITEM_TYPES.speed.mul) < 1e-6);

  s.timers.speed = 0;
  s.timers.slow = 1000;
  const slow = tickMs(s);
  assert.ok(slow > base);

  s.timers.slow = 0;
  const t0 = s.levelTimeLeft;
  // 把限时道具放在蛇头前方
  const h = s.snake[0];
  s.item = { x: h.x, y: h.y - 1, kind: 'time', ttl: ITEM_TTL };
  tick(s);
  assert.equal(s.item, null);
  assert.equal(s.levelTimeLeft, t0 + ITEM_TYPES.time.bonus);
});

test('道具：加速/减速互斥，后拾取的覆盖前者', () => {
  const s = mk();
  s.timers.speed = 3000;
  const h = s.snake[0];
  s.item = { x: h.x, y: h.y - 1, kind: 'slow', ttl: ITEM_TTL };
  tick(s);
  assert.equal(s.timers.slow, ITEM_TYPES.slow.dur);
  assert.equal(s.timers.speed, 0);
});

test('无尽模式：双倍分数在无尽下由限时道具触发', () => {
  const s = mk({ mode: 'endless' });
  const h = s.snake[0];
  s.item = { x: h.x, y: h.y - 1, kind: 'time', ttl: ITEM_TTL };
  tick(s);
  assert.equal(s.timers.double, ITEM_TYPES.time.dur);
  assert.equal(s.levelTimeLeft, 0);
});

test('食物永不生成在蛇身/障碍/道具上', () => {
  const s = mk({ mode: 'level' });
  s.obstacles = [{ x: 1, y: 1 }, { x: 2, y: 2 }];
  for (let i = 0; i < 300; i++) {
    s.food = null;
    const f = spawnFood(s);
    assert.ok(f, '必须总能找到空位');
    assert.ok(!s.snake.some((c) => c.x === f.x && c.y === f.y), '食物落在蛇身上');
    assert.ok(!s.obstacles.some((c) => c.x === f.x && c.y === f.y), '食物落在障碍上');
  }
});

test('速度曲线单调不增（越玩越快、有下限）', () => {
  const s = mk();
  let prev = baseTick(s);
  for (let i = 0; i < 60; i++) {
    s.totalEaten = i * 4;
    const now = baseTick(s);
    assert.ok(now <= prev + 1e-9, '食物越多步长不应变大');
    prev = now;
  }
  assert.ok(prev >= 72, '速度必须有下限，否则高难度会瞬移');
  assert.ok(tickMs(s) >= 62);
});

test('速度倍率展示值 > 1 表示比基础更快', () => {
  const s = mk();
  assert.equal(speedFactor(s), 1);
  s.timers.speed = 1000;
  assert.ok(speedFactor(s) > 1);
});

test('无尽模式吃食物会逐步长出障碍', () => {
  const s = mk();
  for (let i = 0; i < 40; i++) {
    placeFoodAhead(s);
    tick(s);
    if (s.status !== 'playing') break;
  }
  assert.ok(s.obstacles.length > 0, '吃到一定数量后应出现障碍');
  assert.ok(s.obstacles.length <= 20);
});

test('棋盘尺寸与常量自洽', () => {
  assert.equal(COLS % 2, 1);
  assert.equal(ROWS % 2, 1);
  assert.equal(foodValue(mk()), 10);
  assert.equal(obstaclesForLevel(1), 0);
});
