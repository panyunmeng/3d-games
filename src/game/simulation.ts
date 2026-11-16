import { dist2 } from '../core/math';
import { makeRng } from '../core/rng';
import type { Rng } from '../core/rng';
import { ENEMIES } from '../data/enemies';
import { TOWERS } from '../data/towers';
import { buildEndlessWave } from '../data/waves';
import type {
  DifficultyDef,
  EnemyDef,
  EnemyId,
  GameMode,
  LevelDef,
  ProjectileStyle,
  TowerDef,
  TowerId,
  TowerLevelStats,
  WaveDef,
} from '../data/types';
import { PathTrack } from './path';

export type SimEvent =
  | { type: 'shot'; style: ProjectileStyle; color: number; x: number; z: number; tx: number; tz: number; level: number }
  | { type: 'chain'; color: number; points: { x: number; z: number }[] }
  | { type: 'shell'; color: number; x: number; z: number; tx: number; tz: number; duration: number }
  | { type: 'explosion'; x: number; z: number; radius: number; color: number }
  | { type: 'hit'; x: number; z: number; amount: number }
  | { type: 'kill'; x: number; z: number; enemy: EnemyId; reward: number; boss: boolean }
  | { type: 'leak'; x: number; z: number; lives: number }
  | { type: 'wave-start'; index: number; total: number; boss: boolean; endless: boolean }
  | { type: 'wave-clear'; index: number; bonus: number }
  | { type: 'build'; x: number; z: number; tower: TowerId }
  | { type: 'upgrade'; x: number; z: number; tower: TowerId; level: number }
  | { type: 'sell'; x: number; z: number; refund: number }
  | { type: 'win'; stars: number }
  | { type: 'lose' };

export interface TowerInstance {
  id: number;
  def: TowerDef;
  level: 1 | 2 | 3;
  x: number;
  z: number;
  pad: number;
  cooldown: number;
  angle: number;
  invested: number;
  /** 开火后坐力计时，渲染用 */
  recoil: number;
}

export interface EnemyInstance {
  id: number;
  def: EnemyDef;
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  dist: number;
  speed: number;
  x: number;
  z: number;
  lane: number;
  alive: boolean;
  slowUntil: number;
  slowFactor: number;
  lastHitAt: number;
  spawnAt: number;
  hitFlash: number;
}

interface PendingShell {
  x: number;
  z: number;
  tx: number;
  tz: number;
  t: number;
  duration: number;
  radius: number;
  damage: number;
  color: number;
}

export interface BuildResult {
  ok: boolean;
  reason?: 'occupied' | 'gold' | 'invalid';
}

const PREP_FIRST = 20;
const PREP_BETWEEN = 12;

export class Simulation {
  readonly level: LevelDef;
  readonly difficulty: DifficultyDef;
  readonly mode: GameMode;
  readonly path: PathTrack;

  towers: TowerInstance[] = [];
  enemies: EnemyInstance[] = [];
  shells: PendingShell[] = [];

  gold: number;
  lives: number;
  readonly livesMax: number;

  waveIndex = 0;
  status: 'prep' | 'wave' | 'won' | 'lost' = 'prep';
  prepLeft = PREP_FIRST;
  waveTotal = 0;
  waveRemainingToSpawn = 0;
  currentWave: WaveDef | null = null;

  time = 0;
  elapsed = 0;
  kills = 0;
  leaks = 0;
  damageDealt = 0;
  goldEarned = 0;
  bossActive = false;

  private spawnQueue: { t: number; type: EnemyId }[] = [];
  private waveClock = 0;
  private nextId = 1;
  private listeners: ((e: SimEvent) => void)[] = [];
  private rng: Rng;

