import type { LevelDef } from '../sim/map';
import level01 from './level01.json';
import level02 from './level02.json';
import level03 from './level03.json';
import level04 from './level04.json';
import level05 from './level05.json';
import level06 from './level06.json';
import level07 from './level07.json';
import level08 from './level08.json';
import level09 from './level09.json';
import level10 from './level10.json';

/** 10 关手工设计地图（由 scripts/gen-levels.py 生成并校验）。 */
export const LEVELS: LevelDef[] = [
  level01,
  level02,
  level03,
  level04,
  level05,
  level06,
  level07,
  level08,
  level09,
  level10,
] as LevelDef[];

export const LEVEL_COUNT = LEVELS.length;

/** 1-based 关卡序号；越界时夹到最后/第一关，保证流程不断。 */
export function getLevel(oneBasedIndex: number): LevelDef {
  const i = Math.max(1, Math.min(LEVEL_COUNT, oneBasedIndex));
  return LEVELS[i - 1];
}
