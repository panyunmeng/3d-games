import * as THREE from 'three';

interface Effect {
  update(dt: number): boolean;
  dispose(): void;
}

const additive = (color: number, opacity = 1): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

const lineMat = (color: number, opacity = 0.9): THREE.LineBasicMaterial =>
  new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

/** 短命视觉特效：弹道、爆炸、电弧、粒子。只做表现，不参与模拟。 */
export class Effects {
  private items: Effect[] = [];
  private readonly scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  clear(): void {
    for (const it of this.items) it.dispose();
    this.items = [];
  }

  private add(e: Effect): void {
    this.items.push(e);
  }

  update(dt: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i]!;
      if (!item.update(dt)) {
        item.dispose();
        this.items.splice(i, 1);
      }
    }
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, color: number): void {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const mat = lineMat(color, 1);
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    let t = 0;
    const dur = 0.09;
    this.add({
      update: (dt) => {
        t += dt;
        mat.opacity = Math.max(0, 1 - t / dur);
        return t < dur;
      },
      dispose: () => {
        this.scene.remove(line);
        geo.dispose();
        mat.dispose();
      },
    });
  }

  beam(from: THREE.Vector3, to: THREE.Vector3, color: number, width = 0.09): void {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
    const geo = new THREE.CylinderGeometry(width, width, 1, 6, 1, true);
    const mat = additive(color, 0.95);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(mid);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    mesh.scale.y = len;
    this.scene.add(mesh);
    let t = 0;
    const dur = 0.18;
    this.add({
      update: (dt) => {
        t += dt;
        mat.opacity = Math.max(0, 0.95 * (1 - t / dur));
        mesh.scale.x = mesh.scale.z = 1 + t * 3;
        return t < dur;
      },
      dispose: () => {
        this.scene.remove(mesh);
        geo.dispose();
        mat.dispose();
      },
    });
  }

  chain(points: { x: number; z: number }[], color: number): void {
    const verts: THREE.Vector3[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      for (let k = 0; k < 6; k++) {
        const t = k / 6;
        const x = a.x + (b.x - a.x) * t + (Math.random() - 0.5) * 0.55;
        const z = a.z + (b.z - a.z) * t + (Math.random() - 0.5) * 0.55;
        verts.push(new THREE.Vector3(x, 1.2 + Math.random() * 0.5, z));
      }
    }
    const last = points[points.length - 1]!;
    verts.push(new THREE.Vector3(last.x, 1.2, last.z));
    const geo = new THREE.BufferGeometry().setFromPoints(verts);
    const mat = lineMat(color, 1);
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    let t = 0;
    const dur = 0.22;
    this.add({
      update: (dt) => {
        t += dt;
        mat.opacity = Math.max(0, 1 - t / dur);
        return t < dur;
      },
      dispose: () => {
        this.scene.remove(line);
        geo.dispose();
        mat.dispose();
      },
    });
  }

  shell(from: { x: number; z: number }, to: { x: number; z: number }, duration: number, color: number): void {
    const geo = new THREE.SphereGeometry(0.16, 8, 6);
    const mat = additive(color, 1);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(from.x, 1.3, from.z);
    this.scene.add(mesh);
    let t = 0;
    const arc = 2.2 + Math.hypot(to.x - from.x, to.z - from.z) * 0.05;
    this.add({
      update: (dt) => {
        t += dt;
        const p = Math.min(1, t / duration);
        mesh.position.x = from.x + (to.x - from.x) * p;
        mesh.position.z = from.z + (to.z - from.z) * p;
        mesh.position.y = 1.3 + Math.sin(p * Math.PI) * arc;
        return t < duration;
      },
      dispose: () => {
        this.scene.remove(mesh);
        geo.dispose();
        mat.dispose();
      },
    });
  }

  explosion(x: number, z: number, radius: number, color: number): void {
    const group = new THREE.Group();
    group.position.set(x, 0.6, z);

    const sphereGeo = new THREE.IcosahedronGeometry(1, 1);
    const sphereMat = additive(color, 0.9);
    const sphere = new THREE.Mesh(sphereGeo, sphereMat);
    group.add(sphere);

    const ringGeo = new THREE.RingGeometry(0.6, 0.75, 24);
    const ringMat = additive(color, 0.8);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.5;
    group.add(ring);

    const light = new THREE.PointLight(color, 16, radius * 3, 2);
    light.position.y = 0.5;
    group.add(light);

    // 迸射火花
    const count = 14;
    const pos = new Float32Array(count * 3);
    const vel: THREE.Vector3[] = [];
    for (let i = 0; i < count; i++) {
      pos[i * 3] = 0;
      pos[i * 3 + 1] = 0;
      pos[i * 3 + 2] = 0;
      const a = Math.random() * Math.PI * 2;
      const up = 2 + Math.random() * 5;
      const sp = 3 + Math.random() * 7;
      vel.push(new THREE.Vector3(Math.cos(a) * sp, up, Math.sin(a) * sp));
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pMat = new THREE.PointsMaterial({
      color,
      size: 0.3,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const points = new THREE.Points(pGeo, pMat);
    group.add(points);

    this.scene.add(group);

    let t = 0;
    const dur = 0.55;
    this.add({
      update: (dt) => {
        t += dt;
        const p = t / dur;
        const s = radius * (0.25 + p * 1.1);
        sphere.scale.setScalar(s);
        sphereMat.opacity = Math.max(0, 0.9 * (1 - p * 1.4));
        ring.scale.setScalar(radius * (0.5 + p * 1.8));
        ringMat.opacity = Math.max(0, 0.8 * (1 - p));
        light.intensity = Math.max(0, 16 * (1 - p * 1.6));
        const arr = pGeo.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < count; i++) {
          const v = vel[i]!;
          arr.setXYZ(i, arr.getX(i) + v.x * dt, arr.getY(i) + v.y * dt, arr.getZ(i) + v.z * dt);
          v.y -= 18 * dt;
        }
        arr.needsUpdate = true;
        pMat.opacity = Math.max(0, 1 - p * 1.5);
        return t < dur;
      },
      dispose: () => {
        this.scene.remove(group);
        sphereGeo.dispose();
        sphereMat.dispose();
        ringGeo.dispose();
        ringMat.dispose();
        pGeo.dispose();
        pMat.dispose();
        light.dispose();
      },
    });
  }

  ringPulse(x: number, z: number, color: number, maxRadius = 3.5): void {
    const geo = new THREE.RingGeometry(0.4, 0.55, 28);
    const mat = additive(color, 0.9);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.12, z);
    this.scene.add(mesh);
    let t = 0;
    const dur = 0.5;
    this.add({
      update: (dt) => {
        t += dt;
        const p = t / dur;
        mesh.scale.setScalar(1 + p * maxRadius);
        mat.opacity = Math.max(0, 0.9 * (1 - p));
        return t < dur;
      },
      dispose: () => {
        this.scene.remove(mesh);
        geo.dispose();
        mat.dispose();
      },
    });
  }

  /** 击杀碎片 */
  debris(x: number, z: number, color: number, big = false): void {
    const count = big ? 20 : 8;
    const pos = new Float32Array(count * 3);
    const vel: THREE.Vector3[] = [];
    for (let i = 0; i < count; i++) {
      pos[i * 3] = x;
      pos[i * 3 + 1] = 0.7;
      pos[i * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * (big ? 7 : 4);
      vel.push(new THREE.Vector3(Math.cos(a) * sp, 2 + Math.random() * 4, Math.sin(a) * sp));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color,
      size: big ? 0.4 : 0.25,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);
    let t = 0;
    const dur = 0.7;
    this.add({
      update: (dt) => {
        t += dt;
        const arr = geo.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < count; i++) {
          const v = vel[i]!;
          arr.setXYZ(i, arr.getX(i) + v.x * dt, arr.getY(i) + v.y * dt, arr.getZ(i) + v.z * dt);
          v.y -= 16 * dt;
        }
        arr.needsUpdate = true;
        mat.opacity = Math.max(0, 1 - t / dur);
        return t < dur;
      },
      dispose: () => {
        this.scene.remove(points);
        geo.dispose();
        mat.dispose();
      },
    });
  }
}
