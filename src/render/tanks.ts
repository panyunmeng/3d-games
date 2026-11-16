import * as THREE from 'three';
import { ENEMY_KINDS } from '../sim/constants';
import type { Tank, World } from '../sim/types';

const PLAYER_COLOR = 0x7ac043;
const TRACK_COLOR = 0x24282c;

export interface TankView {
  group: THREE.Group;
  turret: THREE.Group;
  shield: THREE.Mesh;
  pips: THREE.Group;
  bodyMats: THREE.MeshStandardMaterial[];
}

function box(
  w: number,
  h: number,
  d: number,
  mat: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function createTankView(tank: Tank): TankView {
  const isPlayer = tank.kind === 'player';
  const baseColor = isPlayer ? PLAYER_COLOR : ENEMY_KINDS[tank.enemyKind ?? 'normal'].color;
  const bodyMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    roughness: 0.65,
    metalness: 0.08,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: isPlayer ? 0x4f8c2c : 0x3d3a36,
    roughness: 0.7,
    metalness: 0.2,
  });
  const trackMat = new THREE.MeshStandardMaterial({ color: TRACK_COLOR, roughness: 0.95, metalness: 0.05 });
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x555c62, roughness: 0.55, metalness: 0.25 });

  const group = new THREE.Group();
  const bodyMats = [bodyMat, accentMat];

  // 车体：底盘 + 两侧履带 + 前装甲斜面感（用前倾薄板近似）
  const hull = box(2.2, 0.8, 3.0, bodyMat, 0, 0.85, 0);
  group.add(hull);
  group.add(box(2.25, 0.28, 3.05, accentMat, 0, 1.24, 0));
  for (const side of [-1, 1]) {
    group.add(box(0.5, 0.75, 3.25, trackMat, side * 1.08, 0.52, 0));
    // 负重轮（简化成一排小圆柱）
    for (let i = -1; i <= 1; i++) {
      const wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.3, 0.42, 10),
        trackMat,
      );
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(side * 1.08, 0.45, i * 1.0);
      wheel.castShadow = true;
      group.add(wheel);
    }
  }
  // 前部装甲板（朝 +z 的一侧是车头）
  const glacis = box(2.0, 0.55, 0.35, accentMat, 0, 1.0, 1.45);
  glacis.rotation.x = -0.35;
  group.add(glacis);

  // 炮塔：整体绕车体中心独立旋转
  const turret = new THREE.Group();
  turret.position.set(0, 1.34, 0);
  const turretBase = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 1.0, 0.5, 8), bodyMat);
  turretBase.castShadow = true;
  turretBase.receiveShadow = true;
  turret.position.y = 1.34;
  turret.add(turretBase);
  turret.add(box(0.9, 0.34, 1.05, accentMat, 0, 0.35, -0.05));

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.145, 2.1, 8), barrelMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.16, 1.35);
  barrel.castShadow = true;
  turret.add(barrel);
  // 炮口制退器
  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.26, 8), barrelMat);
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.set(0, 0.16, 2.3);
  turret.add(muzzle);

  // 火力等级指示：车尾最多 3 颗黄色小灯
  const pips = new THREE.Group();
  pips.position.set(0, 1.15, -1.45);
  for (let i = 0; i < 3; i++) {
    const pip = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.16, 0.16),
      new THREE.MeshStandardMaterial({ color: 0xf5d76e, emissive: 0xf5a623, emissiveIntensity: 1.2 }),
    );
    pip.position.x = (i - 1) * 0.28;
    pips.add(pip);
  }
  group.add(pips);

  // 出生保护：半透明护盾球
  const shield = new THREE.Mesh(
    new THREE.SphereGeometry(2.05, 16, 12),
    new THREE.MeshStandardMaterial({
      color: 0x7fd7ff,
      transparent: true,
      opacity: 0.22,
      emissive: 0x3aa8dd,
      emissiveIntensity: 0.7,
      depthWrite: false,
    }),
  );
  shield.position.y = 1.2;
  shield.visible = false;
  group.add(shield);

  group.add(turret);

  return { group, turret, shield, pips, bodyMats };
}

/** 维护 tankId → 网格的映射，随世界状态增删。 */
export class TankViews {
  private readonly views = new Map<number, TankView>();

  constructor(private readonly scene: THREE.Scene) {}

  sync(world: World): void {
    const seen = new Set<number>();
    for (const tank of world.tanks) {
      seen.add(tank.id);
      let view = this.views.get(tank.id);
      if (!view) {
        view = createTankView(tank);
        this.views.set(tank.id, view);
        this.scene.add(view.group);
      }
      const g = view.group;
      g.visible = tank.alive;
      g.position.set(tank.x, 0, tank.z);
      g.rotation.y = tank.yaw;
      view.turret.rotation.y = tank.turretYaw - tank.yaw;

      // 火力等级
      view.pips.visible = tank.kind === 'player' && tank.power > 1;
      view.pips.children.forEach((pip, i) => {
        pip.visible = i < tank.power - 1;
      });

      // 出生保护罩
      const shielded = tank.invulnUntil > world.time;
      view.shield.visible = shielded;
      if (shielded) {
        const s = 1 + Math.sin(world.time * 12) * 0.04;
        view.shield.scale.setScalar(s);
      }

      // 敌人受伤时车体发红
      const hurt = tank.kind === 'enemy' && tank.hp < tank.maxHp;
      for (const mat of view.bodyMats) {
        mat.emissive.setHex(hurt ? 0x5a1508 : 0x000000);
        mat.emissiveIntensity = hurt ? 1.1 : 0;
      }
    }
    for (const [id, view] of this.views) {
      if (!seen.has(id)) {
        this.scene.remove(view.group);
        view.group.traverse((o) => {
          const mesh = o as THREE.Mesh;
          mesh.geometry?.dispose();
        });
        this.views.delete(id);
      }
    }
  }

  /** 炮口世界坐标（特效定位用）。 */
  muzzleOf(tank: Tank): THREE.Vector3 {
    const len = 2.45;
    return new THREE.Vector3(
      tank.x + Math.sin(tank.turretYaw) * len,
      1.5,
      tank.z + Math.cos(tank.turretYaw) * len,
    );
  }

  dispose(): void {
    for (const view of this.views.values()) {
      this.scene.remove(view.group);
      view.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        const mat = mesh.material as THREE.Material | undefined;
        mat?.dispose();
      });
    }
    this.views.clear();
  }
}
