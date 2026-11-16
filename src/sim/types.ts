import type {
  DifficultyId,
  EnemyKind,
  PowerupKind,
  TileType,
} from './constants';

export interface Vec2 {
  x: number;
  z: number;
}

export interface Cell {
  cx: number;
  cz: number;
}

/** 玩家一步的输入意图。服务器与本地单机共用同一结构。 */
export interface PlayerInput {
  /** 前进 +1 / 后退 -1 / 不动 0（任意 -1..1 之间的值会被夹取）。 */
  move: number;
  /** 车体转向：+1 逆时针 / -1 顺时针 / 0 不转。 */
  turn: number;
  /** 炮塔目标世界朝向（弧度）；null = 保持当前朝向。 */
  aim: number | null;
  /** 是否持续开火（受冷却与同屏弹数限制）。 */
  fire: boolean;
}

export interface AIState {
  state: 'advance' | 'engage';
  repathTimer: number;
  path: Cell[];
  pathIndex: number;
  targetTankId: number | null;
  /** 瞄准稳定计时：连续对准目标累计到反应时间才开火。 */
  aimTimer: number;
  /** 卡住计时：长时间无位移说明被墙挡住，改为朝前开炮。 */
  stuckTimer: number;
  lastX: number;
  lastZ: number;
}

export interface Tank {
  id: number;
  kind: 'player' | 'enemy';
  /** 玩家坦克的归属玩家 id。 */
  playerId?: string;
  /** 敌人类型（仅敌人）。 */
  enemyKind?: EnemyKind;
  name: string;
  x: number;
  z: number;
  /** 车体朝向（弧度）。 */
  yaw: number;
  /** 炮塔朝向（弧度），独立于车体。 */
  turretYaw: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  /** 玩家复活时刻（world.time 基准）；<= 0 表示无待复活。 */
  respawnAt: number;
  /** 无敌截止时刻。 */
  invulnUntil: number;
  /** 开火冷却剩余秒数。 */
  fireCd: number;
  /** 玩家火力等级 1..3；敌人为 1。 */
  power: number;
  speed: number;
  bulletSpeed: number;
  ai?: AIState;
}

export interface Bullet {
  id: number;
  ownerTankId: number;
  team: 'player' | 'enemy';
  playerId?: string;
  x: number;
  z: number;
  yaw: number;
  speed: number;
  /** 火力等级（决定能否破钢墙）。 */
  power: number;
  alive: boolean;
}

export interface Powerup {
  id: number;
  kind: PowerupKind;
  x: number;
  z: number;
  /** 消失时刻。 */
  until: number;
}

export interface MapState {
  tiles: Uint8Array;
  /** 关卡原始布局，用于铲子到期复原与重开。 */
  original: Uint8Array;
}

export interface PlayerSlot {
  id: string;
  name: string;
  lives: number;
  score: number;
  /** 下一次复活时的火力等级（被击毁降回 1）。 */
  power: number;
  tankId: number;
  alive: boolean;
}

export interface BaseState {
  hp: number;
  maxHp: number;
  alive: boolean;
  repairsLeft: number;
}

export type SimEvent =
  | { type: 'shoot'; x: number; z: number; yaw: number; team: 'player' | 'enemy'; power: number }
  | { type: 'brickBreak'; x: number; z: number }
  | { type: 'steelBreak'; x: number; z: number }
  | { type: 'explode'; x: number; z: number; big: boolean }
  | { type: 'bulletClash'; x: number; z: number }
  | { type: 'powerupSpawn'; kind: PowerupKind; x: number; z: number }
  | { type: 'powerupPickup'; kind: PowerupKind; playerId: string }
  | { type: 'playerDown'; playerId: string; lives: number }
  | { type: 'enemyDown'; enemyKind: EnemyKind; x: number; z: number }
  | { type: 'baseHit'; hp: number }
  | { type: 'levelClear'; level: number; score: number }
  | { type: 'gameOver'; reason: 'base' | 'lives' }
  | { type: 'victory'; score: number }
  | { type: 'spawnInvulnEnd'; tankId: number };

export type Phase = 'playing' | 'levelClear' | 'gameOver' | 'victory';

export interface World {
  tick: number;
  /** 仿真累计时间。 */
  time: number;
  /** 确定性伪随机（mulberry32），网络两端可复现。 */
  rng: () => number;
  seed: number;
  level: number;
  difficulty: DifficultyId;
  mode: 'solo' | 'coop';
  map: MapState;
  tanks: Tank[];
  bullets: Bullet[];
  powerups: Powerup[];
  base: BaseState;
  players: Record<string, PlayerSlot>;
  playerOrder: string[];
  /** 本关待刷新的敌人（按顺序）。 */
  enemyQueue: EnemyKind[];
  enemiesKilled: number;
  enemySpawnTimer: number;
  phase: Phase;
  nextId: number;
  /** 铲子生效截止时刻。 */
  shovelUntil: number;
  /** 本步产生的事件（每步清空）。 */
  events: SimEvent[];
  /** 用于掉落道具计数。 */
  killCounter: number;
}
