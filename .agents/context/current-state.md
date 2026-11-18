# 进度台账

## 2026-11-17 首版可玩

**已完成**
- 玩法矩阵：无尽 / 关卡制 × 撞墙即死 / 穿墙，菜单内选择，最高分按四种组合分别存储。
- 三种道具（加速 / 减速 / 限时）与随难度增长的障碍；关卡制有目标数、倒计时与过关结算。
- 表现：Three.js r170 本地化，果冻材质（圆角块 + 环境反射 + 呼吸缩放）、发光棋子、
  粒子与冲击环、相机拖拽旋转/滚轮缩放/双击复位、传送门能量幕。
- 输入按相机方位投影；暂停/重开/静音；开局 900ms 缓冲 + 出生点下移。
- 自动化验证：`node --test tests/*.test.mjs` 共 24 条全绿（20 条规则 + 4 条机器人长局不变量）。

**实测结论（浏览器 1280×800，Chromium）**
- 相机 `radius=40 / phi=0.95 / fov=38` 时 21×21 整盘完整入画，默认视角无切边。
- 蛇身块尺寸 1.0 / 圆角 0.26 时相邻块贴合，无缝隙；眼睛放在顶面前部才在俯视角度可见。
- 穿墙模式若只画贴地细边几乎看不见，加 1.0 高的加性渐变能量幕后清晰可辨。
- 关卡制「时间不够」的根因是开局只有 10 格反应距离（≈1.7s），不是限时太短。

**待办 / 可选**
- 触屏虚拟摇杆（当前只支持拖拽转视角）。
- 关卡通过/结算的端到端可视化回归（逻辑层已被模拟器覆盖，UI 仅人工验过）。
- 音效只在 Chromium 手测，未做多浏览器核对。

## 2026-11-18 22:38 — 移动端适配：触屏转向 + 响应式 HUD + 竖屏整盘入画

**用户裁决口径**：触屏操控 + 响应式 HUD + 375×812 竖屏可完整玩一局，桌面 1440×900 不退化。

**触屏方案取舍（选了屏幕方向键，未做画布滑动手势）**
- 选：右下象限十字键（4 个 48×48 CSS px 按钮，8px 间距）。理由（第一性原理）：
  画布已被 `scene.js` 的 pointerdown/move 独占用于相机拖拽与双指捏合；滑动手势必须共享同一
  `pointerId`，还要用距离/时间阈值区分「短拖转视角」与「划动转向」，必然吃掉一部分手势预算
  并带来「拖完相机误转向」的风险。方向键是独立 DOM 目标、独立 pointerId，与相机拖拽零冲突，
  且天然满足 44px 目标规范。
- 方向语义：键盘与方向键都收敛到 `steer()` → `queueDirection(state, screenDirToGrid(name))`，
  没有第二条算法路径。CDP 实测：theta=-0.62 时 上→{0,-1}/下→{0,1}/左→{-1,0}/右→{1,0}；
  相机转到 theta=π/2 后「上」→{-1,0}，证明方向随相机转。
- 用 Pointer Events（pointerdown/up/cancel/lostpointercapture），按住 260ms 后每 150ms 自动重复；
  `touch-action:none` 在画布与方向键上都已设置。

**新增触屏入口**
- 对局中：右下方向键（转向）；HUD 右上动作条：暂停/继续、重开、静音（48×48）。
- 菜单/暂停/结算面板：所有按钮 ≥44px（`.seg-btn` 基样式 min-height:44，primary/secondary 48）。
- 键盘快捷键全部保留，桌面不显示任何触屏控件。

**断点与布局取舍**
- 触屏模式用 `matchMedia('(max-width:720px), (pointer:coarse)')`：兼顾 844×390 横屏（宽 844>720
  但 pointer:coarse）与桌面窄窗口；仅宽度的判断在横屏上会漏掉触屏控件（首版实测暴露并已修）。
- 竖屏相机适配：21×21 盘在 375 宽下原半径 40 投到 NDC x≈±2.2，原上限 62 仍 ≈±1.5，必切边。
  `scene.js` 的 `fitBoard()` 按相机方位二分求「四角恰好入画」的半径（≈110），并把初始俯角改到
  0.5（更俯视，棋盘 283×246 而非压成 156 高的扁条），look-at 下移使棋盘落在 HUD(≤64px) 与
  方向键(≥592px) 之间。宽屏/横屏完全不调用，桌面构图零变化。
- **踩坑**：雾 `Fog(near=36, far=74)` 是按桌面 r=40 调的；竖屏把相机拉到 r≈110 后整盘被雾吞成
  背景色，截图近乎全黑而 mobile-check 仍 PASS（canvas coverage 只看 canvas 元素）。已在
  `fitBoard()` 里把雾距随半径同步拉开并写回，截图中心像素从 (7,10,20) 恢复到 (52,68,119)。
- 所有新增数值参数（断点、俯角、半径上限、重复间隔等）集中在 `src/config.js` 的 `MOBILE`；
  `src/logic.js` 一行未改（`git diff --stat` 空）。

**验证结论**
- `node .agents/work/tools/mobile-check.mjs --name snake --dir "3D经典贪吃蛇" --enter "document.getElementById('start').click()"`
  → 三视口全 PASS：portrait / landscape / desktop 均 `err=0 overflowX=0 cover=100.0% minTap=44px touch-action=none`（改造前 minTap=41）。
- `node --test tests/*.test.mjs` → `tests 24 / pass 24 / fail 0`（全绿，未退化）。
- 截图：`.agents/work/mobile/snake-portrait-play.png`、`.agents/work/mobile/snake-landscape-play.png`、
  `.agents/work/mobile/snake-desktop-play.png`（均已生成，非空白）。
- 几何核验（CDP 实测，替代本模型不可用的 read_image）：
  - 375×812：方向键 48px，区域 x=205～361 / y=592～748；平台「返回平台」浮层 x=274～363 /
    y=774～800；二者无重叠（间距 26px）。棋盘 x=48～331 / y=256～502，在可视带内，不压 HUD/方向键。
  - 844×390：方向键 48px，x=674～830 / y=170～326；返回按钮 y=352～378，无重叠；棋盘完整入画。
  - 1440×900：触屏控件隐藏，桌面布局与改造前一致。
- `read_image` 在当前 hy4flash 模型不可用（报 model does not declare image input），改用 Pillow 像素统计
  + CDP 几何测量完成等效目视核验；后续换多模态模型可再目视一次。

**已知不足**
- 画布滑动手势未做（见上方取舍）；用户若明确要「滑动转向」可再加，但要处理与相机拖拽的阈值竞争。
- 方向键为屏幕固定方位，不随相机旋转而在盘面上移动；语义通过 `screenDirToGrid` 跟随相机，手感上仍是固定按钮。
- 音效仅 Chromium 手测，未做多浏览器核对（沿用首版结论）。

## 版本管理

- 本地仓库：`main`，首次提交 `0349bd3`（✨ 3D 贪吃蛇首版可玩）
- 远端：http://panyunmeng.cn:3000/panyunmeng/3d-jingdian-tanchishe （私有，默认分支 main，已建跟踪）
- 仓库名按 Gitea 的 AlphaDashDot 规则转写为 `3d-jingdian-tanchishe`，中文原名写在仓库描述里
