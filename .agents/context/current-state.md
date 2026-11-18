# 当前进度台账

## 2026-11-17 首版可玩版

### 已完成

- 单文件交付链：`src/shell.html` + `src/game.js` + `vendor/three.min.js` → `python build.py` → `index.html`（约 661 KB）
- 玩法：XZ 平面物理，透视俯视相机，砖墙 10 列 × 最多 7 行纵深
- 操作：鼠标 / 触摸绝对定位挡板，落点决定反弹角（±62°），键盘 A/D、方向键同样可用
- 系统：分数 + localStorage 最高分、3 条命、5 个手写关卡 + 无尽程序化关卡、
  3 种道具（加宽 W / 多球 M / 加速 S）、粒子特效、WebAudio 合成音效、
  暂停（P/Esc，切后台自动暂停）、静音（M，持久化）、全屏（F）、重开（R）
- 血量表达：正面装甲亮带（2 血 1 条、3 血 2 条）
- 调试入口：`?selftest=1`、`?level=N`、`?demo=1`

### 已验证（证据）

- `?selftest=1`：16 条断言全绿。关键数据：25 秒自动对打击碎 21～23 块、得分 285～305、
  无 NaN、无越界、无隧穿；多球 3 颗且不超 6；加宽 3.20→4.96 且到期还原；
  接住道具触发加宽并移除；命耗尽进 gameover 且最高分落 localStorage；过关生成新关卡砖块。
- 目视：`.agents/work/visual/20261117-demo-fx.png`（三球 + 粒子 + 道具图标 + buff 徽标）、
  `.agents/work/visual/20261117-level3-armor.png`（装甲亮带 + 多层砖墙）
- 构建产物语法：`node --check src/game.js` 通过；`index.html` 在 Chrome 里 file:// 直开无控制台报错

### 待办 / 未验证

- 窄屏竖屏（手机）真机未测：`camera.fov` 有 46/56/68 三档自适应，但没有真机截图证据
- 移动端触摸手感（手指遮挡、灵敏度）未调；当前是屏幕横向满幅线性映射
- 音效只在有声环境下主观听过，未做音量均衡与移动端静音键行为核对
- 无尽关卡的程序化排布只用过 `procLevel` 默认参数，未做耐玩性评估

### 踩过的坑（避免重复）

1. `ColorManagement.legacyMode` 默认 true → 整画面抬亮一档，霓虹配色被冲成粉彩。
2. 粒子只在 `updateParts` 里写实例矩阵 → 生成当帧零缩放、肉眼看不见；生成时就要写一次矩阵。
3. 后台标签页 rAF 被节流到几 Hz，靠截图判断球速会得出「球走得太慢」的错误结论；
   物理验证必须走 `?selftest=1`。
4. `build.py` 的 `</script` 检查不能套在 shell 模板自身（模板本来就有 script 标签），只查被注入的 JS。

### 版本管理

- 本地仓库：`git init` 于 2026-11-17，分支 `main`，首次提交 `4b82d0d`
- 远端：http://panyunmeng.cn:3000/panyunmeng/3d-dazhuankuai （私有，默认分支 main；仓储名按 AlphaDashDot 转写）
- 已建立跟踪：`main` → `origin/main`，本地与远端 SHA 一致

## 2026-11-18 22:35 — 移动端适配（触屏操控 + 响应式 HUD + 竖屏可玩））

### 用户裁决口径
- 目标：触屏操控 + 响应式 HUD + 375×812 竖屏可完整玩一局；1440×900 桌面不退化。
- 不改物理与判定；`?selftest=1` 16 条不变式必须全绿。
-交付物只有 `index.html`（`python build.py` 生成），本轮只改 `src/game.js`、`src/shell.html`，重建 `index.html`。

### 触屏补偿方案与依据（至关重要，勿拍脑袋回退）
- **鼠标**：保持原「屏幕横向绝对映射」语义不变（桌面手感零退化）。
- **触摸**：改为「按下即抓取挡板」的**相对拖动** + 垂直遮挡补偿。
  - 根因：原实现 `pointerdown` 直接把挡板瞬移到指尖横坐标；手指本身就盖在挡板/来球正上方，
    玩家看不到挡板也看不到球落点（就是用户说的「手指遮挡」）。改用相对拖动后，
    手指可落在挡板下方空白处，挡板保留在指尖上方的可见区域——这就是「落点上抬/遮挡补偿」的实现：
    **不在 vertical 轴做任何映射（挡板 Z 固定），只在 horizontal 用相对位移 + 按下点抓取。**
  - 补偿比例 `MOVE_K = 0.92`，推导：世界总宽 `2*HALF*1.02`，画布宽 `r.width`，
    原生绝对映射斜率 `2*HALF*1.02 / r.width`（世界单位/px）；相对拖动沿用同一斜率后乘 0.92，
    即 1px 手指移动 ≈ 0.92 个「绝对映射等价世界单位」。留 8% 余量让拇指不必贴屏幕边缘就能打满全场。
    竖屏 375px 档：`dragK ≈ 16.32/375*0.92 ≈ 0.040 世界单位/px`，全宽拖动 `375*0.040 ≈ 15` 世界单位，
    覆盖场地全宽 `±8`，够用；横屏 844px 档斜率更小更精细。
  - 多指：`pointerId` 只认第一根按下手指，后续手指不抢挡板（`if (dragging) return`），
    `pointerup/pointercancel/blur` 按 id 释放；符合 mobile-spec §1.6。
  - 触摸期间不滚动：`html,body` 与 `#cv` 均 `touch-action:none`，canvas 全屏覆盖；
    按钮 `touch-action:manipulation`（不挡双击缩放策略）+ pointerdown 对 `#iconBar`/`#overlay` 做 `closest` 排除。

