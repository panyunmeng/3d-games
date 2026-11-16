# 进度台账

> 按日期追加，不覆盖历史。

## 2026-11-16

- 建立工作区：`AGENTS.md` + `docs/需求规格-v0.1.md`。
- 需求收集完成，共 14 项决策已确认：
  - 经典 Battle City 规则 3D 重制；浏览器 + Three.js + TypeScript；单人 PvE。
  - 完整小游戏范围：10 关手工地图、4 地形、4 道具、3 类敌人、程序合成音效、localStorage 存档。
  - Low-poly 程序化几何；第三人称跟随 + 键鼠 pointer lock；车体自由移动 + 炮塔独立 360°。
  - 双难度档（经典档基地一击毁 / 休闲档基地 3 血 + 自动修复一次）。
  - Vite 工程 + 可部署静态包。
- 关键技术裁决已写入规格 §4：地图离散（26×26 格、格边 2 m）、实体连续；相机跟随车体而非炮塔。
- 状态：规格待用户确认冻结，未开始编码。
- 版本管理已初始化：
  - 本地 `git init -b main`，首次提交 `ea8fc9a`。
  - 远端私有仓库 `http://panyunmeng.cn:3000/panyunmeng/3d-tan-ke-da-zhan.git`（仓库名按 AlphaDashDot 转写），`main` 已推送并建立跟踪。
- 下一步：确认规格 → 搭 Vite + TS 工程骨架 → 垂直切片（操控 + 相机 + 碰撞 + 射击）。

## 2026-11-17 · v1.0 实现与验收

**完成内容**

- 单人战役：10 关（`scripts/gen-levels.py` 生成，内置坦克连通性校验）、4 地形、4 道具、3 类敌人、双难度档
- 渲染：程序化天空/地面/砖/钢/水/林纹理，InstancedMesh 合批，第三人称跟随相机（高度感知遮挡），3D 落点准星，粒子特效
- 音频：WebAudio 合成炮击/爆炸/引擎/道具/过关/失败 + 极简低音循环（默认关）
- 存档：localStorage（最高分、最远关、通关次数、难度、音效/音乐）
- 联机：Node + ws 服务器，60 Hz 权威仿真 / 20 Hz 快照，4 位房间码，双人合作
- 部署产物：Dockerfile（多阶段）+ docker-compose.yml + `docs/部署-FNOS.md`
- 调试设施：`?debug / ?demo / ?drive / ?level / ?screen`

**验证结果**

- `npm test`：59 项单测全绿（含 10 关战役连通性、确定性、实体不泄漏、边界）
- `node scripts/net-smoke.mjs`：两端 3 s 各推进 9.75 m、40 帧快照、同 tick 一致 40/40
- 浏览器实机：单人自动驾驶连续运行、联机双端同屏（`players p1@… p2@…`）

**踩到的关键坑（供后续参考）**

1. 本机 `%TEMP%` 有 ACL 限制，esbuild 清理临时文件报 Access is denied → `scripts/build.mjs` 统一把 TEMP/TMP 指到工作区 `.tmp/`
2. `ws` 打进 ESM bundle 会因动态 `require('events')` 崩 → esbuild 设 `external: ['ws', ...]`，运行时装生产依赖
3. 这个浏览器环境里 `requestPointerLock()` 抛 `WrongDocumentError`，异常直接打断 rAF 主循环 → 已 try/catch + 主循环兜底
4. 隐藏标签页会挂起 rAF（`visibilityState=hidden`），自动化截图看到的是冻结帧 → `?demo/?drive` 模式下用定时器按真实时间补齐帧
5. 坦克碰撞半径 1.05 时会被 2 m 宽走廊卡死（第 7 关玩家与 AI 同时卡住）→ 半径降到 0.95，并在关卡生成器里加连通性校验

**下一步（可选）**

- 对抗模式（双人 PvP）、更多关卡、道具扩展
- 若要在 NAS 上真实部署：`docker compose up -d --build` 后按 `docs/部署-FNOS.md` 验证 `/healthz`

## 2026-11-17 · 已自主部署到 NAS（FNOS）

- **线上地址**：http://panyunmeng.cn:8080/ （局域网 192.168.1.100:8080），容器 `tank3d`，镜像 `tank3d:1.0.0`，端口 8080→3000
- **主机路径**：`/home/panyunmeng/tank3d`；源码从 Windows 打包 scp，未在 NAS 上 clone
- **构建参数**：`NPM_REGISTRY=https://registry.npmmirror.com`（NAS 直连 npmjs 慢）；基础镜像走 daemon 既有镜像源 `docker.fnnas.com`
- **验收**：NAS 本机 `/healthz` 200；Windows 侧 `net-smoke ws://panyunmeng.cn:8080/ws` 通过（62 帧/3 s、双端各 15.25 m、同 tick 一致 62/62）；浏览器实机双人同屏可玩
- **两个坑**：① 改过 package.json 依赖分组后没重建 lock，容器 `npm ci` 失败（已用 `npm install --package-lock-only` 修复并提交）；② `panyunmeng` 不在 docker 组，docker 命令都要 `sudo -S`
- **遗留**：FNOS 上 3000 被 Gitea 占，所以用 8080；如需换端口改 `docker-compose.yml` 左侧端口后 `docker compose up -d`
