import { describe, expect, it } from 'vitest';
import {
  DIFFICULTIES,
  GRID_W,
  PLAYER_SPAWN_CELLS,
  POWERUP_LIFETIME,
  TILE,
  TILE_BRICK,
  TILE_EMPTY,
  TILE_STEEL,
} from '../src/sim/constants';
import { setTile, tileAt } from '../src/sim/map';
import { createWorld, nextLevelWorld, stepWorld, totalEnemiesLeft } from '../src/sim/world';
import type { Bullet, PlayerInput } from '../src/sim/types';
import { getLevel } from '../src/levels';
import { makeEnemyTank, makeWorld, stepFor } from './helpers';

const idle: PlayerInput = { move: 0, turn: 0, aim: null, fire: false };

function enemyBulletAt(x: number, z: number, yaw: number): Bullet {
  return {
    id: 5000 + Math.floor(Math.random() * 1000),
    ownerTankId: 9999,
    team: 'enemy',
    x,
    z,
    yaw,
    speed: 30,
    power: 1,
    alive: true,
  };
}

describe('世界初始化', () => {
  it('单机开局：1 辆玩家坦克、3 条命、基地满血、敌人 20 个待刷', () => {
    const w = makeWorld();
    expect(w.phase).toBe('playing');
    expect(w.tanks.filter((t) => t.kind === 'player')).toHaveLength(1);
    expect(w.players.p1.lives).toBe(DIFFICULTIES.classic.playerLives);
    expect(w.base.hp).toBe(1);
    expect(w.enemyQueue).toHaveLength(20);
    expect(w.players.p1.score).toBe(0);
  });

  it('合作模式：两名玩家各占一个出生点', () => {
    const w = makeWorld({ playerIds: ['p1', 'p2'], mode: 'coop' });
    const tanks = w.tanks.filter((t) => t.kind === 'player');
    expect(tanks).toHaveLength(2);
    expect(tanks[0].x).toBeCloseTo((PLAYER_SPAWN_CELLS[0].cx + 0.5) * TILE);
    expect(tanks[1].x).toBeCloseTo((PLAYER_SPAWN_CELLS[1].cx + 0.5) * TILE);
    expect(w.players.p2.lives).toBe(3);
  });

  it('休闲档：5 条命、基地 3 血、敌人 14 个', () => {
    const w = makeWorld({ difficulty: 'casual' });
    expect(w.players.p1.lives).toBe(5);
    expect(w.base.hp).toBe(3);
    expect(w.enemyQueue).toHaveLength(14);
  });
});

describe('玩家操控', () => {
  it('前进沿车头方向移动（初始朝上，z 变小）', () => {
    const w = makeWorld();
    const tank = w.tanks[0];
    const z0 = tank.z;
    stepFor(w, { p1: { ...idle, move: 1 } }, 0.5);
    expect(tank.z).toBeLessThan(z0 - 1.5);
    expect(Math.abs(tank.x - 19)).toBeLessThan(0.2);
  });

  it('后退比前进慢', () => {
    const w1 = makeWorld();
    const z0 = w1.tanks[0].z;
    stepFor(w1, { p1: { ...idle, move: 1 } }, 1);
    const forward = z0 - w1.tanks[0].z;
    const w2 = makeWorld();
    stepFor(w2, { p1: { ...idle, move: -1 } }, 1);
    const backward = Math.abs(w2.tanks[0].z - z0);
    expect(forward).toBeGreaterThan(backward);
  });

  it('转向会改变车体朝向，炮塔独立跟踪 aim', () => {
    const w = makeWorld();
    const tank = w.tanks[0];
    const yaw0 = tank.yaw;
    stepFor(w, { p1: { ...idle, turn: 1, aim: 0 } }, 0.3);
    expect(tank.yaw).toBeGreaterThan(yaw0);
    expect(Math.abs(tank.turretYaw)).toBeLessThan(Math.abs(yaw0));
  });

  it('开火生成子弹，且同屏子弹数受火力等级限制', () => {
    const w = makeWorld();
    stepFor(w, { p1: { ...idle, fire: true } }, 0.2);
    expect(w.bullets.filter((b) => b.alive && b.playerId === 'p1')).toHaveLength(1);
    stepFor(w, { p1: { ...idle, fire: true } }, 0.5);
    expect(w.bullets.filter((b) => b.alive && b.playerId === 'p1').length).toBeLessThanOrEqual(1);
  });
});

