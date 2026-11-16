import type { DifficultyId } from '../sim/constants';
import type { LevelDef } from '../sim/map';
import type { PlayerInput, SimEvent, Tank, World } from '../sim/types';
import { createWorld } from '../sim/world';
import type { ClientMessage, ServerMessage, SnapTank, SnapshotMsg } from './protocol';

export interface NetCallbacks {
  onStatus: (text: string, kind: 'normal' | 'ok' | 'error') => void;
  onRoom: (code: string) => void;
  onPeerJoined: () => void;
  onStart: (payload: { playerId: string; world: World }) => void;
  onSnapshot: (snapshot: SnapshotMsg) => void;
  onPhase: (
    phase: 'levelClear' | 'gameOver' | 'victory',
    payload: { level: number; score: number; reason: 'base' | 'lives' },
  ) => void;
  onShareWorld: (world: World) => void;
  onError: (msg: string) => void;
  onClosed: () => void;
}

const INPUT_INTERVAL = 1 / 30;

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/**
 * 联机客户端。
 *
 * 网络模型：服务器 60 Hz 权威仿真、20 Hz 下发快照；客户端**不仿真**，
 * 只把快照当作目标值做指数平滑，避免任何双端状态不一致。
 * 部署在 NAS/局域网内延迟极低，这种纯快照方案比客户端预测更简单也更稳。
 */
export class NetClient {
  private ws: WebSocket | null = null;
  private queue: ClientMessage[] = [];
  private world: World | null = null;
  private targets = new Map<number, { x: number; z: number; yaw: number; turretYaw: number }>();
  private tankObjs = new Map<number, Tank>();
  private events: SimEvent[] = [];
  private inputAccum = 0;
  private lastPhase: string = 'playing';
  private playerId = '';
  /** 服务器下发的剩余敌人总数（客户端本地队列不可信）。 */
  enemiesLeft = 0;
  /** 已发送的输入条数（诊断用）。 */
  sentInputs = 0;
  lastInput = { move: 0, turn: 0, aim: null as number | null, fire: false };

