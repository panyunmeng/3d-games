/**
 * 量「平台注入的返回按钮」是否压到游戏自己的控件。
 *
 * 为什么要单独量：mobile-check 只判 canvas 覆盖率与横向溢出，
 * 一个 44px 的固定按钮压在游戏按钮上仍然「canvas 100% 覆盖」→ 判 PASS。
 * 这类遮挡只有把两个 rect 求交才看得见。
 */
import { createRequire } from 'node:module';
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// 本文件在 <平台>/.agents/work/tools/ 下，往上三级即平台根（要 node_modules 里的 ws）。
const PLATFORM = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const WebSocket = createRequire(path.join(PLATFORM, 'noop.js'))('ws');
const BASE = process.argv[2] ?? 'http://127.0.0.1:8099';
const GAMES = [
  ['snake', "/games/snake/", "document.getElementById('start').click()"],
  ['tetris', '/games/tetris/', "document.getElementById('startBtn').click()"],
  ['breakout', '/games/breakout/', "document.getElementById('ovBtn').click()"],
  ['minesweeper', '/games/minesweeper/', "document.querySelector('#levels .level-card').click()"],
  ['sokoban', '/games/sokoban/', ''],
  ['td', '/games/td/', "(async()=>{document.querySelector('[data-act=campaign]').click();await new Promise(r=>setTimeout(r,600));document.querySelector('#level-grid [data-level]:not(.locked)').click();})()"],
  ['tank', '/games/tank/', "document.querySelector('[data-act=solo]').click()"],
];
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const DBG = await new Promise((res) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const profile = path.join(PLATFORM, '.agents/work/tools/_back-profile');
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-extensions', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${DBG}/json/version`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 150)); }

async function open() {
  const list = await (await fetch(`http://127.0.0.1:${DBG}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(list.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 });
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  let id = 0; const pend = new Map();
  ws.on('message', (raw) => { const m = JSON.parse(String(raw)); if (m.id && pend.has(m.id)) { const { resolve, reject } = pend.get(m.id); pend.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const mid = ++id; pend.set(mid, { resolve, reject }); ws.send(JSON.stringify({ id: mid, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  return { ws, send, tid: list.id };
}

const rows = [];
for (const [name, urlPath, enter] of GAMES) {
  const p = await open();
  await p.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true, screenWidth: 375, screenHeight: 812 });
  await p.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await p.send('Page.navigate', { url: BASE + urlPath });
  await new Promise((r) => setTimeout(r, 3200));
  if (enter) { await p.send('Runtime.evaluate', { expression: enter, awaitPromise: true }).catch(() => {}); await new Promise((r) => setTimeout(r, 2500)); }
  const r = await p.send('Runtime.evaluate', { expression: `(() => {
    const back = document.querySelector('[data-platform-back-btn]');
    if (!back) return JSON.stringify({ err: 'no back button' });
    const b = back.getBoundingClientRect();
    // 只看「可点的实体控件」：按钮、链接、输入、以及显式 cursor:pointer 的小元素。
    // 全屏 canvas / 全屏容器与返回按钮必然相交，把它们算进来只会得到 7/7 假失败
    // ——这正是上一版检测器的问题（每个游戏都报 canvas 相交 97×44）。
    const overlaps = [];
    const sel = 'button, a, input, select, textarea, [role=button], [data-tower], [data-act], [data-dir]';
    for (const c of document.querySelectorAll(sel)) {
      if (c === back || c.contains(back)) continue;
      const cs = getComputedStyle(c);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
      if (cs.pointerEvents === 'none') continue;
      const rc = c.getBoundingClientRect();
      if (rc.width < 8 || rc.height < 8) continue;
      if (rc.top > innerHeight || rc.left > innerWidth) continue;
      const ix = Math.min(b.right, rc.right) - Math.max(b.left, rc.left);
      const iy = Math.min(b.bottom, rc.bottom) - Math.max(b.top, rc.top);
      if (ix > 2 && iy > 2) overlaps.push({ t: c.tagName, c: (c.className || '').toString().slice(0, 30), txt: (c.textContent || '').trim().slice(0, 10), ix: Math.round(ix), iy: Math.round(iy), rect: [Math.round(rc.x), Math.round(rc.y), Math.round(rc.width), Math.round(rc.height)] });
    }
    return JSON.stringify({ back: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)], overlaps: overlaps.slice(0, 5) });
  })()`, returnByValue: true });
  const o = JSON.parse(r.result.value);
  const bad = (o.overlaps ?? []).length > 0;
  rows.push({ name, bad });
  console.log(`${bad ? 'OVERLAP' : 'OK     '}  ${name.padEnd(12)} back=${JSON.stringify(o.back)}` + (bad ? `\n          ${JSON.stringify(o.overlaps)}` : ''));
  p.ws.close();
  await fetch(`http://127.0.0.1:${DBG}/json/close/${p.tid}`).catch(() => {});
}
chrome.kill();
await new Promise((r) => setTimeout(r, 300));
await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
console.log(`\n${rows.filter((r) => !r.bad).length}/${rows.length} 个游戏无遮挡`);
process.exit(rows.some((r) => r.bad) ? 1 : 0);
