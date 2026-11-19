# 3D 游戏聚合平台

把 7 个独立的 Three.js 小游戏聚成**一个 fnOS 应用**（`.fpk`）：
一个门户页 + 一个服务进程，端口访问与 fnOS 统一网关两种入口。

> 线上实例：`http://panyunmeng.cn:8081/`（端口）、
> `https://panyunmeng.cn:5667/app/3d-games`（网关，需登录 fnOS）

## 这是什么 / 不是什么

- **是**：一个聚合层。门户页、统一服务、打包与部署脚本。
- **不是**：游戏源码仓库。7 个游戏与它同在一个仓库的兄弟目录里，见下表；
  平台只读取它们的构建产物，不复制、不修改它们的源码（除下文那几处必要的最小改动）。

## 目录位置：平台与游戏平级

```text
3D游戏合集/                    ← 单仓库根（有 .git）
├── 3D游戏聚合平台/            ← 平台（门户+服务+脚本）
├── 3D经典贪吃蛇/              ← 游戏，与平台同仓库、兄弟目录
├── 3D俄罗斯方块/
├── 3D打砖块/
├── 3D扫雷/
├── 3D推箱子/
├── 3D塔防/
└── 3D坦克大战/
```

平台与游戏**互不包含**：8 个平级目录。构建时平台从上一级读取各游戏的
`dist/`，产物不回流、不入库。

2026-11-19 之前它们是 8 个独立仓库；现在合并成一个，目录结构与构建逻辑
都没变（`GAMES_ROOT` 仍取上一级），只是提交历史统一了。

## 从零搭起来

`git clone` 一次就拿到全部 8 个目录，但各游戏的 `dist/` 都在 `.gitignore` 里，
所以仍必须逐个构建一次：

```bash
mkdir -p 3D游戏合集 && cd 3D游戏合集

# 平台
git clone http://panyunmeng.cn:3000/panyunmeng/3d-game-collection.git "3D游戏聚合平台"

# 7 个游戏：仓库名是拼音，目录名必须是中文，否则平台找不到
git clone http://panyunmeng.cn:3000/panyunmeng/3d-jingdian-tanchishe.git "3D经典贪吃蛇"
git clone http://panyunmeng.cn:3000/panyunmeng/3d-eluosifangkuai.git   "3D俄罗斯方块"
git clone http://panyunmeng.cn:3000/panyunmeng/3d-dazhuankuai.git       "3D打砖块"
git clone http://panyunmeng.cn:3000/panyunmeng/3d-sao-lei.git           "3D扫雷"
git clone http://panyunmeng.cn:3000/panyunmeng/3d-sokoban.git           "3D推箱子"
git clone http://panyunmeng.cn:3000/panyunmeng/3d-tafang.git            "3D塔防"
git clone http://panyunmeng.cn:3000/panyunmeng/3d-tan-ke-da-zhan.git    "3D坦克大战"

# 各游戏构建（命令见下表；贪吃蛇/扫雷零构建，跳过）
cd "3D推箱子" && pnpm install && pnpm build && cd ..
cd "3D塔防"   && pnpm install && pnpm build && cd ..
cd "3D坦克大战" && npm install && npm run build && cd ..

# 平台自身
cd "3D游戏聚合平台" && npm install && node scripts/build.mjs
```

构建脚本会先查 7 个游戏目录在不在，缺了直接打印上面这串 clone 命令，
所以忘了哪一步时重跑一次 `node scripts/build.mjs` 就能看到指引。

游戏不在上一级时用 `GAMES_ROOT` 指定：

```bash
GAMES_ROOT=/path/to/3D游戏合集 node scripts/build.mjs
```

