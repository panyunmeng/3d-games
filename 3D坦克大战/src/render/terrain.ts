import * as THREE from 'three';
import {
  BASE_CENTER,
  GRID_H,
  GRID_W,
  TILE,
  TILE_BRICK,
  TILE_FOREST,
  TILE_STEEL,
  TILE_WATER,
} from '../sim/constants';
import { tileAt } from '../sim/map';
import type { MapState, World } from '../sim/types';
import { createBrickTexture, createSteelTexture, createWaterTexture } from './scene';

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

/** 稳定哈希：同一格子的树木外观每次加载都一样（不抖动）。 */
function cellHash(cx: number, cz: number): number {
  let h = (cx * 374761393 + cz * 668265263) >>> 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * 地形视图：砖/钢/水/林各一个 InstancedMesh，按格子索引写实例矩阵。
 * 地图离散（26×26），所以「哪一格变了」可以直接由 tiles 数组对比得出。
 */
export class TerrainView {
  readonly group = new THREE.Group();
  private readonly brick: THREE.InstancedMesh;
  private readonly steel: THREE.InstancedMesh;
  private readonly water: THREE.InstancedMesh;
  private readonly trunks: THREE.InstancedMesh;
  private readonly canopies: THREE.InstancedMesh;
  private readonly waterTex: THREE.CanvasTexture;
  private readonly baseGroup = new THREE.Group();
  private readonly baseCore: THREE.Mesh[] = [];
  private baseAlive = true;
  private lastTiles = new Uint8Array(GRID_W * GRID_H);

  constructor(scene: THREE.Scene) {
    scene.add(this.group);

    const brickTex = createBrickTexture();
    brickTex.repeat.set(2, 2);
    const brickMat = new THREE.MeshStandardMaterial({ map: brickTex, roughness: 0.92, metalness: 0.02 });
    const brickGeo = new THREE.BoxGeometry(TILE * 0.48, 1.7, TILE * 0.48);
    this.brick = new THREE.InstancedMesh(brickGeo, brickMat, GRID_W * GRID_H * 4);
    this.brick.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.brick.castShadow = true;
    this.brick.receiveShadow = true;
    this.brick.frustumCulled = false;
    this.group.add(this.brick);

    const steelMat = new THREE.MeshStandardMaterial({
      map: createSteelTexture(),
      roughness: 0.5,
      metalness: 0.28,
    });
    this.steel = new THREE.InstancedMesh(
      new THREE.BoxGeometry(TILE * 0.98, 2.2, TILE * 0.98),
      steelMat,
      GRID_W * GRID_H,
    );
    this.steel.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.steel.castShadow = true;
    this.steel.receiveShadow = true;
    this.steel.frustumCulled = false;
    this.group.add(this.steel);

    this.waterTex = createWaterTexture();
    this.waterTex.repeat.set(1, 1);
    const waterMat = new THREE.MeshStandardMaterial({
      map: this.waterTex,
      color: 0x9fd4ff,
      transparent: true,
      opacity: 0.86,
      roughness: 0.2,
      metalness: 0.1,
      emissive: 0x0c2740,
      emissiveIntensity: 0.6,
    });
    // 水面用圆角薄板，边缘不做大倒角，避免格子感过强
    this.water = new THREE.InstancedMesh(new THREE.BoxGeometry(TILE * 0.99, 0.16, TILE * 0.99), waterMat, GRID_W * GRID_H);
    this.water.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.water.receiveShadow = true;
    this.water.frustumCulled = false;
    this.group.add(this.water);

    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 1 });
    const canopyMat = new THREE.MeshStandardMaterial({
      color: 0x2f6b34,
      roughness: 0.85,
      transparent: true,
      opacity: 0.88,
    });
    this.trunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.16, 0.22, 1.2, 6),
      trunkMat,
      GRID_W * GRID_H,
    );
    this.canopies = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.95, 2.8, 7),
      canopyMat,
      GRID_W * GRID_H,
    );
    for (const mesh of [this.trunks, this.canopies]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }

    this.buildBase();
    this.group.add(this.baseGroup);
  }

  private buildBase(): void {
    const pedestal = new THREE.Mesh(
      new THREE.BoxGeometry(3.8, 0.5, 3.8),
      new THREE.MeshStandardMaterial({ color: 0x5a5f52, roughness: 0.95 }),
    );
    pedestal.position.y = 0.25;
    pedestal.receiveShadow = true;
    pedestal.castShadow = true;
    this.baseGroup.add(pedestal);

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(2.8, 1.5, 2.8),
      new THREE.MeshStandardMaterial({ color: 0xb98a4b, roughness: 0.75 }),
    );
    body.position.y = 1.25;
    body.castShadow = true;
    body.receiveShadow = true;
    this.baseGroup.add(body);
    this.baseCore.push(body);

    // 抽象“鹰徽”：金色菱形 + 双翼
    const emblemMat = new THREE.MeshStandardMaterial({
      color: 0xf2c94c,
      emissive: 0x6a4d00,
      emissiveIntensity: 0.5,
      roughness: 0.4,
      metalness: 0.5,
    });
    const emblem = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 0.28), emblemMat);
    emblem.position.set(0, 1.55, 1.35);
    emblem.rotation.z = Math.PI / 4;
    emblem.castShadow = true;
    this.baseGroup.add(emblem);
    this.baseCore.push(emblem);

    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.16, 0.4), emblemMat);
      wing.position.set(side * 0.95, 1.62, 1.32);
      wing.rotation.z = side * -0.32;
      wing.castShadow = true;
      this.baseGroup.add(wing);
      this.baseCore.push(wing);
    }

    this.baseGroup.position.set(BASE_CENTER.x, 0, BASE_CENTER.z);
  }

  /** 换关/重开：把整张地图重新写入实例矩阵。 */
  setMap(map: MapState): void {
    this.lastTiles = new Uint8Array(map.tiles.length).fill(0xff);
    for (let cz = 0; cz < GRID_H; cz++) {
      for (let cx = 0; cx < GRID_W; cx++) this.writeCell(map, cx, cz, true);
    }
    this.brick.instanceMatrix.needsUpdate = true;
    this.steel.instanceMatrix.needsUpdate = true;
    this.water.instanceMatrix.needsUpdate = true;
    this.trunks.instanceMatrix.needsUpdate = true;
    this.canopies.instanceMatrix.needsUpdate = true;
    this.setBaseAlive(true, true);
  }

  /** 每帧：只更新发生变化的格子。 */
  sync(map: MapState, dt: number, world: World): void {
    // 只有真的变了才上传实例矩阵：每帧无条件上传 2700+ 个矩阵会把帧率拖到 30 fps。
    let dirty = false;
    for (let cz = 0; cz < GRID_H; cz++) {
      for (let cx = 0; cx < GRID_W; cx++) {
        const i = cz * GRID_W + cx;
        if (map.tiles[i] !== this.lastTiles[i]) {
          this.writeCell(map, cx, cz, false);
          dirty = true;
        }
      }
    }
    if (dirty) {
      this.brick.instanceMatrix.needsUpdate = true;
      this.steel.instanceMatrix.needsUpdate = true;
      this.water.instanceMatrix.needsUpdate = true;
      this.trunks.instanceMatrix.needsUpdate = true;
      this.canopies.instanceMatrix.needsUpdate = true;
    }

    this.waterTex.offset.y = (this.waterTex.offset.y - dt * 0.05) % 1;
    this.setBaseAlive(world.base.alive, false);
  }

  private writeCell(map: MapState, cx: number, cz: number, force: boolean): void {
    const i = cz * GRID_W + cx;
    const tile = tileAt(map, cx, cz);
    this.lastTiles[i] = tile;
    const x = (cx + 0.5) * TILE;
    const z = (cz + 0.5) * TILE;

    // 砖：每格 4 个象限块，打掉整格时一起消失
    for (let q = 0; q < 4; q++) {
      const ox = (q % 2 === 0 ? -1 : 1) * TILE * 0.245;
      const oz = (q < 2 ? -1 : 1) * TILE * 0.245;
      if (tile === TILE_BRICK) {
        _m.compose(new THREE.Vector3(x + ox, 0.85, z + oz), _q.identity(), _s.set(1, 1, 1));
      } else {
        _m.copy(HIDDEN);
      }
      this.brick.setMatrixAt(i * 4 + q, _m);
    }

    if (tile === TILE_STEEL) _m.compose(new THREE.Vector3(x, 1.1, z), _q.identity(), _s.set(1, 1, 1));
    else _m.copy(HIDDEN);
    this.steel.setMatrixAt(i, _m);

    if (tile === TILE_WATER) _m.compose(new THREE.Vector3(x, 0.08, z), _q.identity(), _s.set(1, 1, 1));
    else _m.copy(HIDDEN);
    this.water.setMatrixAt(i, _m);

    if (tile === TILE_FOREST) {
      const h = cellHash(cx, cz);
      const rot = h * Math.PI * 2;
      const scale = 0.85 + h * 0.35;
      _q.setFromAxisAngle(_v.set(0, 1, 0), rot);
      _m.compose(new THREE.Vector3(x, 0.6 * scale, z), _q, _s.set(scale, scale, scale));
      this.trunks.setMatrixAt(i, _m);
      _m.compose(new THREE.Vector3(x, (1.2 + 1.4) * scale, z), _q, _s.set(scale, scale, scale));
      this.canopies.setMatrixAt(i, _m);
    } else {
      this.trunks.setMatrixAt(i, HIDDEN);
      this.canopies.setMatrixAt(i, HIDDEN);
    }
    void force;
  }

  private setBaseAlive(alive: boolean, instant: boolean): void {
    if (alive === this.baseAlive && !instant) return;
    this.baseAlive = alive;
    for (const mesh of this.baseCore) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (alive) {
        mat.color.setHex(mesh === this.baseCore[0] ? 0xb98a4b : 0xf2c94c);
        mat.emissive.setHex(mesh === this.baseCore[0] ? 0x000000 : 0x6a4d00);
        mesh.scale.set(1, 1, 1);
        mesh.rotation.x = 0;
        mesh.rotation.z = mesh === this.baseCore[1] ? Math.PI / 4 : mesh === this.baseCore[2] ? -0.32 : mesh === this.baseCore[3] ? 0.32 : 0;
      } else {
        mat.color.setHex(0x2b2622);
        mat.emissive.setHex(0x000000);
        mesh.scale.set(1, 0.35, 1);
        mesh.rotation.z = 0.25;
      }
    }
  }

  dispose(): void {
    this.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    this.group.removeFromParent();
    this.waterTex.dispose();
  }
}
