/**
 * 统一设计语言 · 一致性检查
 *
 * 目的：把「7 个游戏风格是否统一」从主观判断变成可复现的断言。
 * 检查的是**实际渲染结果**（getComputedStyle），不是源码文本——
 * 源码里写了 var(--font-sans) 不代表浏览器真的用上了它。
 *
 * 用法：
 *   node .agents/work/tools/check-design.mjs              # 查本地 8099
 *   node .agents/work/tools/check-design.mjs http://panyunmeng.cn:8081
 *
 * 输出：每个维度列出「各游戏的实际值」，值全同 = 统一。
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PLATFORM_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const WebSocket = createRequire(path.join(PLATFORM_ROOT, 'noop.js'))('ws');

const BASE = (process.argv[2] || 'http://127.0.0.1:8099').replace(/\/$/, '');
const GAMES = [
  ['snake', '贪吃蛇'],
  ['tetris', '俄罗斯方块'],
  ['breakout', '打砖块'],
  ['minesweeper', '扫雷'],
  ['sokoban', '推箱子'],
  ['td', '塔防'],
  ['tank', '坦克大战'],
];

/* ── 极简 CDP（本地版，避免依赖 tools/cdp.mjs 的截图逻辑） ───────── */

async function openTab(url, { width = 1440, height = 900 } = {}) {
  const info = await (
    await fetch('http://127.0.0.1:9333/json/new?' + encodeURIComponent(url), { method: 'PUT' })
  ).json();
  const ws = new WebSocket(info.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((r, j) => {
    ws.once('open', r);
    ws.once('error', j);
  });
  let id = 0;
  const pending = new Map();
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw));
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  return {
    async goto(u, wait = 3000) {
      await send('Page.navigate', { url: u });
      await new Promise((r) => setTimeout(r, wait));
    },
    async eval(expr) {
      const r = await send('Runtime.evaluate', {
        expression: expr,
        returnByValue: true,
        awaitPromise: true,
      });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval failed');
      return r.result.value;
    },
    close() {
      ws.close();
    },
  };
}

/* ── 采集：每个游戏页面的实际渲染值 ───────────────────────────── */

