/**
 * 舞台层：只负责“一个能看的世界”——渲染器、光照、棋盘、墙、相机。
 * 不含蛇/食物/道具，那些在 view.js。
 *
 * 为什么把相机控制放在这里：相机方位不仅决定画面，还决定 WASD 的方向语义
 * （屏幕上方 = 世界哪个方向）。把它和输入映射放在一处，才不会出现“转了视角
 * 但按键方向没跟着转”的经典 bug。
 */
import * as THREE from '../vendor/three.module.js';
import { RoundedBoxGeometry } from '../vendor/RoundedBoxGeometry.js';
import { COLS, ROWS, CELL } from './config.js';

/** 格坐标 → 世界坐标（棋盘中心为原点，格 y 映射到世界 z）。 */
export function cellToWorld(x, y) {
  return {
    x: (x - (COLS - 1) / 2) * CELL,
    z: (y - (ROWS - 1) / 2) * CELL,
  };
}

/** 一层柔和的环境反射：果冻质感主要靠它，纯色材质会显得像塑料板。 */
function buildEnvironment(renderer) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0.00, '#eaf3ff');
  grad.addColorStop(0.35, '#93a8d8');
  grad.addColorStop(0.62, '#3a4770');
  grad.addColorStop(1.00, '#0a0e1a');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 64);
  // 顶部一块高光，让圆角高亮有方向感
  const spot = g.createRadialGradient(38, 18, 2, 38, 18, 46);
  spot.addColorStop(0, 'rgba(255,255,255,.95)');
  spot.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = spot;
  g.fillRect(0, 0, 128, 64);

  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose();
  tex.dispose();
  return env;
}

/** 棋盘地面纹理：2×2 格的棋盘格 + 细网格线，重复贴满整个盘面。 */
function buildGridTexture() {
  const S = 256;             // 2×2 格
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#1d2540';
  g.fillRect(0, 0, S, S);
  g.fillStyle = '#232c4a';
  g.fillRect(0, 0, S / 2, S / 2);
  g.fillRect(S / 2, S / 2, S / 2, S / 2);

  g.strokeStyle = 'rgba(132,178,255,.18)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(S / 2, 0); g.lineTo(S / 2, S);
  g.moveTo(0, S / 2); g.lineTo(S, S / 2);
  g.moveTo(1, 0); g.lineTo(1, S);
  g.moveTo(0, 1); g.lineTo(S, 1);
  g.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(COLS / 2, ROWS / 2);
  tex.anisotropy = 8;
  return tex;
}

