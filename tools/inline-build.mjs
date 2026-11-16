/**
 * 把 dist/index.html 依赖的 JS/CSS 内联成单文件 dist/standalone.html。
 * 目的：不启服务、直接双击用 file:// 打开也能玩（兄弟项目都是这个形态）。
 * 用法：pnpm build:single
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dist = join(process.cwd(), 'dist');
const indexPath = join(dist, 'index.html');
if (!existsSync(indexPath)) {
  console.error('dist/index.html 不存在，先跑 pnpm build');
  process.exit(1);
}

let html = readFileSync(indexPath, 'utf8');

// 1) 内联 CSS
html = html.replace(/<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_m, href) => {
  const file = join(dist, String(href).replace(/^\.?\//, ''));
  const css = readFileSync(file, 'utf8');
  return `<style>\n${css}\n</style>`;
});

// 2) 内联入口模块脚本
html = html.replace(/<script[^>]*type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g, (_m, src) => {
  const file = join(dist, String(src).replace(/^\.?\//, ''));
  const js = readFileSync(file, 'utf8');
  // 单文件里没有别的模块可 import，直接内联
  return `<script type="module">\n${js}\n</script>`;
});

if (/src="\.\/assets\//.test(html) || /href="\.\/assets\//.test(html)) {
  console.error('还有未内联的外链资源，检查构建产物的引用形式');
  process.exit(1);
}

const out = join(dist, 'standalone.html');
writeFileSync(out, html, 'utf8');

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log(`已生成 ${out}（${kb(Buffer.byteLength(html))}）`);
console.log('剩余 assets：' + (readdirSync(join(dist, 'assets')).join(', ') || '无'));
