/**
 * 统一键位验收：7 个游戏是否都支持 Esc/P 暂停。
 *
 * 为什么要真派发键盘事件而不是 grep 源码：各游戏写法不同（有的读 e.code
 * 有的读 e.key，有的只在特定 phase 生效），只有真按键、真看界面变化才算验证。
 *
 * 用法：
 *   node .agents/work/tools/check-keys.mjs [baseUrl]
 *   默认 http://127.0.0.1:8099，需要无头 Chrome 在 9333 端口。
 *
 * 关键设计：进入对局用「索引点当前可见的第 N 个按钮」而不是文字匹配。
 * 各游戏按钮文字带字间空格（「开 始 游 戏」），塔防还要走
 * 开始战役 → 选难度 → 选关卡 三步。索引稳定得多。
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PLATFORM_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const WebSocket = createRequire(path.join(PLATFORM_ROOT, 'noop.js'))('ws');

const BASE = (process.argv[2] || 'http://127.0.0.1:8099').replace(/\/$/, '');

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
    async goto(u, wait = 3500) {
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

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** code 与 key 都要给：各游戏读了不同字段，只给一个会有游戏收不到。 */
const KEYS = {
  Escape: { code: 'Escape', key: 'Escape' },
  KeyP: { code: 'KeyP', key: 'p' },
  KeyR: { code: 'KeyR', key: 'r' },
  KeyM: { code: 'KeyM', key: 'm' },
};
function press(tab, name) {
  const k = KEYS[name];
  return tab.eval(
    `window.dispatchEvent(new KeyboardEvent('keydown',{code:'${k.code}',key:'${k.key}',bubbles:true,cancelable:true}))`,
  );
}

const clickNthVisible = (n) =>
  `(()=>{const els=[...document.querySelectorAll('button')].filter(e=>e.offsetParent);if(!els[${n}])return false;els[${n}].click();return true;})()`;

const clickFirstLevel = () =>
  `(()=>{const c=[...document.querySelectorAll('[data-level]')].filter(e=>e.offsetParent)[0];if(!c)return false;c.click();return true;})()`;

/**
 * 各游戏的进入流程与暂停判据。
 *   enter: 步骤数组，每步返回 boolean（点到了没有）
 *   pause: 返回 true=已暂停 / false=未暂停 / null=找不到判据元素
 */
const GAMES = [
  {
    id: 'snake',
    name: '贪吃蛇',
    // 可见按钮：0无尽模式 1关卡制 2撞墙 3穿墙 4开始游戏
    enter: [clickNthVisible(4)],
    pause: `(()=>{const e=document.getElementById('pause');return e?getComputedStyle(e).display!=='none':null;})()`,
  },
  {
    id: 'tetris',
    name: '俄罗斯方块',
    // 静音图标虽在 DOM 里但不可见，可见的第 0 个就是开始游戏
    enter: [clickNthVisible(0)],
    pause: `(()=>(document.body.innerText||'').includes('已暂停'))()`,
  },
  {
    id: 'breakout',
    name: '打砖块',
    enter: [clickNthVisible(0)],
    // 它的 overlay 用 opacity 淡出（不是 display:none），且只改 class 不改文本，
    // 所以判据必须是「可见 + 文案是已暂停」两者同时成立
    pause: `(()=>{const o=document.getElementById('overlay');if(!o)return null;
      const vis=getComputedStyle(o).opacity!=='0';
      const t=(o.textContent||'').replace(/\s+/g,'');
      return vis && t.includes('已暂停');})()`,
  },
  {
    id: 'minesweeper',
    name: '扫雷',
    enter: [clickNthVisible(0)], // 难度卡也是 button
    pause: `(()=>{const e=document.getElementById('pause');return e?getComputedStyle(e).display!=='none':null;})()`,
  },
  {
    id: 'sokoban',
    name: '推箱子',
    enter: [], // 打开即在对局中
    pause: `(()=>{const e=document.getElementById('pause');return e?e.hidden===false:null;})()`,
  },
  {
    id: 'td',
    name: '塔防',
    enter: [clickNthVisible(0), clickNthVisible(1), clickFirstLevel()],
    pause: `(()=>{const e=document.getElementById('ov-pause');return e?getComputedStyle(e).display!=='none':null;})()`,
  },
  {
    id: 'tank',
    name: '坦克大战',
    enter: [clickNthVisible(0)],
    pause: `(()=>(document.body.innerText||'').includes('已暂停'))()`,
  },
];

const rows = [];
for (const g of GAMES) {
  const tab = await openTab(`${BASE}/games/${g.id}/`);
  await tab.goto(`${BASE}/games/${g.id}/`);
  let note = '';

  for (let i = 0; i < (g.enter ?? []).length; i++) {
    const ok = await tab.eval(g.enter[i]);
    await wait(1300);
    if (!ok) note = `第 ${i + 1} 步未点到`;
  }

  const before = await tab.eval(g.pause);
  await press(tab, 'KeyP');
  await wait(800);
  const afterP = await tab.eval(g.pause);
  await press(tab, 'KeyP'); // 恢复，便于判断是「切换」而非「一次性」
  await wait(600);
  const afterBack = await tab.eval(g.pause);

  let verdict;
  if (before === null || afterP === null) verdict = 'SKIP';
  else if (before === false && afterP === true && afterBack === false) verdict = 'PASS';
  else verdict = `FAIL(${before}→${afterP}→${afterBack})`;

  rows.push({ name: g.name, verdict, note });
  tab.close();
}

console.log(`\n键位验收 · ${BASE}\n${'='.repeat(60)}\n`);
let pass = 0;
let fail = 0;
let skip = 0;
for (const r of rows) {
  const mark = r.verdict === 'PASS' ? '✓' : r.verdict === 'SKIP' ? '−' : '✗';
  if (r.verdict === 'PASS') pass++;
  else if (r.verdict === 'SKIP') skip++;
  else fail++;
  console.log(`${mark} ${r.name.padEnd(8)} ${r.verdict}${r.note ? '  ' + r.note : ''}`);
}
console.log(`\n通过 ${pass}  失败 ${fail}  无法判定 ${skip}`);
console.log('判据：进入对局 → 按 P 暂停界面出现 → 再按 P 恢复（三态都对才算 PASS）。');
console.log('SKIP = 检查器不认识该游戏暂停 UI，需人工确认，不算通过。\n');
process.exit(fail > 0 || skip > 0 ? 1 : 0);
