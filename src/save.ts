import type { DifficultyId } from './data/types';
import type { Quality } from './render/view';

export interface Settings {
  master: number;
  sfx: number;
  quality: Quality;
}

export interface LevelSave {
  /** 各难度拿到的最高星数（0 表示未通关） */
  stars: Partial<Record<DifficultyId, number>>;
}

export interface SaveData {
  v: 1;
  levels: Record<string, LevelSave>;
  endlessBest: number;
  settings: Settings;
}

const KEY = 'mech-bastion.save.v1';

export const DEFAULT_SETTINGS: Settings = {
  master: 0.75,
  sfx: 0.85,
  quality: 'high',
};

export function defaultSave(): SaveData {
  return { v: 1, levels: {}, endlessBest: 0, settings: { ...DEFAULT_SETTINGS } };
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSave();
    const parsed = JSON.parse(raw) as Partial<SaveData>;
    const base = defaultSave();
    return {
      v: 1,
      levels: parsed.levels ?? base.levels,
      endlessBest: parsed.endlessBest ?? 0,
      settings: { ...base.settings, ...(parsed.settings ?? {}) },
    };
  } catch {
    return defaultSave();
  }
}

export function persist(save: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    /* 隐私模式或配额满，静默忽略 */
  }
}

export function clearSave(): SaveData {
  const fresh = defaultSave();
  persist(fresh);
  return fresh;
}

export function starsFor(save: SaveData, levelId: string, diff: DifficultyId): number {
  return save.levels[levelId]?.stars[diff] ?? 0;
}

export function bestStars(save: SaveData, levelId: string): number {
  const lv = save.levels[levelId];
  if (!lv) return 0;
  return Math.max(0, ...Object.values(lv.stars));
}

export function isCleared(save: SaveData, levelId: string): boolean {
  return bestStars(save, levelId) > 0;
}

export function recordStars(save: SaveData, levelId: string, diff: DifficultyId, stars: number): void {
  const lv = (save.levels[levelId] ??= { stars: {} });
  const prev = lv.stars[diff] ?? 0;
  if (stars > prev) lv.stars[diff] = stars;
  persist(save);
}

export function recordEndless(save: SaveData, wave: number): void {
  if (wave > save.endlessBest) {
    save.endlessBest = wave;
    persist(save);
  }
}
