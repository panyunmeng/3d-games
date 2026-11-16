import * as THREE from 'three';
import type { EnemyDef, TowerDef, TowerId } from '../data/types';

/** 实体整体放大系数：让单位在这个相机距离下足够大 */
export const ENTITY_SCALE = 1.55;
export const ENEMY_SCALE = 1.9;

export const metal = (color: number, roughness = 0.45): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color, metalness: 0.78, roughness, flatShading: true });

export const glow = (color: number, intensity = 2.4): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({
    color: 0x05070a,
    emissive: color,
    emissiveIntensity: intensity,
    metalness: 0.3,
    roughness: 0.35,
  });

export const ghostGlass = (color: number, opacity = 0.16): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.6,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    metalness: 0.1,
    roughness: 0.2,
  });

export interface TowerVisual {
  group: THREE.Group;
  head: THREE.Group;
  spinner: THREE.Object3D | null;
  accentMats: THREE.MeshStandardMaterial[];
  barrelTip: THREE.Vector3;
}

function towerBase(accent: number, level: number): { base: THREE.Group; accentMats: THREE.MeshStandardMaterial[] } {
  const base = new THREE.Group();
  const bodyMat = metal(0x4a5b70, 0.5);
  const accentMat = glow(accent, 1.4 + level * 0.5);

  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.14, 0.22, 6), bodyMat);
  plinth.position.y = 0.11;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  base.add(plinth);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.02, 0.035, 6, 6), accentMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.23;
  base.add(ring);

  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.62, 0.34, 6), bodyMat);
  column.position.y = 0.38;
  column.castShadow = true;
  base.add(column);

  // 等级指示灯
  for (let i = 0; i < 3; i++) {
    const on = i < level;
    const pip = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.1, 0.36),
      on ? glow(accent, 3) : metal(0x1a2029),
    );
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
    pip.position.set(Math.cos(a) * 0.72, 0.26, Math.sin(a) * 0.72);
    pip.lookAt(0, 0.26, 0);
    base.add(pip);
  }

  return { base, accentMats: [accentMat] };
}

