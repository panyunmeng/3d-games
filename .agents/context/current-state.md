# 当前进度台账

## 2026-11-17 首版可玩版

### 已完成

- 单文件交付链：`src/shell.html` + `src/core.js` + `src/game.js` + `vendor/three.min.js`
  + `vendor/RoundedBoxGeometry.js` → `python build.py` → `index.html`（约 670 KB）
- 规则：经典 10×20 判定、SRS 四态 + 踢墙表、7-bag 随机、幽灵落点、
  下一块三连预览、Hold（每块限一次）、锁定延迟 500 ms + 15 次重置、等级 1～20 重力表
- 计分：单/双/三/四消、T-spin full/mini、back-to-back ×1.5、连击 50×combo×等级、软降 +1、硬降 +2
- 渲染：圆角积木 + 深色井道 + 网格锚点 + 幽灵线框 + 消行白光 + TETRIS 镜头轻震；
  固定斜俯视相机，指针拖动 ±0.55 rad 微转（不参与判定）
- 交互：方向键/AD 移动（DAS 150 ms + 45 ms 连发）、↑/X/W 顺转、Z/Ctrl 逆转、
  ↓ 软降、空格硬降、C 暂存、P/Esc 暂停、R 重开、M 静音、切后台自动暂停
- 音效：WebAudio 实时合成 8 种（移动/旋转/落地/暂存/消行/升级/结束/开局），手势门控、静音持久化
- 界面：中文 HUD（分数/等级/消行/最高）、下一块 + 暂存预览画布（DPR 自适应）、
  开始/暂停/结束覆盖层、连击与 T-SPIN 提示
- 调试入口：`?selftest=1`、`?demo=1`、`?scenario=tetris`、`?autoplay=N`、`?fps=1`、`?seed=N`

### 已验证（证据）

- `npm run check`：`node --check` 两个源文件通过；内核单测 **25/25 全绿**
  （形状四态自洽、踢墙表 8 方向、7-bag 每袋不重不漏、消行下落、计分六类、
  T-spin full/mini、等级换算、锁定延迟、400 步随机对局不变量、同种子序列一致）
- `?selftest=1`：**6/6 PASS**，随机对局 400 步无异常，WebGL 上下文可用、有绘制调用，
  自检耗时 1 ms。截图：`.agents/work/visual/20261117-selftest.png`
- 帧率：`?fps=1` 实测 **120.0 fps**（显示器 120 Hz，`playing` 状态）。
  截图：`.agents/work/visual/20261117-fps120.png`
- 真实键盘路径：空格开局 → ← ← → 旋转 → 空格硬降，分数 0→22（11 格 × 2 分），HUD 同步
- 四连消：`?scenario=tetris` 按一次空格，分数 3200→4810、消行 16→20、等级 2→3
- 完整一局：`?autoplay=60` 自然顶到出生点 → 「游戏结束」覆盖层、最高分落 `localStorage`、
  「再来一局」可重开
- 控制台：正常对局与自检均无 error（音频警告已由手势门控消除）
- 目视截图：`.agents/work/visual/20261117-gameplay.png`（糖果积木 + 幽灵落点）、
  `.agents/work/visual/20261117-start.png`（开始界面）

### 待办 / 未验证

- 未做触控操作：移动端只有布局自适应，没有手势与虚拟按键（用户未选该需求）
- 没有背景音乐（当前只有合成音效）
- 窄屏真机未测：相机 `fitCamera()` 按宽高比取 max 距离，但没在手机竖屏上截图核对
- T-spin 只验了构造用例与判定函数，没有在真实对局里打出 T-spin double 的录像
- 无最高分榜（只有本地单条最高分）

## 2026-11-17 第二轮：把「未验证」逐条变成证据

### 已完成

- 新增 `src/framing.js`：取景几何抽成纯函数，窄屏是否裁掉井道不再靠肉眼，变成 5 条断言
- 新增调试入口：`?scenario=tspin`（T-spin double 局面，冻结）、`?scenario=full`（154 块满盘）、
  `?bench=N`（每帧 `gl.finish()` 的帧耗时基准）、`?soak=N`（同步虚拟时间浸泡）
- 已固定方块改为 `InstancedMesh`：满盘 draw call 从约 160 降到 21
- 修掉的真实缺陷：
  1. 调试局面没冻结，500 ms 锁定延迟在截图前就把 T-spin 局面自己锁掉（加了 `scenarioHold`）
  2. `?soak` 机器人只在贴地后硬降，等于干等重力，120 秒只落 2 块（改为定时强制硬降）
  3. `?scenario=full&bench` 因启动分支顺序错误，测到的是空盘（先把场景建好再跑基准）
  4. 重写浸泡时把 `runBench` 整段删掉，bench 分支静默失效（补回并复验）
  5. `frame()` 里残留的实时浸泡统计已删除

### 已验证（证据）

- 单测 30/30：内核 25 + 取景 5（宽高比 0.4～3.0 均不裁切，且窄屏受宽度约束、宽屏受高度约束）
- 帧耗时基准（满盘 154 块、21 次 draw call、95,330 三角面）：**0.26 ms/帧，等效 3778 fps**
  —— 60 fps 有约 60 倍余量。截图：`.agents/work/visual/20261117-bench.png`
- 浸泡 36,000 帧（600 秒虚拟时间）：40 次四连消、459 次落块、6 局、**0 错误、0 MB 堆增长**，
  0.24 ms/帧。截图：`.agents/work/visual/20261117-soak.png`
- T-spin double：`?scenario=tspin` 按 ↑ 后空格，**正好 1200 分**、消 2 行、「T-SPIN」提示可见。
  截图：`.agents/work/visual/20261117-tspin.png`
