import { defineConfig } from 'vite';

// 联机服务器在开发期跑在 3001，Vite 把 /ws 与 /api 代理过去，客户端不需要区分环境。
// base: './' 让构建产物可以放在任意子路径（合集里是 /games/tank/）下直接访问。
export default defineConfig({
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:3001', ws: true },
      '/api': { target: 'http://127.0.0.1:3001' },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
  },
});
