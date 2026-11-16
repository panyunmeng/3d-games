/**
 * 零依赖静态服务器：node scripts/serve.mjs [端口]
 *
 * 为什么需要它：ES Module 在 file:// 下会被同源策略拦掉，双击 index.html 打不开。
 * 这里只做三件事：找文件、判 MIME、回字节；不做缓存、不做 SPA 回退。
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || process.env.PORT || 5502);
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    // 目录穿越防护：解析后必须仍在 ROOT 内
    const abs = path.resolve(ROOT, '.' + rel);
    if (!abs.startsWith(ROOT)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const data = await fs.readFile(abs);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 not found');
    } else {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end('500 ' + err.message);
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`3D 扫雷 → http://${HOST}:${PORT}/`);
});
