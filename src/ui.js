/**
 * UI 层：菜单 / HUD / 暂停 / 结算，全部是 DOM，不参与 WebGL 渲染。
 *
 * 为什么 HUD 用 DOM 而不是画进 canvas：文字清晰度、响应式、无障碍都更好，
 * 也免得为了几个数字去写字体纹理。
 */
import { MODE_LABEL, WALL_LABEL, ITEM_TYPES, ENDLESS_TUNING } from './config.js';
import { speedFactor } from './logic.js';

const BEST_KEY = 'jelly-snake-best-v1';

const $ = (id) => document.getElementById(id);

function loadBest() {
  try {
    return JSON.parse(localStorage.getItem(BEST_KEY) || '{}') || {};
  } catch {
    return {};
  }
}
function saveBest(map) {
  try { localStorage.setItem(BEST_KEY, JSON.stringify(map)); } catch { /* ignore */ }
}

export function createUI(handlers = {}) {
  const el = {
    hud: $('hud'),
    menu: $('menu'),
    pause: $('pause'),
    over: $('over'),
    banner: $('banner'),
    loading: $('loading'),
    score: $('score'),
    chipMode: $('chip-mode'),
    chipWall: $('chip-wall'),
    chipSpeed: $('chip-speed'),
    chipBest: $('chip-best'),
    progress: $('progress'),
    progressBar: $('progress-bar'),
    progressText: $('progress-text'),
    timer: $('timer'),
    timerBar: $('timer-bar'),
    timerText: $('timer-text'),
    itemSlots: $('item-slots'),
    menuBest: $('menu-best'),
    modeHint: $('mode-hint'),
    wallHint: $('wall-hint'),
    overTitle: $('over-title'),
    overReason: $('over-reason'),
    overScore: $('over-score'),
    overBest: $('over-best'),
    overEaten: $('over-eaten'),
  };

  let best = loadBest();
  const selection = { mode: 'endless', wall: 'classic' };
  let bannerTimer = 0;

  /* ---------- 菜单 ---------- */
  const hints = {
    mode: {
      endless: '没有关卡边界：速度随吃到的食物数提档，障碍会逐步出现，一直玩到失手。',
      level: '每关有目标食物数与倒计时：过关按剩余时间加分，障碍逐关增加，速度逐关加快。',
    },
    wall: {
      classic: '撞到四周边框立即结束，只能用走位把蛇盘起来。',
      wrap: '从一侧穿出、对侧进入，永远不会撞墙；但撞到自己或障碍照样结束。',
    },
  };

  function renderSeg(group) {
    document.querySelectorAll(`.seg[data-group="${group}"] .seg-btn`).forEach((btn) => {
      btn.classList.toggle('on', btn.dataset.value === selection[group]);
    });
  }
  function renderHints() {
    el.modeHint.textContent = hints.mode[selection.mode];
    el.wallHint.textContent = hints.wall[selection.wall];
    const b = best[bestKey()] || 0;
    el.menuBest.textContent = b > 0 ? `本规则最高分：${b}` : '还没有记录，来开第一局';
  }
  const bestKey = () => `${selection.mode}:${selection.wall}`;

  document.querySelectorAll('.seg .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const group = btn.closest('.seg').dataset.group;
      selection[group] = btn.dataset.value;
      renderSeg(group);
      renderHints();
      handlers.onSelect?.(selection);
    });
  });

  $('start').addEventListener('click', () => handlers.onStart?.({ ...selection }));
  $('resume').addEventListener('click', () => handlers.onResume?.());
  $('quit').addEventListener('click', () => handlers.onQuit?.());
  $('again').addEventListener('click', () => handlers.onAgain?.());
  $('to-menu').addEventListener('click', () => handlers.onQuit?.());

  renderSeg('mode');
  renderSeg('wall');
  renderHints();

  /* ---------- 显示切换 ---------- */
  function showMenu() {
    el.menu.classList.remove('hidden');
    el.pause.classList.add('hidden');
    el.over.classList.add('hidden');
    el.hud.classList.add('hidden');
    el.loading.classList.add('hidden');
    renderHints();
  }
  function showPlaying() {
    el.menu.classList.add('hidden');
    el.pause.classList.add('hidden');
    el.over.classList.add('hidden');
    el.hud.classList.remove('hidden');
  }
  function showPause() {
    el.pause.classList.remove('hidden');
  }
  function hidePause() {
    el.pause.classList.add('hidden');
  }
  function showOver(state, newBest) {
    el.over.classList.remove('hidden');
    const reasonText = {
      wall: '撞上了边框',
      self: '咬到了自己的身体',
      obstacle: '撞上了障碍块',
      time: '时间耗尽',
    }[state.reason] || '游戏结束';
    el.overTitle.textContent = state.mode === 'level' ? `止步第 ${state.level} 关` : '游戏结束';
    el.overReason.textContent = newBest ? `${reasonText} · 新纪录！` : reasonText;
    el.overScore.textContent = state.score;
    el.overBest.textContent = best[bestKey()] || state.score;
    el.overEaten.textContent = state.totalEaten;
  }
  function hideOver() {
    el.over.classList.add('hidden');
  }

  /* ---------- 最高分 ---------- */
  function submitScore(state, key = bestKey()) {
    const prev = best[key] || 0;
    if (state.score > prev) {
      best[key] = state.score;
      saveBest(best);
      return true;
    }
    return false;
  }

  /* ---------- HUD ---------- */
  let lastItemSig = '';
  function update(state, dt) {
    el.score.textContent = state.score;
    el.chipMode.textContent = MODE_LABEL[state.mode];
    el.chipWall.textContent = WALL_LABEL[state.wall];
    el.chipSpeed.textContent = `速度 ${speedFactor(state).toFixed(1)}×`;
    el.chipBest.textContent = `最高 ${Math.max(best[bestKey()] || 0, state.score)}`;

    if (state.mode === 'level') {
      const p = Math.min(1, state.eaten / state.levelTarget);
      el.progressBar.style.width = `${p * 100}%`;
      el.progressText.textContent = `第 ${state.level} 关 · ${state.eaten}/${state.levelTarget}`;
      el.timer.classList.remove('hidden');
      const secs = Math.max(0, state.levelTimeLeft / 1000);
      // 分母留 12s 余量：吃食物会补时间，否则进度条一开始就顶满、再也看不出变化
      const total = Math.max(1, (state.levelTimeLimit + 12000) / 1000);
      el.timerBar.style.width = `${Math.min(100, (secs / total) * 100)}%`;
      el.timerText.textContent = `${secs.toFixed(1)}s`;
      el.timer.classList.toggle('low', secs <= 6);
    } else {
      const stage = Math.floor(state.totalEaten / ENDLESS_TUNING.foodsPerStep);
      const into = state.totalEaten % ENDLESS_TUNING.foodsPerStep;
      el.progressBar.style.width = `${(into / ENDLESS_TUNING.foodsPerStep) * 100}%`;
      el.progressText.textContent = `已吃 ${state.totalEaten} · 速度档 ${stage + 1}`;
      el.timer.classList.add('hidden');
    }

    // 道具剩余时间：只在内容变化时重排 DOM
    const active = [];
    if (state.timers.speed > 0) active.push(['speed', `加速 ${(state.timers.speed / 1000).toFixed(1)}s`]);
    if (state.timers.slow > 0) active.push(['slow', `减速 ${(state.timers.slow / 1000).toFixed(1)}s`]);
    if (state.timers.double > 0) active.push(['double', `双倍 ${(state.timers.double / 1000).toFixed(1)}s`]);
    const sig = active.map(([k, t]) => `${k}:${t.slice(0, -1)}`).join('|');
    if (sig !== lastItemSig) {
      lastItemSig = sig;
      el.itemSlots.innerHTML = active
        .map(([k, t]) => `<span class="item-slot ${k}">${t}</span>`)
        .join('');
    }
  }

  /* ---------- 横幅 ---------- */
  function banner(title, sub = '', ms = 1400) {
    el.banner.innerHTML = `<b>${title}</b>${sub ? `<span>${sub}</span>` : ''}`;
    el.banner.classList.remove('hidden');
    requestAnimationFrame(() => el.banner.classList.add('show'));
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => {
      el.banner.classList.remove('show');
      setTimeout(() => el.banner.classList.add('hidden'), 220);
    }, ms);
  }

  return {
    selection,
    showMenu,
    showPlaying,
    showPause,
    hidePause,
    showOver,
    hideOver,
    submitScore,
    update,
    banner,
    bestFor: (mode, wall) => best[`${mode}:${wall}`] || 0,
    setLoading(v) { el.loading.classList.toggle('hidden', !v); },
  };
}
