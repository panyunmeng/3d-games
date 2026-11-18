/**
 * 全部可调参数集中在这里。
 *
 * 为什么单独一层：玩法调参（速度、时长、分数）与规则代码混在一起时，
 * 每次试玩后的微调都要改逻辑文件，改完还得重读一遍碰撞代码。参数集中后，
 * 调手感只动这个文件，logic.js 保持“零魔数”，单测才敢断言具体数值。
 */

/** 棋盘：21×21 且为奇数，保证存在正中心格，蛇的出生点固定。 */
export const COLS = 21;
export const ROWS = 21;

/** 一个格子的世界边长（three.js 单位）。逻辑层始终用格坐标，只在这一层做坐标换算。 */
export const CELL = 1;

/** 逻辑步长下限/上限：下限防止高关卡快到帧间跳格，上限防止减速道具把节奏拖死。 */
export const TICK_MIN = 62;
export const TICK_MAX = 460;

/** 基础步长与每级衰减。168ms/格 ≈ 6 格/秒，是经典贪吃蛇的常见开场节奏。 */
export const LEVEL_TUNING = {
  baseTick: 168,
  tickStep: 8,
  baseTarget: 5,        // 第 1 关要吃的食物数
  targetStep: 2,        // 每关 +2
  baseTime: 30000,      // 第 1 关限时（ms）
  timeStep: 2500,       // 每关 +2.5s
  foodRefill: 1200,     // 每吃一个食物补回的时间（ms），避免关卡后期只靠罚站熬
  baseObstacles: 0,     // 第 1 关无静物
  obstaclesStep: 2,
  maxObstacles: 18,
  clearBonusPerSec: 3,  // 过关时按剩余秒数结算
};

/** 无尽模式：吃满 N 个食物提一档速度；吃到一定数量后开始长静物。 */
export const ENDLESS_TUNING = {
  baseTick: 168,
  tickStep: 6,
  foodsPerStep: 4,
  foodsPerObstacle: 4,
  obstacleAfter: 8,
  maxObstacles: 20,
  // 分数随进度缓慢上涨，避免“只比谁活得久”
  scoreStep: 2,
  scoreEvery: 10,
};

/** 道具：三种都是“拾取即生效 + 倒计时”。mul 是步长倍率（<1 变快）。 */
export const ITEM_TYPES = {
  speed: { mul: 0.62, dur: 6000, color: 0xffa64d, label: '加速' },
  slow: { mul: 1.45, dur: 6000, color: 0x6ac8ff, label: '减速' },
  time: { dur: 8000, bonus: 8000, color: 0xffd166, label: '限时' },
};

/** 道具出现节奏：每吃 2 个食物，若场上没有道具，则刷新一个。 */
export const ITEM_SPAWN_EVERY = 2;
/** 道具在场上停留上限，避免玩家绕远路专门去捡。 */
export const ITEM_TTL = 15000;

export const SCORE = {
  food: 10,
  foodPerLevel: 2,
  item: 5,
  timeBonusPerSec: 3,
};

export const WALL_LABEL = { classic: '撞墙即死', wrap: '穿墙' };
export const MODE_LABEL = { endless: '无尽模式', level: '关卡制' };

/** 移动端适配（2026-11-18）：所有触屏/断点/相机适配参数集中在此，逻辑层不受影响。 */
export const MOBILE = {
  /** 断点：视口宽度小于它时启用触屏控件与紧凑 HUD；桌面 1440 不受影响。 */
  breakpointPx: 720,
  /** 画布上沿保留给 HUD、下沿保留给方向键的最大比例（窄屏限制，避免棋盘被压太小）。 */
  boardTopReserve: 0.16,
  boardBottomReserve: 0.30,
  /** 竖屏相机适配距离上限：21×21 盘在 375 宽下需要的距离远超原 maxRadius=62。 */
  fitRadiusMax: 120,
  /** 竖屏初始俯角：更接近俯视，让 21×21 方形盘在窄屏上不被压成扁条。 */
  fitPhi: 0.5,
  /** 相机适配留白系数：乘在算出距离上，保证边角有余量。 */
  fitMargin: 1.12,
  /** 单个方向键按下后自动重复转向的间隔（ms）；按住可连续排队转向。 */
  repeatDelayMs: 260,
  repeatEveryMs: 150,
};
