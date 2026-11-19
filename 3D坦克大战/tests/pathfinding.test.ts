import { describe, expect, it } from 'vitest';
import { GRID_H, GRID_W, TILE_BRICK, TILE_FOREST, TILE_STEEL, TILE_WATER } from '../src/sim/constants';
import { setTile } from '../src/sim/map';
import { findPath, hasLineOfSight } from '../src/sim/pathfinding';
import { makeWorld } from './helpers';

describe('A* 寻路', () => {
  it('空地图上能找到直线路径', () => {
    const w = makeWorld();
    const path = findPath(w.map, { cx: 2, cz: 20 }, { cx: 12, cz: 2 });
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(10);
    const goal = path![path!.length - 1];
    expect(goal).toEqual({ cx: 12, cz: 2 });
  });

  it('钢墙全封时不可达', () => {
    const w = makeWorld();
    for (let cx = 0; cx < GRID_W; cx++) setTile(w.map, cx, 12, TILE_STEEL);
    const path = findPath(w.map, { cx: 5, cz: 20 }, { cx: 5, cz: 2 });
    expect(path).toBeNull();
  });

  it('钢墙留一个缺口时能找到绕行路径且不穿过钢墙', () => {
    const w = makeWorld();
    for (let cx = 0; cx < GRID_W; cx++) setTile(w.map, cx, 12, TILE_STEEL);
    setTile(w.map, 20, 12, 0);
    const path = findPath(w.map, { cx: 5, cz: 20 }, { cx: 5, cz: 2 });
    expect(path).not.toBeNull();
    expect(path!.some((c) => c.cx === 20 && c.cz === 12)).toBe(true);
    for (const cell of path!) {
      const idx = cell.cz * GRID_W + cell.cx;
      expect(w.map.tiles[idx]).not.toBe(TILE_STEEL);
    }
  });

  it('允许穿砖时路径会经过砖墙（AI 打墙开路的前提）', () => {
    const w = makeWorld();
    for (let cx = 0; cx < GRID_W; cx++) setTile(w.map, cx, 12, TILE_BRICK);
    const path = findPath(w.map, { cx: 5, cz: 20 }, { cx: 5, cz: 2 }, { allowBrick: true });
    expect(path).not.toBeNull();
    expect(path!.some((c) => c.cz === 12)).toBe(true);
  });

  it('禁止穿砖时同样场景不可达', () => {
    const w = makeWorld();
    for (let cx = 0; cx < GRID_W; cx++) setTile(w.map, cx, 12, TILE_BRICK);
    const path = findPath(w.map, { cx: 5, cz: 20 }, { cx: 5, cz: 2 }, { allowBrick: false });
    expect(path).toBeNull();
  });

  it('目标格被占用时 adjacentGoal 会退到相邻格', () => {
    const w = makeWorld();
    setTile(w.map, 10, 10, TILE_STEEL);
    const path = findPath(w.map, { cx: 10, cz: 20 }, { cx: 10, cz: 10 }, { adjacentGoal: true });
    expect(path).not.toBeNull();
    const last = path![path!.length - 1];
    expect(Math.abs(last.cx - 10) + Math.abs(last.cz - 10)).toBe(1);
  });
});

describe('视线判定', () => {
  it('空地可见', () => {
    const w = makeWorld();
    expect(hasLineOfSight(w.map, 4, 4, 40, 40)).toBe(true);
  });

  it('砖墙/钢墙/树林挡视线，水不挡', () => {
    // 格子 (6,10) 覆盖 x∈[12,14]、z∈[20,22]；视线沿 x=13 从 z=40 射到 z=2 必然穿过它。
    const w = makeWorld();
    setTile(w.map, 6, 10, TILE_BRICK);
    expect(hasLineOfSight(w.map, 13, 40, 13, 2)).toBe(false);

    const w2 = makeWorld();
    setTile(w2.map, 6, 10, TILE_STEEL);
    expect(hasLineOfSight(w2.map, 13, 40, 13, 2)).toBe(false);

    const w3 = makeWorld();
    setTile(w3.map, 6, 10, TILE_FOREST);
    expect(hasLineOfSight(w3.map, 13, 40, 13, 2)).toBe(false);

    const w4 = makeWorld();
    setTile(w4.map, 6, 10, TILE_WATER);
    expect(hasLineOfSight(w4.map, 13, 40, 13, 2)).toBe(true);
  });

  it('视线沿对角线穿过空图', () => {
    const w = makeWorld();
    expect(hasLineOfSight(w.map, 2, 2, 48, 48)).toBe(true);
    expect(GRID_H).toBe(26);
  });
});
