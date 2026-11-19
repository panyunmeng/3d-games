# 容器层台账

> 只记容器层的事实与裁决。各游戏的进度在**各自仓库**的 `.agents/context/current-state.md`。

## 2026-11-18 22:20 — 移动端适配开工：口径裁决与共享工具

### 用户裁决（2026-11-18）

1. **范围**：7 个游戏做「触屏操控 + 响应式 HUD + 竖屏可玩」的**完整适配**，
   不是只做响应式布局。
2. **验收**：必须用无头浏览器在 375×812 竖屏 + 844×390 横屏 + 1440×900 桌面
   逐个截图，控制台零报错。
3. **执行方式**：用子代理，模型优先 `workbuddy/hy4flash`（Hy4 flash），
   不可用时退到 `deepseek-account/deepseek-flash`。
   实测 `workbuddy/hy4flash` 通路可用（探活返回 `WORKBUDDY_HY4_OK`），无需降级。

### 已产出的共享资产（都在本容器 `.agents/`，不进任何 git 仓库）

| 文件 | 作用 |
| --- | --- |
| `.agents/context/mobile-spec.md` | 移动端适配规范：目标设备档位、触屏输入 6 条、布局 5 条、不许桌面退化、验收判据 |
| `.agents/work/tools/mobile-check.mjs` | 单游戏三视口验收器（CDP 驱动 Chrome，判 4 项：零报错 / 无横向滚动 / canvas 未遮挡 / 最小可点 ≥44px） |
| `.agents/work/tools/mobile-check-all.mjs` | 7 个游戏一次跑完的汇总入口，把「每个游戏怎么进对局」固化成表 |

### 基线（改造前实测，作为回归对照）

| 游戏 | 竖屏 375×812 的实际缺陷 | 触屏是否可玩 |
| --- | --- | --- |
| 贪吃蛇 | 菜单可读，但只有键盘能转向 | ❌ 只能转视角，不能控制蛇 |
| 俄罗斯方块 | HUD 挤、底部键位提示压画布、canvas touch-action=auto | ❌ 无任何触屏输入 |
| 打砖块 | 最小可点元素 34px（要求 44），文案写「鼠标」 | ⚠️ 能拖挡板，但按钮太小 |
| 扫雷 | 布局基本可用，最小可点 116px | ❌ 没有右键/中键 → 不能插旗、不能和弦、不能缩放 |
| 推箱子 | 竖屏 3D 场景被压到几乎不可见，底部关卡条吃掉 1/3 屏 | ❌ 只能键盘/点击寻路 |
| 塔防 | 选关页卡片被裁（OPERATION 02/03 溢出），canvas touch-action=auto | ⚠️ 指针事件通，但无缩放/手势 |
| 坦克大战 | 菜单最小 37px，无瞄准与开火手段 | ❌ 手机不可玩 |

### 工具本身踩到的两个坑（已修）

1. **favicon 404 造成假失败**：单文件游戏把图标内联成 data URI，浏览器仍去根路径要
   `/favicon.ico`，验收器不兜底就每个游戏多一条与改动无关的 error。已改为返回 204
   （与平台服务端 `server/index.mjs:294` 的处理一致）。
2. **固定调试端口在并行验收时互相抢占**：第二个 Chrome 会连到别人的实例上，
   截图还能是绿的——最坏的一种假绿。已改为先 bind 空闲端口再交给 Chrome。

### 任务拆解（团队任务看板 task-1 ～ task-7）

7 个游戏一个任务，写入范围互不重叠（各自仓库的 `src/`、入口 html、
自己的 `.agents/context/`）。**git 提交与推送由主代理统一做**，
不让子代理各自 commit，避免提交信息与粒度失控。

### 未完成 / 下一步

- task-1 ～ task-7 的落地（子代理执行中）。
- 全部游戏改完后：7 个仓库各自 commit + push → 平台 `node scripts/build.mjs` →
  平台 `scripts/deploy.mjs`（线上不重建就还是旧版）。
- 待确认：是否本轮直接部署到 NAS（`panyunmeng.cn:8081`），还是只交代码。

## 2026-11-18 23:50 — 移动端适配完结：7 个游戏上线

### 交付结果

