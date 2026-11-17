/**
 * 3D 游戏合集 · 服务进程（零第三方依赖，Node >= 20）
 *
 * 为什么是一个进程而不是七个：
 * 7 个游戏里有 6 个是纯静态文件，只有坦克大战带 WebSocket 权威仿真。
 * 静态站点用 nginx 也能做，但那样就得在 NAS 上改系统 nginx 配置（fnOS 升级会覆盖），
 * 而且 WS 还得单独反代一次。一个进程同时会监听端口和网关 Unix Socket，
 * 两种访问方式共用同一套路由，少一层配置就少一处会坏的地方。
 *
 * 为什么自己要剥前缀：
 * 网关会把请求连同 /app/<appname> 前缀一起转发过来（见 fnOS 统一网关文档），
 * 而静态资源在产物里是相对路径。所以服务必须知道「此刻挂在哪个前缀下」，
 * 把前缀剥掉再查文件，并把前缀回写给前端（门户页据此拼游戏链接）。
 *
 * 三种监听形态，同一套逻辑：
 *   1. TCP 端口（wizard_port），直接对外，访问 /            → 前缀为空
 *   2. 网关 Unix Socket（gatewaySocket），访问 /app/<name>/  → 前缀 /app/<name>
 *   3. 两者都开（默认），自动按请求路径判断
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTankServer } from './tank.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
// 合集根目录：server/ 的上一级。所有相对位置都从它推导，不写死绝对路径。
const ROOT_DIR = path.resolve(HERE, '..');

/* ── 配置：全部来自环境变量，默认值保证裸跑可用 ─────────────────── */

// 产物根目录。构建放进 build/www；调用方也可以指到别处（部署时指向安装目录）。
const ROOT = path.resolve(process.env.WEB_ROOT ?? path.join(ROOT_DIR, 'build', 'www'));
const PORT = Number(process.env.PORT ?? 0);
const HOST = process.env.HOST ?? '0.0.0.0';
const SOCKET = process.env.GATEWAY_SOCKET_PATH ?? '';
const GATEWAY_PREFIX = normalizePrefix(process.env.GATEWAY_PREFIX ?? '');
/** 联机游戏挂在哪个子路径下。坦克的 WS 只在这个前缀下接受连接。 */
const NET_GAME_PATH = '/games/tank/';