### 触屏入口
- 开始/继续/下一关：`#ovBtn`（overlay 主按钮，min-height 48px）。
- 发球：触摸画布任意处（serve 态 pointerdown → launch）。
- 暂停/继续：`#btnPause`；静音：`#btnMute`；全屏：`#btnFull`；**新增重开 `#btnRestart`** —— 四个按钮 48×48px。
- 键盘说明保留：footer 与 overlay keys 文案改成「手指滑动 / 鼠标」+「点击 / 空格」，并保留 P/R/M/F。

### 断点与布局
- `@media (max-width:520px)`：面板收紧内边距 16px、overlay 可滚动、HUD 字号/间距收紧、footer 隐藏（说明已在 overlay，底部让位）。
- `@media (max-height:480px) and (orientation:landscape)`：面板纵向压缩、keys 改 3 列、footer 隐藏。
- `#iconBar` 从右下移到**左下**（`left:calc(14px + safe-area)`），右下角完全留给平台注入的「返回平台」按钮。
- `100dvh`：当前 `html,body{height:100%;overflow:hidden}` + canvas `position:fixed;inset:0` 已等价铺满视口，未改。

### 验证结论（原始输出摘要）
- `node --check src/game.js` → exit 0；`python build.py` → `index.html 665384 bytes`。
- `mobile-check --name breakout --dir "3D打砖块" --enter "document.getElementById('ovBtn').click()"`：
  - `PASS breakout/portrait   err=0 overflowX=0 canvas=750  cover=100.0% minTap=48px touch-action=none`
  - `PASS breakout/landscape  err=0 overflowX=0 canvas=1688 cover=100.0% minTap=48px touch-action=none`
  - `PASS breakout/desktop    err=0 overflowX=0 canvas=1440 cover=100.0% minTap=48px touch-action=none`
  - `[breakout] 3/3 视口通过`
- `?selftest=1`（CDP 读 console）：title `PASS · 3D 打砖块 自测`，`[selftest] ALL PASS 16`，hard errors 0。
  16 条逐条：A1 无 NaN / A2 不越界 / A3 不穿砖 / A4 碎砖 30 / A5 计分 777 /
  B1 多球 6 / B2 上限 6 / C1 加宽 4.96 / C2 还原 3.20 / D1 gameover / D2 命 0 /
  D3 最高分落盘 / F1 接道具 wideT=14 / F2 道具移除 / E1 过关 level=2 / E2 新关砖 38。
- 截图：`.agents/work/mobile/breakout-{portrait,landscape,desktop}[-play].png` 共 6 张（工具生成，未手改）。

### 目视验收（read_image 不可用，改用程序化像素分析）
- 当前模型不支持图像输入（`read_image` 报 model hy4flash does not declare image input），改用 `Pillow+numpy` 像素分析
  （脚本 `.agents/work/inspect_shot.py`/`inspect_all.py`，过程文件在 .gitignore）。
- `breakout-portrait-play.png` 750×1624：挡板青色像素 29299，bbox x[230,519] y[1133,1563]（下半场清晰可见）；
  球近白像素 1156，bbox x[350,388] y[1133,1172]（正好在挡板上方）；HUD 亮像素 782 全在顶部 15%；
  右下角亮 UI 像素 0（平台返回键区干净）；左下 7 个亮簇 = 4 个 48px 按钮；左右边缘色连续无横向出血。
- 三视口 × 菜单/对局 6 张图：底部右侧亮像素均为 0；无 HUD 下溢、无按钮重叠。

### 已知不足
- `read_image` 在此模型不可用，未能用模型视觉通道直接看图；已用像素分析替代并给出可复核脚本与结论。
- 手指遮挡补偿只做横向相对拖动（挡板 Z 固定，无需纵向映射）；未做「指下放大镜/虚拟摇杆可视化」。
- 真机多点触控（两指同时拖 + 点按钮）未实机验证，只做了 pointerId 逻辑防护。
- 平台注入「返回平台」按钮的真实位置/尺寸未在集成环境联调，本轮仅按规范把 iconBar 让出右下角。
