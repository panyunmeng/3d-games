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
- 端口：`http://panyunmeng.cn:8081/`（局域网 `192.168.x.x:8081`）
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

## 2026-11-17 · 结构重排：平台与游戏改为平级

用户指出结构问题：**原来平台代码和 7 个游戏混在同一个根目录**——
聚合平台占着根（`.git`、`AGENTS.md`、`scripts/` 都在根），游戏是它的子目录。
「谁拥有什么」一眼看不出，而且平台仓库的根同时是容器坐标。

### 新结构

```text
D:\MyProjects\X.AIProjects\3D游戏合集\   ← 只是容器，不是仓库，没有 .git
├── 3D游戏聚合平台\                      ← 本仓库（门户+服务+脚本+文档）
├── 3D经典贪吃蛇\                        各自独立的 git 仓库
├── 3D俄罗斯方块\
├── 3D打砖块\
├── 3D扫雷\
├── 3D推箱子\
├── 3D塔防\
└── 3D坦克大战\
```

8 个平级目录、8 个独立仓库。根目录不再有任何文件。

### 代码改动

`scripts/build.mjs` 原来只有一个 `ROOT` 同时充当「平台根」和「游戏根」，
结构一变必然错。拆成两个语义明确的常量：

| 常量 | 含义 | 用途 |
| --- | --- | --- |
| `ROOT` | 本平台仓库根 | `build/`、`portal/`、`server/` |
| `GAMES_ROOT` | 上一级，7 个游戏所在 | `game.dir` 拼路径 |

`GAMES_ROOT` 支持环境变量覆盖，因此平台可以单独 clone 到任何位置去打包。

`games.manifest.mjs` 里的 `dir` 语义改为**相对 GAMES_ROOT**（数值没变，
因为原来游戏就在根下，现在根上移了一级，相对关系恰好一致）。

### 验证

- 新位置 `node scripts/build.mjs`：7/7 成功，6143 KB
- 新位置 `PORT=8099` 起服务：`/`、`/healthz`、`/games/tank/`、`/games/sokoban/` 全 200
- **平台复制到 `/tmp` 单独运行**（游戏不在上一级）→ 明确报错并指出该去哪 build，
  符合预期
- 同一次 `/tmp` 运行加 `GAMES_ROOT=D:/.../3D游戏合集` → **7/7 构建成功**
  —— 这条证明平台与游戏真正解耦，不是靠相对位置偶然对上
- 重新打包部署到 NAS 并重装：应用 running、8081 监听、8080 空
- 线上 7 个游戏逐个真开：**全部 PASS，零报错**

### 顺手修的

`.agents/work/tools/cdp.mjs` 与 `ws-two.mjs` 直接 `import 'ws'`，而工具目录
没有 node_modules，结构重排后跑就报 MODULE_NOT_FOUND。改用 `createRequire`
从平台根解析，调用者不再需要设 `NODE_PATH`。

## 2026-11-17 · 修掉结构重排后的四处瑕疵

用户问「这样合理吗」，我查证后承认结构合理但实现有四处瑕疵，逐条修掉。

### 1. `.gitignore` 有 7 条死规则

`/3D经典贪吃蛇/` 等 7 条是重构前（游戏还在平台子目录时）的排除项，
现在路径根本不存在，留着会误导读者以为平台曾包含游戏。已删。

### 2. 「平台能单独 clone」在语义上是错的

实测：clone 推箱子下来 **没有 `dist/`**（在 `.gitignore` 里）。
所以平台不能「clone 完就构建」。原 README 那句话会让人以为可以。
改为完整的「从零搭起来」章节：clone 顺序、**中文目录名要求**、
每个游戏的真实构建命令。

### 3. `build.mjs` 缺「游戏目录在不在」的前置检查

原来 7 个游戏目录全缺时，会逐个报「缺少 index.html」，让人误以为
是产物没构建，实际是目录没 clone——两种病因处理方式完全不同。
现在开工前先查，缺了直接打印可整段复制的 clone 命令与中文目录名。

