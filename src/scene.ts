// 3D 渲染层：只读游戏状态，不参与规则判定。
//
// 三个取舍及其理由：
//   1. 画布按 PIXEL_SCALE 缩小后再用 CSS 拉满 —— 这是「真像素风」唯一的低成本做法，
//      直接在低分辨率后备缓冲上渲染，边缘天然是硬方块，不需要后期处理。
//   2. 地板/墙/目标点用 InstancedMesh，箱子与玩家用独立 Mesh —— 前者数量多且不动，
//      后者要逐帧插值，分开才不会被 instanceMatrix 更新淹没。
//   3. 点击拾取把「墙」也放进射线列表 —— 否则穿过墙会选中它背后的地板，是错的操作。

import * as THREE from 'three';
import { DIRS, type Level, type Step } from './sokoban';
import { createTextures, type Textures } from './textures';

const CELL = 1;
const PIXEL_SCALE = 3;
export const MOVE_MS = 120;

// 比例：箱高 < 墙高 < 人高。墙比人矮是刻意的 —— Microban 大量 1 格宽走廊，
// 墙高 1 格时等距视角下走廊会被完全遮住，只剩一堵砖墙，看不清哪个格子能走。
export const WALL_HEIGHT = 0.86;
export const BOX_HEIGHT = 0.66;
const BOX_SIZE = 0.8;
const TILE_THICKNESS = 0.24;

