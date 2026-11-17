/**
 * 坦克大战联机服务的嵌入封装。
 *
 * 为什么包一层而不是直接复用 3D坦克大战/dist-server/index.mjs：
 * 那个产物是「自己监听端口」的可执行脚本，import 它就会立刻占一个端口。
 * 合集要求一个进程一个监听，所以这里只借用它的 WebSocket 处理逻辑，
 * HTTP 监听交还给合集服务；同时把它的静态文件分支关掉，游戏文件由
 * 合集统一从 /games/tank/ 提供，避免两套静态逻辑对同一目录各说各话。
 *
 * 为什么 ws 参数用注入而不是写死：
 * 合集不把 ws 打进自己的包里（它的构建产物依赖 ws 的运行时），
 * 由合集根目录的 node_modules 解析，坦克目录本身不需要装依赖。
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));

/**
 * @param {{ mount: string, root?: string }} opts
 *   mount: 游戏挂载子路径，如 '/games/tank/'（末尾带斜杠）
 *   root:  合集根目录，默认取本文件上一级
 */
export async function createTankServer({ mount, root = path.resolve(HERE, '..') } = {}) {
  /**
   * 候选位置按部署形态各取其一，顺序无关（逐个 try）：
   *   开发/构建产物  <repo>/build/www/games/tank/server/index.mjs
   *   安装后          $WEB_ROOT/games/tank/server/index.mjs
   *   server/ 同级   <server 目录上一级>/www/...（WEB_ROOT 未设时的兜底）
   *
   * 注意安装后 WEB_ROOT 是 /vol1/@appcenter/3d-games/www，而本文件在
   * .../www/server/tank.mjs —— server 与游戏产物是同一个 www 下的兄弟目录，
   * 所以从本文件位置推导也能找到，不依赖环境变量一定传对。
   */
  const webRoot = process.env.WEB_ROOT;
  const candidates = [
    // 1. 显式传入的静态根（安装后由 cmd/main 传 /var/apps/.../www）
    webRoot && path.join(webRoot, 'games', 'tank', 'server', 'index.mjs'),
    // 2. 本仓库构建产物
    path.join(root, 'build', 'www', 'games', 'tank', 'server', 'index.mjs'),
    /**
     * 3. 安装后：服务端在 <TRIM_APPDEST>/server/，静态产物在 <TRIM_APPDEST>/www/。
     *    两者是兄弟目录，所以 HERE/.. 是 APPDEST，游戏产物在它的 www 下。
     *    这一条不依赖 WEB_ROOT 传没传对——启动脚本少传一个变量不该让联机失效。
     */
    path.join(HERE, '..', 'www', 'games', 'tank', 'server', 'index.mjs'),
    // 4. 兜底：<repo>/www（某些部署把产物放到仓库根的 www）
    path.join(root, 'www', 'games', 'tank', 'server', 'index.mjs'),
  ].filter(Boolean);

  let mod;
  let loadedFrom = null;
  for (const entry of candidates) {
    try {
      mod = await import(pathToFileURL(entry).href);
      loadedFrom = entry;
      break;
    } catch (err) {
      if (err?.code !== 'ERR_MODULE_NOT_FOUND') {
        console.warn(`[tank] 加载 ${entry} 失败: ${err.message}`);
      }
    }
  }

  if (!mod) {
    // 坦克是可选游戏：它的服务端没构建出来时，其余 6 个游戏必须照常可用。
    console.warn('[tank] 联机服务未找到，其余游戏不受影响（先在 3D坦克大战 里跑 pnpm build，再重建合集）');
    return { attach() {}, close() {}, available: false };
  }
  console.log(`[tank] 联机服务 ${path.relative(root, loadedFrom)}`);

  const { WebSocketServer } = mod;
  if (!WebSocketServer) {
    console.warn('[tank] 联机服务导出不符合预期，跳过挂载');
    return { attach() {}, close() {}, available: false };
  }

  // 网关前缀在这里也要知道，才能剥掉 /app/<appname> 再匹配 WS 路径
  const GATEWAY_PREFIX = (process.env.GATEWAY_PREFIX ?? '').replace(/\/$/, '');

  /** 挂载点：'/games/tank/' + 'ws' = '/games/tank/ws' */
  const wsPath = mount.replace(/\/$/, '') + '/ws';

  /**
   * 一个 WebSocketServer 服务**所有**监听点。
   *
   * 为什么用 noServer 而不是 new WebSocketServer({ server })：
   * 合集可能同时监听 TCP 端口和网关 Unix Socket，那是两个 http.Server。
   * 绑定到某一个 server 就只有那个地址能收到 WS；而且在 Windows 上
   * ws 的 server 模式会去读 socket 路径，遇到非 Unix 路径直接 EACCES。
   * 自己接管 upgrade 事件，两个监听点共用一个 WSS，语义才对。
   */
  const wss = new WebSocketServer({ noServer: true });

  function attach(httpServer) {
    httpServer.on('upgrade', (req, socket, head) => {
      let pathname;
      try {
        pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      } catch {
        socket.destroy();
        return;
      }
      // 网关会把 /app/<appname> 前缀带上；两种写法都接受
      const stripped = GATEWAY_PREFIX && pathname.startsWith(GATEWAY_PREFIX)
        ? pathname.slice(GATEWAY_PREFIX.length) || '/'
        : pathname;
      if (stripped !== wsPath) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    });
  }

  mod.attachWebSocket(wss);
  return {
    attach,
    close() {
      for (const c of wss.clients) c.terminate();
      wss.close();
    },
    available: true,
  };
}
