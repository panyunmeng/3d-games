/**
 * 合集构建：把 7 个游戏的产物收进一个静态根 `build/www/`。
 *
 * 为什么不把产物提交进仓库：
 * 各游戏有自己的仓库与发布节奏，合集里再存一份产物，两边就会各改各的、
 * 迟早对不上。所以产物一律现场从各游戏目录取，仓库只存这份聚合脚本。
 *
 * 为什么不复用各游戏自己的 build.py / pnpm build：
 * 那些脚本产出的文件名与目录布局是给「单游戏独立部署」用的。合集要的是
 * 一个统一根目录下的子路径，所以这里只调用它们产出的成品（或原样拷贝），
 * 再把结果摆到 `games/<id>/`。游戏自身的构建脚本一行都不用改。
 *
 * 用法：
 *   node scripts/build.mjs                 # 全量
 *   node scripts/build.mjs --only=tank     # 只重建一个（调试用）
 *   node scripts/build.mjs --skip-verify   # 跳过体积/路径自检
 */
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GAMES } from '../games.manifest.mjs';

/**
 * 两个根，含义不同，不能混用：
 *   ROOT       本平台仓库根（portal/、server/、build/ 都在它下面）
 *   GAMES_ROOT 7 个游戏所在目录 = 平台根的上一级（与平台平级）
 *
 * 分开命名是为了让「平台的路径」和「游戏的路径」在代码里一眼能区分。
 * 以前只有一个 ROOT 兼任两者，结构重排后那样写必然出错。
 *
 * 游戏位置可由环境变量 GAMES_ROOT 覆盖，方便把平台单独 clone 到别处去打包。
 */
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GAMES_ROOT = process.env.GAMES_ROOT
  ? path.resolve(process.env.GAMES_ROOT)
  : path.resolve(ROOT, '..');
