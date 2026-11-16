import { DIFFICULTIES, DIFFICULTY_ORDER } from '../data/difficulty';
import { LEVELS } from '../data/levels';
import { TOWER_ORDER } from '../data/towers';
import { ENEMIES } from '../data/enemies';
import type { DifficultyId, GameMode, LevelDef, TowerId } from '../data/types';
import type { Simulation } from '../game/simulation';
import { waveComposition } from '../game/simulation';
import type { SaveData, Settings } from '../save';
import { bestStars, starsFor } from '../save';

export interface UiBridge {
  startGame(levelId: string, diff: DifficultyId, mode: GameMode): void;
  goMenu(): void;
  goLevels(mode: GameMode): void;
  openSettings(from: 'menu' | 'pause'): void;
  closeSettings(): void;
  togglePause(): void;
  resume(): void;
  restart(): void;
  nextLevel(): void;
  armTower(id: TowerId | null): void;
  upgradeSelected(): void;
  sellSelected(): void;
  deselect(): void;
  setSpeed(v: number): void;
  startWave(): void;
  applySettings(s: Settings): void;
  resetProgress(): void;
  uiClick(): void;
}

export interface ResultData {
  won: boolean;
  stars: number;
  levelId: string;
  levelName: string;
  mode: GameMode;
  waveReached: number;
  kills: number;
  leaks: number;
  lives: number;
  elapsed: number;
  goldEarned: number;
  hasNext: boolean;
}

const fmtTime = (s: number): string => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

const starsHtml = (n: number): string =>
  [0, 1, 2].map((i) => `<span class="${i < n ? 'on' : ''}">★</span>`).join('');

export class UI {
  private readonly bridge: UiBridge;
  private save: SaveData;

  private readonly el: {
    menu: HTMLElement;
    levels: HTMLElement;
    settings: HTMLElement;
    hud: HTMLElement;
    pause: HTMLElement;
    result: HTMLElement;
    help: HTMLElement;
    toast: HTMLElement;
    banner: HTMLElement;
  };

  private readonly hudEls: {
    levelName: HTMLElement;
    levelMeta: HTMLElement;
    lives: HTMLElement;
    gold: HTMLElement;
    waveNum: HTMLElement;
    waveState: HTMLElement;
    waveFill: HTMLElement;
    waveBtn: HTMLButtonElement;
    towers: HTMLElement;
    preview: HTMLElement;
    selPanel: HTMLElement;
    hint: HTMLElement;
    speed: HTMLElement;
  };

  private levelGrid!: HTMLElement;
  private diffTabs!: HTMLElement;
  private levelTitle!: HTMLElement;
  private levelSub!: HTMLElement;
  private menuFoot!: HTMLElement;

  private levelSelectMode: GameMode = 'campaign';
  private difficulty: DifficultyId = 'normal';
  private settingsFrom: 'menu' | 'pause' = 'menu';

  private selectedTowerId: number | null = null;
  private armed: TowerId | null = 'gatling';
  private speed = 1;
  private paused = false;

  private last = {
    gold: -1,
    lives: -1,
    waveNum: '',
    waveState: '',
    fill: -1,
    armed: '' as string,
    previewKey: '',
    selId: -1,
    selLevel: -1,
    selUpgradeReady: false,
  };

  private toastTimer = 0;
  private hintTimer = 0;

