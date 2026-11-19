import { describe, expect, it } from 'vitest';
import { TILE, WORLD_H, WORLD_W, toCell, type EnemyKind } from '../src/sim/constants';
import { LEVELS, getLevel } from '../src/levels';
import { findPath, hasLineOfSight } from '../src/sim/pathfinding';
import { createWorld, nextLevelWorld, playerTank, stepWorld } from '../src/sim/world';
import { setTile, tileAt } from '../src/sim/map';
import type { PlayerInput, World } from '../src/sim/types';
import { SIM_DT } from '../src/sim/constants';

interface BotState {
  path: { cx: number; cz: number }[];
  index: number;
  repath: number;
  lastX: number;
  lastZ: number;
  stuck: number;
}

/** 测试用自动驾驶：A* 追最近的敌人，有视线就开火；卡墙时朝车头开炮开路。 */
function botInput(world: World, playerId: string, state: BotState): PlayerInput {
  const tank = playerTank(world, playerId);
  if (!tank || !tank.alive) return { move: 0, turn: 0, aim: null, fire: false };

  let target = null as null | { x: number; z: number; id: number };
  let best = Infinity;
  for (const t of world.tanks) {
    if (t.kind !== 'enemy' || !t.alive) continue;
    const d = Math.hypot(t.x - tank.x, t.z - tank.z);
    if (d < best) {
      best = d;
      target = { x: t.x, z: t.z, id: t.id };
    }
  }
  if (!target) return { move: 0, turn: 0, aim: tank.yaw, fire: false };

  const dx = target.x - tank.x;
  const dz = target.z - tank.z;
  const aimYaw = Math.atan2(dx, dz);
  const los = hasLineOfSight(world.map, tank.x, tank.z, target.x, target.z);

  state.repath -= SIM_DT;
  if (state.repath <= 0) {
    state.repath = 0.5;
    const from = toCell(tank.x, tank.z);
    const goal = toCell(target.x, target.z);
    state.path = findPath(world.map, from, goal, { allowBrick: true, adjacentGoal: true }) ?? [];
    state.index = 0;
  }

  // 追路径点
  let desired = aimYaw;
  if (state.path.length > 0 && state.index < state.path.length) {
    const wp = state.path[state.index];
    const wx = (wp.cx + 0.5) * TILE;
    const wz = (wp.cz + 0.5) * TILE;
    if (Math.hypot(wx - tank.x, wz - tank.z) < 0.8) state.index++;
    else desired = Math.atan2(wx - tank.x, wz - tank.z);
  }

  let turn = 0;
  let d = (desired - tank.yaw) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  if (d > 0.12) turn = 1;
  else if (d < -0.12) turn = -1;

  let move = los && best < 12 ? 0 : 1;
  let fire = los && best < 40;
  let finalAim = aimYaw;

  // 卡住：朝车头开炮把砖墙打掉，再重新寻路
  const progressed = Math.hypot(tank.x - state.lastX, tank.z - state.lastZ);
  state.lastX = tank.x;
  state.lastZ = tank.z;
  if (progressed < 0.03) state.stuck += SIM_DT;
  else state.stuck = Math.max(0, state.stuck - SIM_DT * 2);
  if (state.stuck > 0.8) {
    finalAim = tank.yaw;
    fire = true;
    state.repath = 0;
    if (state.stuck > 2.4) {
      turn = 1;
      state.stuck = 1.0;
    }
  }

  return { move, turn, aim: finalAim, fire };
}

function newBotState(): BotState {
  return { path: [], index: 0, repath: 0, lastX: 0, lastZ: 0, stuck: 0 };
}

/** 让玩家与基地在测试里无敌，专注验证关卡与流程（真实难度由玩家把握）。 */
function godMode(world: World): void {
  const tank = playerTank(world, world.playerOrder[0]);
  if (tank) tank.invulnUntil = world.time + 10;
  world.base.hp = world.base.maxHp;
  world.base.alive = true;
}

describe('战役连通性（每张地图都能打起来）', () => {
  it('10 关全部能在自动驾驶下产生击杀，且不崩、不产生非法状态', () => {
    const report: string[] = [];
    for (const def of LEVELS) {
      const world = createWorld({
        levelDef: def,
        level: def.id,
        difficulty: 'classic',
        mode: 'solo',
        playerIds: ['p1'],
        seed: 1000 + def.id,
      });
      const bot = newBotState();
      const maxSteps = Math.round(120 / SIM_DT); // 每关最多跑 120 秒仿真时间
      let steps = 0;
      while (world.phase === 'playing' && steps < maxSteps) {
        godMode(world);
        stepWorld(world, { p1: botInput(world, 'p1', bot) }, SIM_DT);
        steps++;
        if (world.tanks.some((t) => !Number.isFinite(t.x) || !Number.isFinite(t.z))) {
          throw new Error(`第 ${def.id} 关出现 NaN 坐标`);
        }
        for (const b of world.bullets) {
          if (!Number.isFinite(b.x) || !Number.isFinite(b.z)) throw new Error(`第 ${def.id} 关子弹坐标 NaN`);
          if (b.x < -5 || b.x > WORLD_W + 5 || b.z < -5 || b.z > WORLD_H + 5) {
            throw new Error(`第 ${def.id} 关子弹飞出世界: ${b.x},${b.z}`);
          }
        }
      }
      const score = world.players.p1.score;
      report.push(
        `第 ${def.id} 关 ${def.name}: ${steps} 步, phase=${world.phase}, 击杀=${world.enemiesKilled}, 分数=${score}`,
      );
      expect(Number.isFinite(score)).toBe(true);
      expect(world.enemiesKilled, `第 ${def.id} 关应该至少击杀一个敌人`).toBeGreaterThan(0);
      expect(world.tanks.length).toBeLessThan(12);
      // 地图不能被 AI 打穿成非法值
      for (let i = 0; i < world.map.tiles.length; i++) {
        expect(world.map.tiles[i]).toBeLessThanOrEqual(4);
      }
    }
    console.log(report.join('\n'));
  }, 120000);
});

