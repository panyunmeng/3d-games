import { context } from 'esbuild';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// 开发期：esbuild watch 打服务器包 → 重启 node；同时起 vite。
// 单机玩法不需要服务器，但联机必须两边同时在跑，所以默认一起起。
const root = fileURLToPath(new URL('..', import.meta.url));
const viteBin = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
const tmpDir = path.join(root, '.tmp');
mkdirSync(tmpDir, { recursive: true });
process.env.TEMP = tmpDir;
process.env.TMP = tmpDir;

let serverProc = null;
let shuttingDown = false;

function startServer() {
  if (shuttingDown) return;
  if (serverProc && serverProc.exitCode === null) {
    serverProc.kill('SIGTERM');
  }
  serverProc = spawn(process.execPath, ['dist-server/index.mjs'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, PORT: process.env.PORT ?? '3001' },
  });
  serverProc.on('exit', (code) => {
    if (!shuttingDown && code !== 0) console.error(`[server] 退出码 ${code}`);
  });
}

const ctx = await context({
  absWorkingDir: root,
  entryPoints: ['server/index.ts'],
  outfile: 'dist-server/index.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  logLevel: 'warning',
  external: ['ws', 'bufferutil', 'utf-8-validate'],
  plugins: [
    {
      name: 'restart-server',
      setup(b) {
        b.onEnd((result) => {
          if (result.errors.length === 0) startServer();
        });
      },
    },
  ],
});

await ctx.watch();

const vite = spawn(process.execPath, [viteBin], { cwd: root, stdio: 'inherit' });

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  serverProc?.kill('SIGTERM');
  vite.kill('SIGTERM');
  void ctx.dispose().finally(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
vite.on('exit', (code) => {
  if (!shuttingDown) {
    console.error(`[vite] 退出码 ${code}`);
    shutdown();
  }
});
