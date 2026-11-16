import type { TowerDef, TowerLevelStats } from './types';

const stats = (s: Partial<TowerLevelStats>): TowerLevelStats => ({
  damage: 0,
  rate: 1,
  range: 9,
  aoe: 0,
  chain: 0,
  chainFalloff: 1,
  slow: 0,
  slowDuration: 0,
  pierceArmor: false,
  ...s,
});

export const TOWERS: Record<string, TowerDef> = {};

const defs: TowerDef[] = [
  {
    id: 'gatling',
    name: '加特林',
    english: 'GATLING',
    role: '速射 · 单体',
    desc: '高射速单体输出，可打空中目标。对付成群小兵最划算。',
    hotkey: '1',
    cost: 100,
    upgradeCost: [95, 170],
    hitsAir: true,
    hitsGround: true,
    projectile: 'tracer',
    color: 0x36d2ff,
    accent: 0x9be8ff,
    levels: [
      stats({ damage: 9, rate: 4.2, range: 9 }),
      stats({ damage: 16, rate: 5.2, range: 9.8 }),
      stats({ damage: 27, rate: 6.4, range: 10.6 }),
    ],
  },
  {
    id: 'mortar',
    name: '榴弹炮',
    english: 'MORTAR',
    role: '范围 · 溅射',
    desc: '抛射炮弹，落点范围爆炸。只打地面，但对密集队列伤害爆炸。',
    hotkey: '2',
    cost: 120,
    upgradeCost: [115, 195],
    hitsAir: false,
    hitsGround: true,
    projectile: 'shell',
    color: 0xffa63d,
    accent: 0xffd08a,
    levels: [
      stats({ damage: 55, rate: 0.55, range: 11, aoe: 3.4 }),
      stats({ damage: 100, rate: 0.65, range: 12, aoe: 3.9 }),
      stats({ damage: 175, rate: 0.75, range: 13, aoe: 4.4 }),
    ],
  },
  {
    id: 'tesla',
    name: '电磁塔',
    english: 'TESLA',
    role: '连锁 · 减速',
    desc: '闪电在敌人之间跳跃并附加减速，是被动守线的核心控制塔。',
    hotkey: '3',
    cost: 130,
    upgradeCost: [125, 205],
    hitsAir: true,
    hitsGround: true,
    projectile: 'arc',
    color: 0xb388ff,
    accent: 0xe0d0ff,
    levels: [
      stats({ damage: 20, rate: 1.2, range: 8, chain: 3, chainFalloff: 0.7, slow: 0.25, slowDuration: 1.5 }),
      stats({ damage: 34, rate: 1.5, range: 8.8, chain: 4, chainFalloff: 0.7, slow: 0.3, slowDuration: 1.7 }),
      stats({ damage: 56, rate: 1.8, range: 9.6, chain: 5, chainFalloff: 0.72, slow: 0.35, slowDuration: 2 }),
    ],
  },
  {
    id: 'laser',
    name: '激光塔',
    english: 'LASER',
    role: '穿甲 · 单体',
    desc: '高能激光束，无视护甲。重甲单位的克星，单体伤害最高。',
    hotkey: '4',
    cost: 150,
    upgradeCost: [145, 235],
    hitsAir: true,
    hitsGround: true,
    projectile: 'beam',
    color: 0xff4d6d,
    accent: 0xffb3c1,
    levels: [
      stats({ damage: 46, rate: 1.0, range: 10, pierceArmor: true }),
      stats({ damage: 86, rate: 1.15, range: 11, pierceArmor: true }),
      stats({ damage: 150, rate: 1.35, range: 12, pierceArmor: true }),
    ],
  },
];

for (const d of defs) TOWERS[d.id] = d;

export const TOWER_ORDER: TowerDef[] = defs;

export function towerSellValue(tower: { invested: number }): number {
  return Math.floor(tower.invested * 0.7);
}