  constructor(level: LevelDef, difficulty: DifficultyDef, mode: GameMode) {
    this.level = level;
    this.difficulty = difficulty;
    this.mode = mode;
    this.path = new PathTrack(level.waypoints);
    this.gold = difficulty.startGold;
    this.lives = difficulty.lives;
    this.livesMax = difficulty.lives;
    this.prepLeft = PREP_FIRST;
    this.rng = makeRng(0x5eed_1234);
  }

  onEvent(cb: (e: SimEvent) => void): void {
    this.listeners.push(cb);
  }

  private emit(e: SimEvent): void {
    for (const cb of this.listeners) cb(e);
  }

  get totalWaves(): number {
    return this.mode === 'campaign' ? this.level.waves.length : Infinity;
  }

  get isEndless(): boolean {
    return this.mode === 'endless';
  }

  padOccupancy(): Map<number, TowerInstance> {
    const map = new Map<number, TowerInstance>();
    for (const t of this.towers) map.set(t.pad, t);
    return map;
  }

  build(padIndex: number, towerId: TowerId): BuildResult {
    const pad = this.level.pads[padIndex];
    if (!pad) return { ok: false, reason: 'invalid' };
    if (this.towers.some((t) => t.pad === padIndex)) return { ok: false, reason: 'occupied' };
    const def = TOWERS[towerId];
    if (!def) return { ok: false, reason: 'invalid' };
    if (this.gold < def.cost) return { ok: false, reason: 'gold' };
    this.gold -= def.cost;
    const tower: TowerInstance = {
      id: this.nextId++,
      def,
      level: 1,
      x: pad.x,
      z: pad.z,
      pad: padIndex,
      cooldown: 0.4,
      angle: 0,
      invested: def.cost,
      recoil: 0,
    };
    this.towers.push(tower);
    this.emit({ type: 'build', x: pad.x, z: pad.z, tower: towerId });
    return { ok: true };
  }

  upgrade(towerId: number): boolean {
    const t = this.towers.find((x) => x.id === towerId);
    if (!t || t.level >= 3) return false;
    const cost = t.def.upgradeCost[t.level - 1]!;
    if (this.gold < cost) return false;
    this.gold -= cost;
    t.invested += cost;
    t.level = (t.level + 1) as 1 | 2 | 3;
    this.emit({ type: 'upgrade', x: t.x, z: t.z, tower: t.def.id, level: t.level });
    return true;
  }

  sell(towerId: number): number {
    const idx = this.towers.findIndex((x) => x.id === towerId);
    if (idx < 0) return 0;
    const t = this.towers[idx]!;
    const refund = Math.floor(t.invested * 0.7);
    this.gold += refund;
    this.towers.splice(idx, 1);
    this.emit({ type: 'sell', x: t.x, z: t.z, refund });
    return refund;
  }

  /** 玩家主动提前召唤下一波，按剩余准备时间给金币奖励 */
  callNextWave(): boolean {
    if (this.status !== 'prep') return false;
    const bonus = Math.max(0, Math.round(this.prepLeft * 1.5));
    if (bonus > 0) {
      this.gold += bonus;
      this.goldEarned += bonus;
    }
    this.startWave();
    return true;
  }

  private waveDefFor(index: number): WaveDef {
    if (index <= this.level.waves.length) return this.level.waves[index - 1]!;
    return buildEndlessWave(index);
  }

  private startWave(): void {
    this.waveIndex++;
    const wave = this.waveDefFor(this.waveIndex);
    this.currentWave = wave;
    this.spawnQueue = [];
    let total = 0;
    for (const g of wave.groups) {
      for (let i = 0; i < g.count; i++) {
        this.spawnQueue.push({ t: g.delay + i * g.interval, type: g.type });
      }
      total += g.count;
    }
    this.spawnQueue.sort((a, b) => a.t - b.t);
    this.waveClock = 0;
    this.waveTotal = total;
    this.waveRemainingToSpawn = total;
    this.bossActive = wave.boss;
    this.status = 'wave';
    this.prepLeft = 0;
    this.emit({
      type: 'wave-start',
      index: this.waveIndex,
      total,
      boss: wave.boss,
      endless: this.mode === 'endless',
    });
  }

