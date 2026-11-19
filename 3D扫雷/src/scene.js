/**
 * 舞台：渲染器、相机轨道、灯光、地台。
 *
 * 相机用「球坐标 + 阻尼」而不是现成 OrbitControls，原因只有两条：
 *  1) 要区分「拖拽旋转」与「点击挖开」——阈值判定写在 input 层，相机只接收增量；
 *  2) 菜单态要自动环绕，开局要平滑落到固定机位，自己写 30 行比引控件更可控。
 */
import * as THREE from '../vendor/three.module.js';
import { BOARD, PALETTE } from './config.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const damp = (cur, goal, lambda, dt) => cur + (goal - cur) * (1 - Math.exp(-lambda * dt));

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(PALETTE.bg);
    this.scene.fog = new THREE.Fog(PALETTE.fog, 42, 120);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
    this.target = new THREE.Vector3(0, 0.2, 0);

    // 视角状态：当前值与目标值分开，帧内做阻尼
    this.rig = {
      az: Math.PI * 0.5 - 0.42,
      polar: 0.68,
      dist: 24,
      goalAz: Math.PI * 0.5 - 0.42,
      goalPolar: 0.68,
      goalDist: 24,
    };
    this.zoom = 1;
    this.baseDist = 16;
    this.autoRotate = true;
    this.menuFocus = false;
    this.shake = 0;
    this.shakeSeed = Math.random() * 1000;

    this.cols = 9;
    this.rows = 9;

    this.#buildLights();
    this.#buildGround();

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  #buildLights() {
    const hemi = new THREE.HemisphereLight(0x9c8264, 0x120e0a, 1.05);
    this.scene.add(hemi);

    // 主光：暖色，从右上打，负责方块立体感与投影
    const key = new THREE.DirectionalLight(0xffd9a6, 3.1);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.03;
    key.shadow.camera.near = 6;
    key.shadow.camera.far = 110;
    this.key = key;
    this.scene.add(key);
    this.scene.add(key.target);

    // 补光：冷色，压暗部，避免纯黑
    const fill = new THREE.DirectionalLight(0x6f86a8, 0.6);
    fill.position.set(-24, 14, -18);
    this.scene.add(fill);

    // 坑底反光：让缝隙里的地台不至于死黑
    const bounce = new THREE.DirectionalLight(0xff9a5a, 0.22);
    bounce.position.set(6, -12, 10);
    this.scene.add(bounce);
  }

  #buildGround() {
    this.plinthMat = new THREE.MeshStandardMaterial({
      color: PALETTE.plinth,
      roughness: 0.95,
      metalness: 0.04,
    });

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 600),
      new THREE.MeshStandardMaterial({ color: PALETTE.ground, roughness: 1 }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.plinth = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.plinthMat);
    this.plinth.castShadow = true;
    this.plinth.receiveShadow = true;
    this.plinth.position.y = -BOARD.baseThickness / 2;
    this.scene.add(this.plinth);
  }

  /** 换难度时重建地台、阴影范围和取景距离。 */
  setBoard(cols, rows) {
    this.cols = cols;
    this.rows = rows;

    const w = cols * BOARD.pitch + BOARD.baseMargin * 2;
    const d = rows * BOARD.pitch + BOARD.baseMargin * 2;

    this.plinth.geometry.dispose();
    this.plinth.geometry = new THREE.BoxGeometry(w, BOARD.baseThickness, d);
    this.plinth.position.y = -BOARD.baseThickness / 2;
    this.ground.position.y = -BOARD.baseThickness - 0.02;

    // 阴影相机按棋盘外扩，保证 30×16 也全部落在阴影贴图里
    const key = this.key;
    key.position.set(w * 0.42 + 12, Math.max(w, d) * 0.95 + 6, d * 0.32 + 10);
    key.target.position.set(0, 0, 0);
    key.shadow.camera.left = -w / 2 - 4;
    key.shadow.camera.right = w / 2 + 4;
    key.shadow.camera.top = d / 2 + 4;
    key.shadow.camera.bottom = -d / 2 - 4;
    key.shadow.camera.updateProjectionMatrix();

    this.#fit();
  }

  #fit() {
    // 按包围球取景：相机可以 360° 环绕，只按长宽取景会在斜视角把角切掉
    const w = this.cols * BOARD.pitch + 2.2;
    const d = this.rows * BOARD.pitch + 2.2;
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const radius = Math.hypot(w / 2, d / 2);
    this.baseDist = (radius / Math.sin(Math.min(vfov, hfov) / 2)) * (this.menuFocus ? 1.12 : 0.93);
    this.rig.goalDist = this.baseDist * this.zoom;

    // 菜单态：视点左移 18% 视野宽，棋盘落在右半屏，左侧留给面板
    const viewW = 2 * this.baseDist * Math.tan(hfov / 2);
    this.target.x = this.menuFocus && window.innerWidth >= 1000 ? -viewW * 0.14 : 0;
  }

  /** 菜单态构图：棋盘偏右；开局后回到正中。 */
  setMenuFocus(on) {
    this.menuFocus = !!on;
    this.#fit();
  }

  get fitDistance() {
    return this.baseDist;
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.#fit();
  }

  /** 拖拽旋转：dx/dy 是像素增量。 */
  orbit(dx, dy) {
    this.rig.goalAz -= dx * 0.0062;
    this.rig.goalPolar = clamp(this.rig.goalPolar - dy * 0.0045, 0.44, 1.16);
  }

  /** 滚轮缩放：delta 为正表示拉远。 */
  zoomBy(delta) {
    this.zoom = clamp(this.zoom * Math.exp(delta * 0.0011), 0.5, 2.3);
    this.rig.goalDist = this.baseDist * this.zoom;
  }

  /** 重置到默认机位（菜单里的「视角复位」用）。 */
  resetView() {
    this.zoom = 1;
    this.rig.goalAz = Math.PI * 0.5 - 0.42;
    this.rig.goalPolar = 0.68;
    this.rig.goalDist = this.baseDist;
  }

  /** 列表页/菜单自动环绕。 */
  setAutoRotate(on) {
    this.autoRotate = on;
  }

  pulse(amount = 1) {
    this.shake = Math.max(this.shake, amount);
  }

  /** 屏幕坐标 → 归一化设备坐标。 */
  toNdc(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * 2 - 1,
      y: -((clientY - rect.top) / rect.height) * 2 + 1,
    };
  }

  update(dt) {
    if (this.autoRotate) this.rig.goalAz += dt * 0.16;

    const r = this.rig;
    r.az = damp(r.az, r.goalAz, 9, dt);
    r.polar = damp(r.polar, r.goalPolar, 9, dt);
    r.dist = damp(r.dist, r.goalDist, 7, dt);

    const sinP = Math.sin(r.polar);
    this.camera.position.set(
      this.target.x + r.dist * sinP * Math.cos(r.az),
      this.target.y + r.dist * Math.cos(r.polar),
      this.target.z + r.dist * sinP * Math.sin(r.az),
    );

    if (this.shake > 0.001) {
      const t = performance.now() * 0.05 + this.shakeSeed;
      const amp = this.shake * 0.22;
      this.camera.position.x += Math.sin(t * 1.7) * amp;
      this.camera.position.y += Math.sin(t * 2.3 + 1.1) * amp;
      this.camera.position.z += Math.sin(t * 1.3 + 2.2) * amp;
      this.shake *= Math.exp(-6 * dt);
    }
    this.camera.lookAt(this.target);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
