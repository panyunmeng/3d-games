import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import type { DifficultyId } from '../src/sim/constants';
import type { PlayerInput } from '../src/sim/types';
import { GRID_H, GRID_W } from '../src/sim/constants';
import type { LevelDef } from '../src/sim/map';
import type { SimEvent, World } from '../src/sim/types';
import { createWorld, nextLevelWorld, stepWorld, totalEnemiesLeft } from '../src/sim/world';
import { getLevel, LEVEL_COUNT } from '../src/levels';
import type { ClientMessage, ServerMessage, SnapshotMsg, SnapTank } from '../src/net/protocol';

const PORT = Number(process.env.PORT ?? 3000);
const HERE = fileURLToPath(new URL('.', import.meta.url));
const DIST = path.resolve(HERE, '..', 'dist');
const MAX_PLAYERS = 2;
const TICK_MS = 1000 / 60;
const SNAPSHOT_EVERY = 3; // 20 Hz

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

/* ── 静态文件服务（与联机服务同端口，方便单容器部署） ─────────────── */

async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const resolved = path.resolve(DIST, `.${pathname}`);
  if (!resolved.startsWith(DIST)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  try {
    const info = await stat(resolved);
    if (!info.isFile()) throw new Error('not file');
    const data = await readFile(resolved);
    res.writeHead(200, {
      'content-type': MIME[path.extname(resolved).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(data);
  } catch {
    // SPA 回退：任何未知路径都返回 index.html，交给前端路由
    try {
      const data = await readFile(path.join(DIST, 'index.html'));
      res.writeHead(200, { 'content-type': MIME['.html'] });
      res.end(data);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('未找到构建产物，请先执行 npm run build');
    }
  }
}

/* ── 房间与联机 ──────────────────────────────────────────────────── */

interface Conn {
  ws: WebSocket;
  playerId: string;
  room: Room | null;
  input: PlayerInput;
  alive: boolean;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeCode(): string {
  let code = '';
  for (let i = 0; i < 4; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return code;
}

class Room {
  readonly clients: Conn[] = [];
  world: World | null = null;
  phaseSent: string = 'playing';
  private timer: ReturnType<typeof setInterval> | null = null;
  private tickCount = 0;
  private eventBuf: SimEvent[] = [];
  private lastTiles: Uint8Array | null = null;

  constructor(
    readonly code: string,
    readonly difficulty: DifficultyId,
  ) {}

  get full(): boolean {
    return this.clients.length >= MAX_PLAYERS;
  }

  add(conn: Conn): boolean {
    if (this.full) return false;
    conn.room = this;
    conn.playerId = `p${this.clients.length + 1}`;
    this.clients.push(conn);
    return true;
  }

  broadcast(msg: ServerMessage, except?: Conn): void {
    const payload = JSON.stringify(msg);
    for (const c of this.clients) {
      if (c === except) continue;
      if (c.ws.readyState === WebSocket.OPEN) c.ws.send(payload);
    }
  }

  start(): void {
    if (this.timer) return;
    console.log(`[room] ${this.code} 开始对战（p1=${this.clients[0]?.playerId} p2=${this.clients[1]?.playerId}）`);
    this.startLevel(1);
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private startLevel(level: number): void {
    const levelDef = getLevel(level);
    const seed = (Math.random() * 0xffffffff) >>> 0;
    const playerIds = this.clients.map((c) => c.playerId);
    this.world = createWorld({
      levelDef,
      level,
      difficulty: this.difficulty,
      mode: 'coop',
      playerIds,
      seed,
    });
    this.lastTiles = new Uint8Array(GRID_W * GRID_H).fill(0xff);
    this.phaseSent = 'playing';
    this.eventBuf = [];
    for (const c of this.clients) {
      this.send(c, {
        t: 'start',
        playerId: c.playerId,
        levelDef,
        level,
        difficulty: this.difficulty,
        seed,
        players: this.clients.map((x) => x.playerId),
      });
    }
  }

  /** 过关后载入下一关（保留分数/命数）。 */
  advanceLevel(): void {
    if (!this.world) return;
    const completed = this.world.level;
    if (completed >= LEVEL_COUNT) {
      this.sendPhase('victory');
      return;
    }
    const levelDef = getLevel(completed + 1);
    const seed = (Math.random() * 0xffffffff) >>> 0;
    this.world = nextLevelWorld(this.world, levelDef, completed + 1);
    this.lastTiles = new Uint8Array(GRID_W * GRID_H).fill(0xff);
    this.phaseSent = 'playing';
    for (const c of this.clients) {
      this.send(c, { t: 'level', levelDef, level: completed + 1, seed });
    }
  }

  private tick(): void {
    const world = this.world;
    if (!world) return;
    if (world.phase !== 'playing') {
      this.flushPhase();
      return;
    }
    const inputs: Record<string, PlayerInput> = {};
    for (const c of this.clients) inputs[c.playerId] = c.input;

    stepWorld(world, inputs, TICK_MS / 1000);
    for (const ev of world.events) this.eventBuf.push(ev);
    this.tickCount++;

    if (this.tickCount % SNAPSHOT_EVERY === 0) {
      const snap = this.buildSnapshot(world);
      this.broadcast({ t: 'snap', snap });
      if (this.eventBuf.length > 0) {
        this.broadcast({ t: 'events', events: this.eventBuf });
        this.eventBuf = [];
      }
    }
    this.flushPhase();
  }

  private flushPhase(): void {
    const world = this.world;
    if (!world) return;
    if (world.phase === 'levelClear' && this.phaseSent !== 'levelClear') {
      this.phaseSent = 'levelClear';
      const score = this.maxScore();
      this.broadcast({ t: 'phase', phase: 'levelClear', level: world.level, score });
    } else if (world.phase === 'gameOver' && this.phaseSent !== 'gameOver') {
      this.phaseSent = 'gameOver';
      this.broadcast({
        t: 'phase',
        phase: 'gameOver',
        level: world.level,
        score: this.maxScore(),
        reason: world.base.alive ? 'lives' : 'base',
      });
    }
  }

  private maxScore(): number {
    if (!this.world) return 0;
    return this.world.playerOrder.reduce((s, id) => Math.max(s, this.world!.players[id].score), 0);
  }

  private buildSnapshot(world: World): SnapshotMsg {
    const tanks: SnapTank[] = world.tanks.map((t) => ({
      id: t.id,
      kind: t.kind,
      playerId: t.playerId,
      enemyKind: t.enemyKind,
      x: round2(t.x),
      z: round2(t.z),
      yaw: round3(t.yaw),
      turretYaw: round3(t.turretYaw),
      hp: t.hp,
      maxHp: t.maxHp,
      power: t.power,
      alive: t.alive,
      invuln: t.invulnUntil > world.time,
    }));

    let tiles: Array<[number, number]> | null = null;
    if (!this.lastTiles || this.lastTiles.length !== world.map.tiles.length) {
      this.lastTiles = new Uint8Array(world.map.tiles.length).fill(0xff);
    }
    const diff: Array<[number, number]> = [];
    for (let i = 0; i < world.map.tiles.length; i++) {
      if (world.map.tiles[i] !== this.lastTiles[i]) {
        diff.push([i, world.map.tiles[i]]);
        this.lastTiles[i] = world.map.tiles[i];
      }
    }
    if (diff.length > 0) tiles = diff;

    const players: SnapshotMsg['players'] = {};
    for (const id of world.playerOrder) {
      const p = world.players[id];
      players[id] = { lives: p.lives, score: p.score, power: p.power, alive: p.alive, name: p.name };
    }

    return {
      tick: world.tick,
      time: round3(world.time),
      phase: world.phase,
      level: world.level,
      base: { hp: world.base.hp, maxHp: world.base.maxHp, alive: world.base.alive },
      players,
      tanks,
      bullets: world.bullets.map((b) => ({
        id: b.id,
        x: round2(b.x),
        z: round2(b.z),
        yaw: round3(b.yaw),
        team: b.team,
      })),
      powerups: world.powerups.map((p) => ({ id: p.id, kind: p.kind, x: round2(p.x), z: round2(p.z) })),
      tiles,
      enemiesLeft: totalEnemiesLeft(world),
      score: this.maxScore(),
    };
  }

  send(conn: Conn, msg: ServerMessage): void {
    if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(JSON.stringify(msg));
  }

  remove(conn: Conn): void {
    const i = this.clients.indexOf(conn);
    if (i >= 0) this.clients.splice(i, 1);
    conn.room = null;
    this.broadcast({ t: 'peerLeft' });
    if (this.clients.length === 0) this.dispose();
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    rooms.delete(this.code);
  }

  private sendPhase(phase: 'victory'): void {
    this.broadcast({ t: 'phase', phase, level: this.world?.level ?? 1, score: this.maxScore() });
  }
}

const round2 = (v: number): number => Math.round(v * 100) / 100;
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

const rooms = new Map<string, Room>();

/* ── HTTP + WS 服务 ─────────────────────────────────────────────── */

const httpServer = createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    res.end('method not allowed');
    return;
  }
  void serveStatic(req, res);
});

/**
 * 把 WebSocket 连接处理挂到一个外部的 WebSocketServer 上。
 *
 * 合集（3D游戏合集）是一个进程管七个游戏，不能再为坦克单开端口，
 * 所以监听和静态文件都交给合集，坦克只贡献这段连接逻辑。
 * 单独部署时下面的代码自己 new 一个 WSS 交给它，行为与原来一致。
 *
 * 注意本函数不改 wss 的 server 绑定：调用方用 noServer 还是 server 模式
 * 由调用方决定，这里只负责「拿到连接之后怎么处理」。
 */
export function attachWebSocket(server: WebSocketServer): void {
  server.on('connection', (ws: WebSocket) => {
    const conn: Conn = {
      ws,
      playerId: '',
      room: null,
      input: { move: 0, turn: 0, aim: null, fire: false },
      alive: true,
    };

    ws.on('message', (data) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(data)) as ClientMessage;
      } catch {
        return;
      }
      handleMessage(conn, msg);
    });

    ws.on('close', () => {
      (ws as WebSocket & { conn?: Conn }).conn = undefined;
      conn.alive = false;
      if (conn.room) conn.room.remove(conn);
    });

    ws.on('error', () => {
      conn.alive = false;
    });
  });
}

