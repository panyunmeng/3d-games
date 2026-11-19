/**
 * 全局尺寸与手感常数。单位：米 / 秒 / 弧度。
 *
 * 空间约定：
 *   x ∈ [0, WORLD_W)，z ∈ [0, WORLD_H)，格子 (cx,cz) 覆盖 [cx*TILE,(cx+1)*TILE)。
 *   yaw = 0 时朝向 +z；forward(v) = (sin yaw, cos yaw) * v。
 *   玩家在底部（z 大），敌人从顶部（z = 0）刷新，基地在底部中央。
 */

export const GRID_W = 26;
export const GRID_H = 26;
export const TILE = 2.0;
export const WORLD_W = GRID_W * TILE;
export const WORLD_H = GRID_H * TILE;

export const cellCenter = (cx: number, cz: number): { x: number; z: number } => ({
  x: (cx + 0.5) * TILE,
  z: (cz + 0.5) * TILE,
});

export const toCell = (x: number, z: number): { cx: number; cz: number } => ({
  cx: Math.floor(x / TILE),
  cz: Math.floor(z / TILE),
});

/* ── 地形 ─────────────────────────────────────────────────────────── */

export const TILE_EMPTY = 0;
export const TILE_BRICK = 1;
export const TILE_STEEL = 2;
export const TILE_WATER = 3;
export const TILE_FOREST = 4;
export type TileType = 0 | 1 | 2 | 3 | 4;

/** 坦克不能进入（水挡车、砖钢挡车），树林可进。 */
export const BLOCKS_TANK: readonly boolean[] = [false, true, true, true, false];
/** 子弹被阻挡（水、树林可穿）。 */
export const BLOCKS_BULLET: readonly boolean[] = [false, true, true, false, false];

/* ── 坦克 ─────────────────────────────────────────────────────────── */

export const TANK_HALF_LEN = 1.6;
export const TANK_HALF_WID = 1.05;
/** 与地形的碰撞圆半径：略小于车体半宽，避免擦墙即停。 */
export const TANK_RADIUS = 0.95;
/** 坦克之间的碰撞圆半径。 */
export const TANK_SHOVE_RADIUS = 1.2;

export const PLAYER_SPEED = 5.0;
export const PLAYER_REVERSE = 3.0;
export const BODY_TURN_SPEED = 2.79; // 160°/s
export const TURRET_TURN_SPEED = 3.84; // 220°/s

export const PLAYER_FIRE_CD = 0.35; // 基础冷却，等级越高略快
export const PLAYER_FIRE_CD_BY_POWER = [0.35, 0.30, 0.26];
/** 同屏允许的玩家子弹数（按火力等级）。 */
export const PLAYER_MAX_BULLETS = [1, 2, 2];

export const SPAWN_INVULN = 3.0; // 出生保护
export const RESPAWN_DELAY = 2.0;
export const SPAWN_CLEAR_RADIUS = 1.6; // 重生前清空该范围内的敌弹

/* ── 子弹 ─────────────────────────────────────────────────────────── */

export const BULLET_RADIUS = 0.18;
/** 连续检测的采样步长：必须远小于最薄障碍（0.5 m），30 m/s 也不会穿透。 */
export const BULLET_SUBSTEP = 0.12;
export const PLAYER_BULLET_SPEED = 32;
/** 玩家火力等级 3 的子弹可击穿钢墙。 */
export const STEEL_BREAK_POWER = 3;

/* ── 地图固定区域 ─────────────────────────────────────────────────── */

/** 基地占 2×2 格，位于底部中央。 */
export const BASE_CELL = { cx: 12, cz: 24 };
export const BASE_CELLS: ReadonlyArray<{ cx: number; cz: number }> = [
  { cx: 12, cz: 24 },
  { cx: 13, cz: 24 },
  { cx: 12, cz: 25 },
  { cx: 13, cz: 25 },
];
export const BASE_HALF = 2.0; // 基地碰撞/伤害判定半宽
/** 2×2 格基地区的世界坐标中心：x ∈ [24,28]，z ∈ [48,52]。 */
export const BASE_CENTER = { x: 26.0, z: 50.0 };

