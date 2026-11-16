# 3D 打砖块

单文件 HTML + Three.js 的 3D 打砖块。玩法平面是 XZ（左右 + 纵深），透视俯视相机，
砖墙向纵深多层排布；鼠标/触摸控制挡板，落点决定反弹角度。

- 交付物：`index.html`（双击即玩，离线可用，无需服务器）
- 源码：`src/shell.html`（HUD/CSS 模板）+ `src/game.js`（内核）+ `vendor/three.min.js`（Three.js r149 UMD）
- 构建：`python build.py` 把三者内联成 `index.html`

## 动手前先读

- `constraints/delivery.md`：单文件交付、零外部依赖、物理不变式等硬约束，改动前必须过一遍
- `context/current-state.md`：当前进度台账（已实现/已验证/待办）

## 常用命令

```bash
node --check src/game.js     # 语法检查（改 game.js 后必跑）
python build.py              # 重建 index.html
```

## 调试入口（URL 参数）

| 参数 | 作用 |
| --- | --- |
| `?selftest=1` | 在真实 `update/physics` 上跑固定步长仿真 + 自动对打，输出 16 条不变式断言到 console 与标题栏 |
| `?level=N` | 直接从第 N 关开局，调试关卡布局 |
| `?demo=1` | 冻结一个「交战中」姿态（三球 + 粒子 + 道具 + 缺口砖墙），目视验收特效 |

浏览器标签页在后台时 `requestAnimationFrame` 会被节流到几 Hz，手工点击验证不了真实球速；
判断物理是否正常一律以 `?selftest=1` 的断言结果为准。

## 结构

```text
3D打砖块/
├── AGENTS.md
├── index.html          # 产物：内联 three + game，勿手改
├── build.py            # vendor + src → index.html
├── src/
│   ├── shell.html      # 模板（占位符 /*__THREE_JS__*/ 、 /*__GAME_JS__*/）
│   └── game.js         # 游戏内核
├── vendor/three.min.js # Three.js r149 UMD（经典 script，file:// 可用）
└── .agents/
    ├── constraints/delivery.md
    ├── context/current-state.md
    └── work/           # 过程文件（截图证据等），不进交付
```

## 约定

- `index.html` 永远由 `build.py` 生成，不手改；改完源码必须重建再验证
- 不引入运行时外部依赖（CDN、外链字体、图片），Three.js 内联是刻意选择
- 新增逻辑要能被 `?selftest=1` 覆盖；只靠人工点击不算验证
- 工作区暂无自定义技能；重复出现两次以上的流程再抽成 `.agents/skills/`
