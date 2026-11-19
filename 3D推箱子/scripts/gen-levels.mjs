// 把 assets/Microban.txt（David W. Skinner 的 Microban 关卡集，保留原署名）
// 转成 src/levels.ts。重跑：node scripts/gen-levels.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'assets', 'Microban.txt');
const out = join(root, 'src', 'levels.ts');

const raw = readFileSync(src, 'utf8').replace(/\r\n?/g, '\n');
const lines = raw.split('\n');

const HEADER_RE = /^;\s*(\d+)\s*(?:'([^']*)')?\s*$/;
const levels = [];
let current = null;

for (const line of lines) {
  const m = HEADER_RE.exec(line);
  if (m) {
    if (current) levels.push(current);
    current = { id: Number(m[1]), name: m[2] ?? '', rows: [] };
    continue;
  }
  if (line.startsWith(';')) continue; // 注释
  if (!current) continue; // 首个标题前的说明
  if (line.trim() === '') continue; // 关卡内空行（章节分隔）直接跳过
  current.rows.push(line.replace(/\s+$/, ''));
}
if (current) levels.push(current);

// 说明：行尾空格裁掉，行首空格保留（表示地板/虚空），上下空行已跳过。
const body = levels
  .map((lv) => {
    const rows = JSON.stringify(lv.rows);
    return `  { id: ${lv.id}, name: ${JSON.stringify(lv.name)}, rows: ${rows} },`;
  })
  .join('\n');

const ts = `// 本文件由 scripts/gen-levels.mjs 从 assets/Microban.txt 生成，勿手改。
//
// 关卡来源：Microban（155 关），作者 David W. Skinner
//   E-Mail: sasquatch@bentonrea.com
//   Web:    http://users.bentonrea.com/~sasquatch/sokoban/
// 作者声明：可自由分发，但必须保留署名（原话：may be freely distributed
// provided they remain properly credited）。

export interface RawLevel {
  id: number;
  name: string;
  rows: string[];
}

export const LEVEL_SOURCE = {
  set: 'Microban',
  author: 'David W. Skinner',
  count: ${levels.length},
  note: '关卡可自由分发，保留署名；本工程仅取关卡布局，玩法代码为原创。',
} as const;

export const LEVELS: RawLevel[] = [
${body}
];
`;

writeFileSync(out, ts, 'utf8');
const sizes = levels.map((l) => Math.max(...l.rows.map((r) => r.length)));
console.log(`wrote ${levels.length} levels -> src/levels.ts`);
console.log(`ids ${levels[0].id}..${levels.at(-1).id}, max width ${Math.max(...sizes)}, max height ${Math.max(...levels.map((l) => l.rows.length))}`);
const noPlayer = levels.filter((l) => !l.rows.join('').includes('@') && !l.rows.join('').includes('+'));
if (noPlayer.length) console.log('WARN: no player in', noPlayer.map((l) => l.id));
