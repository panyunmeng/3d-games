import { GRID_H, GRID_W, type DifficultyId } from '../src/sim/constants';
import type { LevelDef } from '../src/sim/map';
import { createWorld, stepWorld } from '../src/sim/world';
import type { PlayerInput, Tank, World } from '../src/sim/types';

export function blankRows(): string[] {
  return Array.from({ length: GRID_H }, () => '.'.repeat(GRID_W));
}

export function makeLevel(over: Partial<LevelDef> = {}): LevelDef {
  return {
    id: 1,
    name: '测试关',
    rows: blankRows(),
    mix: { normal: 5, fast: 2, armor: 1 },
    ...over,
  };
}

export interface MakeWorldOptions {
  levelDef?: LevelDef;
  level?: number;
  difficulty?: DifficultyId;
  mode?: 'solo' | 'coop';
  playerIds?: string[];
  seed?: number;
}

export function makeWorld(opts: MakeWorldOptions = {}): World {
  return createWorld({
    levelDef: opts.levelDef ?? makeLevel(),
    level: opts.level ?? 1,
    difficulty: opts.difficulty ?? 'classic',
    mode: opts.mode ?? 'solo',
    playerIds: opts.playerIds ?? ['p1'],
    seed: opts.seed ?? 12345,
  });
}

/** 以固定 60 Hz 步进指定秒数，返回这一步内产生的事件。 */
export function stepFor(w: World, inputs: Record<string, PlayerInput>, seconds: number): void {
  const dt = 1 / 60;
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) stepWorld(w, inputs, dt);
}

export function makeEnemyTank(partial: Partial<Tank> & { x: number; z: number }): Tank {
  return {
    id: 900 + Math.floor(Math.random() * 1000),
    kind: 'enemy',
    enemyKind: 'normal',
    name: '测试敌人',
    yaw: Math.PI,
    turretYaw: Math.PI,
    hp: 1,
    maxHp: 1,
    alive: true,
    respawnAt: 0,
    invulnUntil: 0,
    fireCd: 0,
    power: 1,
    speed: 2.5,
    bulletSpeed: 30,
    ...partial,
  };
}
