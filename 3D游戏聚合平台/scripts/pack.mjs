/**
 * 打包成 fnOS 的 .fpk。
 *
 * 三步：把 build/www 与 server/ 放进 fnapp 包 → 带上运行时依赖 ws →
 * 调 NAS 上的 fnpack 打包。fnpack 只在 fnOS 上装，所以打包也在 NAS 上做：
 * 本机只负责把「待打包的目录树」准备成 tar，上传后由 fnpack 完成封装。
 *
 * 为什么不让 fnpack 一次读本机目录：fnpack 的 build 要求源目录在 fnOS 上
 * 且有正确的属主/权限。走 tar 上传再解包，能保证 Linux 侧的权限位正确，
 * 也顺带让打包过程可复现（同一份 tar 任何时候解出来都一样）。
 *
 * 用法：
 *   node scripts/pack.mjs           # 准备 fnapp 目录树 + 生成 tar.gz
 *   node scripts/pack.mjs --deploy  # 额外：上传到 NAS、fnpack build、安装
 */
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FN = path.join(ROOT, 'fnapp');
const DIST = path.join(ROOT, 'build', 'www');
const STAGE = path.join(ROOT, 'build', 'fnapp');
const TARBALL = path.join(ROOT, 'build', '3d-games-fnapp.tar.gz');

const doDeploy = process.argv.includes('--deploy');

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  err: (s) => `\x1b[31m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

function die(msg) {
  console.error(c.err(`✗ ${msg}`));
  process.exit(1);
}

async function rmrf(p) {
  await fs.rm(p, { recursive: true, force: true });
}

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
      else if (e.isFile()) total += (await fs.stat(full)).size;
    }
  }
  return total;
}

console.log(c.bold('\n打包 fnOS 应用\n'));

/* ── 前置检查：产物必须在 ─────────────────────────────────────── */

if (!existsSync(path.join(DIST, 'index.html'))) {
  die('缺少 build/www/index.html，先跑 node scripts/build.mjs');
}

/* ── 组装 fnapp 目录树 ────────────────────────────────────────── */

await rmrf(STAGE);
await fs.cp(FN, STAGE, { recursive: true });

/**
 * 产物放 app/ 下，不是包根目录下。
 *
 * fnpack 会把 app/ 整个打成 app.tgz，装到系统后再解到 TRIM_APPDEST；
 * 包根目录只放 manifest/config/cmd/wizard/ICON 这些框架文件。
 * 一开始把 www/ 和 server/ 放根目录，打出来的 fpk 只有 39 KB ——
 * fnpack 不认识它们，直接忽略了，装上也起不来，而且不报错。
 * 所以：静态产物 → app/www，服务端 → app/server。
 */
await fs.cp(DIST, path.join(STAGE, 'app', 'www'), { recursive: true });
await fs.cp(path.join(ROOT, 'server'), path.join(STAGE, 'app', 'server'), { recursive: true });

/**
 * 运行时依赖：ws。
 *
 * 坦克的联机服务产物 external 了 ws（它是个带可选原生绑定的包，打进
 * bundle 会出问题）。合集进程 import 它时必须能解析到。
 *
 * 放两处，因为 Node 是从**被 import 的文件自己所在目录**向上找
 * node_modules，而不是从进程入口目录：
 *   1. server/node_modules/ws        —— 给合集自己的 server/tank.mjs
 *   2. www/games/tank/server/node_modules/ws —— 给坦克的 index.mjs
 * 只在 server/ 放一份时，坦克会报 Cannot find package 'ws'（实测踩过）。
 */
const wsSrc = path.join(ROOT, 'node_modules', 'ws');
if (!existsSync(wsSrc)) die('缺少 node_modules/ws，先跑 npm install');

const wsTargets = [
  path.join(STAGE, 'app', 'server', 'node_modules', 'ws'),
  path.join(STAGE, 'app', 'www', 'games', 'tank', 'server', 'node_modules', 'ws'),
];
for (const target of wsTargets) {
  await fs.cp(wsSrc, target, { recursive: true });
}

// ws 的可选原生加速模块（没有也能跑，有则更快）。存在就一起带上。
for (const opt of ['bufferutil', 'utf-8-validate']) {
  const p = path.join(ROOT, 'node_modules', opt);
  if (!existsSync(p)) continue;
  for (const target of wsTargets) {
    await fs.cp(p, path.join(path.dirname(path.dirname(target)), opt), { recursive: true });
  }
}

/* ── 清单与配置自检 ───────────────────────────────────────────── */

const mustExist = [
  'manifest',
  'ICON.PNG',
  'ICON_256.PNG',
  'config/privilege',
  'config/resource',
  'cmd/main',
  'app/ui/config',
  'app/ui/images/icon_64.png',
  'app/ui/images/icon_256.png',
  'app/www/index.html',
  'app/server/index.mjs',
  'app/server/tank.mjs',
];
for (const rel of mustExist) {
  if (!existsSync(path.join(STAGE, rel))) die(`fnapp 缺少必需文件 ${rel}`);
}

// manifest 是键值文件，不是 JSON。核对必填键都在。
const manifest = await fs.readFile(path.join(STAGE, 'manifest'), 'utf8');
for (const key of ['appname', 'version', 'display_name', 'source', 'platform', 'desktop_applaunchname']) {
  if (!new RegExp(`^${key}\\s*=`, 'm').test(manifest)) die(`manifest 缺少 ${key}`);
}

// JSON 配置必须能被解析，否则 fnOS 会静默忽略整个入口
for (const rel of ['config/privilege', 'config/resource', 'app/ui/config', 'wizard/install', 'wizard/config']) {
  const p = path.join(STAGE, rel);
  if (!existsSync(p)) continue;
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(p, 'utf8'));
  } catch (err) {
    die(`${rel} 不是合法 JSON：${err.message}`);
  }

  /**
   * fnpack 的一条实测约束：switch 的 initValue 必须是字符串 "true"/"false"。
   * 写成 JSON 布尔值会让 fnpack 报 "not valid due to JSON format or content
   * validation failure"，而且它会把错误文件报成 config 而不是 wizard，
   * 排查时极容易走错方向。这里在打包前直接纠正，并在日志里说明。
   */
  if (Array.isArray(parsed)) {
    let fixed = false;
    for (const step of parsed) {
      for (const item of step?.items ?? []) {
        if (item?.type === 'switch' && typeof item.initValue === 'boolean') {
          item.initValue = item.initValue ? 'true' : 'false';
          fixed = true;
        }
      }
    }
    if (fixed) {
      await fs.writeFile(p, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
      console.log(`  ${c.dim(`纠正 ${rel}：switch.initValue 改为字符串`)}`);
    }
  }
}

// 生命周期脚本必须可执行。tar 会带上权限位，但源文件忘了 chmod 就会漏。
for (const f of await fs.readdir(path.join(STAGE, 'cmd'))) {
  const p = path.join(STAGE, 'cmd', f);
  const st = await fs.stat(p);
  if ((st.mode & 0o111) === 0) {
    console.log(`  ${c.dim(`补执行位 ${f}`)}`);
    await fs.chmod(p, 0o755);
  }
}

// Linux 换行：脚本带 CRLF 时 /bin/bash 会报 "$'\r': command not found"。
// Windows 上编辑过的文件很容易带 CRLF，这里统一洗一遍。
let crlfFixed = 0;
for (const rel of (await fs.readdir(path.join(STAGE, 'cmd'))).map((f) => `cmd/${f}`)) {
  const p = path.join(STAGE, rel);
  const raw = await fs.readFile(p, 'utf8');
  if (raw.includes('\r\n')) {
    await fs.writeFile(p, raw.replace(/\r\n/g, '\n'), 'utf8');
    crlfFixed++;
  }
}
if (crlfFixed) console.log(`  ${c.dim(`修正 ${crlfFixed} 个脚本的 CRLF 行尾`)}`);

const size = await dirSize(STAGE);
console.log(`  ${c.ok('✓')} 目录树 ${(size / 1024 / 1024).toFixed(2)} MB`);

/* ── 打 tar.gz：交给 NAS 上的 fnpack 封装 ─────────────────────── */

/**
 * 打 tar.gz。为什么不用命令行 tar 而用一个 Python 内联脚本：
 *
 * 1. GNU tar 把 `D:\...` 的冒号当「远程主机」，要 --force-local；能绕过。
 * 2. 但 --mode 是**全局**的，对所有成员生效，没法只给 cmd/ 下的脚本 755。
 *    再想追加一轮就得先不压缩，然后重新压缩——绕且易错。
 * 3. NTFS 不保留 Unix 执行位，源文件 chmod 在 Windows 上是空操作。
 *
 * Python 的 tarfile 能逐成员设 mode 与 owner，一次写对，这是唯一干净的解法。
 */
const py = `
import io, os, sys, tarfile

