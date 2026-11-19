# 进度台账

> 按日期追加，不覆盖历史。

## 2026-11-17

- 建立工作区：`AGENTS.md` + `docs/需求规格-v0.1.md` + 本台账。
- 需求收集完成（两轮问答，共 8 项决策）：
  - 形态选 **2.5D 立体棋盘**：2D 网格 + 经典规则，用 three 做立体岩块与透视相机；不做 N³ 真三维。
  - 技术栈选**零构建 + 本地 three.js**（与 `3D经典贪吃蛇` 同形态）。
  - 难度按经典原版：9×9/10、16×16/40、30×16/99。
  - 输入：桌面标准（左键挖、右键旗、拖拽旋转、滚轮缩放）。
  - 风格：矿洞岩层 + 铜色数字。
  - 功能：计时/雷数/最佳成绩、首击安全 + 0 连锁、撤销与提示各 3 次、代码合成音效、爆炸/烟花/扬尘、种子分享。
- 已实现并浏览器验收：
  - 规则层 `src/logic.js` + 17 项 `node --test` 全绿（布雷确定性、首击安全、连锁、旗子上限、胜负、撤销、提示、种子）。
  - 渲染层：程序化岩石/土壤/铜数字/焦痕贴图，石块下沉、数字弹出、扬尘、爆炸粒子、镜头抖动、胜利烟花。
  - 相机：包围球取景 + 球坐标阻尼；菜单态视点左移让出左侧面板，样品棋盘自动环绕。
  - UI：HUD、难度卡片（含各档最佳）、结算面板、练习局标记、分享链接、音效开关、重开。
  - 计时改为**真实时间轴**（`performance.now()` 差值），修掉「后台标签页 rAF 被节流导致计时不走」的坑。
  - 过场动画改成只动 transform 不动 opacity：后台标签页冻结 CSS 动画时面板也不会隐形。
  - 撤销规则收紧：首击不占撤销次数（否则会退回空盘）。
- 实测踩坑记录：
  - 岩石贴图本身偏暗时再乘深色材质，反照率会压到接近 0 —— 贴图负责明暗，材质颜色要接近白。
  - 数字平面偏移是错觉：辉光 + 透视导致；用线框盒与中心标记确认了平面几何、UV、位置都正确。
  - 无头/后台标签页里 `requestAnimationFrame` 被节流，不能用来验证计时与 CSS 动画。
- 待办：
  - `git init` + 推 Gitea 远端。
  - 截图进 `docs/screenshot.png`。

## 2026-11-17（续）

- 版本管理已初始化：
  - 本地 `git init -b main`，首次提交 `0401f2a`（25 个文件）。
  - 远端私有仓库 `http://panyunmeng.cn:3000/panyunmeng/3d-sao-lei.git`，`main` 已推送并建立跟踪。
- 收尾修复：
  - 胜利后剩余雷自动插旗，`flags` 置为雷数、HUD「剩余雷数」归零（之前会停在 10）。
  - 首击不占撤销次数；撤销/提示的可用性统一由 `refreshHud()` 依据规则层状态计算。
  - 分享复制失败改为不阻塞的提示条（不再弹 `window.prompt`）。
  - HUD 增加「重开本局」按钮。
- 待办：
  - 触屏交互（长按插旗、双指缩放）未做——本版按桌面端交付。
- 收尾修复（二）：
  - `npm test` 改成 glob（`node --test "tests/*.test.mjs"`），Node 24 下传目录会被当模块解析而报 MODULE_NOT_FOUND。
  - 提示条改为无透明度过渡，后台标签页冻结 CSS 过渡时也不会「有内容但看不见」。

## 2026-11-17（自主决策轮）

- 补上经典扫雷的**和弦展开**（规格 R13 / I2b / A13）：已挖开的数字格双击或中键，旗数与数字相符时一次展开其余未插旗邻格；旗数不符无动作；旗插错按踩雷处理。一次和弦只占一个撤销快照。
- 修一个真 bug：`Board.pick` 原来只对未挖开的岩块做射线拾取，已挖开格（和弦的目标）根本选不中——拾取集合改为「岩块 + 底板」，按可见性过滤。
- 重开本局改为**保留当前视角**（只有换难度/从菜单开局才复位机位）。
- 新增浏览器回归页 `tests/browser/interaction-test.html`：同源 iframe 跑真实游戏，派发 PointerEvent 断言 HUD，覆盖右键插旗、插旗格左键不挖、双击/中键和弦、拖拽不误挖、提示、撤销、重开、滚轮、回菜单，当前 18/18 全绿。
- 单测从 17 项增至 20 项（和弦三项：正常展开/旗数不符/错旗踩雷）。
- 记录：后台标签页里 setTimeout 被节流到约 1s，异步双击会超出 350ms 判定窗口；回归页改用同步连发两次点击来稳定测试。

## 2026-11-17（自主决策轮·收尾）