| 游戏 | 触屏方案 | 关键改动 |
| --- | --- | --- |
| 贪吃蛇 | 右下十字方向键 | 竖屏整盘取景（相机方位二分求半径）；雾距随半径拉开（否则整盘被雾吞成黑屏且工具仍判 PASS） |
| 俄罗斯方块 | 8 键触控条（54px） | 渲染只往 HUD 让出的中央带画（setViewport/setScissor），井道不被压；移动用按钮+DAS 而非横滑（横滑与相机拖动抢同一根手指） |
| 打砖块 | 触摸相对拖动 | 不做绝对映射：手指本来盖住挡板，相对拖动让手落在空白处；比例 = 绝对斜率 × 0.92 |
| 扫雷 | 长按 400ms 插旗 + 双指捏合/轻点 | 「不误挖」三重闸门（定时器复核 + longPressFired + pointerup 短路）；回归页 18→24 项 |
| 推箱子 | 左下十字方向键 + 关卡抽屉 | 竖屏 155 关列表收成抽屉；HUD 统计改单字标签（375px 一行放不下「步数/推动/剩余」） |
| 塔防 | 单指平移 + 双指缩放 | 竖屏上下两条窄带，战场中心零遮挡；选关页可滚动 |
| 坦克大战 | 双摇杆 | 摇杆只映射成与键盘相同的 PlayerInput 字段（新抽 src/inputMapping.ts + tests/inputMapping.test.ts 共 8 条单测），模拟层不认识手机 |

### 验收（全部实测）

- 手机视口 375×812 / 横屏 844×390 / 桌面 1440×900：**7/7 游戏 × 3 视口全 PASS**
- 线上 `http://panyunmeng.cn:8081`：7 个游戏逐个真开、控制台零报错
- 单测：扫雷 20、坦克 67（原 59+8）、俄罗斯方块 30、贪吃蛇 24、塔防 balance 9 条与改前逐字一致
- 遮挡：`backbtn-overlap` 7/7 无遮挡（线上实测）
- 部署：NAS 重装完成，本地与远端 8 个仓库全部同步

### 本轮抓到的真缺陷（都是工具判不出来、靠人看截图或矩形求交才发现的）

1. **推箱子竖屏 HUD 逐字折行**：375px 放不下「步数/推动/剩余」+ 5 按钮，文字被折成竖排。工具全绿。
2. **塔防提示条压塔卡**：hint bottom=716 vs 塔卡 top=692，重叠 24px。
3. **坦克底部提示叠印**：HUD 的 span.hint（z=10）与新增 .touch-tip（z=12）文案不同却压同一位置，渲染成糊字。
4. **平台返回按钮只有 28px 高**：低于 44px 下限；改成 44px 后又压住俄罗斯方块暂停键（27×44）与塔防两张塔卡（81×10）。
   → 根因是规范只写「右下 12px」没写尺寸，7 个游戏按 46/64px 各自预留。已在规范里固定成具体数字。

### 资源事故（用户投诉 CPU 70%）

我起了 2 个常驻 Chrome（`&` 挂 9333 调试实例 + 重叠检测工具），每套 13 个进程；叠加 3 个子代理并发各自开浏览器，CPU 打满。
已全部清理，并落成硬约束 `.agents/constraints/resource-discipline.md`：
浏览器禁止后台常驻、禁止子代理各自开浏览器（验收收归主代理一次跑完）、并发上限 2。

### 下一步（可选）

- 真机验证：目前全部是桌面 Chrome 的移动视口模拟，未在真手机上试过手势手感。
- 双指缩放：推箱子/坦克未做（规范未要求）。
- 塔防横屏井道/战场比例可再调。

## 2026-11-19 09:10 — 核查：3D 游戏合集能否上架飞牛官方应用市场

### 结论

**可以，但当前包有 4 个必须先补的缺口，且「官方市场」与「第三方源」是两条完全不同的路。**

官方市场有游戏类应用先例（如「轻游戏」H5 游戏管理平台），说明题材不是障碍。

### 官方上架要求（来自 developer.fnnas.com，2026-11-19 核实）

| 项 | 要求 |
| --- | --- |
| 提交入口 | 开发者后台上线前走「应用中心开发者先锋交流群」（从飞牛粉丝群联系社区主理人加入）；官方帮助中心另给出飞书申请表 |
| 材料 | fnpack 生成的 `.fpk`、应用图标、真实界面截图（不得用占位图/开发期设计图） |
| manifest | 各字段准确，尤其是版本、维护者、系统版本范围、平台、更新说明 |
| 发布前测试 | 在计划支持的 fnOS 版本与硬件架构上都实测，不能只测一次安装成功 |
| 运行时依赖 | **必须**用 `install_dep_apps` 声明所需运行时（文档明确举例 Node.js） |
| 权限 | `config/privilege` 合理，优先 `run-as: package`，不要 root |