  constructor(root: HTMLElement, bridge: UiBridge, save: SaveData) {
    this.bridge = bridge;
    this.save = save;

    root.innerHTML = this.template();
    this.el = {
      menu: this.q('#scr-menu'),
      levels: this.q('#scr-levels'),
      settings: this.q('#scr-settings'),
      hud: this.q('#hud'),
      pause: this.q('#ov-pause'),
      result: this.q('#ov-result'),
      help: this.q('#ov-help'),
      toast: this.q('#toast'),
      banner: this.q('#banner'),
    };
    this.hudEls = {
      levelName: this.q('#hud-level-name'),
      levelMeta: this.q('#hud-level-meta'),
      lives: this.q('#hud-lives'),
      gold: this.q('#hud-gold'),
      waveNum: this.q('#hud-wave-num'),
      waveState: this.q('#hud-wave-state'),
      waveFill: this.q('#hud-wave-fill'),
      waveBtn: this.q('#hud-wave-btn') as HTMLButtonElement,
      towers: this.q('#hud-towers'),
      preview: this.q('#hud-preview'),
      selPanel: this.q('#sel-panel'),
      hint: this.q('#hud-hint'),
      speed: this.q('#hud-speed'),
    };
    this.levelGrid = this.q('#level-grid');
    this.diffTabs = this.q('#diff-tabs');
    this.levelTitle = this.q('#levels-title');
    this.levelSub = this.q('#levels-sub');
    this.menuFoot = this.q('#menu-foot');

    this.renderTowerBar();
    this.bind();
    this.refreshMenu();
  }

  private q<T extends HTMLElement = HTMLElement>(sel: string): T {
    const node = document.querySelector(sel);
    if (!node) throw new Error(`UI 元素缺失: ${sel}`);
    return node as T;
  }

