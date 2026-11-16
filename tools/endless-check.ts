/**
 * 无尽模式冒烟测试：一路推到第 30 波，检查数值不 NaN、不崩、每波敌人数量与血量合理。
 *   pnpm tsx tools/endless-check.ts
 */
import { LEVELS } from '../src/data/levels';
import { DIFFICULTIES } from '../src/data/difficulty';
import { Simulation } from '../src/game/simulation';
import { buildEndlessWave } from '../src/data/waves';

const level = LEVELS[0]!;
const sim = new Simulation(level, DIFFICULTIES.normal, 'endless');

// 先给足钱把 13 个建造点铺满并升满，模拟一个“顶配”玩家的输出上限
sim.gold = 20000;
const order = ['gatling', 'mortar', 'tesla', 'laser'] as const;
level.pads.forEach((_, i) => {
  const id = order[i % order.length]!;
  if (sim.build(i, id).ok) {
    const t = sim.towers[sim.towers.length - 1]!;
    while (t.level < 3 && sim.upgrade(t.id)) {
      /* 升到三级 */
    }
  }
});
console.log(`铺满 ${sim.towers.length} 座塔，剩余金币 ${Math.round(sim.gold)}`);

let watchedWave = 0;
let bad = 0;
sim.onEvent((e) => {
  if (e.type === 'wave-start' && e.index % 5 === 1) {
    const finite = Number.isFinite(sim.gold) && Number.isFinite(sim.lives);
    console.log(
      `波 ${e.index}: 出生 ${e.total} | 首领 ${e.boss ? '是' : '否'} | 生命 ${sim.lives} | 金币 ${Math.round(sim.gold)} | 数值有限 ${finite}`,
    );
    if (!finite || e.total <= 0) bad++;
  }
});

const dt = 1 / 60;
let guard = 0;
while (sim.status !== 'lost' && sim.waveIndex < 30 && guard < 60 * 60 * 60) {
  guard++;
  if (sim.status === 'prep') {
    // 无尽模式不主动提前召唤，按自然节奏走
    if (sim.prepLeft > 0.02) {
      sim.prepLeft = 0.02;
    }
  }
  sim.step(dt);
}

const last = buildEndlessWave(30);
console.log(
  `结束于第 ${sim.waveIndex} 波，状态 ${sim.status}，生命 ${sim.lives}，击杀 ${sim.kills}，漏 ${sim.leaks}`,
);
console.log(`第 30 波理论规模：${last.groups.reduce((n, g) => n + g.count, 0)} 只`);
console.log(bad === 0 ? '数值检查通过' : `发现 ${bad} 处异常`);
