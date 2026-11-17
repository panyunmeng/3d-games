import type { DifficultyId } from '../sim/constants';
import type { SaveData } from '../storage';

export interface HudState {
  level: number;
  lives: number;
  power: number;
  score: number;
  best: number;
  enemiesLeft: number;
  /** 合作模式下第二名玩家的数据 */
  partner?: { name: string; lives: number; score: number };
  hint?: string;
}

export interface UiCallbacks {
  onStartSolo: () => void;
  onOpenLobby: () => void;
  onCreateRoom: () => void;
  onJoinRoom: (code: string) => void;
  onLeaveLobby: () => void;
  onResume: () => void;
  onRestartLevel: () => void;
  onQuitToMenu: () => void;
  onNextLevel: () => void;
  onToggleDifficulty: () => void;
  onToggleSfx: () => void;
  onToggleMusic: () => void;
}

const DIFF_LABEL: Record<DifficultyId, string> = { classic: '经典', casual: '休闲' };

/** 所有界面与 HUD 的 DOM 层。3D 之外的交互全部在这里，渲染层不碰 DOM。 */
export class Ui {
  private readonly hud: HTMLDivElement;
  private readonly screen: HTMLDivElement;
  private readonly toastEl: HTMLDivElement;
  private toastTimer = 0;
  private roomCode: string | null = null;
  private hudRefs: Record<string, HTMLElement> = {};