export function createStage(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x070a14);
  scene.fog = new THREE.Fog(0x070a14, 36, 74);
  scene.environment = buildEnvironment(renderer);

  const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 240);
  const target = new THREE.Vector3(0, -1.1, 0);

  /* ---------- 光照 ---------- */
  const hemi = new THREE.HemisphereLight(0xbcd4ff, 0x0d1424, 1.15);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(9, 18, 11);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 60;
  const span = Math.max(COLS, ROWS) * 0.75 + 4;
  key.shadow.camera.left = -span;
  key.shadow.camera.right = span;
  key.shadow.camera.top = span;
  key.shadow.camera.bottom = -span;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.02;
  scene.add(key);

  const rim = new THREE.PointLight(0x6ad9ff, 140, 70, 2);
  rim.position.set(-11, 8, -13);
  scene.add(rim);

  const rim2 = new THREE.PointLight(0x9a7bff, 90, 60, 2);
  rim2.position.set(12, 5, -9);
  scene.add(rim2);

  /* ---------- 棋盘 ---------- */
  const boardGroup = new THREE.Group();
  scene.add(boardGroup);

  const padW = COLS * CELL + 1.5;
  const padD = ROWS * CELL + 1.5;
  const padH = 1.5;

  const padMat = new THREE.MeshPhysicalMaterial({
    color: 0x232c4d,
    roughness: 0.35,
    metalness: 0.15,
    clearcoat: 0.6,
    clearcoatRoughness: 0.4,
  });
  const pad = new THREE.Mesh(new RoundedBoxGeometry(padW, padH, padD, 4, 0.42), padMat);
  pad.position.y = -padH / 2;
  pad.receiveShadow = true;
  boardGroup.add(pad);

  // 底面发光边，让托盘像悬浮着
  // 圆角半径必须小于最小边的一半，否则 RoundedBoxGeometry 会把顶点翻到反面
  const underGlow = new THREE.Mesh(
    new RoundedBoxGeometry(padW + 0.12, 0.22, padD + 0.12, 2, 0.06),
    new THREE.MeshBasicMaterial({ color: 0x2a4bff, transparent: true, opacity: 0.5 }),
  );
  underGlow.position.y = -padH + 0.02;
  boardGroup.add(underGlow);

  const gridPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(COLS * CELL, ROWS * CELL),
    new THREE.MeshStandardMaterial({
      map: buildGridTexture(),
      roughness: 0.85,
      metalness: 0.05,
      emissive: 0x131c34,
      emissiveIntensity: 1,
    }),
  );
  gridPlane.rotation.x = -Math.PI / 2;
  gridPlane.position.y = 0.004;
  gridPlane.receiveShadow = true;
  boardGroup.add(gridPlane);

  /* ---------- 墙 / 传送边框 ---------- */
  const wallGroup = new THREE.Group();
  boardGroup.add(wallGroup);
  const wallMat = new THREE.MeshPhysicalMaterial({
    color: 0x6a4bff,
    emissive: 0x4a2bd8,
    emissiveIntensity: 0.55,
    roughness: 0.2,
    metalness: 0.1,
    transparent: true,
    opacity: 0.55,
    clearcoat: 1,
    clearcoatRoughness: 0.15,
  });
  const wallH = 1.1;
  const walls = [];
  const halfX = (COLS * CELL) / 2;
  const halfZ = (ROWS * CELL) / 2;
  const wallDefs = [
    { w: COLS * CELL + 0.7, d: 0.45, x: 0, z: -halfZ - 0.32 },
    { w: COLS * CELL + 0.7, d: 0.45, x: 0, z: halfZ + 0.32 },
    { w: 0.45, d: ROWS * CELL + 0.7, x: -halfX - 0.32, z: 0 },
    { w: 0.45, d: ROWS * CELL + 0.7, x: halfX + 0.32, z: 0 },
  ];
  for (const d of wallDefs) {
    const m = new THREE.Mesh(new RoundedBoxGeometry(d.w, wallH, d.d, 2, 0.16), wallMat);
    m.position.set(d.x, wallH / 2, d.z);
    m.castShadow = true;
    m.receiveShadow = true;
    wallGroup.add(m);
    walls.push(m);
  }

  // 穿墙模式的传送门：贴地霓虹细边 + 四面能量幕（只有细边的话几乎看不见）
  const curtainTex = (() => {
    const c = document.createElement('canvas');
    c.width = 8; c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 64, 0, 0);
    grd.addColorStop(0, 'rgba(255,255,255,.95)');
    grd.addColorStop(0.4, 'rgba(255,255,255,.22)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 8, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const curtainMat = new THREE.MeshBasicMaterial({
    map: curtainTex,
    color: 0x6ad9ff,
    transparent: true,
    opacity: 0.45,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const gateGroup = new THREE.Group();
  boardGroup.add(gateGroup);
  const gateMat = new THREE.MeshBasicMaterial({ color: 0x6ad9ff, transparent: true, opacity: 0.85 });
  const gateDefs = [
    { w: COLS * CELL + 0.4, d: 0.1, x: 0, z: -halfZ - 0.1 },
    { w: COLS * CELL + 0.4, d: 0.1, x: 0, z: halfZ + 0.1 },
    { w: 0.1, d: ROWS * CELL + 0.4, x: -halfX - 0.1, z: 0 },
    { w: 0.1, d: ROWS * CELL + 0.4, x: halfX + 0.1, z: 0 },
  ];
  for (const d of gateDefs) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(d.w, 0.05, d.d), gateMat);
    m.position.set(d.x, 0.03, d.z);
    gateGroup.add(m);
  }

  const curtainDefs = [
    { w: COLS * CELL, x: 0, z: -halfZ, ry: 0 },
    { w: COLS * CELL, x: 0, z: halfZ, ry: Math.PI },
    { w: ROWS * CELL, x: -halfX, z: 0, ry: Math.PI / 2 },
    { w: ROWS * CELL, x: halfX, z: 0, ry: -Math.PI / 2 },
  ];
  const curtains = [];
  for (const d of curtainDefs) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(d.w, 1.0), curtainMat);
    m.position.set(d.x, 0.5, d.z);
    m.rotation.y = d.ry;
    gateGroup.add(m);
    curtains.push(m);
  }

  function setWallMode(mode) {
    const classic = mode === 'classic';
    wallGroup.visible = classic;
    gateGroup.visible = !classic;
  }
  setWallMode('classic');

  /* ---------- 相机控制 ---------- */
  const cam = {
    radius: 40,
    theta: -0.62,     // 方位角
    phi: 0.95,        // 极角（0 = 正上方）
    minRadius: 20,
    maxRadius: 62,
    minPhi: 0.32,
    maxPhi: 1.30,
  };
  let shakeAmp = 0;
  let shakeTime = 0;

  function placeCamera() {
    const sp = Math.sin(cam.phi);
    camera.position.set(
      cam.radius * sp * Math.sin(cam.theta),
      cam.radius * Math.cos(cam.phi),
      cam.radius * sp * Math.cos(cam.theta),
    );
    if (shakeTime > 0) {
      const a = shakeAmp * (shakeTime / 0.4);
      camera.position.x += (Math.random() - 0.5) * a;
      camera.position.y += (Math.random() - 0.5) * a * 0.6;
      camera.position.z += (Math.random() - 0.5) * a;
    }
    camera.lookAt(target);
  }
  placeCamera();

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let pinchDist = 0;

  const pointers = new Map();

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) { dragging = true; lastX = e.clientX; lastY = e.clientY; }
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      dragging = false;
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0) {
        cam.radius = clamp(cam.radius * (pinchDist / d), cam.minRadius, cam.maxRadius);
        placeCamera();
      }
      pinchDist = d;
      return;
    }
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    cam.theta -= dx * 0.006;
    cam.phi = clamp(cam.phi - dy * 0.005, cam.minPhi, cam.maxPhi);
    placeCamera();
  });
  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) { dragging = false; pinchDist = 0; }
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    cam.radius = clamp(cam.radius + e.deltaY * 0.02, cam.minRadius, cam.maxRadius);
    placeCamera();
  }, { passive: false });
  canvas.addEventListener('dblclick', () => {
    cam.theta = -0.62; cam.phi = 0.95; cam.radius = 40;
    placeCamera();
  });

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  return {
    renderer,
    scene,
    camera,
    boardGroup,
    target,
    cam,
    cellToWorld,
    halfX,
    halfZ,
    setWallMode,
    resize,
    placeCamera,
    shake(amp = 0.5, time = 0.4) {
      shakeAmp = amp;
      shakeTime = time;
    },
    /** 相机方位角，输入层用它把 WASD 投影到世界方向。 */
    get azimuth() { return cam.theta; },
    update(dt) {
      if (shakeTime > 0) {
        shakeTime = Math.max(0, shakeTime - dt);
        placeCamera();
      }
      // 传送门边框呼吸
      if (gateGroup.visible) {
        gateMat.opacity = 0.55 + 0.35 * Math.sin(performance.now() * 0.004);
        curtainMat.opacity = 0.32 + 0.16 * Math.sin(performance.now() * 0.0026);
      }
    },
    render() { renderer.render(scene, camera); },
  };
}
