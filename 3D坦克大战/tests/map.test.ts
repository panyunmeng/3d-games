import { describe, expect, it } from 'vitest';
import {
  BASE_CELLS,
  DIFFICULTIES,
  ENEMY_SPAWN_CELLS,
  GRID_H,
  GRID_W,
  PLAYER_SPAWN_CELLS,
  TILE_BRICK,
  TILE_EMPTY,
  TILE_FOREST,
  TILE_STEEL,
  TILE_WATER,
} from '../src/sim/constants';
import { LEVELS } from '../src/levels';
import { buildEnemyQueue, LevelFormatError, parseLevel, tileAt } from '../src/sim/map';
import { blankRows, makeLevel } from './helpers';

describe('关卡数据', () => {
  it('10 关全部能通过严格解析', () => {
    expect(LEVELS).toHaveLength(10);
    for (const def of LEVELS) {
      const map = parseLevel(def);
      expect(map.tiles.length).toBe(GRID_W * GRID_H);
      expect(def.rows).toHaveLength(GRID_H);
      for (const row of def.rows) expect(row).toHaveLength(GRID_W);
    }
  });

  it('每关地图都有内容（不是空图）', () => {
    for (const def of LEVELS) {
      const map = parseLevel(def);
      let solid = 0;
      for (let i = 0; i < map.tiles.length; i++) if (map.tiles[i] !== TILE_EMPTY) solid++;
      expect(solid, `第 ${def.id} 关障碍物数量`).toBeGreaterThan(20);
    }
  });

  it('基地 4 格必须为空，基地外圈有砖墙', () => {
    for (const def of LEVELS) {
      const map = parseLevel(def);
      for (const cell of BASE_CELLS) {
        expect(tileAt(map, cell.cx, cell.cz), `第 ${def.id} 关基地格`).toBe(TILE_EMPTY);
      }
      expect(tileAt(map, 11, 23), `第 ${def.id} 关基地左上角砖墙`).toBe(TILE_BRICK);
    }
  });

  it('出生点区域为空', () => {
    for (const def of LEVELS) {
      const map = parseLevel(def);
      for (const cell of [...PLAYER_SPAWN_CELLS, ...ENEMY_SPAWN_CELLS]) {
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            const cx = cell.cx + dx;
            const cz = cell.cz + dz;
            if (cx < 0 || cx >= GRID_W || cz < 0 || cz >= GRID_H) continue;
            const t = tileAt(map, cx, cz);
            expect(t, `第 ${def.id} 关出生点 (${cx},${cz})`).toBe(TILE_EMPTY);
          }
        }
      }
    }
  });

  it('非法字符/行数/列数会抛 LevelFormatError', () => {
    const bad = makeLevel();
    bad.rows = bad.rows.slice(0, 20);
    expect(() => parseLevel(bad)).toThrow(LevelFormatError);

    const bad2 = makeLevel();
    const rows = blankRows();
    rows[5] = 'X'.repeat(GRID_W);
    bad2.rows = rows;
    expect(() => parseLevel(bad2)).toThrow(LevelFormatError);

    const bad3 = makeLevel();
    const rows3 = blankRows();
    rows3[5] = '.'.repeat(GRID_W - 1);
    bad3.rows = rows3;
    expect(() => parseLevel(bad3)).toThrow(LevelFormatError);
  });

  it('四种地形字符映射正确', () => {
    const rows = blankRows();
    rows[3] = '#' + 'S' + 'W' + 'F' + '.'.repeat(GRID_W - 4);
    const map = parseLevel(makeLevel({ rows }));
    expect(tileAt(map, 0, 3)).toBe(TILE_BRICK);
    expect(tileAt(map, 1, 3)).toBe(TILE_STEEL);
    expect(tileAt(map, 2, 3)).toBe(TILE_WATER);
    expect(tileAt(map, 3, 3)).toBe(TILE_FOREST);
  });
});

describe('敌人刷新序列', () => {
  it('经典档每关 20 个、休闲档 14 个', () => {
    for (const def of LEVELS) {
      expect(buildEnemyQueue(DIFFICULTIES.classic.enemiesPerLevel, def.mix)).toHaveLength(20);
      expect(buildEnemyQueue(DIFFICULTIES.casual.enemiesPerLevel, def.mix)).toHaveLength(14);
    }
  });

  it('装甲坦克在关卡后期占比更高', () => {
    const queue = buildEnemyQueue(20, { normal: 3, fast: 2, armor: 5 });
    const firstHalf = queue.slice(0, 10).filter((k) => k === 'armor').length;
    const secondHalf = queue.slice(10).filter((k) => k === 'armor').length;
    expect(secondHalf).toBeGreaterThan(firstHalf);
  });

  it('权重为 0 时不产生该类型', () => {
    const queue = buildEnemyQueue(10, { normal: 1, fast: 0, armor: 0 });
    expect(queue.every((k) => k === 'normal')).toBe(true);
  });
});
