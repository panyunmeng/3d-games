import './style.css';
import { Loop } from './core/loop';
import { AudioEngine } from './core/audio';
import { GameView } from './render/view';
import { Simulation } from './game/simulation';
import type { SimEvent } from './game/simulation';
import { LEVELS } from './data/levels';
import { DIFFICULTIES } from './data/difficulty';
import { TOWERS } from './data/towers';
import type { DifficultyId, GameMode, LevelDef, TowerId } from './data/types';
import { UI } from './ui/ui';
import type { ResultData, UiBridge } from './ui/ui';
import type { SaveData, Settings } from './save';
import { clearSave, loadSave, persist, recordEndless, recordStars } from './save';

type Screen = 'menu' | 'levels' | 'settings' | 'playing' | 'paused' | 'result';

class Game implements UiBridge {
  private readonly view: GameView;
  private readonly audio = new AudioEngine();
  private readonly ui: UI;
  private readonly loop: Loop;
  private readonly canvas: HTMLCanvasElement;

  private save: SaveData;
  private sim: Simulation | null = null;
  private level: LevelDef | null = null;
  private difficulty: DifficultyId = 'normal';
  private mode: GameMode = 'campaign';
  private state: Screen = 'menu';
  private settingsFrom: 'menu' | 'pause' = 'menu';
  private speed = 1;
  private resultTimer = 0;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.canvas = canvas;
    this.save = loadSave();
    this.view = new GameView(canvas);
    this.ui = new UI(uiRoot, this, this.save);

    this.audio.setVolumes(this.save.settings.master, this.save.settings.sfx);
    this.view.setQuality(this.save.settings.quality);

    // 菜单背景用第一关的场景
    const backdrop = LEVELS[0]!;
    this.view.loadLevel(backdrop);
    this.view.setAccent(backdrop.theme.accent);

    this.loop = new Loop(
      () => {
        if (this.state === 'playing' && this.sim) this.sim.step(1 / 60);
      },
      (dt) => this.frame(dt),
    );

