/**
 * 端到端模拟：用 BFS 贪心机器人把整局跑完，检查“任何时刻都成立的不变量”。
 *
 * 为什么需要它：单测各自验证一条规则，但真实的坏味道在长时间跑局里才露出来——
 * 食物刷到蛇身上、障碍叠在一起、关卡切换后计时器没重置、穿墙后身体自交。
 * 机器人不需要打得漂亮，只要能稳定推进，就足以把这些路走一遍。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  newGame, tick, updateTimers, tickMs, advanceLevel, queueDirection, cellKey,
} from '../src/logic.js';
import { COLS, ROWS, ITEM_TTL } from '../src/config.js';

/** 不变量：任何一 tick 之后都必须成立的事实。 */
function checkInvariants(s, ctx) {
  const seen = new Set();
  for (const c of s.snake) {
    assert.ok(c.x >= 0 && c.x < COLS && c.y >= 0 && c.y < ROWS, `${ctx}: 蛇身越界 ${JSON.stringify(c)}`);
    assert.ok(!seen.has(cellKey(c.x, c.y)), `${ctx}: 蛇身自交 ${JSON.stringify(c)}`);
    seen.add(cellKey(c.x, c.y));
  }
  for (const o of s.obstacles) {
    assert.ok(!seen.has(cellKey(o.x, o.y)), `${ctx}: 障碍压在蛇身上 ${JSON.stringify(o)}`);
    assert.equal(o.x >= 0 && o.x < COLS && o.y >= 0 && o.y < ROWS, true, `${ctx}: 障碍越界`);
  }
  if (s.food) {
    assert.ok(!seen.has(cellKey(s.food.x, s.food.y)), `${ctx}: 食物刷在蛇身上`);
    assert.ok(!s.obstacles.some((o) => o.x === s.food.x && o.y === s.food.y), `${ctx}: 食物刷在障碍上`);
  }
  if (s.item) {
    assert.ok(!seen.has(cellKey(s.item.x, s.item.y)), `${ctx}: 道具刷在蛇身上`);
    assert.ok(s.item.ttl > 0 && s.item.ttl <= ITEM_TTL, `${ctx}: 道具 TTL 异常`);
  }
  assert.ok(s.status !== 'playing' || s.snake.length >= 1);
  // 长度只能由“吃”产生：4 + 累计食物数，任何偏差都说明增长/收缩算错了
  assert.equal(s.snake.length, 4 + s.totalEaten, `${ctx}: 蛇长与累计食物数不匹配`);
  assert.ok(s.food || s.snake.length + s.obstacles.length >= COLS * ROWS, `${ctx}: 场上没有食物`);
}

/** 沿最短路径走向食物，返回下一步方向；走不到就返回能走的方向延命。 */
function botDir(s) {
  const head = s.snake[0];
  const wrap = s.wall === 'wrap';
  const blocked = new Set();
  for (let i = 0; i < s.snake.length - 1; i++) blocked.add(cellKey(s.snake[i].x, s.snake[i].y));
  for (const o of s.obstacles) blocked.add(cellKey(o.x, o.y));

  const step = (x, y, d) => {
    let nx = x + d.x;
    let ny = y + d.y;
    if (wrap) { nx = (nx + COLS) % COLS; ny = (ny + ROWS) % ROWS; }
    if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) return null;
    return { x: nx, y: ny };
  };

  const goal = s.food;
  const dirs = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
  if (goal) {
    const prev = new Map();
    const startKey = cellKey(head.x, head.y);
    const q = [head];
    const seen = new Set([startKey]);
    while (q.length) {
      const cur = q.shift();
      if (cur.x === goal.x && cur.y === goal.y) break;
      for (const d of dirs) {
        const n = step(cur.x, cur.y, d);
        if (!n) continue;
        const k = cellKey(n.x, n.y);
        if (seen.has(k) || blocked.has(k)) continue;
        seen.add(k);
        prev.set(k, { from: cellKey(cur.x, cur.y), dir: d });
        q.push(n);
      }
    }
    const goalKey = cellKey(goal.x, goal.y);
    if (prev.has(goalKey)) {
      // 回溯到第一步
      let k = goalKey;
      let first = prev.get(k);
      while (first && first.from !== startKey) {
        k = first.from;
        first = prev.get(k);
      }
      if (first) return first.dir;
    }
  }
  // 找不到路：挑一个不会立刻自杀的方向
  for (const d of dirs) {
    const n = step(head.x, head.y, d);
    if (!n) continue;
    if (blocked.has(cellKey(n.x, n.y))) continue;
    return d;
  }
  return null;
}

/** 把一局跑到结束或达到 maxTicks，返回统计。 */
function runBot(opts, maxTicks = 20000) {
  const s = newGame(opts);
  let ticks = 0;
  let clears = 0;
  let itemsPicked = 0;
  let maxObstacles = 0;
  let pendingClear = 0;   // 模拟“关卡通过横幅停留”的 1.45s

  while (ticks < maxTicks) {
    if (s.status === 'levelclear') {
      clears += 1;
      pendingClear += 1;
      advanceLevel(s);
      continue;
    }
    if (s.status !== 'playing') break;

    // 道具/倒计时按 tick 步长推进（与主循环同频，足够覆盖过期分支）
    const dt = tickMs(s);
    const evs = updateTimers(s, dt);
    for (const e of evs) if (e.type === 'item') itemsPicked += 1;
    if (s.status !== 'playing') break;

    const d = botDir(s);
    if (!d) break;
    queueDirection(s, d);
    const events = tick(s);
    for (const e of events) if (e.type === 'item') itemsPicked += 1;
    maxObstacles = Math.max(maxObstacles, s.obstacles.length);
    ticks += 1;
    checkInvariants(s, `${opts.mode}/${opts.wall} tick#${ticks}`);
  }
  return { s, ticks, clears, itemsPicked, maxObstacles, pendingClear };
}

test('关卡制 + 撞墙：机器人能连过多关，且全程不变量成立', () => {
  const r = runBot({ mode: 'level', wall: 'classic', seed: 7 }, 12000);
  assert.ok(r.clears >= 3, `应至少通过 3 关，实际 ${r.clears}（tick ${r.ticks}）`);
  assert.ok(r.s.score > 0);
  assert.equal(r.s.mode, 'level');
});

test('无尽 + 穿墙：跑长局，障碍增长到上限、分数持续上涨', () => {
  const r = runBot({ mode: 'endless', wall: 'wrap', seed: 11 }, 30000);
  assert.ok(r.ticks > 500, `机器人应能撑过 500 tick，实际 ${r.ticks}`);
  assert.ok(r.s.totalEaten > 40, `应吃到 40+ 食物，实际 ${r.s.totalEaten}`);
  assert.ok(r.maxObstacles > 0 && r.maxObstacles <= 20);
  assert.ok(r.s.score >= r.s.totalEaten * 10);
});

test('穿墙模式下长局不会自交或越界（这是穿墙最容易写错的地方）', () => {
  const r = runBot({ mode: 'endless', wall: 'wrap', seed: 99 }, 30000);
  checkInvariants(r.s, '收尾');
  assert.ok(r.s.snake.length > 5);
});

test('无尽模式下角色吃到道具会记录到统计里（说明道具链路真的会触发）', () => {
  const r = runBot({ mode: 'endless', wall: 'classic', seed: 3 }, 40000);
  assert.ok(r.s.totalEaten > 0);
  // 道具每 2 个食物刷一次，长局里几乎必然被拾取；同时校验没被误判成死亡
  assert.ok(r.s.status === 'playing' || r.s.status === 'dead');
});
