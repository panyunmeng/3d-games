import * as THREE from 'three';
import type { PowerupKind } from '../sim/constants';
import type { World } from '../sim/types';

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  color: THREE.Color;
}

const PARTICLE_CAP = 420;
const BULLET_CAP = 96;
const FLASH_CAP = 10;

const POWERUP_COLORS: Record<PowerupKind, number> = {
  star: 0xf5c542,
  grenade: 0xe8623a,
  helmet: 0x5fd3ef,
  shovel: 0xb8c2c9,
};

/**
 * 视觉特效：子弹、炮口火光、爆炸碎屑、道具。
 * 全部用固定容量的 InstancedMesh / 对象池，运行期不分配新几何体，避免 GC 抖动。
 */
export class Effects {
  private readonly bullets: THREE.InstancedMesh;
  private readonly particles: THREE.InstancedMesh;
  private readonly pool: Particle[] = [];
  private readonly flashes: THREE.Mesh[] = [];
  private readonly flashLife: number[] = [];
  private readonly powerups = new Map<number, THREE.Group>();
  private readonly powerupRing: THREE.Mesh;

  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();

  constructor(private readonly scene: THREE.Scene) {
    const bulletGeo = new THREE.SphereGeometry(0.18, 8, 6);
    const bulletMat = new THREE.MeshStandardMaterial({
      color: 0xffd27f,
      emissive: 0xff9c2a,
      emissiveIntensity: 2.4,
      roughness: 0.3,
    });
    this.bullets = new THREE.InstancedMesh(bulletGeo, bulletMat, BULLET_CAP);
    this.bullets.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bullets.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(BULLET_CAP * 3), 3);
    this.bullets.frustumCulled = false;
    this.bullets.count = 0;
    scene.add(this.bullets);

