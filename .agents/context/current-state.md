# 进度台账 · 3D 塔防

## 2026-11-17

### 需求确认（三轮提问的结果）

| 维度 | 结论 |
| --- | --- |
| 引擎 | Three.js + TypeScript + Vite（网页版，桌面浏览器） |
| 交付 | 一期本地验收；**二期静态部署到 NAS 联网访问** |
| 美术 | 全程序化（几何体 + Canvas 贴图 + Web Audio 合成音效），零外部资源 |
| 玩法 | 固定路线 + 预设建造点；4 塔 × 3 级线性升级 |
| 敌人 | 地面 + 空中，含护盾 / 分裂 / 高速等特殊属性 |
| 规模 | 3 关 × 10 波，三档难度，无尽模式，星级评价，localStorage 存档 |
| 镜头 | 固定 45°～52° 俯视，可缩放平移 |

### 已实现

- 模拟层与渲染层分离：`game/simulation.ts` 固定 1/60 步长，不依赖 DOM / Three.js。
- 四塔三级的数值、瞄准（优先最靠近基地的敌人）、弹道表现（tracer / shell 抛物线 / 连锁闪电 / 激光）。
- 八种敌人：步兵、疾行、重装（45% 减伤）、空中、护盾（脱战回盾）、分裂（死后裂两只）、子体、BOSS。
- 三关地图（铁锈峡谷 / 熔渣工厂 / 极光要塞），建造点由「距路径 3.2～8.5 米、沿路径等距、最小间距 6 米」规则程序化生成，固定可复现。
- 完整 UI 壳：主菜单 / 选关（难度页签、星级、解锁）/ HUD（金币、生命、波次进度、提前召唤、倍速）/ 选中塔面板（升级、出售）/ 暂停 / 结算 / 设置 / 操作说明。
- 存档：关卡星级、解锁进度、无尽最佳波次、音量与画质设置。
- 表现：Bloom 后期、阴影、敌我地面标记环、爆炸 / 碎片 / 电弧 / 激光束、血条与护盾条。
- 音效：Web Audio 实时合成（射击、爆炸、建造、升级、波次、胜负等 17 种）。

### 平衡（tools/balance.ts 无头跑出来的结果）

- 简单：三关 0 漏怪通关。
- 普通：三关全部通关，0～1 漏怪，剩 15～20 命。
- 困难：第 1、3 关第 8 波后失守；第 2 关剩 4 命通关。
- 关键参数：波次血量线性 `1 + 0.16*(wave-1)`；难度血量 ×〔0.8 / 1.0 / 1.45〕；建造点上限 13 个；
  升级造价约为塔价的 0.95～1.6 倍，是主要金币池。

### 验收记录

- `pnpm typecheck` 通过；`pnpm build` 产出 `dist/`（JS 648 KB / gzip 167 KB）。
- 把 `dist/` 放到子路径 `/game/` 用静态服务器访问，页面与资源加载正常 → 二期 NAS 子目录部署可行。
- 浏览器实测：主菜单 → 选关 → 建塔 → 开波 → 击杀 → 提前召唤 → 暂停 → 设置 → 结算（胜负）→ 下一关 → 无尽模式，全流程通过。

### 版本管理

- 本地 git 仓库：`main` 分支，首次提交 `f5b6aa6`（emoji + 中文）。
- 远端：`http://panyunmeng.cn:3000/panyunmeng/3d-tafang.git`（私有），已推送并建立 `[origin/main]` 跟踪，
  远端 SHA 与本地一致。

### 2026-11-17 第二轮修正（浏览器实测后）

- 修 `ribbon()` 三角缠绕方向错误（法线朝下导致路面被背面剔除，只剩两侧光带）。
- 修敌人血条挂在会旋转的敌人节点下、被父节点 Y 轴旋转成侧视（现改为独立 billboard）。
- 修准备阶段 `step()` 提前 return 导致 `lives<=0` 不判负。
- 飞行单位旋翼由交叉薄板改成半透明桨盘（原来 4 个桨叶在俯视下像一排白色十字）。
- 敌我尺寸整体放大（塔 ×1.55、敌人 ×1.9），建造点同步放大到半径 2.4 米，间距 6 米。
- 平衡：建造点上限 16 → 13，升级造价上调，金币收益下调，波次血量斜率 0.07 → 0.16。

### 2026-11-17 第三轮（自主推进）

