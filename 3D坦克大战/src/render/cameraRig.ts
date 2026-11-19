import * as THREE from 'three';
import { TILE, TILE_BRICK, TILE_STEEL } from '../sim/constants';
import { inBounds, tileAt } from '../sim/map';
import type { MapState } from '../sim/types';

const MIN_DIST = 6;
const MAX_DIST = 15;
const BASE_HEIGHT = 4.6;

/** 平滑角度插值（处理 ±π 环绕）。 */
function lerpAngle(current: number, target: number, t: number): number {
  let d = (target - current) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return current + d * t;
}

/**
 * 第三人称跟随相机。
 * 关键约束：相机跟随「车体」朝向而不是炮塔朝向——否则转炮塔时画面跟着晃，无法瞄准。
 */
export class CameraRig {
  distance = 8.4;
  private yaw = 0;
  private readonly pos = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private initialized = false;
  lastTargetYaw = 0;
  updateCount = 0;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  zoom(deltaY: number): void {
    this.distance = Math.min(MAX_DIST, Math.max(MIN_DIST, this.distance + Math.sign(deltaY) * 0.9));
  }

  snapTo(x: number, z: number, yaw: number): void {
    this.yaw = yaw;
    this.initialized = false;
    this.update(1, x, z, yaw, null);
  }

  /**
   * @param dt 帧间隔
   * @param map 地形（用于遮挡收近，避免相机穿进砖墙里）
   */
  update(dt: number, x: number, z: number, yaw: number, map: MapState | null): void {
    // 车体转向平滑：跟得慢一点，急转弯时画面不会甩
    const follow = 1 - Math.exp(-6 * dt);
    this.lastTargetYaw = yaw;
    this.updateCount += 1;
    this.yaw = lerpAngle(this.yaw, yaw, follow);

    const back = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    let dist = this.distance;
    const height = BASE_HEIGHT * (dist / 8.4);

    // 网格射线：从坦克上方沿相机方向采样，遇到砖/钢就把相机拉近（不做昂贵的 mesh raycast）
    if (map) {
      const steps = 14;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const px = x + back.x * dist * t;
        const pz = z + back.z * dist * t;
        const cx = Math.floor(px / TILE);
        const cz = Math.floor(pz / TILE);
        // 地图外不算遮挡：玩家出生点在最底排，相机被推出去是正常的
        if (!inBounds(cx, cz)) continue;
        const tile = tileAt(map, cx, cz);
        if (tile !== TILE_BRICK && tile !== TILE_STEEL) continue;
        // 只有「视线高度低于墙顶」才算遮挡：否则 4.6 m 高的相机会被 1.7 m 砖墙莫名其妙拉近
        const wallTop = tile === TILE_STEEL ? 2.3 : 1.75;
        const yAt = 1.0 + (height - 1.0) * t;
        if (yAt < wallTop) {
          dist = Math.max(MIN_DIST * 0.62, dist * t - 0.6);
          break;
        }
      }
    }

    const targetPos = new THREE.Vector3(
      x + back.x * dist,
      height,
      z + back.z * dist,
    );
    const targetLook = new THREE.Vector3(x, 1.15, z);

    if (!this.initialized) {
      this.pos.copy(targetPos);
      this.look.copy(targetLook);
      this.initialized = true;
    } else {
      const k = 1 - Math.exp(-10 * dt);
      this.pos.lerp(targetPos, k);
      this.look.lerp(targetLook, 1 - Math.exp(-14 * dt));
    }

    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }

  /** 调试用：当前跟随状态。 */
  debugState(): { yaw: number; dist: number; x: number; y: number; z: number; targetYaw: number; count: number } {
    return {
      yaw: this.yaw,
      dist: this.distance,
      x: this.pos.x,
      y: this.pos.y,
      z: this.pos.z,
      targetYaw: this.lastTargetYaw,
      count: this.updateCount,
    };
  }

  /** 菜单/结算时缓慢环绕基地，避免静止画面。 */
  cinematic(time: number): void {
    const r = 30;
    this.camera.position.set(
      26 + Math.sin(time * 0.12) * r,
      18,
      42 + Math.cos(time * 0.12) * r,
    );
    this.camera.lookAt(26, 0, 40);
  }
}
