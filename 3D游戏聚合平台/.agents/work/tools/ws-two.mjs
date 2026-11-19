import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// 本工具放在 .agents/work/tools/ 下，那个目录没有 node_modules；
// ws 装在平台根。用 createRequire 从平台根解析，调用者不需要设 NODE_PATH。
const PLATFORM_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const WebSocket = createRequire(path.join(PLATFORM_ROOT, 'noop.js'))('ws');
const url = 'ws://panyunmeng.cn:8081/games/tank/ws';
const log = (who) => (d) => console.log(who, 'MSG', String(d).slice(0,160));
const a = new WebSocket(url);
let code=null;
a.on('open',()=>a.send(JSON.stringify({t:'create',difficulty:'classic'})));
a.on('message',(d)=>{
  const m=JSON.parse(String(d));
  if(m.t==='room'){ code=m.code; console.log('room',code);
    setTimeout(()=>{
      const b=new WebSocket(url);
      b.on('open',()=>{ console.log('B open, join', code); b.send(JSON.stringify({t:'join',code})); });
      b.on('message',log('B'));
      b.on('error',e=>console.log('B ERR',e.message));
      b.on('close',(c)=>console.log('B CLOSE',c));
    }, 500);
  } else log('A')(d);
});
a.on('error',e=>console.log('A ERR',e.message));
a.on('close',(c)=>console.log('A CLOSE',c));
setTimeout(()=>{console.log('done');process.exit(0);},9000);
