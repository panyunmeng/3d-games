import { describe, expect, it } from 'vitest';
import {
  TILE_BRICK,
  TILE_STEEL,
  TILE_WATER,
  TILE,
} from '../src/sim/constants';
import { angleDelta, circleHitsTiles, hitsBase, moveTank, turnToward } from '../src/sim/collision';
import { setTile } from '../src/sim/map';
import { makeWorld } from './helpers';

describe('地形碰撞', () => {
  it('砖/钢/水挡坦克，空地与树林不挡', () => {
    const w = makeWorld();
    setTile(w.map, 5, 5, TILE_BRICK);
    setTile(w.map, 7, 5, TILE_STEEL);
    setTile(w.map, 9, 5, TILE_WATER);
    const c = (cx: number, cz: number) => ({ x: (cx + 0.5) * TILE, z: (cz + 0.5) * TILE });

    expect(circleHitsTiles(w.map, c(5, 5).x, c(5, 5).z, 1.05)).toBe(true);
    expect(circleHitsTiles(w.map, c(7, 5).x, c(7, 5).z, 1.05)).toBe(true);
    expect(circleHitsTiles(w.map, c(9, 5).x, c(9, 5).z, 1.05)).toBe(true);
    expect(circleHitsTiles(w.map, c(11, 5).x, c(11, 5).z, 1.05)).toBe(false);
  });

  it('越界视为阻挡', () => {
    const w = makeWorld();
    expect(circleHitsTiles(w.map, -0.2, 10, 1.05)).toBe(true);
    expect(circleHitsTiles(w.map, 10, 52.2, 1.05)).toBe(true);
  });

  it('坦克撞墙不穿墙，贴墙时可沿墙滑动', () => {
    const w = makeWorld();
    const tank = w.tanks[0];
    tank.x = 19;
    tank.z = 20;
    setTile(w.map, 9, 8, TILE_BRICK); // 上方一格砖墙
    // 直接朝 -z 撞墙
    const beforeZ = tank.z;
    moveTank(w, tank, 0, -6);
    expect(tank.z).toBeGreaterThanOrEqual(beforeZ - TILE);
    // 斜向：z 被挡但 x 仍然可以走
    const beforeX = tank.x;
    moveTank(w, tank, 2, -1);
    expect(tank.x).toBeGreaterThan(beforeX);
  });

  it('基地是实体，坦克不能开进去', () => {
    const w = makeWorld();
    const tank = w.tanks[0];
    expect(hitsBase(26, 50, 1.05)).toBe(true);
    tank.x = 26;
    tank.z = 45;
    moveTank(w, tank, 0, 5);
    expect(tank.z).toBeLessThan(48.2); // 被基地挡住
  });

  it('坦克之间不能重叠', () => {
    const w = makeWorld({ playerIds: ['p1', 'p2'], mode: 'coop' });
    const [a, b] = w.tanks;
    a.x = 19;
    a.z = 20;
    b.x = 19;
    b.z = 24;
    const before = b.z;
    moveTank(w, b, 0, -3);
    expect(Math.abs(b.z - a.z)).toBeGreaterThan(2);
    expect(b.z).not.toBeCloseTo(before - 3, 1);
  });
});

describe('角度工具', () => {
  it('angleDelta 归一化到 (-π, π]', () => {
    expect(angleDelta(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(angleDelta(Math.PI / 2, 0)).toBeCloseTo(-Math.PI / 2);
    expect(angleDelta(3.0, -3.0)).toBeCloseTo(Math.PI * 2 - 6.0);
  });

  it('turnToward 受到最大角速度限制', () => {
    expect(turnToward(0, 1, 0.25)).toBeCloseTo(0.25);
    expect(turnToward(0, 0.1, 0.25)).toBeCloseTo(0.1);
    expect(turnToward(0, -1, 0.25)).toBeCloseTo(-0.25);
  });
});
