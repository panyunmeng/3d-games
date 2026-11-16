/**
 * 本地存储：最佳成绩（按难度分档）与音效开关。
 * localStorage 在隐私模式/禁用时会抛异常，统一 try/catch 掉，失败就当没有成绩。
 */
import { BEST_KEY } from './config.js';

const MUTE_KEY = 'mine-sweep-3d.muted.v1';

export function loadBest() {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

/** 只在破纪录时写。返回是否写入成功。 */
export function saveBest(levelKey, ms) {
  const best = loadBest();
  const prev = best[levelKey];
  if (typeof prev === 'number' && prev > 0 && prev <= ms) return false;
  best[levelKey] = ms;
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(best));
  } catch {
    return false;
  }
  return true;
}

export function loadMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveMuted(muted) {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    /* 忽略 */
  }
}
