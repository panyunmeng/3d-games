import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// 把 server/index.ts 连同它引用的 sim 纯逻辑打成单文件，运行时不依赖 node_modules。
const root = fileURLToPath(new URL('..', import.meta.url));

await build({
  absWorkingDir: root,
  entryPoints: ['server/index.ts'],
  outfile: 'dist-server/index.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  minify: false,
  logLevel: 'info',
  external: ['ws', 'bufferutil', 'utf-8-validate'],
  banner: {
    js: '// 3D 坦克大战 · 联机服务器（esbuild 打包产物，勿手改）',
  },
});
