import type { DifficultyDef, DifficultyId } from './types';

export const DIFFICULTIES: Record<DifficultyId, DifficultyDef> = {
  easy: {
    id: 'easy',
    name: '简单',
    english: 'RECRUIT',
    desc: '敌人更脆、金币更宽裕，适合熟悉机制。',
    hpMul: 0.8,
    speedMul: 0.95,
    rewardMul: 1.1,
    startGold: 380,
    lives: 25,
    star2LeakRatio: 0.5,
  },
  normal: {
    id: 'normal',
    name: '普通',
    english: 'VETERAN',
    desc: '标准数值，需要合理搭配塔型。',
    hpMul: 1,
    speedMul: 1,
    rewardMul: 0.9,
    startGold: 320,
    lives: 20,
    star2LeakRatio: 0.4,
  },
  hard: {
    id: 'hard',
    name: '困难',
    english: 'ELITE',
    desc: '敌人更强更快，容错很低，考验运营。',
    hpMul: 1.45,
    speedMul: 1.08,
    rewardMul: 0.8,
    startGold: 300,
    lives: 10,
    star2LeakRatio: 0.34,
  },
};

export const DIFFICULTY_ORDER: DifficultyId[] = ['easy', 'normal', 'hard'];