### 4. 清单缺 `build` 字段

原来缺产物一律提示「跑 pnpm build」，但事实是：贪吃蛇/扫雷**零构建**、
俄罗斯方块/打砖块用 `python build.py`、坦克是 `npm run build`。
清单新增 `build` 字段，报错据此给准确命令。

### 容器根补导航层（用户允许）

`3D游戏合集/` 原来只是 8 个目录，进去不知道什么关系。补了：
- `AGENTS.md` —— 导航（8 个目录的角色、依赖方向、改游戏后的完整链条）
- `.agents/context/layout.md` —— 布局事实（角色/远端/依赖方向）
- `.agents/constraints/navigation.md` —— 硬约束（不在此建 git、不入库）

**明确不进版本管理**：根目录不建 `.git`，否则 8 个子仓库变嵌套仓库。

### 验证（从零 clone 全流程）

这一步是本次最关键的证据——不是改完看着对，而是真的从零走一遍：

1. `git clone` 平台到 `/tmp/fromscratch`，7 个游戏全缺 → 构建时**给出正确指引**
2. 按指引 clone 全部 7 个游戏（含中文目录名）→ 全部成功
3. 按 README 命令逐个构建：俄罗斯方块/打砖块 `python build.py` ✅、
   推箱子/塔防 `pnpm build` ✅、坦克 `npm run build` ✅
4. 平台 `node scripts/build.mjs` → **7/7 成功，6143 KB**
5. `PORT=8096 node server/index.mjs` → `/`、`/games/tank/`、`/games/sokoban/`、
   `/covers/td.jpg` 全 200，坦克联机服务正常加载

即：**这份 README 是可执行的，不是纸面流程**。

## 2026-11-17 · 修「进游戏后无法返回平台」

用户报告：在 fnOS 桌面窗口里进游戏之后，回不到平台页。

### 根因

门户卡片是普通 `<a href>`，点击在**同一个 iframe 内**导航到游戏页。
游戏页是全屏画面，没有任何回门户的入口——只能关掉重进。
7 个游戏也都没有「返回平台」这种东西（它们不知道平台存在，这是对的）。

### 修法（用户建议：开新标签页）

**1. 门户卡片改为新标签页**（`target="_blank"` + `rel="noopener"`）

游戏独占一个页面，平台页留在原处随时可回。顺带解决两件事：
游戏能真正全屏（不受 iframe 尺寸限制）；坦克的 pointer lock 与键盘
事件不再和宿主页面互相干扰。

用 `target` 而不是 JS 拦 click：中键、Ctrl+点击、右键"新标签页打开"
这些浏览器原生行为都照常工作。

**2. 游戏页注入「← 返回平台」浮层**（服务端注入，不改游戏源码）

为什么还需要它：有人直接输网址/从收藏夹进游戏、fnOS 里同一 iframe
重开时历史里没有门户、关标签再回来不如页内一键返回。

为什么服务端注入：7 个游戏是独立仓库，往每个游戏里塞平台专用 UI
会污染它们（单机部署时那段按钮毫无意义，还要各自维护）。注入发生在
响应阶段，游戏文件保持原样，产物也不用重建。

注入条件（三个同时满足）：路径在 `/games/` 下、文件名 `index.html`、
扩展名 `.html`。游戏内二级 HTML 与所有资源文件都不动。

### 位置：从左上角改到右下角

第一版放左上角 (10,10)，实测**压在推箱子的标题「3D 推箱子」上**。
排查了 7 个游戏左上角的 HUD 占用情况，多数都有东西；右下角则全部为空。
改到右下角 12px，并用 `env(safe-area-inset-*)` 兼容刘海屏/手势区。

### 验证

- 本地：7 个游戏均注入成功，门户页未被注入
- 位置一致性：7 个游戏都是 `right:12 bottom:12`，宽度 91px
- `elementFromPoint` 确认按钮中心点命中的是按钮本身（没被任何元素盖住）
- 点击后导航回门户，卡片数 7
- 网关前缀下 `HOME = "/app/3d-games/"`（不是错误的 `/`）
- 线上重新部署后：7/7 游戏 `back:true / onTop:true / canvas:true / err=0`
- 门户 7 张卡片全部 `target=_blank`

