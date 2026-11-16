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
