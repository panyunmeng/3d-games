import type { DifficultyId } from './sim/constants';

export interface SaveData {
  highScore: number;
  maxLevel: number;
  wins: number;
  difficulty: DifficultyId;
  sfx: boolean;
  music: boolean;
  volume: number;
}

export const SAVE_KEY = 'tank3d.save.v1';

export const DEFAULT_SAVE: SaveData = {
  highScore: 0,
  maxLevel: 1,
  wins: 0,
  difficulty: 'classic',
  sfx: true,
  music: false,
  volume: 0.7,
};

function num(v: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, v));
}

/** 读档：字段缺失或损坏时逐个回退默认值，绝不因存档崩游戏（验收 A8）。 */
export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return { ...DEFAULT_SAVE };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_SAVE };
    const o = parsed as Record<string, unknown>;
    const difficulty: DifficultyId = o.difficulty === 'casual' ? 'casual' : 'classic';
    return {
      highScore: Math.floor(num(o.highScore, 0)),
      maxLevel: Math.floor(num(o.maxLevel, 1, 1, 10)),
      wins: Math.floor(num(o.wins, 0)),
      difficulty,
      sfx: typeof o.sfx === 'boolean' ? o.sfx : true,
      music: typeof o.music === 'boolean' ? o.music : false,
      volume: num(o.volume, 0.7, 0, 1),
    };
  } catch {
    return { ...DEFAULT_SAVE };
  }
}

export function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    // 隐私模式下 localStorage 可能不可写：静默降级，不影响游戏
  }
}

export function patchSave(patch: Partial<SaveData>): SaveData {
  const next = { ...loadSave(), ...patch };
  writeSave(next);
  return next;
}

export function recordResult(score: number, level: number, victory: boolean): SaveData {
  const cur = loadSave();
  const next: SaveData = {
    ...cur,
    highScore: Math.max(cur.highScore, score),
    maxLevel: Math.max(cur.maxLevel, Math.min(10, level)),
    wins: victory ? cur.wins + 1 : cur.wins,
  };
  writeSave(next);
  return next;
}