- 前面两处「待办」均已完成：本地 git + Gitea 远端已推送，`docs/screenshot.png` 已换成带旗帜的对局截图。
- 剩余唯一未做项：触屏交互（长按插旗、双指缩放），按需求收集时的选择「桌面端」保持范围外，不算缺口。

## 2026-11-18 22:25 — 移动端适配（task-4）

- 用户裁决口径：触屏操控 + 响应式 HUD + 竖屏可玩，桌面 1440×900 不退化。容器层共享规范 `.agents/context/mobile-spec.md`。
- 改动文件清单（只改 `3D扫雷/` 内，零 DOM/three 规则层 `src/logic.js` 一行未动）：
  - `src/main.js`：新增 Pointer Events 触屏分支，与既有鼠标分支并存。
  - `styles.css`：新增 `@media (pointer:coarse)` 把图标/按钮抬到 44px；`@media (max-width:520px)` 竖屏 HUD 两行网格（信息行 + 6 图标按钮整行），`@media (max-height:460px) and (orientation:landscape)` 横屏矮屏收紧；`#app` 用 `100dvh` + `env(safe-area-inset-*)`。
  - `index.html`：菜单规则列表加一条触屏说明（`.touch-only`，仅粗指针显示）。
  - `tests/browser/interaction-test.html`：新增触屏 helper（touch / longPress / twoFingerTap / pinchApart）与 6 项触屏用例；总项数 18 → 24。
  - `docs/需求规格-v0.1.md`：交互表补 I9/I10/I11（长按插旗、双指轻点和弦、双指捏合缩放），从「明确不做」移除触屏条目。
- **长按阈值 = 400ms**，理由（第一性原则）：规范给 350～450ms 取中段；快速点按挖开时长一般 <200ms，400ms 与它拉开一倍以上不误插旗；再长手指等待烦躁；且与既有 350ms 双击判定窗口分离，避免「想双击和弦」被长按抢走。
  - **不误挖保证**：长按定时器到点即置 `drag.longPressFired = true` 并清掉 `lastClick`；`pointerup` 的触屏分支把 `longPressFired` 列为三条互斥出口之一（另两条：`moved`、场上还有别的指头），任一为真直接 `return`，绝不走到 `reveal(i)`。定时器内部还复核 `drag.id` / `touches.size` / `moved`，跨状态（换局/暂停/回菜单）由 `clearGestures()` 统一清掉在手手势。
  - 长按对已挖开格走 `toggleFlag` → `logic.js` 返回 `revealed` 拒绝（与右键一致），不插旗也不挖开。
- **和弦触屏路径 = 双指轻点该格**：选它而非「长按数字格」，因为 I9 已把长按统一给插旗（已挖开格也按 toggleFlag 语义），长按不能再挪作和弦。判据：两指间距变化 ≤12px、各自位移 ≤10px、时长 ≤450ms；走既有 `doChord`。
- **缩放 = 双指捏合**：间距变化 >12px 才按增量调 `stage.zoomBy`；`pointermove` 在双指分支里 `return`，不 orbit、不 hover 拾取；`pointermove` 的 hover 回调也加了 `touches.size > 1` 守卫；`pointerup` 双指分支单独处理（轻点和弦 or 空操作），不落到单指挖开逻辑。
- 验证结论：
  - `node --test "tests/*.test.mjs"`：**20/20 pass**（logic.js 未改，规则单测保持原数）。
  - `mobile-check.mjs --name minesweeper --dir "3D扫雷" --enter "document.querySelector('#levels .level-card, #levels button').click()"`：三视口 **3/3 PASS**，err=0 / overflowX=0 / cover=100% / minTap=114～116px（≥44）；截图落 `.agents/work/mobile/minesweeper-{portrait,landscape,desktop}[-play].png`。
  - 浏览器回归页（CDP 打开，`node scripts/serve.mjs 5502`）：**PASS 24/24**（原 18 项全保留，新增 6 项触屏用例全绿）。
  - 375×812 对局态 DOM 实测：6 个 HUD 图标按钮均 **44×44px**、全部在视口内、HUD 仅占顶部 112px（13.8%）；对截图做像素分析：棋盘横向 CSS x34～330、纵向 y300～530，完整落在 HUD 下方且无横向裁切。本模型无图像输入通道，`read_image` 返回"model does not declare image input"，改以 DOM 量测 + 像素统计替代目视验收。
- 已知不足：
  - `minTap` 数值（114～116px）是在菜单态量的（HUD 此时隐藏），量到的最大值来自难度卡片而非图标按钮；图标按钮的 44×44 由单独的对局态 DOM 实测确认。
  - 三指及以上手势被显式忽略（不解释任何棋盘操作），避免半截手势误触发；此为取舍，非缺陷。
  - 双指轻点与捏合的区分依赖 12px/10px 位移阈值，极小幅度的「轻点+微抖」理论上可能被判成轻点而非缩放，实测中未复现。