官方文档：[上架应用](https://developer.fnnas.com/docs/quick-started/publish-application/) ·
[Manifest](https://developer.fnnas.com/docs/core-concepts/manifest/) ·
[运行时环境](https://developer.fnnas.com/docs/core-concepts/runtime/) ·
[应用依赖](https://developer.fnnas.com/docs/core-concepts/dependency/)

### 当前包的实际情况（逐个查过）

**已合规**

- `config/privilege` 用 `run-as: package`，不是 root
- `config/resource` 为 `{}`
- 8 个 `cmd/` 生命周期脚本齐全，`cmd/main` 实现 start/stop/status
- 图标 `ICON.PNG` 64×64、`ICON_256.PNG` 256×256 齐全
- `source = thirdparty`
- 封面 7 张 + live 截图 9 张可用作发布材料

**缺口（按严重度）**

1. **manifest 缺 `install_dep_apps=nodejs_v24`** —— 硬伤。`cmd/main` 硬编码
   `/var/apps/nodejs_v24/target/bin`，但没声明依赖。干净设备（未装 nodejs_v24）
   装上后应用起不来，而审核正是「在干净设备上测」。这是审核必查项。
2. **`maintainer_url` / `distributor_url` 指向内网 Gitea**
   （`http://panyunmeng.cn:3000/panyunmeng`）—— 审核方与用户都访问不到。
   需换公网可达地址，或改成联系方式。
3. **无 LICENSE 文件** —— 官方定位是「用户安装前需同意的隐私协议（可选）」。
   另有第三方素材：推箱子用 Microban 关卡（David W. Skinner，作者声明可自由
   分发但须保留 credit，游戏内已署名 `author: 'David W. Skinner'`）。
   商业分发场景下这条必须在 LICENSE/关于页里写清楚。
4. **`platform = x86` 且依赖的 nodejs_v24 本身也是 x86** —— ARM 设备装不了。
   纯前端 JS 理论上可声明 `all`，但运行时包是 x86，所以要么保持 x86 并在描述
   里写明，要么实测 ARM 后再说。官方要求「不要声明超过真实支持能力的范围」。

**还需确认**

- `os_min_version = 1.2.0` 要按实际测过的版本填。目前只在 NAS（fnOS 1.2.x）验过。
- 应用名「3D 俄罗斯方块」：玩法本身不受版权保护，但 Tetris 是注册商标。
  中文泛称风险相对低（应用中心已有「万能麻将」「斗地主」在架），
  但仍建议英文名/副标题避免直接用 Tetris。

### 两条路的成本对比

| 路径 | 门槛 | 用户怎么装 | 代价 |
| --- | --- | --- | --- |
| 官方应用中心 | 过官方审核（有开发者反馈提交多次无回音，需在开发者群催） | 应用中心搜索一键装 | 要补 4 个缺口 + 隐私协议 + 长期维护 |
| 第三方源（FnDepot 等社区源） | 无需官方审核，自己建源或投社区源 | 先装第三方商店，再搜索 | 用户多一步；分发型应用，无官方背书 |
| 现状（自己分发 fpk） | 无 | 应用中心「手动安装」上传 fpk | 已经跑通，只适合自用/小圈子 |

### 下一步（等用户裁决）

用户问的是可行性，尚未决定要上架。若要做，最小工作集是：
补 `install_dep_apps`、换公网可达的联系地址、补 LICENSE、整理截图与版本说明，
然后在 fnOS 上按「干净设备 + 首次安装」重测一遍。

## 2026-11-19 09:30 — 结构变更：8 个独立仓库合并为单仓库，并推 GitHub

### 用户裁决

1. GitHub 上**公开**。
2. 不再建 8 个仓库，「游戏聚合成一个仓库」。
3. 本地 Gitea 也合并成一个仓库。
4. 旧的 8 个 Gitea 仓库**归档为只读**。
5. 新仓库名 `3d-games`（Gitea 与 GitHub 同名）。

### 结果

| 项 | 值 |
| --- | --- |
| 本地 | `3D游戏合集/` 根目录现在是 git 仓库（原本刻意无 `.git`） |
| 提交数 | 69（原 8 仓库）→ **79**（8 次 subtree merge + init + 收尾） |
| `origin` | `http://panyunmeng.cn:3000/panyunmeng/3d-games.git`（私有） |
| `github` | `https://github.com/panyunmeng/3d-games`（公开） |
| 三方一致 | 本地 HEAD = origin/main = github/main = `f98c894` |
| 旧 8 仓库 | Gitea 上 `archived=true`（只读，完整历史保留，可随时 clone 回退） |

### 合并做法（为什么这样）

用 `git subtree add` 逐目录并入，**历史完整保留**。没用「复制文件 + 单次提交」是因为
那会丢掉 69 个提交里的演进信息。

关键约束：**目录结构一个都没改**。因为平台的 `scripts/build.mjs` 用 `GAMES_ROOT`
取「平台根的上一级」来定位 7 个游戏，一旦改成 `games/xxx` 嵌套，构建脚本与各游戏
的相对路径引用都要跟着改，收益只是目录看着整齐。

### 验证（合并后重跑，证明没破坏可运行性）

```
npm install（平台+坦克）/ pnpm install（推箱子+塔防）   全部成功
坦克 npm run build / 推箱子 pnpm build / 塔防 pnpm build  全部通过
平台 node scripts/build.mjs                             7/7 个游戏，合计 6207 KB
verify-live.mjs（本地 8099）                             门户 7 卡片 7 封面、7 个游戏全 PASS、零报错
```

各目录文件数与合并前逐一比对：**8/8 完全一致**；抽查 4 个仓库做树级 diff：**无差异**。

### 顺带做的收尾

- 根 `AGENTS.md` 重写（单仓库 + 双远端 + 归档说明）
- `.agents/constraints/navigation.md`：原「不在根目录建 git」约束反转，
  **原文保留**并写明当时为什么那样定、现在为什么改（避免以后有人翻到旧结论又改回去）
- `.agents/constraints/git-remotes.md` 新增：本机推 GitHub 的两个坑与绕过办法
- `.agents/context/layout.md`：8 仓库表改成「合并前仓库名（已归档）」
- 平台 `AGENTS.md` / `README.md`：位置与归属段改为单仓库口径
- 根 `README.md` 新增（公开仓库门面）：项目总览、玩法矩阵、技术栈、跑法、
  第三方署名（Three.js MIT / Microban）、许可说明
- `docs/screenshots/` 新增 14 张展示图（1280 长边 JPEG q82，共 700K）
- 内网 IP `192.168.1.100` → `192.168.x.x`（3 个文件，公开前脱敏）
- 删除 `.merge-backup`（478MB）

### 两个新踩的坑（已写进 git-remotes.md）

1. **`~/.gitconfig` 的 insteadOf 会把 GitHub 改写到 gh-proxy，而那条 token 已失效**。
   报错里的 URL 是 `gh-proxy.com/...` 就说明被改写了，不是 token 本身坏。
   绕过：URL 写成 `https://panyunmeng@github.com/...`（前缀不匹配，不改写）。
2. **加速器（Steam++）阻断 CRL 查询**，schannel 报 `CRYPT_E_NO_REVOCATION_CHECK`。
   这不是证书不受信任，是查不到吊销列表。`http."https://github.com/".schannelCheckRevoke false` 即可。

### 已知不足

- GitHub 仓库**没有 LICENSE**（README 里写的是「暂未授予开源许可，All rights reserved」）。
  要真正开源需要用户点头选许可证，这是法律声明，不能替他定。
- `.agents/work/` 被 gitignore，所以 `mobile-check.mjs` 等验收工具**不在仓库里**。
  clone 后想复跑移动端验收，得去 Gitea 旧仓库或本机工作副本取。
- 只在 Windows + 加速器环境下验证过推送，没验证在无加速器环境下的 pull/push。

## 2026-11-19 09:40 — 补齐 fnOS 上架硬缺口（与经典游戏合集同步）

对照 developer.fnnas.com 的运行时文档，`fnapp/manifest` 缺 `install_dep_apps`：
`cmd/main` 用 `/var/apps/nodejs_v24/target/bin/node` 却没有声明依赖，
干净设备（未装 nodejs_v24）装上后应用起不来——而官方审核正是按「干净设备
首次安装」验的。同批把 `maintainer_url`/`distributor_url` 从内网 Gitea 换成
GitHub 公网地址（`https://github.com/panyunmeng/3d-games`）。

**注意 `deploy.mjs --install` 对 3D 合集并不生效**：它只产出 fpk 然后打印
「下一步（手工安装）」就退出了，并没有调 appcenter 装。实测正确路子是
appcenter-cli 直接来：

```bash
echo "$PW" | sudo -S appcenter-cli uninstall 3d-games
cd /home/panyunmeng/3dgames-build/build/3d-games
sudo appcenter-cli install-fpk 3d-games.fpk -e /tmp/inst.env -v 1
```

`/tmp/inst.env` 三行：`wizard_port=8081` / `wizard_enable_port=true` /
`wizard_lan_only=false`。装完回读 `/var/apps/3d-games/manifest` 确认
`install_dep_apps = nodejs_v24` 与 GitHub URL 都在（fnpack 保留字段），
:8081 根与 games/{snake,td,tank} 全部 200。