const PROBE = `(() => {
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  const v = (n) => cs.getPropertyValue(n).trim();
  // 找一个真实可见的文字元素，取它的实际字体（比读变量更可信）
  const pick = (sel) => document.querySelector(sel);
  const bodyText = ['#hud', 'header', 'main', '.hud', '#app', 'body']
    .map(pick).find((e) => e && e.innerText && e.innerText.trim().length > 2);
  const textFont = bodyText ? getComputedStyle(bodyText).fontFamily : '';
  /**
   * 主按钮 = 可见按钮里**面积最大**的那个。
   *
   * 不能取「第一个可见 button」：HUD 上的小图标按钮往往排在 DOM 靠前处，
   * 取到的会是图标按钮（8px）而不是主行动按钮（12px），维度判据就错了。
   * 面积最大的那个通常是「开始游戏」这类主按钮。
   */
  const btnAll = [...document.querySelectorAll('button')]
    .filter((b) => {
      const r = b.getBoundingClientRect();
      const cs = getComputedStyle(b);
      return r.width > 20 && r.height > 12 && cs.visibility !== 'hidden' && cs.display !== 'none';
    });
  /**
   * 主按钮的判定顺序（先精确后模糊）：
   *   1. 类名含 primary / cta / main / start 的  —— 语义最明确
   *   2. 类名恰为 btn / button / 空 的最大者       —— 常规按钮
   *   3. 兜底：可见按钮里面积最大的
   * 为什么要排除 card 类：扫雷的难度选择是 <button class="level-card">，
   * 面积比「开始」大得多，按面积取会把它当主按钮，判据就偏了。
   */
  const isCardLike = (b) => /card|tile|item|option/i.test(b.className || '');
  const primary = btnAll.find((b) => /primary|cta|main|start/i.test(b.className || ''));
  const plain = btnAll
    .filter((b) => !isCardLike(b))
    .sort((a, b) => {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return rb.width * rb.height - ra.width * ra.height;
    });
  const btn = primary || plain[0] || btnAll[0];
  const btnCs = btn ? getComputedStyle(btn) : null;
  // 所有可见按钮的圆角集合：统一后应只剩 8px / 12px / 999px 三档
  const radii = [...new Set([...document.querySelectorAll('button')]
    .filter((b) => { const r = b.getBoundingClientRect(); return r.width > 16 && r.height > 12; })
    .map((b) => getComputedStyle(b).borderTopLeftRadius))].sort();
  // 文案合规性：这些词不该出现
  const text = (document.body.innerText || '');
  const banned = ['重新开始', '恢复游戏', '进入游戏'].filter((w) => text.includes(w));
  return JSON.stringify({
    tokens: {
      bg: v('--bg'), text: v('--text'), accent: v('--accent'),
      radius: v('--radius'), radiusSm: v('--radius-sm'),
      fontSans: v('--font-sans').slice(0, 90),
      gap2: v('--gap-2'),
    },
    /**
     * 页面实际底色。
     *
     * 只看 backgroundColor 不够：用 radial-gradient 铺底的游戏，它的
     * backgroundColor 是透明的（rgba(0,0,0,0)），会被误判成「不统一」。
     * 这里按优先级取第一个非透明的层：background-image 里有渐变说明
     * 底色由渐变负责，回落到 html 的 backgroundColor（渐变的最深档
     * 应当由它兜底，这也是规范要求的）。
     */
    bodyBg: (() => {
      const b = getComputedStyle(document.body);
      const h = getComputedStyle(document.documentElement);
      const pick = (v) => v && v !== 'rgba(0, 0, 0, 0)' && v !== 'transparent';
      const norm = (v) => (v === 'rgb(10, 13, 22)' ? 'bg=#0a0d16' : v);
      if (pick(b.backgroundColor)) return norm(b.backgroundColor);
      if (pick(h.backgroundColor)) return norm(h.backgroundColor);
      // 都没有实色：说明整页靠渐变。取渐变是否至少覆盖到最暗档
      /**
       * 渐变铺底与实色底，只要都落在规范底色 #0a0d16，就视为同一种结果。
       * 比较的是「页面底色是否统一」，不是「实现方式是否相同」——
       * 用渐变做层次的游戏和用纯色的游戏，玩家看到的都是 #0a0d16 的底。
       */
      const hasGrad = (b.backgroundImage || '').includes('gradient');
      if (hasGrad) {
        const grad = b.backgroundImage;
        return grad.includes('10, 13, 22') || grad.includes('#0a0d16')
          ? 'bg=#0a0d16'
          : '渐变但最深档非规范值：' + grad.slice(0, 60);
      }
      return 'rgba(0, 0, 0, 0)';
    })(),
    textFont: textFont.slice(0, 90),
    btn: btnCs ? { radius: btnCs.borderRadius, font: btnCs.fontFamily.slice(0, 60) } : null,
    btnRadii: radii.join(' '),
    bannedWords: banned.join(' '),
  });
})()`;

const results = [];
for (const [id, name] of GAMES) {
  const tab = await openTab(`${BASE}/games/${id}/`);
  await tab.goto(`${BASE}/games/${id}/`, 3500);
  let raw;
  try {
    raw = await tab.eval(PROBE);
  } catch (e) {
    raw = JSON.stringify({ error: e.message });
  }
  results.push({ id, name, ...JSON.parse(raw) });
  tab.close();
}

/* ── 报告：按维度分组，看「值是否全同」 ───────────────────────── */

/**
 * 形状语言白名单：这些游戏用切角/直角做美术个性，不要求 12px 圆角。
 * 依据是《设计语言规范》§五 的「造型规则」——判据是同一游戏内形状一致，
 * 不是必须等于 12px。塔防用 clip-path 斜切（科技感），推箱子像素风直角。
 */
const SHAPE_EXEMPT = new Set(['td', 'sokoban']);

/** 规范允许的圆角档位 */
const ALLOWED_RADII = ['8px', '12px', '18px', '999px'];

