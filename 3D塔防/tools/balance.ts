/**
 * 无头平衡测试：用脚本化的建造顺序跑完整关卡，输出每波战报。
 * 只依赖纯模拟层，不加载 Three.js。
 *
 *   pnpm tsx tools/balance.ts [难度] [关卡序号]
 *   例：pnpm tsx tools/balance.ts normal 1
 */
import { LEVELS } from '../src/data/levels';
import { DIFFICULTIES } from '../src/data/difficulty';
import { TOWERS } from '../src/data/towers';
import { Simulation } from '../src/game/simulation';
import { PathTrack } from '../src/game/path';
import type { DifficultyId, LevelDef, TowerId } from '../src/data/types';

interface Plan {
  pad: number;
  tower: TowerId;
}

/** 覆盖式选址：优先选射程覆盖路径最长的建造点，避免全挤在一起 */
function rankPads(level: LevelDef): number[] {
  const track = new PathTrack(level.waypoints);
  const samples: { x: number; z: number }[] = [];
  for (let d = 0; d <= track.total; d += 1) {
    const s = track.sample(d);
    samples.push({ x: s.x, z: s.z });
  }
  const coverage = level.pads.map((pad) => {
    let n = 0;
    for (const s of samples) {
      if (Math.hypot(s.x - pad.x, s.z - pad.z) <= 9.5) n++;
    }
    return { index: level.pads.indexOf(pad), score: n };
  });
  return coverage.sort((a, b) => b.score - a.score).map((c) => c.index);
}

const ROTATION: TowerId[] = ['gatling', 'mortar', 'tesla', 'laser'];

function buildPlan(level: LevelDef): Plan[] {
  const order = rankPads(level);
  return order.map((pad, i) => ({ pad, tower: ROTATION[i % ROTATION.length]! }));
}

interface Report {
  level: string;
  diff: string;
  won: boolean;
  waveReached: number;
  lives: number;
  kills: number;
  leaks: number;
  goldLeft: number;
  towersBuilt: number;
  towerLevels: number[];
  elapsed: number;
  waveLog: { wave: number; lives: number; gold: number; towers: number }[];
}

function run(level: LevelDef, diffId: DifficultyId, verbose: boolean): Report {
  const sim = new Simulation(level, DIFFICULTIES[diffId], 'campaign');
  const plan = buildPlan(level);
  let nextPlan = 0;
  const waveLog: Report['waveLog'] = [];
  let lastWave = 0;
  let lastLives = sim.lives;
  let leaksByWave = 0;

  const tryBuy = (): void => {
    // 1) 有钱先铺塔（每波最多补 2 座，模拟玩家节奏）
    for (let guard = 0; guard < 12 && nextPlan < plan.length; guard++) {
      const p = plan[nextPlan]!;
      const def = TOWERS[p.tower]!;
      if (sim.gold < def.cost) break;
      const ok = sim.build(p.pad, p.tower);
      if (ok.ok) nextPlan++;
      else break;
    }
    // 2) 再升级：优先把等级低的塔升上去
    for (let guard = 0; guard < 12; guard++) {
      const candidates = sim.towers.filter((t) => t.level < 3).sort((a, b) => a.level - b.level);
      const t = candidates.find((c) => sim.gold >= c.def.upgradeCost[c.level - 1]!);
      if (!t) break;
      sim.upgrade(t.id);
    }
  };

  sim.onEvent((e) => {
    if (e.type === 'leak') leaksByWave++;
    if (e.type === 'wave-start' && verbose) {
      console.log(
        `  波 ${e.index}: 出生 ${e.total}${e.boss ? ' (BOSS)' : ''} | 生命 ${sim.lives} | 金币 ${Math.round(sim.gold)} | 塔 ${sim.towers.length}`,
      );
    }
  });

  const dt = 1 / 60;
  let guard = 0;
  while (sim.status !== 'won' && sim.status !== 'lost' && guard < 60 * 60 * 40) {
    guard++;
    if (sim.status === 'prep') {
      tryBuy();
      // 玩家习惯：准备阶段过半就提前召唤
      if (sim.prepLeft < 8) sim.callNextWave();
    } else if (sim.waveIndex !== lastWave) {
      lastWave = sim.waveIndex;
      waveLog.push({ wave: lastWave, lives: lastLives, gold: Math.round(sim.gold), towers: sim.towers.length });
      lastLives = sim.lives;
      leaksByWave = 0;
    }
    sim.step(dt);
  }

  return {
    level: level.name,
    diff: DIFFICULTIES[diffId].name,
    won: sim.status === 'won',
    waveReached: sim.waveIndex,
    lives: sim.lives,
    kills: sim.kills,
    leaks: sim.leaks,
    goldLeft: Math.round(sim.gold),
    towersBuilt: sim.towers.length,
    towerLevels: sim.towers.map((t) => t.level),
    elapsed: Math.round(sim.elapsed),
    waveLog,
  };
}

const levelFilter = process.argv[2] ? Number(process.argv[2]) : null;
const targets = levelFilter ? [LEVELS[levelFilter - 1]!] : LEVELS;
const diffs: DifficultyId[] = ['easy', 'normal', 'hard'];

for (const level of targets) {
  for (const d of diffs) {
    const r = run(level, d, true);
    console.log(
      `\n[${r.level} / ${r.diff}] ${r.won ? '通关' : '失守'} @ 波 ${r.waveReached} | 生命 ${r.lives} | 击杀 ${r.kills} | 漏 ${r.leaks} | 塔 ${r.towersBuilt} (${r.towerLevels.join('/')}) | 余金 ${r.goldLeft} | ${r.elapsed}s`,
    );
    if (true) {
      console.log('  波次：' + r.waveLog.map((w) => `W${w.wave}(血${w.lives},塔${w.towers})`).join(' '));
    }
  }
}
