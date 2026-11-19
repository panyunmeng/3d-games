import type { EnemyId, WaveDef, WaveGroup } from './types';

interface GroupSpec {
  type: EnemyId;
  count: number;
  interval: number;
  delay?: number;
}

/** 战役 10 波的骨架，具体数值再按关卡强度放大 */
const TEMPLATE: GroupSpec[][] = [
  [{ type: 'grunt', count: 8, interval: 0.85 }],
  [
    { type: 'grunt', count: 10, interval: 0.8 },
    { type: 'sprinter', count: 3, interval: 1.1, delay: 3 },
  ],
  [
    { type: 'grunt', count: 12, interval: 0.75 },
    { type: 'flyer', count: 4, interval: 1.2, delay: 2 },
    { type: 'sprinter', count: 4, interval: 0.9, delay: 7 },
  ],
  [
    { type: 'grunt', count: 10, interval: 0.7 },
    { type: 'shield', count: 3, interval: 1.6, delay: 2 },
    { type: 'flyer', count: 6, interval: 1.0, delay: 6 },
  ],
  [
    { type: 'tank', count: 1, interval: 2, delay: 0 },
    { type: 'grunt', count: 12, interval: 0.65, delay: 2 },
    { type: 'sprinter', count: 6, interval: 0.8, delay: 8 },
  ],
  [
    { type: 'flyer', count: 8, interval: 0.9 },
    { type: 'shield', count: 4, interval: 1.5, delay: 3 },
    { type: 'tank', count: 2, interval: 3, delay: 7 },
  ],
  [
    { type: 'splitter', count: 2, interval: 2.2 },
    { type: 'grunt', count: 14, interval: 0.6, delay: 2 },
    { type: 'sprinter', count: 8, interval: 0.7, delay: 9 },
  ],
  [
    { type: 'tank', count: 3, interval: 2.8 },
    { type: 'shield', count: 5, interval: 1.4, delay: 3 },
    { type: 'flyer', count: 10, interval: 0.8, delay: 6 },
  ],
  [
    { type: 'splitter', count: 4, interval: 1.8 },
    { type: 'tank', count: 3, interval: 2.6, delay: 4 },
    { type: 'sprinter', count: 12, interval: 0.6, delay: 8 },
    { type: 'flyer', count: 6, interval: 0.9, delay: 12 },
  ],
  [
    { type: 'boss', count: 1, interval: 1 },
    { type: 'tank', count: 2, interval: 3, delay: 6 },
    { type: 'shield', count: 4, interval: 1.6, delay: 4 },
    { type: 'splitter', count: 4, interval: 1.8, delay: 10 },
    { type: 'flyer', count: 12, interval: 0.7, delay: 2 },
    { type: 'grunt', count: 16, interval: 0.5, delay: 12 },
  ],
];

export function buildCampaignWaves(power: number): WaveDef[] {
  return TEMPLATE.map((groups, i) => {
    const scale = 1 + (power - 1) * 0.5;
    const waveGroups: WaveGroup[] = groups.map((g) => ({
      type: g.type,
      count: Math.max(1, Math.round(g.count * scale)),
      interval: g.interval,
      delay: g.delay ?? 0,
    }));
    return {
      groups: waveGroups,
      bonus: 15 + i * 4,
      boss: waveGroups.some((g) => g.type === 'boss'),
    };
  });
}

/**
 * 无尽模式波次：从第 11 波开始无限生成。
 * 强度按 1 + 0.12*(wave-11) 递增，每 5 波来一次 boss。
 */
export function buildEndlessWave(wave: number): WaveDef {
  const n = wave - 10;
  const k = 1 + 0.12 * (n - 1);
  const groups: WaveGroup[] = [
    { type: 'grunt', count: Math.round(10 * k), interval: 0.55, delay: 0 },
    { type: 'sprinter', count: Math.round(6 * k), interval: 0.6, delay: 4 },
  ];
  if (n >= 2) groups.push({ type: 'flyer', count: Math.round(6 * k), interval: 0.7, delay: 2 });
  if (n >= 3) groups.push({ type: 'shield', count: Math.round(3 * k), interval: 1.2, delay: 6 });
  if (n >= 4) groups.push({ type: 'tank', count: Math.round(2 * k), interval: 2.2, delay: 8 });
  if (n >= 5) groups.push({ type: 'splitter', count: Math.round(3 * k), interval: 1.6, delay: 10 });
  if (n % 5 === 0) groups.push({ type: 'boss', count: Math.max(1, Math.floor(n / 10)), interval: 2, delay: 3 });

  return {
    groups,
    bonus: 20 + wave * 2,
    boss: groups.some((g) => g.type === 'boss'),
  };
}
