/** 时间格式化：毫秒 → m:ss。 */
export function formatTime(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** 没有成绩时显示占位符。 */
export function formatBest(ms) {
  return typeof ms === 'number' && ms > 0 ? formatTime(ms) : '--:--';
}
