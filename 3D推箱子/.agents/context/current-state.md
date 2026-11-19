# 进度台账

## 2026-11-17 首版可玩原型

### 已完成

- 工程：Vite 7 + TypeScript 5.9 + three 0.181，`pnpm dev` / `pnpm build` / `pnpm preview` 全通，`tsc --noEmit` 无错。
- 关卡：Microban 155 关（`assets/Microban.txt`），转换脚本生成 `src/levels.ts`；数据体检通过：155 关齐全、id 1～155 无缺无重、每关箱子数 == 目标点数、玩家存在、内部区域洪泛不触边界。
- 规则引擎：移动、推箱、推不动（墙/箱）、箱子计数、撤销栈、胜利判定。
- 输入：WASD/方向键、点击空地 BFS 走位、点击箱子「绕到能推的一侧推一步」、拖拽旋转、滚轮缩放。
- 渲染：地板/墙/目标点用 InstancedMesh；箱子与玩家独立 Mesh 逐帧插值；目标点浮琥珀宝石（被箱子压住即隐藏）；箱子在点上染绿；玩家头顶冷白指针。
- 像素风：画布 3 倍缩小渲染 + CSS 拉满；32×32 NearestFilter 纹理全部 Canvas 生成（地板/砖墙/墙顶石板/木箱/目标点/脸/衣服）。
- UI：左侧 155 关列表（当前高亮、已通关打勾，localStorage 记忆）、HUD（步数/推动/剩余）、撤销/重开/上下关、过关弹窗、`#关卡号` 深链接。
- 关卡取景：按棋盘包围球 + 当前 fov/aspect 自动适配，45° 等距下四角不出画。

### 实测记录

- 键盘：方向键走位，步数递增；推箱后推动 +1；顶墙时按键无效，步数不变。
- 撤销：推箱后按 Z，步数 8→7、推动 1→0；过关弹窗打开时按 Z 会先关弹窗再退回那一步。
- 点击：点目标点所在格，玩家自动走 3 步到达；点木箱，绕行后推动一次（推动 +1）。
- 过关：44 关「Duh!」一次右推即过关，弹窗显示「#44 · 1 步 · 推动 1」，列表打勾。
- 生产包：`pnpm preview` 下 12 关正常渲染、无控制台报错。
- 大关卡：155 关「The Dungeon」30×17 整块入画，墙体洪泛填实后不再是薄鳍。

### 已知不足（有意留给下一轮）

- 只有内存态 + localStorage 的「通关打勾」，没有完整存档（局面/最佳步数）。
- 无音效、无教程、无动画过场。
- 触屏手势未做（本期需求只选了键盘 + 鼠标）。
- 打包产物 542 kB（three 全量），未做 code split；本地玩无感。
- 未做死局检测（箱子推进角落）提示。

## 2026-11-17 版本管理

- 本地仓库：`main`，首个提交 `d7910c8`（✨ 3D 推箱子初始化）。
- 远端：http://panyunmeng.cn:3000/panyunmeng/3d-sokoban.git（私有，默认分支 main），已建立 `[origin/main]` 跟踪，`git ls-remote` SHA 与本地一致。

## 2026-11-18 22:34 — 移动端适配（触屏走位 + 响应式 HUD + 375×812 竖屏可玩）

### 触屏方案与理由（用户裁决口径落地）

- 选**屏幕十字方向键**（左下角，4 键 48×48px，固定映射棋盘格上/右/下/左 = DIRS 0/1/2/3，与相机朝向无关），**不选滑动手势**：
  1. 棋盘是离散四方向格网，方向键把「屏幕方向」直接映射到格子方向，零坐标变换；滑动必须随相机旋转做变换，多一层换算多一处错。
  2. 拖拽旋转本就在同一画布用 pointer 事件；若再加滑动走位，二者要靠阈值抢同一串 pointermove，正是「旋转后误走一步」的根因。方向键是独立 DOM 按钮，不碰画布，从构造上消除误触。
  3. 每次按键只 `queue.push(dir)`，仍由 `main.ts::tick()` 按 `MOVE_MS` 节奏调 `game.move()`，走位/推箱/撤销/胜利判定全部复用既有规则引擎，没有第二套移动逻辑。
- **点击寻路与拖拽旋转保持可用**：画布 `pointerup` 仅在 `!d.moved && quick(<500ms)` 时才触发 `onCellClick`；拖拽阈值由 5px 提到 **8px**（高于手指自然抖动 4～6px、低于有意滑动起点）。累计位移 >8px 即 `moved=true`，转完视角绝不会触发点击寻路走位。阈值写在 `scene.ts:492` 中文注释里。
- 方向键用 `pointerdown`（不等 click 抬起）+ `setPointerCapture`，连点跟手、手指滑出不会把事件丢给画布。

### 响应式断点与布局取舍

- **竖屏 375×812**：`#app` 单列，canvas 占满 100% 视口高（实测 812/812）。左侧 155 关列表改成**抽屉**：默认 `translateX(-104%)` 收在屏外，HUD 里的「☰」按钮切 `.levels-open` 展开，点遮罩或选关自动收起——列表不再长期占屏。HUD 收成一行（实测 363px 宽内：关卡号+3 项统计+5 个 44px 按钮，maxRight 361≤369，无换行）。方向键固定左下（x12,y644），**右下角完全留空**给平台「返回平台」注入按钮（实测 bottomRightControls=[]）。
- **横屏 844×390**：侧栏回左右布局（侧栏 188px / 画布 656px），`@media (orientation:landscape) and (max-height:520px)` 收紧纵向间距；所有按钮统一 ≥44×44。方向键仍在左下，右下留空。
- **桌面 1440×900**：侧栏 232px 原样、D-pad 不显示（无媒体命中），键盘鼠标全部照旧，不退化。
- 所有可点元素统一 `min-width/min-height:44px`（含关卡条目），像素风**直角按钮**造型保留，未改圆角；Microban 作者署名保留。