  constructor(
    root: HTMLElement,
    private readonly cb: UiCallbacks,
  ) {
    const layer = document.createElement('div');
    layer.className = 'ui-layer';
    root.appendChild(layer);

    this.toastEl = document.createElement('div');
    this.toastEl.className = 'toast';

    this.hud = document.createElement('div');
    this.hud.className = 'hud hidden';
    this.hud.innerHTML = `
      <div class="hud-top">
        <div class="hud-panel">
          <span class="lives" data-ref="lives">♥ 3</span>
          <span class="power" data-ref="power">火力 1</span>
        </div>
        <div class="hud-panel">
          <span class="level" data-ref="level">第 1 关</span>
          <span class="muted">·</span>
          <span class="enemies"><span class="label">剩余</span> <span class="value" data-ref="enemies">20</span></span>
        </div>
        <div class="hud-panel">
          <span class="score" data-ref="score">0</span>
          <span class="muted"><span class="label">最高</span> <span data-ref="best">0</span></span>
        </div>
      </div>
      <div class="hud-bottom"><span class="hint" data-ref="hint"></span></div>
    `;
    layer.appendChild(this.hud);
    this.hud.appendChild(this.toastEl);
    this.hud.querySelectorAll<HTMLElement>('[data-ref]').forEach((el) => {
      const key = el.dataset.ref as string;
      this.hudRefs[key] = el;
    });

    this.screen = document.createElement('div');
    this.screen.className = 'screen hidden';
    layer.appendChild(this.screen);

    this.screen.addEventListener('click', (ev) => this.onScreenClick(ev));
    this.screen.addEventListener('input', (ev) => {
      const target = ev.target as HTMLInputElement;
      if (target.id === 'room-input') target.value = target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });
    this.screen.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        const input = this.screen.querySelector<HTMLInputElement>('#room-input');
        if (input && input.value.trim()) {
          ev.preventDefault();
          this.cb.onJoinRoom(input.value.trim().toUpperCase());
        }
      }
    });
  }

  private onScreenClick(ev: MouseEvent): void {
    const target = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!target) return;
    const act = target.dataset.act;
    switch (act) {
      case 'solo':
        this.cb.onStartSolo();
        break;
      case 'lobby':
        this.cb.onOpenLobby();
        break;
      case 'create':
        this.cb.onCreateRoom();
        break;
      case 'join': {
        const input = this.screen.querySelector<HTMLInputElement>('#room-input');
        const code = (input?.value ?? '').trim().toUpperCase();
        if (code) this.cb.onJoinRoom(code);
        break;
      }
      case 'back':
        this.cb.onLeaveLobby();
        break;
      case 'resume':
        this.cb.onResume();
        break;
      case 'restart':
        this.cb.onRestartLevel();
        break;
      case 'quit':
        this.cb.onQuitToMenu();
        break;
      case 'next':
        this.cb.onNextLevel();
        break;
      case 'diff':
        this.cb.onToggleDifficulty();
        break;
      case 'sfx':
        this.cb.onToggleSfx();
        break;
      case 'music':
        this.cb.onToggleMusic();
        break;
      case 'menu':
        this.cb.onQuitToMenu();
        break;
      default:
        break;
    }
  }

  private mount(html: string): void {
    this.screen.innerHTML = html;
    this.screen.classList.remove('hidden');
  }

  hideScreen(): void {
    this.screen.classList.add('hidden');
    this.screen.innerHTML = '';
  }

  setHudVisible(visible: boolean): void {
    this.hud.classList.toggle('hidden', !visible);
  }

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 1500);
  }

  updateHud(s: HudState): void {
    this.hudRefs.lives.textContent = `♥ ${s.lives}`;
    this.hudRefs.power.textContent = `火力 ${s.power}`;
    this.hudRefs.level.textContent = `第 ${s.level} 关`;
    this.hudRefs.enemies.textContent = String(s.enemiesLeft);
    this.hudRefs.score.textContent = `${s.partner ? `${s.partner.name} ` : ''}${s.score}`;
    this.hudRefs.best.textContent = String(s.best);
    this.hudRefs.hint.textContent = s.hint ?? '';
  }

  /* ── 各个界面 ─────────────────────────────────────────────────── */

  showMenu(save: SaveData): void {
    this.roomCode = null;
    this.mount(`
      <div class="panel">
        <h1 class="title">3D <span class="accent">坦克大战</span></h1>
        <p class="subtitle">经典 Battle City 规则的 3D 重制 · 单人战役 / 双人合作</p>
        <div class="actions">
          <button class="btn primary" data-act="solo">开始游戏</button>
          <button class="btn" data-act="lobby">联机合作</button>
        </div>
        <div class="section-title">设置</div>
        <div class="actions">
          <button class="btn small ${save.difficulty === 'classic' ? 'active' : ''}" data-act="diff">难度：${DIFF_LABEL[save.difficulty]}</button>
          <button class="btn small ${save.sfx ? 'active' : ''}" data-act="sfx">音效：${save.sfx ? '开' : '关'}</button>
          <button class="btn small ${save.music ? 'active' : ''}" data-act="music">音乐：${save.music ? '开' : '关'}</button>
        </div>
        <div class="stats">
          <div class="stat"><div class="k">最高分</div><div class="v gold">${save.highScore}</div></div>
          <div class="stat"><div class="k">最远关卡</div><div class="v green">第 ${save.maxLevel} 关</div></div>
          <div class="stat"><div class="k">通关次数</div><div class="v">${save.wins}</div></div>
        </div>
        <div class="section-title">操作</div>
        <div class="keys">
          <div><b>W A S D</b> 前进后退 / 车体转向</div>
          <div><b>鼠标移动</b> 炮塔 360° 瞄准</div>
          <div><b>左键</b> 开火</div>
          <div><b>滚轮</b> 视角远近</div>
          <div><b>Esc</b> 暂停</div>
          <div><b>M</b> 静音</div>
        </div>
        <div class="desktop-only-note">需要用键盘与鼠标操作；点击画面即可锁定鼠标，按 Esc 解锁。</div>
      </div>
    `);
  }

  showLobby(waiting = false): void {
    const codeBlock = this.roomCode
      ? `<div class="room-code">${this.roomCode}</div><div class="status-line ok" id="lobby-status">${
          waiting ? '等待队友输入房间码加入…' : '正在创建房间…'
        }</div>`
      : '';
    this.mount(`
      <div class="panel">
        <h2 class="title" style="font-size:30px">联机<span class="accent">合作</span></h2>
        <p class="subtitle">两人共同守住基地 · 把房间码发给队友即可</p>
        <div class="actions">
          <button class="btn primary" data-act="create">${this.roomCode ? '重新创建房间' : '创建房间'}</button>
        </div>
        ${codeBlock}
        <div class="section-title">加入已有房间</div>
        <div class="input-row">
          <input class="input" id="room-input" maxlength="6" placeholder="房间码" autocomplete="off" spellcheck="false" />
          <button class="btn" data-act="join">加入</button>
        </div>
        <div class="status-line" id="lobby-status"></div>
        <div class="actions" style="margin-top:18px">
          <button class="btn ghost small" data-act="back">返回主菜单</button>
        </div>
      </div>
    `);
  }

  setRoomCode(code: string): void {
    this.roomCode = code;
    this.showLobby(true);
  }

  /** 房间状态提示：等待队友 / 对手已加入 / 连接失败。 */
  setLobbyStatus(text: string, kind: 'normal' | 'ok' | 'error' = 'normal'): void {
    const el = this.screen.querySelector<HTMLElement>('#lobby-status');
    if (!el) return;
    el.textContent = text;
    el.className = `status-line${kind === 'ok' ? ' ok' : kind === 'error' ? ' error' : ''}`;
  }

  showPause(): void {
    this.mount(`
      <div class="panel">
        <h2 class="title" style="font-size:32px">已暂停</h2>
        <p class="subtitle">按 Esc 或点击「继续」回到战场</p>
        <div class="actions">
          <button class="btn primary" data-act="resume">继续</button>
          <button class="btn" data-act="restart">重开本关</button>
          <button class="btn ghost" data-act="quit">返回主菜单</button>
        </div>
      </div>
    `);
  }

  showLevelClear(level: number, score: number, isLast: boolean): void {
    this.mount(`
      <div class="panel">
        <h2 class="title" style="font-size:32px">第 ${level} 关 <span class="accent">完成</span></h2>
        <p class="subtitle">${isLast ? '这是最后一关，准备迎接胜利结算' : '敌人已全部消灭，修整后继续推进'}</p>
        <div class="big-score">${score}</div>
        <div class="actions">
          <button class="btn primary" data-act="next">${isLast ? '查看结算' : '进入第 ' + (level + 1) + ' 关'}</button>
          <button class="btn ghost" data-act="quit">返回主菜单</button>
        </div>
      </div>
    `);
  }

  showGameOver(reason: 'base' | 'lives', score: number, level: number, save: SaveData): void {
    const text = reason === 'base' ? '基地被摧毁了' : '所有坦克都已被击毁';
    const best = Math.max(save.highScore, score);
    this.mount(`
      <div class="panel">
        <h2 class="title" style="font-size:32px;color:var(--warn)">任务失败</h2>
        <p class="reason">${text}</p>
        <div class="big-score">${score}</div>
        <div class="stats">
          <div class="stat"><div class="k">到达关卡</div><div class="v green">第 ${level} 关</div></div>
          <div class="stat"><div class="k">最高分</div><div class="v gold">${best}</div></div>
        </div>
        <div class="actions">
          <button class="btn primary" data-act="restart">再来一局</button>
          <button class="btn ghost" data-act="quit">返回主菜单</button>
        </div>
      </div>
    `);
  }

  showVictory(score: number, save: SaveData): void {
    this.mount(`
      <div class="panel">
        <h2 class="title" style="font-size:34px">全部 <span class="accent">通关</span></h2>
        <p class="subtitle">十关全清，基地安然无恙</p>
        <div class="big-score">${score}</div>
        <div class="stats">
          <div class="stat"><div class="k">最高分</div><div class="v gold">${Math.max(save.highScore, score)}</div></div>
          <div class="stat"><div class="k">通关次数</div><div class="v green">${save.wins}</div></div>
        </div>
        <div class="actions">
          <button class="btn primary" data-act="menu">返回主菜单</button>
        </div>
      </div>
    `);
  }

  /** 鼠标锁定状态变化时更新底部提示。 */
  setPointerLocked(locked: boolean): void {
    const hint = this.hudRefs.hint;
    if (!hint) return;
    hint.textContent = locked
      ? 'WASD 移动 · 鼠标转炮塔 · 左键开火 · 滚轮缩放 · Esc 暂停'
      : '点击画面锁定鼠标后即可瞄准';
    hint.classList.remove('faded');
  }

  setHintFaded(): void {
    this.hudRefs.hint?.classList.add('faded');
  }

  /** 联机等待对手接入时的全屏提示。 */
  showNetStatus(title: string, detail: string): void {
    this.mount(`
      <div class="panel">
        <h2 class="title" style="font-size:30px">${title}</h2>
        <p class="subtitle">${detail}</p>
        <div class="actions"><button class="btn ghost" data-act="back">返回</button></div>
      </div>
    `);
  }
}