export function buildTower(def: TowerDef, level: number): TowerVisual {
  const { base, accentMats } = towerBase(def.color, level);
  const head = new THREE.Group();
  head.position.y = 0.62;
  base.add(head);

  const bodyMat = metal(0x5c6d84, 0.38);
  const darkMat = metal(0x3a4657, 0.55);
  const accentMat = glow(def.accent, 2.2 + level * 0.6);
  accentMats.push(accentMat);

  let spinner: THREE.Object3D | null = null;
  const barrelTip = new THREE.Vector3(0, 0, 1.4);

  switch (def.id as TowerId) {
    case 'gatling': {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.46, 0.92), bodyMat);
      body.position.z = -0.05;
      body.castShadow = true;
      head.add(body);

      const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.5, 8), darkMat);
      housing.rotation.x = Math.PI / 2;
      housing.position.z = 0.42;
      head.add(housing);

      spinner = new THREE.Group();
      spinner.position.z = 0.42;
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 1.1, 6), metal(0x596878, 0.3));
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(Math.cos(a) * 0.16, Math.sin(a) * 0.16, 0.55);
        barrel.castShadow = true;
        spinner.add(barrel);
      }
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), accentMat);
      tip.position.set(0, 0, 1.12);
      spinner.add(tip);
      head.add(spinner);
      barrelTip.set(0, 0, 1.5);
      break;
    }
    case 'mortar': {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.44, 0.86), bodyMat);
      body.castShadow = true;
      head.add(body);

      const pivot = new THREE.Group();
      pivot.position.set(0, 0.12, 0.1);
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 1.15, 10), darkMat);
      tube.rotation.x = Math.PI / 2.6;
      tube.position.set(0, 0.28, 0.24);
      tube.castShadow = true;
      pivot.add(tube);

      const muzzle = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.05, 6, 10), accentMat);
      muzzle.rotation.x = Math.PI / 2.6;
      muzzle.position.set(0, 0.66, 0.56);
      pivot.add(muzzle);
      head.add(pivot);

      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.18, 8), metal(0x4a3a2a, 0.6));
      drum.rotation.z = Math.PI / 2;
      drum.position.set(0.48, 0.06, -0.2);
      head.add(drum);
      barrelTip.set(0, 0.7, 1.0);
      break;
    }
    case 'tesla': {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.5, 6), bodyMat);
      body.castShadow = true;
      head.add(body);

      const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 1), glow(def.color, 3.2));
      core.position.y = 0.5;
      head.add(core);

      spinner = new THREE.Group();
      spinner.position.y = 0.5;
      const cage = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.52, 0),
        new THREE.MeshBasicMaterial({ color: def.accent, wireframe: true, transparent: true, opacity: 0.65 }),
      );
      spinner.add(cage);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const prong = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.02, 0.55, 5), metal(0x5a6a80, 0.3));
        prong.position.set(Math.cos(a) * 0.36, 0.42, Math.sin(a) * 0.36);
        spinner.add(prong);
      }
      head.add(spinner);
      barrelTip.set(0, 0.9, 0.6);
      break;
    }
    case 'laser': {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.42, 0.9), bodyMat);
      body.castShadow = true;
      head.add(body);

      for (const side of [-1, 1]) {
        const prong = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 0.95), darkMat);
        prong.position.set(side * 0.22, 0.14, 0.42);
        head.add(prong);
      }
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 0.16, 10), accentMat);
      lens.rotation.x = Math.PI / 2;
      lens.position.set(0, 0.14, 0.86);
      head.add(lens);

      const emitter = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), glow(def.color, 3.4));
      emitter.position.set(0, 0.14, 0.94);
      head.add(emitter);
      barrelTip.set(0, 0.14, 1.1);
      break;
    }
  }

  base.scale.setScalar(ENTITY_SCALE);
  return { group: base, head, spinner, accentMats, barrelTip };
}

export interface EnemyVisual {
  group: THREE.Group;
  rotors: THREE.Object3D[];
  shieldMesh: THREE.Mesh | null;
  /** 血条挂点高度 */
  barY: number;
  /** 模型中轴高度（用于悬浮） */
  hover: number;
  coreMats: THREE.MeshStandardMaterial[];
  /** 含 ENTITY_SCALE 的基础缩放 */
  baseScale: number;
}

