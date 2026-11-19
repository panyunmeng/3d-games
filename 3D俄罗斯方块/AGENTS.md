# 3D 俄罗斯方块

经典 10×20 判定平面 + 立体糖果积木渲染的俄罗斯方块。单文件 HTML，双击即玩，离线可用。
判定与渲染严格分离：`core.js` 只有规则（node 可单测），`game.js` 只负责画出来和接收输入。

- 交付物：`index.html`（内联 three + 圆角几何 + 内核 + 渲染，本地直开）
- 源码：`src/shell.html`（HUD/CSS 模板）+ `src/core.js`（规则）+ `src/framing.js`（取景几何）
  + `src/game.js`（渲染/输入）
- 构建：`python build.py` 把 `vendor/` 与 `src/` 内联成 `index.html`

## 动手前先读

- `constraints/delivery.md`：单文件交付、`file://` 可用、判定与渲染分离、颜色管理等硬约束
- `context/current-state.md`：当前进度台账（已实现 / 已验证 / 待办）

## 常用命令

```bash
python build.py            # 重建 index.html（改完 src 必须重建）
npm run check              # node --check 三个源文件 + 30 条单测（内核 25 + 取景 5）
node --test tests/core.test.js
```

## 调试入口（URL 参数）

| 参数 | 作用 |
| --- | --- |
| `?selftest=1` | 随机对局 400 步 + WebGL/绘制调用断言，6 条结果画在覆盖层 |
| `?demo=1` | 冻结「玩到一半」盘面，目视验收配色与积木质感 |
| `?scenario=tetris` | 摆好四连消局面，按空格即可看消行闪光与 TETRIS 提示 |
| `?scenario=tspin` | T-spin double 局面（冻结），↑ 后空格应正好得 1200 分 |
| `?scenario=full` | 冻结的 154 块满盘，压测最坏渲染负载 |
| `?bench=N` | N 帧 `gl.finish()` 基准，输出 ms/帧；不受后台节流影响 |
| `?soak=N` | N 秒虚拟时间的同步浸泡，输出帧数/错误/堆增长 |
| `?autoplay=N` | 自动向左堆 N 块，用于走到「游戏结束」验证完整一局 |
| `?fps=1` | 左下角实时帧率读数（标签页在后台时读数会被节流，不可信） |
| `?seed=N` | 固定随机种子复现同一局 |

浏览器标签页切到后台时 `requestAnimationFrame` 会被节流到几 Hz，手工点击测不了真实手感；
判断规则是否正确一律以 `npm run check` 与 `?selftest=1` 的结果为准。

## 结构

```text
3D俄罗斯方块/
├── AGENTS.md
├── README.md
├── index.html                     # 产物：内联五个脚本，勿手改
├── build.py                       # vendor + src → index.html
├── package.json                   # 仅用于 test/check/build 脚本，无运行时依赖
├── src/
│   ├── shell.html                 # 模板（占位符 /*__THREE_JS__*/ 等）
│   ├── core.js                    # 规则内核，UMD-lite：浏览器挂全局 / node 走 module.exports
│   ├── framing.js                 # 取景几何（纯函数），保证任何宽高比不裁井道
│   └── game.js                    # Three.js 场景、输入、音效、主循环
├── tests/
│   ├── core.test.js               # 内核单测（25 条）
│   └── framing.test.js            # 取景几何单测（5 条）
├── vendor/
│   ├── three.min.js               # Three.js r149 UMD（经典 script，file:// 可用）
│   └── RoundedBoxGeometry.js      # 圆角盒几何体，已改成经典 script 版
└── .agents/
    ├── constraints/delivery.md
    ├── context/current-state.md
    └── work/visual/               # 证据截图，不进交付
```

## 约定

- `index.html` 永远由 `build.py` 生成，不手改；改完源码必须重建再验证
- 不引入运行时外部依赖（CDN、外链字体、图片）：Three.js 内联是刻意选择
- 新增规则逻辑要能进 `tests/core.test.js`；只靠人工点击不算验证
- 新视觉效果要加进 `?demo=1` 或 `?scenario=` 入口，保证下次能复现同一画面
- 性能结论只认 `?bench=`（每帧 `gl.finish()`）；`?fps=1` 在后台标签页会被节流，读数不可用
- 调试局面必须冻结（`scenarioHold`），否则 500 ms 锁定延迟会在我截图前把局面自己走掉
- 工作区暂无自定义技能；同一流程出现两次以上再抽成 `.agents/skills/`
