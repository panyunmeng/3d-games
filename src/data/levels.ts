import { PathTrack } from '../game/path';
import { makeRng } from '../core/rng';
import { buildCampaignWaves } from './waves';
import type { LevelDef, PadDef } from './types';

/** 建造点：在路两侧 3.2～8.5 米内按路径弧长均匀选取，留出 5.2 米间距 */
function generatePads(track: PathTrack, seed: number): PadDef[] {
  const rng = makeRng(seed);
  const candidates: { x: number; z: number; along: number; jitter: number }[] = [];
  for (let x = -20; x <= 20; x += 2) {
    for (let z = -13; z <= 13; z += 2) {
      const near = track.nearest(x, z);
      if (near.dist < 3.2 || near.dist > 8.5) continue;
      const toBase = Math.hypot(x - track.points[track.points.length - 1]!.x, z - track.points[track.points.length - 1]!.z);
      if (toBase < 5) continue;
      candidates.push({ x, z, along: near.along, jitter: rng.next() });
    }
  }
  candidates.sort((a, b) => a.along - b.along || a.jitter - b.jitter);

  const pads: PadDef[] = [];
  const minSep = 6.0;
  for (const c of candidates) {
    if (pads.length >= 13) break;
    if (pads.some((p) => Math.hypot(p.x - c.x, p.z - c.z) < minSep)) continue;
    pads.push({ x: c.x, z: c.z });
  }
  return pads;
}

interface LevelSeed {
  id: string;
  name: string;
  english: string;
  subtitle: string;
  waypoints: { x: number; z: number }[];
  theme: LevelDef['theme'];
  power: number;
}

const SEEDS: LevelSeed[] = [
  {
    id: 'canyon',
    name: '铁锈峡谷',
    english: 'RUST CANYON',
    subtitle: '废弃矿区的第一道防线',
    waypoints: [
      { x: -24, z: -9 },
      { x: -16, z: -9 },
      { x: -16, z: 1 },
      { x: -7, z: 1 },
      { x: -7, z: 9 },
      { x: 3, z: 9 },
      { x: 3, z: -1 },
      { x: 11, z: -1 },
      { x: 11, z: -11 },
      { x: 19, z: -11 },
    ],
    theme: {
      ground: 0x1b2430,
      groundEdge: 0x101821,
      path: 0x2b3948,
      accent: 0x36d2ff,
      fog: 0x0a1018,
      sky: 0x060b12,
    },
    power: 1,
  },
  {
    id: 'foundry',
    name: '熔渣工厂',
    english: 'SLAG FOUNDRY',
    subtitle: '熔炉区的敌军补给线',
    waypoints: [
      { x: -24, z: 10 },
      { x: -13, z: 10 },
      { x: -13, z: -3 },
      { x: -3, z: -3 },
      { x: -3, z: 10 },
      { x: 6, z: 10 },
      { x: 6, z: -3 },
      { x: 15, z: -3 },
      { x: 15, z: -12 },
      { x: 21, z: -12 },
    ],
    theme: {
      ground: 0x241a1a,
      groundEdge: 0x160e0e,
      path: 0x3a2622,
      accent: 0xff7a3d,
      fog: 0x140b08,
      sky: 0x0b0605,
    },
    power: 1.14,
  },
  {
    id: 'aurora',
    name: '极光要塞',
    english: 'AURORA BASTION',
    subtitle: '螺旋防线，核心就在正中央',
    waypoints: [
      { x: -24, z: -12 },
      { x: -5, z: -12 },
      { x: -5, z: 9 },
      { x: 13, z: 9 },
      { x: 13, z: -6 },
      { x: 3, z: -6 },
      { x: 3, z: 3 },
      { x: 8, z: 3 },
    ],
    theme: {
      ground: 0x14202b,
      groundEdge: 0x0b131b,
      path: 0x22344a,
      accent: 0xb388ff,
      fog: 0x0a0f1c,
      sky: 0x05070f,
    },
    power: 1.15,
  },
];

export const LEVELS: LevelDef[] = SEEDS.map((seed, i) => {
  const track = new PathTrack(seed.waypoints);
  return {
    id: seed.id,
    index: i + 1,
    name: seed.name,
    english: seed.english,
    subtitle: seed.subtitle,
    waypoints: seed.waypoints,
    pads: generatePads(track, 1000 + i * 77),
    waves: buildCampaignWaves(seed.power),
    theme: seed.theme,
    power: seed.power,
  };
});

export const LEVEL_BY_ID = new Map<string, LevelDef>(LEVELS.map((l) => [l.id, l]));

/** 每关都预计算一条轨迹，模拟与渲染共用 */
export const LEVEL_TRACKS = new Map<string, PathTrack>(LEVELS.map((l) => [l.id, new PathTrack(l.waypoints)]));
