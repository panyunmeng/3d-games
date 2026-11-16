import * as THREE from 'three';
import { BASE_CENTER, TILE, TILE_BRICK, TILE_STEEL } from '../sim/constants';
import { tileAt } from '../sim/map';
import type { MapState, SimEvent, Tank, World } from '../sim/types';
import { Effects } from './effects';
import { TankViews } from './tanks';
import { TerrainView } from './terrain';

/**
 * 把仿真世界（纯数据）映射成 Three.js 场景。
 * 仿真层不知道渲染的存在：这里只读 World、不写 World。
 */
export class WorldView {
  readonly terrain: TerrainView;
  readonly tanks: TankViews;
  readonly effects: Effects;

  private readonly reticle = new THREE.Group();

  constructor(private readonly scene: THREE.Scene) {
    this.terrain = new TerrainView(scene);
    this.tanks = new TankViews(scene);
    this.effects = new Effects(scene);
    this.buildReticle();
  }

  /** 炮口落点准星：鼠标转炮塔时，3D 世界里必须有一个明确的“打哪”提示。 */
  private buildReticle(): void {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.58, 24),
      new THREE.MeshBasicMaterial({
        color: 0xf5c542,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    this.reticle.add(ring);
    const dot = new THREE.Mesh(
      new THREE.CircleGeometry(0.1, 14),
      new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.95, depthWrite: false }),
    );
    dot.rotation.x = -Math.PI / 2;
    this.reticle.add(dot);
    this.reticle.position.y = 0.06;
    this.reticle.visible = false;
    this.scene.add(this.reticle);
  }

  /** 沿炮塔方向推进，遇到砖/钢/敌坦克就把准星放在命中点。 */
  updateAim(tank: Tank | null, map: MapState | null, world: World | null): void {
    if (!tank || !tank.alive || !map) {
      this.reticle.visible = false;
      return;
    }
    const dx = Math.sin(tank.turretYaw);
    const dz = Math.cos(tank.turretYaw);
    let px = tank.x;
    let pz = tank.z;
    let blocked = false;
    const stepLen = 0.35;
    const maxDist = 62;
    for (let d = 2.0; d < maxDist; d += stepLen) {
      px = tank.x + dx * d;
      pz = tank.z + dz * d;
      const tile = tileAt(map, Math.floor(px / TILE), Math.floor(pz / TILE));
      if (tile === TILE_BRICK || tile === TILE_STEEL) {
        blocked = true;
        break;
      }
      if (world) {
        for (const other of world.tanks) {
          if (!other.alive || other.id === tank.id) continue;
          if (other.kind === tank.kind) continue;
          if (Math.hypot(other.x - px, other.z - pz) < 1.3) {
            blocked = true;
            break;
          }
        }
        if (blocked) break;
      }
    }
    this.reticle.visible = true;
    this.reticle.position.set(px, 0.06, pz);
    const mat = (this.reticle.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    mat.color.setHex(blocked ? 0xff6b4a : 0xf5c542);
  }

  /** 换关/重开：重建地形。 */
  setWorld(world: World): void {
    this.terrain.setMap(world.map);
  }

  sync(world: World, dt: number): void {
    this.terrain.sync(world.map, dt, world);
    this.tanks.sync(world);
    this.effects.syncBullets(world);
    this.effects.syncPowerups(world, world.time);
  }

  update(dt: number): void {
    this.effects.update(dt);
  }

  /** 仿真事件 → 视觉表现。 */
  handleEvents(events: readonly SimEvent[]): void {
    for (const ev of events) {
      switch (ev.type) {
        case 'shoot':
          this.effects.muzzleFlash(ev.x, ev.z, ev.yaw);
          break;
        case 'explode':
          this.effects.explosion(ev.x, ev.z, ev.big);
          break;
        case 'brickBreak':
          this.effects.debris(ev.x, ev.z);
          break;
        case 'steelBreak':
          this.effects.sparks(ev.x, ev.z);
          this.effects.debris(ev.x, ev.z);
          break;
        case 'bulletClash':
          this.effects.sparks(ev.x, ev.z);
          break;
        case 'baseHit':
          this.effects.explosion(BASE_CENTER.x, BASE_CENTER.z, true);
          break;
        case 'enemyDown':
          break;
        default:
          break;
      }
    }
  }

  dispose(): void {
    this.scene.remove(this.reticle);
    this.terrain.dispose();
    this.tanks.dispose();
    this.effects.dispose();
  }
}
