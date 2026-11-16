/**
 * 联机陪练机器人：以第二个玩家身份加入指定房间，自动移动+开火。
 * 用于「真人浏览器 + 无头客户端」的双端验证，也方便单机测试联机画面。
 *
 * 用法：node scripts/net-bot.mjs <房间码> [持续秒数] [ws地址]
 */
import WebSocket from 'ws';

const code = (process.argv[2] ?? '').toUpperCase();
const seconds = Number(process.argv[3] ?? 120);
const url = process.argv[4] ?? 'ws://127.0.0.1:3000/ws';
if (!code) {
  console.error('用法: node scripts/net-bot.mjs <房间码> [秒数]');
  process.exit(2);
}

const ws = new WebSocket(url);
let started = false;
let lastPhase = 'playing';
let tick = 0;

ws.on('open', () => {
  console.log(`[bot] 已连接，加入房间 ${code}`);
  ws.send(JSON.stringify({ t: 'join', code }));
});

ws.on('message', (data) => {
  let msg;
  try {
    msg = JSON.parse(String(data));
  } catch {
    return;
  }
  if (msg.t === 'start') {
    started = true;
    console.log(`[bot] 开局，我是 ${msg.playerId}，第 ${msg.level} 关`);
  } else if (msg.t === 'error') {
    console.error(`[bot] 服务器错误: ${msg.msg}`);
    process.exit(1);
  } else if (msg.t === 'snap') {
    tick = msg.snap.tick;
    if (msg.snap.phase !== lastPhase) {
      lastPhase = msg.snap.phase;
      console.log(`[bot] 阶段变化 -> ${lastPhase}（第 ${msg.snap.level} 关，tick ${tick}）`);
    }
  }
});

// 开局后持续输出输入：前进 + 开火，每 60 秒掉一次头
const timer = setInterval(() => {
  if (!started) return;
  const turn = Math.floor(Date.now() / 12000) % 2 === 0 ? 0 : 1;
  ws.send(JSON.stringify({ t: 'input', move: 1, turn, aim: Math.PI, fire: true }));
}, 33);

setTimeout(() => {
  clearInterval(timer);
  console.log(`[bot] 结束（最后一个 tick ${tick}）`);
  ws.close();
  process.exit(0);
}, seconds * 1000);