- 自检 6/6 复验通过。截图：`.agents/work/visual/20261117-selftest.png`
- 浏览器自检与正常对局控制台均无 error

### 重要的方法教训

- 无窗口 Chromium 里标签页永远算「后台」，`requestAnimationFrame` 被节流到几 Hz。
  我因此一度读到「满盘 100 fps」的假数据，并据此做了无用的 draw call 优化。
  **性能只认 `gl.finish()` 基准**，这条已写进 `constraints/delivery.md`。

### 待办 / 未验证

- 仍未做触控（用户未选该需求，未擅自扩大范围）
- 取景数学已被单测覆盖，但真机竖屏截图仍未做过
- 没有背景音乐

## 版本管理

- 本地仓库：`git init` + 首次提交 `1f520a5`（main）
- 远端：`http://panyunmeng.cn:3000/panyunmeng/3d-eluosifangkuai.git`（私有，默认分支 main）
- 仓库名按 Gitea 的 AlphaDashDot 规则转写拼音：`3D俄罗斯方块` → `3d-eluosifangkuai`
  （与同系列 `3d-dazhuankuai`、`3d-sao-lei` 的命名风格一致）
- `.agents/` 一并入库：约束与台账是工程的一部分；`work/visual/` 里的截图是验收证据

## 2026-11-18 22:30 — 移动端适配（触屏 + 响应式 HUD + 竖屏可玩）

### 方案与取舍（第一性推导）

- **触屏入口**：8 个 54px 按钮（左右移动 / 顺转 / 逆转 / 软降 / 硬降 / HOLD / 暂停）。
  旋转与硬降是明确按钮而非手势——方块落点要格级精度，误触无法撤销；
  移动用「按钮 + DAS 连发」而非横滑——横滑和既有的「拖动微转视角」抢同一根手指，
  且滑动距离到格数没有一一对应关系。多点用 `pointerId` 区分，双指「按住移动 + 点旋转」互不覆盖。
- **不让井道被 HUD 压住**：`game.js` 加 scissor 取景带 `computeViewportBand()`，
  上/下（竖屏）或左/右（横屏）边界量真实 DOM 盒子，带子宽高比交给未改动的 `framing.js`，
  用 `renderer.setViewport/setScissor` 只往带子里画。这样井道和 HUD 物理隔离，
  不用猜常数，也不牺牲取景单测的覆盖。
- **右下角保留**：触控区 `right:82px`（竖屏）/ `right:90px`（横屏），
  给平台注入的「返回平台」按钮留位；音效按钮并入 HUD 顶部，不再独占右下角。
- **touch-action**：`#cv` 显式 `touch-action:none`（baseline computed 是 `auto`），
  触控按钮也 `touch-action:none`。

### 改动文件

- `src/shell.html`：viewport 加 `user-scalable=no`；加 `#controls` 一组触控按钮；
  HUD 竖屏把 next/hold 横排收紧高度、横屏左右分置并垂直居中；
  `.btn` / `#soundBtn` 最小 44～48px；覆盖层 `max-height:88dvh;overflow:auto`。
- `src/game.js`：加取景带几何与 `renderScene()` scissor 渲染；
  加 Pointer Events 触控输入（复用既有 `held/das` 状态机，与键盘同构）；
  预览画布尺寸随 CSS 变化自动重算 DPR；暴露 `__band` / `__game.camera` 供自动化量几何。
- `index.html`：由 `python build.py` 重建，**696641 bytes**（未手改）。
- `src/core.js`、`src/framing.js`：未改。

### 验证结论（原始输出见汇报）

- `npm run check`：**30/30 全绿**（3 个 `node --check` + 内核 25 + 取景 5）。
- `python build.py`：`index.html 696641 bytes`。
- `mobile-check.mjs`（三视口）：**3/3 PASS**，errors=0，overflowX=0，
  `minTap=44px`，`touch-action=none`。
- `?selftest=1`：**6/6 PASS**（54 步随机对局、值域、分数、WebGL、绘制调用 20、2ms），控制台 0 error。
- 几何量化（真实投影井道 8 角 + DOM 盒子）：
  - 竖屏 375×812：井道 x=65～311、y=164～652；HUD 侧栏底 140、按钮顶 686，四周留 24～34px，无重叠。
  - 横屏 844×390：井道 x=375～522、y=17～311；左分数栏右边 149、右预览栏左边 748、按钮顶 334，无重叠。
  - 桌面 1440×900：井道 x=548～935、y=33～804，HUD 在两侧，未退化。
- 触屏按钮真机事件（CDP `Input.dispatchTouchEvent`）：左右移动 x 3→0→1、顺转 rot 0→1、
  逆转 rot 1→0、软降 y 15→14 且分数 +1、硬降分数 +32、暂停 playing→paused，**0 异常**。
- 三视口截图：`.agents/work/mobile/tetris-{portrait,landscape,desktop}{-play}.png`（工具生成，未入库）。

### 已知不足

- 本 agent 所用模型不支持 `read_image`，无法目视截图；改用 CDP DOM 几何与井道投影量化替代，
  结论是「几何上互不重叠且井道完整落在取景带内」，与人工目视仍有细微差异（例如配色观感）。
- 横屏井道偏窄（约 147px 宽）——2:1 井道在 390px 高视口内的几何必然，面板已收到两侧。
- 双指缩放/手势旋转未做（规范要求的是按钮入口，已满足）。
- 未做触屏长按连发速度调节（当前复用键盘 DAS 150ms + 45ms）。