    this.bindInput();
    this.loop.start();
  }

  // ---------- UiBridge ----------

  startGame(levelId: string, diff: DifficultyId, mode: GameMode): void {
    const level = LEVELS.find((l) => l.id === levelId);
    if (!level) return;
    this.level = level;
    this.difficulty = diff;
    this.mode = mode;
    this.speed = 1;
    this.loop.timeScale = 1;
    this.launch();
  }

  private launch(): void {
    if (!this.level) return;
    const sim = new Simulation(this.level, DIFFICULTIES[this.difficulty], this.mode);
    sim.onEvent((e) => this.onSimEvent(sim, e));
    this.sim = sim;
    this.state = 'playing';
    window.clearTimeout(this.resultTimer);
    this.view.loadLevel(this.level);
    this.view.setAccent(this.level.theme.accent);
    this.ui.enterGame(sim, this.level);
    this.ui.setSpeed(1);
  }

  goMenu(): void {
    this.recordEndlessBest();
    this.sim = null;
    this.state = 'menu';
    this.loop.timeScale = 1;
    this.ui.showScreen('menu');
    this.ui.refreshMenu();
    this.ui.hideResult();
    this.view.clearTransientSelect();
  }

  goLevels(mode: GameMode): void {
    this.mode = mode;
    this.state = 'levels';
    this.ui.showLevels(mode);
  }

  openSettings(from: 'menu' | 'pause'): void {
    this.settingsFrom = from;
    if (from === 'pause' && this.state === 'playing') this.togglePause();
    this.state = 'settings';
    this.ui.showSettings(this.save.settings);
  }

  closeSettings(): void {
    if (this.settingsFrom === 'pause' && this.sim) {
      this.state = 'paused';
      this.ui.showScreen('game');
      this.ui.showPause(true);
    } else {
      this.state = 'menu';
      this.ui.showScreen('menu');
    }
  }

  togglePause(): void {
    if (this.state === 'playing') {
      this.state = 'paused';
      this.ui.showPause(true);
    } else if (this.state === 'paused') {
      this.state = 'playing';
      this.ui.showPause(false);
    }
  }

  resume(): void {
    if (this.state === 'paused') {
      this.state = 'playing';
      this.ui.showPause(false);
    }
  }

  restart(): void {
    this.recordEndlessBest();
    this.ui.hideResult();
    this.launch();
  }

  nextLevel(): void {
    if (!this.level) return;
    const idx = LEVELS.findIndex((l) => l.id === this.level!.id);
    const next = LEVELS[idx + 1];
    if (!next) {
      this.goMenu();
      return;
    }
    this.level = next;
    this.mode = 'campaign';
    this.launch();
  }

  armTower(id: TowerId | null): void {
    if (this.state !== 'playing') return;
    if (id !== null && !TOWERS[id]) return;
    this.ui.setArmed(id);
    this.updateHighlight();
  }

  upgradeSelected(): void {
    if (!this.sim || this.state !== 'playing') return;
    const id = this.ui.selectedId;
    if (id === null) {
      this.ui.toast('先选中一座塔', 'warn');
      return;
    }
    const tower = this.sim.towers.find((t) => t.id === id);
    if (!tower) return;
    if (tower.level >= 3) {
      this.ui.toast('已经满级了', 'warn');
      return;
    }
    const cost = tower.def.upgradeCost[tower.level - 1]!;
    if (this.sim.gold < cost) {
      this.audio.play('error');
      this.ui.toast(`金币不足，需要 ◆${cost}`, 'warn');
      return;
    }
    this.sim.upgrade(id);
  }

  sellSelected(): void {
    if (!this.sim || this.state !== 'playing') return;
    const id = this.ui.selectedId;
    if (id === null) {
      this.ui.toast('先选中一座塔', 'warn');
      return;
    }
    const refund = this.sim.sell(id);
    if (refund > 0) {
      this.ui.selectTower(null);
      this.ui.toast(`已出售，回收 ◆${refund}`, 'good');
    }
  }

  deselect(): void {
    this.ui.selectTower(null);
    this.updateHighlight();
  }

  setSpeed(v: number): void {
    this.speed = Math.max(1, Math.min(3, v));
    this.loop.timeScale = this.speed;
    this.ui.setSpeed(this.speed);
  }

  startWave(): void {
    if (!this.sim || this.state !== 'playing') return;
    if (this.sim.status !== 'prep') return;
    const bonus = Math.max(0, Math.round(this.sim.prepLeft * 1.5));
    this.sim.callNextWave();
    if (bonus > 0) this.ui.toast(`提前召唤，获得 ◆${bonus}`, 'good');
  }

  applySettings(s: Settings): void {
    this.save.settings = { ...s };
    persist(this.save);
    this.audio.setVolumes(s.master, s.sfx);
    this.view.setQuality(s.quality);
  }

  resetProgress(): void {
    if (!window.confirm('确定清空全部关卡进度与无尽记录？此操作不可撤销。')) return;
    this.save = clearSave();
    this.ui.syncSave(this.save);
    this.audio.setVolumes(this.save.settings.master, this.save.settings.sfx);
    this.view.setQuality(this.save.settings.quality);
    this.ui.toast('进度已清空', 'good');
  }

  uiClick(): void {
    this.audio.unlock();
    this.audio.play('click');
  }

  // ---------- 模拟事件 ----------

  private onSimEvent(sim: Simulation, e: SimEvent): void {
    this.view.onSimEvent(e);
    switch (e.type) {
      case 'shot':
        if (e.style === 'beam') this.audio.play('shot-laser');
        else this.audio.play('shot-gatling');
        break;
      case 'chain':
        this.audio.play('shot-tesla');
        break;
      case 'shell':
        this.audio.play('shot-mortar');
        break;
      case 'explosion':
        this.audio.play('explosion');
        break;
      case 'kill':
        this.audio.play('kill');
        if (e.boss) {
          this.audio.play('victory');
          this.ui.banner('首 领 击 破', '防线压力骤减', 'boss', 2000);
        }
        break;
      case 'leak':
        this.audio.play('leak');
        break;
      case 'build':
        this.audio.play('build');
        break;
      case 'upgrade':
        this.audio.play('upgrade');
        break;
      case 'sell':
        this.audio.play('sell');
        break;
      case 'wave-start':
        this.audio.play('wave');
        if (e.boss) {
          this.audio.play('boss');
          this.ui.banner('精 锐 部 队', `第 ${e.index} 波 · 敌方首领出现`, 'boss', 2200);
        } else {
          this.ui.banner(`第 ${e.index} 波`, e.endless ? `敌军 ${e.total} 个单位` : `敌军 ${e.total} 个单位`, '', 1500);
        }
        break;
      case 'wave-clear':
        this.ui.toast(`第 ${e.index} 波清除，奖励 ◆${e.bonus}`, 'good');
        this.audio.play('upgrade');
        break;
      case 'win':
        this.finish(true, e.stars);
        break;
      case 'lose':
        this.finish(false, 0);
        break;
      default:
        break;
    }
    void sim;
  }

  private finish(won: boolean, stars: number): void {
    if (!this.sim || !this.level) return;
    const sim = this.sim;
    this.state = 'result';
    this.ui.showPause(false);
    if (won) {
      recordStars(this.save, this.level.id, sim.difficulty.id, stars);
      this.ui.syncSave(this.save);
      this.audio.play('victory');
    } else {
      if (sim.mode === 'endless') recordEndless(this.save, sim.waveIndex);
      this.audio.play('defeat');
    }

    const idx = LEVELS.findIndex((l) => l.id === this.level!.id);
    const hasNext = won && this.mode === 'campaign' && idx < LEVELS.length - 1;
    const result: ResultData = {
      won,
      stars,
      levelId: this.level.id,
      levelName: this.level.name,
      mode: sim.mode,
      waveReached: sim.waveIndex,
      kills: sim.kills,
      leaks: sim.leaks,
      lives: sim.lives,
      elapsed: sim.elapsed,
      goldEarned: sim.goldEarned,
      hasNext,
    };
    this.resultTimer = window.setTimeout(() => {
      if (this.state === 'result') this.ui.showResult(result);
    }, 1100);
  }

  private recordEndlessBest(): void {
    if (this.sim?.mode === 'endless') recordEndless(this.save, Math.max(0, this.sim.waveIndex - 1));
  }

  // ---------- 输入 ----------

  private bindInput(): void {
    const unlock = (): void => this.audio.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });

    this.canvas.addEventListener('pointerup', (ev) => {
      if (this.state !== 'playing' || !this.sim) return;
      if (ev.button === 2) {
        if (!this.view.pointerMoved) this.deselect();
        return;
      }
      if (ev.button !== 0 || this.view.pointerMoved) return;
      this.handleWorldClick(ev.clientX, ev.clientY);
    });

    window.addEventListener('keydown', (ev) => {
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;

      if (ev.code === 'Escape') {
        if (this.state === 'settings') {
          this.closeSettings();
          return;
        }
        if (this.ui.isPaused) {
          this.resume();
          return;
        }
        if (this.state === 'playing') this.deselect();
        return;
      }
      if (ev.code === 'Space') {
        if (this.state === 'playing' || this.state === 'paused') {
          ev.preventDefault();
          this.togglePause();
        }
        return;
      }
      if (this.state !== 'playing') return;
      switch (ev.code) {
        case 'Digit1':
          this.armTower('gatling');
          break;
        case 'Digit2':
          this.armTower('mortar');
          break;
        case 'Digit3':
          this.armTower('tesla');
          break;
        case 'Digit4':
          this.armTower('laser');
          break;
        case 'KeyU':
          this.upgradeSelected();
          break;
        case 'KeyR':
          this.view.resetCamera();
          break;
        case 'KeyX':
          this.sellSelected();
          break;
        case 'KeyG':
          if (import.meta.env.DEV) this.cheatGold();
          break;
        case 'KeyK':
          if (import.meta.env.DEV) this.cheatKillAll();
          break;
        case 'KeyJ':
          if (import.meta.env.DEV && this.sim) this.sim.devJumpToWave(10);
          break;
        case 'KeyL':
          if (import.meta.env.DEV && this.sim) this.sim.lives = 0;
          break;
        default:
          break;
      }
    });

    window.addEventListener('blur', () => {
      if (this.state === 'playing') this.togglePause();
    });
  }

  private handleWorldClick(clientX: number, clientY: number): void {
    const sim = this.sim!;
    const towerId = this.view.pickTower(clientX, clientY, sim);
    if (towerId !== null) {
      this.ui.selectTower(towerId);
      this.updateHighlight();
      return;
    }
    const padIndex = this.view.pickPad(clientX, clientY);
    if (padIndex === null) {
      this.deselect();
      return;
    }
    const occupied = sim.towers.find((t) => t.pad === padIndex);
    if (occupied) {
      this.ui.selectTower(occupied.id);
      this.updateHighlight();
      return;
    }
    const armed = this.ui.armedTower;
    if (!armed) {
      this.ui.toast('先在下方选择一种塔', 'warn');
      return;
    }
    const def = TOWERS[armed]!;
    if (sim.gold < def.cost) {
      this.audio.play('error');
      this.ui.toast(`${def.name} 需要 ◆${def.cost}`, 'warn');
      return;
    }
    const result = sim.build(padIndex, armed);
    if (result.ok) {
      const built = sim.towers.find((t) => t.pad === padIndex);
      if (built) this.ui.selectTower(built.id);
      this.updateHighlight();
    } else if (result.reason === 'gold') {
      this.audio.play('error');
      this.ui.toast('金币不足', 'warn');
    }
  }

  /** 仅开发期：加钱，用于快速验收 */
  private cheatGold(): void {
    if (!this.sim) return;
    this.sim.gold += 600;
    this.ui.toast('DEV +600', 'good');
  }

  /** 仅开发期：清空当前波，用于快速验收后续波次与结算 */
  private cheatKillAll(): void {
    if (!this.sim) return;
    const sim = this.sim;
    if (sim.status === 'prep') {
      sim.prepLeft = 0;
      return;
    }
    sim.spawnClear();
    for (const e of sim.enemies) sim.damage(e, 999999, true);
  }

  // ---------- 每帧 ----------

  private fpsAcc = 0;
  private fpsFrames = 0;

  private frame(dt: number): void {
    if (import.meta.env.DEV) {
      this.fpsAcc += dt;
      this.fpsFrames++;
      if (this.fpsAcc >= 0.5) {
        const fps = Math.round(this.fpsFrames / this.fpsAcc);
        const enemies = this.sim?.enemies.length ?? 0;
        this.ui.setFps(`${fps} fps · ${enemies} 敌`);
        this.fpsAcc = 0;
        this.fpsFrames = 0;
      }
    }
    const sim = this.sim;
    if (sim) {
      this.view.sync(sim, dt);
      this.ui.update(sim);
      if (this.state === 'playing') this.updateHighlight();
    } else {
      this.view.syncBackdrop(dt);
    }
    this.view.render();
  }

  private updateHighlight(): void {
    const sim = this.sim;
    if (!sim) return;
    const px = this.view.pointerX;
    const py = this.view.pointerY;
    const padIndex = this.view.pickPad(px, py);
    const armed = this.ui.armedTower;
    const armedDef = armed ? TOWERS[armed]! : null;

    const selectedId = this.ui.selectedId;
    const selected = selectedId !== null ? sim.towers.find((t) => t.id === selectedId) : undefined;

    const occupied = padIndex !== null && sim.towers.some((t) => t.pad === padIndex);
    const showRange = armedDef && !occupied ? armedDef.levels[0].range : 0;

    this.view.updateHighlight({
      hoverPad: occupied ? null : padIndex,
      hoverRange: showRange,
      hoverColor: armedDef ? armedDef.color : 0x36d2ff,
      selectX: selected ? selected.x : null,
      selectZ: selected ? selected.z : null,
      selectRange: selected ? selected.def.levels[selected.level - 1].range : 0,
      selectColor: selected ? selected.def.color : 0xffffff,
    });

    const hoveringTower = this.view.pickTower(px, py, sim) !== null;
    this.canvas.style.cursor = padIndex !== null || hoveringTower ? 'pointer' : 'default';
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#viewport');
const uiRoot = document.querySelector<HTMLElement>('#ui');
if (!canvas || !uiRoot) throw new Error('缺少 #viewport 或 #ui 节点');

const game = new Game(canvas, uiRoot);
(window as unknown as { __game: Game }).__game = game;