describe('子弹与命中', () => {
  it('32 m/s 子弹不会穿透 2 m 砖墙（连续检测）', () => {
    const w = makeWorld();
    setTile(w.map, 9, 20, TILE_BRICK);
    stepFor(w, { p1: { ...idle, fire: true } }, 0.8);
    expect(tileAt(w.map, 9, 20)).toBe(TILE_EMPTY);
  });

  it('击毁敌人得分并计入统计', () => {
    const w = makeWorld();
    w.tanks.push(makeEnemyTank({ x: 19, z: 45 }));
    stepFor(w, { p1: { ...idle, fire: true } }, 0.5);
    expect(w.enemiesKilled).toBe(1);
    expect(w.players.p1.score).toBe(100);
  });

  it('装甲坦克需要多发才能击毁', () => {
    const w = makeWorld();
    w.tanks.push(makeEnemyTank({ x: 19, z: 45, enemyKind: 'armor', hp: 3, maxHp: 3 }));
    const enemy = w.tanks[w.tanks.length - 1];
    stepFor(w, { p1: { ...idle, fire: true } }, 0.15);
    expect(enemy.hp).toBe(2);
    expect(enemy.alive).toBe(true);
    expect(w.enemiesKilled).toBe(0);

    let elapsed = 0.15;
    while (elapsed < 6 && enemy.alive) {
      stepFor(w, { p1: { ...idle, fire: true } }, 0.1);
      elapsed += 0.1;
    }
    expect(enemy.alive).toBe(false);
    expect(w.enemiesKilled).toBe(1);
    expect(w.players.p1.score).toBe(400);
  });

  it('敌弹命中玩家：掉一条命并进入复活倒计时', () => {
    const w = makeWorld();
    const tank = w.tanks[0];
    tank.invulnUntil = 0;
    w.bullets.push(enemyBulletAt(19, 47, 0));
    stepFor(w, { p1: idle }, 0.3);
    expect(w.players.p1.lives).toBe(2);
    expect(tank.alive).toBe(false);

    stepFor(w, { p1: idle }, 2.2);
    expect(tank.alive).toBe(true);
    expect(tank.invulnUntil).toBeGreaterThan(w.time);
  });

  it('出生保护期内不掉血', () => {
    const w = makeWorld();
    const tank = w.tanks[0];
    expect(tank.invulnUntil).toBeGreaterThan(0);
    w.bullets.push(enemyBulletAt(19, 47, 0));
    stepFor(w, { p1: idle }, 0.3);
    expect(w.players.p1.lives).toBe(3);
  });
});

describe('基地与失败条件', () => {
  it('经典档：基地被击毁立即 game over', () => {
    const w = makeWorld();
    w.bullets.push(enemyBulletAt(26, 48.6, 0));
    stepFor(w, { p1: idle }, 0.4);
    expect(w.phase).toBe('gameOver');
    expect(w.base.alive).toBe(false);
  });

  it('休闲档：基地 3 血且可自动修复一次', () => {
    const w = makeWorld({ difficulty: 'casual' });
    const hitBase = () => {
      w.bullets.push(enemyBulletAt(26, 48.6, 0));
      stepFor(w, { p1: idle }, 0.4);
    };
    hitBase();
    hitBase();
    expect(w.base.hp).toBe(1);
    expect(w.phase).toBe('playing');
    hitBase(); // 第 3 发 → 0，触发修复
    expect(w.base.hp).toBe(3);
    expect(w.base.repairsLeft).toBe(0);
    hitBase();
    hitBase();
    hitBase();
    expect(w.phase).toBe('gameOver');
  });

  it('命耗尽 game over', () => {
    const w = makeWorld();
    const tank = w.tanks[0];
    tank.invulnUntil = 0;
    for (let i = 0; i < 3; i++) {
      w.players.p1.lives = 1;
      tank.invulnUntil = 0;
      w.bullets.push(enemyBulletAt(19, 47, 0));
      stepFor(w, { p1: idle }, 0.3);
    }
    expect(w.phase).toBe('gameOver');
  });

  it('敌人清空后进入过关结算', () => {
    const w = makeWorld();
    w.enemyQueue = [];
    w.tanks = w.tanks.filter((t) => t.kind === 'player');
    stepFor(w, { p1: idle }, 0.2);
    expect(w.phase).toBe('levelClear');
    expect(w.players.p1.score).toBeGreaterThanOrEqual(1000);
  });

  it('过关后进入下一关会保留分数与命数', () => {
    const w = makeWorld();
    w.players.p1.score = 2500;
    w.players.p1.lives = 2;
    const next = nextLevelWorld(w, getLevel(2), 2);
    expect(next.level).toBe(2);
    expect(next.players.p1.score).toBe(2500);
    expect(next.players.p1.lives).toBe(2);
    expect(next.enemyQueue).toHaveLength(20);
    expect(totalEnemiesLeft(next)).toBe(20);
  });
});

