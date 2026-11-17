/**
 * 把 fnapp 部署到 NAS：上传 tar → fnpack build 成 .fpk → 安装。
 *
 * 为什么打包在 NAS 上做而不是本机：fnpack 只装在 fnOS 上（/usr/local/bin/fnpack），
 * 它负责 fpk 的封装与校验（checksum、目录结构、manifest 合规）。本机没有它，
 * 自己拼一个 fpk 等于猜格式，装不上还看不出为什么。
 *
 * 用法：
 *   node scripts/deploy.mjs              # 上传 + 打包，产物留在 NAS 上
 *   node scripts/deploy.mjs --install    # 额外：调用 appcenter 安装
 *   node scripts/deploy.mjs --port=8081  # 安装/重装后指定端口
 */
import fs from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TARBALL = path.join(ROOT, 'build', '3d-games-fnapp.tar.gz');

// SSH 包装器在 NAS 维护工作区里，credential 由它注入，本脚本不持有任何口令。
// 路径必须用正斜杠：Node 的 spawnSync 不经过 shell，Windows 反斜杠在
// 参数里会被当转义序列吃掉（实测 "D:\My..." 变成 "D:My..." 而报找不到脚本）。
const SSH_RUN = 'D:/MyProjects/W.FNOS维护/ssh-run.ps1';
const REMOTE_STAGE = '/home/panyunmeng/3dgames-build';

const args = process.argv.slice(2);
const doInstall = args.includes('--install');
const port = args.find((a) => a.startsWith('--port='))?.split('=')[1] ?? '8081';

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

if (!existsSync(TARBALL)) die('缺少 build/3d-games-fnapp.tar.gz，先跑 node scripts/pack.mjs');
if (!existsSync(SSH_RUN)) die(`找不到 SSH 包装器 ${SSH_RUN}`);

/**
 * 走 NAS 维护工作区的 ssh-run.ps1，而不是直接调 ssh。
 *
 * 原因：那台 NAS 只接受口令认证，口令按全局约定只能留在既有的
 * .sshpass_askpass.cmd 载体里。ssh-run.ps1 负责注入口令并把脚本
 * base64 发过去执行，本仓库因此不需要任何凭据，也不会把口令写进日志。
 *
 * 但这个包装器有个已实测的硬上限：脚本正文超过约 10～60 KB 后，
 * pwsh 里 `& ssh ...` 会报 "StandardErrorEncoding is only supported
 * when standard error is redirected" 而失败。所以只有小脚本走它，
 * 传大文件用下面的 putFile（base64 经 stdin 直接喂给远端 base64 -d）。
 */
async function remote(script, label) {
  const tmp = path.join(ROOT, 'build', `.remote-${Date.now()}.sh`);
  // 远端脚本必须是 LF 且 UTF-8 无 BOM，否则 bash 会报 $'\r'
  await fs.writeFile(tmp, script.replace(/\r\n/g, '\n'), 'utf8');
  console.log(c.dim(`  → ${label}`));

  // 经 Git Bash 调 pwsh：spawnSync 直接拉 pwsh 时，它的编码选项会与
  // Node 的管道冲突（同上那条报错），经过 bash 一层就没有这个冲突。
  const cmd = `cd '/d/MyProjects/W.FNOS维护' && pwsh -NoProfile -File ./ssh-run.ps1 -Script '${tmp.split(path.sep).join('/')}'`;
  const r = spawnSync('bash', ['-c', cmd], { encoding: 'utf8' });

  await fs.rm(tmp, { force: true });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  if (r.status !== 0) {
    die(`${label} 失败（退出码 ${r.status}）\n${out.slice(-1500)}`);
  }
  return out;
}

/**
 * 传文件：base64 经 stdin 直接喂给远端的 base64 -d。
 *
 * 为什么不用 scp：那台 NAS 只认口令；为什么不用 ssh-run.ps1：它有正文
 * 体积上限（见上）。走 stdin 管道同时绕开这两点，且本机不需要写任何
 * 中间临时文件到远端。
 *
 * askpass 垫片放在纯 ASCII 目录：ssh.exe 用 posix_spawnp 打开 askpass，
 * 含中文的路径会 "No such file or directory"（NAS 维护工作区踩过）。
 */
