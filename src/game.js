/* ============================================================================
 * 3D 打砖块 · 游戏内核
 *
 * 坐标与约束：
 *   X 左右，Z 纵深（+Z 朝玩家），Y 只用于视觉高度。
 *   玩法平面是 XZ：球心 Y 固定，砖块/挡板/墙的碰撞全部在 XZ 内做 圆-AABB。
 *   这样「透视俯视 + 多层纵深砖墙」的三维观感成立，而瞄准与接球仍是二维手感；
 *   真 3D 盒内弹球（球在三轴自由飞行）瞄准不可控，不采用。
 *
 * 手感约束：
 *   1) 方向用单位向量 + 标量速度（不用 vx/vz 存速度），变速只改标量，
 *      避免「加速后把速度朝向改坏」这类隐性 bug。
 *   2) 挡板命中角度由落点决定（经典打砖块控制模型），玩家用落点瞄准。
 *   3) 反弹后强制 |dz| >= minVz，防止球贴墙横飞成死局。
 *   4) 固定步长 1/120 s + 单步位移限制，杜绝高速穿砖。
 * ========================================================================== */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- 参数 */
  const CFG = {
    halfW: 8,            // 场地半宽，X ∈ [-8, 8]
    backZ: -14.4,        // 后墙
    frontZ: 6.6,         // 越过即失球
    paddleZ: 4.0,        // 挡板所在纵深
    paddleW: 3.2,        // 挡板宽度（加宽道具的基准）
    paddleD: 0.9,
    paddleH: 0.6,
    ballR: 0.34,
    ballY: -0.26,        // 球心高度：贴着地面滚，视觉上正对砖块/挡板中段
    floorY: -0.6,
    baseSpeed: 13.5,     // 第 1 关球速（单位/秒）
    speedPerLevel: 0.06, // 每关 +6%
    brickW: 1.52, brickD: 1.0, brickH: 1.2, gapX: 0.08, gapZ: 0.16,
    cols: 10, rowStartZ: -6.0, maxRows: 7,
    maxBalls: 6, lives: 3,
    wideMul: 1.55, wideDur: 14,
    boostMul: 1.3, boostDur: 12,
    dropChance: 0.14,
    dt: 1 / 120,
    minVz: 0.32,
    paddleAngle: 62 * Math.PI / 180,
  };
  const BRICK_PX = CFG.brickW + CFG.gapX; // 1.60
  const ROW_PZ = CFG.brickD + CFG.gapZ;   // 1.16
  const HALF = CFG.halfW;
  const ROW_COLORS = [0x22d3ee, 0x34d399, 0xa3e635, 0xfbbf24, 0xfb7185, 0xc084fc, 0x60a5fa];
  const POW_META = {
    wide: { letter: 'W', color: '#63f2b6' },
    multi: { letter: 'M', color: '#b06bff' },
    boost: { letter: 'S', color: '#ffd24a' },
  };

  /* ---------------------------------------------------------------- 工具 */
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const sign = (v) => (v < 0 ? -1 : 1);
  const rrIsVisible = () => !$('overlay').classList.contains('hide');

  /* ---------------------------------------------------------------- 音效
   * 纯 WebAudio 合成，无外部音频文件：单文件交付、离线可玩。
   */
  const Sfx = {
    ctx: null,
    master: null,
    muted: localStorage.getItem('brick3d.muted') === '1',

    ensure() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
    },
    resume() {
      this.ensure();
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },
    setMuted(m) {
      this.muted = m;
      localStorage.setItem('brick3d.muted', m ? '1' : '0');
      if (this.master) this.master.gain.value = m ? 0 : 0.5;
      $('btnMute').textContent = m ? '🔇' : '🔊';
      $('btnMute').classList.toggle('off', m);
    },
    tone(freq, o) {
      if (!this.ctx || this.muted) return;
      if (this.ctx.state !== 'running') return; // 未获用户手势前不排程，避免警告刷屏
      const opt = o || {};
      const dur = opt.dur || 0.1;
      const t0 = this.ctx.currentTime + (opt.delay || 0);
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = opt.type || 'square';
      osc.frequency.setValueAtTime(freq, t0);
      if (opt.to) osc.frequency.exponentialRampToValueAtTime(Math.max(40, opt.to), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(opt.vol || 0.16, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(this.master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
    },
    brick(row, hp) {
      this.tone(300 + (CFG.maxRows - row) * 55, { type: 'square', dur: hp > 1 ? 0.07 : 0.1, vol: 0.14 });
    },
    paddle() { this.tone(190, { to: 330, type: 'sine', dur: 0.12, vol: 0.24 }); },
    wall() { this.tone(430, { type: 'triangle', dur: 0.05, vol: 0.08 }); },
    power() { [523, 659, 880].forEach((f, i) => this.tone(f, { type: 'triangle', dur: 0.12, vol: 0.16, delay: i * 0.07 })); },
    lose() { this.tone(300, { to: 70, type: 'sawtooth', dur: 0.55, vol: 0.2 }); },
    clear() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, { type: 'square', dur: 0.14, vol: 0.13, delay: i * 0.09 })); },
    over() { [330, 247, 165].forEach((f, i) => this.tone(f, { type: 'sawtooth', dur: 0.3, vol: 0.16, delay: i * 0.14 })); },
  };

  /* ---------------------------------------------------------------- 渲染层 */
  const canvas = $('cv');
  // r149 默认 legacyMode=true：hex 颜色不转线性却在输出端 sRGB 编码，整画面被抬亮一档。
  // 关掉 legacy 走正规色彩管线，霓虹色才不会被冲成粉彩。
  THREE.ColorManagement.legacyMode = false;
  const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070e);
  scene.fog = new THREE.Fog(0x05070e, 42, 82);

  const CAM_POS = new THREE.Vector3(0, 11.6, 12.4);
  const CAM_LOOK = new THREE.Vector3(0, -0.15, -3.8);
  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 240);
  camera.position.copy(CAM_POS);
  camera.lookAt(CAM_LOOK);

  scene.add(new THREE.HemisphereLight(0x8fc4ff, 0x080c14, 0.6));
  const keyLight = new THREE.DirectionalLight(0xffffff, 0.95);
  keyLight.position.set(-7, 20, 12);
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0x5ee7ff, 0.45);
  rimLight.position.set(9, 7, -16);
  scene.add(rimLight);

  // 地面 + 网格：给纵深一个参照，否则透视看不出远近
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ color: 0x05080f, roughness: 1, metalness: 0 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = CFG.floorY;
  scene.add(floor);

  const grid = new THREE.GridHelper(170, 85, 0x18324a, 0x0a1421);
  grid.position.y = CFG.floorY + 0.01;
  scene.add(grid);

  // 场地边界：半透明面 + 地面亮线，边界不靠猜
  const wallMat = new THREE.MeshBasicMaterial({
    color: 0x1b4a6b, transparent: true, opacity: 0.1, side: THREE.DoubleSide,
  });
  const zMid = (CFG.frontZ + CFG.backZ) / 2;
  const zLen = CFG.frontZ - CFG.backZ;
  const wallH = 3.2;
  [-HALF, HALF].forEach((x) => {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(zLen, wallH), wallMat);
    w.rotation.y = Math.PI / 2;
    w.position.set(x, wallH / 2 + CFG.floorY, zMid);
    scene.add(w);
  });
  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, wallH), wallMat);
  backWall.position.set(0, wallH / 2 + CFG.floorY, CFG.backZ);
  scene.add(backWall);

  function edgeLine(w, d, x, z, color) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.1, d),
      new THREE.MeshBasicMaterial({ color: color })
    );
    m.position.set(x, CFG.floorY + 0.05, z);
    scene.add(m);
    return m;
  }
  edgeLine(0.1, zLen, -HALF, zMid, 0x2f7fa8);
  edgeLine(0.1, zLen, HALF, zMid, 0x2f7fa8);
  edgeLine(HALF * 2, 0.1, 0, CFG.backZ, 0x2f7fa8);

  // 挡板
  const paddleMat = new THREE.MeshStandardMaterial({
    color: 0x2ee6ff, emissive: 0x0b6f88, emissiveIntensity: 1, roughness: 0.28, metalness: 0.55,
  });
  const paddleMesh = new THREE.Mesh(new THREE.BoxGeometry(CFG.paddleW, CFG.paddleH, CFG.paddleD), paddleMat);
  const paddleGlow = new THREE.Mesh(
    new THREE.BoxGeometry(CFG.paddleW * 0.9, 0.07, CFG.paddleD * 0.72),
    new THREE.MeshBasicMaterial({ color: 0xc8f9ff })
  );
  paddleMesh.position.y = CFG.floorY + CFG.paddleH / 2;
  paddleGlow.position.y = CFG.floorY + CFG.paddleH + 0.03;
  const paddleGroup = new THREE.Group();
  paddleGroup.add(paddleMesh);
  paddleGroup.add(paddleGlow);
  paddleGroup.position.set(0, 0, CFG.paddleZ);
  scene.add(paddleGroup);

  // 球体与光晕
  const ballGeo = new THREE.SphereGeometry(CFG.ballR, 24, 18);
  const ballMat = new THREE.MeshStandardMaterial({
    color: 0xeafcff, emissive: 0x3fd0ff, emissiveIntensity: 0.9, roughness: 0.16, metalness: 0.1,
  });
  function radialTexture(inner, mid) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, inner);
    g.addColorStop(0.38, mid);
    g.addColorStop(1, 'rgba(60,160,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    return t;
  }
  const glowTex = radialTexture('rgba(210,250,255,1)', 'rgba(120,220,255,.5)');

  const ballNodes = [];
  function ensureBallNodes(n) {
    while (ballNodes.length < n) {
      const m = new THREE.Mesh(ballGeo, ballMat);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.6,
      }));
      s.scale.setScalar(1.85);
      m.visible = false;
      s.visible = false;
      scene.add(m);
      scene.add(s);
      ballNodes.push({ m: m, s: s });
    }
  }

  /* ---------------------------------------------------------------- 粒子
   * 固定槽位 + InstancedMesh：一次 draw call，不产生 GC 抖动。
   */
  const P_MAX = 320;
  const parts = [];
  const partMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.21, 0.21, 0.21),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
    P_MAX
  );
  partMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  partMesh.frustumCulled = false;
  scene.add(partMesh);
  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();

  for (let i = 0; i < P_MAX; i++) {
    parts.push({
      i: i, life: 0, max: 1, x: 0, y: -999, z: 0,
      vx: 0, vy: 0, vz: 0, size: 1, color: new THREE.Color(0xffffff),
    });
    dummy.position.set(0, -999, 0);
    dummy.scale.setScalar(0.0001);
    dummy.updateMatrix();
    partMesh.setMatrixAt(i, dummy.matrix);
  }
  partMesh.instanceMatrix.needsUpdate = true;

  function spawnPart(x, y, z, color, n, power) {
    tmpColor.set(color);
    let cursor = 0;
    for (let k = 0; k < n; k++) {
      let p = null;
      for (let j = 0; j < P_MAX; j++) {
        const cand = parts[(cursor + j) % P_MAX];
        if (cand.life <= 0) { p = cand; cursor = (cursor + j + 1) % P_MAX; break; }
      }
      if (!p) return;
      const a = Math.random() * Math.PI * 2;
      const sp = rnd(1.2, 4.2) * power;
      p.x = x + rnd(-0.35, 0.35);
      p.y = y + rnd(-0.1, 0.5);
      p.z = z + rnd(-0.35, 0.35);
      p.vx = Math.cos(a) * sp;
      p.vz = Math.sin(a) * sp;
      p.vy = rnd(2, 7) * power;
      p.max = p.life = rnd(0.4, 0.95);
      p.size = rnd(0.55, 1.8);
      p.color.copy(tmpColor);
      partMesh.setColorAt(p.i, p.color);
      // 生成当帧就把矩阵写进去：否则要等下一次 updateParts，第一帧是零缩放
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(p.size);
      dummy.updateMatrix();
      partMesh.setMatrixAt(p.i, dummy.matrix);
      partMesh.instanceMatrix.needsUpdate = true;
    }
    if (partMesh.instanceColor) partMesh.instanceColor.needsUpdate = true;
  }

  function updateParts(dt) {
    let any = false;
    for (let i = 0; i < P_MAX; i++) {
      const p = parts[i];
      if (p.life <= 0) {
        if (p.y > -900) {
          p.y = -999;
          dummy.position.set(0, -999, 0);
          dummy.scale.setScalar(0.0001);
          dummy.updateMatrix();
          partMesh.setMatrixAt(i, dummy.matrix);
          any = true;
        }
        continue;
      }
      p.life -= dt;
      p.vy -= 26 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < CFG.floorY + 0.08) {
        p.y = CFG.floorY + 0.08;
        p.vy *= -0.32;
        p.vx *= 0.82;
        p.vz *= 0.82;
      }
      const k = Math.max(0, p.life / p.max);
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(p.life * 7, p.life * 5, p.life * 3);
      dummy.scale.setScalar(p.size * (0.3 + 0.7 * k));
      dummy.updateMatrix();
      partMesh.setMatrixAt(i, dummy.matrix);
      any = true;
    }
    if (any) partMesh.instanceMatrix.needsUpdate = true;
  }

  /* ---------------------------------------------------------------- 砖块 */
  const brickGeo = new THREE.BoxGeometry(CFG.brickW, CFG.brickH, CFG.brickD);
  // 血量用正面装甲亮带表达（2 血 1 条、3 血 2 条）。
  // 试过用高度表达，但 35° 俯视下更高的前排会把后排整排挡掉，反而更难读。
  const bandGeo = new THREE.BoxGeometry(CFG.brickW * 0.62, 0.085, 0.05);
  const bandMats = new Map();
  function bandMat(row) {
    if (!bandMats.has(row)) {
      bandMats.set(row, new THREE.MeshBasicMaterial({
        color: new THREE.Color(ROW_COLORS[row % ROW_COLORS.length]).lerp(new THREE.Color(0xffffff), 0.72),
      }));
    }
    return bandMats.get(row);
  }
  function decorateBrick(mesh, row, hp) {
    while (mesh.children.length) mesh.remove(mesh.children[0]);
    const n = hp - 1;
    for (let i = 0; i < n; i++) {
      const band = new THREE.Mesh(bandGeo, bandMat(row));
      const y = n === 1 ? 0.02 : (i === 0 ? -0.2 : 0.26);
      band.position.set(0, y, CFG.brickD / 2 + 0.01);
      mesh.add(band);
    }
  }
  const brickMatCache = new Map();
  function brickMat(row, hp) {
    const key = row + ':' + hp;
    if (brickMatCache.has(key)) return brickMatCache.get(key);
    const base = new THREE.Color(ROW_COLORS[row % ROW_COLORS.length]);
    const shade = hp <= 1 ? 1 : hp === 2 ? 0.62 : 0.42;
    const m = new THREE.MeshStandardMaterial({
      color: base.clone().multiplyScalar(shade),
      emissive: base.clone().multiplyScalar(hp <= 1 ? 0.45 : 0.3),
      emissiveIntensity: 1,
      roughness: 0.45,
      metalness: 0.25,
    });
    brickMatCache.set(key, m);
    return m;
  }

  /* 关卡是数据：每行一个 10 字符模式
   *   # 1 血   @ 2 血   % 3 血   . 空
   * 第 0 行离玩家最近，行号增大向纵深推进。
   */
  const LEVELS = [
    { rows: ['##########', '##########', '##########', '##########'] },
    { rows: ['#.##..##.#', '##########', '..######..', '##.####.##', '.########.'] },
    { rows: ['@@@@@@@@@@', '##########', '##.####.##', '#..#..#..#', '##.####.##', '##########'] },
    { rows: ['#.#.#.#.#.', '.#.#.#.#.#', '#.@#.#@.#.', '.########.', '##########', '.##.##.##.'] },
    { rows: ['..@@@@@@..', '.########.', '##..##..##', '##########', '#.######.#', '.@.####.@.', '##########'] },
  ];

  function procLevel(idx) {
    const n = 4 + ((idx * 3) % 4);
    const rows = [];
    const period = 2 + (idx % 2);
    for (let r = 0; r < n; r++) {
      let line = '';
      for (let c = 0; c < CFG.cols; c++) {
        const on = ((c + r * (1 + (idx % 3))) % period) !== 0;
        const rv = Math.random();
        line += on ? (rv < 0.1 ? '%' : rv < 0.32 ? '@' : '#') : '.';
      }
      rows.push(line);
    }
    return { rows: rows };
  }

  function levelPattern(idx) {
    return idx < LEVELS.length ? LEVELS[idx] : procLevel(idx);
  }

  const G = {
    state: 'menu',
    pausedFrom: 'play',
    score: 0,
    high: Number(localStorage.getItem('brick3d.high') || 0) || 0,
    levelIdx: 0,
    lives: CFG.lives,
    bricks: [],
    balls: [],
    pows: [],
    paddleX: 0,
    targetX: 0,
    paddleW: CFG.paddleW,
    wideT: 0,
    boostT: 0,
    combo: 0,
    comboT: 0,
    stateT: 0,
    acc: 0,
    time: 0,
    testing: false,
  };

  function clearBricks() {
    for (const b of G.bricks) if (b.mesh) scene.remove(b.mesh);
    G.bricks.length = 0;
  }

  function buildLevel(idx) {
    clearBricks();
    const pat = levelPattern(idx);
    const rows = pat.rows.slice(0, CFG.maxRows);
    const x0 = -((CFG.cols - 1) * BRICK_PX) / 2;
    for (let r = 0; r < rows.length; r++) {
      const line = rows[r];
      const z = CFG.rowStartZ - r * ROW_PZ;
      for (let c = 0; c < CFG.cols; c++) {
        const ch = line.charAt(c) || '.';
        if (ch === '.') continue;
        const hp = ch === '%' ? 3 : ch === '@' ? 2 : 1;
        const x = x0 + c * BRICK_PX;
        const mesh = new THREE.Mesh(brickGeo, brickMat(r, hp));
        mesh.position.set(x, CFG.floorY + CFG.brickH / 2, z);
        decorateBrick(mesh, r, hp);
        scene.add(mesh);
        G.bricks.push({ x: x, z: z, hp: hp, maxHp: hp, row: r, col: c, mesh: mesh, alive: true });
      }
    }
  }

  /* ---------------------------------------------------------------- 输入 */
  const keys = Object.create(null);
  let dragging = false;

  function pointerToWorldX(clientX) {
    const r = canvas.getBoundingClientRect();
    const fx = clamp((clientX - r.left) / r.width, 0, 1);
    // 屏幕横向满幅映射到场地宽度（略微超一点，保证最左右两侧砖够得到）
    return (fx - 0.5) * CFG.halfW * 2 * 1.02;
  }

  function onPointerMove(e) {
    if (e.pointerType === 'mouse' || dragging) {
      if (rrIsVisible()) return;
      G.targetX = pointerToWorldX(e.clientX);
    }
  }

  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerdown', function (e) {
    Sfx.resume();
    if (e.target && e.target.closest && (e.target.closest('#iconBar') || e.target.closest('#overlay'))) return;
    if (rrIsVisible()) return;
    dragging = true;
    G.targetX = pointerToWorldX(e.clientX);
    if (G.state === 'serve') launch();
  }, { passive: true });
  window.addEventListener('pointerup', function () { dragging = false; }, { passive: true });
  window.addEventListener('pointercancel', function () { dragging = false; }, { passive: true });

  window.addEventListener('keydown', function (e) {
    Sfx.resume();
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'arrowleft' || k === 'arrowright' || k === 'arrowup' || k === 'arrowdown') e.preventDefault();
    keys[k] = true;
    if (k === ' ' || k === 'enter') {
      if (G.state === 'menu' || G.state === 'gameover') startGame();
      else if (G.state === 'serve') launch();
      else if (G.state === 'levelclear') nextLevel();
    } else if (k === 'p' || k === 'escape') {
      togglePause();
    } else if (k === 'm') {
      Sfx.setMuted(!Sfx.muted);
    } else if (k === 'f') {
      toggleFullscreen();
    } else if (k === 'r') {
      startGame();
    }
  });
  window.addEventListener('keyup', function (e) { keys[e.key.toLowerCase()] = false; });
  window.addEventListener('blur', function () { dragging = false; });

  /* ---------------------------------------------------------------- 状态机 */
  function speedNow() {
    return CFG.baseSpeed * (1 + CFG.speedPerLevel * G.levelIdx);
  }

  function addScore(n) {
    G.score += n;
    if (G.score > G.high) {
      G.high = G.score;
      localStorage.setItem('brick3d.high', String(G.high));
    }
    hudDirty = true;
  }

  function setPaddleW(w) {
    G.paddleW = w;
    const s = w / CFG.paddleW;
    paddleMesh.scale.x = s;
    paddleGlow.scale.x = s;
  }

  function clearBalls() {
    G.balls.length = 0;
  }

  function clearPows() {
    for (const p of G.pows) {
      scene.remove(p.sprite);
      p.sprite.material.dispose();
    }
    G.pows.length = 0;
  }

  function serve() {
    clearBalls();
    G.balls.push({
      x: G.paddleX,
      z: CFG.paddleZ - CFG.paddleD / 2 - CFG.ballR - 0.02,
      dx: 0, dz: -1,
      sp: speedNow(),
      attach: true, dead: false,
    });
    G.state = 'serve';
    G.stateT = 0;
    G.acc = 0;
    hudDirty = true;
  }

  function launch() {
    if (G.state !== 'serve') return;
    const ang = rnd(-0.14, 0.14);
    for (const b of G.balls) {
      if (!b.attach) continue;
      b.attach = false;
      b.dx = Math.sin(ang);
      b.dz = -Math.cos(ang);
      fixDir(b);
    }
    G.state = 'play';
    G.stateT = 0;
    Sfx.tone(660, { type: 'square', dur: 0.08, vol: 0.12 });
  }

  function startGame() {
    Sfx.resume();
    G.score = 0;
    G.lives = CFG.lives;
    G.levelIdx = 0;
    G.combo = 0;
    G.comboT = 0;
    G.wideT = 0;
    G.boostT = 0;
    G.targetX = 0;
    G.paddleX = 0;
    setPaddleW(CFG.paddleW);
    $('combo').classList.remove('on');
    clearBalls();
    clearPows();
    buildLevel(0);
    serve();
    hideOverlay();
    hudDirty = true;
    console.info('[brick3d] start: level=1 bricks=' + G.bricks.length);
  }

  function nextLevel() {
    G.levelIdx++;
    clearPows();
    G.wideT = 0;
    G.boostT = 0;
    setPaddleW(CFG.paddleW);
    buildLevel(G.levelIdx);
    serve();
    hideOverlay();
    hudDirty = true;
    flashText('第 ' + (G.levelIdx + 1) + ' 关', 1300);
    console.info('[brick3d] level=' + (G.levelIdx + 1) + ' bricks=' + G.bricks.length);
  }

  function loseLife() {
    G.lives--;
    G.combo = 0;
    G.comboT = 0;
    hudDirty = true;
    if (G.lives <= 0) {
      G.state = 'gameover';
      Sfx.over();
      showOverlay({
        title: '游戏结束',
        sub: '砖墙没打完，再试一次',
        body: '<div class="big">' + G.score + '</div>' +
          '<div class="meta"><span>最高 <b>' + G.high + '</b></span>' +
          '<span>到达关卡 <b>' + (G.levelIdx + 1) + '</b></span></div>',
        btn: '再来一局',
        act: 'start',
      });
      console.info('[brick3d] gameover: score=' + G.score + ' level=' + (G.levelIdx + 1));
    } else {
      Sfx.lose();
      serve();
      flashText('掉球 · 剩余 ' + G.lives + ' 命', 1500);
      spawnPart(G.paddleX, CFG.floorY + 0.4, CFG.paddleZ, 0xff7a8a, 16, 1.1);
    }
  }

  function checkLevelClear() {
    if (G.state !== 'play') return;
    for (const b of G.bricks) if (b.alive) return;
    G.state = 'levelclear';
    G.stateT = 0;
    Sfx.clear();
    showOverlay({
      title: '第 ' + (G.levelIdx + 1) + ' 关 通过',
      sub: '进入下一关',
      body: '<div class="big">' + G.score + '</div>' +
        '<div class="meta"><span>生命 <b>' + G.lives + '</b></span>' +
        '<span>球速 <b>' + (speedNow() * (1 + CFG.speedPerLevel)).toFixed(1) + '</b></span></div>',
      btn: '',
      keys: false,
    });
    hudDirty = true;
  }

  /* ---------------------------------------------------------------- 物理 */
  function fixDir(b) {
    const len = Math.hypot(b.dx, b.dz) || 1;
    b.dx /= len;
    b.dz /= len;
    if (Math.abs(b.dz) < CFG.minVz) {
      b.dz = sign(b.dz || -1) * CFG.minVz;
      b.dx = sign(b.dx || 1) * Math.sqrt(1 - CFG.minVz * CFG.minVz);
    }
  }

  function wallHit(b) {
    let hit = false;
    if (b.x - CFG.ballR < -HALF) {
      b.x = -HALF + CFG.ballR;
      b.dx = Math.abs(b.dx);
      hit = true;
    } else if (b.x + CFG.ballR > HALF) {
      b.x = HALF - CFG.ballR;
      b.dx = -Math.abs(b.dx);
      hit = true;
    }
    if (b.z - CFG.ballR < CFG.backZ) {
      b.z = CFG.backZ + CFG.ballR;
      b.dz = Math.abs(b.dz);
      hit = true;
    }
    if (hit) {
      fixDir(b);
      Sfx.wall();
      spawnPart(b.x, CFG.ballY, b.z, 0x6fb6d8, 3, 0.45);
    }
    return hit;
  }

  function paddleHit(b) {
    if (b.dz <= 0) return false;
    const halfD = CFG.paddleD / 2;
    const halfW = G.paddleW / 2;
    if (b.z + CFG.ballR < CFG.paddleZ - halfD) return false;
    if (b.z - CFG.ballR > CFG.paddleZ + halfD) return false;
    if (Math.abs(b.x - G.paddleX) > halfW + CFG.ballR) return false;

    // 落点决定反弹角度：越靠边角度越大，玩家可以主动瞄准
    const off = clamp((b.x - G.paddleX) / halfW, -1, 1);
    const ang = off * CFG.paddleAngle;
    b.dx = Math.sin(ang);
    b.dz = -Math.cos(ang);
    fixDir(b);
    b.z = CFG.paddleZ - halfD - CFG.ballR - 0.01;
    G.combo = 0;
    Sfx.paddle();
    spawnPart(b.x, CFG.ballY, b.z, 0x9fe8ff, 7, 0.6);
    return true;
  }

  function brickHit(b) {
    const hx = CFG.brickW / 2;
    const hz = CFG.brickD / 2;
    for (let i = 0; i < G.bricks.length; i++) {
      const k = G.bricks[i];
      if (!k.alive) continue;
      const dxc = b.x - k.x;
      const dzc = b.z - k.z;
      if (Math.abs(dxc) > hx + CFG.ballR || Math.abs(dzc) > hz + CFG.ballR) continue;

      const cx = clamp(b.x, k.x - hx, k.x + hx);
      const cz = clamp(b.z, k.z - hz, k.z + hz);
      let nx = b.x - cx;
      let nz = b.z - cz;
      const d2 = nx * nx + nz * nz;
      if (d2 > CFG.ballR * CFG.ballR) continue;

      if (d2 < 1e-6) {
        // 球心已钻进砖块：按最小穿透轴推出，避免法线为 0
        const ox = hx + CFG.ballR - Math.abs(dxc);
        const oz = hz + CFG.ballR - Math.abs(dzc);
        if (ox < oz) {
          nx = sign(dxc); nz = 0;
          b.x = k.x + nx * (hx + CFG.ballR);
        } else {
          nx = 0; nz = sign(dzc);
          b.z = k.z + nz * (hz + CFG.ballR);
        }
      } else {
        const d = Math.sqrt(d2);
        nx /= d; nz /= d;
        b.x = cx + nx * (CFG.ballR + 0.001);
        b.z = cz + nz * (CFG.ballR + 0.001);
      }

      const dot = b.dx * nx + b.dz * nz;
      b.dx -= 2 * dot * nx;
      b.dz -= 2 * dot * nz;
      fixDir(b);
      damageBrick(k);
      return true;
    }
    return false;
  }

  function damageBrick(k) {
    k.hp--;
    const color = ROW_COLORS[k.row % ROW_COLORS.length];
    if (k.hp > 0) {
      k.mesh.material = brickMat(k.row, k.hp);
      decorateBrick(k.mesh, k.row, k.hp);
      Sfx.brick(k.row, k.hp);
      spawnPart(k.x, CFG.floorY + CFG.brickH * 0.7, k.z, color, 6, 0.75);
      addScore(4);
      return;
    }
    k.alive = false;
    scene.remove(k.mesh);
    G.combo++;
    G.comboT = 1.2;
    const bonus = G.combo >= 3 ? Math.min(G.combo, 12) * 3 : 0;
    addScore(10 * k.maxHp + bonus);
    Sfx.brick(k.row, k.maxHp);
    spawnPart(k.x, CFG.floorY + CFG.brickH * 0.7, k.z, color, 14, 1);
    if (G.combo >= 3) flashCombo();
    maybeDrop(k);
  }

  function stepBall(b, dt) {
    if (b.attach) {
      b.x = G.paddleX;
      b.z = CFG.paddleZ - CFG.paddleD / 2 - CFG.ballR - 0.02;
      b.dx = 0;
      b.dz = -1;
      return;
    }
    const mult = G.boostT > 0 ? CFG.boostMul : 1;
    const speed = b.sp * mult;
    const steps = Math.max(1, Math.ceil((speed * dt) / (CFG.ballR * 0.6)));
    const sdt = dt / steps;
    for (let s = 0; s < steps; s++) {
      b.x += b.dx * speed * sdt;
      b.z += b.dz * speed * sdt;
      wallHit(b);
      paddleHit(b);
      brickHit(b);
      if (b.z > CFG.frontZ) {
        b.dead = true;
        return;
      }
    }
  }

  function physics(dt) {
    for (let i = G.balls.length - 1; i >= 0; i--) {
      const b = G.balls[i];
      stepBall(b, dt);
      if (b.dead) G.balls.splice(i, 1);
    }
    if (G.balls.length === 0) loseLife();
  }

  /* ---------------------------------------------------------------- 道具 */
  const iconTexCache = new Map();
  function iconTex(type) {
    if (iconTexCache.has(type)) return iconTexCache.get(type);
    const meta = POW_META[type];
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
    ctx.fillStyle = 'rgba(6,12,22,.92)';
    roundRect(6, 6, 116, 116, 26);
    ctx.fill();
    ctx.lineWidth = 7;
    ctx.strokeStyle = meta.color;
    roundRect(6, 6, 116, 116, 26);
    ctx.stroke();
    ctx.fillStyle = meta.color;
    ctx.font = 'bold 72px ui-monospace,Menlo,Consolas,monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(meta.letter, 64, 70);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    iconTexCache.set(type, t);
    return t;
  }

  function dropPow(x, z, type) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: iconTex(type), transparent: true, depthWrite: false,
    }));
    sprite.scale.setScalar(1.2);
    sprite.position.set(x, CFG.floorY + 1.1, z);
    scene.add(sprite);
    G.pows.push({ type: type, x: x, z: z, sprite: sprite, t: 0 });
  }

  function maybeDrop(k) {
    if (G.pows.length >= 4) return;
    if (Math.random() > CFG.dropChance) return;
    const r = Math.random();
    dropPow(k.x, k.z, r < 0.4 ? 'wide' : r < 0.72 ? 'multi' : 'boost');
  }

  function applyPow(type) {
    Sfx.power();
    hudDirty = true;
    if (type === 'wide') {
      G.wideT = CFG.wideDur;
      setPaddleW(CFG.paddleW * CFG.wideMul);
      spawnPart(G.paddleX, CFG.floorY + 0.4, CFG.paddleZ, 0x63f2b6, 12, 0.9);
    } else if (type === 'multi') {
      multiBall();
      spawnPart(G.paddleX, CFG.floorY + 0.4, CFG.paddleZ, 0xb06bff, 12, 0.9);
    } else {
      G.boostT = CFG.boostDur;
      spawnPart(G.paddleX, CFG.floorY + 0.4, CFG.paddleZ, 0xffd24a, 12, 0.9);
    }
  }

  function multiBall() {
    const src = G.balls.slice();
    const add = [];
    for (const b of src) {
      if (G.balls.length + add.length >= CFG.maxBalls) break;
      for (const da of [-0.42, 0.42]) {
        if (G.balls.length + add.length >= CFG.maxBalls) break;
        const cs = Math.cos(da);
        const sn = Math.sin(da);
        add.push({
          x: b.x, z: b.z,
          dx: b.dx * cs - b.dz * sn,
          dz: b.dx * sn + b.dz * cs,
          sp: b.sp,
          attach: b.attach,
          dead: false,
        });
      }
    }
    for (const a of add) {
      fixDir(a);
      G.balls.push(a);
    }
  }

  function updatePows(dt) {
    for (let i = G.pows.length - 1; i >= 0; i--) {
      const p = G.pows[i];
      p.t += dt;
      p.z += 4.4 * dt;
      p.sprite.position.set(p.x, CFG.floorY + 1.1 + Math.sin(p.t * 4) * 0.12, p.z);
      p.sprite.material.rotation = Math.sin(p.t * 2.4) * 0.16;
      let gone = false;
      const nearPaddle = p.z > CFG.paddleZ - 0.5 && p.z < CFG.paddleZ + 0.9;
      if (nearPaddle && Math.abs(p.x - G.paddleX) < G.paddleW / 2 + 0.5) {
        applyPow(p.type);
        gone = true;
      } else if (p.z > CFG.frontZ) {
        gone = true;
      }
      if (gone) {
        scene.remove(p.sprite);
        p.sprite.material.dispose();
        G.pows.splice(i, 1);
      }
    }
  }

  /* ---------------------------------------------------------------- HUD */
  let hudDirty = true;
  let hudT = 0;

  function updateHud() {
    $('score').textContent = String(G.score);
    $('high').textContent = String(G.high);
    $('level').textContent = String(G.levelIdx + 1);
    let hearts = '';
    const total = Math.max(CFG.lives, G.lives);
    for (let i = 0; i < total; i++) hearts += '<i class="' + (i < G.lives ? '' : 'off') + '">♥</i>';
    $('lives').innerHTML = hearts;

    const badges = [];
    if (G.wideT > 0) badges.push('<span class="buff wide">加宽 ' + Math.ceil(G.wideT) + 's</span>');
    if (G.boostT > 0) badges.push('<span class="buff boost">加速 ' + Math.ceil(G.boostT) + 's</span>');
    let flying = 0;
    for (const b of G.balls) if (!b.attach) flying++;
    if (flying > 1) badges.push('<span class="buff multi">多球 ×' + flying + '</span>');
    $('buffs').innerHTML = badges.join('');
    hudDirty = false;
  }

  let flashSeq = 0;
  function flashText(msg, hold) {
    const el = $('combo');
    el.textContent = msg;
    el.classList.add('on');
    const my = ++flashSeq;
    setTimeout(function () {
      if (my === flashSeq) el.classList.remove('on');
    }, hold || 1400);
  }

  function flashCombo() {
    flashText('连击 ×' + G.combo);
  }

  function showOverlay(o) {
    const ov = $('overlay');
    ov.classList.remove('hide');
    $('ovTitle').textContent = o.title;
    $('ovSub').innerHTML = o.sub || '';
    $('ovBody').innerHTML = o.body || '';
    const btn = $('ovBtn');
    btn.textContent = o.btn || '开始游戏';
    btn.dataset.act = o.act || 'start';
    btn.classList.toggle('hide', !o.btn);
    $('ovKeys').style.display = o.keys === false ? 'none' : '';
  }

  function hideOverlay() {
    $('overlay').classList.add('hide');
  }

  function togglePause() {
    if (G.state === 'paused') {
      G.state = G.pausedFrom || 'play';
      hideOverlay();
      hudDirty = true;
      return;
    }
    if (G.state !== 'play' && G.state !== 'serve') return;
    G.pausedFrom = G.state;
    G.state = 'paused';
    showOverlay({ title: '已暂停', sub: '按 P 或点击继续', btn: '继续', act: 'resume', keys: false });
    hudDirty = true;
  }

  function toggleFullscreen() {
    const d = document;
    const el = d.documentElement;
    if (!d.fullscreenElement) {
      if (el.requestFullscreen) el.requestFullscreen().catch(function () {});
    } else if (d.exitFullscreen) {
      d.exitFullscreen().catch(function () {});
    }
  }

  $('ovBtn').addEventListener('click', function () {
    const act = $('ovBtn').dataset.act;
    if (act === 'start') startGame();
    else if (act === 'resume') {
      if (G.state === 'levelclear') nextLevel();
      else if (G.state === 'paused') togglePause();
      else hideOverlay();
    }
  });

  $('btnPause').addEventListener('click', togglePause);
  $('btnMute').addEventListener('click', function () { Sfx.setMuted(!Sfx.muted); });
  $('btnFull').addEventListener('click', toggleFullscreen);

  /* ---------------------------------------------------------------- 循环 */
  function updatePaddle(dt) {
    const sp = 17;
    if (keys['arrowleft'] || keys['a']) G.targetX -= sp * dt;
    if (keys['arrowright'] || keys['d']) G.targetX += sp * dt;
    const half = Math.min(G.paddleW / 2, HALF);
    G.targetX = clamp(G.targetX, -HALF + half, HALF - half);
    G.paddleX = G.targetX;
  }

  function syncVisuals() {
    paddleGroup.position.x = G.paddleX;
    ensureBallNodes(G.balls.length);
    for (let i = 0; i < ballNodes.length; i++) {
      const b = G.balls[i];
      const node = ballNodes[i];
      const on = !!b && !b.dead;
      node.m.visible = on;
      node.s.visible = on;
      if (on) {
        node.m.position.set(b.x, CFG.ballY, b.z);
        node.s.position.set(b.x, CFG.ballY, b.z);
      }
    }
  }

  function tickTimers(dt) {
    if (G.wideT > 0) {
      G.wideT -= dt;
      if (G.wideT <= 0) {
        G.wideT = 0;
        setPaddleW(CFG.paddleW);
      }
      hudDirty = true;
    }
    if (G.boostT > 0) {
      G.boostT -= dt;
      if (G.boostT <= 0) G.boostT = 0;
      hudDirty = true;
    }
    if (G.comboT > 0) {
      G.comboT -= dt;
      if (G.comboT <= 0) $('combo').classList.remove('on');
    }
  }

  function update(dt) {
    G.time += dt;
    G.stateT += dt;
    updatePaddle(dt);
    updateParts(dt);

    if (G.state === 'play') {
      G.acc += Math.min(dt, 0.1);
      let guard = 0;
      while (G.acc >= CFG.dt && guard++ < 10 && G.state === 'play') {
        physics(CFG.dt);
        G.acc -= CFG.dt;
      }
      if (G.state === 'play') {
        updatePows(dt);
        checkLevelClear();
        tickTimers(dt);
      }
    } else if (G.state === 'serve') {
      updatePows(dt);
      tickTimers(dt);
    } else if (G.state === 'levelclear') {
      if (G.stateT > 1.9) nextLevel();
    }

    hudT += dt;
    if (hudDirty || hudT > 0.2) {
      updateHud();
      hudT = 0;
    }
  }

  function syncCamera() {
    camera.position.x = CAM_POS.x + G.paddleX * 0.05;
    camera.position.y = CAM_POS.y + Math.sin(G.time * 0.6) * 0.05;
    camera.lookAt(CAM_LOOK);
  }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    const aspect = w / h;
    camera.aspect = aspect;
    // 竖屏（手机）拉大视野，保证整块场地进画面
    camera.fov = aspect < 0.8 ? 68 : aspect < 1.15 ? 56 : 46;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  document.addEventListener('visibilitychange', function () {
    console.info('[brick3d] visibility hidden=' + document.hidden + ' state=' + G.state);
    if (document.hidden && (G.state === 'play' || G.state === 'serve')) togglePause();
  });

  const clock = new THREE.Clock();
  let frames = 0;
  function loop() {
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05);
    if (!G.testing) update(dt);
    syncVisuals();
    syncCamera();
    renderer.render(scene, camera);
    frames++;
    if (frames === 3) console.info('[brick3d] first frames rendered');
  }

  /* ---------------------------------------------------------------- 自测
   * 用法：index.html?selftest=1
   * 为什么要它：浏览器标签页在后台时 requestAnimationFrame 被节流到几 Hz，
   * 手工点击验证不了真实球速与碰撞；这里用真实 update()/physics() 跑固定步长
   * 仿真（自动对打），把不变式写成断言，结果打到 console 和 document.title。
   */
  function runSelfTest() {
    const results = [];
    const check = (cond, name, extra) => {
      results.push((cond ? 'PASS ' : 'FAIL ') + name + (extra === undefined ? '' : ' [' + extra + ']'));
      return cond;
    };
    const finish = () => {
      const fails = results.filter(function (r) { return r.indexOf('FAIL') === 0; }).length;
      console.info('[selftest]\n' + results.join('\n'));
      console.info('[selftest] ' + (fails ? 'FAILED ' + fails + '/' + results.length : 'ALL PASS ' + results.length));
      document.title = (fails ? 'FAIL ' + fails : 'PASS') + ' · 3D 打砖块 自测';
      G.testing = false;
      G.state = 'menu';
      showOverlay({
        title: '自测完成',
        sub: fails ? '<b>失败 ' + fails + '</b> 项，详见控制台' : '全部通过',
        body: '<div class="meta"><span>断言 <b>' + results.length + '</b> 项</span></div>',
        btn: '开始游戏',
        act: 'start',
      });
    };

    G.testing = true;
    hideOverlay();

    /* A：自动对打 25 秒（挡板跟球 + 轻微抖动制造角度） */
    startGame();
    launch();
    let steps = 0;
    const MAX_STEPS = 120 * 25;
    let nan = false, oob = false, inside = false;
    let destroyed = 0;
    let prevAlive = G.bricks.filter(function (b) { return b.alive; }).length;
    while (steps < MAX_STEPS && G.state === 'play') {
      const head = G.balls[0];
      if (head) G.targetX = head.x + Math.sin(steps * 0.013) * 0.55;
      update(1 / 120);
      steps++;
      for (const b of G.balls) {
        if (!isFinite(b.x) || !isFinite(b.z)) nan = true;
        if (b.x < -HALF - 0.2 || b.x > HALF + 0.2 || b.z < CFG.backZ - 0.2) oob = true;
        for (const k of G.bricks) {
          if (!k.alive) continue;
          if (Math.abs(b.x - k.x) < CFG.brickW / 2 - 0.02 && Math.abs(b.z - k.z) < CFG.brickD / 2 - 0.02) inside = true;
        }
      }
      const alive = G.bricks.filter(function (b) { return b.alive; }).length;
      if (alive < prevAlive) { destroyed += prevAlive - alive; prevAlive = alive; }
    }
    check(!nan, 'A1 球坐标无 NaN');
    check(!oob, 'A2 球始终在场地内');
    check(!inside, 'A3 球未穿进砖块内部（无隧穿）');
    check(destroyed >= 8, 'A4 25s 内打碎砖块数', 'destroyed=' + destroyed + ' t=' + (steps / 120).toFixed(1) + 's');
    check(G.score > 0, 'A5 计分生效', 'score=' + G.score);

    /* B：多球 */
    const beforeBalls = G.balls.length;
    applyPow('multi');
    check(G.balls.length > beforeBalls, 'B1 多球增加球数', 'balls=' + G.balls.length);
    check(G.balls.length <= CFG.maxBalls, 'B2 球数不超上限', 'max=' + CFG.maxBalls);

    /* C：加宽道具生效与到期还原 */
    applyPow('wide');
    check(Math.abs(G.paddleW - CFG.paddleW * CFG.wideMul) < 1e-6, 'C1 加宽立即生效', 'w=' + G.paddleW.toFixed(2));
    for (let i = 0; i < 121 * CFG.wideDur; i++) tickTimers(1 / 120);
    check(Math.abs(G.paddleW - CFG.paddleW) < 1e-6, 'C2 加宽到期还原', 'w=' + G.paddleW.toFixed(2));

    /* D：一直漏球 → 三条命耗尽 → gameover */
    let guard = 0;
    while (G.state !== 'gameover' && guard++ < 120 * 90) {
      if (G.state === 'serve') { launch(); continue; }
      if (G.state !== 'play') break;
      const b = G.balls[0];
      G.targetX = b ? (b.x > 0 ? -7.2 : 7.2) : 0;
      update(1 / 120);
    }
    check(G.state === 'gameover', 'D1 命耗尽进入 gameover', 'state=' + G.state);
    check(G.lives === 0, 'D2 生命归零', 'lives=' + G.lives);
    check(Number(localStorage.getItem('brick3d.high') || 0) > 0, 'D3 最高分已落 localStorage');

    /* F：道具下落 → 挡板接住 → 生效并移除 */
    startGame();
    launch();
    G.wideT = 0;
    setPaddleW(CFG.paddleW);
    dropPow(G.paddleX, CFG.paddleZ - 1.6, 'wide');
    for (let i = 0; i < 120 && G.pows.length > 0; i++) update(1 / 120);
    check(G.wideT > 0, 'F1 接住道具触发加宽', 'wideT=' + G.wideT.toFixed(1));
    check(G.pows.length === 0, 'F2 接住后道具移除', 'left=' + G.pows.length);

    /* E：清空砖块 → 过关 → 下一关重新生成 */
    startGame();
    launch();
    const levelBefore = G.levelIdx;
    for (const k of G.bricks) { k.alive = false; scene.remove(k.mesh); }
    let guard2 = 0;
    while (G.levelIdx === levelBefore && guard2++ < 120 * 8) update(1 / 120);
    check(G.levelIdx === levelBefore + 1, 'E1 过关推进关卡', 'level=' + (G.levelIdx + 1));
    check(G.bricks.filter(function (b) { return b.alive; }).length > 0, 'E2 新关卡砖块已生成', 'n=' + G.bricks.length);

    finish();
  }

  /* ---------------------------------------------------------------- 开发开关
   * ?demo=1   冻结一个“交战中”的姿态（多球 + 粒子 + 道具 + 缺口砖墙），用于目视验收特效。
   * ?level=N  直接从第 N 关开局，用于关卡布局/耐玩性调试。
   */
  function runDemo() {
    G.testing = true;
    startGame();
    let i = 0;
    for (const k of G.bricks) {
      i++;
      if (i % 3 === 0) {
        k.alive = false;
        scene.remove(k.mesh);
      } else if (i % 5 === 0) {
        k.hp = 2;
        k.mesh.material = brickMat(k.row, 2);
      }
    }
    G.balls.length = 0;
    G.balls.push({ x: -2.4, z: -1.2, dx: 0.3, dz: -0.95, sp: speedNow(), attach: false, dead: false });
    G.balls.push({ x: 1.9, z: -3.4, dx: -0.48, dz: 0.88, sp: speedNow(), attach: false, dead: false });
    G.balls.push({ x: 4.4, z: 1.2, dx: 0.2, dz: -0.98, sp: speedNow(), attach: false, dead: false });
    G.state = 'play';
    G.targetX = 1.2;
    G.paddleX = 1.2;
    G.score = 1870;
    G.high = 4180;
    G.levelIdx = 2;
    G.wideT = 8;
    G.boostT = 5;
    setPaddleW(CFG.paddleW * CFG.wideMul);
    spawnPart(-2.4, CFG.floorY + CFG.brickH * 0.7, -6.0, ROW_COLORS[0], 18, 1);
    spawnPart(1.9, CFG.floorY + CFG.brickH * 0.7, -8.4, ROW_COLORS[2], 12, 0.9);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconTex('wide'), transparent: true, depthWrite: false }));
    sprite.scale.setScalar(1.2);
    sprite.position.set(3.1, CFG.floorY + 1.1, -0.4);
    scene.add(sprite);
    G.pows.push({ type: 'wide', x: 3.1, z: -0.4, sprite: sprite, t: 0 });
    syncVisuals();
    hideOverlay();
    updateHud();
    console.info('[brick3d] demo pose ready: balls=' + G.balls.length + ' alive=' + G.bricks.filter(function (b) { return b.alive; }).length);
  }

  function startAtLevel(idx) {
    startGame();
    G.levelIdx = idx;
    buildLevel(idx);
    serve();
    updateHud();
    console.info('[brick3d] jump to level ' + (idx + 1) + ' bricks=' + G.bricks.length);
  }

  /* ---------------------------------------------------------------- 启动 */
  buildLevel(0);      // 菜单背景先摆一堵墙，避免进画面是空的
  updateHud();
  showOverlay({
    title: '3D 打砖块',
    sub: '移动挡板接住球，把纵深的砖墙全部打碎',
    btn: '开始游戏',
    act: 'start',
  });
  Sfx.setMuted(Sfx.muted);
  console.info('[brick3d] boot ok, three r' + THREE.REVISION + ', bricks=' + G.bricks.length);
  loop();
  const params = new URLSearchParams(location.search);
  const startIdx = Math.max(0, (parseInt(params.get('level') || '1', 10) || 1) - 1);
  if (location.href.indexOf('selftest') >= 0) runSelfTest();
  else if (location.href.indexOf('demo') >= 0) runDemo();
  else if (startIdx > 0) startAtLevel(startIdx);

  // 便于外部联动/自测（不影响玩法）
  window.__brick3d = {
    G: G, CFG: CFG,
    start: startGame, launch: launch, nextLevel: nextLevel, pause: togglePause,
  };
})();
