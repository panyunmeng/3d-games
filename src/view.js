/**
 * 表现层：把 logic.js 的离散状态画成连续画面。
 *
 * 关键约束：逻辑每 tick 走一格，屏幕每秒 60 帧。若直接把格子坐标赋值给网格，
 * 蛇会“跳格”。所以每个身体段都从 prevSnake[i] 插值到 snake[i]，
 * t = 本 tick 已过去的比例；穿墙时两点距离 >1 格，插值会横穿全盘，此时直接吸附。
 */
import * as THREE from '../vendor/three.module.js';
import { RoundedBoxGeometry } from '../vendor/RoundedBoxGeometry.js';
import { ITEM_TYPES } from './config.js';

const Y_BASE = 0.47;
const SEG_SIZE = 1.0;
const HEAD_SIZE = 1.12;


/** 竖直光柱：在俯视角度下，地面上的小物件靠它才看得见（不然只占几个像素）。 */
function makeBeam(color, radius = 0.2, height = 2.4) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.3, radius, height, 16, 1, true),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  mesh.position.y = height / 2;
  return mesh;
}

export function createView(stage) {
  const { scene, cellToWorld } = stage;
  const root = new THREE.Group();
  scene.add(root);

  /* ---------------- 蛇 ---------------- */
  const snakeGroup = new THREE.Group();
  root.add(snakeGroup);

  const headGeo = new RoundedBoxGeometry(HEAD_SIZE, HEAD_SIZE, HEAD_SIZE, 3, 0.3);
  const bodyGeo = new RoundedBoxGeometry(SEG_SIZE, SEG_SIZE, SEG_SIZE, 3, 0.26);

  const headMat = new THREE.MeshPhysicalMaterial({
    color: 0x7dffb8,
    roughness: 0.22,
    metalness: 0.05,
    clearcoat: 1,
    clearcoatRoughness: 0.18,
    emissive: 0x1f7d55,
    emissiveIntensity: 0.35,
  });

  const headGroup = new THREE.Group();
  const headMesh = new THREE.Mesh(headGeo, headMat);
  headMesh.castShadow = true;
  headGroup.add(headMesh);

  // 眼睛朝向模型 +z，headGroup 的 yaw 让 +z 对齐前进方向
  const eyeGeo = new THREE.SphereGeometry(0.165, 18, 14);
  const pupilGeo = new THREE.SphereGeometry(0.085, 14, 12);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25, emissive: 0xffffff, emissiveIntensity: 0.12 });
  const pupilMat = new THREE.MeshStandardMaterial({ color: 0x101828, roughness: 0.4 });
  // 眼睛放在“顶面前部”而不是正前方：相机从斜上方看，正前方的眼睛永远被头挡住，
  // 顶面的眼睛则总能看到，玩家才认得出哪个是头。
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(0.28 * sx, 0.48, 0.26);
    const pupil = new THREE.Mesh(pupilGeo, pupilMat);
    pupil.position.set(0.28 * sx, 0.545, 0.37);
    headGroup.add(eye, pupil);
  }

  const segments = [];  // { mesh, mat, isHead }
  let headSeg = null;

  function ensureSegments(n) {
    while (segments.length < n) {
      const i = segments.length;
      if (i === 0) {
        if (!headSeg) headSeg = { mesh: headGroup, mat: headMat, isHead: true };
        segments.push(headSeg);
        snakeGroup.add(headGroup);
        continue;
      }
      const mat = new THREE.MeshPhysicalMaterial({
        color: 0x55e6a0,
        roughness: 0.26,
        metalness: 0.04,
        clearcoat: 1,
        clearcoatRoughness: 0.22,
        emissive: 0x0f4a35,
        emissiveIntensity: 0.28,
      });
      const mesh = new THREE.Mesh(bodyGeo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const seg = { mesh, mat, isHead: false };
      segments.push(seg);
      snakeGroup.add(mesh);
    }
    for (let i = 0; i < segments.length; i++) {
      segments[i].mesh.visible = i < n;
    }
  }

  const tmpColor = new THREE.Color();
  const DEAD_COLOR = new THREE.Color(0xff4d5e);
  let deadBlend = 0;

  function syncSnake(state, u, time) {
    const snake = state.snake;
    const prev = state.prevSnake || snake;
    ensureSegments(snake.length);

    const headCell = snake[0];
    const dir = state.dir;
    // yaw：模型 +z 对准 (dir.x, dir.y)，即世界 (x, z)
    const targetYaw = Math.atan2(dir.x, dir.y);
    let yaw = headGroup.rotation.y;
    let delta = targetYaw - yaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    yaw += delta * 0.35;
    headGroup.rotation.y = yaw;

    const dead = state.status === 'dead' || state.status === 'timeout';
    deadBlend += ((dead ? 1 : 0) - deadBlend) * 0.08;

    for (let i = 0; i < snake.length; i++) {
      const seg = segments[i];
      const to = cellToWorld(snake[i].x, snake[i].y);
      const f = prev[Math.min(i, prev.length - 1)] || snake[i];
      const from = cellToWorld(f.x, f.y);
      const jumped = Math.abs(to.x - from.x) > 1.4 || Math.abs(to.z - from.z) > 1.4;
      const t = jumped ? 1 : u;
      let x = from.x + (to.x - from.x) * t;
      let z = from.z + (to.z - from.z) * t;

      const phase = time * 5.2 - i * 0.72;
      const wob = Math.sin(phase);
      let y = Y_BASE + (seg.isHead ? 0.05 : 0) + wob * 0.018;
      let sx = 1 + wob * (seg.isHead ? 0.05 : 0.04);
      let sy = 1 - wob * (seg.isHead ? 0.05 : 0.045);
      let sz = sx;

      if (jumped) {
        // 穿墙瞬间把身体压扁一下，避免“瞬移”没有过渡感
        const k = 1 - Math.min(1, Math.abs(u - 0.5) * 2) * 0.12;
        sx *= k; sz *= k;
      }

      seg.mesh.position.set(x, y, z);
      seg.mesh.scale.set(sx, sy, sz);

      if (!seg.isHead) {
        const f01 = i / Math.max(1, snake.length - 1);
        tmpColor.setHSL(0.40 - 0.09 * f01, 0.72, 0.58 - 0.14 * f01);
        if (deadBlend > 0.001) tmpColor.lerp(DEAD_COLOR, deadBlend * 0.85);
        seg.mat.color.copy(tmpColor);
      } else {
        headMat.emissiveIntensity = 0.35 + (dead ? 0.6 : 0.15 * Math.sin(time * 4));
      }
    }

    // 蛇落败时整条往下沉一点，配合红化表达“融掉”
    snakeGroup.position.y = -deadBlend * 0.18;
  }

  /* ---------------- 食物 ---------------- */
  const foodGroup = new THREE.Group();
  root.add(foodGroup);
  const foodMat = new THREE.MeshPhysicalMaterial({
    color: 0xff5d8f,
    roughness: 0.18,
    metalness: 0.1,
    clearcoat: 1,
    emissive: 0xff2d6b,
    emissiveIntensity: 0.65,
  });
  const foodMesh = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 18), foodMat);
  foodMesh.castShadow = true;
  foodGroup.add(foodMesh);
  const foodRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.42, 0.035, 8, 32),
    new THREE.MeshBasicMaterial({ color: 0xff9dc0, transparent: true, opacity: 0.75 }),
  );
  foodRing.rotation.x = Math.PI / 2;
  foodGroup.add(foodRing);
  const foodBeam = makeBeam(0xff5d8f, 0.2, 2.2);
  foodGroup.add(foodBeam);

  function syncFood(state, time) {
    if (!state.food) { foodGroup.visible = false; return; }
    foodGroup.visible = true;
    const p = cellToWorld(state.food.x, state.food.y);
    const bob = Math.sin(time * 2.6) * 0.06;
    foodGroup.position.set(p.x, Y_BASE + 0.12 + bob, p.z);
    const pulse = 1 + Math.sin(time * 3.4) * 0.07;
    foodMesh.scale.setScalar(pulse);
    foodRing.rotation.z = time * 1.1;
    foodRing.scale.setScalar(1 + Math.sin(time * 2 + 1) * 0.08);
    foodMat.emissiveIntensity = 0.55 + Math.sin(time * 3.4) * 0.2;
    foodBeam.material.opacity = 0.06 + Math.sin(time * 3.4) * 0.02;
  }

  /* ---------------- 道具 ---------------- */
  const itemGroup = new THREE.Group();
  root.add(itemGroup);
  const itemMeshes = {};
  const itemRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.46, 0.02, 6, 28),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }),
  );
  itemRing.rotation.x = Math.PI / 2;
  itemGroup.add(itemRing);
  const itemBeam = makeBeam(0xffffff, 0.26, 2.8);
  itemGroup.add(itemBeam);

  function makeItemMesh(kind) {
    const color = ITEM_TYPES[kind].color;
    const mat = new THREE.MeshPhysicalMaterial({
      color,
      roughness: 0.15,
      metalness: 0.15,
      clearcoat: 1,
      emissive: color,
      emissiveIntensity: 0.9,
      transparent: true,
      opacity: 1,
    });
    let geo;
    if (kind === 'speed') geo = new THREE.OctahedronGeometry(0.37, 0);
    else if (kind === 'slow') geo = new THREE.IcosahedronGeometry(0.37, 0);
    else geo = new THREE.TorusGeometry(0.3, 0.11, 10, 24);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    return mesh;
  }
  for (const kind of Object.keys(ITEM_TYPES)) {
    const m = makeItemMesh(kind);
    m.visible = false;
    itemMeshes[kind] = m;
    itemGroup.add(m);
  }

  function syncItem(state, time) {
    const it = state.item;
    if (!it) { itemGroup.visible = false; return; }
    itemGroup.visible = true;
    const p = cellToWorld(it.x, it.y);
    itemGroup.position.set(p.x, Y_BASE + 0.18 + Math.sin(time * 2.2) * 0.07, p.z);
    for (const [kind, mesh] of Object.entries(itemMeshes)) mesh.visible = kind === it.kind;
    const mesh = itemMeshes[it.kind];
    mesh.rotation.y = time * 1.6;
    mesh.rotation.x = kind3(it.kind) ? Math.sin(time * 1.2) * 0.35 : 0;
    if (it.kind === 'time') mesh.rotation.z = time * 0.8;
    itemRing.rotation.z = -time * 0.9;
    itemBeam.material.color.set(ITEM_TYPES[it.kind].color);
    itemBeam.material.opacity = 0.09 + Math.sin(time * 2.6) * 0.03;
    // 即将消失时闪烁
    const blink = it.ttl < 4000 ? (0.35 + 0.65 * Math.abs(Math.sin(time * 9))) : 1;
    itemGroup.scale.setScalar(0.94 + Math.sin(time * 3) * 0.04);
    for (const m of Object.values(itemMeshes)) m.material.opacity = blink;
  }
  const kind3 = (k) => k !== 'time';

  /* ---------------- 障碍 ---------------- */
  const obstacleGroup = new THREE.Group();
  root.add(obstacleGroup);
  const obstacleGeo = new RoundedBoxGeometry(0.9, 0.9, 0.9, 2, 0.22);
  const obstacleMat = new THREE.MeshPhysicalMaterial({
    // 冷色金属块：和粉色食物、紫色墙、三色道具都拉得开，不必靠颜色记忆
    color: 0x232b47,
    roughness: 0.32,
    metalness: 0.55,
    clearcoat: 0.7,
    clearcoatRoughness: 0.3,
    emissive: 0x5f7bd8,
    emissiveIntensity: 0.5,
  });
  const obstacleMap = new Map();

  function syncObstacles(state) {
    const seen = new Set();
    for (const o of state.obstacles) {
      const k = `${o.x},${o.y}`;
      seen.add(k);
      if (!obstacleMap.has(k)) {
        const mesh = new THREE.Mesh(obstacleGeo, obstacleMat);
        const p = cellToWorld(o.x, o.y);
        mesh.position.set(p.x, 0.45, p.z);
        mesh.rotation.y = (Math.sin(o.x * 12.9898 + o.y * 78.233) * 43758.5453 % 1) * 0.16;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        obstacleGroup.add(mesh);
        obstacleMap.set(k, mesh);
        // 生成动画：从 0 弹出来
        mesh.scale.setScalar(0.01);
        mesh.userData.grow = 0;
      }
    }
    for (const [k, mesh] of obstacleMap) {
      if (!seen.has(k)) {
        obstacleGroup.remove(mesh);
        obstacleMap.delete(k);
      }
    }
  }

  function animateObstacles(dt) {
    for (const mesh of obstacleMap.values()) {
      if (mesh.userData.grow < 1) {
        mesh.userData.grow = Math.min(1, mesh.userData.grow + dt * 6);
        const g = mesh.userData.grow;
        // 轻微过冲，像果冻弹一下
        mesh.scale.setScalar(1 + Math.sin(g * Math.PI) * 0.12 - (1 - g) * 0.999);
      } else {
        mesh.scale.setScalar(1);
      }
    }
  }

  /* ---------------- 粒子 / 冲击环 ---------------- */
  const fxGroup = new THREE.Group();
  root.add(fxGroup);
  const particlePool = [];
  const PARTICLE_GEO = new THREE.IcosahedronGeometry(0.085, 0);
  for (let i = 0; i < 90; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(PARTICLE_GEO, mat);
    mesh.visible = false;
    fxGroup.add(mesh);
    particlePool.push({ mesh, mat, life: 0, max: 1, vx: 0, vy: 0, vz: 0 });
  }
  let particleCursor = 0;

  function burst(cell, color, count = 12, power = 3.4) {
    const p = cellToWorld(cell.x, cell.y);
    for (let i = 0; i < count; i++) {
      const pr = particlePool[particleCursor];
      particleCursor = (particleCursor + 1) % particlePool.length;
      const a = Math.random() * Math.PI * 2;
      const r = 0.6 + Math.random() * 0.9;
      pr.mesh.position.set(p.x, Y_BASE + 0.1, p.z);
      pr.mesh.visible = true;
      pr.mesh.scale.setScalar(0.6 + Math.random() * 0.8);
      pr.mat.color.set(color);
      pr.mat.opacity = 1;
      pr.vx = Math.cos(a) * r * power * 0.35;
      pr.vz = Math.sin(a) * r * power * 0.35;
      pr.vy = 1.6 + Math.random() * 2.6;
      pr.life = pr.max = 0.45 + Math.random() * 0.35;
    }
  }

  const ringPool = [];
  for (let i = 0; i < 6; i++) {
    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(0.4, 0.05, 8, 40),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    mesh.rotation.x = Math.PI / 2;
    mesh.visible = false;
    fxGroup.add(mesh);
    ringPool.push({ mesh, life: 0, max: 0.5 });
  }
  let ringCursor = 0;

  function shock(cell, color, size = 1.4) {
    const r = ringPool[ringCursor];
    ringCursor = (ringCursor + 1) % ringPool.length;
    const p = cellToWorld(cell.x, cell.y);
    r.mesh.position.set(p.x, 0.08, p.z);
    r.mesh.scale.setScalar(0.4);
    r.mesh.material.color.set(color);
    r.mesh.material.opacity = 0.85;
    r.mesh.visible = true;
    r.life = r.max = 0.55;
    r.size = size;
  }

  function animateFx(dt) {
    for (const pr of particlePool) {
      if (pr.life <= 0) continue;
      pr.life -= dt;
      if (pr.life <= 0) { pr.mesh.visible = false; pr.mat.opacity = 0; continue; }
      pr.vy -= 9.8 * dt;
      pr.mesh.position.x += pr.vx * dt;
      pr.mesh.position.y += pr.vy * dt;
      pr.mesh.position.z += pr.vz * dt;
      if (pr.mesh.position.y < 0.06) { pr.mesh.position.y = 0.06; pr.vy *= -0.35; }
      pr.mat.opacity = Math.max(0, pr.life / pr.max);
      pr.mesh.rotation.x += dt * 6;
      pr.mesh.rotation.y += dt * 4;
    }
    for (const r of ringPool) {
      if (r.life <= 0) continue;
      r.life -= dt;
      if (r.life <= 0) { r.mesh.visible = false; r.mesh.material.opacity = 0; continue; }
      const k = 1 - r.life / r.max;
      r.mesh.scale.setScalar(0.4 + k * r.size * 2.2);
      r.mesh.material.opacity = 0.85 * (1 - k);
    }
  }

  /* ---------------- 对外接口 ---------------- */

  function sync(state, u, time) {
    syncSnake(state, u, time);
    syncFood(state, time);
    syncItem(state, time);
    syncObstacles(state);
  }

  function onEvents(events, state) {
    for (const ev of events) {
      if (ev.type === 'eat') {
        burst(ev.cell, 0xff9dc0, 14, 4);
        shock(ev.cell, 0xff7db0, 1.1);
      } else if (ev.type === 'item') {
        burst(ev.cell, ITEM_TYPES[ev.kind].color, 18, 5);
        shock(ev.cell, ITEM_TYPES[ev.kind].color, 1.4);
      } else if (ev.type === 'wrap') {
        burst(ev.from, 0x6ad9ff, 6, 2);
        burst(ev.to, 0x6ad9ff, 6, 2);
      } else if (ev.type === 'die') {
        const head = state.snake[0];
        burst(head, 0xff4d5e, 26, 6);
        shock(head, 0xff4d5e, 2.2);
        stage.shake(0.75, 0.45);
      } else if (ev.type === 'levelclear') {
        shock(state.food || state.snake[0], 0x6cf0a8, 3);
        burst(state.snake[0], 0x6cf0a8, 20, 5);
      } else if (ev.type === 'obstacle') {
        const last = state.obstacles[state.obstacles.length - 1];
        if (last) burst(last, 0x9a7bff, 8, 2.5);
      }
    }
  }

  function reset() {
    deadBlend = 0;
    snakeGroup.position.y = 0;
    for (const mesh of obstacleMap.values()) obstacleGroup.remove(mesh);
    obstacleMap.clear();
    for (const pr of particlePool) { pr.life = 0; pr.mesh.visible = false; pr.mat.opacity = 0; }
    for (const r of ringPool) { r.life = 0; r.mesh.visible = false; r.mesh.material.opacity = 0; }
  }

  return {
    sync,
    onEvents,
    reset,
    update(dt) { animateFx(dt); animateObstacles(dt); },
    dispose() {
      // 一局结束不回收到页面级别，这里只做基本清理
      root.clear();
    },
  };
}
