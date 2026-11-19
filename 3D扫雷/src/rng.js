/**
 * 种子随机数：同一种子必然生成同一序列，用来做「分享挑战」与单测复现。
 *
 * 为什么不用 Math.random：分享链接要能复现雷区；测试要能固定输入。
 * mulberry32 的周期与分布对「洗牌 480 个格子」这种量级完全够用，且实现只有 5 行。
 */

/** FNV-1a 32 位字符串哈希，把任意种子字符串压成一个 uint32。 */
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // 最后再抖一次，避免短种子的低位规律
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return h >>> 0;
}

/** 返回一个 [0,1) 的函数；同一 seed 必然同一序列。 */
export function createRng(seed) {
  let a = typeof seed === 'string' ? hashSeed(seed) : seed >>> 0;
  if (a === 0) a = 0x9e3779b9;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 种子字符集去掉了 0/o/1/l/i 这类易混字符，方便口头传播。 */
const SEED_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';

export function randomSeed(length = 6) {
  const out = [];
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const buf = new Uint32Array(length);
    cryptoObj.getRandomValues(buf);
    for (let i = 0; i < length; i++) out.push(SEED_ALPHABET[buf[i] % SEED_ALPHABET.length]);
  } else {
    for (let i = 0; i < length; i++) {
      out.push(SEED_ALPHABET[Math.floor(Math.random() * SEED_ALPHABET.length)]);
    }
  }
  return out.join('');
}

/** URL 参数里的种子做一次白名单清洗，非法字符直接拒掉（返回 null）。 */
export function normalizeSeed(raw, length = 6) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  if (s.length < 3 || s.length > 16) return null;
  for (const ch of s) if (!SEED_ALPHABET.includes(ch)) return null;
  return s.slice(0, Math.max(3, Math.min(length, 16)));
}