describe('道具', () => {
  it('星：火力等级 +1（上限 3）', () => {
    const w = makeWorld();
    w.powerups.push({ id: 1, kind: 'star', x: 19, z: 49, until: 999 });
    stepFor(w, { p1: idle }, 0.1);
    expect(w.tanks[0].power).toBe(2);
    w.powerups.push({ id: 2, kind: 'star', x: 19, z: 49, until: 999 });
    stepFor(w, { p1: idle }, 0.1);
    w.powerups.push({ id: 3, kind: 'star', x: 19, z: 49, until: 999 });
    stepFor(w, { p1: idle }, 0.1);
    expect(w.tanks[0].power).toBe(3);
  });

  it('手雷：清空全场敌人并计分', () => {
    const w = makeWorld();
    w.tanks.push(makeEnemyTank({ x: 10, z: 10 }));
    w.tanks.push(makeEnemyTank({ x: 40, z: 8, enemyKind: 'fast' }));
    w.powerups.push({ id: 1, kind: 'grenade', x: 19, z: 49, until: 999 });
    stepFor(w, { p1: idle }, 0.1);
    expect(w.enemiesKilled).toBe(2);
    expect(w.players.p1.score).toBe(100 + 200 + 500);
  });

  it('头盔：无敌期内免疫伤害', () => {
    const w = makeWorld();
    const tank = w.tanks[0];
    tank.invulnUntil = 0;
    w.powerups.push({ id: 1, kind: 'helmet', x: 19, z: 49, until: 999 });
    stepFor(w, { p1: idle }, 0.1);
    w.bullets.push(enemyBulletAt(19, 47, 0));
    stepFor(w, { p1: idle }, 0.3);
    expect(w.players.p1.lives).toBe(3);
  });

  it('铲子：基地外圈变钢墙，到期恢复', () => {
    const w = makeWorld();
    w.enemySpawnTimer = 1e9; // 保持 playing 但不刷新敌人，隔离测试
    expect(tileAt(w.map, 11, 23)).toBe(TILE_BRICK);
    w.powerups.push({ id: 1, kind: 'shovel', x: 19, z: 49, until: 999 });
    stepFor(w, { p1: idle }, 0.1);
    expect(tileAt(w.map, 11, 23)).toBe(TILE_STEEL);
    stepFor(w, { p1: idle }, 21);
    expect(tileAt(w.map, 11, 23)).toBe(TILE_BRICK);
  });

  it('道具到期自动消失', () => {
    const w = makeWorld();
    w.enemySpawnTimer = 1e9;
    w.powerups.push({ id: 1, kind: 'star', x: 40, z: 10, until: w.time + 1 });
    stepFor(w, { p1: idle }, 0.5);
    expect(w.powerups).toHaveLength(1);
    stepFor(w, { p1: idle }, 1.5);
    expect(w.powerups).toHaveLength(0);
    expect(POWERUP_LIFETIME).toBeGreaterThan(1);
  });
});

describe('敌人 AI', () => {
  it('会向玩家/基地方向推进', () => {
    const w = makeWorld();
    w.enemyQueue = [];
    w.enemySpawnTimer = 1e9;
    const enemy = makeEnemyTank({ x: 26, z: 4 });
    w.tanks.push(enemy);
    stepFor(w, { p1: idle }, 3);
    expect(enemy.z).toBeGreaterThan(6);
  });

  it('会自动开火', () => {
    const w = makeWorld();
    w.enemyQueue = [];
    const enemy = makeEnemyTank({ x: 19, z: 30 });
    enemy.fireCd = 0;
    w.tanks.push(enemy);
    let shots = 0;
    for (let i = 0; i < 240; i++) {
      stepWorld(w, { p1: idle }, 1 / 60);
      for (const ev of w.events) if (ev.type === 'shoot' && ev.team === 'enemy') shots++;
    }
    expect(shots).toBeGreaterThan(0);
  });

  it('同屏敌人不超过 4 个', () => {
    const w = makeWorld();
    stepFor(w, { p1: idle }, 12);
    expect(w.tanks.filter((t) => t.kind === 'enemy' && t.alive).length).toBeLessThanOrEqual(4);
  });
});

describe('确定性与稳定性', () => {
  it('相同 seed 与输入产生相同结果', () => {
    const a = createWorld({
      levelDef: getLevel(1),
      level: 1,
      difficulty: 'classic',
      mode: 'solo',
      playerIds: ['p1'],
      seed: 777,
    });
    const b = createWorld({
      levelDef: getLevel(1),
      level: 1,
      difficulty: 'classic',
      mode: 'solo',
      playerIds: ['p1'],
      seed: 777,
    });
    const inputs = { p1: { move: 1, turn: 0.3, aim: 0.2, fire: true } as PlayerInput };
    for (let i = 0; i < 300; i++) {
      stepWorld(a, inputs, 1 / 60);
      stepWorld(b, inputs, 1 / 60);
    }
    expect(a.tanks.length).toBe(b.tanks.length);
    expect(a.players.p1.score).toBe(b.players.p1.score);
    expect(a.enemiesKilled).toBe(b.enemiesKilled);
    for (let i = 0; i < Math.min(a.tanks.length, b.tanks.length); i++) {
      expect(a.tanks[i].x).toBeCloseTo(b.tanks[i].x, 6);
      expect(a.tanks[i].z).toBeCloseTo(b.tanks[i].z, 6);
    }
  });

  it('长时间空跑 60 秒不崩、实体数量有界', () => {
    const w = makeWorld();
    for (let i = 0; i < 3600; i++) stepWorld(w, { p1: idle }, 1 / 60);
    expect(w.bullets.length).toBeLessThan(50);
    expect(w.tanks.length).toBeLessThan(10);
    expect(GRID_W).toBe(26);
  });
});
