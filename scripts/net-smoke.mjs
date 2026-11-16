/**
 * 联机链路冒烟测试：两个无头 WebSocket 客户端走完整流程。
 *
 * 覆盖：创建房间 → 加入 → 开局 → 输入上行 → 服务器权威仿真 → 快照下行 → 双方位置同步。
 * 用法：node scripts/net-smoke.mjs [ws://127.0.0.1:3000/ws]
 */
import WebSocket from 'ws';

const URL = process.argv[2] ?? 'ws://127.0.0.1:3000/ws';
const failures = [];
const notes = [];

function log(msg) {
  notes.push(msg);
  console.log(msg);
}

function fail(msg) {
  failures.push(msg);
  console.error(`✗ ${msg}`);
}

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    setTimeout(() => reject(new Error('连接超时')), 5000);
  });
}

function waitFor(ws, predicate, label, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error(`等待 ${label} 超时`));
    }, timeout);
    function onMessage(data) {
      let msg;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (predicate(msg)) {
        clearTimeout(timer);
        ws.off('message', onMessage);
        resolve(msg);
      }
    }
    ws.on('message', onMessage);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function send(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

async function main() {
  const host = await connect();
  send(host, { t: 'create', difficulty: 'classic' });
  const roomMsg = await waitFor(host, (m) => m.t === 'room', '房间码');
  log(`房间码 ${roomMsg.code}`);
  if (!/^[A-Z0-9]{4}$/.test(roomMsg.code)) fail(`房间码格式不对: ${roomMsg.code}`);

  const guest = await connect();
  send(guest, { t: 'join', code: roomMsg.code });

  const startHost = await waitFor(host, (m) => m.t === 'start', '开局消息(host)');
  const startGuest = await waitFor(guest, (m) => m.t === 'start', '开局消息(guest)');
  log(`开局 level=${startHost.level} difficulty=${startHost.difficulty} host=${startHost.playerId} guest=${startGuest.playerId}`);
  if (startHost.playerId === startGuest.playerId) fail('两端拿到同一个 playerId');
  if (startHost.seed !== startGuest.seed) fail('两端 seed 不一致');
  if (startHost.levelDef.rows.length !== 26) fail('关卡数据没有下发');

  // 记录快照
  const snapshots = new Map([
    [host, []],
    [guest, []],
  ]);
  for (const ws of [host, guest]) {
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(String(data));
        if (msg.t === 'snap') snapshots.get(ws).push(msg.snap);
      } catch {
        /* ignore */
      }
    });
  }

  // 两个客户端同时向前推进 + 开火，持续 3 秒（30 Hz 上行）
  const started = Date.now();
  const timer = setInterval(() => {
    for (const ws of [host, guest]) send(ws, { t: 'input', move: 1, turn: 0, aim: Math.PI, fire: true });
  }, 33);
  await sleep(3000);
  clearInterval(timer);

  const snaps = snapshots.get(host);
  if (snaps.length < 30) fail(`快照数量太少（3 秒只收到 ${snaps.length} 帧，期望 ≥ 30）`);
  else log(`3 秒收到 ${snaps.length} 帧快照`);

  const first = snaps[0];
  const last = snaps[snaps.length - 1];
  if (!first || !last) {
    fail('没有快照，无法判定');
  } else {
    for (const pid of ['p1', 'p2']) {
      const a = first.tanks.find((t) => t.playerId === pid);
      const b = last.tanks.find((t) => t.playerId === pid);
      if (!a || !b) {
        fail(`快照里找不到 ${pid} 的坦克`);
        continue;
      }
      const moved = Math.hypot(b.x - a.x, b.z - a.z);
      log(`${pid} 位移 ${moved.toFixed(2)} m（${a.x.toFixed(1)},${a.z.toFixed(1)} → ${b.x.toFixed(1)},${b.z.toFixed(1)}）`);
      if (moved < 1.5) fail(`${pid} 几乎没动，输入上行或服务器推进有问题`);
    }
    if (last.tick <= first.tick) fail('快照 tick 没有递增，服务器没有推进仿真');
    const ids = new Set(last.tanks.map((t) => t.id));
    if (ids.size !== last.tanks.length) fail('快照里出现重复坦克 id');
    log(`最后一帧: tick=${last.tick} tanks=${last.tanks.length} bullets=${last.bullets.length} enemiesLeft=${last.enemiesLeft} phase=${last.phase}`);
    if (last.enemiesLeft > 20) fail(`剩余敌人数量异常: ${last.enemiesLeft}`);
  }

  // 两端看到的同一帧应该一致（以 tick 对齐）
  const guestSnaps = snapshots.get(guest);
  const hostByTick = new Map(snaps.map((s) => [s.tick, s]));
  let matched = 0;
  for (const gs of guestSnaps) {
    const hs = hostByTick.get(gs.tick);
    if (!hs) continue;
    const hp = hs.tanks.find((t) => t.playerId === 'p1');
    const gp = gs.tanks.find((t) => t.playerId === 'p1');
    if (hp && gp && Math.abs(hp.x - gp.x) < 0.02 && Math.abs(hp.z - gp.z) < 0.02) matched++;
  }
  log(`两端同 tick 快照一致数 ${matched}`);
  if (matched < 10) fail('两端快照内容不一致（同步异常）');

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  log(`总耗时 ${elapsed}s`);
  host.close();
  guest.close();

  await sleep(200);
  if (failures.length > 0) {
    console.error(`\n联机冒烟测试失败 ${failures.length} 项`);
    process.exit(1);
  }
  console.log('\n联机冒烟测试全部通过');
  process.exit(0);
}

main().catch((err) => {
  console.error('联机冒烟测试异常:', err.message);
  process.exit(1);
});