export function buildEnemy(def: EnemyDef): EnemyVisual {
  const group = new THREE.Group();
  const rotors: THREE.Object3D[] = [];
  let shieldMesh: THREE.Mesh | null = null;

  const bodyMat = new THREE.MeshStandardMaterial({
    color: def.color,
    emissive: def.color,
    emissiveIntensity: 0.18,
    metalness: 0.55,
    roughness: 0.42,
    flatShading: true,
  });
  const accentMat = glow(def.accent, 3.2);
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x2b3240,
    emissive: 0x1b2432,
    emissiveIntensity: 0.5,
    metalness: 0.6,
    roughness: 0.5,
    flatShading: true,
  });
  const coreMats: THREE.MeshStandardMaterial[] = [accentMat];

  switch (def.id) {
    case 'grunt': {
      const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.5), bodyMat);
      torso.position.y = 0.62;
      torso.castShadow = true;
      group.add(torso);

      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.06), accentMat);
      visor.position.set(0, 0.72, 0.26);
      group.add(visor);

      for (const side of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.44, 0.2), darkMat);
        leg.position.set(side * 0.18, 0.22, 0);
        group.add(leg);
        const shoulder = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.28, 0.3), darkMat);
        shoulder.position.set(side * 0.38, 0.64, 0);
        group.add(shoulder);
      }
      break;
    }
    case 'sprinter': {
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.0, 4), bodyMat);
      body.rotation.x = Math.PI / 2;
      body.position.y = 0.5;
      body.castShadow = true;
      group.add(body);

      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.3), accentMat);
      fin.position.set(0, 0.5, -0.25);
      group.add(fin);

      for (const side of [-1, 1]) {
        const wing = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.04, 0.18), darkMat);
        wing.position.set(side * 0.28, 0.5, 0.05);
        wing.rotation.z = side * 0.35;
        group.add(wing);
      }
      break;
    }
    case 'tank': {
      const hull = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.55, 1.5), bodyMat);
      hull.position.y = 0.55;
      hull.castShadow = true;
      group.add(hull);

      const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.4, 8), darkMat);
      turret.position.y = 0.98;
      turret.castShadow = true;
      group.add(turret);

      const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.1, 6), metal(0x39414d, 0.4));
      gun.rotation.x = Math.PI / 2;
      gun.position.set(0, 1.0, 0.75);
      group.add(gun);

      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 0.08), accentMat);
      lamp.position.set(0, 0.86, 0.76);
      group.add(lamp);

      for (const side of [-1, 1]) {
        const track = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.4, 1.6), darkMat);
        track.position.set(side * 0.66, 0.3, 0);
        track.castShadow = true;
        group.add(track);
      }
      break;
    }
    case 'flyer': {
      const body = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), bodyMat);
      body.castShadow = true;
      group.add(body);

      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), accentMat);
      eye.position.set(0, 0, 0.32);
      group.add(eye);

      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.08), darkMat);
        arm.position.set(Math.cos(a) * 0.42, 0.06, Math.sin(a) * 0.42);
        arm.rotation.y = -a;
        group.add(arm);

        const rotor = new THREE.Group();
        rotor.position.set(Math.cos(a) * 0.64, 0.1, Math.sin(a) * 0.64);
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.06), glow(def.accent, 1.4));
        rotor.add(blade);
        const blade2 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.5), glow(def.accent, 1.4));
        rotor.add(blade2);
        group.add(rotor);
        rotors.push(rotor);
      }
      break;
    }
    case 'shield': {
      const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.38, 1), bodyMat);
      core.castShadow = true;
      group.add(core);

      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.1), accentMat);
      eye.position.set(0, 0.06, 0.34);
      group.add(eye);

      shieldMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.95, 2), ghostGlass(def.accent, 0.14));
      shieldMesh.position.y = 0.02;
      group.add(shieldMesh);
      break;
    }
    case 'splitter': {
      const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6, 0), bodyMat);
      core.castShadow = true;
      group.add(core);

      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const pod = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 0), accentMat);
        pod.position.set(Math.cos(a) * 0.62, 0.18 * Math.sin(a * 2), Math.sin(a) * 0.62);
        group.add(pod);
      }
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.05, 6, 12), accentMat);
      ring.rotation.x = Math.PI / 2;
      group.add(ring);
      break;
    }
    case 'gruntlet': {
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.3, 0), bodyMat);
      core.castShadow = true;
      group.add(core);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), accentMat);
      tip.position.set(0, 0, 0.24);
      group.add(tip);
      break;
    }
    case 'boss': {
      const torso = new THREE.Mesh(new THREE.BoxGeometry(1.35, 1.1, 1.0), bodyMat);
      torso.position.y = 1.75;
      torso.castShadow = true;
      group.add(torso);

      const head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.42, 0.5), darkMat);
      head.position.set(0, 2.45, 0.16);
      group.add(head);

      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.06), glow(0xff2e63, 4));
      visor.position.set(0, 2.48, 0.42);
      group.add(visor);

      for (const side of [-1, 1]) {
        const shoulder = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.6, 0.8), darkMat);
        shoulder.position.set(side * 0.95, 2.05, 0);
        shoulder.castShadow = true;
        group.add(shoulder);

        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 1.1, 6), bodyMat);
        arm.position.set(side * 1.05, 1.35, 0.1);
        group.add(arm);

        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.2, 0.5), darkMat);
        leg.position.set(side * 0.42, 0.6, 0);
        leg.castShadow = true;
        group.add(leg);
      }
      const reactor = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 10), glow(0xff2e63, 3));
      reactor.position.set(0, 1.85, 0.52);
      group.add(reactor);
      break;
    }
  }

  const s = def.scale * ENEMY_SCALE;
  group.scale.setScalar(s);
  const barY = (def.id === 'boss' ? 3.4 : def.id === 'tank' ? 1.7 : def.id === 'flyer' ? 1.0 : 1.25) * s;
  const hover = def.flying ? 2.3 : 0;

  return { group, rotors, shieldMesh, barY, hover, coreMats, baseScale: s };
}

