# 当前进度台账

> 按日期追加，不覆盖历史。

## 2026-11-17 · 建立合集并部署到 FNOS

### 起点

工作区 `D:\MyProjects\X.AIProjects\3D游戏合集` 下已有 7 个独立游戏目录，
各有自己的 git 仓库与 Gitea 远端、各自的 `AGENTS.md` 与台账。
本次任务是「做成一个合集，发布到 fnos 上」。

用户在前两轮明确了三个决策：
1. **全部游戏都进去，联机也要处理，封装成 fnapp**
2. **端口要可以设置**，也能用 `http/https://panyunmeng.cn:5666/5667/xxxxx/` 访问
3. **仓库只存门户页源码 + 构建/部署脚本 + 文档，产物不入库**

### 做了什么

**架构**：一个 fnOS 应用 `3d-games`，一个 Node 进程同时监听
TCP 端口（默认 8081）与 fnOS 网关 Unix Socket，两种访问共用同一套路由。

**新增**（本仓库）：
- `games.manifest.mjs` —— 7 个游戏的唯一清单（来源目录、子路径、封面、文案）
- `portal/index.html` —— 门户页，构建期把清单烤进去；读服务端注入的
  `__GAMES_PREFIX__` 拼链接，因此端口与网关两种入口都对
- `portal/covers/*.jpg` —— 7 张 800×500 封面，由各游戏既有验收截图裁成
- `server/index.mjs` —— 静态服务 + 前缀剥离 + 双监听 + 优雅退出
- `server/tank.mjs` —— 把坦克的 WS 处理以 `noServer` 模式嵌进来
- `scripts/build.mjs` —— 收 7 个产物 + 子路径自检
- `scripts/pack.mjs` —— 组装 fnapp + 打 tar.gz
- `scripts/deploy.mjs` —— 上传 + fnpack + 提示安装
- `scripts/ssh-put.sh` —— 单文件上传（base64 经 stdin）
- `fnapp/` —— manifest / config / cmd / wizard / ui / 图标

**改动**（游戏源码，仅子路径必需）：
- `3D坦克大战/vite.config.ts`：加 `base: './'`
- `3D坦克大战/src/net/client.ts`：WS 端点由页面路径推导（原来写死 `/ws`）
- `3D坦克大战/server/index.ts`：导出 `attachWebSocket`，被 import 时不自启监听
- `3D推箱子/vite.config.ts`：新建，只为 `base: './'` 与固定 dev 端口

### 已验证（证据）

本机：
- `node scripts/build.mjs`：7/7 成功，合计 6143 KB
- 本地 `PORT=8099` 起服务：7 个游戏路径 + 门户 + 封面 + healthz 全 200
- 真实浏览器逐个打开 7 个游戏：canvas 存在、WebGL 可用、**控制台零报错**
- 推箱子的 canvas 是 403×300 属正常设计（`PIXEL_SCALE = 3` 的像素风缓冲，
  再配 NearestFilter 放大），不是缺陷

NAS 上线后：
- `POST /` `/healthz` `/games/*/` `/covers/*` 全 200
- 门户页 7 张卡片、7 张封面全部加载
- 7 个游戏线上真开：全部 PASS，零报错
- 坦克联机：两个 WebSocket 客户端建房 → 加入 → 开打，
  快照按 60Hz 双端同步（`.agents/work/ws-two.mjs` 实测）
- 网关路径 `http://panyunmeng.cn:5666/app/3d-games` 返回 200

### 踩到的坑（都已在代码/文档里处理）

按发现顺序，全部写进 `docs/部署-FNOS.md`：

1. 一个 `http.Server` 不能 `listen()` 两次 → 端口与 socket 各建一个 Server
2. 同一个 `WebSocketServer` 不能绑到两个 server → 改 `noServer` + 手动 handleUpgrade
3. fnpack 只打 `app/` 目录，放根目录的文件被静默忽略（fpk 只有 39 KB）
4. `switch.initValue` 必须是字符串 `"true"`，布尔值报错且错误文件报成 `config`
5. `config/resource` 的 `data-share` name 不能带连字符 → 本应用用 `{}`
6. Node 从被 import 文件位置向上找 `node_modules` → `ws` 要放两处
7. Windows 打包：tar 的 `D:` 冒号问题 + NTFS 不保留执行位 → 改用 Python tarfile
8. `ssh-run.ps1` 脚本体超约 10～60 KB 会失败 → 大文件走 `ssh-put.sh` 的 stdin 管道
9. **fnOS 升级不覆盖已存在文件** → 改代码后必须卸载重装
10. Git Bash 会把 `/app/xxx` 这类环境变量值当路径转换 → 本地测前缀时用
    node 启动器直接设 `process.env`

### 当前状态

