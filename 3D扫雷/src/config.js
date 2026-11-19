/**
 * 全局常量：难度档位、棋盘几何、配色。
 *
 * 这里只放纯数据，不 import three —— 逻辑层与单测都依赖它，必须能在 Node 里直接跑。
 */

/** 经典三档：初级 / 中级 / 高级，雷数与尺寸与原版扫雷逐雷对齐。 */
export const LEVELS = {
  easy: { key: 'easy', name: '初级', cols: 9, rows: 9, mines: 10, note: '9 × 9 · 10 雷' },
  medium: { key: 'medium', name: '中级', cols: 16, rows: 16, mines: 40, note: '16 × 16 · 40 雷' },
  hard: { key: 'hard', name: '高级', cols: 30, rows: 16, mines: 99, note: '30 × 16 · 99 雷' },
};

export const LEVEL_ORDER = ['easy', 'medium', 'hard'];

export const DEFAULT_LEVEL = 'easy';

/** 棋盘几何（世界单位）。一格 = 1 单位，块比格略小留出缝隙，缝隙里能看见底板岩层。 */
export const BOARD = {
  pitch: 1.06,
  block: 0.96,
  hiddenHeight: 0.66,
  slabHeight: 0.085,
  baseThickness: 0.7,
  baseMargin: 0.9,
};

/** 岩层与铜矿配色。 */
export const PALETTE = {
  bg: '#0b0907',
  fog: '#0b0907',
  ground: '#15110d',
  plinth: '#241c15',
  rock: '#3a3128',
  rockDark: '#2a231c',
  rockLight: '#4a3f33',
  slab: '#221b14',
  copper: '#c8863c',
  copperLight: '#e8b06a',
  copperDim: '#8a5a28',
  flag: '#c0442e',
  flagCloth: '#d4563a',
  mine: '#1c1a18',
  mineGlow: '#ff6a1a',
  wrong: '#c8322a',
  text: '#e9dcc8',
};

/** 一次操作允许的最大撤销次数与提示次数（超出后按钮置灰）。 */
export const UNDO_LIMIT = 3;
export const HINT_LIMIT = 3;

/** 最佳成绩存储键（按难度分档）。 */
export const BEST_KEY = 'mine-sweep-3d.best.v1';