| 游戏 | 子路径 | 源码仓库 | 构建命令 | 交付形态 |
| --- | --- | --- | --- | --- |
| 贪吃蛇 | `/games/snake/` | [3d-jingdian-tanchishe](http://panyunmeng.cn:3000/panyunmeng/3d-jingdian-tanchishe) | 零构建 | ES module |
| 俄罗斯方块 | `/games/tetris/` | [3d-eluosifangkuai](http://panyunmeng.cn:3000/panyunmeng/3d-eluosifangkuai) | `python build.py` | 单文件 HTML |
| 打砖块 | `/games/breakout/` | [3d-dazhuankuai](http://panyunmeng.cn:3000/panyunmeng/3d-dazhuankuai) | `python build.py` | 单文件 HTML |
| 扫雷 | `/games/minesweeper/` | [3d-sao-lei](http://panyunmeng.cn:3000/panyunmeng/3d-sao-lei) | 零构建 | ES module |
| 推箱子 | `/games/sokoban/` | [3d-sokoban](http://panyunmeng.cn:3000/panyunmeng/3d-sokoban) | `pnpm install && pnpm build` | Vite 产物 |
| 塔防 | `/games/td/` | [3d-tafang](http://panyunmeng.cn:3000/panyunmeng/3d-tafang) | `pnpm install && pnpm build` | Vite 产物 |
| 坦克大战 | `/games/tank/` | [3d-tan-ke-da-zhan](http://panyunmeng.cn:3000/panyunmeng/3d-tan-ke-da-zhan) | `npm install && npm run build` | Vite 产物 + Node WS |

坦克大战是唯一带服务端的游戏：WebSocket 挂在 `/games/tank/ws`，
**由合集的进程在内部挂载**，不额外占端口。

## 快速开始

```bash
npm install              # 只需 ws（坦克联机用）
node scripts/build.mjs   # 收 7 个游戏的产物 → build/www
PORT=8099 node server/index.mjs   # 本地跑，浏览器开 http://127.0.0.1:8099/
```

部署到 NAS：

```bash
node scripts/pack.mjs      # 组装 fnapp 目录树 + 打 tar.gz
node scripts/deploy.mjs    # 上传 + fnpack 打包（产物留在 NAS）
```

详细步骤与踩坑见 [docs/部署-FNOS.md](docs/部署-FNOS.md)。

## 目录

```text
（本目录 = 3D游戏聚合平台/，各游戏在它的上一级）
games.manifest.mjs    合集清单：每个游戏从哪来、挂哪、封面叫什么（唯一事实来源）
portal/               门户页源码 + 封面图
  index.html
  covers/             7 张封面（由各游戏验收截图裁成 800×500）
server/               服务进程
  index.mjs           静态服务 + 前缀剥离 + 双监听（端口 / 网关 socket）
  tank.mjs            把坦克的 WS 处理嵌进来（noServer 模式）
scripts/
  build.mjs           收产物 + 子路径自检
  pack.mjs            组装 fnapp + 打包
  deploy.mjs          上传 + fnpack + 安装
  ssh-put.sh          单文件上传（base64 经 stdin）
fnapp/                fnOS 应用包源文件（manifest/config/cmd/wizard/ui）
build/                产物（gitignore）
.agents/              约束、台账、过程文件
```

## 设计要点

**为什么一个进程而不是 nginx + 多个站点**：静态站点用 nginx 也能做，但那要改
NAS 上的系统 nginx 配置（fnOS 升级会覆盖），而且坦克的 WS 还得单独反代一次。
一个 Node 进程同时监听端口和网关 Unix Socket，两种访问共用同一套路由。

**为什么构建脚本不跑 `pnpm build`**：各游戏的构建依赖装在各游戏目录里，平台
的职责是「有产物就能打包」。缺产物时脚本明确报错并指出该去哪跑，不在这里
偷偷装依赖。产物一律现场从各游戏目录取，仓库里不存第二份。

**为什么平台与游戏平级而不是把游戏装进来**：*这条在 2026-11-19 合并后
只剩前半段还成立* —— 它们现在同属一个仓库，但仍是平级目录而不是嵌套结构。
理由变成「构建脚本用两个根（`ROOT` 与 `GAMES_ROOT`）区分平台自己与游戏目录，
平级摆放让这个区分一眼可见」；如果用 `games/xxx` 嵌套，`GAMES_ROOT` 就得改，
7 个游戏的相对路径引用也要跟着改，收益只是目录看起来整齐。

**为什么要剥前缀**：fnOS 网关把请求连同 `/app/3d-games` 前缀一起转发，而构建
产物里是相对路径。服务必须知道当前挂在哪个前缀下，剥掉再查文件，并把前缀
回写给前端（门户页据此拼链接）。

## 对游戏源码的改动

只有四处，都是**子路径部署必需**的，任何一项不做都会在合集里 404
（路径相对上一级 `3D游戏合集/`）：

1. `3D坦克大战/vite.config.ts`：加 `base: './'`
2. `3D坦克大战/src/net/client.ts`：WS 端点由页面路径推导，不再写死 `/ws`
3. `3D坦克大战/server/index.ts`：导出 `attachWebSocket`，并改成「被 import 时
   不自启监听」——合集要自己管端口
4. `3D推箱子/vite.config.ts`：新增文件（原本没有），同样只为 `base: './'`

三处改动在各自的游戏仓库里都能独立构建、独立运行，不影响单机部署。
