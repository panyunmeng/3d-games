import {
  BASE_CELLS,
  BLOCKS_BULLET,
  BLOCKS_TANK,
  ENEMY_SPAWN_CELLS,
  GRID_H,
  GRID_W,
  PLAYER_SPAWN_CELLS,
  TILE_BRICK,
  TILE_EMPTY,
  TILE_FOREST,
  TILE_STEEL,
  TILE_WATER,
  type EnemyKind,
  type TileType,
} from './constants';
import type { MapState } from './types';

export const idx = (cx: number, cz: number): number => cz * GRID_W + cx;

export const inBounds = (cx: number, cz: number): boolean =>
  cx >= 0 && cx < GRID_W && cz >= 0 && cz < GRID_H;

export function tileAt(map: MapState, cx: number, cz: number): TileType {
  if (!inBounds(cx, cz)) return TILE_STEEL;
  return map.tiles[idx(cx, cz)] as TileType;
}

export function setTile(map: MapState, cx: number, cz: number, t: TileType): void {
  if (!inBounds(cx, cz)) return;
  map.tiles[idx(cx, cz)] = t;
}

export const solidForTank = (map: MapState, cx: number, cz: number): boolean =>
  BLOCKS_TANK[tileAt(map, cx, cz)];

export const solidForBullet = (map: MapState, cx: number, cz: number): boolean =>
  BLOCKS_BULLET[tileAt(map, cx, cz)];

const CHAR_TO_TILE: Record<string, TileType> = {
  '.': TILE_EMPTY,
  '#': TILE_BRICK,
  S: TILE_STEEL,
  W: TILE_WATER,
  F: TILE_FOREST,
};

/** 关卡 JSON 的声明形状（levels/*.json 必须满足）。 */
export interface LevelDef {
  id: number;
  name: string;
  /** 26 行 × 26 字符：'.' 空 / '#' 砖 / 'S' 钢 / 'W' 水 / 'F' 林 */
  rows: string[];
  /** 敌人构成权重，按比例缩放到本关总数。 */
  mix: { normal: number; fast: number; armor: number };
}

export class LevelFormatError extends Error {}

/** 严格校验并转成 MapState；任何形状不符都抛 LevelFormatError（供测试与关卡策划兜底）。 */
export function parseLevel(def: LevelDef): MapState {
  if (!Array.isArray(def.rows) || def.rows.length !== GRID_H) {
    throw new LevelFormatError(`第 ${def.id} 关：rows 必须有 ${GRID_H} 行，实际 ${def.rows?.length}`);
  }
  const tiles = new Uint8Array(GRID_W * GRID_H);
  for (let cz = 0; cz < GRID_H; cz++) {
    const row = def.rows[cz];
    if (typeof row !== 'string' || row.length !== GRID_W) {
      throw new LevelFormatError(
        `第 ${def.id} 关第 ${cz} 行：必须 ${GRID_W} 个字符，实际 ${row?.length}`,
      );
    }
    for (let cx = 0; cx < GRID_W; cx++) {
      const ch = row[cx];
      const tile = CHAR_TO_TILE[ch];
      if (tile === undefined) {
        throw new LevelFormatError(`第 ${def.id} 关第 ${cz} 行第 ${cx} 列：非法字符 "${ch}"`);
      }
      tiles[idx(cx, cz)] = tile;
    }
  }
  const map: MapState = { tiles, original: new Uint8Array(tiles) };
  normalizeLevel(map);
  return map;
}

