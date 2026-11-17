import { openPage } from './cdp.mjs';

const BASE = 'http://panyunmeng.cn:8081';
const GAMES = [
  ['snake', 4500], ['tetris', 4000], ['breakout', 4000], ['minesweeper', 4000],
  ['sokoban', 4500], ['td', 5500], ['tank', 5000],
];

// 门户页
const p = await openPage(BASE + '/');
await p.goto(BASE + '/', 3500);
const portal = await p.eval(`JSON.stringify({
  prefix: window.__GAMES_PREFIX__ ?? null,
  cards: document.querySelectorAll('.card').length,
  imgs: [...document.querySelectorAll('.shot img')].filter(i=>i.complete&&i.naturalWidth>0).length,
})`);
console.log('PORTAL', portal);
await p.shot('.agents/work/visual/live-portal.png');
console.log('portal errors:', p.logs.filter(l=>l.type==='error'||l.type==='exception').length);
p.close();

for (const [id, wait] of GAMES) {
  const q = await openPage(`${BASE}/games/${id}/`);
  await q.goto(`${BASE}/games/${id}/`, wait);
  const r = await q.eval(`(() => {
    const c = document.querySelector('canvas');
    return JSON.stringify({
      title: document.title,
      canvas: !!c, w: c?.width ?? 0,
      webgl: !!(c && (c.getContext('webgl2') || c.getContext('webgl'))),
    });
  })()`);
  await q.shot(`.agents/work/visual/live-${id}.png`);
  const errs = q.logs.filter(l => l.type === 'error' || l.type === 'exception');
  const o = JSON.parse(r);
  const ok = o.canvas && o.webgl && errs.length === 0;
  console.log(`${ok?'PASS':'FAIL'}  ${id.padEnd(12)} ${o.title} canvas=${o.w} err=${errs.length}`);
  if (errs.length) console.log('   ', errs.slice(0,2).map(e=>e.text.slice(0,120)).join(' | '));
  q.close();
}
