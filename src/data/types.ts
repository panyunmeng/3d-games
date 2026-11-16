import type { Vec2 } from '../core/math';

export type TowerId = 'gatling' | 'mortar' | 'tesla' | 'laser';

export type EnemyId =
  | 'grunt'
  | 'sprinter'
  | 'tank'
  | 'flyer'
  | 'shield'
  | 'splitter'
  | 'gruntlet'
  | 'boss';

export type DifficultyId = 'easy' | 'normal' | 'hard';

export type GameMode = 'campaign' | 'endless';

export interface TowerLevelStats {
  damage: number;
  /** 每秒射击次数 */
  rate: number;
  /** 射程（世界单位 = 米） */
  range: number;
  /** 溅射半径 */
  aoe: number;
  /** 连锁目标数（含首个目标） */
  chain: number;
  /** 每跳伤害衰减系数 */
  chainFalloff: number;
  /** 减速比例 0～0.9 */
  slow: number;
  /** 减速持续时间（秒） */
  slowDuration: number;
  /** 无视护甲 */
  pierceArmor: boolean;
}

export type ProjectileStyle = 'tracer' | 'shell' | 'arc' | 'beam';

export interface TowerDef {
  id: TowerId;
  name: string;
  english: string;
  role: string;
  desc: string;
  hotkey: string;
  cost: number;
  /** 升到 2 级、3 级各需的金币 */
  upgradeCost: [number, number];
  hitsAir: boolean;
  hitsGround: boolean;
  projectile: ProjectileStyle;
  /** 主题色（十六进制） */
  color: number;
  accent: number;
  levels: [TowerLevelStats, TowerLevelStats, TowerLevelStats];
}

export interface EnemyDef {
  id: EnemyId;
  name: string;
  english: string;
  hp: number;
  /** 米/秒 */
  speed: number;
  /** 0～0.9，减伤比例 */
  armor: number;
  reward: number;
  flying: boolean;
  /** 用于命中判定与血条定位 */
  radius: number;
  shield?: number;
  shieldRegen?: number;
  /** 脱战多少秒后开始回盾 */
  shieldDelay?: number;
  splitInto?: { type: EnemyId; count: number };
  color: number;
  accent: number;
  /** 模型整体缩放 */
  scale: number;
  boss?: boolean;
}

export interface PadDef {
  x: number;
  z: number;
}

export interface WaveGroup {
  type: EnemyId;
  count: number;
  /** 同组内出怪间隔（秒） */
  interval: number;
  /** 该组相对于波次开始的延迟（秒） */
  delay: number;
}

export interface WaveDef {
  groups: WaveGroup[];
  /** 清波奖励（另有基础奖励） */
  bonus: number;
  boss: boolean;
}

export interface LevelTheme {
  ground: number;
  groundEdge: number;
  path: number;
  accent: number;
  fog: number;
  sky: number;
}

export interface LevelDef {
  id: string;
  index: number;
  name: string;
  english: string;
  subtitle: string;
  waypoints: Vec2[];
  pads: PadDef[];
  waves: WaveDef[];
  theme: LevelTheme;
  /** 该关卡的敌人强度系数 */
  power: number;
}

export interface DifficultyDef {
  id: DifficultyId;
  name: string;
  english: string;
  desc: string;
  hpMul: number;
  speedMul: number;
  rewardMul: number;
  startGold: number;
  lives: number;
  /** 星级判定用的漏怪容差比例（相对初始生命） */
  star2LeakRatio: number;
}
