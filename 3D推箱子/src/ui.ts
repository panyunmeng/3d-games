// UI 层：只管 DOM，不碰 three 与规则。

import type { Level } from './sokoban';

function must<T extends HTMLElement>(sel: string): T {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`缺少 DOM 节点 ${sel}`);
  return el;
}

export interface UiHandlers {
  selectLevel: (id: number) => void;
  prev: () => void;
  next: () => void;
  undo: () => void;
  reset: () => void;
  winRetry: () => void;
  winNext: () => void;
}

export class Ui {
  private readonly list = must<HTMLDivElement>('#level-list');
  private readonly hudId = must<HTMLSpanElement>('#hud-id');
  private readonly hudName = must<HTMLSpanElement>('#hud-name');
  private readonly hudMoves = must<HTMLElement>('#hud-moves');
  private readonly hudPushes = must<HTMLElement>('#hud-pushes');
  private readonly hudLeft = must<HTMLElement>('#hud-left');
  private readonly btnUndo = must<HTMLButtonElement>('#btn-undo');
  private readonly win = must<HTMLDivElement>('#win');
  private readonly winId = must<HTMLElement>('#win-id');
  private readonly winMoves = must<HTMLElement>('#win-moves');
  private readonly winPushes = must<HTMLElement>('#win-pushes');

  private items = new Map<number, HTMLButtonElement>();
  private currentId = -1;

  constructor(private readonly handlers: UiHandlers) {
    must<HTMLButtonElement>('#btn-undo').addEventListener('click', () => handlers.undo());
    must<HTMLButtonElement>('#btn-reset').addEventListener('click', () => handlers.reset());
    must<HTMLButtonElement>('#btn-prev').addEventListener('click', () => handlers.prev());
    must<HTMLButtonElement>('#btn-next').addEventListener('click', () => handlers.next());
    must<HTMLButtonElement>('#win-retry').addEventListener('click', () => handlers.winRetry());
    must<HTMLButtonElement>('#win-next').addEventListener('click', () => handlers.winNext());
  }

  buildLevelList(levels: Level[]): void {
    const frag = document.createDocumentFragment();
    for (const lv of levels) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'level-item';
      btn.dataset.id = String(lv.id);
      const no = document.createElement('span');
      no.className = 'no';
      no.textContent = String(lv.id).padStart(3, '0');
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = lv.name || `${countGoals(lv)} 箱`;
      btn.append(no, nm);
      btn.addEventListener('click', () => this.handlers.selectLevel(lv.id));
      frag.append(btn);
      this.items.set(lv.id, btn);
    }
    this.list.replaceChildren(frag);
  }

  setCurrent(level: Level, solved: ReadonlySet<number>): void {
    if (this.currentId >= 0) this.items.get(this.currentId)?.classList.remove('current');
    this.currentId = level.id;
    const btn = this.items.get(level.id);
    btn?.classList.add('current');
    btn?.scrollIntoView({ block: 'nearest' });

    this.hudId.textContent = `#${level.id}`;
    this.hudName.textContent = level.name || '';
    for (const id of solved) this.items.get(id)?.classList.add('solved');
  }

  /** 箱子剩余数 = 目标点总数 - 已在点上的箱子数，由调用方算好传进来 */
  setStats(moves: number, pushes: number, left: number, canUndo: boolean): void {
    this.hudMoves.textContent = String(moves);
    this.hudPushes.textContent = String(pushes);
    this.hudLeft.textContent = String(left);
    this.btnUndo.disabled = !canUndo;
  }

  showWin(id: number, moves: number, pushes: number, hasNext: boolean): void {
    this.winId.textContent = `#${id}`;
    this.winMoves.textContent = String(moves);
    this.winPushes.textContent = String(pushes);
    must<HTMLButtonElement>('#win-next').disabled = !hasNext;
    this.win.hidden = false;
  }

  hideWin(): void {
    this.win.hidden = true;
  }
}

function countGoals(level: Level): number {
  let n = 0;
  for (let i = 0; i < level.goal.length; i++) n += level.goal[i]!;
  return n;
}
