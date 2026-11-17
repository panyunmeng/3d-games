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
  const btn = [...document.querySelectorAll('button')].find((b) => {
    const r = b.getBoundingClientRect();
    return r.width > 20 && r.height > 12 && getComputedStyle(b).visibility !== 'hidden';
  });
  const btnCs = btn ? getComputedStyle(btn) : null;
  return JSON.stringify({
    tokens: {
      bg: v('--bg'), text: v('--text'), accent: v('--accent'),
      radius: v('--radius'), radiusSm: v('--radius-sm'),
      fontSans: v('--font-sans').slice(0, 90),
      gap2: v('--gap-2'),
    },
    bodyBg: getComputedStyle(document.body).backgroundColor,
    textFont: textFont.slice(0, 90),
    btn: btnCs ? { radius: btnCs.borderRadius, font: btnCs.fontFamily.slice(0, 60) } : null,
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

const DIMENSIONS = [
  ['--bg（页面底色）', (r) => r.tokens?.bg],
  ['--text（正文色）', (r) => r.tokens?.text],
  ['--radius（圆角）', (r) => r.tokens?.radius],
  ['--radius-sm', (r) => r.tokens?.radiusSm],
  ['--gap-2（间距）', (r) => r.tokens?.gap2],
  ['--font-sans', (r) => r.tokens?.fontSans],
  ['实际文字字体', (r) => r.textFont],
  ['body 背景色', (r) => r.bodyBg],
  ['主按钮圆角', (r) => r.btn?.radius ?? '（无按钮）'],
];

console.log(`\n统一设计语言检查 · ${BASE}\n${'='.repeat(74)}\n`);

let unified = 0;
const diffs = [];

for (const [label, pick] of DIMENSIONS) {
  const values = results.map((r) => ({ name: r.name, v: String(pick(r) ?? '（空）') }));
  const uniq = [...new Set(values.map((x) => x.v))];
  const ok = uniq.length === 1;
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
