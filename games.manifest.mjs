/**
 * 合集清单：唯一事实来源。
 *
 * 每个条目说明「这个游戏的文件从哪来、进合集后挂在哪个子路径」。
 * 构建脚本（scripts/build.mjs）与门户页（portal/index.html）都读这份清单，
 * 所以新增一个游戏只改这里，不需要再动服务端路由或页面里的卡片列表。
 *
 * kind 的三种形态来自各游戏既有的交付方式，不是这里新定的：
 *   static  已经构建好、目录里直接是可部署文件的
 *   vite    需要跑 vite build 才有 dist/ 的
 *   single  本来是单文件 HTML，合集把它放进同名目录当 index.html
 */
export const GAMES = [
  {
    id: 'snake',
    path: 'games/snake/',
    dir: '3D经典贪吃蛇',
    // 零构建的 ES module 工程：index.html + styles.css + src/ + vendor/ 原样搬。
    // 它要求 http 协议（file:// 下 type=module 被 CORS 拦），合集本身就是 http 服务。
    kind: 'static',
    files: ['index.html', 'styles.css', 'src', 'vendor'],
    title: '贪吃蛇',
    subtitle: 'Jelly Snake',
    desc: '果冻材质的立体棋盘，四种玩法组合：无尽 / 关卡制 × 撞墙 / 穿墙。',
    tags: ['无尽', '关卡', '穿墙', '道具'],
    accent: '#6cf0a8',
    cover: 'covers/snake.jpg',
    repo: 'http://panyunmeng.cn:3000/panyunmeng/3d-jingdian-tanchishe',
  },
  {
    id: 'tetris',
    path: 'games/tetris/',
    dir: '3D俄罗斯方块',
    kind: 'single',
    file: 'index.html',
    title: '俄罗斯方块',
    subtitle: '3D Tetris',
    desc: '经典 10×20 判定 + SRS 四态踢墙、T-spin、7-bag 与锁定延迟，圆角积木与消行白光。',
    tags: ['SRS', 'T-spin', 'Hold', '幽灵落点'],
    accent: '#7aa2ff',
    cover: 'covers/tetris.jpg',
    repo: 'http://panyunmeng.cn:3000/panyunmeng/3d-eluosifangkuai',
  },
  {
    id: 'breakout',
    path: 'games/breakout/',
    dir: '3D打砖块',
    kind: 'single',
    file: 'index.html',
    title: '打砖块',
    subtitle: 'Neon Breakout',
    desc: 'XZ 平面真实物理，落点决定反弹角；装甲砖、多球与加宽道具、粒子特效。',
    tags: ['物理', '多球', '装甲', '无尽'],
    accent: '#ff7b54',
    cover: 'covers/breakout.jpg',
    repo: 'http://panyunmeng.cn:3000/panyunmeng/3d-dazhuankuai',
  },
  {
    id: 'minesweeper',
    path: 'games/minesweeper/',
    dir: '3D扫雷',
    kind: 'static',
    files: ['index.html', 'styles.css', 'src', 'vendor'],
    title: '扫雷',
    subtitle: 'Mine Cave',
    desc: '矿洞岩层里的经典规则：首击安全、和弦展开、撤销与提示，铜色数字与爆炸粒子。',
    tags: ['首击安全', '和弦', '撤销', '种子分享'],
    accent: '#c8863c',
    cover: 'covers/minesweeper.jpg',
    repo: 'http://panyunmeng.cn:3000/panyunmeng/3d-sao-lei',
  },
  {
    id: 'sokoban',
    path: 'games/sokoban/',
    dir: '3D推箱子',
    kind: 'vite',
    dist: 'dist',
    title: '推箱子',
    subtitle: 'Sokoban · Microban',
    desc: 'Microban 155 关，像素风立体货场；点击寻路、撞墙推箱、逐关打勾记忆。',
    tags: ['155 关', '像素风', '寻路', '撤销'],
    accent: '#b8834a',
    cover: 'covers/sokoban.jpg',
    repo: 'http://panyunmeng.cn:3000/panyunmeng/3d-sokoban',
  },
  {
    id: 'td',
    path: 'games/td/',
    dir: '3D塔防',
    kind: 'vite',
    dist: 'dist',
    title: '塔防',
    subtitle: 'Mech Bastion',
    desc: '四塔三级、八种敌人、三关十波三档难度；固定路线 + 程序化建造点，带无尽模式。',
    tags: ['4 塔', '8 敌人', '3 关', '无尽'],
    accent: '#4dd0e1',
    cover: 'covers/td.jpg',
    repo: 'http://panyunmeng.cn:3000/panyunmeng/3d-tafang',
  },
  {
    id: 'tank',
    path: 'games/tank/',
    dir: '3D坦克大战',
    kind: 'vite',
    dist: 'dist',
    // 唯一带服务端的游戏：WebSocket 挂在 /games/tank/ws，由合集进程内挂载
    server: { entry: 'dist-server/index.mjs', mount: '/games/tank/', ws: true },
    title: '坦克大战',
    subtitle: 'Battle City 3D',
    desc: '经典 Battle City 重制：10 关战役、四种地形、双难度档；可两人联机合作。',
    tags: ['10 关', '双人联机', '道具', '双难度'],
    accent: '#7ac043',
    cover: 'covers/tank.jpg',
    repo: 'http://panyunmeng.cn:3000/panyunmeng/3d-tan-ke-da-zhan',
  },
];