function normalizePrefix(p) {
  if (!p) return '';
  let s = p.trim();
  if (!s.startsWith('/')) s = '/' + s;
  while (s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/**
 * 把一个请求路径拆成「挂载前缀」和「站内路径」。
 *
 * 判据是路径本身而不是监听器：同一个进程可能同时被端口和网关访问，
 * 网关来的请求一定以 GATEWAY_PREFIX 开头，端口来的不一定（用户也可能
 * 手动加上前缀访问，那时同样该能工作）。
 */
function splitPath(rawPath) {
  let pathname = rawPath;
  if (GATEWAY_PREFIX && (pathname === GATEWAY_PREFIX || pathname.startsWith(GATEWAY_PREFIX + '/'))) {
    return { prefix: GATEWAY_PREFIX, inner: pathname.slice(GATEWAY_PREFIX.length) || '/' };
  }
  return { prefix: '', inner: pathname };
}

/** 站内路径 → 磁盘路径。拒绝一切逃出 WEB_ROOT 的解析结果。 */
function resolveAsset(inner) {
  let decoded;
  try {
    decoded = decodeURIComponent(inner);
  } catch {
    return null; // 非法百分号编码
  }
  if (decoded.includes('\0')) return null;
  let rel = decoded;
  if (rel.endsWith('/')) rel += 'index.html';
  const resolved = path.resolve(ROOT, '.' + rel);
  const rootWithSep = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;
  if (resolved !== ROOT && !resolved.startsWith(rootWithSep)) return null;
  return resolved;
}

async function sendFile(res, file, { immutable = false } = {}) {
  const data = await fs.readFile(file);
  res.writeHead(200, {
    'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': data.length,
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  res.end(data);
}

function sendText(res, code, text) {
  const body = Buffer.from(text, 'utf8');
  res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8', 'content-length': body.length });
  res.end(body);
}

/* ── 坦克联机服务：同进程内挂载，不额外占端口 ───────────────────── */

const tank = await createTankServer({
  mount: NET_GAME_PATH,
  // 坦克的静态文件由本服务的静态分支统一提供，这里只要 WebSocket 与 /healthz
  serveStatic: false,
});

/* ── 健康检查 ───────────────────────────────────────────────────── */

function healthPayload() {
  return JSON.stringify({
    ok: true,
    app: '3d-game-collection',
    prefix: GATEWAY_PREFIX || null,
    netGame: NET_GAME_PATH,
    uptime: Math.round(process.uptime()),
  });
}

/* ── 主处理 ─────────────────────────────────────────────────────── */

async function handle(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendText(res, 405, 'method not allowed');
    return;
  }

  const url = new URL(req.url ?? '/', 'http://localhost');
  const { inner } = splitPath(url.pathname);

  if (inner === '/healthz') {
    const body = Buffer.from(healthPayload(), 'utf8');
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.length });
    res.end(body);
    return;
  }

  // 各游戏都把图标内联成了 data URI，但浏览器仍会去根路径要 favicon.ico。
  // 给一个空的 204，控制台就不会留一条永远修不掉的 404 噪声。
  if (inner === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }

  // 门户页需要知道自己在哪个前缀下，才能把「进入游戏」的链接拼对。
  // 注入成一个只读的全局量，避免前端再猜一次路径。
  if (inner === '/' || inner === '/index.html') {
    const portal = await fs.readFile(path.join(ROOT, 'index.html'), 'utf8');
    const injected = portal.replace(
      '<!--MOUNT-PREFIX-->',
      `<script>window.__GAMES_PREFIX__=${JSON.stringify(GATEWAY_PREFIX)};</script>`,
    );
    const body = Buffer.from(injected, 'utf8');
    res.writeHead(200, {
      'content-type': MIME['.html'],
      'content-length': body.length,
      'cache-control': 'no-cache',
    });
    res.end(body);
    return;
  }

  const file = resolveAsset(inner);
  if (!file) {
    sendText(res, 403, 'forbidden');
    return;
  }

  try {
    const info = await fs.stat(file);
    if (!info.isFile()) throw new Error('not a file');
    await sendFile(res, file, { immutable: inner.startsWith('/games/') && inner.includes('/assets/') });
  } catch {
    // 目录省略结尾斜杠时补一次重定向，其余按 404 处理（不做 SPA 回退：
    // 每个游戏都是独立的多页产物，回退到门户反而会把错误藏起来）
    if (!inner.endsWith('/') && !path.extname(inner)) {
      const asDir = resolveAsset(inner + '/');
      try {
        const s = await fs.stat(asDir);
        if (s.isFile()) {
          const { prefix } = splitPath(url.pathname);
          res.writeHead(302, { location: `${prefix}${inner}/` });
          res.end();
          return;
        }
      } catch {
        /* 落到 404 */
      }
    }
    sendText(res, 404, `未找到 ${inner}`);
  }
}

/* ── 监听 ───────────────────────────────────────────────────────── */

/**
 * 每个监听点一个 http.Server。
 *
 * 必须这样拆：Node 的 Server.listen() 一个实例只能绑一个地址，对已 listen
 * 的实例再调 listen 会直接抛 ERR_SERVER_ALREADY_LISTEN。端口与网关
 * Unix Socket 是两个不同地址，所以是「同一套请求处理 + 两个 Server」，
 * 不是「一个 Server 监听两次」。
 */
function makeServer() {
  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error('[collection] 请求处理异常', err);
      if (!res.headersSent) sendText(res, 500, 'internal error');
    });
  });
  // WebSocket 升级由各自的 server 承担，所以每个 Server 都要挂一次
  tank.attach(server);
  return server;
}

function listen(server, target, label) {
  return new Promise((resolve, reject) => {
    const onError = (err) => reject(new Error(`${label} 监听失败：${err.message}`));
    server.once('error', onError);
    const done = () => {
      server.off('error', onError);
      resolve();
    };
    if (typeof target === 'number') server.listen(target, HOST, done);
    else server.listen(target, done);
  });
}

const servers = [];
const started = [];

if (PORT > 0) {
  const s = makeServer();
  await listen(s, PORT, `端口 ${PORT}`);
  servers.push(s);
  started.push(`http://${HOST}:${PORT}/`);
}

if (SOCKET) {
  // 上一次异常退出可能留下同名 socket 文件，不删会绑不上
  await fs.unlink(SOCKET).catch(() => {});
  const s = makeServer();
  await listen(s, SOCKET, `socket ${SOCKET}`);
  await fs.chmod(SOCKET, 0o660).catch(() => {});
  servers.push(s);
  started.push(`unix:${SOCKET} (${GATEWAY_PREFIX || '/'})`);
}

if (servers.length === 0) {
  console.error('[collection] 既没有 PORT 也没有 GATEWAY_SOCKET_PATH，无处监听');
  process.exit(1);
}

console.log(`[collection] 服务已启动：${started.join(' | ')}`);
console.log(`[collection] 静态根 ${ROOT}`);

/* ── 优雅退出：网关反复重启时不能留僵尸 socket ──────────────────── */

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`[collection] 收到 ${signal}，正在退出`);
  tank.close();
  await Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve))));
  if (SOCKET) await fs.unlink(SOCKET).catch(() => {});
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