describe('关卡推进链', () => {
  it('从第 1 关连推到第 10 关，分数/命数保留且关卡数据正确', () => {
    let world = createWorld({
      levelDef: getLevel(1),
      level: 1,
      difficulty: 'classic',
      mode: 'solo',
      playerIds: ['p1'],
      seed: 42,
    });
    world.players.p1.score = 500;
    for (let level = 1; level < 10; level++) {
      world = nextLevelWorld(world, getLevel(level + 1), level + 1);
      expect(world.level).toBe(level + 1);
      expect(world.players.p1.score).toBe(500);
      expect(world.players.p1.lives).toBe(3);
      expect(world.enemyQueue).toHaveLength(20);
      expect(world.phase).toBe('playing');
      expect(world.tanks.filter((t) => t.kind === 'player')).toHaveLength(1);
    }
  });

  it('敌人清空后 phase 变为 levelClear 并停止推进', () => {
    const world = createWorld({
      levelDef: getLevel(1),
      level: 1,
      difficulty: 'classic',
      mode: 'solo',
      playerIds: ['p1'],
      seed: 7,
    });
    world.enemyQueue = [];
    world.tanks = world.tanks.filter((t) => t.kind === 'player');
    stepWorld(world, { p1: { move: 0, turn: 0, aim: null, fire: false } }, SIM_DT);
    expect(world.phase).toBe('levelClear');
    const tank = playerTank(world, 'p1')!;
    const before = { x: tank.x, z: tank.z };
    stepWorld(world, { p1: { move: 1, turn: 0, aim: null, fire: false } }, SIM_DT);
    expect(tank.x).toBe(before.x);
    expect(tank.z).toBe(before.z);
  });
});

describe('难度档位差异', () => {
  it('休闲档敌人更少、基地更厚、命更多', () => {
    const classic = createWorld({
      levelDef: getLevel(1),
      level: 1,
      difficulty: 'classic',
      mode: 'solo',
      playerIds: ['p1'],
      seed: 1,
    });
    const casual = createWorld({
      levelDef: getLevel(1),
      level: 1,
      difficulty: 'casual',
      mode: 'solo',
      playerIds: ['p1'],
      seed: 1,
    });
    expect(classic.enemyQueue.length).toBe(20);
    expect(casual.enemyQueue.length).toBe(14);
    expect(classic.base.hp).toBe(1);
    expect(casual.base.hp).toBe(3);
    expect(classic.players.p1.lives).toBe(3);
    expect(casual.players.p1.lives).toBe(5);
  });

  it('装甲坦克在后半程出现比例更高（每关都成立）', () => {
    for (const def of LEVELS) {
      const world = createWorld({
        levelDef: def,
        level: def.id,
        difficulty: 'classic',
        mode: 'solo',
        playerIds: ['p1'],
        seed: 5,
      });
      const armorEarly = world.enemyQueue.slice(0, 10).filter((k: EnemyKind) => k === 'armor').length;
      const armorLate = world.enemyQueue.slice(10).filter((k: EnemyKind) => k === 'armor').length;
      expect(armorLate, `第 ${def.id} 关装甲分布`).toBeGreaterThanOrEqual(armorEarly);
    }
  });
});

describe('边界与健壮性', () => {
  it('地图边界外的格子按钢墙处理（子弹与坦克都进不去）', () => {
    const world = createWorld({
      levelDef: getLevel(1),
      level: 1,
      difficulty: 'classic',
      mode: 'solo',
      playerIds: ['p1'],
      seed: 3,
    });
    expect(tileAt(world.map, -1, 0)).toBe(2);
    expect(tileAt(world.map, 26, 0)).toBe(2);
    setTile(world.map, 0, 0, 1);
    expect(tileAt(world.map, 0, 0)).toBe(1);
  });

  it('长时间对局后实体数量保持有界（无泄漏）', () => {
    const world = createWorld({
      levelDef: getLevel(4),
      level: 4,
      difficulty: 'classic',
      mode: 'solo',
      playerIds: ['p1'],
      seed: 11,
    });
    const bot = newBotState();
    for (let i = 0; i < 7200; i++) {
      godMode(world);
      stepWorld(world, { p1: botInput(world, 'p1', bot) }, SIM_DT);
    }
    expect(world.bullets.length).toBeLessThan(60);
    expect(world.tanks.length).toBeLessThan(12);
    expect(world.powerups.length).toBeLessThan(8);
  }, 60000);
});
