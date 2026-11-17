# 3D 游戏合集 · 工作区指令

7 个独立 Three.js 小游戏聚成一个 fnOS 应用。**这个仓库是聚合层，不是游戏源码**。

## 动手前先读

- `README.md` —— 全景：清单结构、设计取舍、对游戏源码的改动
- `docs/部署-FNOS.md` —— 部署/升级/回滚，含 8 条实测踩坑
- `.agents/context/current-state.md` —— 进度台账（按日期追加，不覆盖）
- `.agents/constraints/*.md` —— 硬约束，动手前必读

## 边界：这里写什么、不写什么

| 该做 | 不该做 |
| --- | --- |
| 改门户页、服务、构建/打包/部署脚本 | 改 `3D*/` 里游戏的玩法、数值、渲染 |
| 从各游戏目录**读**产物 | 把产物提交进本仓库 |
| 在 `games.manifest.mjs` 里加/改游戏条目 | 在服务或门户里写死某个游戏 |

游戏目录（`3D经典贪吃蛇` / `3D俄罗斯方块` / …）各有自己的 git 仓库与
`AGENTS.md`，它们的约定在那边生效。要改游戏本身，去那边的仓库改。

**唯一的例外**：子路径部署必需的最小改动（见 README 末节）。这类改动必须
同时满足「不影响该游戏独立部署」，改完要在该游戏目录里跑一遍它自己的构建。

## 唯一事实来源

`games.manifest.mjs`。新增一个游戏 = 加一条清单 + 放一张封面，
`scripts/build.mjs` 与门户页都从它读，不另外维护列表。

## 命令

```bash
npm install                    # 只需要 ws
node scripts/build.mjs         # 收产物 → build/www（带子路径自检）
node scripts/build.mjs --only=tank   # 只重建一个，其余沿用
PORT=8099 node server/index.mjs      # 本地跑
node scripts/pack.mjs          # 组装 fnapp + tar.gz
node scripts/deploy.mjs        # 上传 + fnpack
```

## 硬约定

1. **中文**注释与文档；代码标识符英文。流程/结构/状态用 Mermaid（单图 ≤15 节点），
   不用 ASCII 画图。区间号用中文「～」，同一行不出现两个 ASCII `~`。
2. **产物不入库**。`build/` 在 `.gitignore` 里。各游戏源码也不入库。
3. **凭据不进仓库**。NAS 口令只留在既有载体
   `D:\MyProjects\W.FNOS维护\.sshpass_askpass.cmd`，由 `scripts/ssh-put.sh` 读取。
   本仓库任何文件、日志、提交信息里都不出现口令。
4. **服务端零第三方依赖**（除坦克需要的 `ws`）。不引入框架、不加构建步骤。
5. **构建自检不能省**。`build.mjs` 会检查产物里的绝对路径引用、封面是否存在、
   ES module 工程的必需文件——这三类问题都曾真实造成过线上故障。
6. 过程文件（截图、探针脚本、临时日志）放 `.agents/work/`，不进 `docs/`。

## 验收标准

改完必须能回答：**7 个游戏都能在子路径下打开且控制台零报错**。

```bash
node .agents/work/tools/verify-live.mjs   # 线上 7 个游戏逐个真开、查 canvas/WebGL/报错
```

只看 HTTP 200 不算通过 —— 静态文件能返回不代表游戏能跑（曾出现过
`base` 未设导致 JS 404 但 index.html 仍 200 的情况）。
