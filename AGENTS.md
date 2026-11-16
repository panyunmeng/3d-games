# 3D 塔防（《机甲防线》）

Three.js + TypeScript + Vite 的科幻机甲塔防。全程序化美术（无外部模型/贴图/字体/音源），
桌面浏览器运行，二期静态部署到 NAS。

## 硬约束

- **零外部资源**：几何体、贴图（Canvas 程序化）、音效（Web Audio 合成）全部在代码里生成。
  不引入 glb/fbx/字体文件/CDN 链接。
- **静态可部署**：`vite.config.ts` 用 `base: './'`，构建产物 `dist/` 可放在 NAS 任意子路径。
- **固定路线塔防**：敌人沿关卡路点前进，塔只能建在预设建造点。
- **模拟与渲染分离**：`game/simulation.ts` 固定 1/60 步长推进，不读 DOM、不碰 Three.js 渲染对象。
- 数值全部集中在 `src/data/`，调平衡只改数据文件。

## 常用命令

```bash
pnpm dev        # 本地开发服务 http://127.0.0.1:5317
pnpm typecheck  # tsc --noEmit
pnpm build      # 类型检查 + 产出 dist/
pnpm build:single # 另出 dist/standalone.html 单文件（file:// 双击可玩）
pnpm preview    # 预览 dist/
pnpm tsx tools/balance.ts   # 无头平衡测试（三关 × 三难度）
pnpm tsx tools/balance.ts 2 # 只跑第 2 关
pnpm tsx tools/endless-check.ts  # 无尽模式冒烟：推到 30 波查数值/不崩
```

## 目录

```text
src/
  data/      塔/敌人/关卡/难度/波次 数值定义
  game/      纯模拟：经济、波次、塔、敌人、弹道、寻敌
  render/    Three.js 场景、程序化网格、粒子、后期
  ui/        DOM 界面壳：主菜单、选关、HUD、暂停、结算、设置
  core/      主循环、输入、音频合成、随机数、数学工具
  save.ts    localStorage 存档（解锁、星级、无尽最佳、设置）
```

## 数值与平衡

- 全部数值在 `src/data/`：塔（`towers.ts`）、敌人（`enemies.ts`）、难度（`difficulty.ts`）、
  关卡与建造点生成规则（`levels.ts`）、波次骨架（`waves.ts`）、波次血量线性增长在
  `game/simulation.ts` 的 `hpMultiplier()`。
- 改完数值**必须**跑 `pnpm tsx tools/balance.ts` 并对照 README 里的平衡结论，不许只看代码猜。

## 过程文档

- 进度与决策台账：`.agents/context/current-state.md`（每轮追加）
- 过程产物（截图、一次性脚本）：`.agents/work/`（不进 git）