function putFile(localPath, remotePath) {
  console.log(c.dim(`  → 上传 ${path.basename(localPath)}`));

  /**
   * 复用 scripts/ssh-put.sh，而不是在这里内联拼 shell。
   *
   * 内联版本踩过坑：口令含 # 与 *，用 printf '...%s...' 拼进模板字符串时，
   * Node 的转义与 printf 的格式符互相干扰，传过去的口令被打断，ssh 认证
   * 仍能过（走的是已有连接复用）但 base64 只写了 25 KB 就停了——表现为
   * 「上传成功但字节数不符」，比直接失败更难查。放成独立脚本后行为固定，
   * 且这个脚本本身可以单独跑、单独验。
   */
  const helper = path.join(ROOT, 'scripts', 'ssh-put.sh');
  if (!existsSync(helper)) die(`缺少 ${helper}`);
  const r = spawnSync('bash', [helper.split(path.sep).join('/'), localPath.split(path.sep).join('/'), remotePath], {
    encoding: 'utf8',
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  if (r.status !== 0) die(`上传失败（退出码 ${r.status}）\n${out.slice(-800)}`);

  const sent = parseSize(out);
  const local = statSync(localPath).size;
  if (sent !== local) die(`上传字节数不符：本地 ${local}，远端 ${sent ?? '未读到'}`);
  console.log(`  ${c.ok('✓')} ${(local / 1024 / 1024).toFixed(2)} MB 校验一致`);
  return sent;
}

/**
 * 从 ssh 输出里取远端字节数。
 *
 * 不能对整段输出 match(/\d+/)：ssh 的 "Warning: Permanently added
 * 'panyunmeng.cn' ..." 这类提示里就带数字，取到的是它而不是真正的字节数
 * ——这条坑让「上传其实成功」被判成「字节数不符」，白查了一轮。
 * 远端命令末尾是 `wc -c`，所以取**最后一行纯数字**才是对的。
 */
function parseSize(out) {
  const lines = out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^\d+$/.test(l));
  return lines.length ? Number(lines[lines.length - 1]) : null;
}

console.log(c.bold('\n部署到 NAS\n'));

/* ── 1. 探活 ──────────────────────────────────────────────────── */

const probe = await remote(
  `echo "HOST=$(hostname)"
   echo "FNOS=$(cat /usr/trim/etc/version 2>/dev/null || echo unknown)"
   command -v fnpack >/dev/null && echo "FNPACK=$(fnpack --help 2>&1 | head -1)" || echo "FNPACK=missing"
   test -x /var/apps/nodejs_v24/target/bin/node && echo "NODE=$(/var/apps/nodejs_v24/target/bin/node -v)" || echo "NODE=missing"`,
  '探测 NAS 环境',
);
console.log(probe.split('\n').map((l) => `    ${l}`).join('\n'));
if (probe.includes('FNPACK=missing')) die('NAS 上没有 fnpack，无法打包');
if (probe.includes('NODE=missing')) die('NAS 上没有 nodejs_v24 运行时');

/* ── 2. 上传 tar ──────────────────────────────────────────────── */

putFile(TARBALL, `${REMOTE_STAGE}/app.tar.gz`);

const unpackOut = await remote(
  `set -e
   cd ${REMOTE_STAGE}
   rm -rf src build
   mkdir -p src
   tar -xzf app.tar.gz -C src
   echo "--- 顶层 ---"
   ls src
   echo "--- cmd 权限（应为 rwxr-xr-x）---"
   ls -l src/cmd | head -4`,
  '远端解包',
);
console.log(unpackOut.split('\n').map((l) => `    ${l}`).join('\n'));

/* ── 3. fnpack build ──────────────────────────────────────────── */

const buildOut = await remote(
  `set -e
   cd ${REMOTE_STAGE}
   # fnpack 要求构建目录名为 appname，manifest 里的 appname 是 3d-games
   rm -rf build && mkdir -p build
   cp -a src build/3d-games
   cd build/3d-games
   echo "--- manifest ---"
   head -5 manifest
   echo "--- fnpack build ---"
   fnpack build -d . 2>&1 | tail -20
   echo "--- 产物 ---"
   ls -la *.fpk 2>/dev/null || find . -name "*.fpk" -maxdepth 2`,
  'fnpack 打包',
);
console.log(buildOut.split('\n').slice(-12).map((l) => `    ${l}`).join('\n'));

const fpkPath = `${REMOTE_STAGE}/build/3d-games/*.fpk`;
const fpkInfo = await remote(`ls -la ${fpkPath} 2>/dev/null || echo "NO_FPK"`, '确认 fpk 产物');
if (fpkInfo.includes('NO_FPK')) die('fnpack 没有产出 .fpk，见上面的构建输出');
console.log(`  ${c.ok('✓')} ${fpkInfo.trim()}`);

/* ── 4. 安装 ──────────────────────────────────────────────────── */

if (!doInstall) {
  console.log(c.dim(`\n产物已留在 NAS：${REMOTE_STAGE}/build/3d-games/`));
  console.log(c.dim('加 --install 可自动安装；也可在 fnOS 应用中心手工上传 .fpk\n'));
  process.exit(0);
}

/**
 * 安装走 fnOS 的 appcenter。
 *
 * 注意：fnOS 没有公开的「命令行安装 fpk」文档入口。这里先查有没有
 * 官方 CLI，查不到就明确告诉用户去应用中心手工装，不硬编一个可能
 * 把系统装坏的私有接口。
 */
const installOut = await remote(
  `set +e
   echo "--- 可用安装入口 ---"
   ls /usr/local/bin | grep -i -E "appcenter|app-install" || true
   echo "--- 尝试 appcenter-cli ---"
   # 该 CLI 需要系统 rpcbroker 权限，普通用户跑会 panic（已实测）
   sudo -n /usr/local/bin/appcenter-cli --help 2>&1 | head -5
   echo "EXIT=$?"`,
  '查找安装入口',
);
console.log(installOut.split('\n').map((l) => `    ${l}`).join('\n'));

console.log(`
${c.bold('下一步（手工安装，约 30 秒）')}

  1. 在 fnOS 桌面打开「应用中心」→ 右上角「手动安装」
  2. 上传 ${c.bold('/vol1/@apphome/3dgames-build/build/3d-games/3d-games.fpk')}
     （或从 NAS 文件管理里下载到本机再上传）
  3. 安装向导里确认端口（默认 ${port}）与「同时开放端口访问」
  4. 装完后两种访问方式：
     · http://panyunmeng.cn:${port}/            端口直连
     · https://panyunmeng.cn:5667/app/3d-games  统一网关（需登录 fnOS）

${c.dim('装在 /var/apps/3d-games，静态产物在 …/www，日志在 …/var/app.log')}
`);