const OUT = path.join(ROOT, 'build', 'www');

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v = 'true'] = a.replace(/^--/, '').split('=');
    return [k, v];
  }),
);
const only = args.get('only');
const skipVerify = args.has('skip-verify');

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
  err: (s) => `\x1b[31m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

const failures = [];
function fail(game, msg) {
  failures.push({ game: game.id, msg });
  console.error(`  ${c.err('✗')} ${msg}`);
}

async function rmrf(p) {
  await fs.rm(p, { recursive: true, force: true });
}

async function copyEntry(src, dest) {
  const st = await fs.stat(src);
  if (st.isDirectory()) {
    await fs.cp(src, dest, { recursive: true });
  } else {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(src, dest);
  }
}

/** 目录总字节数，用于构建报告与体积守卫。 */
async function dirSize(p) {
  let total = 0;
  const stack = [p];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = await fs.readdir(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) {
        try {
          total += (await fs.stat(full)).size;
        } catch {
          /* 并发删除时忽略 */
        }
      }
    }
  }
  return total;
}

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

/* ── 各 kind 的收集方式 ─────────────────────────────────────────── */

/** 已构建好的目录：按清单原样搬文件。 */
async function collectStatic(game, dest) {
  const from = path.join(GAMES_ROOT, game.dir);
  const files = game.files ?? [];
  let n = 0;
  for (const rel of files) {
    const src = path.join(from, rel);
    if (!existsSync(src)) {
      fail(game, `缺少 ${rel}（${game.dir}）`);
      continue;
    }
    await copyEntry(src, path.join(dest, rel));
    n++;
  }
  return `${n} 项原样拷贝`;
}

/** 单文件 HTML：进 games/<id>/index.html。 */
async function collectSingle(game, dest) {
  const from = path.join(GAMES_ROOT, game.dir, game.file);
  if (!existsSync(from)) {
    fail(game, `缺少 ${game.file}（先在 ${game.dir} 里跑 ${game.build ?? 'python build.py'}）`);
    return '';
  }
  await fs.mkdir(dest, { recursive: true });
  await fs.copyFile(from, path.join(dest, 'index.html'));
  const size = (await fs.stat(from)).size;
  return `单文件 ${kb(size)}`;
}

/**
 * Vite 产物：直接搬 dist/ 里的内容。
 *
 * 为什么这里不跑 vite build：那要求每个游戏目录都装好 node_modules，
 * 而合集的价值是「只有源码也能重建部署包」。构建责任留在各游戏仓库里，
 * 合集只负责打包；缺产物时明确报错并指出该去哪跑，不在这里偷偷装依赖。
 */
async function collectVite(game, dest) {
  const from = path.join(GAMES_ROOT, game.dir, game.dist ?? 'dist');
  const indexHtml = path.join(from, 'index.html');
  if (!existsSync(indexHtml)) {
    fail(game, `缺少产物 ${path.relative(GAMES_ROOT, from)}/index.html（先在 ${game.dir} 里跑 ${game.build ?? 'pnpm build'}）`);
    return '';
  }
  await fs.cp(from, dest, { recursive: true });

  if (game.server) {
    const entry = path.join(GAMES_ROOT, game.dir, game.server.entry);
    if (!existsSync(entry)) {
      fail(game, `缺少服务端产物 ${game.server.entry}（先在 ${game.dir} 里跑 ${game.build ?? 'pnpm build'}）`);
    } else {
      // 服务端产物进 games/<id>/server/，合集服务按清单里的 mount 挂它的 WS
      const destServer = path.join(dest, 'server', 'index.mjs');
      await fs.mkdir(path.dirname(destServer), { recursive: true });
      await fs.copyFile(entry, destServer);
    }
  }

  const size = await dirSize(dest);
  return `vite 产物 ${kb(size)}`;
}

/* ── 自检：把「能不能在子路径下跑」变成断言，而不是靠肉眼 ────────── */

/**
 * 检查产物里的引用是否都能在子路径下解析。
 *
 * 依据是事实而非猜测：index.html 里 `src="/assets/..."` 这类以 / 开头的
 * 绝对路径在 /games/tank/ 下会指向域名根，必然 404。这条检查就是为此存在。
 */
async function verifyGame(game, dest) {
  const problems = [];
  const indexHtml = path.join(dest, 'index.html');
  if (!existsSync(indexHtml)) {
    problems.push('没有 index.html');
  } else {
    const html = await fs.readFile(indexHtml, 'utf8');
    const refs = [...html.matchAll(/(?:src|href)\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
    const absolute = refs.filter((r) => r.startsWith('/') && !r.startsWith('//'));
    if (absolute.length) {
      problems.push(`index.html 含绝对路径引用（子路径部署会 404）：${absolute.slice(0, 3).join(', ')}`);
    }
    // 相对引用必须真的存在，否则是构建期漏拷
    for (const rel of refs) {
      if (rel.startsWith('/') || rel.startsWith('data:') || rel.startsWith('http') || rel.startsWith('#')) continue;
      const target = path.resolve(dest, rel.split('?')[0].split('#')[0]);
      if (!existsSync(target)) problems.push(`index.html 引用了不存在的 ${rel}`);
    }
  }

  if (game.kind === 'static') {
    // ES module 工程的入口与被 import 的目录都得在
    for (const must of game.files ?? []) {
      if (!existsSync(path.join(dest, must))) problems.push(`缺少 ${must}`);
    }
  }

  if (game.server) {
    if (!existsSync(path.join(dest, 'server', 'index.mjs'))) problems.push('缺少 server/index.mjs');
  }

  if (problems.length) {
    for (const p of problems) fail(game, p);
    return false;
  }
  return true;
}

/* ── 主流程 ─────────────────────────────────────────────────────── */

const started = Date.now();
console.log(c.bold('\n构建 3D 游戏聚合平台\n'));

/**
 * 开工前先查「游戏在不在」，而不是等逐个收集时才报「缺少某文件」。
 *
 * 为什么值得单列一步：平台与游戏是平级目录，平台单独 clone 出来时
 * GAMES_ROOT 下根本没有任何游戏。此时逐个报「缺少 index.html」
 * 会让人以为是产物没构建，实际是目录根本没 clone——两种病因，
 * 处理方式完全不同。所以这里先一次性说清缺哪些游戏、该 clone 到哪、
 * 目录名必须叫什么（仓库名是拼音，目录名是中文，不写清楚必然放错）。
 */
if (!only) {
  const missingGames = GAMES.filter((g) => !existsSync(path.join(GAMES_ROOT, g.dir)));
  if (missingGames.length) {
    console.error(c.err(`\n✗ ${GAMES_ROOT} 下缺少 ${missingGames.length} 个游戏目录\n`));
    console.error(c.dim('平台与游戏是平级目录，需要先 clone 到平台根的同级位置：\n'));
    const baseName = '3D游戏合集';
    console.error(c.dim(`  mkdir -p "${baseName}" && cd "${baseName}"`));
    console.error(c.dim(`  # 平台自己（本脚本所在仓库）`));
    console.error(c.dim(`  git clone <本仓库地址> "3D游戏聚合平台"`));
    console.error(c.dim(`  # 7 个游戏，注意目录名必须是中文，否则构建找不到`));
    for (const g of GAMES) {
      console.error(c.dim(`  git clone ${g.repo}.git "${g.dir}"${existsSync(path.join(GAMES_ROOT, g.dir)) ? '  # 已存在' : ''}`));
    }
    console.error(c.dim(`\n已在别处时可用环境变量指定：GAMES_ROOT=/path/to/3D游戏合集`));
    console.error(c.dim('clone 完还要各游戏目录里跑一次构建（dist/ 不入库）\n'));
    process.exit(1);
  }
}

// keep 记录「本次真正产出到输出目录里的游戏」，门户页只列它们，
// 避免清单里写了但产物缺失时门户页出现一张点进去 404 的卡片。
const keep = new Map();

console.log(c.dim(`输出目录 ${path.relative(ROOT, OUT)}${only ? `（只重建 ${only}）` : ''}\n`));

