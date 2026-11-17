import { defineConfig } from 'vite';

// base: './' 让构建产物可以放在任意子路径（合集里是 /games/sokoban/）下直接访问，
// 否则 index.html 会引用 /assets/... 这样的根路径，子目录部署必然 404。
export default defineConfig({
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5178,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
});