- 加 BOSS 血条（HUD 顶部，显示「督军机甲 7808 / 7808」与两条渐变血槽）、首领击破横幅。
- 选中塔面板增加「下一级 → 伤害/射速/射程/DPS」预览行。
- 开发模式右下角帧率读数（实测 39 敌时 104 fps，桌面端无压力）。
- 新增 `tools/endless-check.ts`：铺满 13 塔推到第 30 波，1581 击杀、0 漏、数值有限，无崩溃。
- 二期部署文档 `docs/deploy-nas.md`（rsync/scp/SMB 三种上传 + nginx/Caddy + 验证与回滚）。
- **部署阻塞**：本机 `~/.ssh/id_ed25519` 未写入 NAS `authorized_keys`，非交互 ssh 报
  `Permission denied (publickey,password)`；NAS 主机密钥 2026-11-17 已变更（旧记录备份在
  `~/.ssh/known_hosts.bak-*`），需执行一次 `ssh-copy-id` 才能自动部署。

### 2026-11-17 第四轮（自主推进）

- 新增 `pnpm build:single`：把 JS/CSS 内联成 `dist/standalone.html`（约 650 KB），
  **已用 file:// 实测双击可玩**（主菜单 → 选关 → 建塔均正常），与这系列其它 3D 小游戏同形态。
  副作用：file:// 下 localStorage 可能不可用，存档静默降级，不影响玩。

### 2026-11-17 第五轮（收尾）

- Esc 可直接关闭设置页返回（之前设置页里按 Esc 没反应）。
- 敌人自发光 0.18 → 0.26，暗底上轮廓更清楚。
- 新增 `tools/deploy-nas.sh`：一条命令完成 build + 远端建目录 + rsync 同步。
- 平衡复测与上一轮完全一致，改动只涉及交互与观感。

### 待办 / 下一步

- 二期：把 `dist/` 部署到 NAS（需要用户给静态目录与端口），可选加 HTTPS 反代。
- 手感细节：BOSS 出场位置贴近出生点边界，可能需要把出生点往场内挪；卡片底部间距再收一点。
- 内容扩展（可选）：塔分支升级、更多地图、每日挑战。

## 2026-11-18 22:45 — 移动端适配（触屏 + 响应式 HUD + 竖屏可玩）

> 用户裁决口径：触屏操控 + 响应式 HUD + 375×812 竖屏可完整玩一局，桌面 1440×900 不退化。
> 硬边界：只改 UI / 输入 / 样式；`src/game/simulation.ts` 与 `src/data/` 零改动。

### 触屏入口与怎么触发

| 操作 | 入口 | 实现依据 |
| --- | --- | --- |
| 建塔 | 点发光建造点 | 复用既有 `pointerup`（触屏 `button===0` 天然通用），未重写一套鼠标逻辑 |
| 选中塔 | 点塔 / 点已占用建造点 | 同上，`pickTower` / `pickPad` 都是屏幕坐标投射，不依赖 pointerType |
| 取消选择 | 点空白处 / 选中面板「取 消 选 择」按钮 | 新增按钮，210×44px，绑定 `bridge.deselect()` |
| 升级 / 出售 | 选中面板两个按钮 | 既有按钮，竖屏/横屏内 min-height 44px |
| 单指拖动平移 / 双指捏合缩放 | 画布直接手势 | `view.ts` 的 `bindEvents` 改为 pointerId 跟踪的多指状态机；捏合复用 `zoomBy`（与 wheel 同一通路），中点位移复用 `panBy`；鼠标路径一字未改 |
| 暂停 / 倍速 | 顶部 ❚❚ / 1×2×3× | 均 ≥44px，随上带走 |

画布 `touch-action: none`，index.html 加 `viewport-fit=cover` 与禁整页缩放（双指手势归相机）。

### 断点与布局取舍

- `≤680px && portrait`：上带两行（行1 关卡名 + 金币/生命 + 倍速/暂停；行2 波次进度），
  下带塔栏 4 等分；「开始下一波」固定到塔栏上方左侧 44px。
  实测上带底 148px、下带顶 688px，中间 540px 战场中心 **零 HUD 命中**。
  下带底部留 46px 空白 → 右下角 (363,800) 探测命中 CANVAS，
  平台注入的「← 返回平台」(right/bottom 12px, 约 100×26px) 有干净落点，倍速已从右下彻底移走。