// --only 的语义是「只重建这一个」，不是「只保留这一个」。
// 所以只在这一个子目录上做增量替换，其余游戏与门户页必须原样留着；
// 否则调试单个游戏时会把其它六个和门户页一起清掉（门户页只剩一张卡片）。
if (!only) await rmrf(OUT);
await fs.mkdir(path.join(OUT, 'games'), { recursive: true });

const rows = [];
for (const game of GAMES) {
  if (only && game.id !== only) {
    // 未重建的游戏：沿用已有产物，体积照实统计（自检不重复做）
    const dest = path.join(OUT, game.path);
    if (existsSync(path.join(dest, 'index.html'))) {
      const size = await dirSize(dest);
      rows.push({ id: game.id, title: game.title, note: '沿用上次产物', size });
      console.log(`  ${game.id.padEnd(12)} ${game.title.padEnd(6, '　')} ${c.dim('· 沿用')}`);
    }
    continue;
  }
  const dest = path.join(OUT, game.path);
  await rmrf(dest);
  await fs.mkdir(dest, { recursive: true });
  process.stdout.write(`  ${game.id.padEnd(12)} ${game.title.padEnd(6, '　')} `);

  let note = '';
  try {
    if (game.kind === 'static') note = await collectStatic(game, dest);
    else if (game.kind === 'single') note = await collectSingle(game, dest);
    else if (game.kind === 'vite') note = await collectVite(game, dest);
    else fail(game, `未知 kind: ${game.kind}`);
  } catch (err) {
    fail(game, err.message);
  }

  if (!skipVerify) await verifyGame(game, dest);
  const size = await dirSize(dest);
  rows.push({ id: game.id, title: game.title, note, size });
  console.log(note ? `${c.ok('✓')} ${c.dim(note)}` : c.err('✗'));
  keep.set(game.id, game);
}

/* 门户页与封面：门户本身也走一遍注入，保证构建期就能发现模板缺占位符 */
const portalSrc = path.join(ROOT, 'portal', 'index.html');
if (!existsSync(portalSrc)) {
  fail({ id: 'portal' }, '缺少 portal/index.html');
} else {
  const html = await fs.readFile(portalSrc, 'utf8');
  if (!html.includes('<!--GAMES_DATA-->')) {
    fail({ id: 'portal' }, 'portal/index.html 缺少 <!--GAMES_DATA--> 占位符');
  }
  // 构建期把游戏清单烤进门户页：部署包不依赖运行时再读一份 JSON。
  // 判据是「产物目录里真的有 index.html」，而不是本次是否重建过——
  // --only 时没重建的游戏同样要出现在门户页里。
  const available = GAMES.filter((g) => existsSync(path.join(OUT, g.path, 'index.html')));
  const data = JSON.stringify(
    available.map((g) => ({
      id: g.id,
      path: g.path,
      title: g.title,
      subtitle: g.subtitle,
      desc: g.desc,
      tags: g.tags,
      accent: g.accent,
      cover: g.cover,
      repo: g.repo,
      online: Boolean(g.server?.ws),
    })),
  );
  await fs.writeFile(
    path.join(OUT, 'index.html'),
    html.replace('<!--GAMES_DATA-->', `<script>window.__GAMES_DATA__=${data};</script>`),
    'utf8',
  );
  const covers = path.join(ROOT, 'portal', 'covers');
  if (existsSync(covers)) await fs.cp(covers, path.join(OUT, 'covers'), { recursive: true });

  // 封面是门户页唯一的图片依赖，缺一张就是一张空白卡片。构建期逐个核对，
  // 别等浏览器里看到 404 才发现清单写错了扩展名。
  for (const g of GAMES) {
    if (!keep.has(g.id)) continue;
    const f = path.join(OUT, g.cover);
    if (!existsSync(f)) fail(g, `封面缺失 ${g.cover}`);
  }

  console.log(`  ${'portal'.padEnd(12)} ${'门户页'.padEnd(6, '　')} ${c.ok('✓')}`);
}

/* 部署包自述：运维时不用回头翻代码就知道这包是什么、怎么起的 */
await fs.writeFile(
  path.join(OUT, 'games.json'),
  JSON.stringify(
    {
      builtAt: new Date().toISOString(),
      games: rows,
    },
    null,
    2,
  ),
  'utf8',
);

const total = await dirSize(OUT);
const secs = ((Date.now() - started) / 1000).toFixed(1);

console.log(c.dim(`\n${'─'.repeat(58)}`));
console.log(`  合计 ${kb(total)}  用时 ${secs}s  ${c.dim(`(${rows.length}/${GAMES.length} 个游戏)`)}`);

if (failures.length) {
  console.log(c.err(`\n✗ ${failures.length} 项失败：`));
  for (const f of failures) console.log(`   - ${f.game}: ${f.msg}`);
  process.exit(1);
}
console.log(c.ok('\n✓ 构建完成\n'));