  private template(): string {
    return `
    <div class="screen" id="scr-menu">
      <div class="menu-brand">
        <div class="brand-kicker">SLK // TACTICAL DEFENSE</div>
        <h1>机甲防线</h1>
        <div class="brand-en">MECH BASTION</div>
        <div class="brand-line"></div>
      </div>
      <div class="menu-buttons">
        <button class="btn primary" data-act="campaign">开 始 战 役</button>
        <button class="btn" data-act="endless">无 尽 模 式</button>
        <button class="btn" data-act="settings">设 置</button>
        <button class="btn ghost" data-act="help">操 作 说 明</button>
      </div>
      <div class="menu-foot" id="menu-foot"></div>
    </div>

    <div class="screen hidden" id="scr-levels">
      <div class="page-head">
        <div>
          <h2 id="levels-title">作战区域</h2>
          <div class="sub" id="levels-sub">SELECT OPERATION</div>
        </div>
        <div class="diff-tabs" id="diff-tabs"></div>
      </div>
      <div class="level-grid" id="level-grid"></div>
      <div style="margin-top:24px">
        <button class="btn ghost small" data-act="menu">返 回 主 菜 单</button>
      </div>
    </div>

    <div class="screen hidden" id="scr-settings">
      <div class="page-head">
        <div>
          <h2>设置</h2>
          <div class="sub">SETTINGS</div>
        </div>
      </div>
      <div class="panel dialog" style="width:min(600px,92vw)">
        <div class="settings-row">
          <span class="label">主音量</span>
          <input type="range" id="set-master" min="0" max="100" value="75" />
        </div>
        <div class="settings-row">
          <span class="label">音效音量</span>
          <input type="range" id="set-sfx" min="0" max="100" value="85" />
        </div>
        <div class="settings-row">
          <span class="label">画质</span>
          <div class="seg" id="set-quality">
            <button data-q="low">低</button>
            <button data-q="medium">中</button>
            <button data-q="high">高</button>
          </div>
        </div>
        <div class="settings-row">
          <span class="label">存档</span>
          <button class="btn ghost small" data-act="reset">清 空 进 度</button>
        </div>
        <div class="row" style="margin-top:6px">
          <button class="btn primary" data-act="settings-back">返 回</button>
        </div>
      </div>
    </div>

    <div class="hud hidden" id="hud">
      <div class="hud-top">
        <div class="hud-block hud-level">
          <div>
            <div class="name" id="hud-level-name">—</div>
            <div class="meta" id="hud-level-meta">—</div>
          </div>
        </div>
        <div class="hud-block hud-wave">
          <div class="wave-row">
            <div>波次 <strong id="hud-wave-num">0 / 10</strong></div>
            <div id="hud-wave-state">准备阶段</div>
          </div>
          <div class="wave-bar"><i id="hud-wave-fill"></i></div>
          <div class="wave-actions">
            <button class="btn small primary" id="hud-wave-btn">开始下一波</button>
          </div>
        </div>
        <div class="hud-block hud-right">
          <div class="stat lives"><span class="ico">♥</span><span id="hud-lives">20</span></div>
          <div class="stat gold"><span class="ico">◆</span><span id="hud-gold">0</span></div>
          <div class="speed-group" id="hud-speed">
            <button data-speed="1" class="active">1×</button>
            <button data-speed="2">2×</button>
            <button data-speed="3">3×</button>
          </div>
          <button class="icon-btn" id="hud-pause" title="暂停（空格）">❚❚</button>
        </div>
      </div>

      <div class="wave-preview" id="hud-preview"></div>

      <div class="sel-panel panel hidden" id="sel-panel"></div>

      <div class="hud-bottom">
        <div class="tower-bar" id="hud-towers"></div>
      </div>

      <div class="hud-hint" id="hud-hint"></div>
    </div>

    <div class="overlay hidden" id="ov-pause">
      <div class="panel dialog">
        <h2 style="font-size:22px">已 暂 停</h2>
        <div class="sub">PAUSED</div>
        <div class="row"><button class="btn primary" data-act="resume">继 续</button></div>
        <div class="row">
          <button class="btn" data-act="settings-open">设 置</button>
          <button class="btn" data-act="restart">重 开 本 关</button>
        </div>
        <div class="row"><button class="btn ghost" data-act="quit">返 回 主 菜 单</button></div>
      </div>
    </div>

    <div class="overlay hidden" id="ov-result">
      <div class="panel dialog" id="result-body"></div>
    </div>

    <div class="overlay hidden" id="ov-help">
      <div class="panel dialog">
        <h2 style="font-size:22px">操 作 说 明</h2>
        <div class="sub">CONTROLS</div>
        <div class="result-stats" style="grid-template-columns:1fr">
          <div class="result-stat"><span>选择塔型</span><b>数字键 1 ～ 4 / 点击底部卡片</b></div>
          <div class="result-stat"><span>建造</span><b>左键点击发光的建造点</b></div>
          <div class="result-stat"><span>选中 / 取消</span><b>左键点塔 · 右键或 Esc 取消</b></div>
          <div class="result-stat"><span>升级 / 出售</span><b>U / X（或在选中面板里点）</b></div>
          <div class="result-stat"><span>提前召唤</span><b>点击「开始下一波」拿金币奖励</b></div>
          <div class="result-stat"><span>暂停 / 倍速</span><b>空格 / 1×2×3× 按钮</b></div>
          <div class="result-stat"><span>移动 / 缩放镜头</span><b>WASD 或右键拖拽 / 滚轮</b></div>
          <div class="result-stat"><span>镜头复位</span><b>R</b></div>
        </div>
        <div class="row"><button class="btn primary" data-act="help-close">知 道 了</button></div>
      </div>
    </div>

    <div class="toast" id="toast"></div>
    <div class="banner" id="banner"><div class="big"></div><div class="small"></div></div>
    `;
  }

