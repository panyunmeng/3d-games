import * as THREE from 'three';
import { BASE_CENTER, GRID_W, TILE, WORLD_H, WORLD_W } from '../sim/constants';

/**
 * 程序生成贴图：项目不加载任何外部图片资源（需求 A10），
 * 地面/水面的纹理都在运行时用 canvas 画出来。
 */

function makeCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 2D canvas 上下文');
  return { canvas, ctx };
}

/** 地面：土绿底色 + 噪点 + 每格细线，给出距离与格子感的视觉锚点。 */
export function createGroundTexture(): THREE.CanvasTexture {
  const size = 256;
  const { canvas, ctx } = makeCanvas(size);
  ctx.fillStyle = '#4b6038';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 5200; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = Math.random() * 1.6 + 0.3;
    const v = Math.random();
    ctx.fillStyle =
      v < 0.5 ? `rgba(30,42,22,${0.25 + Math.random() * 0.3})` : `rgba(96,116,70,${0.15 + Math.random() * 0.25})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(20,26,14,0.35)';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(GRID_W, GRID_W);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** 水面：横向波纹，运行时滚动 offset 制造流动感。 */
export function createWaterTexture(): THREE.CanvasTexture {
  const size = 128;
  const { canvas, ctx } = makeCanvas(size);
  ctx.fillStyle = '#1d3f5e';
  ctx.fillRect(0, 0, size, size);
  for (let y = 0; y < size; y += 4) {
    const alpha = 0.12 + 0.12 * Math.sin(y * 0.5);
    ctx.strokeStyle = `rgba(120,190,235,${alpha})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = 0; x <= size; x += 4) {
      ctx.lineTo(x, y + Math.sin(x * 0.35) * 2.2);
    }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 砖墙：横向砖缝 + 色差，贴在每块砖盒的正面足够。 */
export function createBrickTexture(): THREE.CanvasTexture {
  const size = 64;
  const { canvas, ctx } = makeCanvas(size);
  ctx.fillStyle = '#8d4a35';
  ctx.fillRect(0, 0, size, size);
  const rowH = 8;
  for (let row = 0; row < size / rowH; row++) {
    const offset = row % 2 === 0 ? 0 : 16;
    for (let x = -16; x < size; x += 32) {
      ctx.fillStyle = `hsl(${12 + Math.random() * 8}, ${38 + Math.random() * 12}%, ${34 + Math.random() * 10}%)`;
      ctx.fillRect(x + offset + 1, row * rowH + 1, 30, rowH - 2);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** 钢块：金属拉丝 + 斜切高光。 */
export function createSteelTexture(): THREE.CanvasTexture {
  const size = 64;
  const { canvas, ctx } = makeCanvas(size);
  ctx.fillStyle = '#6b7278';
  ctx.fillRect(0, 0, size, size);
  for (let y = 0; y < size; y += 2) {
    ctx.fillStyle = `rgba(255,255,255,${0.02 + Math.random() * 0.05})`;
    ctx.fillRect(0, y, size, 1);
  }
  ctx.strokeStyle = 'rgba(20,24,28,0.65)';
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, size - 3, size - 3);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.strokeRect(5, 5, size - 10, size - 10);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface WorldScene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  ground: THREE.Mesh;
  resize: () => void;
}

const SKY = 0x3a4a36;
const SKY_TOP = 0x1b2a3d;
const GROUND_COLOR = 0x33402a;

export function createWorldScene(canvas: HTMLCanvasElement): WorldScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 60, 165);

  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 400);
  camera.position.set(BASE_CENTER.x, 12, BASE_CENTER.z + 14);
  camera.lookAt(BASE_CENTER.x, 0, BASE_CENTER.z);

  // 渐变天穹：程序化 shader，不依赖任何外部贴图
  const skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(300, 24, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(SKY_TOP) },
        bottom: { value: new THREE.Color(SKY) },
      },
      vertexShader: 'varying float vY; void main() { vY = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying float vY; void main() { float t = smoothstep(-0.02, 0.5, vY); gl_FragColor = vec4(mix(bottom, top, t), 1.0); }',
    }),
  );
  skyDome.frustumCulled = false;
  scene.add(skyDome);
  scene.background = new THREE.Color(SKY);

  const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x46412e, 1.05);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff1d6, 2.15);
  sun.position.set(WORLD_W * 0.35, 46, WORLD_H * 0.2);
  sun.target.position.set(BASE_CENTER.x, 0, BASE_CENTER.z - 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const half = 34;
  sun.shadow.camera.left = -half;
  sun.shadow.camera.right = half;
  sun.shadow.camera.top = half;
  sun.shadow.camera.bottom = -half;
  sun.shadow.camera.near = 5;
  sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);
  scene.add(sun.target);

  // 地面：贴图按格子重复，外圈再铺一层更大的暗色底盘避免看到“世界尽头”。
  const groundTex = createGroundTexture();
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD_W, WORLD_H),
    new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(WORLD_W / 2, 0, WORLD_H / 2);
  ground.receiveShadow = true;
  scene.add(ground);

  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD_W * 8, WORLD_H * 8),
    new THREE.MeshStandardMaterial({ color: GROUND_COLOR, roughness: 1 }),
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(WORLD_W / 2, -0.05, WORLD_H / 2);
  apron.receiveShadow = true;
  scene.add(apron);

  // 场地边界：一圈低矮石台，明确“出界即撞墙”。
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0x3f4638, roughness: 0.95 });
  const edgeGeo = new THREE.BoxGeometry(TILE, 1.4, TILE);
  const edgeCount = GRID_W * 4;
  const edge = new THREE.InstancedMesh(edgeGeo, edgeMat, edgeCount);
  edge.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  const m = new THREE.Matrix4();
  let ei = 0;
  for (let i = 0; i < GRID_W; i++) {
    const x = (i + 0.5) * TILE;
    m.makeTranslation(x, 0.7, -TILE / 2);
    edge.setMatrixAt(ei++, m);
    m.makeTranslation(x, 0.7, WORLD_H + TILE / 2);
    edge.setMatrixAt(ei++, m);
    const z = (i + 0.5) * TILE;
    m.makeTranslation(-TILE / 2, 0.7, z);
    edge.setMatrixAt(ei++, m);
    m.makeTranslation(WORLD_W + TILE / 2, 0.7, z);
    edge.setMatrixAt(ei++, m);
  }
  edge.instanceMatrix.needsUpdate = true;
  edge.castShadow = true;
  edge.receiveShadow = true;
  scene.add(edge);

  const resize = (): void => {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);

  return { renderer, scene, camera, ground, resize };
}
