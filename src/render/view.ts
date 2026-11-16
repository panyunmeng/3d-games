import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { SimEvent, Simulation } from '../game/simulation';
import type { LevelDef, TowerDef } from '../data/types';
import { buildBase, buildEnemy, buildProps, buildTower, ghostGlass, metal } from './models';
import { makeGroundTexture, makePadTexture, makePathTexture } from './textures';
import { Effects } from './effects';
import type { Vec2 } from '../core/math';
import { clamp } from '../core/math';
import { makeRng } from '../core/rng';
import { PathTrack } from '../game/path';

export type Quality = 'low' | 'medium' | 'high';

interface EnemyView {
  group: THREE.Group;
  marker: THREE.Mesh;
  barHeight: number;
  baseScale: number;
  rotors: THREE.Object3D[];
  shield: THREE.Mesh | null;
  bar: THREE.Group;
  barFill: THREE.Mesh;
  barFillMat: THREE.MeshBasicMaterial;
  shieldBar: THREE.Mesh;
  shieldBarMat: THREE.MeshBasicMaterial;
  hpBg: THREE.Mesh;
  lastHp: number;
  bornAt: number;
  prevX: number;
  prevZ: number;
  angle: number;
}

interface TowerView {
  group: THREE.Group;
  head: THREE.Object3D;
  spinner: THREE.Object3D | null;
  level: number;
  angle: number;
}

