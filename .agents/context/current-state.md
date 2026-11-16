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