    const partGeo = new THREE.BoxGeometry(1, 1, 1);
    const partMat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1 });
    this.particles = new THREE.InstancedMesh(partGeo, partMat, PARTICLE_CAP);
    this.particles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.particles.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(PARTICLE_CAP * 3), 3);
    this.particles.frustumCulled = false;
    this.particles.count = 0;
    scene.add(this.particles);

    const flashGeo = new THREE.ConeGeometry(0.35, 0.9, 6);
    const flashMat = new THREE.MeshStandardMaterial({
      color: 0xffe08a,
      emissive: 0xffb347,
      emissiveIntensity: 3,
      transparent: true,
      opacity: 0.95,
    });
    for (let i = 0; i < FLASH_CAP; i++) {
      const flash = new THREE.Mesh(flashGeo, flashMat.clone());
      flash.visible = false;
      scene.add(flash);
      this.flashes.push(flash);
      this.flashLife.push(0);
    }

    const ringGeo = new THREE.RingGeometry(0.75, 0.95, 20);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xf5c542,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.powerupRing = new THREE.Mesh(ringGeo, ringMat);
    this.powerupRing.rotation.x = -Math.PI / 2;
    this.powerupRing.visible = false;
    scene.add(this.powerupRing);
  }

  /** 子弹外观：玩家白黄色、敌人赤红色。 */
  syncBullets(world: World): void {
    let n = 0;
    for (const b of world.bullets) {
      if (!b.alive || n >= BULLET_CAP) continue;
      this.dummy.position.set(b.x, 0.95, b.z);
      this.dummy.rotation.set(0, b.yaw, 0);
      this.dummy.scale.set(1, 1, 2.2);
      this.dummy.updateMatrix();
      this.bullets.setMatrixAt(n, this.dummy.matrix);
      this.color.setHex(b.team === 'player' ? 0xffe9a8 : 0xff6b4a);
      this.bullets.setColorAt(n, this.color);
      n++;
    }
    this.bullets.count = n;
    this.bullets.instanceMatrix.needsUpdate = true;
    if (this.bullets.instanceColor) this.bullets.instanceColor.needsUpdate = true;
  }

  muzzleFlash(x: number, z: number, yaw: number): void {
    let idx = this.flashLife.indexOf(0);
    if (idx < 0) idx = 0;
    const flash = this.flashes[idx];
    flash.visible = true;
    flash.position.set(x, 1.5, z);
    flash.rotation.set(0, yaw, 0);
    flash.scale.setScalar(1 + Math.random() * 0.4);
    this.flashLife[idx] = 0.09;
  }

  explosion(x: number, z: number, big: boolean): void {
    const count = big ? 26 : 10;
    const speed = big ? 14 : 7;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const up = Math.random() * (big ? 9 : 5) + 1.5;
      const sp = Math.random() * speed + 1.5;
      this.pool.push({
        x,
        y: big ? 1.2 : 0.6,
        z,
        vx: Math.cos(angle) * sp,
        vy: up,
        vz: Math.sin(angle) * sp,
        life: big ? 0.85 : 0.55,
        maxLife: big ? 0.85 : 0.55,
        size: big ? 0.34 + Math.random() * 0.28 : 0.16 + Math.random() * 0.16,
        color: new THREE.Color().setHSL(0.06 + Math.random() * 0.04, 0.95, 0.5 + Math.random() * 0.2),
      });
    }
    // 中心火球
    this.pool.push({
      x,
      y: big ? 1.4 : 0.8,
      z,
      vx: 0,
      vy: big ? 3 : 1.5,
      vz: 0,
      life: 0.28,
      maxLife: 0.28,
      size: big ? 1.8 : 1.0,
      color: new THREE.Color(0xffd27f),
    });
    while (this.pool.length > PARTICLE_CAP) this.pool.shift();
  }

  debris(x: number, z: number): void {
    for (let i = 0; i < 9; i++) {
      const angle = Math.random() * Math.PI * 2;
      const sp = Math.random() * 6 + 1.5;
      this.pool.push({
        x,
        y: 0.7 + Math.random() * 0.8,
        z,
        vx: Math.cos(angle) * sp,
        vy: Math.random() * 5 + 1,
        vz: Math.sin(angle) * sp,
        life: 0.6,
        maxLife: 0.6,
        size: 0.12 + Math.random() * 0.16,
        color: new THREE.Color().setHSL(0.03 + Math.random() * 0.03, 0.6, 0.32 + Math.random() * 0.15),
      });
    }
    while (this.pool.length > PARTICLE_CAP) this.pool.shift();
  }

  sparks(x: number, z: number): void {
    for (let i = 0; i < 6; i++) {
      const angle = Math.random() * Math.PI * 2;
      const sp = Math.random() * 5 + 1;
      this.pool.push({
        x,
        y: 1.0,
        z,
        vx: Math.cos(angle) * sp,
        vy: Math.random() * 3 + 1,
        vz: Math.sin(angle) * sp,
        life: 0.32,
        maxLife: 0.32,
        size: 0.1,
        color: new THREE.Color(0xfff0b0),
      });
    }
    while (this.pool.length > PARTICLE_CAP) this.pool.shift();
  }

  update(dt: number): void {
    // 粒子
    for (let i = this.pool.length - 1; i >= 0; i--) {
      const p = this.pool[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.pool.splice(i, 1);
        continue;
      }
      p.vy -= 22 * dt;
      p.x += p.vx * dt;
      p.y = Math.max(0.1, p.y + p.vy * dt);
      p.z += p.vz * dt;
      if (p.y <= 0.12) {
        p.vy *= -0.25;
        p.vx *= 0.7;
        p.vz *= 0.7;
      }
    }
    let n = 0;
    for (const p of this.pool) {
      if (n >= PARTICLE_CAP) break;
      const t = p.life / p.maxLife;
      this.dummy.position.set(p.x, p.y, p.z);
      this.dummy.rotation.set(p.x * 2.1, p.z * 1.7, p.life * 6);
      this.dummy.scale.setScalar(Math.max(0.05, p.size * (0.4 + t * 0.9)));
      this.dummy.updateMatrix();
      this.particles.setMatrixAt(n, this.dummy.matrix);
      this.particles.setColorAt(n, p.color);
      n++;
    }
    this.particles.count = n;
    this.particles.instanceMatrix.needsUpdate = true;
    if (this.particles.instanceColor) this.particles.instanceColor.needsUpdate = true;

    // 炮口火光
    for (let i = 0; i < this.flashes.length; i++) {
      if (this.flashLife[i] <= 0) continue;
      this.flashLife[i] -= dt;
      const f = this.flashes[i];
      if (this.flashLife[i] <= 0) {
        f.visible = false;
        continue;
      }
      const t = this.flashLife[i] / 0.09;
      f.scale.setScalar(0.7 + (1 - t) * 0.9);
      (f.material as THREE.MeshStandardMaterial).opacity = t;
    }
  }

  /** 同步道具外观：加一档浮空旋转 + 地面光环。 */
  syncPowerups(world: World, time: number): void {
    const seen = new Set<number>();
    for (const p of world.powerups) {
      seen.add(p.id);
      let g = this.powerups.get(p.id);
      if (!g) {
        g = new THREE.Group();
        const color = POWERUP_COLORS[p.kind];
        const core = new THREE.Mesh(
          new THREE.BoxGeometry(0.85, 0.85, 0.85),
          new THREE.MeshStandardMaterial({
            color,
            emissive: color,
            emissiveIntensity: 0.85,
            roughness: 0.35,
            metalness: 0.3,
          }),
        );
        core.castShadow = true;
        g.add(core);
        const halo = new THREE.Mesh(
          new THREE.TorusGeometry(0.72, 0.06, 6, 18),
          new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: color, emissiveIntensity: 1.4 }),
        );
        halo.rotation.x = Math.PI / 2;
        g.add(halo);
        g.position.set(p.x, 1.3, p.z);
        this.scene.add(g);
        this.powerups.set(p.id, g);
      }
      g.position.set(p.x, 1.25 + Math.sin(time * 2.2 + p.id) * 0.18, p.z);
      g.rotation.y = time * 1.6;
    }
    for (const [id, g] of this.powerups) {
      if (seen.has(id)) continue;
      this.scene.remove(g);
      g.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        (mesh.material as THREE.Material | undefined)?.dispose();
      });
      this.powerups.delete(id);
    }
    this.powerupRing.visible = world.powerups.length > 0;
    void time;
  }

  dispose(): void {
    this.scene.remove(this.bullets);
    this.scene.remove(this.particles);
    this.scene.remove(this.powerupRing);
    for (const f of this.flashes) this.scene.remove(f);
    for (const g of this.powerups.values()) this.scene.remove(g);
  }
}
