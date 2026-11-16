# 3D 推箱子（Microban）

经典推箱子规则 + 3D 像素风渲染。浏览器里直接玩，155 关内置，点击寻路、拖拽转视角。

## 跑起来

```bash
pnpm install
pnpm dev        # http://localhost:5178
pnpm build      # 产物在 dist/
pnpm preview    # 预览构建产物 http://localhost:4173
```

`#12` 这种 hash 可以直接定位关卡：`http://localhost:5178/#12`。

## 操作

| 操作 | 方式 |
| --- | --- |
| 移动 / 推动 | `WASD` 或方向键；也可以点地面（BFS 寻路走过去）、点箱子（绕到能推的一侧推一下） |
| 视角 | 鼠标拖拽旋转，滚轮缩放 |
| 撤销 | `Z` 或 `U`，或右上「撤销」 |
| 重开本关 | `R`，或右上「重开」 |
| 切关 | 左侧列表任意跳转；`.` / `,` 下一关 / 上一关 |

## 规则

- 只能推不能拉；一次只能推一个箱子；箱子后面是墙或另一个箱子就推不动。
- 所有箱子都压在目标点上过关。箱子已经摆对位置不代表局面安全，推歪了照样要重来。

## 实现要点

- 规则引擎（`src/sokoban.ts`）与渲染完全解耦：格子坐标 + 位图占用，`probe()` 判定一步是否合法。
- 寻路（`src/pathfind.ts`）只做「玩家能走到哪」，点击箱子时挑一个能站住且推得动的方向，取总步数最少。
- 渲染（`src/scene.ts`）用 InstancedMesh 画地板/墙/目标点，箱子与玩家是独立 Mesh 以便逐帧插值。
- 像素风的做法：画布按 3 倍缩小渲染再用 CSS 拉满（`image-rendering: pixelated`），纹理 32×32 + NearestFilter，阴影用 BasicShadowMap 出硬边。
- 所有贴图由 Canvas 现画（`src/textures.ts`），仓库里没有任何外部图片或模型文件。

## 关卡数据

`assets/Microban.txt` 是 David W. Skinner 的 Microban 关卡集（155 关），
`scripts/gen-levels.mjs` 把它转成 `src/levels.ts`，重跑：

```bash
pnpm levels
```

作者声明该关卡集可自由分发，但必须保留署名；页面左下角保留了作者信息。

## 目录

```text
assets/        关卡原始数据
scripts/       关卡数据转换脚本
src/           源码（规则 / 寻路 / 渲染 / 贴图 / UI）
.agents/       过程文件与台账（不进构建）
```
