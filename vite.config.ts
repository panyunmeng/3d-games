import { defineConfig } from 'vite';

// base: './' 让构建产物可以放在 NAS 任意子路径下直接访问（二期部署不改代码）
export default defineConfig({
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5317,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1200,
  },
});