interface Tween {
  mesh: THREE.Object3D;
  from: THREE.Vector3;
  to: THREE.Vector3;
  start: number;
  dur: number;
}

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;

  onCellClick: ((cell: number) => void) | null = null;

  private readonly textures: Textures;
  private readonly mats: Record<'floor' | 'wall' | 'wallTop' | 'crate' | 'goal' | 'cloth' | 'face', THREE.MeshStandardMaterial>;
  private levelGroup: THREE.Group | null = null;
  private level: Level | null = null;

  private floors: THREE.InstancedMesh | null = null;
  private walls: THREE.InstancedMesh | null = null;
  private goals: THREE.InstancedMesh | null = null;
  private gems: THREE.Mesh[] = [];
  private boxes: THREE.Mesh[] = [];
  private player: THREE.Group | null = null;

  private tweens: Tween[] = [];
  private clock = new THREE.Clock();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();

  // 轨道相机状态
  private az = Math.PI * 0.25;
  private el = 0.95;
  private radius = 20;
  private target = new THREE.Vector3(0, 0.2, 0);
  private readonly minRadius = 6;
  private maxRadius = 60;
  /** 棋盘包围球半径，用来在任意窗口比例下把整块棋盘塞进画面 */
  private boardRadius = 6;
  /** 用户手动缩放过就不再自动取景，否则每帧都会把镜头拉回去 */
  private userZoomed = false;

  // 指针手势
  private down: { x: number; y: number; t: number; moved: boolean } | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap; // 硬阴影，符合像素风
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 300);

    this.textures = createTextures();
    const std = (map: THREE.Texture, extra: THREE.MeshStandardMaterialParameters = {}) =>
      new THREE.MeshStandardMaterial({ map, roughness: 0.95, metalness: 0.0, ...extra });

    this.mats = {
      floor: std(this.textures.floor),
      wall: std(this.textures.wall),
      wallTop: std(this.textures.wallTop),
      crate: std(this.textures.crate),
      goal: std(this.textures.goal, { emissive: new THREE.Color(0x3a2606), emissiveIntensity: 0.6 }),
      cloth: std(this.textures.cloth),
      face: std(this.textures.face),
    };

    for (const m of Object.values(this.mats)) this.sharedMats.add(m);

    this.setupLights();
    this.bindPointer();
    this.resize();
  }

  private setupLights(): void {
    this.scene.background = new THREE.Color(0x14161c);
    const hemi = new THREE.HemisphereLight(0xbcdcf5, 0x3b352c, 2.0);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
    sun.position.set(9, 16, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 80;
    sun.shadow.bias = -0.0008;
    this.scene.add(sun);
    this.scene.add(sun.target);

    const fill = new THREE.DirectionalLight(0x6f8cc4, 0.7);
    fill.position.set(-8, 6, -6);
    this.scene.add(fill);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  }

  /** 关卡坐标 → 世界坐标（棋盘居中） */
  private cellToWorld(cell: number): THREE.Vector3 {
    const lv = this.level!;
    const col = cell % lv.width;
    const row = (cell / lv.width) | 0;
    return new THREE.Vector3((col - (lv.width - 1) / 2) * CELL, 0, (row - (lv.height - 1) / 2) * CELL);
  }


  buildLevel(level: Level, boxes: number[], playerCell: number): void {
    this.clearLevel();
    this.level = level;
    const group = new THREE.Group();
    this.levelGroup = group;
    this.scene.add(group);

    // 地板与目标点：只画内部区域，墙外是虚空
    const floorCells: number[] = [];
    const goalCells: number[] = [];
    for (let i = 0; i < level.inside.length; i++) {
      if (!level.inside[i] || level.wall[i]) continue;
      (level.goal[i] ? goalCells : floorCells).push(i);
    }

    const tileGeo = new THREE.BoxGeometry(CELL, TILE_THICKNESS, CELL);
    this.floors = this.makeInstanced(tileGeo, this.mats.floor, floorCells, 0);
    this.goals = this.makeInstanced(tileGeo, this.mats.goal, goalCells, 0);
    group.add(this.floors, this.goals);

    // 目标点上方飘一个宝石，箱子压上去就隐藏
    const gemGeo = new THREE.OctahedronGeometry(0.1);
    const gemMat = new THREE.MeshStandardMaterial({
      color: 0xffc247,
      emissive: 0xffa41f,
      emissiveIntensity: 0.9,
      roughness: 0.4,
    });
    for (const cell of goalCells) {
      const gem = new THREE.Mesh(gemGeo, gemMat);
      const p = this.cellToWorld(cell);
      gem.position.set(p.x, 0.3, p.z);
      gem.userData.cell = cell;
      group.add(gem);
      this.gems.push(gem);
    }

    // 墙：从「挨着内部区域」的那一圈起，向 8 邻域洪泛填满整块墙体。
    // 只画内圈会让墙变成一片薄鳍 —— 等距俯视下背后是空的，大关卡看着像废墟。
    const wallCells: number[] = [];
    const queued = new Uint8Array(level.wall.length);
    const stack: number[] = [];
    const pushWall = (idx: number) => {
      if (!level.wall[idx] || queued[idx]) return;
      queued[idx] = 1;
      stack.push(idx);
    };
    for (let i = 0; i < level.wall.length; i++) {
      if (!level.wall[i]) continue;
      const col = i % level.width;
      const row = (i / level.width) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nc = col + dx;
          const nr = row + dy;
          if (nc < 0 || nr < 0 || nc >= level.width || nr >= level.height) continue;
          if (level.inside[nr * level.width + nc]) pushWall(i);
        }
      }
    }
    while (stack.length > 0) {
      const idx = stack.pop()!;
      wallCells.push(idx);
      const col = idx % level.width;
      const row = (idx / level.width) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nc = col + dx;
          const nr = row + dy;
          if (nc < 0 || nr < 0 || nc >= level.width || nr >= level.height) continue;
          pushWall(nr * level.width + nc);
        }
      }
    }

    const wallGeo = new THREE.BoxGeometry(CELL, WALL_HEIGHT, CELL);
    this.walls = this.makeInstanced(wallGeo, this.mats.wall, wallCells, WALL_HEIGHT / 2);
    // 墙顶压一条深色石板：没有它，整片砖墙在等距视角下会糊成一坨
    const capGeo = new THREE.BoxGeometry(CELL, 0.1, CELL);
    const caps = this.makeInstanced(capGeo, this.mats.wallTop, wallCells, WALL_HEIGHT + 0.05);
    group.add(this.walls, caps);

    // 箱子
    const boxGeo = new THREE.BoxGeometry(BOX_SIZE, BOX_HEIGHT, BOX_SIZE);
    for (const cell of boxes) {
      const m = new THREE.Mesh(boxGeo, this.mats.crate.clone());
      const p = this.cellToWorld(cell);
      m.position.set(p.x, BOX_HEIGHT / 2, p.z);
      m.castShadow = true;
      m.receiveShadow = true;
      m.userData.cell = cell;
      group.add(m);
      this.boxes.push(m);
    }

    // 玩家
    this.player = this.buildPlayer();
    const pp = this.cellToWorld(playerCell);
    this.player.position.copy(pp);
    group.add(this.player);

    // 相机取景：棋盘包围球 + 当前视锥，保证 45° 等距下四条边都不出画
    const extent = Math.max(level.width, level.height);
    this.maxRadius = extent * 5 + 12;
    this.boardRadius = 0.5 * Math.hypot(level.width, level.height) + 0.8;
    this.target.set(0, 0.2, 0);
    this.userZoomed = false;
    this.radius = this.fitRadius();
    this.updateCamera();

    // 阴影相机范围跟着棋盘走
    const sun = this.scene.children.find((c) => c instanceof THREE.DirectionalLight && c.castShadow) as
      | THREE.DirectionalLight
      | undefined;
    if (sun) {
      const half = extent * 0.75 + 2;
      const cam = sun.shadow.camera;
      cam.left = -half;
      cam.right = half;
      cam.top = half;
      cam.bottom = -half;
      cam.updateProjectionMatrix();
      sun.position.set(extent * 0.7, extent * 1.1, extent * 0.55);
      sun.target.position.set(0, 0, 0);
      sun.target.updateMatrixWorld();
    }

    this.updateBoxTint();
  }

  private makeInstanced(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    cells: number[],
    yCenter: number,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(cells.length, 1));
    mesh.count = cells.length;
    mesh.receiveShadow = true;
    mesh.castShadow = yCenter > 0;
    const m = new THREE.Matrix4();
    cells.forEach((cell, i) => {
      const p = this.cellToWorld(cell);
      m.makeTranslation(p.x, yCenter, p.z);
      mesh.setMatrixAt(i, m);
    });
    mesh.userData.cells = cells;
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }

  private buildPlayer(): THREE.Group {
    const g = new THREE.Group();
    const clothMat = this.mats.cloth;
    const skin = new THREE.MeshStandardMaterial({ color: 0xe8bb8e, roughness: 0.9 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x3a2f26, roughness: 1 });
    const capMat = new THREE.MeshStandardMaterial({ color: 0xc4453c, roughness: 0.85 });

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.32, 0.3), clothMat);
    torso.position.y = 0.42;
    g.add(torso);

    // 头：+Z 面贴脸，其余面用肤色
    const faceMat = this.mats.face;
    const headMats = [skin, skin, skin, skin, faceMat, skin];
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.3, 0.3), headMats);
    head.position.y = 0.74;
    g.add(head);

    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.32), capMat);
    cap.position.y = 0.94;
    g.add(cap);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.04, 0.12), capMat);
    brim.position.set(0, 0.9, 0.19);
    g.add(brim);

    for (const sx of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.26, 0.12), clothMat);
      arm.position.set(sx * 0.25, 0.46, 0);
      g.add(arm);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.26, 0.14), dark);
      leg.position.set(sx * 0.1, 0.13, 0);
      g.add(leg);
    }

    g.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    const markerMat = new THREE.MeshBasicMaterial({ color: 0xdfeeff }); // 冷白，和目标点的琥珀色区分开
    const marker = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.3, 4), markerMat);
    marker.rotation.x = Math.PI;
    marker.position.y = 1.46;
    g.add(marker);
    g.userData.marker = marker;

    g.scale.setScalar(0.8);
    return g;
  }

  /** 玩家朝向按方向角插值，走动时不生硬转头 */
  private faceDir(mesh: THREE.Object3D, dir: number, dt: number): void {
    const [dx, dy] = DIRS[dir]!;
    const want = Math.atan2(dx, dy);
    let diff = want - mesh.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    mesh.rotation.y += diff * Math.min(1, dt * 18);
  }

  applyStep(step: Step, state: { player: number; boxes: number[] }): void {
    const player = this.player;
    if (!player) return;
    const now = performance.now();
    const pTo = this.cellToWorld(step.to);
    const p = player.position;
    this.tweens.push({ mesh: player, from: new THREE.Vector3(p.x, 0, p.z), to: pTo, start: now, dur: MOVE_MS });
    // 高度用弹跳表现，不参与水平插值
    player.userData.hop = { start: now, dur: MOVE_MS };
    player.userData.dir = step.dir;

    if (step.boxFrom >= 0) {
      const i = state.boxes.indexOf(step.boxTo);
      const mesh = this.boxes[i];
      if (mesh) {
        const from = this.cellToWorld(step.boxFrom);
        const to = this.cellToWorld(step.boxTo);
        from.y = BOX_HEIGHT / 2;
        to.y = BOX_HEIGHT / 2;
        this.tweens.push({ mesh, from, to, start: now, dur: MOVE_MS });
        mesh.userData.cell = step.boxTo;
      }
    }
    this.updateBoxTint();
  }

  undoStep(step: Step, state: { player: number; boxes: number[] }): void {
    this.tweens.length = 0;
    if (this.player) {
      const p = this.cellToWorld(step.from);
      this.player.position.set(p.x, 0, p.z);
    }
    if (step.boxFrom >= 0) {
      const i = state.boxes.indexOf(step.boxFrom);
      const mesh = this.boxes[i];
      if (mesh) {
        const p = this.cellToWorld(step.boxFrom);
        mesh.position.set(p.x, BOX_HEIGHT / 2, p.z);
        mesh.userData.cell = step.boxFrom;
      }
    }
    this.updateBoxTint();
  }

  /** 关卡重置 / 撤销到底：位置直接对齐状态，不播动画 */
  syncAll(state: { player: number; boxes: number[] }): void {
    this.tweens.length = 0;
    if (this.player) {
      const p = this.cellToWorld(state.player);
      this.player.position.set(p.x, 0, p.z);
    }
    state.boxes.forEach((cell, i) => {
      const mesh = this.boxes[i];
      if (!mesh) return;
      const p = this.cellToWorld(cell);
      mesh.position.set(p.x, BOX_HEIGHT / 2, p.z);
      mesh.userData.cell = cell;
    });
    this.updateBoxTint();
    this.syncGems();
  }

  private updateBoxTint(): void {
    for (const m of this.boxes) {
      const onGoal = this.level ? this.level.goal[m.userData.cell as number] === 1 : false;
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.emissive.setHex(onGoal ? 0x126b2c : 0x000000);
      mat.emissiveIntensity = onGoal ? 0.32 : 0;
    }
    this.syncGems();
  }

  private syncGems(): void {
    if (!this.level) return;
    for (const gem of this.gems) {
      const cell = gem.userData.cell as number;
      const covered = this.boxes.some((b) => (b.userData.cell as number) === cell);
      gem.visible = !covered;
    }
  }

  private readonly sharedMats = new Set<THREE.Material>();

  private clearLevel(): void {
    if (this.levelGroup) {
      this.scene.remove(this.levelGroup);
      this.levelGroup.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) if (!this.sharedMats.has(m)) m.dispose();
      });
    }
    this.levelGroup = null;
    this.floors = this.walls = this.goals = null;
    this.gems = [];
    this.boxes = [];
    this.player = null;
    this.tweens = [];
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(Math.max(1, Math.round(w / PIXEL_SCALE)), Math.max(1, Math.round(h / PIXEL_SCALE)), false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (!this.userZoomed) this.radius = this.fitRadius();
    this.updateCamera();
  }

  /** 让包围球刚好落进视锥所需的相机距离 */
  private fitRadius(): number {
    const halfV = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const halfH = Math.atan(Math.tan(halfV) * this.camera.aspect);
    const d = this.boardRadius / Math.sin(Math.min(halfV, halfH));
    return THREE.MathUtils.clamp(d * 1.04, 8, this.maxRadius);
  }

  private updateCamera(): void {
    const ce = Math.cos(this.el);
    const p = new THREE.Vector3(
      this.target.x + this.radius * ce * Math.sin(this.az),
      this.target.y + this.radius * Math.sin(this.el),
      this.target.z + this.radius * ce * Math.cos(this.az),
    );
    this.camera.position.copy(p);
    this.camera.lookAt(this.target);
  }

  private bindPointer(): void {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());

    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      this.down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
    });

    c.addEventListener('pointermove', (e) => {
      const d = this.down;
      if (!d || e.buttons === 0) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) > 5) d.moved = true;
      if (!d.moved) return;
      this.az -= dx * 0.006;
      this.el = THREE.MathUtils.clamp(this.el + dy * 0.006, 0.32, 1.45);
      d.x = e.clientX;
      d.y = e.clientY;
      this.updateCamera();
    });

    c.addEventListener('pointerup', (e) => {
      const d = this.down;
      this.down = null;
      if (!d) return;
      const quick = performance.now() - d.t < 500;
      if (!d.moved && quick) {
        const cell = this.pickCell(e.clientX, e.clientY);
        if (cell !== null) this.onCellClick?.(cell);
      }
    });

    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const factor = Math.exp(e.deltaY * 0.0012);
        this.userZoomed = true;
        this.radius = THREE.MathUtils.clamp(this.radius * factor, this.minRadius, this.maxRadius);
        this.updateCamera();
      },
      { passive: false },
    );
  }

  private pickCell(clientX: number, clientY: number): number | null {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const targets: THREE.Object3D[] = [];
    for (const m of [this.walls, this.floors, this.goals]) {
      if (m && m.count > 0) targets.push(m);
    }
    targets.push(...this.boxes);

    const hits = this.raycaster.intersectObjects(targets, false);
    const hit = hits[0];
    if (!hit) return null;
    const obj = hit.object;

    if (this.level) {
      if (obj === this.walls) return null; // 点墙不做任何事，也不穿透
      if (obj.userData.cell !== undefined) return obj.userData.cell as number;
      if (obj instanceof THREE.InstancedMesh && hit.instanceId !== undefined) {
        const cells = obj.userData.cells as number[] | undefined;
        return cells?.[hit.instanceId] ?? null;
      }
    }
    return null;
  }

  update(): void {
    const now = performance.now();
    const dt = Math.min(this.clock.getDelta(), 0.05);

    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const t = this.tweens[i]!;
      const k = Math.min(1, (now - t.start) / t.dur);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; // easeInOutQuad
      t.mesh.position.lerpVectors(t.from, t.to, e);
      if (k >= 1) this.tweens.splice(i, 1);
    }

    const p = this.player;
    if (p) {
      const hop = p.userData.hop as { start: number; dur: number } | undefined;
      if (hop) {
        const k = Math.min(1, (now - hop.start) / hop.dur);
        p.position.y = Math.sin(Math.PI * k) * 0.07;
        if (k >= 1) {
          p.position.y = 0;
          delete p.userData.hop;
        }
      }
      if (typeof p.userData.dir === 'number') this.faceDir(p, p.userData.dir as number, dt);
      const marker = p.userData.marker as THREE.Mesh | undefined;
      if (marker) {
        marker.position.y = 1.46 + Math.sin(now * 0.004) * 0.04;
        marker.rotation.y += dt * 2.2;
      }
    }

    for (const gem of this.gems) {
      if (!gem.visible) continue;
      gem.rotation.y += dt * 1.8;
      gem.position.y = 0.3 + Math.sin(now * 0.003 + (gem.userData.cell as number)) * 0.045;
    }

    this.renderer.render(this.scene, this.camera);
  }
}