/** 清空出生区/基地区并按经典规则给基地围一圈砖墙。 */
function normalizeLevel(map: MapState): void {
  const clear = (cx: number, cz: number) => setTile(map, cx, cz, TILE_EMPTY);

  for (const cell of BASE_CELLS) clear(cell.cx, cell.cz);
  for (const s of PLAYER_SPAWN_CELLS) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) clear(s.cx + dx, s.cz + dz);
    }
  }
  for (const s of ENEMY_SPAWN_CELLS) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) clear(s.cx + dx, s.cz + dz);
    }
  }

  // 基地外圈一圈砖墙（左右各 1 列、上面 1 行）。
  const ring: Array<[number, number]> = [];
  for (let cx = BASE_CELLS[0].cx - 1; cx <= BASE_CELLS[1].cx + 1; cx++) ring.push([cx, BASE_CELLS[0].cz - 1]);
  for (let cz = BASE_CELLS[0].cz; cz <= BASE_CELLS[2].cz; cz++) {
    ring.push([BASE_CELLS[0].cx - 1, cz]);
    ring.push([BASE_CELLS[1].cx + 1, cz]);
  }
  for (const [cx, cz] of ring) {
    if (inBounds(cx, cz)) setTile(map, cx, cz, TILE_BRICK);
  }

  map.original.set(map.tiles);
}

/** 铲子道具：基地外圈砖墙临时变成钢墙。 */
export function setBaseWallSteel(map: MapState, steel: boolean): void {
  const ring: Array<[number, number]> = [];
  for (let cx = BASE_CELLS[0].cx - 1; cx <= BASE_CELLS[1].cx + 1; cx++) ring.push([cx, BASE_CELLS[0].cz - 1]);
  for (let cz = BASE_CELLS[0].cz; cz <= BASE_CELLS[2].cz; cz++) {
    ring.push([BASE_CELLS[0].cx - 1, cz]);
    ring.push([BASE_CELLS[1].cx + 1, cz]);
  }
  for (const [cx, cz] of ring) {
    if (!inBounds(cx, cz)) continue;
    const cur = tileAt(map, cx, cz);
    if (steel && (cur === TILE_BRICK || cur === TILE_EMPTY)) setTile(map, cx, cz, TILE_STEEL);
    else if (!steel && cur === TILE_STEEL) setTile(map, cx, cz, map.original[idx(cx, cz)] as TileType);
  }
}

/**
 * 按权重把本关敌人总数展开成刷新序列。
 * 显式排程而不是逐次加权抽签：先用等距位置把装甲坦克排在中后段（占 30%～100% 位置），
 * 再排快速坦克，剩下填普通坦克。这样「关卡越往后越硬」是数据保证，不依赖随机。
 */
export function buildEnemyQueue(total: number, mix: LevelDef['mix']): EnemyKind[] {
  if (total <= 0) return [];
  const weights: Record<EnemyKind, number> = {
    normal: Math.max(0, mix.normal),
    fast: Math.max(0, mix.fast),
    armor: Math.max(0, mix.armor),
  };
  const sum = weights.normal + weights.fast + weights.armor;
  if (sum <= 0) return Array.from({ length: total }, () => 'normal' as EnemyKind);

  const counts: Record<EnemyKind, number> = {
    normal: Math.round((total * weights.normal) / sum),
    fast: Math.round((total * weights.fast) / sum),
    armor: Math.round((total * weights.armor) / sum),
  };
  counts.normal += total - (counts.normal + counts.fast + counts.armor);

  const queue: EnemyKind[] = new Array(total).fill('normal');
  const used = new Uint8Array(total);

  const place = (kind: EnemyKind, count: number, startFrac: number): void => {
    if (count <= 0) return;
    for (let j = 0; j < count; j++) {
      const frac = startFrac + (1 - startFrac) * ((j + 0.5) / count);
      let idx = Math.min(total - 1, Math.max(0, Math.floor(frac * total)));
      while (idx < total && used[idx]) idx++;
      if (idx >= total) {
        idx = total - 1;
        while (idx >= 0 && used[idx]) idx--;
      }
      if (idx < 0) return;
      used[idx] = 1;
      queue[idx] = kind;
    }
  };

  place('armor', counts.armor, 0.3);
  place('fast', counts.fast, 0.1);
  for (let i = 0; i < total; i++) if (!used[i]) queue[i] = 'normal';
  return queue;
}

/** 按关卡布局还原地图（重开同一关时用）。 */
export function resetMap(map: MapState): void {
  map.tiles.set(map.original);
}