## 2026-11-17 · 统一设计语言（含全局技能）

用户要求「对比 7 个游戏，风格统一、操作统一、统一设计语言」，确认范围是 C：
**视觉 + 键位 + 文案全部统一**。

### 先量化差异（不凭印象）

| 维度 | 实测 |
| --- | --- |
| 字体 | 3 种写法：`PingFang SC/微软雅黑`、`-apple-system`、`ui-monospace` |
| 背景色 | 7 个全不同 |
| 圆角 | 4～28px 不等，同一游戏内也不一致 |
| 文案 | 「重开」vs「重新开始」、「静音」vs「音效」 |
| 键位 | Esc/P 暂停、R 重开较一致；M 静音只在部分游戏有 |
| 输入模型 | **扫雷纯鼠标**，无任何键盘绑定；其余有键盘 |

### 产出

1. `docs/设计语言规范.md` —— 字体/色彩/圆角/间距/键位/文案/按钮三档/
   HUD 位置/动效。明确「骨架统一、个性保留」：各游戏强调色不动。
2. `portal/design-tokens.css` —— 唯一可执行副本，只定义变量与通用组件类。
3. **服务端注入令牌**：游戏页 `<head>` 最前插 `<link>`。位置有讲究——
   放最前，游戏自己的样式仍在后面因而优先，令牌只兜底「游戏没写」的部分。
   这样不改 7 个游戏任何一行 CSS。
4. `portal/index.html` 自己也改用令牌，成为基准样板。
5. `.agents/work/tools/check-design.mjs` —— 用 `getComputedStyle` 量**实际渲染值**
   （不是读源码文本），把「是否统一」变成 9 个维度的断言。

### 当前实测：4/9 统一

已统一：`--radius`(12px)、`--radius-sm`(8px)、`--gap-2`(12px)、`--font-sans`。
未统一：`--bg`、`--text`、实际文字字体、body 背景色、主按钮圆角。

**未统一的 5 项都是游戏自己 CSS 里显式声明的值**，令牌作为兜底压不过它们。
要真正统一必须改 7 个游戏的 CSS——那是 7 个仓库的改动，已在规范里列为待办。

### 全局技能

用户要求把 fnapp 打包技术做成全局 skill，已建成
`~/.agents/skills/fnos-fpk-packaging/`（完整版：打包 + 生命周期 + 部署验收）：
- SKILL.md：9 步流程 + 11 条实测 pitfall
- references/cmd-main-template.sh：进程/端口/socket 三重判定的完整脚本
- references/node-dual-listen.md：双监听与前缀剥除要点
- scripts/pack-tar.py：Windows 打 Linux 包（权限位实测通过）
- scripts/ssh-put.sh：base64 经 stdin 传大文件

已 commit + push 到 `agent-skills` 仓库（3f6f1df）。
平台 `AGENTS.md` 已加上指向它的引用，并声明「冲突以本项目实测为准，并回写技能」。

### 顺手修

`.gitignore` 里浏览器 profile 只写了 `chrome-prof/`，但每次验收目录名不同
（cpd/cp2/cpf…），导致 `git add -A` 把整个 Chrome profile 加进仓库并报
Permission denied。改成通配 `.agents/work/cp*/`，另加 `.agents/work/*.png`
挡临时截图。

## 2026-11-17 · 设计统一推进到 11/11 + 7/7（方案 1 完成）

用户选方案 1「继续推进到 9/9」。开了 3 个队友并行，**全部因额度耗尽中断**：
- unity-a（贪吃蛇/俄罗斯方块/打砖块）：零代码落盘
- unity-b（扫雷/推箱子）：扫雷落了 117 行（暂停功能+面板+圆角），**缺键盘绑定**
- unity-c（塔防/坦克）：零代码落盘

我接手全部收尾。队友 B 的扫雷代码质量高（暂停计时方案正确），我补了最后一段键盘绑定。