stage, out = sys.argv[1], sys.argv[2]
EXEC_DIR = os.path.join(stage, 'cmd')

# fnOS 期望应用文件属主为包用户；用 UID/GID 1000 是 fnOS 首个用户的惯例，
# 安装时 fnOS 会按 config/privilege 修正属主，这里主要保证权限位正确。
def add(tf, full, arcname):
    ti = tf.gettarinfo(full, arcname)
    ti.uid = ti.gid = 0
    ti.uname = ti.gname = 'root'
    if os.path.isdir(full):
        ti.mode = 0o755
        tf.addfile(ti)
        return
    # cmd/ 下的生命周期脚本必须可执行，其余文件规范为 644
    ti.mode = 0o755 if os.path.dirname(arcname) == './cmd' else 0o644
    with open(full, 'rb') as fh:
        tf.addfile(ti, fh)

with tarfile.open(out, 'w:gz') as tf:
    for root, dirs, files in os.walk(stage):
        dirs.sort()
        rel = './' + os.path.relpath(root, stage).replace(os.sep, '/')
        if rel == './.':
            rel = '.'
        if rel != '.':
            add(tf, root, rel)
        for f in sorted(files):
            add(tf, os.path.join(root, f), (rel + '/' + f) if rel != '.' else './' + f)
print('ok')
`;
const r = spawnSync('python', ['-c', py, STAGE, TARBALL], { stdio: 'inherit' });
if (r.status !== 0) die('tar 打包失败（Python tarfile）');

const tarSize = (await fs.stat(TARBALL)).size;
console.log(`  ${c.ok('✓')} ${path.relative(ROOT, TARBALL)} ${(tarSize / 1024 / 1024).toFixed(2)} MB`);

if (!doDeploy) {
  console.log(c.dim('\n下一步：node scripts/deploy.mjs 上传并在 NAS 上打包安装\n'));
  process.exit(0);
}

console.log(c.dim('\n交给 scripts/deploy.mjs 完成上传与安装\n'));
