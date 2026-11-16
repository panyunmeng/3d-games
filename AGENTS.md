# 3D 扫雷 · 矿洞

浏览器端 **Three.js + 原生 ES Module** 的单机扫雷：经典 2D 规则、矿洞岩层立体渲染。零构建、零外部素材、离线可跑。

## 动手前先读

- `docs/需求规格-v0.1.md` —— 需求与验收的**唯一来源**；改需求先改它，再改代码。
- `.agents/context/current-state.md` —— 进度台账（按日期追加，不覆盖历史）。

## 技术栈

原生 ES Module + 本地 `vendor/three.module.js`（r170）。无包管理器依赖、无构建步骤；单测用 Node 内置 `node --test`。

## 命令

```bash
node scripts/serve.mjs          # 本地静态服务，默认 127.0.0.1:5502
node --test "tests/*.test.mjs"  # 规则层单测
npm test                        # 同上（npm 只是入口，不装依赖）
```

`file://` 下 ES Module 会被同源策略拦掉，必须走本地服务。

## 目录

```text
docs/                 交付文档（需求规格）
src/logic.js          规则核心：纯数据，不碰 DOM / three
src/rng.js            种子随机数（分享复现）
src/board3d.js        棋盘网格、状态显隐、动效
src/particles.js      粒子池
src/scene.js          渲染器、相机轨道、灯光
src/textures.js       程序化贴图
src/audio.js          WebAudio 合成音效
src/ui.js             DOM 层
src/main.js           入口与状态机
tests/                规则层单测
vendor/               three.js 本地副本
.agents/              context 台账、work 过程文件
```

## 约定

- 中文文档与注释；流程、状态、层次、关系一律用 Mermaid（单图 ≤15 节点），不用 ASCII 画图。
- 区间号用中文「～」（如 30～100），同一行不出现两个 ASCII `~`。
- 规则层（`logic.js`）必须保持零 DOM / 零 three 依赖，所有规则变更都要有单测覆盖。
- 新增玩法前先问：它的必要性来自哪条规则（R）或哪条验收（A）；无出处的功能不加。
- 过程文件（截图、实验脚本、临时日志）放 `.agents/work/`，不进 `docs/`。
- 视觉只在浏览器里验收：改完渲染相关代码要真机截图确认，不看代码猜效果。