  private bind(): void {
    document.addEventListener('click', (ev) => {
      const target = ev.target as HTMLElement;
      const actEl = target.closest<HTMLElement>('[data-act]');
      if (actEl) {
        this.handleAction(actEl.dataset.act!);
        return;
      }
      const towerEl = target.closest<HTMLElement>('[data-tower]');
      if (towerEl) {
        this.bridge.uiClick();
        const id = towerEl.dataset.tower as TowerId;
        this.bridge.armTower(this.armed === id ? null : id);
        return;
      }
      const speedEl = target.closest<HTMLElement>('[data-speed]');
      if (speedEl) {
        this.bridge.uiClick();
        this.bridge.setSpeed(Number(speedEl.dataset.speed));
        return;
      }
      const qEl = target.closest<HTMLElement>('[data-q]');
      if (qEl) {
        this.bridge.uiClick();
        this.onQualityClick(qEl.dataset.q as Settings['quality']);
        return;
      }
      const diffEl = target.closest<HTMLElement>('[data-diff]');
      if (diffEl) {
        this.bridge.uiClick();
        this.difficulty = diffEl.dataset.diff as DifficultyId;
        this.renderLevelCards();
        return;
      }
      const card = target.closest<HTMLElement>('[data-level]');
      if (card && !card.classList.contains('locked')) {
        this.bridge.uiClick();
        this.bridge.startGame(card.dataset.level!, this.difficulty, this.levelSelectMode);
      }
    });

    this.hudEls.waveBtn.addEventListener('click', () => {
      this.bridge.uiClick();
      this.bridge.startWave();
    });
    this.q('#hud-pause').addEventListener('click', () => {
      this.bridge.uiClick();
      this.bridge.togglePause();
    });

    const master = this.q<HTMLInputElement>('#set-master');
    const sfx = this.q<HTMLInputElement>('#set-sfx');
    const push = (): void => {
      this.bridge.applySettings({
        master: Number(master.value) / 100,
        sfx: Number(sfx.value) / 100,
        quality: this.currentQuality(),
      });
    };
    master.addEventListener('input', push);
    sfx.addEventListener('input', push);
  }

  private currentQuality(): Settings['quality'] {
    const active = this.q('#set-quality').querySelector('button.active');
    return (active?.getAttribute('data-q') as Settings['quality']) ?? 'high';
  }

  private onQualityClick(q: Settings['quality']): void {
    for (const b of this.q('#set-quality').querySelectorAll('button')) {
      b.classList.toggle('active', (b as HTMLElement).dataset.q === q);
    }
    this.bridge.applySettings({
      master: Number(this.q<HTMLInputElement>('#set-master').value) / 100,
      sfx: Number(this.q<HTMLInputElement>('#set-sfx').value) / 100,
      quality: q,
    });
  }

  private handleAction(act: string): void {
    this.bridge.uiClick();
    switch (act) {
      case 'campaign':
        this.levelSelectMode = 'campaign';
        this.bridge.goLevels('campaign');
        break;
      case 'endless':
        this.levelSelectMode = 'endless';
        this.bridge.goLevels('endless');
        break;
      case 'settings':
        this.settingsFrom = 'menu';
        this.bridge.openSettings('menu');
        break;
      case 'settings-open':
        this.settingsFrom = 'pause';
        this.bridge.openSettings('pause');
        break;
      case 'settings-back':
        this.bridge.closeSettings();
        break;
      case 'menu':
        this.bridge.goMenu();
        break;
      case 'resume':
        this.bridge.resume();
        break;
      case 'restart':
        this.bridge.restart();
        break;
      case 'quit':
        this.bridge.goMenu();
        break;
      case 'help':
        this.el.help.classList.remove('hidden');
        break;
      case 'help-close':
        this.el.help.classList.add('hidden');
        break;
      case 'reset':
        this.bridge.resetProgress();
        break;
      case 'next':
        this.bridge.nextLevel();
        break;
      case 'result-menu':
        this.bridge.goMenu();
        break;
      case 'result-retry':
        this.bridge.restart();
        break;
    }
  }

  // ---------- 屏幕切换 ----------

  showScreen(name: 'menu' | 'levels' | 'settings' | 'game'): void {
    this.el.menu.classList.toggle('hidden', name !== 'menu');
    this.el.levels.classList.toggle('hidden', name !== 'levels');
    this.el.settings.classList.toggle('hidden', name !== 'settings');
    this.el.hud.classList.toggle('hidden', name !== 'game');
    this.el.pause.classList.add('hidden');
    if (name === 'menu') this.el.result.classList.add('hidden');
  }

