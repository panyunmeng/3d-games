# 3D 游戏合集 · 单仓库根

> 本文件是**导航**，不是事实来源。各目录的 `AGENTS.md` 是该项目的权威说明，
> 冲突时以子目录为准。

## 2026-11-19 结构变更：8 个独立仓库 → 1 个单仓库

原来是「容器目录 + 8 个平级独立 git 仓库」，根目录刻意不建 `.git`。
现已合并为**一个仓库**：根目录有 `.git`，8 个目录是它的子目录。

**目录结构没变**，所以平台的构建逻辑一行没改：`scripts/build.mjs` 的
`GAMES_ROOT` 取「平台根的上一级」，合并后上一级仍然是这些游戏目录。

历史完整保留：每个目录用 `git subtree add` 并入，原提交都在（69 → 78 个提交）。

| 事实 | 说明 |
| --- | --- |
| 单一仓库 | 根目录 `git init`，8 个目录在同一历史里 |
| 两个远端 | `origin` = Gitea（私有），`github` = GitHub（公开） |
| 旧 8 个仓库 | Gitea 上已**归档为只读**，仅作历史存档，不再推送 |
| 目录结构不变 | 平台构建不用改；游戏仍各自有 `AGENTS.md` 与 `.agents/` |

## 动手前先读

- `.agents/constraints/navigation.md` —— 容器层硬约束（已随合并更新）
- `.agents/constraints/resource-discipline.md` —— **资源纪律**（浏览器不得常驻、
  子代理不得各自开浏览器、并发上限）。跑任何 CDP/无头浏览器验收前必读
- `.agents/context/layout.md` —— 8 个目录的角色、依赖方向
- `.agents/context/mobile-spec.md` —— **移动端适配规范**（触屏输入、布局、验收判据）
- `.agents/context/current-state.md` —— 容器层台账（结构变更、上架核查等）
- 要动某个项目 → 读**那个子目录**的 `AGENTS.md`，那才是权威

## 这是什么

7 个纯前端 3D 小游戏 + 1 个聚合平台（门户页、服务、构建/打包/部署）。

```text
3D游戏合集/                    ← 单仓库根（有 .git）
├── 3D游戏聚合平台/            ← 平台：门户页 + 服务 + 构建/打包/部署
├── 3D经典贪吃蛇/
├── 3D俄罗斯方块/
├── 3D打砖块/
├── 3D扫雷/
├── 3D推箱子/
├── 3D塔防/
└── 3D坦克大战/
```

## 从哪开始

**想构建 / 部署 / 改门户** → 进 `3D游戏聚合平台/`，读它的 `AGENTS.md`。

**想改某个游戏** → 进那个游戏目录，读它自己的 `AGENTS.md`。
改完记得回平台重跑构建，否则线上不会更新（见下）。

**只是想知道线上跑的是什么** → `http://panyunmeng.cn:8081/`

## 关系与约束

| 事实 | 说明 |
| --- | --- |
| 平台只读产物 | 构建时从上一级各游戏目录读 `dist/`，产物不回流 |
| 产物不入库 | 各游戏的 `dist/` 在 `.gitignore` 里，clone 完必须各自构建一次 |
| 依赖方向单向 | 平台读游戏产物；游戏不引用平台（grep 不到对平台的引用） |
| 平台与游戏不再各自 push | 一次提交即可覆盖多处改动，这正是合并的目的 |

## 改了游戏之后

源码与线上是**两个实例**，改了游戏代码不会自动更新线上。完整链条：

```mermaid
graph LR
    A[改游戏源码] --> B[仓库 commit/push]
    B --> C[该游戏目录内构建出 dist]
    C --> D[平台重跑 build.mjs]
    D --> E[平台 pack + deploy]
    E --> F[NAS 上的应用]
```

漏掉任何一步，线上就还是旧的。平台侧的具体命令在它自己的 `AGENTS.md` 里。

## 远端

| 远端 | 地址 | 可见性 |
| --- | --- | --- |
| `origin` | http://panyunmeng.cn:3000/panyunmeng/3d-games | 私有（主仓库） |
| `github` | https://github.com/panyunmeng/3d-games | 公开 |

GitHub 那条走**直连**（`https://panyunmeng@github.com/...` 形式绕过 `~/.gitconfig`
里 `insteadOf` 对 `https://github.com/` 的改写），因为 gh-proxy 那条 token 已失效。
详见 `.agents/constraints/git-remotes.md`。

## 移动端验收（工具，跨项目共用）

7 个游戏共用一套验收口径，工具在 `.agents/work/tools/`，跑法：

```bash
node .agents/work/tools/mobile-check.mjs --name=<id> --dir="<游戏目录>" [--root=dist] [--enter="<进对局的 JS>"]
node .agents/work/tools/mobile-check-all.mjs        # 7 个游戏一次跑完
```

一次跑竖屏 375×812 / 横屏 844×390 / 桌面 1440×900 三个视口，判据是
控制台零报错、无横向滚动、canvas 未被遮挡、最小可点元素 ≥44px。任一不过退出码 1。
截图落在 `.agents/work/`（不进 git）。

**注意**：`.agents/work/` 被 gitignore，这些工具不入库。clone 后要重新拿到它们，
去 Gitea 的旧仓库或本机工作副本里取。