  step(dt: number): void {
    if (this.status === 'won' || this.status === 'lost') return;
    this.time += dt;
    this.elapsed += dt;

    if (this.lives <= 0) {
      this.lives = 0;
      this.status = 'lost';
      this.emit({ type: 'lose' });
      return;
    }

    if (this.status === 'prep') {
      this.prepLeft -= dt;
      if (this.prepLeft <= 0) this.startWave();
      return;
    }

    this.updateSpawns(dt);
    this.updateShells(dt);
    this.updateEnemies(dt);
    this.updateTowers(dt);
    this.cleanup();

    if (this.lives <= 0) {
      this.lives = 0;
      this.status = 'lost';
      this.emit({ type: 'lose' });
      return;
    }
    this.checkWaveClear();
  }

  private updateSpawns(dt: number): void {
    this.waveClock += dt;
    while (this.spawnQueue.length > 0 && this.spawnQueue[0]!.t <= this.waveClock) {
      const item = this.spawnQueue.shift()!;
      this.spawnEnemy(item.type);
      this.waveRemainingToSpawn = this.spawnQueue.length;
    }
  }

  private hpMultiplier(): number {
    const waveRamp = 1 + 0.16 * (this.waveIndex - 1);
    return this.difficulty.hpMul * waveRamp;
  }

  private spawnEnemy(type: EnemyId, dist = 0, lane?: number): void {
    const def = ENEMIES[type];
    if (!def) return;
    const hpMul = this.hpMultiplier();
    const hp = Math.round(def.hp * hpMul);
    const shield = Math.round((def.shield ?? 0) * hpMul);
    const laneOffset = lane ?? this.rng.range(-0.55, 0.55);
    const enemy: EnemyInstance = {
      id: this.nextId++,
      def,
      hp,
      maxHp: hp,
      shield,
      maxShield: shield,
      dist,
      speed: def.speed * this.difficulty.speedMul,
      x: 0,
      z: 0,
      lane: laneOffset,
      alive: true,
      slowUntil: 0,
      slowFactor: 0,
      lastHitAt: this.time,
      spawnAt: this.time,
      hitFlash: 0,
    };
    this.enemies.push(enemy);
    this.placeEnemy(enemy);
  }

  private placeEnemy(e: EnemyInstance): void {
    const s = this.path.sample(e.dist);
    e.x = s.x - s.tz * e.lane;
    e.z = s.z + s.tx * e.lane;
  }

  private updateEnemies(dt: number): void {
    for (const e of this.enemies) {
      if (!e.alive) continue;
      let speed = e.speed;
      if (this.time < e.slowUntil) speed *= 1 - e.slowFactor;
      e.dist += speed * dt;
      this.placeEnemy(e);

      if (e.maxShield > 0 && e.def.shieldDelay !== undefined && e.def.shieldRegen) {
        if (this.time - e.lastHitAt >= e.def.shieldDelay && e.shield < e.maxShield) {
          e.shield = Math.min(e.maxShield, e.shield + e.def.shieldRegen * dt);
        }
      }
      if (e.hitFlash > 0) e.hitFlash = Math.max(0, e.hitFlash - dt * 6);

      if (e.dist >= this.path.total) {
        e.alive = false;
        const cost = e.def.boss ? 5 : 1;
        this.lives -= cost;
        this.leaks++;
        this.emit({ type: 'leak', x: e.x, z: e.z, lives: this.lives });
      }
    }
  }

  private updateShells(dt: number): void {
    for (const s of this.shells) {
      s.t += dt;
      if (s.t >= s.duration) {
        s.t = s.duration;
        this.explode(s);
      }
    }
    this.shells = this.shells.filter((s) => s.t < s.duration);
  }

