import { BASE_CENTER, BASE_HALF, TANK_RADIUS, TANK_SHOVE_RADIUS, TILE } from './constants';
import { inBounds, solidForTank } from './map';
import type { MapState, Tank, World } from './types';

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** 圆与格子地形是否相交（坦克用）。 */
export function circleHitsTiles(map: MapState, x: number, z: number, r: number): boolean {
  const minCx = Math.floor((x - r) / TILE);
  const maxCx = Math.floor((x + r) / TILE);
  const minCz = Math.floor((z - r) / TILE);
  const maxCz = Math.floor((z + r) / TILE);
  for (let cz = minCz; cz <= maxCz; cz++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      if (!inBounds(cx, cz)) return true;
      if (!solidForTank(map, cx, cz)) continue;
      const rx0 = cx * TILE;
      const rz0 = cz * TILE;
      const px = clamp(x, rx0, rx0 + TILE);
      const pz = clamp(z, rz0, rz0 + TILE);
      const dx = x - px;
      const dz = z - pz;
      if (dx * dx + dz * dz < r * r) return true;
    }
  }
  return false;
}

export function hitsBase(x: number, z: number, r: number): boolean {
  const dx = Math.max(Math.abs(x - BASE_CENTER.x) - BASE_HALF, 0);
  const dz = Math.max(Math.abs(z - BASE_CENTER.z) - BASE_HALF, 0);
  return dx * dx + dz * dz < r * r;
}

function hitsOtherTank(world: World, self: Tank, x: number, z: number): boolean {
  const limit = TANK_SHOVE_RADIUS * 2;
  const limitSq = limit * limit;
  for (const other of world.tanks) {
    if (other === self || !other.alive) continue;
    const dx = other.x - x;
    const dz = other.z - z;
    if (dx * dx + dz * dz < limitSq) return true;
  }
  return false;
}

/**
 * 分轴移动坦克：先 x 后 z，被挡的轴单独回退，得到沿墙滑动的手感。
 * 位移超过 0.3 m 时分步推进——否则低帧率或长 dt 下一次大位移会直接穿过薄墙。
 * 返回实际位移量（AI 用来看自己是否卡住）。
 */
export function moveTank(world: World, tank: Tank, dx: number, dz: number): number {
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-9) return 0;
  const steps = Math.max(1, Math.ceil(dist / 0.3));
  const sx = dx / steps;
  const sz = dz / steps;
  let moved = 0;
  for (let i = 0; i < steps; i++) moved += moveTankStep(world, tank, sx, sz);
  return moved;
}

function moveTankStep(world: World, tank: Tank, dx: number, dz: number): number {
  let moved = 0;
  if (dx !== 0) {
    const nx = tank.x + dx;
    if (
      !circleHitsTiles(world.map, nx, tank.z, TANK_RADIUS) &&
      !hitsBase(nx, tank.z, TANK_RADIUS) &&
      !hitsOtherTank(world, tank, nx, tank.z)
    ) {
      tank.x = nx;
      moved += Math.abs(dx);
    }
  }
  if (dz !== 0) {
    const nz = tank.z + dz;
    if (
      !circleHitsTiles(world.map, tank.x, nz, TANK_RADIUS) &&
      !hitsBase(tank.x, nz, TANK_RADIUS) &&
      !hitsOtherTank(world, tank, tank.x, nz)
    ) {
      tank.z = nz;
      moved += Math.abs(dz);
    }
  }
  return moved;
}

/** 朝向差归一化到 (-π, π]。 */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** 以最大角速度把 current 转向 target，返回新角度。 */
export function turnToward(current: number, target: number, maxDelta: number): number {
  const d = angleDelta(current, target);
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}