/** 玩家出生点（格子）。 */
export const PLAYER_SPAWN_CELLS: ReadonlyArray<{ cx: number; cz: number }> = [
  { cx: 9, cz: 24 },
  { cx: 16, cz: 24 },
];
/** 敌人刷新点（顶部三处）。 */
export const ENEMY_SPAWN_CELLS: ReadonlyArray<{ cx: number; cz: number }> = [
  { cx: 0, cz: 1 },
  { cx: 12, cz: 1 },
  { cx: 25, cz: 1 },
];

/* ── 波次与节奏 ───────────────────────────────────────────────────── */

export const MAX_ALIVE_ENEMIES = 4;
export const ENEMY_SPAWN_INTERVAL = 2.6;
/** 第 N 个被击毁的敌人会掉道具（经典行为：闪烁的敌人掉道具）。 */
export const POWERUP_DROP_EVERY = 4;
export const POWERUP_LIFETIME = 12.0;
export const HELMET_DURATION = 10.0;
export const SHOVEL_DURATION = 20.0;

export const MAX_POWER_LEVEL = 3;

/* ── 难度 ─────────────────────────────────────────────────────────── */

export type DifficultyId = 'classic' | 'casual';

export interface DifficultyConfig {
  /** 每关敌人总数。 */
  enemiesPerLevel: number;
  /** 基地血量（classic = 1 即一击毁）。 */
  baseHp: number;
  /** 基地被毁后自动修复次数（回满血）。 */
  baseRepairs: number;
  /** 每名玩家初始命数。 */
  playerLives: number;
  /** 敌人开火间隔倍率（越大越慢）。 */
  enemyFireCdMul: number;
  /** 敌人瞄准误差（弧度，0 = 必中）。 */
  enemyAimError: number;
  /** 敌人反应时间（秒，越大越迟钝）。 */
  enemyReaction: number;
}

export const DIFFICULTIES: Record<DifficultyId, DifficultyConfig> = {
  classic: {
    enemiesPerLevel: 20,
    baseHp: 1,
    baseRepairs: 0,
    playerLives: 3,
    enemyFireCdMul: 1.0,
    enemyAimError: 0.1,
    enemyReaction: 0.5,
  },
  casual: {
    enemiesPerLevel: 14,
    baseHp: 3,
    baseRepairs: 1,
    playerLives: 5,
    enemyFireCdMul: 1.35,
    enemyAimError: 0.22,
    enemyReaction: 0.85,
  },
};

/* ── 敌人类型 ─────────────────────────────────────────────────────── */

export type EnemyKind = 'normal' | 'fast' | 'armor';

export interface EnemyKindConfig {
  label: string;
  hp: number;
  speed: number;
  bulletSpeed: number;
  fireCooldown: number;
  score: number;
  color: number;
}

export const ENEMY_KINDS: Record<EnemyKind, EnemyKindConfig> = {
  normal: {
    label: '普通',
    hp: 1,
    speed: 2.5,
    bulletSpeed: 30,
    fireCooldown: 1.35,
    score: 100,
    color: 0xb8563f,
  },
  fast: {
    label: '快速',
    hp: 1,
    speed: 4.6,
    bulletSpeed: 30,
    fireCooldown: 1.6,
    score: 200,
    color: 0xd9a13c,
  },
  armor: {
    label: '装甲',
    hp: 3,
    speed: 2.0,
    bulletSpeed: 36,
    fireCooldown: 1.15,
    score: 400,
    color: 0x7f6fb0,
  },
};

/* ── 道具 ─────────────────────────────────────────────────────────── */

export type PowerupKind = 'star' | 'grenade' | 'helmet' | 'shovel';
export const POWERUP_KINDS: readonly PowerupKind[] = ['star', 'grenade', 'helmet', 'shovel'];
export const POWERUP_PICK_SCORE = 500;

/* ── 计分 ─────────────────────────────────────────────────────────── */

export const SCORE_LEVEL_CLEAR = 1000;
export const SCORE_SHOT_FIRED = 0;

/* ── 网络 ─────────────────────────────────────────────────────────── */

/** 服务器固定仿真步长（60 Hz）。 */
export const SIM_DT = 1 / 60;
/** 快照发送频率（20 Hz）。 */
export const SNAPSHOT_HZ = 20;
export const MAX_PLAYERS = 2;