  private explode(shell: PendingShell): void {
    this.emit({ type: 'explosion', x: shell.tx, z: shell.tz, radius: shell.radius, color: shell.color });
    for (const e of this.enemies) {
      if (!e.alive || e.def.flying) continue;
      const d = Math.sqrt(dist2(e.x, e.z, shell.tx, shell.tz));
      if (d > shell.radius) continue;
      const falloff = 1 - (d / shell.radius) * 0.55;
      this.damage(e, shell.damage * falloff, false);
    }
  }

  private updateTowers(dt: number): void {
    for (const t of this.towers) {
      if (t.recoil > 0) t.recoil = Math.max(0, t.recoil - dt * 6);
      const stats = t.def.levels[t.level - 1];
      t.cooldown -= dt;
      if (t.cooldown > 0) continue;
      const target = this.findTarget(t, stats);
      if (!target) continue;
      t.cooldown = 1 / stats.rate;
      t.angle = Math.atan2(target.x - t.x, target.z - t.z);
      t.recoil = 1;
      this.fire(t, stats, target);
    }
  }

  private findTarget(t: TowerInstance, stats: TowerLevelStats): EnemyInstance | null {
    const r2 = stats.range * stats.range;
    let best: EnemyInstance | null = null;
    let bestDist = -1;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (e.def.flying ? !t.def.hitsAir : !t.def.hitsGround) continue;
      if (dist2(e.x, e.z, t.x, t.z) > r2) continue;
      if (e.dist > bestDist) {
        bestDist = e.dist;
        best = e;
      }
    }
    return best;
  }

  private fire(t: TowerInstance, stats: TowerLevelStats, target: EnemyInstance): void {
    switch (t.def.projectile) {
      case 'tracer': {
        this.emit({ type: 'shot', style: 'tracer', color: t.def.accent, x: t.x, z: t.z, tx: target.x, tz: target.z, level: t.level });
        this.damage(target, stats.damage, stats.pierceArmor);
        break;
      }
      case 'shell': {
        const flight = Math.max(0.35, Math.sqrt(dist2(t.x, t.z, target.x, target.z)) / 22);
        this.shells.push({
          x: t.x,
          z: t.z,
          tx: target.x,
          tz: target.z,
          t: 0,
          duration: flight,
          radius: stats.aoe,
          damage: stats.damage,
          color: t.def.accent,
        });
        this.emit({ type: 'shell', color: t.def.accent, x: t.x, z: t.z, tx: target.x, tz: target.z, duration: flight });
        break;
      }
      case 'arc': {
        const points: { x: number; z: number }[] = [{ x: t.x, z: t.z }];
        let current: EnemyInstance | null = target;
        let dmg = stats.damage;
        const hit = new Set<number>();
        for (let i = 0; i < Math.max(1, stats.chain); i++) {
          if (!current) break;
          hit.add(current.id);
          points.push({ x: current.x, z: current.z });
          this.damage(current, dmg, stats.pierceArmor);
          if (stats.slow > 0) {
            current.slowFactor = Math.max(current.slowFactor, stats.slow);
            current.slowUntil = Math.max(current.slowUntil, this.time + stats.slowDuration);
          }
          dmg *= stats.chainFalloff;
          current = this.nearestEnemy(current.x, current.z, 4.6, hit, t.def.hitsAir, t.def.hitsGround);
        }
        this.emit({ type: 'chain', color: t.def.accent, points });
        break;
      }
      case 'beam': {
        this.emit({ type: 'shot', style: 'beam', color: t.def.accent, x: t.x, z: t.z, tx: target.x, tz: target.z, level: t.level });
        this.damage(target, stats.damage, stats.pierceArmor);
        break;
      }
    }
  }

  private nearestEnemy(
    x: number,
    z: number,
    radius: number,
    exclude: Set<number>,
    hitsAir: boolean,
    hitsGround: boolean,
  ): EnemyInstance | null {
    let best: EnemyInstance | null = null;
    let bestD = radius * radius;
    for (const e of this.enemies) {
      if (!e.alive || exclude.has(e.id)) continue;
      if (e.def.flying ? !hitsAir : !hitsGround) continue;
      const d = dist2(e.x, e.z, x, z);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  damage(e: EnemyInstance, amount: number, pierceArmor: boolean): void {
    if (!e.alive || amount <= 0) return;
    const armor = pierceArmor ? 0 : e.def.armor;
    let dmg = amount * (1 - armor);
    if (e.shield > 0) {
      const absorbed = Math.min(e.shield, dmg);
      e.shield -= absorbed;
      dmg -= absorbed;
    }
    e.hp -= dmg;
    e.lastHitAt = this.time;
    e.hitFlash = 1;
    this.damageDealt += amount;
    this.emit({ type: 'hit', x: e.x, z: e.z, amount });
    if (e.hp <= 0) this.kill(e);
  }

  private kill(e: EnemyInstance): void {
    if (!e.alive) return;
    e.alive = false;
    e.hp = 0;
    this.kills++;
    this.bossActive = this.bossActive && !e.def.boss;
    const reward = Math.max(1, Math.round(e.def.reward * this.difficulty.rewardMul));
    this.gold += reward;
    this.goldEarned += reward;
    this.emit({ type: 'kill', x: e.x, z: e.z, enemy: e.def.id, reward, boss: !!e.def.boss });
    const split = e.def.splitInto;
    if (split) {
      for (let i = 0; i < split.count; i++) {
        const offset = split.count > 1 ? (i - (split.count - 1) / 2) * 0.9 : 0;
        this.spawnEnemy(split.type, Math.max(0, e.dist - 0.5), offset);
      }
    }
  }

  private cleanup(): void {
    if (this.enemies.some((e) => !e.alive)) {
      this.enemies = this.enemies.filter((e) => e.alive);
    }
  }

  private checkWaveClear(): void {
    if (this.status !== 'wave') return;
    if (this.spawnQueue.length > 0) return;
    if (this.enemies.length > 0) return;
    const bonus = (this.currentWave?.bonus ?? 0) + 10;
    this.gold += bonus;
    this.goldEarned += bonus;
    this.emit({ type: 'wave-clear', index: this.waveIndex, bonus });
    if (this.mode === 'campaign' && this.waveIndex >= this.level.waves.length) {
      this.status = 'won';
      this.emit({ type: 'win', stars: this.computeStars() });
    } else {
      this.status = 'prep';
      this.prepLeft = PREP_BETWEEN;
    }
  }

  computeStars(): number {
    if (this.leaks === 0) return 3;
    if (this.leaks <= Math.ceil(this.livesMax * this.difficulty.star2LeakRatio)) return 2;
    return 1;
  }

  /** 开发/测试用：直接跳到指定波次 */
  devJumpToWave(n: number): void {
    this.waveIndex = Math.max(0, n - 1);
    this.status = 'prep';
    this.prepLeft = 0;
    this.enemies = [];
    this.spawnQueue.length = 0;
    this.waveRemainingToSpawn = 0;
  }

  /** 开发/测试用：丢弃尚未出场的敌人生成队列 */
  spawnClear(): void {
    this.spawnQueue.length = 0;
    this.waveRemainingToSpawn = 0;
  }

  nextWavePreview(): WaveDef | null {
    const next = this.waveIndex + 1;
    if (this.mode === 'endless') return this.waveDefFor(next);
    return this.level.waves[next - 1] ?? null;
  }
}

/** 波次里各类敌人的数量统计，供 HUD 展示 */
export function waveComposition(wave: WaveDef | null): { type: EnemyId; count: number }[] {
  if (!wave) return [];
  const map = new Map<EnemyId, number>();
  for (const g of wave.groups) map.set(g.type, (map.get(g.type) ?? 0) + g.count);
  return [...map.entries()].map(([type, count]) => ({ type, count }));
}