### 验证结论（原始输出摘要）

- `pnpm build`（= tsc --noEmit && vite build）：**通过**，tsc 无错，vite 产出 dist/（index.html 4.34 kB / css 6.34 kB / js 542.99 kB，12 modules，1.02s）。
- `node .agents/work/tools/mobile-check.mjs --name sokoban --dir "3D推箱子" --root=dist`：**3/3 视口 PASS**，`err=0 overflowX=0 canvas=true`，minTap 三视口均 44px，touch-action=none。截图：`.agents/work/mobile/sokoban-portrait.png`、`sokoban-landscape.png`、`sokoban-desktop.png`。
- CDP 几何审计（客观替代 read_image，本模型无图像输入）：竖屏 canvas 100% 高、抽屉屏外(x=-333)、HUD 单行不溢出、方向键 x12/y644、右下角无控件；横屏侧栏左右布局、右下无控件；桌面 D-pad 隐藏。
- CDP 交互回归：竖屏展开抽屉→选第 44 关→自动收起→按方向键右键，步数 0→1、该关标记 solved，规则引擎链路通。
- `git status --short`：仅 `M index.html`、`M src/main.ts`、`M src/scene.ts`、`M src/style.css`；dist/ 与 .agents/work/ 均被 gitignore，无其它游戏、无 commit/push。

### 已知不足

- 未做滑动走位（按二选一裁决刻意不选），也未做双指缩放（沿用滚轮/拖拽单指）；大关卡（如 155 关 30×17）在 375px 竖屏下棋盘虽占满视口，格间像素仍偏小，精细推箱依赖点击寻路辅助。
- 方向键显示在竖屏/横屏由视口断点驱动（非 hover/pointer 媒体查询），桌面窄窗口（<760px 或高<520px）也会出现方向键——属可接受的保守退化，不影响桌面 1440×900。
- `read_image` 在本模型（hy4flash，无图像输入）不可用，截图目视核对以 CDP 几何/交互审计替代，证据为上述数值输出。

## 2026-11-18 22:40 — 修掉竖屏 HUD 逐字折行（lead 验收复核缺陷）

### 原因

- 上一版只量了 HUD 容器边界（maxRight 361≤369），误判为「单行不溢出」；但 stat 子元素没有 `white-space:nowrap`，两字标签「步数/推动/剩余」在 375px 单行里总宽超预算，浏览器把每个标签**逐字折成上下两行**（实测修复前 stat `getBoundingClientRect().height=30px`，而 `<b>` 数值只有 15px，正好 2×）。
- 横向预算（第一性）：375 − HUD 左右边距 12 − padding 12 ≈ 351px；5 个 44px 按钮 + 4×4px 间隙 = 236px；关卡号徽标 ~25px；三项两字标签「步数/推动/剩余」+ 数值合计需 ~120px；再加各间隙 ≈ 400px > 351px，物理上放不下，压缩是必然而非美观选择。

### 改法与理由

- 每个统计项包成 `.stat`，设 `white-space:nowrap; display:inline-flex; align-items:baseline`，标签与数值锁死同一行。
- 竖屏断点下标签由「步数/推动/剩余」缩写为单字「步/推/剩」（`.stat-full{display:none} / .stat-short{display:inline}`），每标签省一半宽，三项合计省 ~60px，351px 预算内可容纳。横屏/桌面保留完整两字标签（空间足够）。
- **不采用「5 按钮收进 ⋯ 菜单」**：撤销是推箱子核心循环里最高频操作，收进两级菜单要从 1 次点击变 2 次，损害可玩性；单字标签足够解决问题。
- 标签用 `<i>` 包住、`<b>` 仍是数值节点，`ui.ts` 的 `setStats()` 只改 `<b>.textContent`，逻辑零改动。

### 量测证据（CDP，替代无图像输入的目视）

```
PORTRAIT 375x812
  步数步 0  stat.getBoundingClientRect().height=15px  offsetHeight=15px  <b>高度=15px  比值=1.00x  单行 OK
  推动推 0  stat.getBoundingClientRect().height=15px  offsetHeight=15px  <b>高度=15px  比值=1.00x  单行 OK
  剩余剩 1  stat.getBoundingClientRect().height=15px  offsetHeight=15px  <b>高度=15px  比值=1.00x  单行 OK
LANDSCAPE 844x390  / DESKTOP 1440x900（完整标签）
  步数 0 / 推动 0 / 剩余 1  高度=16px  offsetHeight=16px  <b>=16px  比值=1.00x  单行 OK
```

修复前 30px（2 行）→ 修复后 15/16px（1 行，与数值 `<b>` 等高，比值 1.00x），量化反驳「还是竖排」。

### 两个视口复核

- 竖屏方向键左下 (x12,y644)，右侧空白**刻意保留**给平台注入的「返回平台」按钮（右下角控件检测为空）。
- 横屏方向键改为贴画布左下角（left/bottom 各 8px，x196/y226），对齐画布坐标系原点，不再悬在棋盘中部无轴线归属；右下角同样留空。

### 复验

- `pnpm build` 通过（tsc 无错，12 modules，1.29s）。
- `mobile-check`：3/3 PASS，`err=0 overflowX=0`，minTap 三视口均 44px。截图 `sokoban-portrait.png` / `sokoban-landscape.png` / `sokoban-desktop.png` 重新生成。
- `git status --short`：`M .agents/context/current-state.md`、`M index.html`、`M src/main.ts`、`M src/scene.ts`、`M src/style.css`；无 commit/push。

