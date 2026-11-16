# 3D 经典贪吃蛇（Jelly Snake）

2.5D 立体渲染的经典贪吃蛇：规则仍是 21×21 网格的离散蛇，表现层用 Three.js 画果冻质感的
方块蛇、可旋转相机与发光棋子。纯前端、零构建、离线可用（three.js 已 vendor 到本地）。

- 入口：`index.html`；运行：`node scripts/serve.mjs 5501`；说明见 `README.md`
- 技术栈：原生 ES Module + Three.js r170（`vendor/`），无打包器、无 npm 依赖
- 玩法矩阵：`无尽/关卡` × `撞墙即死/穿墙`，加三种限时道具与随难度增长的障碍

## 动手前必读

- 改玩法规则（碰撞、生成、关卡曲线）前先读 `.agents/constraints/game-rules.md`
- 当前进度与已验证结论在 `.agents/context/current-state.md`

## 硬约束（违反必返工）

1. `src/logic.js` **不得 import three / 不得碰 DOM**。它是可单测的纯规则层，破了这条就等于放弃回归测试。
2. 所有数值调参只进 `src/config.js`，逻辑代码里不留魔数。
3. 任何碰撞/生成规则改动，必须同时满足：`node --test tests/*.test.mjs` 全绿（含模拟器的不变量校验）。
4. `vendor/` 是钉死版本的依赖，只允许整包替换，不手改内部实现（除 `RoundedBoxGeometry` 的 import 路径）。
5. 新增 `?scene=` 调试场景时，必须在 `README.md` 的「调试场景」一节登记。

## 常用命令

```bash
node scripts/serve.mjs 5501        # 本地起服务（改完刷新即可，无构建）
node --test tests/*.test.mjs       # 单测 + 机器人模拟（24 条）
```

## 目录约定

- `.agents/constraints/` 硬约束；`.agents/context/` 台账与事实；`.agents/work/` 过程产物（截图、临时脚本）
- `.agents/` 与 `AGENTS.md` 不进任何交付包；交付物只有 `index.html / styles.css / src / vendor / scripts / tests / docs`