function sendError(conn: Conn, msg: string): void {
  if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(JSON.stringify({ t: 'error', msg }));
}

function handleMessage(conn: Conn, msg: ClientMessage): void {
  switch (msg.t) {
    case 'create': {
      if (conn.room) return;
      let code = makeCode();
      while (rooms.has(code)) code = makeCode();
      const room = new Room(code, msg.difficulty === 'casual' ? 'casual' : 'classic');
      rooms.set(code, room);
      room.add(conn);
      console.log(`[room] ${code} 创建（难度 ${room.difficulty}）`);
      room.send(conn, { t: 'room', code });
      room.send(conn, { t: 'waiting' });
      break;
    }
    case 'join': {
      if (conn.room) return;
      const code = String(msg.code ?? '').toUpperCase().slice(0, 4);
      const room = rooms.get(code);
      if (!room) {
        sendError(conn, '房间不存在或已关闭');
        return;
      }
      if (room.full) {
        sendError(conn, '房间已满（最多两人）');
        return;
      }
      room.add(conn);
      console.log(`[room] ${code} ${conn.playerId} 加入，共 ${room.clients.length} 人`);
      room.send(conn, { t: 'room', code });
      room.broadcast({ t: 'peer', name: conn.playerId }, conn);
      room.send(conn, { t: 'waiting' });
      room.start();
      break;
    }
    case 'input': {
      conn.input = {
        move: clampNum(msg.move, -1, 1),
        turn: clampNum(msg.turn, -1, 1),
        aim: typeof msg.aim === 'number' && Number.isFinite(msg.aim) ? msg.aim : null,
        fire: Boolean(msg.fire),
      };
      break;
    }
    case 'next': {
      if (conn.room?.world?.phase === 'levelClear') conn.room.advanceLevel();
      break;
    }
    case 'ping':
      if (conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.send(JSON.stringify({ t: 'pong', ts: Date.now() }));
      }
      break;
    default:
      break;
  }
}

function clampNum(v: unknown, lo: number, hi: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  return Math.max(lo, Math.min(hi, v));
}

/**
 * 独立运行时才自己监听端口。
 *
 * 合集把它当库 import，那时监听归合集所有；这里用「本模块是不是入口脚本」
 * 来区分两种用法，而不是加环境变量开关——开关忘了设就会静默占端口。
 * 注意 esbuild 会把本模块打成 dist-server/index.mjs，产物同样走这条路。
 */
function isEntryScript(): boolean {
  const invoked = process.argv[1];
  if (!invoked) return false;
  try {
    return realpathSync(invoked) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryScript()) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  attachWebSocket(wss);

  httpServer.listen(PORT, () => {
    console.log(`[tank3d] 服务已启动: http://0.0.0.0:${PORT}  (静态目录 ${DIST})`);
  });

  process.on('SIGTERM', () => {
    httpServer.close();
    process.exit(0);
  });
}

export { GRID_H, GRID_W, LEVEL_COUNT };
export { WebSocketServer };
export type { LevelDef };