  get settingsOrigin(): 'menu' | 'pause' {
    return this.settingsFrom;
  }

  refreshMenu(): void {
    const clearedCount = LEVELS.filter((l) => bestStars(this.save, l.id) > 0).length;
    this.menuFoot.textContent = `THREE.JS · 全程序化美术 · 已通关 ${clearedCount}/${LEVELS.length} · 无尽最佳 ${
      this.save.endlessBest || '—'
    } 波`;
  }

  showLevels(mode: GameMode): void {
    this.levelSelectMode = mode;
    this.levelTitle.textContent = mode === 'endless' ? '无尽模式' : '作战区域';
    this.levelSub.textContent = mode === 'endless' ? 'ENDLESS · 选一张地图' : 'SELECT OPERATION';
    this.renderDiffTabs();
    this.renderLevelCards();
    this.showScreen('levels');
  }

  private renderDiffTabs(): void {
    this.diffTabs.innerHTML = DIFFICULTY_ORDER.map((id) => {
      const d = DIFFICULTIES[id];
      return `<button class="diff-tab ${id === this.difficulty ? 'active' : ''}" data-diff="${id}">${d.name}</button>`;
    }).join('');
  }

  private renderLevelCards(): void {
    this.diffTabs.innerHTML = DIFFICULTY_ORDER.map((id) => {
      const d = DIFFICULTIES[id];
      return `<button class="diff-tab ${id === this.difficulty ? 'active' : ''}" data-diff="${id}">${d.name}</button>`;
    }).join('');

    const anyCleared = LEVELS.some((l) => bestStars(this.save, l.id) > 0);
    this.levelGrid.innerHTML = LEVELS.map((level, i) => {
      const prev = i > 0 ? LEVELS[i - 1]! : null;
      const unlocked =
        this.levelSelectMode === 'endless'
          ? anyCleared
          : prev === null || bestStars(this.save, prev.id) > 0;
      const stars = starsFor(this.save, level.id, this.difficulty);
      return `
        <div class="level-card ${unlocked ? '' : 'locked'}" data-level="${level.id}">
          <div class="level-index">OPERATION 0${level.index}</div>
          <div class="level-name">${level.name}</div>
          <div class="level-en">${level.english}</div>
          <div class="stars">${starsHtml(stars)}</div>
          <div class="level-desc">${level.subtitle}</div>
          ${unlocked ? '' : `<div class="lock-tag">通关前一关解锁</div>`}
        </div>`;
    }).join('');
  }

  showSettings(s: Settings): void {
    this.q<HTMLInputElement>('#set-master').value = String(Math.round(s.master * 100));
    this.q<HTMLInputElement>('#set-sfx').value = String(Math.round(s.sfx * 100));
    for (const b of this.q('#set-quality').querySelectorAll('button')) {
      b.classList.toggle('active', (b as HTMLElement).dataset.q === s.quality);
    }
    this.showScreen('settings');
  }

  // ---------- 战斗界面 ----------

  renderTowerBar(): void {
    this.hudEls.towers.innerHTML = TOWER_ORDER.map((t) => {
      const color = `#${t.color.toString(16).padStart(6, '0')}`;
      return `
        <div class="tower-card" data-tower="${t.id}">
          <div class="tower-swatch" style="color:${color}">
            <div class="tower-glyph">${t.name[0]}</div>
            <div class="tower-key">${t.hotkey}</div>
          </div>
          <div class="tower-name">${t.name}</div>
          <div class="tower-role">${t.role}</div>
          <div class="tower-cost">◆ ${t.cost}</div>
        </div>`;
    }).join('');
  }