export interface BaseVisual {
  group: THREE.Group;
  rings: THREE.Object3D[];
  core: THREE.Mesh;
  coreMat: THREE.MeshStandardMaterial;
}

export function buildBase(accent: number): BaseVisual {
  const group = new THREE.Group();
  const dark = metal(0x222a35, 0.55);
  const accentMat = glow(accent, 2.6);

  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, 0.4, 8), dark);
  plinth.position.y = 0.2;
  plinth.receiveShadow = true;
  plinth.castShadow = true;
  group.add(plinth);

  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.05, 1), glow(accent, 3.2));
  core.position.y = 1.85;
  group.add(core);

  const cage = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.5, 0),
    new THREE.MeshBasicMaterial({ color: accent, wireframe: true, transparent: true, opacity: 0.4 }),
  );
  cage.position.y = 1.85;
  group.add(cage);

  const rings: THREE.Object3D[] = [cage];
  for (let i = 0; i < 2; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.9 + i * 0.45, 0.06, 6, 24), accentMat);
    ring.rotation.x = Math.PI / 2 + i * 0.4;
    ring.position.y = 1.4 + i * 0.6;
    group.add(ring);
    rings.push(ring);
  }

  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.6, 0.28), dark);
    pillar.position.set(Math.cos(a) * 2.0, 0.8, Math.sin(a) * 2.0);
    pillar.castShadow = true;
    group.add(pillar);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), accentMat);
    lamp.position.set(Math.cos(a) * 2.0, 1.65, Math.sin(a) * 2.0);
    group.add(lamp);
  }

  group.scale.setScalar(1.35);
  return { group, rings, core, coreMat: accentMat };
}

/** 场景装饰：货箱、管道、地桩 */
export function buildProps(accent: number, seed: () => number, reject?: (x: number, z: number) => boolean): THREE.Group {
  const group = new THREE.Group();
  const crateMat = metal(0x3a4655, 0.7);
  const stripeMat = glow(accent, 0.9);

  let placed = 0;
  for (let attempt = 0; attempt < 120 && placed < 34; attempt++) {
    const x = (seed() * 2 - 1) * 22;
    const z = (seed() * 2 - 1) * 15;
    const kind = seed();
    if (reject?.(x, z)) continue;
    placed++;
    if (kind < 0.5) {
      const s = 0.6 + seed() * 0.7;
      const crate = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.8, s), crateMat);
      crate.position.set(x, s * 0.4, z);
      crate.rotation.y = seed() * Math.PI;
      crate.castShadow = true;
      crate.receiveShadow = true;
      group.add(crate);
      if (seed() > 0.5) {
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(s * 0.9, 0.05, 0.06), stripeMat);
        stripe.position.set(x, s * 0.7, z + s * 0.51);
        group.add(stripe);
      }
    } else if (kind < 0.8) {
      const h = 1.2 + seed() * 1.6;
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, h, 6), metal(0x33404f, 0.6));
      pipe.position.set(x, h / 2, z);
      pipe.castShadow = true;
      group.add(pipe);
    } else {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5 + seed() * 0.6, 0), metal(0x1f2833, 0.9));
      rock.position.set(x, 0.3, z);
      rock.rotation.set(seed() * 3, seed() * 3, seed() * 3);
      rock.castShadow = true;
      group.add(rock);
    }
  }
  return group;
}
