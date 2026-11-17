# 会话报告 · 2026-11-17

> 3D 游戏合集：设计语言统一 + fnapp 打包技术固化为全局技能。
> 本文件可独立阅读，不需要其它文件配合。

## 一句话结论

7 个游戏从「七个不同产品」变成「一套设计语言下的七款游戏」：
**设计一致性 4/11 → 11/11，键位三态 0 → 7/7**，全部在 NAS 线上实测通过。

## 用户需求（按提出顺序）

1. 「对比 7 个游戏，风格统一，操作统一，就是统一设计语言的意思」
2. 确认范围：**C 方案 = 视觉 + 键位 + 文案全部统一**
3. 「FNAPP 包技术设置为全局 skill」
4. 选方案 1：「继续推进到 9/9」
5. 「工作落盘，关会话了」

## 交付物

| 交付 | 位置 | 状态 |
| --- | --- | --- |
| 设计语言规范 | `docs/设计语言规范.md` | 11 节，含令牌/键位/文案/造型变体/构建形态差异 |
| 设计令牌（唯一可执行副本） | `portal/design-tokens.css` | 服务端注入 7 个游戏页 head 最前 |
| 一致性检查器 | `.agents/work/tools/check-design.mjs` | 11 维，读 getComputedStyle 实际渲染值 |
| 键位检查器 | `.agents/work/tools/check-keys.mjs` | 7 游戏三态，真派发键盘事件 |
| 全局技能 | `~/.agents/skills/fnos-fpk-packaging/` | 已推 agent-skills 仓库 |
| 7 个游戏改造 | 各自仓库 | 全部 commit + push，本地=远端 |

## 关键事实与依据

### 起始基线（改造前实测，不是印象）

| 维度 | 实况 |
| --- | --- |
| 字体 | 3 种写法：`PingFang SC/微软雅黑`、`-apple-system`、`ui-monospace` |
| 背景色 | 7 个全不同（#070a14 / #0a0618 / #020308 / #0b0907 / #0d0f14 / #05070c / #0b0e12） |
| 圆角 | 4～28px 不等，同一游戏内也不一致 |
| 文案 | 「重开」vs「重新开始」、「静音」vs「音效」 |
| 键位 | Esc/P 暂停较一致；**扫雷纯鼠标零键盘**；坦克缺 P/R；塔防 R 被相机复位占用 |

### 两条被推翻的假设（都是我错，队友/实测纠正）

1. **「扫雷是 Vite 项目」** —— 错。它零构建，`package.json` 只有
   start/test/check，跑 `pnpm build` 报 `Command "build" not found`。
   依据：`games.manifest.mjs` 里 `kind: 'static'`、`build: '（零构建，直接可用）'`。
2. **「所有游戏都要 M 静音」** —— 错。推箱子零音频（全仓 grep 无
   AudioContext/振荡器/音频资源，台账自述「无音效」）。
   规范已改为条件条款：有音频必须有 M；无音频不加并在台账登记。
   理由：按下去什么都不变的键，比没有这个键更糟。

### 检查器本身修了 4 处判据缺陷

不改这些，「11/11」就是假的：

1. 主按钮取「第一个可见 button」→ 扫雷的 `<button class="level-card">`
   面积比开始按钮大，被判成主按钮。改为语义优先 + 排除卡片类。
2. 底色只读 `backgroundColor` → 三个用 `radial-gradient` 铺底的游戏
   全是 `rgba(0,0,0,0)`，被误判不一致。改为归一比较（都归到 `bg=#0a0d16`）。
3. 圆角要求「7 个值全同」→ 规范本就允许多档并存，永远判失败。
   改为区分 `same`（字体/颜色）与 `each`（圆角合规）两类判据。
4. 键位用 grep 源码 → 各游戏读写 `e.code`/`e.key` 不同，grep 不可靠。
   改为真派发键盘事件看界面变化。

### 刻意保留的个性（没有强行抹平）

- **塔防**用 `clip-path` 斜切造型（科技感）
- **推箱子**像素风直角（无 border-radius）

这两处强行改成 12px 圆角会毁掉辨识度。规范里写明这是允许的造型变体，
检查器白名单放行。判据是「同一游戏内形状一致」，不是「必须等于 12px」。

## 团队协作实况

开了 3 个队友并行，**全部因额度耗尽（QUOTA）中断**：

| 队友 | 任务 | 落盘情况 |
| --- | --- | --- |
| unity-a | 贪吃蛇/俄罗斯方块/打砖块 | **零代码** |
| unity-b | 扫雷/推箱子 | 扫雷 117 行（暂停+面板+圆角），**缺键盘绑定** |
| unity-c | 塔防/坦克 | **零代码** |

我接手做完收尾。队友 B 的扫雷代码质量高（暂停计时方案正确：
`elapsed` 权威、`startedAt` 仅基准，暂停墙钟天然不计入，不动 rAF），
我只补了最后一段键盘绑定与 `onResume` 接线。

**教训**：全局额度耗尽时子代理会静默失败、不留收尾消息。批量委派前
应确认额度余量，或把任务拆小以便中断后损失可控。

## 最终验收（NAS 线上 8081 实测）

| 项 | 结果 |
| --- | --- |
| 设计一致性 | **11/11** |
| 键位三态（进对局→P 暂停→再 P 恢复） | **7/7** |
| 扫雷单测 | 20/20 |
| 坦克单测 | 59/59 |
| 7 个游戏构建 | 全部通过 |
| 本地 = 远端 | 8/8 |

## 部署踩坑（已写进台账与技能）

- **`/tmp/inst.env` 会被系统清理** → 重装前必须重建，否则
  `install-fpk` 报 `Something wrong with environment variables`。
- **`install-fpk` 对已装应用不覆盖已有文件** → 改代码必须
  `uninstall` 再 `install-fpk`。
- **`.gitignore` 里浏览器 profile 要通配** → 每次验收目录名不同
  （cpd/cp2/cpf…），写死 `chrome-prof/` 会让 `git add -A` 把整个
  Chrome profile 加进仓库并报 Permission denied。已改 `.agents/work/cp*/`。

## 本场新增/修改的文件清单

平台仓库（`3D游戏聚合平台`）：
- `docs/设计语言规范.md`（新建）
- `portal/design-tokens.css`（新建）
- `portal/index.html`（改用令牌，tag 圆角归一）
- `server/index.mjs`（注入令牌 link + 提供 /design-tokens.css）
- `scripts/build.mjs`（拷贝令牌进产物）
- `.agents/work/tools/check-design.mjs`（新建，11 维）
- `.agents/work/tools/check-keys.mjs`（新建，键位三态）
- `.gitignore`（浏览器 profile 通配）
- `AGENTS.md` / `.agents/context/current-state.md`

7 个游戏：各自 CSS/HTML/TS 的最小改动，见各仓库 commit。

全局：
- `~/.agents/skills/fnos-fpk-packaging/`（SKILL.md + 2 references + 2 scripts）

## 下次继续的话

- 设计统一已闭环，`check-design.mjs` 与 `check-keys.mjs` 可随时复跑，
  加新游戏时套用规范即可，不用重新讨论。
- 推箱子若要加 M 静音，先做音频子系统——那时 M 是既有规范要求，不是新发明。
- 想扩展统一范围（如 HUD 布局强制统一），规范里 HUD 一节只是约定，
  尚未纳入检查器的自动化判据。