- `≤500px && landscape`：战场满幅，上下带压到 89px / 72px，塔卡 88px 宽，提示贴底带上方避开中心。
- 桌面 1440×900 不命中任何移动端媒体查询，原布局保持；`.screen` 改可滚 + `justify-content:safe center` 对桌面无视觉影响。
- 选关页：`.screen` 加 `overflow:auto` + `-webkit-overflow-scrolling:touch`，卡片单列 min-height 168px
  （三张 177px + 间距，总高 < 812 全部可见；视口再矮时仍可滚，不裁切）。

### 验证结论（全部真跑）

- `pnpm typecheck`：无输出，退出 0。
- `pnpm build`：成功，CSS 18.52 kB (gzip 4.59)、JS 652.17 kB (gzip 167.90)。
- `mobile-check --enter=...进战场`：3/3 PASS，err=0 overflowX=0 cover=100.0% **minTap=50px** touch-action=**none**。
- `mobile-check --enter` 只到选关页：3/3 PASS；CDP 探针实测三张卡片 top 151/342/532、bottom 328/518/709，
  全部在 812 视口内，OPERATION 02/03 可直接看到（更矮视口下 `.screen` 可滚）。
- HUD 几何探针：竖屏上带 0～148、下带 688～812，战场中心 20%～80% 宽 × 25%～75% 高命中 0 处；
  横屏上带 0～89、下带 318～390，中心 20%～80% 宽 × 25%～75% 高命中 0 处；桌面无变化。
- 触屏端到端探针：模拟真实 touch 点建造点 → 塔 0→1、金币 320→220、选中 id=1；
  双指捏合 → camDist 51.6→57.6；全程 0 异常；捏合不误触建造。
- `pnpm tsx tools/balance.ts`：9 条结论行与改动前逐字一致（简单全通、普通全通/1～2 漏、困难第1/3关第8波失守），
  证明只动 UI/输入未碰数值。
- `git diff --name-only` 仅 4 个文件：index.html、src/render/view.ts、src/style.css、src/ui/ui.ts；src/game、src/data 零改动。

### 已知不足

- 本会话模型不支持 `read_image`，**没能用视觉通道直接看 `td-portrait-play.png`**；
  遮挡结论靠 CDP 几何探针（上/下带与中心矩形无交）与 mobile-check 的 canvas 覆盖率佐证，非肉眼确认。
- 捏合以两指间距线性映射缩放，未做惯性/边界回弹；够用但不如原生地图顺滑。
- 选中塔面板是点击后的临时浮层（贴右侧，非持久 HUD）；选中瞬间会盖住右侧一小块战场，
  但用户可点「取消选择」或空白处立刻收起。
- 横屏矮屏下 BOSS 血条、敌人预览与 toast 仍集中在顶部窄条，极端密集波次时可能叠字
  （均 pointer-events:none，不影响操作；几何探针确认当前默认态中心无遮挡）。

## 2026-11-18 22:55 — 修掉竖屏底部提示条与塔卡重叠

### 原因（lead 复核发现，真实遮挡）

第一版把 `.hud-hint` 用 `bottom` 定位在竖屏下带上方，实测 rect：
提示条 x=94 y=659 w=188 h=57 bottom=716；塔卡 y=692 h=74 bottom=766。
提示条下沿 716 越过塔卡上沿 692 共 24px，盖住「加/榴/电/激」卡顶文字。
`pointer-events:none` 只解决点击穿透，玩家看不见卡顶文字仍是坏 UI，必须改布局。
横屏同类问题：提示条 bottom=318、塔卡 top=320，加 8px 间隙判定仍相交。

### 改法与理由

- 方案选「触屏提示改成单行紧凑，竖屏贴到上带下方；横屏从底部抬高」，不用「几秒后隐藏」回避问题——
  显示期间本身就不能压卡；也不只是加 `pointer-events:none`。
- `ui.ts`：进场提示文案压成一行（"点卡片选塔 · 点建造点建塔 · 拖动平移 · 双指缩放"），时长 9s → 7s。
- `style.css` 竖屏：`.hud-hint` 由 `bottom:96px` 改为 `top:184px`（预览条 154～178 之下）、
  `white-space:nowrap`、单行 h≈25px；BOSS 血条 186 → 214、toast 230 → 256 顺延让位。
