# 3D 坦克大战

浏览器端 **Three.js + TypeScript** 游戏：经典《坦克大战》（Battle City）规则的 3D 重制。单人战役 + 双人联机合作，服务端权威仿真，单容器部署。

## 动手前先读

- `docs/需求规格.md` —— 需求与验收的**唯一来源**；改需求先改它，再改代码
- `.agents/context/current-state.md` —— 进度台账（按日期追加，不覆盖历史）
- `README.md` —— 玩法、操作、调试参数、目录结构

## 技术栈

- 前端：Vite + TypeScript（strict）+ three（**构建期**依赖，已被打进 dist）
- 联机：Node + ws，与前端同进程同端口（静态页 + WebSocket）
- 无外部贴图 / 模型 / 音频文件：纹理与音效全部运行时程序生成

## 命令

```bash
npm run dev          # Vite(5173) + 联机服务器(3001)，/ws 自动代理
npm run build        # dist/（前端）+ dist-server/（联机服务器）
npm start            # http://127.0.0.1:3000 同端口提供页面与联机
npm test             # Vitest 单测（sim 层，不需要 WebGL）
npm run typecheck
node scripts/net-smoke.mjs          # 联机链路冒烟测试
node scripts/net-bot.mjs <房间码>   # 联机陪练机器人
python scripts/gen-levels.py        # 重新生成 10 关地图并做连通性校验
docker compose up -d --build        # 生产部署
```

## 目录

```text
docs/                 需求规格、FNOS 部署文档
src/sim/              纯逻辑仿真（无 DOM / 无 three，客户端与服务器共用）
src/render/           Three.js 场景、地形实例化、坦克、特效、相机
src/net/              联机客户端与协议
src/ui/               DOM 界面与 HUD
src/app.ts            状态机、输入、主循环、音频事件联动
server/               权威仿真 + WebSocket + 静态文件服务
scripts/              构建、关卡生成、联机测试脚本
tests/                Vitest 单测
```

## 约定

- 中文文档与注释；流程、状态、层次、关系一律用 Mermaid（单图 ≤15 节点），不用 ASCII 画图。
- 区间号用中文「～」（如 30～100），同一行不出现两个 ASCII `~`。
- 核心逻辑（碰撞、伤害、火力档、A\* 寻路、关卡解析、存档读写）必须可在无 WebGL 环境下单测。
- `src/sim/` 内禁止引入 three / DOM / `Math.random`（用 `world.rng`），否则联机确定性与单测都会破。
- 新增玩法前先问：它的必要性来自哪条规则（R1～R13）或哪条验收（A1～A10）；无出处的功能不加。
- 改关卡后必须跑 `python scripts/gen-levels.py`（含坦克连通性校验），再跑 `npm test`。
- 过程文件（截图、实验脚本、临时日志）放 `.agents/work/`，不进 `docs/`。
