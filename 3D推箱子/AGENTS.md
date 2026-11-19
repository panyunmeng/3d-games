# 3D 推箱子 工作区

浏览器里跑的 3D 像素风推箱子（Microban 155 关）。技术栈 Vite + TypeScript + three.js，零外部美术资源。

## 动手前必读

- 改规则引擎、渲染、输入前读 `.agents/constraints/design-rules.md`（那边写了为什么这么分层，别越界改）。
- 当前进度、已验证的行为、未做的事看 `.agents/context/current-state.md`。

## 常用命令

```bash
pnpm install
pnpm dev        # http://localhost:5178（HMR）
pnpm build      # tsc --noEmit && vite build
pnpm preview    # http://localhost:4173 预览构建产物
pnpm levels     # assets/Microban.txt -> src/levels.ts
pnpm typecheck
```

## 结构

```text
AGENTS.md              本文件
README.md              对外说明（跑法 / 操作 / 实现要点）
index.html             入口页
assets/Microban.txt    关卡原始数据（Microban, David W. Skinner）
scripts/gen-levels.mjs 关卡转换脚本
src/
  main.ts      接线：输入 / 步进队列 / 关卡切换
  sokoban.ts   规则引擎（解析、probe、撤销、胜利判定）
  pathfind.ts  点击寻路与「走到能推的一侧」
  scene.ts     three.js 渲染、相机、拾取
  textures.ts  全部像素纹理（Canvas 现画）
  ui.ts        侧栏关卡列表与 HUD
  levels.ts    由脚本生成的关卡数据，勿手改
.agents/       过程文件与台账（不进构建；work/ 已在 .gitignore）
```

## 约定

- 交付文件放仓库根/`src/`；一次性脚本、截图、日志放 `.agents/work/<topic>/<日期>-<名称>/`。
- 中文注释、中文文档；代码标识符英文。
- 关卡数据必须保留 Microban 作者署名（作者声明：可自由分发，须保留 credit）。
- 不引入外部图片/模型资源：像素风靠 Canvas 生成纹理 + NearestFilter + 低分辨率后备缓冲。