  constructor(private readonly cb: NetCallbacks) {}

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.cb.onStatus('已连接服务器', 'ok');
      const pending = this.queue;
      this.queue = [];
      for (const msg of pending) this.rawSend(msg);
    };
    ws.onmessage = (ev) => {
      try {
        this.handle(JSON.parse(String(ev.data)) as ServerMessage);
      } catch {
        // 忽略无法解析的消息
      }
    };
    ws.onerror = () => this.cb.onStatus('无法连接服务器，请确认服务已启动', 'error');
    ws.onclose = () => this.cb.onClosed();
  }

  private send(msg: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.queue.push(msg);
      return;
    }
    this.rawSend(msg);
  }

  private rawSend(msg: ClientMessage): void {
    this.ws?.send(JSON.stringify(msg));
  }

  createRoom(difficulty: DifficultyId): void {
    this.connect();
    this.send({ t: 'create', difficulty });
  }

  joinRoom(code: string): void {
    this.connect();
    this.send({ t: 'join', code });
  }

  requestNextLevel(): void {
    this.send({ t: 'next' });
  }

  sendInput(input: PlayerInput): void {
    // 30 Hz 上限，避免每帧都发
    this.inputAccum += 1 / 60;
    if (this.inputAccum < INPUT_INTERVAL) return;
    this.inputAccum = 0;
    this.sentInputs += 1;
    this.lastInput = { move: input.move, turn: input.turn, aim: input.aim, fire: input.fire };
    this.send({ t: 'input', move: input.move, turn: input.turn, aim: input.aim, fire: input.fire });
  }

  takeEvents(): SimEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  getWorld(): World | null {
    return this.world;
  }

  update(dt: number): void {
    const world = this.world;
    if (!world) return;
    world.time += dt;
    const k = 1 - Math.exp(-18 * dt);
    for (const tank of world.tanks) {
      const tgt = this.targets.get(tank.id);
      if (!tgt) continue;
      tank.x += (tgt.x - tank.x) * k;
      tank.z += (tgt.z - tank.z) * k;
      tank.yaw = lerpAngle(tank.yaw, tgt.yaw, k);
      tank.turretYaw = lerpAngle(tank.turretYaw, tgt.turretYaw, k);
    }
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
    this.world = null;
    this.targets.clear();
    this.tankObjs.clear();
    this.events = [];
    this.queue = [];
  }

  /* ── 消息处理 ─────────────────────────────────────────────────── */

  private handle(msg: ServerMessage): void {
    switch (msg.t) {
      case 'room':
        this.cb.onRoom(msg.code);
        this.cb.onStatus('房间已创建，等待队友…', 'ok');
        break;
      case 'waiting':
        this.cb.onStatus('等待队友加入…', 'normal');
        break;
      case 'peer':
        this.cb.onPeerJoined();
        break;
      case 'start': {
        this.playerId = msg.playerId;
        const world = this.buildWorld(msg.levelDef, msg.level, msg.difficulty, msg.seed);
        this.world = world;
        this.lastPhase = 'playing';
        this.cb.onShareWorld(world);
        this.cb.onStart({ playerId: msg.playerId, world });
        break;
      }
      case 'level': {
        if (!this.world) break;
        const next = this.buildWorld(msg.levelDef, msg.level, this.world.difficulty, msg.seed);
        this.world = next;
        this.targets.clear();
        this.tankObjs.clear();
        this.lastPhase = 'playing';
        this.cb.onShareWorld(next);
        break;
      }
      case 'snap':
        this.applySnapshot(msg.snap);
        this.cb.onSnapshot(msg.snap);
        this.checkPhase(msg.snap);
        break;
      case 'events':
        for (const ev of msg.events) this.events.push(ev);
        break;
      case 'phase':
        this.cb.onPhase(msg.phase, {
          level: msg.level,
          score: msg.score,
          reason: msg.reason ?? 'lives',
        });
        break;
      case 'error':
        this.cb.onError(msg.msg);
        break;
      case 'peerLeft':
        this.cb.onStatus('队友已离开房间', 'error');
        break;
      case 'pong':
        break;
      default:
        break;
    }
  }

  private checkPhase(snap: SnapshotMsg): void {
    if (snap.phase === this.lastPhase) return;
    this.lastPhase = snap.phase;
    if (snap.phase === 'levelClear') {
      this.cb.onPhase('levelClear', { level: snap.level, score: snap.score, reason: 'lives' });
    } else if (snap.phase === 'gameOver') {
      this.cb.onPhase('gameOver', {
        level: snap.level,
        score: snap.score,
        reason: snap.base.alive ? 'lives' : 'base',
      });
    }
  }

  private buildWorld(levelDef: LevelDef, level: number, difficulty: DifficultyId, seed: number): World {
    return createWorld({
      levelDef,
      level,
      difficulty,
      mode: 'coop',
      playerIds: ['p1', 'p2'],
      seed,
    });
  }

  private applySnapshot(s: SnapshotMsg): void {
    const world = this.world;
    if (!world) return;
    world.time = s.time;
    world.level = s.level;
    world.phase = s.phase;
    world.base.hp = s.base.hp;
    world.base.maxHp = s.base.maxHp;
    world.base.alive = s.base.alive;
    this.enemiesLeft = s.enemiesLeft;
    for (const id of Object.keys(world.players)) {
      const sp = s.players[id];
      if (!sp) continue;
      world.players[id].lives = sp.lives;
      world.players[id].score = sp.score;
      world.players[id].power = sp.power;
      world.players[id].alive = sp.alive;
      world.players[id].name = sp.name;
    }
    if (s.tiles) {
      for (const [i, tile] of s.tiles) world.map.tiles[i] = tile;
    }

    const seen = new Set<number>();
    for (const st of s.tanks) {
      seen.add(st.id);
      let tank = this.tankObjs.get(st.id);
      const isNew = !tank;
      if (!tank) {
        tank = this.makeTank(st);
        this.tankObjs.set(st.id, tank);
      }
      tank.kind = st.kind;
      tank.enemyKind = st.enemyKind;
      tank.playerId = st.playerId;
      tank.hp = st.hp;
      tank.maxHp = st.maxHp;
      tank.power = st.power;
      tank.alive = st.alive;
      tank.invulnUntil = st.invuln ? world.time + 10 : 0;
      this.targets.set(st.id, { x: st.x, z: st.z, yaw: st.yaw, turretYaw: st.turretYaw });
      if (isNew) {
        tank.x = st.x;
        tank.z = st.z;
        tank.yaw = st.yaw;
        tank.turretYaw = st.turretYaw;
      }
    }
    for (const id of [...this.tankObjs.keys()]) {
      if (!seen.has(id)) {
        this.tankObjs.delete(id);
        this.targets.delete(id);
      }
    }
    world.tanks = [...this.tankObjs.values()];

    world.bullets = s.bullets.map((b) => ({
      id: b.id,
      ownerTankId: 0,
      team: b.team,
      x: b.x,
      z: b.z,
      yaw: b.yaw,
      speed: 0,
      power: 1,
      alive: true,
    }));
    world.powerups = s.powerups.map((p) => ({
      id: p.id,
      kind: p.kind,
      x: p.x,
      z: p.z,
      until: Number.MAX_SAFE_INTEGER,
    }));
  }

  private makeTank(st: SnapTank): Tank {
    return {
      id: st.id,
      kind: st.kind,
      enemyKind: st.enemyKind,
      playerId: st.playerId,
      name: st.kind === 'player' ? st.playerId ?? 'P' : '敌人',
      x: st.x,
      z: st.z,
      yaw: st.yaw,
      turretYaw: st.turretYaw,
      hp: st.hp,
      maxHp: st.maxHp,
      alive: st.alive,
      respawnAt: 0,
      invulnUntil: 0,
      fireCd: 0,
      power: st.power,
      speed: 0,
      bulletSpeed: 0,
    };
  }

  getPlayerId(): string {
    return this.playerId;
  }
}
