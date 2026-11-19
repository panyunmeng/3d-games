import type { DifficultyId, EnemyKind, PowerupKind } from '../sim/constants';
import type { LevelDef } from '../sim/map';
import type { Phase, SimEvent } from '../sim/types';

/** 客户端 ↔ 服务器的消息协议。服务器权威：客户端只发意图，不收状态。 */

export type ServerMessage =
  | { t: 'room'; code: string }
  | { t: 'waiting' }
  | { t: 'peer'; name: string }
  | {
      t: 'start';
      playerId: string;
      levelDef: LevelDef;
      level: number;
      difficulty: DifficultyId;
      seed: number;
      players: string[];
    }
  | { t: 'level'; levelDef: LevelDef; level: number; seed: number }
  | { t: 'snap'; snap: SnapshotMsg }
  | { t: 'events'; events: SimEvent[] }
  | { t: 'phase'; phase: 'levelClear' | 'gameOver' | 'victory'; level: number; score: number; reason?: 'base' | 'lives' }
  | { t: 'error'; msg: string }
  | { t: 'peerLeft' }
  | { t: 'pong'; ts: number };

export type ClientMessage =
  | { t: 'create'; difficulty: DifficultyId }
  | { t: 'join'; code: string }
  | { t: 'input'; move: number; turn: number; aim: number | null; fire: boolean }
  | { t: 'next' }
  | { t: 'ping'; ts: number };

export interface SnapTank {
  id: number;
  kind: 'player' | 'enemy';
  playerId?: string;
  enemyKind?: EnemyKind;
  x: number;
  z: number;
  yaw: number;
  turretYaw: number;
  hp: number;
  maxHp: number;
  power: number;
  alive: boolean;
  invuln: boolean;
}

export interface SnapBullet {
  id: number;
  x: number;
  z: number;
  yaw: number;
  team: 'player' | 'enemy';
}

export interface SnapPowerup {
  id: number;
  kind: PowerupKind;
  x: number;
  z: number;
}

export interface SnapshotMsg {
  tick: number;
  time: number;
  phase: Phase;
  level: number;
  base: { hp: number; maxHp: number; alive: boolean };
  players: Record<string, { lives: number; score: number; power: number; alive: boolean; name: string }>;
  tanks: SnapTank[];
  bullets: SnapBullet[];
  powerups: SnapPowerup[];
  /** 全量地块（换关时下发），否则为增量。 */
  tiles: Array<[number, number]> | null;
  enemiesLeft: number;
  score: number;
}

export const ROOM_CODE_LENGTH = 4;