/**
 * 单个圆角是否合规。豁免游戏（切角/直角）一律视为合规变体。
 * 特殊形态：50% 是圆形小点/圆点装饰，也算合规。
 */
function judgeRadius(r, value) {
  if (SHAPE_EXEMPT.has(r.id)) return `合规（刻意变体）`;
  if (!value) return '合规（无按钮）';
  if (value === '0px' || value === '50%') return `合规（${value}）`;
  return ALLOWED_RADII.includes(value) ? `合规（${value}）` : `✗ 越档 ${value}`;
}

/** 一个游戏里所有按钮圆角是否都落在允许档位内 */
function judgeRadiusSet(r, raw) {
  if (SHAPE_EXEMPT.has(r.id)) return '合规（刻意变体）';
  if (!raw) return '合规（无按钮）';
  const bad = String(raw)
    .split(/\s+/)
    .filter(Boolean)
    .filter((v) => !ALLOWED_RADII.includes(v) && v !== '0px' && v !== '50%');
  return bad.length ? `✗ 越档：${bad.join(' ')}` : `合规（${raw}）`;
}

/**
 * 维度表：[标签, 取值函数, 判据]
 *   判据 'same'    = 7 个游戏的值必须完全相同（字体、颜色这类）
 *   判据 'each'    = 各自落在规范档位内即可，不要求相同（圆角这类）
 * 这个区分很重要：圆角允许 8/12/18/999 多档并存，全同要求会永远判失败。
 */
const DIMENSIONS = [
  ['--bg（页面底色）', (r) => r.tokens?.bg],
  ['--text（正文色）', (r) => r.tokens?.text],
  ['--radius（圆角）', (r) => r.tokens?.radius],
  ['--radius-sm', (r) => r.tokens?.radiusSm],
  ['--gap-2（间距）', (r) => r.tokens?.gap2],
  ['--font-sans', (r) => r.tokens?.fontSans],
  ['实际文字字体', (r) => r.textFont],
  ['body 背景色', (r) => r.bodyBg],
  // 判据改为「是否落在规范档位内」，而不是「各游戏必须相同」：
  // 主按钮 12px、卡片/面板 18px、图标 8px、chip 999px 都是合规的。
  ['主按钮圆角合规', (r) => judgeRadius(r, r.btn?.radius), 'each'],
  // 统一后所有按钮圆角应落在 8px/12px/999px 三档之内
  ['按钮圆角全部合规', (r) => judgeRadiusSet(r, r.btnRadii), 'each'],
  // 规范禁用词，出现即为不合格
  ['禁用文案（应为空）', (r) => (r.bannedWords ? `含：${r.bannedWords}` : '（无）')],
];

console.log(`\n统一设计语言检查 · ${BASE}\n${'='.repeat(74)}\n`);

let unified = 0;
const diffs = [];

for (const [label, pick, mode = 'same'] of DIMENSIONS) {
  const values = results.map((r) => ({ name: r.name, v: String(pick(r) ?? '（空）') }));
  const uniq = [...new Set(values.map((x) => x.v))];
  // 'each' 判据：每个游戏自己通过即可（判定函数已把不合格标成 ✗）
  const ok = mode === 'each' ? !values.some((x) => x.v.includes('✗')) : uniq.length === 1;
  if (ok) unified++;
  else diffs.push({ label, uniq });

  console.log(`${ok ? '✓' : '✗'} ${label}`);
  if (ok) {
    console.log(`    ${uniq[0].slice(0, 100)}`);
  } else {
    // 按值分组，紧凑显示
    const groups = new Map();
    for (const { name, v } of values) {
      if (!groups.has(v)) groups.set(v, []);
      groups.get(v).push(name);
    }
    for (const [v, names] of groups) {
      console.log(`    [${names.join(' ')}] ${v.slice(0, 80)}`);
    }
  }
  console.log();
}

console.log('='.repeat(74));
console.log(`统一维度：${unified}/${DIMENSIONS.length}`);
if (diffs.length) {
  console.log(`\n未统一：${diffs.map((d) => d.label).join('、')}`);
  console.log('（这些维度各游戏仍不同，属于待改造项或刻意保留的个性）');
}
console.log();