  enterGame(sim: Simulation, level: LevelDef): void {
    this.selectedTowerId = null;
    this.armed = 'gatling';
    this.speed = 1;
    this.paused = false;
    this.last.selId = -1;
    this.last.gold = -1;
    this.last.lives = -1;
    this.last.previewKey = '';
    this.last.waveNum = '';
    this.last.waveState = '';
    this.last.fill = -1;
    this.last.armed = '';

    document.documentElement.style.setProperty('--accent', `#${level.theme.accent.toString(16).padStart(6, '0')}`);
    this.hudEls.levelName.textContent = level.name;
    this.hudEls.levelMeta.textContent = `${DIFFICULTIES[sim.difficulty.id].name} · ${
      sim.mode === 'endless' ? '无尽模式' : `第 ${level.index} 关`
    }`;
    this.hudEls.selPanel.classList.add('hidden');
    this.el.result.classList.add('hidden');
    this.el.pause.classList.add('hidden');
    this.showScreen('game');
    this.showHint('1～4 选择塔型 · 左键点击建造点建塔 · 空格暂停', 9);
    this.syncSpeedButtons();
    this.syncArmed();
    this.update(sim);
  }

  get selectedId(): number | null {
    return this.selectedTowerId;
  }

  selectTower(id: number | null): void {
    this.selectedTowerId = id;
    if (id === null) {
      this.hudEls.selPanel.classList.add('hidden');
      this.last.selId = -1;
    }
  }

  setArmed(id: TowerId | null): void {
    this.armed = id;
    this.syncArmed();
  }

  private syncArmed(): void {
    const cards = this.hudEls.towers.querySelectorAll<HTMLElement>('.tower-card');
    cards.forEach((card) => {
      card.classList.toggle('armed', card.dataset.tower === this.armed);
    });
  }

  setSpeed(v: number): void {
    this.speed = v;
    this.syncSpeedButtons();
  }

  private syncSpeedButtons(): void {
    for (const b of this.hudEls.speed.querySelectorAll<HTMLElement>('button')) {
      b.classList.toggle('active', Number(b.dataset.speed) === this.speed);
    }
  }

  get playSpeed(): number {
    return this.speed;
  }

  get armedTower(): TowerId | null {
    return this.armed;
  }

  showPause(visible: boolean): void {
    this.paused = visible;
    this.el.pause.classList.toggle('hidden', !visible);
  }

  get isPaused(): boolean {
    return this.paused;
  }