### 队友提出的两个真问题（我核实后采纳并改规范）

1. **「扫雷是 Vite 项目」是我搞错了** —— 它零构建，`pnpm build` 报
   `Command "build" not found`。规范补了「各游戏构建形态不同」表。
2. **推箱子零音频，M 静音无对象** —— 全仓 grep 零 AudioContext/振荡器，
   台账自述「无音效」。规范原条款写死「所有游戏都要 M」，是漏洞。
   改为条件条款：有音频必须有 M；无音频不加，台账登记。控件必须有
   可观察效果，按下去什么都不变的键比没有更糟。

### 最终结果（线上 8081 实测）

**设计一致性 11/11**（起始基线 4/11）
**键位三态 7/7**（起始 0/7 有验证）

| 维度 | 起点 | 终点 |
| --- | --- | --- |
| --bg / --text / 字体 | 7 个各不相同 / 3 种写法 | 全统一 #0a0d16 / #e8edf7 / 规范栈 |
| body 底色 | 混用 | 全为 #0a0d16（渐变铺底与实色归一） |
| 圆角 | 0～999px 混乱 | 全落 8/12/18/999 档；塔防切角、推箱子直角为合规变体 |
| 禁用文案 | 打砖块/贪吃蛇/坦克 3 处 | 0 处 |
| 键位 | 扫雷纯鼠标、坦克缺 P/R、塔防 R 被占 | 7/7 三态 PASS |

### 检查器本身修了 4 处判据缺陷（否则会误判）

1. 主按钮取「第一个可见 button」→ 改为语义优先（primary/cta）+ 排除卡片
   （扫雷的难度卡 `<button class="level-card">` 面积比开始按钮大）
2. 底色只读 `backgroundColor` → 渐变铺底的游戏被判透明；改为归一比较
3. 圆角要求「7 个值全同」→ 改为「各自落在规范档位内」（维度分 same/each 两类）
4. 键位用 grep 源码 → 改为真派发键盘事件看界面变化（读 e.code 与 e.key 的
   游戏写法不同，grep 不可靠）

### 新增工具

- `.agents/work/tools/check-design.mjs` —— 11 维一致性
- `.agents/work/tools/check-keys.mjs` —— 7 游戏键位三态（进对局→P暂停→再P恢复）

两个工具的判据都在文件里写清了「为什么这样判」，避免下次改判据时又走回头路。

### 版本

7 个游戏仓库 + 平台仓库各自 commit 并 push。线上应用已重装为统一版本
（注意：`/tmp/inst.env` 会被系统清理，重装前必须重建，否则报
`Something wrong with environment variables`）。

## 2026-11-17 · 会话收尾

落盘完成，本场闭环。

### 收尾时发现并修掉一处漏提交

扫雷 `styles.css` 还有 1 处改动没提交（我把 .panel 26px、.level-card 16px、
.result-stat 14px 都调成 18px，提交时漏了）。线上产物已包含它，但仓库没记录。
已补提交并推送（`11df3a8`）。

**这说明一件事**：部署完不等于落盘完。以后收尾必须逐个仓库
`git status` 核对，不能只看「部署成功」。

### 最终状态

- 8 个仓库全部干净，本地 = 远端（8/8）
- 设计一致性 11/11、键位三态 7/7（NAS 线上实测）
- 扫雷 20/20、坦克 59/59 单测全绿
- 线上 8 个入口全 200

### 本场会话报告

`.agents/work/SESSION-REPORT-20261117.md` —— 单文件可独立阅读，
含需求、交付、关键事实、被推翻的假设、检查器修的 4 处判据缺陷、
团队协作实况与教训、部署踩坑。

### 团队协作教训（重要）

3 个队友全部因额度耗尽（QUOTA）静默中断，只有 1 个留下部分代码。
**全局额度耗尽时子代理不报错、不留收尾消息**，只能从 git status 看出
它到底做了没有。以后批量委派前应确认额度余量，或把任务拆小，
使中断后损失可控。
