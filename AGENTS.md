# 3D 坦克大战

浏览器端 **Three.js + TypeScript** 单人 PvE 坦克小游戏：经典《坦克大战》（Battle City）规则的 3D 重制。

## 动手前先读

- `docs/需求规格-v0.1.md` —— 需求与验收的**唯一来源**；改需求先改它，再改代码。
- `.agents/context/current-state.md` —— 进度台账（按日期追加，不覆盖历史）。

## 技术栈

Vite + TypeScript（strict）+ three。运行时只有一个依赖 `three`；无外部贴图/模型/音频文件，几何与声音全部代码生成。

## 命令

```bash
npm run dev      # 本地开发
npm run build    # 静态构建到 dist/
npm run preview  # 预览构建产物
npm run test     # Vitest
```

## 目录

```text
docs/                 交付文档
src/                  源码（core / game / render / audio / ui / levels）
.agents/              代理资产：context 台账、work 过程文件
```

## 约定

- 中文文档与注释；流程、状态、层次、关系一律用 Mermaid（单图 ≤15 节点），不用 ASCII 画图。
- 区间号用中文「～」（如 30～100），同一行不出现两个 ASCII `~`。
- 核心逻辑（碰撞、伤害、火力档、A\* 寻路、关卡解析、存档读写）必须可在无 WebGL 环境下单测。
- 新增玩法前先问：它的必要性来自哪条规则（R1～R13）或哪条验收（A1～A10）；无出处的功能不加。
- 过程文件（截图、实验脚本、临时日志）放 `.agents/work/`，不进 `docs/`。