  toast(message: string, kind: 'warn' | 'good' | '' = ''): void {
    const t = this.el.toast;
    t.textContent = message;
    t.className = `toast show ${kind}`;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      t.className = 'toast';
    }, 1800);
  }

  showHint(text: string, seconds: number): void {
    this.hudEls.hint.textContent = text;
    this.hudEls.hint.classList.add('show');
    window.clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => this.hudEls.hint.classList.remove('show'), seconds * 1000);
  }

  banner(big: string, small: string, kind: '' | 'boss' = '', ms = 1600): void {
    const b = this.el.banner;
    b.querySelector('.big')!.textContent = big;
    b.querySelector('.small')!.textContent = small;
    b.className = `banner show ${kind}`;
    window.setTimeout(() => {
      b.classList.remove('show');
    }, ms);
  }

  showResult(r: ResultData): void {
    const body = this.q('#result-body');
    const starRow = r.won ? `<div class="result-stars">${starsHtml(r.stars)}</div>` : '';
    body.innerHTML = `
      <h2 style="font-size:26px;color:${r.won ? 'var(--ok)' : 'var(--danger)'}">${
        r.won ? '防 线 守 住 了' : '防 线 失 守'
      }</h2>
      <div class="sub">${r.mode === 'endless' ? 'ENDLESS RUN' : r.levelName}</div>
      ${starRow}
      <div class="result-stats">
        <div class="result-stat"><span>到达波次</span><b>${r.waveReached}</b></div>
        <div class="result-stat"><span>击杀</span><b>${r.kills}</b></div>
        <div class="result-stat"><span>漏怪</span><b>${r.leaks}</b></div>
        <div class="result-stat"><span>剩余生命</span><b>${r.lives}</b></div>
        <div class="result-stat"><span>用时</span><b>${fmtTime(r.elapsed)}</b></div>
        <div class="result-stat"><span>获取金币</span><b>${r.goldEarned}</b></div>
      </div>
      <div class="row">
        <button class="btn" data-act="result-retry">重 玩</button>
        ${r.hasNext ? '<button class="btn primary" data-act="next">下 一 关</button>' : ''}
        <button class="btn ghost" data-act="result-menu">主 菜 单</button>
      </div>`;
    this.el.result.classList.remove('hidden');
  }

  hideResult(): void {
    this.el.result.classList.add('hidden');
  }

  // ---------- 每帧 HUD ----------

  update(sim: Simulation): void {
    const gold = Math.floor(sim.gold);
    if (gold !== this.last.gold) {
      if (gold > this.last.gold && this.last.gold >= 0) {
        this.bump(this.hudEls.gold);
      }
      this.hudEls.gold.textContent = String(gold);
      this.last.gold = gold;
      this.refreshCardAffordability(sim);
    }
    const lives = sim.lives;
    if (lives !== this.last.lives) {
      if (lives < this.last.lives && this.last.lives >= 0) this.bump(this.hudEls.lives);
      this.hudEls.lives.textContent = String(lives);
      this.last.lives = lives;
    }

    const totalWaves = sim.totalWaves;
    const waveText =
      sim.mode === 'endless'
        ? `第 ${Math.max(1, sim.waveIndex)} 波`
        : `${sim.waveIndex} / ${totalWaves}`;
    if (waveText !== this.last.waveNum) {
      this.hudEls.waveNum.textContent = waveText;
      this.last.waveNum = waveText;
    }

    let stateText: string;
    let fill: number;
    if (sim.status === 'wave') {
      const remaining = sim.waveRemainingToSpawn + sim.enemies.length;
      stateText = `敌军 ${remaining}`;
      fill = sim.waveTotal > 0 ? 1 - remaining / sim.waveTotal : 1;
    } else if (sim.status === 'prep') {
      const prepTotal = sim.waveIndex === 0 ? 20 : 12;
      stateText = `下一波 ${Math.ceil(sim.prepLeft)}s`;
      fill = 1 - Math.max(0, sim.prepLeft) / prepTotal;
      fill = Math.min(1, fill);
    } else if (sim.status === 'won') {
      stateText = '全部清除';
      fill = 1;
    } else {
      stateText = '防线失守';
      fill = 1;
    }
    if (stateText !== this.last.waveState) {
      this.hudEls.waveState.textContent = stateText;
      this.last.waveState = stateText;
    }
    const fillPct = Math.round(Math.min(1, Math.max(0, fill)) * 100);
    if (fillPct !== this.last.fill) {
      this.hudEls.waveFill.style.width = `${fillPct}%`;
      this.last.fill = fillPct;
    }

    const canCall = sim.status === 'prep';
    this.hudEls.waveBtn.disabled = !canCall;
    if (canCall) {
      const bonus = Math.max(0, Math.round(sim.prepLeft * 1.5));
      this.hudEls.waveBtn.textContent = `提前召唤 +${bonus}`;
    } else {
      this.hudEls.waveBtn.textContent = sim.status === 'wave' ? '第 ' + sim.waveIndex + ' 波进行中' : '—';
    }

    // 敌人组成预览
    const previewKey = `${sim.waveIndex}-${sim.status}-${sim.mode}`;
    if (previewKey !== this.last.previewKey) {
      this.last.previewKey = previewKey;
      const wave = sim.status === 'prep' ? sim.nextWavePreview() : sim.currentWave;
      const comp = waveComposition(wave);
      const label = sim.status === 'prep' ? '下一波' : '本波';
      this.hudEls.preview.innerHTML = comp.length
        ? `<span>${label}</span>` +
          comp
            .map((c) => {
              const def = ENEMIES[c.type];
              const color = `#${def.accent.toString(16).padStart(6, '0')}`;
              return `<span class="grp"><i class="dot" style="background:${color}"></i>${def.name} ×${c.count}</span>`;
            })
            .join('')
        : '';
    }

    this.updateSelectedPanel(sim);
  }

  private refreshCardAffordability(sim: Simulation): void {
    const cards = this.hudEls.towers.querySelectorAll<HTMLElement>('.tower-card');
    cards.forEach((card) => {
      const id = card.dataset.tower as TowerId;
      const def = TOWER_ORDER.find((t) => t.id === id)!;
      card.classList.toggle('poor', sim.gold < def.cost);
    });
  }

  private updateSelectedPanel(sim: Simulation): void {
    const id = this.selectedTowerId;
    if (id === null) {
      if (this.last.selId !== -1) {
        this.hudEls.selPanel.classList.add('hidden');
        this.last.selId = -1;
      }
      return;
    }
    const tower = sim.towers.find((t) => t.id === id);
    if (!tower) {
      this.selectTower(null);
      return;
    }
    const stats = tower.def.levels[tower.level - 1];
    const nextStats = tower.level < 3 ? tower.def.levels[(tower.level) as 1 | 2] : null;
    const upgradeCost = tower.level < 3 ? tower.def.upgradeCost[tower.level - 1] : 0;
    const refund = Math.floor(tower.invested * 0.7);
    const canUpgrade = nextStats !== null && sim.gold >= upgradeCost;
    const needsRebuild =
      this.last.selId !== id || this.last.selLevel !== tower.level || this.last.selUpgradeReady !== canUpgrade;

    if (needsRebuild) {
      this.last.selId = id;
      this.last.selLevel = tower.level;
      this.last.selUpgradeReady = canUpgrade;
      const dps = (stats.damage * stats.rate).toFixed(1);
      const extra: string[] = [];
      if (stats.aoe > 0) extra.push(`爆炸半径 <b>${stats.aoe.toFixed(1)}</b>`);
      if (stats.chain > 0) extra.push(`连锁 <b>${stats.chain}</b> 目标`);
      if (stats.slow > 0) extra.push(`减速 <b>${Math.round(stats.slow * 100)}%</b>`);
      if (stats.pierceArmor) extra.push('无视护甲');
      this.hudEls.selPanel.innerHTML = `
        <div class="sel-head">
          <div class="sel-name">${tower.def.name}</div>
          <div class="sel-lv">LV ${tower.level}</div>
        </div>
        <div class="sel-stats">
          <div>伤害 <b>${stats.damage}</b></div>
          <div>射速 <b>${stats.rate.toFixed(2)}/s</b></div>
          <div>射程 <b>${stats.range.toFixed(1)}</b></div>
          <div>DPS <b>${dps}</b></div>
          ${extra.map((e) => `<div style="grid-column:1/-1">${e}</div>`).join('')}
        </div>
        <div class="sel-actions">
          ${
            nextStats
              ? `<button class="btn ${canUpgrade ? 'primary' : ''}" id="sel-upgrade" ${
                  canUpgrade ? '' : 'disabled'
                }>升级 ◆${upgradeCost}</button>`
              : '<button class="btn" disabled>已满级</button>'
          }
          <button class="btn ghost" id="sel-sell">出售 ◆${refund}</button>
        </div>`;
      this.hudEls.selPanel.classList.remove('hidden');
      const up = this.hudEls.selPanel.querySelector<HTMLButtonElement>('#sel-upgrade');
      if (up) up.addEventListener('click', () => this.bridge.upgradeSelected());
      const sell = this.hudEls.selPanel.querySelector<HTMLButtonElement>('#sel-sell');
      if (sell) sell.addEventListener('click', () => this.bridge.sellSelected());
    }
  }

  private bump(el: HTMLElement): void {
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }

  syncSave(save: SaveData): void {
    this.save = save;
    this.refreshMenu();
  }
}