- 应用已装：`/vol1/@appcenter/3d-games`，版本 1.0.0，状态 running
- 端口：`http://panyunmeng.cn:8081/`（局域网 `192.168.1.100:8081`）
- 网关：`https://panyunmeng.cn:5667/app/3d-games`（需登录 fnOS）
- 8 个 Python venv / node_modules 的旧断链已修（各游戏目录被移进合集后，
  pnpm symlink 里还是旧父路径，全部 `ERR_MODULE_NOT_FOUND`）

### 待办 / 未做

- **未在手机真机上验过**：门户与 7 个游戏都只是桌面 1440×900 实测；
  窄屏布局是 CSS 自适应，没有真机截图证据
- 触屏操作未做：这是各游戏本来的范围外（需求收集时选的都是桌面端），
  合集不擅自扩大
- 网关 HTTPS 路径的浏览器实测只到「返回 200」，没有带登录态在浏览器里
  完整走一遍（5667 需要 fnOS 会话 Cookie）
- `3D坦克大战` 的 `pnpm-lock.yaml` 是本轮 `pnpm install` 新生成的，
  在它自己仓库里还是未跟踪文件，未提交

## 2026-11-17 · 收尾

### 版本管理

- 本地仓库：`main`，首次提交 `9dcbab2`（🎮 7 个 3D 小游戏聚合成一个 fnOS 应用）
- 远端：`http://panyunmeng.cn:3000/panyunmeng/3d-game-collection.git`（私有）
- 本地与远端 SHA 一致：`9dcbab2a5555f7136f0e182ade49c8b9e6c1c0e3`
- `.gitignore` 排除 7 个游戏目录（各有独立仓库）、`build/`、`node_modules/`

### 最终线上状态（复核过）

| 项 | 值 |
| --- | --- |
| 应用 | `3d-games` 1.0.0，状态 `running` |
| 端口 | `0.0.0.0:8081` 监听中 |
| 网关 socket | `/var/apps/3d-games/target/app.sock`（属主 `3dgames`） |
| 进程 | 1 个 `server/index.mjs` |
| 日志 | `/var/apps/3d-games/var/app.log` |

### 复验记录

- 从干净状态重跑 `build.mjs` + `pack.mjs`：7/7 成功，6143 KB
- 线上 7 个游戏逐个真开：全部 PASS，零报错
- 门户页：7 张卡片、7 张封面、前缀注入 `/app/3d-games` 正确
- 网关未登录时返回 `invalid token`（登录门禁生效，属预期行为）
- 坦克联机日志显示多局 `开始对战（p1 p1 p2 p2）`

### 遗留事项（明确未做）

1. **手机真机未验**：门户与 7 个游戏只有桌面 1440×900 实测证据。
   窄屏是 CSS 自适应，`verify-live.mjs` 可以用 `Emulation.setDeviceMetricsOverride`
   改成手机尺寸复跑，但没做。
2. **网关 HTTPS 只验到「返回 200」**：没有在浏览器里带 fnOS 会话 Cookie
   完整走一遍 `/app/3d-games` 的页面加载。原因是没有现成的登录态可用。
   端口路径是同一条代码路径（前缀剥离逻辑已被 5666 的 200 验证），
   风险低，但不算已验。
3. **`3D坦克大战/pnpm-lock.yaml`**：本轮 `pnpm install` 重新生成，在它自己
   仓库里仍是未跟踪文件，未提交。它那边的 lockfile 本来就不入库
   （`.gitignore` 未含），下次去那个仓库时决定。

## 2026-11-17 · 清理旧部署

用户问「原来部署在 fnos 上的游戏有没有清理掉」——查下来**没清**。
旧坦克大战是一个独立 docker 容器，仍占着 8080，与合集（8081）并存，
同一游戏两个入口，改代码后容易忘了同步。

已清理（用户选「全清」）：

| 项 | 结果 |
| --- | --- |
| 容器 `tank3d` | 已 stop + rm |
| 镜像 `tank3d:1.0.0` | 已删（171 MB） |
| Compose 网络 `tank3d_default` | 已删 |
| 宿主目录 `/home/panyunmeng/tank3d` | 已删，**先打了备份** |
| 8080 端口 | 已释放 |

备份：`/home/panyunmeng/tank3d-backup-20261117-1239.tar.gz`（1.1 MB）。
源码本来就在 Gitea 仓库与本地，这份备份只是保险，确认无事后可删。

清理后复核：
- 8081 合集仍在服务，坦克页 200
- 合集内坦克联机照常（建房 → 加入 → 开打，双端同步）
- docker 只剩 `gitea`

**留下的**：`docker system df` 显示 920 MB 可回收（旧构建缓存 167 MB +
未被引用的镜像层）。那部分是这台 NAS 上其它项目共用的，没动。