const ribbon = (points: Vec2[], width: number, offset: number, y: number): THREE.BufferGeometry => {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let cum = 0;

  const normals: { x: number; z: number }[] = [];
  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)]!;
    const next = points[Math.min(points.length - 1, i + 1)]!;
    const dx = next.x - prev.x;
    const dz = next.z - prev.z;
    const len = Math.hypot(dx, dz) || 1;
    normals.push({ x: -dz / len, z: dx / len });
  }

  for (let i = 0; i < points.length; i++) {
    if (i > 0) {
      const a = points[i - 1]!;
      const b = points[i]!;
      cum += Math.hypot(b.x - a.x, b.z - a.z);
    }
    const p = points[i]!;
    const n = normals[i]!;
    const half = width / 2;
    const ox = n.x * offset;
    const oz = n.z * offset;
    positions.push(p.x + n.x * half + ox, y, p.z + n.z * half + oz);
    positions.push(p.x - n.x * half + ox, y, p.z - n.z * half + oz);
    const v = cum / 4;
    uvs.push(1, v, 0, v);
    if (i > 0) {
      const b = i * 2;
      indices.push(b - 2, b, b - 1, b - 1, b, b + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
};

export class GameView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly effects: Effects;

  private canvas: HTMLCanvasElement;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private quality: Quality = 'high';

  private levelGroup = new THREE.Group();
  private padMeshes: THREE.Mesh[] = [];
  private padPositions: Vec2[] = [];

  private enemyViews = new Map<number, EnemyView>();
  private enemyMarkers = new Map<number, THREE.Mesh>();
  private towerViews = new Map<number, TowerView>();
  private enemyGroup = new THREE.Group();
  private towerGroup = new THREE.Group();

  private rangeRing: THREE.Mesh;
  private selectRing: THREE.Mesh;
  private baseVisual: ReturnType<typeof buildBase> | null = null;

  private cameraTarget = new THREE.Vector3(0, 0, 0);
  private camDist = 46;
  private camPitch = THREE.MathUtils.degToRad(54);
  private keys = new Set<string>();
  private dragging = false;
  private dragButton = -1;
  private lastPointer = { x: 0, y: 0 };
  private moved = 0;
  private pointer = { x: 0, y: 0 };
  private worldPoint = new THREE.Vector3();
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  time = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.22;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05070c);
    this.scene.fog = new THREE.FogExp2(0x05070c, 0.011);

    this.camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.5, 200);
    this.camera.position.set(0, 30, 40);

    this.effects = new Effects(this.scene);

    this.scene.add(this.levelGroup);
    this.scene.add(this.enemyGroup);
    this.scene.add(this.towerGroup);

    const hemi = new THREE.HemisphereLight(0xb2d0ff, 0x16202c, 1.45);
    this.scene.add(hemi);

    const dir = new THREE.DirectionalLight(0xe4f0ff, 3.1);
    dir.position.set(18, 32, 14);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    const s = 34;
    dir.shadow.camera.left = -s;
    dir.shadow.camera.right = s;
    dir.shadow.camera.top = s;
    dir.shadow.camera.bottom = -s;
    dir.shadow.camera.far = 90;
    dir.shadow.bias = -0.0006;
    this.scene.add(dir);
    this.dirLight = dir;

    const rim = new THREE.DirectionalLight(0x5a8cff, 0.7);
    rim.position.set(-20, 14, -18);
    this.scene.add(rim);

    this.rangeRing = new THREE.Mesh(
      new THREE.RingGeometry(0.985, 1, 64),
      new THREE.MeshBasicMaterial({
        color: 0x36d2ff,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.rangeRing.rotation.x = -Math.PI / 2;
    this.rangeRing.visible = false;
    this.scene.add(this.rangeRing);

    this.selectRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.35, 0.05, 6, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.selectRing.rotation.x = -Math.PI / 2;
    this.selectRing.visible = false;
    this.scene.add(this.selectRing);

    this.bindEvents();
    this.setupComposer();
    this.resize();
  }

  private dirLight!: THREE.DirectionalLight;

  setQuality(q: Quality): void {
    this.quality = q;
    const ratio = q === 'low' ? 1 : q === 'medium' ? Math.min(window.devicePixelRatio, 1.5) : Math.min(window.devicePixelRatio, 2);
    this.renderer.setPixelRatio(ratio);
    this.renderer.shadowMap.enabled = q !== 'low';
    if (this.dirLight) {
      this.dirLight.castShadow = q !== 'low';
      this.dirLight.shadow.mapSize.set(q === 'high' ? 2048 : 1024, q === 'high' ? 2048 : 1024);
      this.dirLight.shadow.map?.dispose();
      this.dirLight.shadow.map = null;
    }
    if (this.bloom) this.bloom.enabled = q !== 'low';
    if (q === 'low') {
      this.composer = null;
    } else {
      this.setupComposer();
    }
    this.resize();
  }

  private setupComposer(): void {
    if (this.quality === 'low') {
      this.composer = null;
      return;
    }
    const composer = new EffectComposer(this.renderer);
    composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      this.quality === 'high' ? 0.62 : 0.4,
      0.55,
      0.72,
    );
    composer.addPass(bloom);
    this.composer = composer;
    this.bloom = bloom;
    this.resize();
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer?.setSize(w, h);
    if (this.bloom) this.bloom.setSize(w, h);
  }

  // ---------- 关卡静态场景 ----------

  loadLevel(level: LevelDef): void {
    this.clearLevel();
    this.enemyViews.clear();
    this.towerViews.clear();
    this.enemyGroup.clear();
    this.towerGroup.clear();
    this.effects.clear();

    const theme = level.theme;
    this.scene.background = new THREE.Color(theme.sky);
    this.scene.fog = new THREE.FogExp2(theme.fog, 0.012);

    const groundTex = makeGroundTexture(theme.accent);
    groundTex.repeat.set(16, 13);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(150, 120),
      new THREE.MeshStandardMaterial({ map: groundTex, color: 0xffffff, metalness: 0.35, roughness: 0.82 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.position.y = -0.02;
    this.levelGroup.add(ground);

    // 外围深渊
    const abyss = new THREE.Mesh(
      new THREE.PlaneGeometry(420, 320),
      new THREE.MeshStandardMaterial({ color: theme.groundEdge, metalness: 0.2, roughness: 1 }),
    );
    abyss.rotation.x = -Math.PI / 2;
    abyss.position.y = -0.35;
    this.levelGroup.add(abyss);

    // 行进带
    const pathTex = makePathTexture(theme.accent);
    const pathMesh = new THREE.Mesh(
      ribbon(level.waypoints, 3.6, 0, 0.02),
      new THREE.MeshStandardMaterial({
        map: pathTex,
        color: 0xffffff,
        metalness: 0.35,
        roughness: 0.62,
        emissive: new THREE.Color(theme.accent),
        emissiveMap: pathTex,
        emissiveIntensity: 0.14,
      }),
    );
    pathMesh.receiveShadow = true;
    this.levelGroup.add(pathMesh);

    const edgeMat = new THREE.MeshBasicMaterial({ color: theme.accent, transparent: true, opacity: 0.65 });
    for (const offset of [1.8, -1.8]) {
      const edge = new THREE.Mesh(new THREE.BufferGeometry(), edgeMat);
      edge.geometry.dispose();
      edge.geometry = ribbon(level.waypoints, 0.1, offset, 0.09);
      this.levelGroup.add(edge);
    }

    // 建造点
    const padTex = makePadTexture(theme.accent);
    this.padMeshes = [];
    this.padPositions = level.pads.map((p) => ({ x: p.x, z: p.z }));
    level.pads.forEach((pad, i) => {
      const g = new THREE.Group();
      const baseMesh = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.4, 0.2, 6), metal(0x1c2530, 0.6));
      baseMesh.position.y = 0.08;
      baseMesh.receiveShadow = true;
      g.add(baseMesh);

      const decal = new THREE.Mesh(
        new THREE.PlaneGeometry(4.6, 4.6),
        new THREE.MeshBasicMaterial({
          map: padTex,
          transparent: true,
          opacity: 0.95,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          color: new THREE.Color(theme.accent),
        }),
      );
      decal.rotation.x = -Math.PI / 2;
      decal.position.y = 0.23;
      decal.userData.padIndex = i;
      g.add(decal);
      this.padMeshes.push(decal);

      g.position.set(pad.x, 0, pad.z);
      this.levelGroup.add(g);
    });

    // 基地与出生点
    const last = level.waypoints[level.waypoints.length - 1]!;
    const first = level.waypoints[0]!;
    this.baseVisual = buildBase(theme.accent);
    this.baseVisual.group.position.set(last.x, 0, last.z);
    this.levelGroup.add(this.baseVisual.group);

    const portal = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.0, 0.14, 8, 28),
      new THREE.MeshStandardMaterial({ color: 0x05070a, emissive: 0xff3355, emissiveIntensity: 2.4, metalness: 0.4, roughness: 0.4 }),
    );
    ring.position.y = 2.1;
    portal.add(ring);
    const portalGlass = new THREE.Mesh(new THREE.CircleGeometry(1.95, 28), ghostGlass(0xff3355, 0.13));
    portalGlass.position.y = 2.1;
    portal.add(portalGlass);
    portal.position.set(first.x + 1, 0, first.z);
    portal.rotation.y = Math.atan2(first.x - last.x, first.z - last.z) + Math.PI / 2;
    this.levelGroup.add(portal);

    const rng = makeRng(level.index * 9137 + 11);
    const track = new PathTrack(level.waypoints);
    this.levelGroup.add(
      buildProps(
        theme.accent,
        () => rng.next(),
        (x, z) =>
          track.nearest(x, z).dist < 3.8 || level.pads.some((pad) => Math.hypot(pad.x - x, pad.z - z) < 2.8),
      ),
    );

    // 边界护栏
    const railGlow = new THREE.MeshBasicMaterial({ color: theme.accent, transparent: true, opacity: 0.45 });
    const corners: [number, number][] = [
      [0, 23],
      [0, -23],
      [25, 0],
      [-25, 0],
    ];
    corners.forEach(([x, z], idx) => {
      const horizontal = idx < 2;
      const strip = new THREE.Mesh(new THREE.BoxGeometry(horizontal ? 52 : 0.1, 0.12, horizontal ? 0.1 : 32), railGlow);
      strip.position.set(x, 0.06, z);
      this.levelGroup.add(strip);
    });

    const xs = level.waypoints.map((p) => p.x);
    const zs = level.waypoints.map((p) => p.z);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanZ = Math.max(...zs) - Math.min(...zs);
    this.cameraTarget.set(cx, 0, cz);
    this.levelCenter = { x: cx, z: cz };
    this.camDist = clamp(Math.max(spanX, spanZ) * 1.2, 42, 70);
    this.levelDist = this.camDist;
    this.camera.position.set(cx, Math.sin(this.camPitch) * this.camDist, cz + Math.cos(this.camPitch) * this.camDist);
    this.updateCamera(1);
  }

  private clearLevel(): void {
    this.levelGroup.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          const mat = m as THREE.MeshStandardMaterial;
          mat.map?.dispose();
          mat.dispose();
        }
      }
    });
    this.levelGroup.clear();
  }

  // ---------- 跟随模拟 ----------

  sync(sim: Simulation, dt: number): void {
    this.time += dt;

    // 塔
    const alive = new Set<number>();
    for (const t of sim.towers) {
      alive.add(t.id);
      let view = this.towerViews.get(t.id);
      if (!view) {
        const visual = buildTower(t.def as TowerDef, t.level);
        visual.group.position.set(t.x, 0.2, t.z);
        this.towerGroup.add(visual.group);
        view = {
          group: visual.group,
          head: visual.head,
          spinner: visual.spinner,
          level: t.level,
          angle: t.angle,
        };
        this.towerViews.set(t.id, view);
      } else if (view.level !== t.level) {
        this.towerGroup.remove(view.group);
        const visual = buildTower(t.def as TowerDef, t.level);
        visual.group.position.set(t.x, 0.2, t.z);
        this.towerGroup.add(visual.group);
        view.group = visual.group;
        view.head = visual.head;
        view.spinner = visual.spinner;
        view.level = t.level;
      }

      view.angle = view.angle + Math.atan2(Math.sin(t.angle - view.angle), Math.cos(t.angle - view.angle)) * Math.min(1, dt * 14);
      view.head.rotation.y = view.angle;
      view.head.position.z = -t.recoil * 0.14;
      if (view.spinner && t.def.id === 'gatling') view.spinner.rotation.z += dt * (8 + t.recoil * 40);
      if (view.spinner && t.def.id === 'tesla') {
        view.spinner.rotation.y += dt * 1.6;
        view.spinner.rotation.x = Math.sin(this.time * 2) * 0.2;
      }
    }
    for (const [id, view] of this.towerViews) {
      if (!alive.has(id)) {
        this.towerGroup.remove(view.group);
        this.towerViews.delete(id);
      }
    }

    // 敌人
    const enemyAlive = new Set<number>();
    for (const e of sim.enemies) {
      enemyAlive.add(e.id);
      let view = this.enemyViews.get(e.id);
      if (!view) {
        const visual = buildEnemy(e.def);
        visual.group.position.set(e.x, visual.hover, e.z);
        this.enemyGroup.add(visual.group);
        view = this.makeEnemyView(visual, e.hp, e.maxShield, e.def.accent, e.def.scale);
        this.enemyViews.set(e.id, view);
        this.enemyGroup.add(view.marker);
        this.enemyGroup.add(view.bar);
        this.enemyMarkers.set(e.id, view.marker);
      }
      const v = view;
      const tangent = sim.path.sample(e.dist);
      const targetAngle = Math.atan2(tangent.tx, tangent.tz);
      if (Math.abs(targetAngle - v.angle) > 0.001) {
        v.angle += Math.atan2(Math.sin(targetAngle - v.angle), Math.cos(targetAngle - v.angle)) * Math.min(1, dt * 10);
      }
      const bob = e.def.flying ? Math.sin(this.time * 3 + e.id) * 0.18 : Math.abs(Math.sin(this.time * 6 + e.id)) * 0.06;
      v.group.position.set(e.x, (e.def.flying ? 2.3 : 0) + bob, e.z);
      v.group.rotation.y = v.angle;
      v.marker.visible = true;
      v.marker.position.set(e.x, 0.06, e.z);
      (v.marker.material as THREE.MeshBasicMaterial).opacity = e.def.flying ? 0.32 : 0.5;
      v.bar.position.set(e.x, (e.def.flying ? 2.3 : 0) + v.barHeight, e.z);

      const appear = Math.min(1, (this.time - v.bornAt) / 0.22);
      v.group.scale.setScalar(v.baseScale * (0.6 + appear * 0.4));

      for (const r of v.rotors) r.rotation.y += dt * 40;

      if (v.shield) {
        const ratio = e.maxShield > 0 ? e.shield / e.maxShield : 0;
        v.shield.visible = ratio > 0.02;
        const mat = v.shield.material as THREE.MeshStandardMaterial;
        mat.opacity = 0.08 + ratio * 0.2;
      }

      this.updateBar(v, e);
    }
    for (const [id, view] of this.enemyViews) {
      if (!enemyAlive.has(id)) {
        this.enemyGroup.remove(view.group);
        this.enemyGroup.remove(view.marker);
        this.enemyGroup.remove(view.bar);
        view.marker.geometry.dispose();
        (view.marker.material as THREE.Material).dispose();
        view.barFill.geometry.dispose();
        view.barFillMat.dispose();
        view.shieldBar.geometry.dispose();
        view.shieldBarMat.dispose();
        view.hpBg.geometry.dispose();
        (view.hpBg.material as THREE.Material).dispose();
        this.enemyMarkers.delete(id);
        this.disposeObject(view.group);
        this.enemyViews.delete(id);
      }
    }

    // 基地动画
    if (this.baseVisual) {
      this.baseVisual.rings.forEach((r, i) => {
        r.rotation.y += dt * (0.3 + i * 0.2);
        r.rotation.z = Math.sin(this.time * 0.8 + i) * 0.12;
      });
      const pulse = 1 + Math.sin(this.time * 2.2) * 0.04;
      this.baseVisual.core.scale.setScalar(pulse);
    }

    // 选择环呼吸
    if (this.selectRing.visible) {
      const m = this.selectRing.material as THREE.MeshBasicMaterial;
      m.opacity = 0.55 + Math.sin(this.time * 4) * 0.25;
    }

    this.effects.update(dt);
    this.updateCamera(dt);
  }

  /** 菜单背景用：没有模拟对象时也让场景活着 */
  syncBackdrop(dt: number): void {
    this.time += dt;
    if (this.baseVisual) {
      this.baseVisual.rings.forEach((r, i) => {
        r.rotation.y += dt * (0.3 + i * 0.2);
        r.rotation.z = Math.sin(this.time * 0.8 + i) * 0.12;
      });
      this.baseVisual.core.scale.setScalar(1 + Math.sin(this.time * 2.2) * 0.04);
    }
    this.effects.update(dt);
    this.updateCamera(dt);
  }

  get pointerX(): number {
    return this.pointer.x;
  }

  get pointerY(): number {
    return this.pointer.y;
  }

  flashBase(color: number): void {
    if (!this.baseVisual) return;
    this.baseVisual.coreMat.emissive.setHex(color);
    window.setTimeout(() => {
      if (this.baseVisual) this.baseVisual.coreMat.emissive.setHex(this.levelAccent);
    }, 180);
  }

  private levelAccent = 0x36d2ff;

  setAccent(color: number): void {
    this.levelAccent = color;
  }

  private makeEnemyView(
    visual: ReturnType<typeof buildEnemy>,
    hp: number,
    maxShield: number,
    accent: number,
    scale: number,
  ): EnemyView {
    const marker = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.78, 18),
      new THREE.MeshBasicMaterial({
        color: accent,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    marker.rotation.x = -Math.PI / 2;
    marker.scale.setScalar(scale * 1.1);
    const bar = new THREE.Group();
    const bgMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false });
    const hpBg = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.13), bgMat);
    hpBg.renderOrder = 20;
    bar.add(hpBg);

    const fillMat = new THREE.MeshBasicMaterial({ color: 0x54ff8f, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false });
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(0.94, 0.08), fillMat);
    fill.position.z = 0.001;
    fill.renderOrder = 21;
    bar.add(fill);

    const shieldMat = new THREE.MeshBasicMaterial({ color: 0x6cf0ff, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false });
    const shieldBar = new THREE.Mesh(new THREE.PlaneGeometry(0.94, 0.05), shieldMat);
    shieldBar.position.set(0, 0.09, 0.001);
    shieldBar.renderOrder = 21;
    shieldBar.visible = maxShield > 0;
    bar.add(shieldBar);

    bar.visible = false;

    return {
      group: visual.group,
      marker,
      barHeight: visual.barY,
      baseScale: visual.baseScale,
      rotors: visual.rotors,
      shield: visual.shieldMesh,
      bar,
      barFill: fill,
      barFillMat: fillMat,
      shieldBar,
      shieldBarMat: shieldMat,
      hpBg,
      lastHp: hp,
      bornAt: this.time,
      prevX: 0,
      prevZ: 0,
      angle: 0,
    };
  }

  private updateBar(v: EnemyView, e: { hp: number; maxHp: number; shield: number; maxShield: number }): void {
    const hpRatio = clamp(e.hp / e.maxHp, 0, 1);
    const damaged = hpRatio < 0.999 || e.shield > 0;
    v.bar.visible = damaged;
    if (!damaged) return;

    v.barFill.scale.x = Math.max(0.001, hpRatio);
    v.barFill.position.x = -(1 - hpRatio) * 0.47;
    const color = hpRatio > 0.55 ? 0x54ff8f : hpRatio > 0.25 ? 0xffc247 : 0xff4d6d;
    v.barFillMat.color.setHex(color);

    if (e.maxShield > 0) {
      const sRatio = clamp(e.shield / e.maxShield, 0, 1);
      v.shieldBar.visible = sRatio > 0.01;
      v.shieldBar.scale.x = Math.max(0.001, sRatio);
      v.shieldBar.position.x = -(1 - sRatio) * 0.47;
    }

    v.bar.quaternion.copy(this.camera.quaternion);
  }

  private disposeObject(obj: THREE.Object3D): void {
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) m.dispose();
      }
    });
  }

  // ---------- 事件 → 特效 ----------

  onSimEvent(e: SimEvent): void {
    switch (e.type) {
      case 'shot': {
        const from = new THREE.Vector3(e.x, e.style === 'beam' ? 1.1 : 1.3, e.z);
        const to = new THREE.Vector3(e.tx, e.style === 'beam' ? 1.1 : 0.9, e.tz);
        if (e.style === 'beam') this.effects.beam(from, to, e.color, 0.075 + e.level * 0.02);
        else this.effects.tracer(from, to, e.color);
        break;
      }
      case 'chain':
        this.effects.chain(e.points, e.color);
        break;
      case 'shell':
        this.effects.shell({ x: e.x, z: e.z }, { x: e.tx, z: e.tz }, e.duration, e.color);
        break;
      case 'explosion':
        this.effects.explosion(e.x, e.z, e.radius, e.color);
        break;
      case 'kill':
        this.effects.debris(e.x, e.z, 0xffc247, e.boss);
        break;
      case 'build':
        this.effects.ringPulse(e.x, e.z, 0x36d2ff, 2.2);
        break;
      case 'upgrade':
        this.effects.ringPulse(e.x, e.z, 0xffd166, 2.6);
        break;
      case 'sell':
        this.effects.ringPulse(e.x, e.z, 0xff6b6b, 1.8);
        break;
      case 'leak':
        this.effects.explosion(e.x, e.z, 2.2, 0xff3355);
        this.flashBase(0xff3355);
        break;
      default:
        break;
    }
  }

  // ---------- 相机与拾取 ----------

  private bindEvents(): void {
    window.addEventListener('resize', () => this.resize());

    window.addEventListener('keydown', (ev) => {
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      this.keys.add(ev.code);
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(ev.code)) {
        ev.preventDefault();
      }
    });
    window.addEventListener('keyup', (ev) => this.keys.delete(ev.code));
    window.addEventListener('blur', () => this.keys.clear());

    this.canvas.addEventListener('pointerdown', (ev) => {
      this.pointer = { x: ev.clientX, y: ev.clientY };
      this.lastPointer = { x: ev.clientX, y: ev.clientY };
      this.moved = 0;
      this.dragging = true;
      this.dragButton = ev.button;
    });

    this.canvas.addEventListener('pointermove', (ev) => {
      this.pointer = { x: ev.clientX, y: ev.clientY };
      if (!this.dragging) return;
      const dx = ev.clientX - this.lastPointer.x;
      const dy = ev.clientY - this.lastPointer.y;
      this.moved += Math.abs(dx) + Math.abs(dy);
      this.lastPointer = { x: ev.clientX, y: ev.clientY };
      if (this.dragButton === 2 || this.dragButton === 1 || this.moved > 8) {
        this.panBy(dx, dy);
      }
    });

    this.canvas.addEventListener('pointerup', () => {
      this.dragging = false;
      this.dragButton = -1;
    });

    this.canvas.addEventListener('pointerleave', () => {
      this.dragging = false;
    });

    this.canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

    this.canvas.addEventListener(
      'wheel',
      (ev) => {
        ev.preventDefault();
        this.zoomBy(ev.deltaY * 0.02);
      },
      { passive: false },
    );
  }

  get pointerMoved(): boolean {
    return this.moved > 8;
  }

  get draggingNow(): boolean {
    return this.dragging;
  }

  private zoomBy(delta: number): void {
    this.camDist = clamp(this.camDist + delta, 18, 80);
  }

  private panBy(dx: number, dy: number): void {
    const scale = this.camDist * 0.0016;
    this.cameraTarget.x -= dx * scale;
    this.cameraTarget.z -= dy * scale * 1.6;
    this.clampTarget();
  }

  private clampTarget(): void {
    this.cameraTarget.x = clamp(this.cameraTarget.x, -26, 26);
    this.cameraTarget.z = clamp(this.cameraTarget.z, -18, 18);
  }

  /** 把镜头拉回关卡中心并复位缩放 */
  resetCamera(): void {
    if (!this.levelCenter) return;
    this.cameraTarget.set(this.levelCenter.x, 0, this.levelCenter.z);
    this.camDist = this.levelDist;
  }

  private levelCenter: { x: number; z: number } | null = null;
  private levelDist = 52;

  updateCamera(dt: number): void {
    const speed = this.camDist * 0.55 * dt;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.cameraTarget.z -= speed;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.cameraTarget.z += speed;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.cameraTarget.x -= speed;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.cameraTarget.x += speed;
    this.clampTarget();

    const h = Math.sin(this.camPitch) * this.camDist;
    const d = Math.cos(this.camPitch) * this.camDist;
    const desired = new THREE.Vector3(this.cameraTarget.x, h, this.cameraTarget.z + d);
    const k = dt >= 0.28 ? 1 : 1 - Math.exp(-dt * 8);
    this.camera.position.lerp(desired, k);
    this.camera.lookAt(this.cameraTarget.x, 0.6, this.cameraTarget.z - 1.5);
  }

  /** 屏幕坐标投射到地面，返回世界坐标 */
  private pointerToGround(clientX: number, clientY: number): THREE.Vector3 | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.groundPlane, this.worldPoint);
    return hit ? this.worldPoint : null;
  }

  pickPad(clientX: number, clientY: number): number | null {
    const p = this.pointerToGround(clientX, clientY);
    if (!p) return null;
    let best = -1;
    let bestD = 2.9;
    this.padPositions.forEach((pad, i) => {
      const d = Math.hypot(pad.x - p.x, pad.z - p.z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best >= 0 ? best : null;
  }

  pickTower(clientX: number, clientY: number, sim: Simulation): number | null {
    const p = this.pointerToGround(clientX, clientY);
    if (!p) return null;
    let best: number | null = null;
    let bestD = 1.9;
    for (const t of sim.towers) {
      const d = Math.hypot(t.x - p.x, t.z - p.z);
      if (d < bestD) {
        bestD = d;
        best = t.id;
      }
    }
    return best;
  }

  /** 高亮：悬停的建造点 + 选中的塔/点，同时画射程环 */
  updateHighlight(opts: {
    hoverPad: number | null;
    hoverRange: number;
    hoverColor: number;
    selectX: number | null;
    selectZ: number | null;
    selectRange: number;
    selectColor: number;
  }): void {
    this.padMeshes.forEach((mesh, i) => {
      const mat = mesh.material as THREE.MeshBasicMaterial;
      const active = opts.hoverPad === i;
      mat.opacity = active ? 1 : 0.9;
      mesh.scale.setScalar(active ? 1.12 : 1);
    });

    if (opts.selectX !== null && opts.selectZ !== null) {
      this.selectRing.position.set(opts.selectX, 0.3, opts.selectZ);
      this.selectRing.visible = true;
      (this.selectRing.material as THREE.MeshBasicMaterial).color.setHex(opts.selectColor);
    } else {
      this.selectRing.visible = false;
    }

    const ringX = opts.hoverPad !== null ? this.padPositions[opts.hoverPad]! : null;
    if (ringX && opts.hoverRange > 0) {
      this.rangeRing.position.set(ringX.x, 0.26, ringX.z);
      this.rangeRing.scale.setScalar(opts.hoverRange);
      (this.rangeRing.material as THREE.MeshBasicMaterial).color.setHex(opts.hoverColor);
      this.rangeRing.visible = true;
    } else if (opts.selectRange > 0 && opts.selectX !== null && opts.selectZ !== null) {
      this.rangeRing.position.set(opts.selectX, 0.27, opts.selectZ);
      this.rangeRing.scale.setScalar(opts.selectRange);
      (this.rangeRing.material as THREE.MeshBasicMaterial).color.setHex(opts.selectColor);
      this.rangeRing.visible = true;
    } else {
      this.rangeRing.visible = false;
    }
  }

  clearTransientSelect(): void {
    this.rangeRing.visible = false;
    this.selectRing.visible = false;
    this.padMeshes.forEach((mesh) => {
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.9;
      mesh.scale.setScalar(1);
    });
  }

  render(): void {
    if (this.composer && this.quality !== 'low') this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.clearLevel();
    this.renderer.dispose();
  }
}
