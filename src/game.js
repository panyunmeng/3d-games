/*!
 * 3D 俄罗斯方块 · 渲染与交互层
 *
 * 职责划分：core.js 只管规则（可被 node 单测），这里只管「把规则画出来、把按键喂进去」。
 * 依赖全局 THREE（r149 UMD）与全局 TetrisCore，均通过经典 script 注入，
 * 因此 index.html 可以直接 file:// 双击运行，不需要服务器。
 */
(function () {
  'use strict';

  var C = window.TetrisCore;
  var THREE = window.THREE;
  if (!C) throw new Error('TetrisCore 未加载');
  if (!THREE) throw new Error('THREE 未加载');

  // three r149 默认 legacyMode = true：材质颜色不做 sRGB→线性转换，
  // 输出端却又做线性→sRGB，等于把每个颜色都提亮约 2 倍。
  // 不打开正确颜色管理，无论怎么调灯都会得到粉彩色。
  if (THREE.ColorManagement) {
    if ('enabled' in THREE.ColorManagement) THREE.ColorManagement.enabled = true;
    if ('legacyMode' in THREE.ColorManagement) THREE.ColorManagement.legacyMode = false;
  }

  var params = new URLSearchParams(location.search);
  var isSelfTest = params.get('selftest') === '1';
  var isDemo = params.get('demo') === '1';
  var showFps = params.get('fps') === '1';
  var autoN = Math.max(0, Math.min(200, Number(params.get('autoplay') || 0)));
  var scenario = params.get('scenario') || '';
  var soakSec = Math.max(0, Math.min(600, Number(params.get('soak') || 0)));
  var benchN = Math.max(0, Math.min(2000, Number(params.get('bench') || 0)));
  // demo / scenario 是调试盘面，里面的分数不是玩家打出来的，不能写进最高分
  var noBestSave = isDemo || scenario !== '';
  var seedParam = params.get('seed');
  var SEED = seedParam ? (Number(seedParam) >>> 0) : (Date.now() & 0xffffffff);

  var COLS = C.COLS;
  var ROWS = C.ROWS;
  var BEST_KEY = 'tetris3d.best';
  var MUTE_KEY = 'tetris3d.muted';

  // ---------------------------------------------------------------- 配色
  var PALETTE = {
    I: 0x2fd8f2, J: 0x4b7bff, L: 0xff9a3c, O: 0xffcf3d,
    S: 0x35dd85, T: 0xa96bff, Z: 0xff5f7a
  };
  var CSS_HEX = {};
  Object.keys(PALETTE).forEach(function (k) {
    CSS_HEX[k] = '#' + ('000000' + PALETTE[k].toString(16)).slice(-6);
  });

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  // ---------------------------------------------------------------- 渲染器
  var canvas = document.getElementById('cv');
  var renderer = new THREE.WebGLRenderer({
    canvas: canvas, antialias: true, alpha: true, powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  if ('outputEncoding' in renderer) renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1.0;

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 200);

  // 固定斜俯视 + 指针拖动微转；相机不参与判定，只影响观感。
  var orbit = {
    az: 0.20,
    el: 0.085,
    radius: 34,
    target: new THREE.Vector3(COLS / 2, ROWS / 2, 0)
  };

  function updateCamera(shake) {
    var a = orbit.az, e = orbit.el, r = orbit.radius;
    var tx = orbit.target.x, ty = orbit.target.y;
    var cx = tx + r * Math.sin(a) * Math.cos(e);
    var cy = ty + r * Math.sin(e);
    var cz = r * Math.cos(a) * Math.cos(e);
    if (shake) {
      cx += (Math.random() - 0.5) * shake;
      cy += (Math.random() - 0.5) * shake;
    }
    camera.position.set(cx, cy, cz);
    camera.lookAt(tx, ty, 0);
  }

  function fitCamera() {
    // 取景数学在 src/framing.js 里，已被单测覆盖到 aspect 0.4～3.0
    var f = window.Framing.computeFraming(COLS + 4.2, ROWS + 3.4, camera.fov, camera.aspect, 1.04);
    orbit.radius = f.distance;
    window.__framing = f;
  }

  // ---------------------------------------------------------------- 光照
  // 光强按「总辐照度 ≈ 1.1」配：超过 1 就会被 sRGB 编码洗成粉彩，
  // 低于 0.8 又会让暗面糊成一团。这是观感与色彩保真的唯一旋钮。
  scene.add(new THREE.HemisphereLight(0xfff3e0, 0x241847, 0.40));
  var keyLight = new THREE.DirectionalLight(0xfff8ef, 0.62);
  keyLight.position.set(7, 22, 16);
  scene.add(keyLight);
  var fillLight = new THREE.DirectionalLight(0x8f74ff, 0.16);
  fillLight.position.set(-12, 6, 10);
  scene.add(fillLight);
  scene.add(new THREE.AmbientLight(0x4a3a7a, 0.12));

  // ---------------------------------------------------------------- 井道
  var wellGroup = new THREE.Group();
  scene.add(wellGroup);

  function buildWell() {
    var frameMat = new THREE.MeshStandardMaterial({
      color: 0x1d1442, roughness: 0.68, metalness: 0.12,
      emissive: 0x0b0620, emissiveIntensity: 0.8
    });
    var back = new THREE.Mesh(new THREE.BoxGeometry(COLS + 1.6, ROWS + 1.7, 0.55), frameMat);
    back.position.set(COLS / 2, ROWS / 2, -1.0);
    wellGroup.add(back);

    var inner = new THREE.Mesh(
      new THREE.PlaneGeometry(COLS, ROWS),
      new THREE.MeshBasicMaterial({ color: 0x120b2c })
    );
    inner.position.set(COLS / 2, ROWS / 2, -0.71);
    wellGroup.add(inner);

    // 网格线：给纵深一个锚点，让「落到底」和「贴墙」可读
    var pts = [];
    for (var x = 1; x < COLS; x++) pts.push(x, 0, -0.69, x, ROWS, -0.69);
    for (var y = 1; y < ROWS; y++) pts.push(0, y, -0.69, COLS, y, -0.69);
    var gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    wellGroup.add(new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({
      color: 0x4b3a86, transparent: true, opacity: 0.34
    })));

    // 左右导轨 + 底板
    var railGeo = new THREE.BoxGeometry(0.42, ROWS + 1.3, 1.7);
    var left = new THREE.Mesh(railGeo, frameMat);
    left.position.set(-0.21, ROWS / 2, -0.12);
    var right = new THREE.Mesh(railGeo, frameMat);
    right.position.set(COLS + 0.21, ROWS / 2, -0.12);
    wellGroup.add(left, right);

    var floor = new THREE.Mesh(new THREE.BoxGeometry(COLS + 1.85, 0.5, 1.7), frameMat);
    floor.position.set(COLS / 2, -0.25, -0.12);
    wellGroup.add(floor);

    // 顶部两条糖果色氛围灯，给「玩具」一点发光边缘
    var capMat = new THREE.MeshStandardMaterial({
      color: 0xff7a94, emissive: 0xff7a94, emissiveIntensity: 1.4, roughness: 0.4
    });
    var cap = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.24, 1.7), capMat);
    cap.position.set(-0.21, ROWS + 0.55, -0.12);
    var cap2 = cap.clone();
    cap2.material = new THREE.MeshStandardMaterial({
      color: 0x5fe7ff, emissive: 0x5fe7ff, emissiveIntensity: 1.4, roughness: 0.4
    });
    cap2.position.set(COLS + 0.21, ROWS + 0.55, -0.12);
    wellGroup.add(cap, cap2);
  }

  // ---------------------------------------------------------------- 方块
  var blockGeo = new THREE.RoundedBoxGeometry(0.9, 0.9, 0.9, 3, 0.14);
  var matCache = {};
  function blockMat(type) {
    if (!matCache[type]) {
      var base = new THREE.Color(PALETTE[type]);
      matCache[type] = new THREE.MeshStandardMaterial({
        color: base.clone(),
        roughness: 0.4,
        metalness: 0.03,
        emissive: base.clone().multiplyScalar(0.10),
        emissiveIntensity: 1
      });
    }
    return matCache[type];
  }

  // 已固定的方块用 InstancedMesh：满盘约 160 块时把 draw call 从 160 压到 1。
  // 实测这是满盘掉帧的唯一瓶颈（三角面数不变，只有 draw call 数在变）。
  var boardInst = null;
  var instColors = {};
  Object.keys(PALETTE).forEach(function (k) { instColors[k] = new THREE.Color(PALETTE[k]); });
  var _m4 = new THREE.Matrix4();

  function buildPool() {
    var mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.4, metalness: 0.03,
      emissive: 0x141414, emissiveIntensity: 1
    });
    boardInst = new THREE.InstancedMesh(blockGeo, mat, COLS * ROWS);
    boardInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    boardInst.frustumCulled = false;
    boardInst.count = 0;
    for (var i = 0; i < COLS * ROWS; i++) boardInst.setColorAt(i, instColors.T);
    scene.add(boardInst);
  }

  var activeGroup = new THREE.Group();
  scene.add(activeGroup);
  var activeMeshes = [];
  for (var ai = 0; ai < 4; ai++) {
    var am = new THREE.Mesh(blockGeo, blockMat('T'));
    activeMeshes.push(am);
    activeGroup.add(am);
  }

  var ghostGroup = new THREE.Group();
  var ghostColors = {};
  Object.keys(PALETTE).forEach(function (k) { ghostColors[k] = new THREE.Color(PALETTE[k]); });
  scene.add(ghostGroup);
  var ghostMeshes = [];
  var ghostFillMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false
  });
  var ghostEdgeMat = new THREE.LineBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.42
  });
  var ghostEdgeGeo = new THREE.EdgesGeometry(blockGeo);
  for (var gi = 0; gi < 4; gi++) {
    var gm = new THREE.Mesh(blockGeo, ghostFillMat);
    gm.add(new THREE.LineSegments(ghostEdgeGeo, ghostEdgeMat));
    ghostMeshes.push(gm);
    ghostGroup.add(gm);
  }

  // 消行闪光
  var flashes = [];
  function spawnFlash(row) {
    var mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    var mesh = new THREE.Mesh(new THREE.PlaneGeometry(COLS, 1.0), mat);
    mesh.position.set(COLS / 2, row + 0.5, 1.2);
    scene.add(mesh);
    flashes.push({ mesh: mesh, t: 0 });
  }

  // ---------------------------------------------------------------- 音效
  var audioAllowed = false;
  window.addEventListener('pointerdown', function () { audioAllowed = true; }, { once: true, capture: true });
  window.addEventListener('keydown', function () { audioAllowed = true; }, { once: true, capture: true });

  var Sound = (function () {
    var ctx = null, master = null;
    var muted = localStorage.getItem(MUTE_KEY) === '1';

    function ensure() {
      if (muted || !audioAllowed) return null;
      if (!ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.32;
        master.connect(ctx.destination);
      }
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      return ctx;
    }

    function tone(freq, dur, type, gain, delay) {
      var c = ensure();
      if (!c) return;
      var t = c.currentTime + (delay || 0);
      var osc = c.createOscillator();
      var g = c.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain || 0.16, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g);
      g.connect(master);
      osc.start(t);
      osc.stop(t + dur + 0.03);
    }

    function noise(dur, gain, freq, delay) {
      var c = ensure();
      if (!c) return;
      var t = c.currentTime + (delay || 0);
      var len = Math.max(1, Math.floor(c.sampleRate * dur));
      var buf = c.createBuffer(1, len, c.sampleRate);
      var data = buf.getChannelData(0);
      for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      var src = c.createBufferSource();
      src.buffer = buf;
      var filter = c.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = freq || 900;
      var g = c.createGain();
      g.gain.setValueAtTime(gain || 0.2, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(filter);
      filter.connect(g);
      g.connect(master);
      src.start(t);
    }

    return {
      get muted() { return muted; },
      toggle: function () {
        muted = !muted;
        localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
        if (!muted) { ensure(); tone(660, 0.07, 'sine', 0.12); }
        return muted;
      },
      unlock: function () { ensure(); },
      move: function () { tone(200, 0.035, 'square', 0.05); },
      rotate: function () { tone(430, 0.045, 'triangle', 0.07); },
      lock: function () { noise(0.07, 0.16, 700); tone(110, 0.07, 'sine', 0.1); },
      hold: function () { tone(520, 0.06, 'sine', 0.09); },
      clear: function (lines) {
        var notes = [523, 659, 784, 1046];
        for (var i = 0; i < Math.min(lines, 4); i++) tone(notes[i], 0.16, 'triangle', 0.12, i * 0.055);
        if (lines >= 4) {
          tone(1318, 0.3, 'triangle', 0.13, 0.22);
          noise(0.3, 0.1, 2400, 0.02);
        }
      },
      levelUp: function () {
        tone(660, 0.1, 'sine', 0.12, 0);
        tone(880, 0.1, 'sine', 0.12, 0.09);
        tone(1100, 0.16, 'sine', 0.12, 0.18);
      },
      over: function () {
        tone(440, 0.16, 'sine', 0.14, 0);
        tone(330, 0.16, 'sine', 0.14, 0.14);
        tone(262, 0.16, 'sine', 0.14, 0.28);
        tone(196, 0.42, 'sine', 0.14, 0.42);
      },
      start: function () { tone(523, 0.08, 'triangle', 0.1); tone(784, 0.12, 'triangle', 0.1, 0.07); }
    };
  })();

  // ---------------------------------------------------------------- 状态
  var state = C.createState(SEED);
  var best = Number(localStorage.getItem(BEST_KEY) || 0) || 0;
  var lastShown = { score: -1, level: -1, lines: -1 };
  // 调试局面冻结：不让锁定延迟在玩家出手前把局面自己走掉
  var scenarioHold = false;
  // 只保留计数器：浸泡跑法是同步的，不需要 active/botTimer 这类实时状态
  var soak = { errors: 0, games: 0, clears: 0, tspins: 0, locks: 0 };
  window.addEventListener('error', function () { soak.errors += 1; });
  window.addEventListener('unhandledrejection', function () { soak.errors += 1; });
  var toastTimer = 0;
  var shakeTime = 0;

  var el = {
    score: document.getElementById('scoreVal'),
    level: document.getElementById('levelVal'),
    lines: document.getElementById('linesVal'),
    best: document.getElementById('bestVal'),
    next: document.getElementById('nextCv'),
    hold: document.getElementById('holdCv'),
    toast: document.getElementById('toast'),
    overlay: document.getElementById('overlay'),
    dialog: document.getElementById('dialog'),
    soundBtn: document.getElementById('soundBtn')
  };

  // 预览画布按 DPR 放大，避免高 DPI 屏发虚
  function prepCanvas(cv) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = cv.clientWidth || cv.width, h = cv.clientHeight || cv.height;
    if (cv.__w !== w || cv.__h !== h || cv.__dpr !== dpr) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      cv.__w = w; cv.__h = h; cv.__dpr = dpr;
      var c = cv.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      cv.__ctx = c;
    }
    var ctx2d = cv.__ctx || cv.getContext('2d');
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx2d;
  }

  function roundRect(ctx2d, x, y, w, h, r) {
    var rr = Math.min(r, w / 2, h / 2);
    ctx2d.beginPath();
    ctx2d.moveTo(x + rr, y);
    ctx2d.arcTo(x + w, y, x + w, y + h, rr);
    ctx2d.arcTo(x + w, y + h, x, y + h, rr);
    ctx2d.arcTo(x, y + h, x, y, rr);
    ctx2d.arcTo(x, y, x + w, y, rr);
    ctx2d.closePath();
  }

  function drawPreviewPiece(ctx2d, type, cx, cy, cell, dim) {
    var cells = C.cellsOf(type, 0);
    var minX = 9, maxX = -9, minY = 9, maxY = -9;
    cells.forEach(function (c) {
      minX = Math.min(minX, c[0]); maxX = Math.max(maxX, c[0]);
      minY = Math.min(minY, c[1]); maxY = Math.max(maxY, c[1]);
    });
    var w = (maxX - minX + 1) * cell;
    var h = (maxY - minY + 1) * cell;
    var ox = cx - w / 2;
    var oy = cy - h / 2;
    ctx2d.globalAlpha = dim ? 0.55 : 1;
    cells.forEach(function (c) {
      var px = ox + (c[0] - minX) * cell;
      var py = oy + (maxY - c[1]) * cell;
      roundRect(ctx2d, px + 1, py + 1, cell - 2, cell - 2, cell * 0.28);
      ctx2d.fillStyle = CSS_HEX[type];
      ctx2d.fill();
      ctx2d.strokeStyle = 'rgba(255,255,255,.35)';
      ctx2d.lineWidth = 1;
      ctx2d.stroke();
    });
    ctx2d.globalAlpha = 1;
  }

  function drawNext() {
    var ctx2d = prepCanvas(el.next);
    var w = el.next.clientWidth, h = el.next.clientHeight;
    ctx2d.clearRect(0, 0, w, h);
    var slots = 3;
    var slotH = h / slots;
    var cell = Math.min(w / 5.6, slotH / 3.4);
    for (var i = 0; i < slots; i++) {
      var type = state.queue[i];
      if (!type) continue;
      if (i > 0) {
        ctx2d.strokeStyle = 'rgba(255,255,255,.08)';
        ctx2d.beginPath();
        ctx2d.moveTo(8, slotH * i);
        ctx2d.lineTo(w - 8, slotH * i);
        ctx2d.stroke();
      }
      drawPreviewPiece(ctx2d, type, w / 2, slotH * i + slotH / 2, cell * (i === 0 ? 1 : 0.82), i > 0);
    }
  }

  function drawHold() {
    var ctx2d = prepCanvas(el.hold);
    var w = el.hold.clientWidth, h = el.hold.clientHeight;
    ctx2d.clearRect(0, 0, w, h);
    if (!state.hold) {
      ctx2d.fillStyle = 'rgba(169,158,203,.5)';
      ctx2d.font = '12px sans-serif';
      ctx2d.textAlign = 'center';
      ctx2d.fillText('空', w / 2, h / 2 + 4);
      return;
    }
    var cell = Math.min(w / 5.4, h / 3.2);
    drawPreviewPiece(ctx2d, state.hold, w / 2, h / 2, cell, !state.canHold);
  }

  function syncHud(force) {
    if (force || lastShown.score !== state.score) {
      el.score.textContent = state.score.toLocaleString('en-US');
      lastShown.score = state.score;
    }
    if (force || lastShown.level !== state.level) {
      el.level.textContent = state.level;
      lastShown.level = state.level;
    }
    if (force || lastShown.lines !== state.lines) {
      el.lines.textContent = state.lines;
      lastShown.lines = state.lines;
    }
    el.best.textContent = Math.max(best, state.score).toLocaleString('en-US');
  }

  function toast(text, color, ms) {
    el.toast.textContent = text;
    el.toast.style.color = color || '#ffe066';
    el.toast.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.remove('on'); }, ms || 800);
  }

  // ---------------------------------------------------------------- 视图同步
  function refreshBoardView() {
    var n = 0;
    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) {
        var v = state.board[y * COLS + x];
        if (!v) continue;
        _m4.makeTranslation(x + 0.5, y + 0.5, 0);
        boardInst.setMatrixAt(n, _m4);
        boardInst.setColorAt(n, instColors[typeOfId(v)]);
        n += 1;
      }
    }
    boardInst.count = n;
    boardInst.instanceMatrix.needsUpdate = true;
    if (boardInst.instanceColor) boardInst.instanceColor.needsUpdate = true;
  }

  var ID2TYPE = {};
  Object.keys(C.PIECE_ID).forEach(function (k) { ID2TYPE[C.PIECE_ID[k]] = k; });

  function typeOfId(id) { return ID2TYPE[id] || 'T'; }

  function refreshActiveView() {
    if (!state.active) {
      activeGroup.visible = false;
      ghostGroup.visible = false;
      return;
    }
    var cells = C.absCells(state.active);
    var mat = blockMat(state.active.type);
    for (var i = 0; i < 4; i++) {
      var m = activeMeshes[i];
      m.visible = true;
      m.material = mat;
      m.position.set(cells[i][0] + 0.5, cells[i][1] + 0.5, 0);
    }
    activeGroup.visible = true;

    var gy = C.ghostY(state);
    if (gy == null || gy === state.active.y) {
      ghostGroup.visible = false;
      return;
    }
    ghostGroup.visible = true;
    var color = ghostColors[state.active.type];
    ghostFillMat.color.copy(color);
    ghostFillMat.opacity = 0.12;
    ghostEdgeMat.color.copy(color);
    ghostEdgeMat.opacity = 0.5;
    for (var j = 0; j < 4; j++) {
      ghostMeshes[j].position.set(cells[j][0] + 0.5, gy + (cells[j][1] - state.active.y) + 0.5, 0);
    }
  }

  // ---------------------------------------------------------------- 事件消费
  function drainEvents() {
    if (!state.events.length) return;
    var evs = state.events;
    state.events = [];
    for (var i = 0; i < evs.length; i++) handleEvent(evs[i]);
  }

  function handleEvent(ev) {
    if (ev.type === 'lock') {
      soak.locks += 1;
      refreshBoardView();
      Sound.lock();
      if (ev.cleared > 0) {
        soak.clears += 1;
        if (ev.tspin) soak.tspins += 1;
        for (var r = 0; r < ev.rows.length; r++) spawnFlash(ev.rows[r]);
        Sound.clear(ev.cleared);
        if (ev.cleared >= 4) shakeTime = 0.28;
        if (ev.tspin) {
          toast(ev.tspin === 'mini' ? 'T-SPIN MINI' : 'T-SPIN', '#c98bff', 900);
        } else if (ev.cleared >= 4) {
          toast('TETRIS!', '#ffe066', 900);
        } else if (ev.combo > 0) {
          toast('连击 ×' + (ev.combo + 1), '#7ef2a8', 700);
        }
      }
      if (ev.levelUp) {
        Sound.levelUp();
        // 同一块既消行又升级时，让「TETRIS / T-SPIN」优先，别被升级提示吃掉
        if (ev.cleared === 0 && !ev.tspin) toast('等级 ' + ev.level, '#5fe7ff', 900);
      }
      drawNext();
      drawHold();
      syncHud();
      if (state.status === 'over') onGameOver();
    } else if (ev.type === 'gameover') {
      onGameOver();
    } else if (ev.type === 'spawn' || ev.type === 'hold') {
      drawNext();
      drawHold();
    }
  }

  var overHandled = false;

  function onGameOver() {
    if (overHandled) return;
    overHandled = true;
    if (!noBestSave && state.score > best) {
      best = state.score;
      try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) { /* 隐私模式忽略 */ }
    }
    syncHud(true);
    Sound.over();
    showGameOver();
  }

  // ---------------------------------------------------------------- 覆盖层
  var overlayMode = 'none';

  function showStart() {
    overlayMode = 'start';
    el.overlay.classList.add('on');
    el.dialog.innerHTML =
      '<h1>3D 俄罗斯方块</h1>' +
      '<p>立体方块，经典 10×20 判定。<br>鼠标拖动可微转视角，不影响消行判定。</p>' +
      '<div class="keys">' +
      '<span>移动 <b>← →</b></span>' +
      '<span>旋转 <b>↑ / X</b></span>' +
      '<span>逆转 <b>Z</b></span>' +
      '<span>软降 / 硬降 <b>↓ / 空格</b></span>' +
      '<span>暂存 <b>C</b></span>' +
      '<span>暂停 <b>P</b></span>' +
      '</div>' +
      '<button class="btn" id="startBtn">开 始 游 戏</button>';
    document.getElementById('startBtn').addEventListener('click', startGame);
  }

  function showPaused() {
    overlayMode = 'paused';
    el.overlay.classList.add('on');
    el.dialog.innerHTML =
      '<h1>已暂停</h1>' +
      '<p>当前分数 <b style="color:#ffe066">' + state.score.toLocaleString('en-US') + '</b></p>' +
      '<button class="btn" id="resumeBtn">继 续</button>' +
      '<button class="btn ghost" id="restartBtn2">重开</button>';
    document.getElementById('resumeBtn').addEventListener('click', togglePause);
    document.getElementById('restartBtn2').addEventListener('click', restart);
  }

  function showGameOver() {
    overlayMode = 'over';
    el.overlay.classList.add('on');
    var isBest = state.score > 0 && state.score >= best;
    el.dialog.innerHTML =
      '<h1>游戏结束</h1>' +
      '<div class="big">' + state.score.toLocaleString('en-US') + '</div>' +
      '<p>' + (isBest ? '新纪录！' : '最高分 ' + best.toLocaleString('en-US')) +
      ' · 等级 ' + state.level + ' · 消行 ' + state.lines + '</p>' +
      '<button class="btn" id="againBtn">再 来 一 局</button>';
    document.getElementById('againBtn').addEventListener('click', restart);
  }

  function hideOverlay() {
    overlayMode = 'none';
    el.overlay.classList.remove('on');
    el.dialog.innerHTML = '';
  }

  // ---------------------------------------------------------------- 游戏控制
  function startGame() {
    Sound.unlock();
    hideOverlay();
    state.events.length = 0;
    overHandled = false;
    C.start(state);
    refreshBoardView();
    refreshActiveView();
    drawNext();
    drawHold();
    syncHud(true);
    Sound.start();
  }

  function restart() {
    hideOverlay();
    state = C.createState(SEED);
    C.start(state);
    flashes.forEach(function (f) { scene.remove(f.mesh); f.mesh.geometry.dispose(); });
    flashes = [];
    refreshBoardView();
    refreshActiveView();
    drawNext();
    drawHold();
    syncHud(true);
    lastShown = { score: -1, level: -1, lines: -1 };
    Sound.start();
  }

  function togglePause() {
    if (state.status === 'playing') {
      C.pause(state);
      showPaused();
    } else if (state.status === 'paused') {
      C.resume(state);
      hideOverlay();
    }
  }

  function ensurePlaying() {
    if (state.status === 'ready' || state.status === 'over') {
      startGame();
      return true;
    }
    if (state.status === 'paused') {
      togglePause();
      return false;
    }
    return false;
  }

  // ---------------------------------------------------------------- 输入
  var held = { left: false, right: false, down: false };
  var das = { timer: 0, nextAt: 0, delay: 150, repeat: 45 };

  function doMove(dir) {
    if (C.tryMove(state, dir, 0)) { Sound.move(); refreshActiveView(); }
  }

  function doRotate(dir) {
    if (C.tryRotate(state, dir)) { Sound.rotate(); refreshActiveView(); }
  }

  function doHold() {
    if (C.hold(state)) { Sound.hold(); refreshActiveView(); }
  }

  function doHardDrop() {
    if (!state.active) return;
    C.hardDrop(state);
    drainEvents();
    refreshActiveView();
    syncHud();
  }

  function doSoftDrop() {
    if (C.softDrop(state)) { refreshActiveView(); syncHud(); drainEvents(); }
  }

  window.addEventListener('keydown', function (e) {
    var code = e.code;
    if (code === 'Space' || code.indexOf('Arrow') === 0) e.preventDefault();
    if (overlayMode === 'start') {
      if (code === 'Space' || code === 'Enter') startGame();
      return;
    }
    if (overlayMode === 'over') {
      if (code === 'Space' || code === 'Enter' || code === 'KeyR') restart();
      return;
    }
    scenarioHold = false;
    if (code === 'KeyM') { setMuted(Sound.toggle()); return; }
    if (code === 'KeyP' || code === 'Escape') { togglePause(); return; }
    if (code === 'KeyR') { restart(); return; }
    if (state.status !== 'playing') {
      if (code === 'Enter' || code === 'Space') ensurePlaying();
      return;
    }
    if (e.repeat) {
      if (code === 'ArrowDown' || code === 'KeyS') doSoftDrop();
      return;
    }
    switch (code) {
      case 'ArrowLeft': case 'KeyA':
        held.left = true; doMove(-1); das.timer = 0; das.nextAt = das.delay; break;
      case 'ArrowRight': case 'KeyD':
        held.right = true; doMove(1); das.timer = 0; das.nextAt = das.delay; break;
      case 'ArrowDown': case 'KeyS':
        held.down = true; doSoftDrop(); break;
      case 'ArrowUp': case 'KeyX': case 'KeyW':
        doRotate(1); break;
      case 'KeyZ': case 'ControlLeft':
        doRotate(-1); break;
      case 'Space':
        doHardDrop(); break;
      case 'KeyC': case 'ShiftLeft':
        doHold(); break;
    }
  });

  window.addEventListener('keyup', function (e) {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') held.left = false;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') held.right = false;
    if (e.code === 'ArrowDown' || e.code === 'KeyS') held.down = false;
  });

  // 指针拖动微转视角（不参与判定）
  var drag = null;
  canvas.addEventListener('pointerdown', function (e) {
    drag = { x: e.clientX, y: e.clientY };
    if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var dx = e.clientX - drag.x;
    var dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    orbit.az = clamp(orbit.az + dx * 0.0032, -0.55, 0.55);
    orbit.el = clamp(orbit.el + dy * 0.0022, -0.06, 0.42);
  });
  function endDrag() { drag = null; }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', endDrag);

  el.soundBtn.addEventListener('click', function () {
    setMuted(Sound.toggle());
    Sound.unlock();
  });

  function setMuted(muted) {
    el.soundBtn.classList.toggle('off', muted);
    el.soundBtn.textContent = muted ? '🔇' : '🔊';
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && state.status === 'playing') {
      C.pause(state);
      showPaused();
    }
  });

  // ---------------------------------------------------------------- 主循环
  var lastT = 0;
  var fpsAcc = 0, fpsFrames = 0, fpsValue = 0;
  var rafId = 0;

  function frame(now) {
    rafId = requestAnimationFrame(frame);
    if (!lastT) lastT = now;
    var dt = Math.min(now - lastT, 120);
    lastT = now;

    // 帧率统计（1 秒窗口）
    fpsAcc += dt; fpsFrames += 1;
    if (fpsAcc >= 1000) {
      fpsValue = fpsFrames * 1000 / fpsAcc;
      window.__fps = fpsValue;
      fpsAcc = 0; fpsFrames = 0;
      if (fpsEl) fpsEl.textContent = 'FPS ' + fpsValue.toFixed(1) + '  ·  ' + state.status;
    }

    update(dt / 1000, dt);
    renderer.render(scene, camera);
  }

  function update(dtSec, dtMs) {
    if (state.status === 'playing') {
      // DAS：按下先走一格，按住 delay 后每 repeat 走一格
      if (!scenarioHold && (held.left || held.right)) {
        das.timer += dtMs;
        var guard = 0;
        while (das.timer >= das.nextAt && guard++ < 8) {
          doMove(held.left ? -1 : 1);
          das.nextAt += das.repeat;
          if (das.nextAt <= das.timer) das.nextAt = das.timer + das.repeat;
        }
      }
      if (!scenarioHold) C.tick(state, dtMs);
      drainEvents();
      refreshActiveView();
      syncHud();
    }

    // 消行闪光衰减
    for (var f = flashes.length - 1; f >= 0; f--) {
      var fl = flashes[f];
      fl.t += dtSec;
      var k = Math.min(fl.t / 0.28, 1);
      fl.mesh.material.opacity = 0.85 * (1 - k);
      fl.mesh.scale.set(1 + k * 0.06, 1 + k * 0.5, 1);
      if (k >= 1) {
        scene.remove(fl.mesh);
        fl.mesh.geometry.dispose();
        fl.mesh.material.dispose();
        flashes.splice(f, 1);
      }
    }

    if (shakeTime > 0) shakeTime = Math.max(0, shakeTime - dtSec);
    updateCamera(shakeTime > 0 ? shakeTime * 0.9 : 0);
  }

  // ---------------------------------------------------------------- 尺寸
  function onResize() {
    var w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    fitCamera();
    drawNext();
    drawHold();
  }
  window.addEventListener('resize', onResize);

  // ---------------------------------------------------------------- 自检
  function runSelfTest() {
    var results = [];
    function check(name, ok, detail) {
      results.push({ name: name, ok: !!ok, detail: detail || '' });
    }

    var t0 = performance.now();
    var s = C.createState(20261117);
    C.start(s);
    var steps = 0, err = null;
    try {
      while (s.status === 'playing' && steps < 400) {
        steps += 1;
        var dice = Math.floor(s.rng() * 10);
        if (dice < 4) C.tryMove(s, dice % 2 ? 1 : -1, 0);
        else if (dice < 6) C.tryRotate(s, dice % 2 ? 1 : -1);
        else if (dice === 6) C.softDrop(s);
        else if (dice === 7) C.hold(s);
        else C.hardDrop(s);
        C.tick(s, 16 * (1 + Math.floor(s.rng() * 3)));
        for (var i = 0; i < s.board.length; i++) {
          if (s.board[i] < 0 || s.board[i] > 7) throw new Error('棋盘非法 id');
        }
        if (!Number.isFinite(s.score) || s.score < 0) throw new Error('分数非法');
      }
    } catch (e) { err = e; }
    check('随机对局 400 步无异常', !err, err ? err.message : '已跑 ' + steps + ' 步，得分 ' + s.score);
    var badCells = 0;
    for (var bi = 0; bi < s.board.length; bi++) {
      if (!(s.board[bi] >= 0 && s.board[bi] <= 7)) badCells += 1;
    }
    check('棋盘值域 0..7', badCells === 0, '非法格 ' + badCells);
    check('分数有限非负', Number.isFinite(s.score) && s.score >= 0, 'score=' + s.score);

    var gl = renderer.getContext();
    check('WebGL 上下文可用', !!gl && !gl.isContextLost(), gl ? 'ok' : 'no gl');

    var drawn = renderer.info.render.calls;
    check('渲染管线有绘制调用', drawn > 0, 'calls=' + drawn);

    var t1 = performance.now();
    check('自检耗时 < 2000ms', (t1 - t0) < 2000, (t1 - t0).toFixed(0) + 'ms');

    var pass = results.filter(function (r) { return r.ok; }).length;
    window.__selftest = {
      pass: pass,
      fail: results.length - pass,
      results: results
    };
    if (console.table) console.table(results);
    var ok = pass === results.length;
    console.log('%c[SELFTEST] ' + (ok ? 'PASS' : 'FAIL') + ' ' + pass + '/' + results.length,
      'color:' + (ok ? '#7ef2a8' : '#ff7a94') + ';font-weight:bold');
    document.title = (ok ? 'SELFTEST PASS' : 'SELFTEST FAIL') + ' · 3D 俄罗斯方块';

    var rows = results.map(function (r) {
      return '<div style="display:flex;gap:8px;justify-content:space-between;font-size:12.5px;' +
        'padding:6px 2px;border-bottom:1px dashed rgba(255,255,255,.08)">' +
        '<span style="color:#efe9ff;text-align:left">' + r.name + '</span>' +
        '<span style="color:' + (r.ok ? '#7ef2a8' : '#ff7a94') + ';white-space:nowrap">' +
        (r.ok ? 'PASS' : 'FAIL') + '</span></div>';
    }).join('');
    el.overlay.classList.add('on');
    el.dialog.innerHTML =
      '<h1 style="font-size:22px">自检 ' + pass + '/' + results.length + '</h1>' +
      '<p style="margin-bottom:10px">' + (ok ? '全部通过' : '有失败项，见下') + ' · 耗时 ' +
      (t1 - t0).toFixed(0) + 'ms</p>' +
      '<div style="max-height:46vh;overflow:auto;text-align:left">' + rows + '</div>' +
      (ok ? '<button class="btn" id="selftestGo" style="margin-top:16px">进入游戏</button>' : '');
    var goBtn = document.getElementById('selftestGo');
    if (goBtn) goBtn.addEventListener('click', function () { hideOverlay(); startGame(); });
    overlayMode = 'start';

    // 自检面板保留在屏幕上：结果本身就是证据，不自动进入游戏把它盖掉
    return window.__selftest;
  }

  // 给自动化验证/截图用：随机落 n 块，把盘面推到中局
  function autoPlay(n) {
    for (var i = 0; i < n && state.status === 'playing'; i++) {
      var moves = Math.floor(Math.random() * 6) - 3;
      for (var m = 0; m < Math.abs(moves); m++) C.tryMove(state, moves > 0 ? 1 : -1, 0);
      if (Math.random() < 0.7) C.tryRotate(state, 1);
      C.hardDrop(state);
      drainEvents();
    }
    refreshBoardView();
    refreshActiveView();
    drawNext();
    drawHold();
    syncHud(true);
  }

  // 与 node 里验证过的局面完全一致：T 以 rot1 站在槽里，
  // 顺时针转进 rot2 后四角被占 → T-spin double。期望 +1200 分、消 2 行。
  function buildTSpinScenario() {
    state.board = new Uint8Array(COLS * ROWS);
    var put = function (x, y, t) { state.board[y * COLS + x] = C.PIECE_ID[t]; };
    for (var x = 0; x < COLS; x++) {
      if (x !== 4) put(x, 0, 'J');
      if (x < 3 || x > 5) put(x, 1, 'L');
    }
    put(3, 2, 'S'); put(5, 2, 'Z'); // 悬挑，制造四角被占
    state.active = { type: 'T', rot: 1, x: 3, y: 0 };
    state.status = 'playing';
    state.score = 0;
    state.lines = 0;
    state.level = 1;
    state.queue = ['I', 'O', 'S'];
    state.hold = null;
    state.events.length = 0;
    scenarioHold = true;
    refreshBoardView();
    refreshActiveView();
    drawNext();
    drawHold();
    syncHud(true);
  }

  // 接近满盘（约 160 块），用于压测渲染最坏情况
  function buildFullBoardScenario() {
    state.board = new Uint8Array(COLS * ROWS);
    var types = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];
    for (var y = 0; y < 17; y++) {
      for (var x = 0; x < COLS; x++) {
        if ((x * 7 + y * 3) % 11 === 0) continue; // 留洞，避免整行待消
        state.board[y * COLS + x] = C.PIECE_ID[types[(x * 3 + y) % 7]];
      }
    }
    state.active = { type: 'T', rot: 0, x: 4, y: 17 };
    state.status = 'playing';
    state.score = 0;
    state.lines = 0;
    state.level = 1;
    state.queue = ['I', 'O', 'S'];
    state.hold = null;
    state.events.length = 0;
    scenarioHold = true; // 静态压测：保持块数不变，只测渲染开销
    refreshBoardView();
    refreshActiveView();
    drawNext();
    drawHold();
    syncHud(true);
  }

  function buildTetrisScenario() {
    state.board = new Uint8Array(COLS * ROWS);
    for (var y = 0; y < 4; y++) {
      for (var x = 0; x < COLS; x++) {
        if (x === 5) continue; // 留一列给竖 I
        state.board[y * COLS + x] = C.PIECE_ID[(x + y) % 2 ? 'T' : 'L'];
      }
    }
    state.active = { type: 'I', rot: 1, x: 3, y: 8 }; // 竖 I，列 5
    state.status = 'playing';
    state.score = 3200;
    state.lines = 16;
    state.level = 2;
    state.queue = ['S', 'O', 'J'];
    state.hold = null;
    refreshBoardView();
    refreshActiveView();
    drawNext();
    drawHold();
    syncHud(true);
  }

  // 帧耗时基准：连续渲染 N 帧并每帧 gl.finish() 等 GPU 完成。
  // 不走 rAF，所以不受「标签页在后台被节流」影响，数字才可信。
  function runBench(frames) {
    var gl = renderer.getContext();
    for (var w = 0; w < 12; w++) renderer.render(scene, camera); // 预热，编译着色器
    gl.finish();
    var t0 = performance.now();
    for (var i = 0; i < frames; i++) {
      update(1 / 60, 1000 / 60);
      renderer.render(scene, camera);
      gl.finish();
    }
    var total = performance.now() - t0;
    var per = total / frames;
    var blocks = 0;
    for (var b = 0; b < state.board.length; b++) if (state.board[b]) blocks += 1;
    var info = renderer.info.render;
    var res = {
      frames: frames,
      msPerFrame: Number(per.toFixed(2)),
      fpsEquivalent: Number((1000 / per).toFixed(1)),
      drawCalls: info.calls,
      triangles: info.triangles,
      blocks: blocks
    };
    window.__bench = res;
    if (console.table) console.table(res);
    el.overlay.classList.add('on');
    el.dialog.innerHTML =
      '<h1 style="font-size:22px">帧耗时基准</h1>' +
      '<div class="big">' + res.msPerFrame + ' ms/帧</div>' +
      '<p>等效 ' + res.fpsEquivalent + ' fps · 已固定方块 ' + res.blocks + ' 块</p>' +
      '<div class="keys">' +
      '<span>draw call <b>' + res.drawCalls + '</b></span>' +
      '<span>三角面 <b>' + res.triangles.toLocaleString('en-US') + '</b></span>' +
      '<span>采样帧数 <b>' + res.frames + '</b></span>' +
      '<span>总耗时 <b>' + total.toFixed(0) + ' ms</b></span>' +
      '</div>';
    overlayMode = 'start';
    return res;
  }

  // 浸泡测试：固定步长同步推进，不依赖 rAF 与标签页可见性。
  // 无窗口的 Chromium 里标签页永远算后台，实时计时测到的帧率是假的；
  // 同步跑 N 秒虚拟时间反而更狠——几万帧连续调用 update/render，泄漏与状态错乱都会暴露。
  function runSoak(simSeconds) {
    var dtMs = 1000 / 60;
    var frames = Math.round(simSeconds * 1000 / dtMs);
    var heapOK = !!(performance.memory && performance.memory.usedJSHeapSize);
    var heapBefore = heapOK ? performance.memory.usedJSHeapSize : 0;
    var clearBefore = soak.clears;
    var tspinBefore = soak.tspins;
    var errorsBefore = soak.errors;
    var lockBefore = soak.locks;
    var worst = 0;
    var thrown = null;
    var t0 = performance.now();

    for (var i = 0; i < frames; i++) {
      if (state.status === 'over') {
        soak.games += 1;
        restart();
      }
      // 每 900 帧注入一次「四连消」局面：专门反复压测消行路径
      //（闪光 mesh 的创建与 dispose、提示、计分），这是最容易漏内存的地方。
      if (i > 0 && i % 900 === 450) {
        state.board = new Uint8Array(COLS * ROWS);
        for (var iy = 0; iy < 4; iy++) {
          for (var ix = 0; ix < COLS; ix++) {
            if (ix !== 5) state.board[iy * COLS + ix] = C.PIECE_ID[ix % 2 ? 'T' : 'L'];
          }
        }
        state.active = { type: 'I', rot: 1, x: 3, y: 8 };
        state.status = 'playing';
        C.hardDrop(state);
      }
      // 随机铺开，避免只堆中柱
      if (state.active && (i % 90 === 0 || C.isGrounded(state))) {
        var want = Math.floor(Math.random() * 7) - 3;
        for (var m = 0; m < Math.abs(want); m++) C.tryMove(state, want > 0 ? 1 : -1, 0);
        if (Math.random() < 0.6) C.tryRotate(state, 1);
        C.hardDrop(state);
      }
      try {
        var f0 = performance.now();
        update(dtMs / 1000, dtMs);
        renderer.render(scene, camera);
        var spent = performance.now() - f0;
        if (spent > worst) worst = spent;
      } catch (e) {
        thrown = e;
        soak.errors += 1;
        break;
      }
    }
    renderer.getContext().finish();
    var wall = performance.now() - t0;
    var heapAfter = heapOK ? performance.memory.usedJSHeapSize : 0;
    var heapDelta = (heapOK && heapBefore) ? ((heapAfter - heapBefore) / 1048576) : 0;

    var res = {
      simSeconds: simSeconds,
      frames: frames,
      wallMs: Number(wall.toFixed(0)),
      msPerFrame: Number((wall / frames).toFixed(2)),
      games: soak.games,
      clears: soak.clears - clearBefore,
      tspins: soak.tspins - tspinBefore,
      errors: soak.errors - errorsBefore,
      heapDeltaMB: heapOK ? Number(heapDelta.toFixed(1)) : null,
      locks: soak.locks - lockBefore,
      worstFrameMs: Number(worst.toFixed(1)),
      thrown: thrown ? String(thrown && thrown.message) : null
    };
    window.__soak = res;
    if (console.table) console.table(res);

    el.overlay.classList.add('on');
    el.dialog.innerHTML =
      '<h1 style="font-size:22px">浸泡测试</h1>' +
      '<div class="big">' + res.frames.toLocaleString('en-US') + ' 帧</div>' +
      '<p>相当于连续游戏 ' + res.simSeconds + ' 秒 · 实际耗时 ' + res.wallMs + ' ms · ' +
      res.msPerFrame + ' ms/帧</p>' +
      '<div class="keys">' +
      '<span>完成对局 <b>' + res.games + '</b></span>' +
      '<span>消行次数 <b>' + res.clears + '</b></span>' +
      '<span>T-spin <b>' + res.tspins + '</b></span>' +
      '<span>运行错误 <b>' + res.errors + '</b></span>' +
      '<span>堆增长 <b>' + (res.heapDeltaMB === null ? 'n/a' : res.heapDeltaMB + ' MB') + '</b></span>' +
      '<span>累计落块 <b>' + res.locks + '</b></span>' +
      '</div>' +
      (res.thrown ? '<p style="color:#ff7a94">异常：' + res.thrown + '</p>' : '');
    overlayMode = 'start';
    return res;
  }

  function buildDemoBoard() {
    // 造一个「玩到一半」的漂亮盘面：阶梯状堆叠 + 一个空槽
    var heights = [3, 5, 2, 4, 6, 4, 3, 5, 2, 4];
    var types = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];
    for (var x = 0; x < COLS; x++) {
      for (var y = 0; y < heights[x]; y++) {
        state.board[y * COLS + x] = C.PIECE_ID[types[(x + y) % 7]];
      }
    }
    state.active = { type: 'T', rot: 0, x: 3, y: 12 };
    state.status = 'playing';
    state.score = 12450;
    state.lines = 23;
    state.level = 3;
    state.queue = ['S', 'Z', 'L'];
    state.hold = 'I';
    refreshBoardView();
    refreshActiveView();
    drawNext();
    drawHold();
    syncHud(true);
  }

  // ---------------------------------------------------------------- 启动
  var fpsEl = null;
  function mountFpsPanel() {
    if (!showFps) return;
    fpsEl = document.createElement('div');
    fpsEl.id = 'fpsPanel';
    fpsEl.style.cssText = 'position:fixed;left:18px;bottom:calc(14px + env(safe-area-inset-bottom));' +
      'z-index:4;font:700 13px/1.4 ui-monospace,Menlo,monospace;color:#7ef2a8;' +
      'background:rgba(8,4,20,.7);border:1px solid rgba(255,255,255,.14);border-radius:12px;' +
      'padding:8px 12px;pointer-events:none;';
    fpsEl.textContent = 'FPS --';
    document.body.appendChild(fpsEl);
  }

  function boot() {
    mountFpsPanel();
    buildWell();
    buildPool();
    fitCamera();
    updateCamera(0);
    setMuted(Sound.muted);

    // 预览画布的 CSS 尺寸依赖布局，等一帧再画
    requestAnimationFrame(function () {
      drawNext();
      drawHold();
    });

    syncHud(true);
    rafId = requestAnimationFrame(frame);

    // 启动顺序很重要：先摆好场景（若有），再让压在场景上的测试模式接管。
    // 之前把 bench 分支放在场景分支前面，导致 ?scenario=full&bench=300 测到的是空盘。
    var scenarioBuilt = false;
    if (scenario === 'tetris') { hideOverlay(); buildTetrisScenario(); scenarioBuilt = true; }
    else if (scenario === 'tspin') { hideOverlay(); buildTSpinScenario(); scenarioBuilt = true; }
    else if (scenario === 'full') { hideOverlay(); buildFullBoardScenario(); scenarioBuilt = true; }
    else if (isDemo) { hideOverlay(); buildDemoBoard(); scenarioBuilt = true; }

    if (isSelfTest) {
      setTimeout(runSelfTest, 60);
    } else if (soakSec > 0) {
      hideOverlay();
      startGame();
      setTimeout(function () { runSoak(soakSec); }, 120);
    } else if (autoN > 0) {
      hideOverlay();
      startGame();
      // 固定往左堆，保证在有限块数内顶到出生点，从而真正走完一局
      for (var k = 0; k < autoN && state.status === 'playing'; k++) {
        for (var mv = 0; mv < 6; mv++) C.tryMove(state, -1, 0);
        C.hardDrop(state);
        drainEvents();
      }
      refreshBoardView();
      refreshActiveView();
      drawNext();
      drawHold();
      syncHud(true);
    } else if (benchN > 0) {
      hideOverlay();
      setTimeout(function () { runBench(benchN); }, 200);
    } else if (!scenarioBuilt) {
      showStart();
    }

    window.__game = {
      get state() { return state; },
      api: C,
      start: startGame,
      restart: restart,
      autoPlay: autoPlay,
      demo: buildDemoBoard,
      toast: toast,
      fps: function () { return fpsValue; },
      // 供自动化脚本驱动：等价于按一次键
      press: function (code) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: code }));
        window.dispatchEvent(new KeyboardEvent('keyup', { code: code }));
      }
    };
    window.__version = '1.0.0';
    window.__seed = SEED;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