- `style.css` 横屏：`.hud-hint` bottom 72 → 84（y≈284～306，塔卡 top 320），`white-space:nowrap`。

### 验证（CDP 真实 rect，修复后）

```
竖屏 375×812:
  hint  {x:37,  y:184, w:302, h:25, bottom:209}
  card  {x:8,   y:692, w:85,  h:74, bottom:766}
  hint.bottom + 8 = 217 <= card.top 692  → NO 相交
  elementFromPoint(363,800) = CANVAS（右下 46px 平台区仍干净）

横屏 844×390:
  hint  {x:282, y:284, w:280, h:22, bottom:306}
  card  {x:8,   y:320, w:88,  h:66, bottom:386}
  hint.bottom + 8 = 314 <= card.top 320  → NO 相交
  elementFromPoint(832,378) = CANVAS
```

- `pnpm typecheck`：无输出，退出 0。
- `pnpm build`：成功，CSS 18.56 kB (gzip 4.60)、JS 652.15 kB (gzip 167.90)。
- `mobile-check --enter 进战场`：3/3 PASS，err=0 overflowX=0 cover=100.0% minTap=50px touch-action=none。
- 数值层仍未改（本轮只动 ui.ts + style.css）。未 commit/push。

### 已知不足

- 竖屏 BOSS 血条/toast 顺延到 y214/y256，极端密集波次时仍可能和顶部预览叠字（均 pointer-events:none）。
- 本会话模型不支持 `read_image`，遮挡结论仍是几何探针而非肉眼确认。

## 2026-11-18 23:35 — 避让平台返回按钮（抬高塔卡行）

### 原因（线上集成验收发现）

平台侧把「← 返回平台」从 28px 高改成触屏 44px 高，锚点 `right:12px; bottom:12px`，
在 375×812 实测占 `x=266..363, y=756..800`（97×44）。
我上版只留了 46px 底部空白（56px 需求），激光塔卡 bottom=766 比按钮上沿 756 低 10px，
两张右侧塔卡被压（电磁塔相交 10×10、激光塔 81×10）。

### 改法

`src/style.css` 竖屏媒体查询 `.hud-bottom` 底部 padding `46px → 66px`（含 safe-area）。
66px = 812 - 746，把塔卡行整体上抬 20px。

- 塔卡新 rect：`y=672, h=74, bottom=746`（h 不变，仍 ≥44px、单行不折行）
- 按钮 rect：`x=266, y=756, w=97, h=44`
- 不相交算式：`tower.bottom 746 + 8 = 754 <= back.y 756` ✓（间隙 10px，满足留 ≥8px 余量）

连带核对（全部在塔卡新 top 672 之上，无叠）：
`.wave-actions` bottom=658、`.sel-panel` bottom=652、`.hud-hint` y=184～209、
敌人预览 y=154～178、toast y≈248、BOSS 血条 y=214——均不相交。
横屏塔卡 x≤384 < 按钮 x=735，天然不交，未改横屏。

### 验证

- `pnpm typecheck`：无输出，退出 0。
- `pnpm build`：成功，CSS 18.56 kB (gzip 4.60)、JS 652.15 kB (gzip 167.90)。
- `pnpm tsx tools/balance.ts`：9 条结论与改前逐字一致（简单全通、普通全通/1～2 漏、困难第1/3关第8波失守）。
- `mobile-check --enter 进战场`（改后立即跑）：3/3 PASS，minTap=50px、touch-action=none。
- 平台 `backbtn-overlap.mjs` 自证由主代理统一跑（本代理遵守资源纪律未再开浏览器）；
  本代理改前曾用 CDP 几何探针量得 `cardOverlaps:[]`（塔卡 bottom 746 < 按钮 y 756），
  并把新 CSS 同步进 `build/www/games/td`（`node scripts/build.mjs --only=td`）。

### 资源纪律

本轮按容器 `.agents/constraints/resource-discipline.md`：浏览器脚本自 spawn 自 kill、profile 已删；
按 lead 要求 `Get-Process chrome | Stop-Process -Force` 后复核 chrome 进程数 = 0。
未 git commit/push；`src/game` 与 `src/data` 仍未改。

### 已知不足

- 塔卡上抬 20px 后，下带顶部到 668px，战场中心可用高度相应少 20px（仍 148～668 共 520px，够用）。
- 本会话模型不支持 `read_image`，遮挡结论为几何探针而非肉眼确认。
