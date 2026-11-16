import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// 本机 %TEMP% 目录存在 ACL 限制时，esbuild 清理临时文件会报 Access is denied。
// 统一把 TEMP/TMP 指到工作区内的 .tmp，保证 npm run build 在任何机器上都能跑通。
const root = fileURLToPath(new URL('..', import.meta.url));
const tmp = path.join(root, '.tmp');
mkdirSync(tmp, { recursive: true });
const env = { ...process.env, TEMP: tmp, TMP: tmp };

function run(name, args) {
  const r = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', env });
  if (r.status !== 0) {
    console.error(`[build] ${name} 失败（退出码 ${r.status}）`);
    process.exit(r.status ?? 1);
  }
}

run('tsc', [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit']);
run('vite', [path.join(root, 'node_modules/vite/bin/vite.js'), 'build']);
run('esbuild', [path.join(root, 'scripts/build-server.mjs')]);
console.log('[build] 完成：dist/（前端）+ dist-server/（联机服务器）');
