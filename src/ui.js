/**
 * DOM 层：菜单、HUD、结算面板、提示条。
 * 只负责「把状态写进 DOM」和「把点击转成回调」，不持有游戏状态。
 */
import { LEVELS, LEVEL_ORDER } from './config.js';
import { formatTime, formatBest } from './format.js';

export class UI {
  constructor() {
    this.el = {
      hud: document.getElementById('hud'),
      chipLevel: document.getElementById('chip-level'),
      chipAssisted: document.getElementById('chip-assisted'),
      chipBest: document.getElementById('chip-best'),
      clock: document.getElementById('clock'),
      mineCount: document.getElementById('mine-count'),
      progressText: document.getElementById('progress-text'),
      menu: document.getElementById('menu'),
      levels: document.getElementById('levels'),
      seedNote: document.getElementById('seed-note'),
      result: document.getElementById('result'),
      resultKicker: document.getElementById('result-kicker'),
      resultTitle: document.getElementById('result-title'),
      resultTime: document.getElementById('result-time'),
      resultProgress: document.getElementById('result-progress'),
      resultBest: document.getElementById('result-best'),
      resultNote: document.getElementById('result-note'),
      toast: document.getElementById('toast'),
      btnUndo: document.getElementById('btn-undo'),
      btnHint: document.getElementById('btn-hint'),
      btnSound: document.getElementById('btn-sound'),
    };

    this.handlers = {};
    this.levelCards = new Map();
    this.best = {};
    this.toastTimer = 0;

    this.#buildLevels();
    this.#bind();
  }

  #buildLevels() {
    for (const key of LEVEL_ORDER) {
      const lvl = LEVELS[key];
      const btn = document.createElement('button');
      btn.className = 'level-card';
      btn.dataset.level = key;
      btn.type = 'button';
      btn.innerHTML = `
        <span class="level-name">${lvl.name}</span>
        <span class="level-meta">${lvl.note}</span>
        <span class="level-best" data-best>最佳 ${formatBest(this.best[key])}</span>
      `;
      btn.addEventListener('click', () => this.handlers.onLevel?.(key));
      this.el.levels.appendChild(btn);
      this.levelCards.set(key, btn);
    }
  }

  #bind() {
    const click = (id, name) => {
      const node = document.getElementById(id);
      if (!node) return;
      node.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handlers[name]?.();
      });
    };
    click('btn-restart', 'onRestart');
    click('btn-undo', 'onUndo');
    click('btn-hint', 'onHint');
    click('btn-share', 'onShare');
    click('btn-sound', 'onSound');
    click('btn-menu', 'onMenu');
    click('btn-again', 'onAgain');
    click('btn-change', 'onChange');
    click('btn-share-result', 'onShare');
  }

  on(name, fn) {
    this.handlers[name] = fn;
    return this;
  }

  setBestTable(best) {
    this.best = best || {};
    for (const [key, btn] of this.levelCards) {
      const node = btn.querySelector('[data-best]');
      if (node) node.textContent = `最佳 ${formatBest(this.best[key])}`;
    }
    this.el.chipBest.textContent = `最佳 ${formatBest(this.best[this.currentLevel])}`;
  }

  setLevel(key, name) {
    this.currentLevel = key;
    this.el.chipLevel.textContent = name;
    this.el.chipBest.textContent = `最佳 ${formatBest(this.best[key])}`;
  }

  setClock(ms) {
    this.el.clock.textContent = formatTime(ms);
  }

  setMines(n) {
    this.el.mineCount.textContent = String(n);
  }

  setProgress(p) {
    this.el.progressText.textContent = `${Math.round(p * 100)}%`;
  }

  setBest(ms) {
    this.el.chipBest.textContent = `最佳 ${formatBest(ms)}`;
  }

  setAssisted(assisted) {
    this.el.chipAssisted.classList.toggle('hidden', !assisted);
  }

  setUndoEnabled(enabled, left) {
    this.el.btnUndo.disabled = !enabled;
    this.el.btnUndo.title = enabled ? `撤销一步（剩 ${left} 次）` : '撤销已用完';
  }

  setHintEnabled(enabled, left) {
    this.el.btnHint.disabled = !enabled;
    this.el.btnHint.title = enabled ? `提示一格（剩 ${left} 次，不计最佳成绩）` : '提示已用完';
  }

  setSoundMuted(muted) {
    this.el.btnSound.textContent = muted ? '⨯' : '♪';
    this.el.btnSound.classList.toggle('muted', muted);
    this.el.btnSound.title = muted ? '音效已关闭' : '音效已开启';
  }

  showHud(show) {
    this.el.hud.classList.toggle('hidden', !show);
  }

  showMenu(seedNote = '') {
    this.el.menu.classList.remove('hidden');
    if (seedNote) {
      this.el.seedNote.textContent = seedNote;
      this.el.seedNote.classList.remove('hidden');
    } else {
      this.el.seedNote.classList.add('hidden');
    }
  }

  hideMenu() {
    this.el.menu.classList.add('hidden');
  }

  showResult({ won, time, best, progress, assisted, newBest }) {
    this.el.resultKicker.textContent = won ? 'MINE FIELD CLEARED' : 'MISSION FAILED';
    this.el.resultTitle.textContent = won ? '雷区已清空' : '踩到地雷了';
    this.el.resultTitle.classList.toggle('lose', !won);
    this.el.resultTime.textContent = formatTime(time);
    this.el.resultProgress.textContent = `${Math.round(progress * 100)}%`;
    this.el.resultBest.textContent = formatBest(best);

    const notes = [];
    if (newBest) notes.push('新纪录！');
    if (assisted) notes.push('本局用过撤销或提示，不计入最佳成绩');
    if (notes.length) {
      this.el.resultNote.textContent = notes.join(' · ');
      this.el.resultNote.classList.remove('hidden');
    } else {
      this.el.resultNote.classList.add('hidden');
    }

    this.el.result.classList.remove('hidden');
  }

  hideResult() {
    this.el.result.classList.add('hidden');
  }

  toast(text, ms = 1800) {
    const node = this.el.toast;
    node.textContent = text;
    node.classList.remove('hidden');
    // 重启动画：先摘掉再强制回流
    node.classList.remove('show');
    void node.offsetWidth;
    node.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      node.classList.remove('show');
      node.classList.add('hidden');
    }, ms);
  }
}
