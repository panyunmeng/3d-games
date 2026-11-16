/**
 * 棋盘渲染：每个格子 = 岩石块 + 底板 + 铜色数字 + 旗 + 雷，五套对象按状态显隐。
 *
 * 为什么每格保留五套对象而不是动态增删：扫雷的点击频率极高（连锁展开一次几十格），
 * 动态 new/dispose 几何体会让帧时间抖动；480 格 × 少量网格的内存代价远小于重建成本。
 * 材质与几何体全部共享，只有可见性、缩放、贴图索引在变。
 */
import * as THREE from '../vendor/three.module.js';
import { RoundedBoxGeometry } from '../vendor/RoundedBoxGeometry.js';
import { BOARD, PALETTE } from './config.js';
import {
  makeRockTexture,
  makeSoilTexture,
  makeNumberTexture,
  makeScorchTexture,
  makeWrongTexture,
} from './textures.js';
import { Particles } from './particles.js';

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

export class Board {
  constructor(stage) {
    this.stage = stage;
    this.scene = stage.scene;
    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.cols = 0;
    this.rows = 0;
    this.cells = [];
    this.hiddenMeshes = [];
    // 和弦要能点到「已挖开」的数字格：拾取集合必须同时包含岩块与底板
    this.pickMeshes = [];
    this.tweens = [];
    this.timers = [];
    this.hoverIndex = -1;

    this.particles = new Particles(this.scene);

    this.#buildShared();
    this.#buildHover();
  }

  #buildShared() {
    this.textures = [];
    const rockTex = makeRockTexture(9);
    const soilTex = makeSoilTexture(21);
    const scorchTex = makeScorchTexture();
    const wrongTex = makeWrongTexture();
    this.textures.push(rockTex, soilTex, scorchTex, wrongTex);

    this.rockMats = [0xf0e6d6, 0xd8ccb8, 0xc4b6a0, 0xe6dac6].map(
      (color) =>
        new THREE.MeshStandardMaterial({
          map: rockTex,
          color,
          roughness: 0.95,
          metalness: 0.05,
        }),
    );

    this.slabMat = new THREE.MeshStandardMaterial({
      map: soilTex,
      color: 0xd9c3a4,
      roughness: 1,
      metalness: 0,
    });

    this.numberMats = new Array(9).fill(null);
    for (let d = 1; d <= 8; d++) {
      const tex = makeNumberTexture(d);
      this.textures.push(tex);
      this.numberMats[d] = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      });

    }

    this.scorchMat = new THREE.MeshBasicMaterial({
      map: scorchTex,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    this.wrongMat = new THREE.MeshBasicMaterial({
      map: wrongTex,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });

    this.poleMat = new THREE.MeshStandardMaterial({
      color: 0x8a5a28,
      roughness: 0.5,
      metalness: 0.7,
    });
    this.clothMat = new THREE.MeshStandardMaterial({
      color: PALETTE.flagCloth,
      roughness: 0.75,
      metalness: 0.1,
      emissive: 0x571208,
      emissiveIntensity: 0.55,
      side: THREE.DoubleSide,
    });
    this.mineMat = new THREE.MeshStandardMaterial({
      color: 0x24211d,
      roughness: 0.42,
      metalness: 0.75,
      flatShading: true,
    });
    this.mineRingMat = new THREE.MeshStandardMaterial({
      color: 0x8a3a12,
      emissive: 0xff5a12,
      emissiveIntensity: 1.1,
      roughness: 0.6,
      metalness: 0.2,
    });

    // 几何体全部共享：RoundedBox 把原点挪到块底，缩放 y 时是「沉入地下」而不是「向中心塌」
    const blockGeo = new RoundedBoxGeometry(BOARD.block, BOARD.hiddenHeight, BOARD.block, 2, 0.07);
    blockGeo.translate(0, BOARD.hiddenHeight / 2, 0);
    this.hiddenGeo = blockGeo;

    const slabGeo = new THREE.BoxGeometry(BOARD.block, BOARD.slabHeight, BOARD.block);
    slabGeo.translate(0, BOARD.slabHeight / 2, 0);
    this.slabGeo = slabGeo;

    this.numGeo = new THREE.PlaneGeometry(0.92, 0.92);
    this.flatGeo = new THREE.PlaneGeometry(0.95, 0.95);
    this.wrongGeo = new THREE.PlaneGeometry(0.62, 0.62);
    this.poleGeo = new THREE.CylinderGeometry(0.035, 0.045, 0.52, 7);
    this.clothGeo = new THREE.PlaneGeometry(0.34, 0.22);
    this.mineGeo = new THREE.IcosahedronGeometry(0.31, 0);
    this.ringGeo = new THREE.TorusGeometry(0.34, 0.035, 6, 16);
    this.glowGeo = new THREE.SphereGeometry(0.07, 8, 8);

    this.geometries = [
      this.hiddenGeo,
      this.slabGeo,
      this.numGeo,
      this.flatGeo,
      this.wrongGeo,
      this.poleGeo,
      this.clothGeo,
      this.mineGeo,
      this.ringGeo,
      this.glowGeo,
    ];
  }

  #buildHover() {
    this.hoverBox = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, BOARD.hiddenHeight * 1.02, 1.0),
      new THREE.MeshBasicMaterial({
        color: 0xffc37a,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.hoverBox.position.y = BOARD.hiddenHeight / 2;
    this.hoverBox.visible = false;

    this.hoverEdge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.01, BOARD.hiddenHeight + 0.03, 1.01)),
      new THREE.LineBasicMaterial({ color: 0xffcf96, transparent: true, opacity: 0.6 }),
    );
    this.hoverEdge.position.y = BOARD.hiddenHeight / 2;
    this.hoverEdge.visible = false;

    this.group.add(this.hoverBox, this.hoverEdge);
  }

  worldOf(index) {
    const col = index % this.cols;
    const row = (index / this.cols) | 0;
    return {
      x: (col - (this.cols - 1) / 2) * BOARD.pitch,
      z: (row - (this.rows - 1) / 2) * BOARD.pitch,
    };
  }

  build(cols, rows) {
    this.clear();
    this.cols = cols;
    this.rows = rows;
    const n = cols * rows;
    this.cells = new Array(n);

    for (let i = 0; i < n; i++) this.cells[i] = this.#createCell(i);
    this.stage.setBoard(cols, rows);
  }

  #createCell(index) {
    const { x, z } = this.worldOf(index);

    const hidden = new THREE.Mesh(this.hiddenGeo, this.rockMats[(index * 7 + 3) % 4]);
    hidden.position.set(x, 0, z);
    hidden.castShadow = true;
    hidden.receiveShadow = true;
    hidden.userData.index = index;
    this.group.add(hidden);
    this.hiddenMeshes.push(hidden);
    this.pickMeshes.push(hidden);

    const slab = new THREE.Mesh(this.slabGeo, this.slabMat);
    slab.position.set(x, 0, z);
    slab.receiveShadow = true;
    slab.visible = false;
    slab.userData.index = index;
    this.group.add(slab);
    this.pickMeshes.push(slab);

    const num = new THREE.Mesh(this.numGeo, this.numberMats[1]);
    num.position.set(x, BOARD.slabHeight + 0.008, z);
    num.rotation.x = -Math.PI / 2;
    num.visible = false;
    this.group.add(num);

    const flag = new THREE.Group();
    const pole = new THREE.Mesh(this.poleGeo, this.poleMat);
    pole.position.y = 0.26;
    pole.castShadow = true;
    const cloth = new THREE.Mesh(this.clothGeo, this.clothMat);
    cloth.position.set(0.17, 0.44, 0);
    cloth.castShadow = true;
    flag.add(pole, cloth);
    flag.position.set(x, BOARD.hiddenHeight, z);
    flag.visible = false;
    this.group.add(flag);

    const mine = new THREE.Group();
    const body = new THREE.Mesh(this.mineGeo, this.mineMat);
    body.castShadow = true;
    const ring = new THREE.Mesh(this.ringGeo, this.mineRingMat);
    ring.rotation.x = Math.PI / 2;
    const glow = new THREE.Mesh(this.glowGeo, this.mineRingMat);
    glow.position.y = 0.42;
    mine.add(body, ring, glow);
    mine.position.set(x, BOARD.slabHeight, z);
    mine.visible = false;
    this.group.add(mine);



    const wrong = new THREE.Mesh(this.wrongGeo, this.wrongMat);
    wrong.position.set(x, BOARD.hiddenHeight + 0.02, z);
    wrong.rotation.x = -Math.PI / 2;
    wrong.visible = false;
    this.group.add(wrong);

    const scorch = new THREE.Mesh(this.flatGeo, this.scorchMat);
    scorch.position.set(x, BOARD.slabHeight + 0.012, z);
    scorch.rotation.x = -Math.PI / 2;
    scorch.visible = false;
    this.group.add(scorch);

    return {
      index,
      x,
      z,
      hidden,
      slab,
      num,
      numDigit: 0,
      flag,
      mine,
      wrong,
      scorch,
      visual: 'hidden',
      token: 0,
    };
  }

  /** 编号 0 表示不显示数字。数字材质共享，只在数字变化时换一换。 */
  #setNumber(cell, digit) {
    if (cell.numDigit === digit) return;
    cell.numDigit = digit;
    cell.num.material = this.numberMats[digit] || this.numberMats[1];
  }

  /** 把一格的可见性复位成目标形态（动画前的静态底稿）。 */
  #apply(cell, visual, game) {
    cell.hidden.visible = false;
    cell.hidden.scale.set(1, 1, 1);
    cell.slab.visible = false;
    cell.slab.scale.setScalar(1);
    cell.num.visible = false;
    cell.num.scale.setScalar(1);
    cell.flag.visible = false;
    cell.flag.scale.setScalar(1);
    cell.mine.visible = false;
    cell.mine.scale.setScalar(1);
    cell.wrong.visible = false;
    cell.scorch.visible = false;


    switch (visual) {
      case 'hidden':
        cell.hidden.visible = true;
        break;
      case 'flag':
        cell.hidden.visible = true;
        cell.flag.visible = true;
        break;
      case 'wrongflag':
        cell.hidden.visible = true;
        cell.flag.visible = true;
        cell.wrong.visible = true;
        break;
      case 'open':
        cell.hidden.visible = true; // 由下沉动画收掉
        cell.slab.visible = true;
        if (game.adj[cell.index] > 0) {
          cell.num.visible = true;
          this.#setNumber(cell, game.adj[cell.index]);
        }
        break;
      case 'mine':
        cell.slab.visible = true;
        cell.mine.visible = true;
        break;
      case 'exploded':
        cell.slab.visible = true;
        cell.mine.visible = true;
        cell.scorch.visible = true;
        break;
      default:
        cell.hidden.visible = true;
    }
  }

  #tween(dur, update, done, ease = easeOutCubic) {
    this.tweens.push({ t: 0, dur, update, done, ease });
  }

  #later(delay, fn) {
    this.timers.push({ t: 0, delay, fn });
  }

  #transition(cell, visual, game) {
    const prev = cell.visual;
    cell.visual = visual;
    cell.token += 1;
    const token = cell.token;
    const alive = () => cell.token === token;

    this.#apply(cell, visual, game);
    const { x, z } = cell;

    if (visual === 'open') {
      // 岩石块沉入地下
      this.#tween(
        0.2,
        (k) => {
          if (!alive()) return;
          cell.hidden.scale.y = Math.max(0.02, 1 - k);
        },
        () => {
          if (!alive()) return;
          cell.hidden.visible = false;
          cell.hidden.scale.set(1, 1, 1);
        },
      );
      if (game.adj[cell.index] > 0) {
        cell.num.scale.setScalar(0.35);
        this.#tween(0.3, (k) => {
          if (alive()) cell.num.scale.setScalar(0.35 + 0.65 * k);
        }, null, easeOutBack);
      }
      this.#tween(0.24, (k) => {
        if (alive()) cell.slab.scale.setScalar(0.9 + 0.1 * k);
      }, null, easeOutCubic);
      this.particles.spawn(x, BOARD.hiddenHeight * 0.72, z, {
        count: 3,
        color: 0x8f6d4a,
        speed: 0.9,
        rise: 0.7,
        life: 0.42,
        spread: 0.38,
      });
    } else if (visual === 'flag') {
      cell.flag.scale.setScalar(0.01);
      this.#tween(0.26, (k) => {
        if (alive()) cell.flag.scale.setScalar(0.01 + 0.99 * k);
      }, null, easeOutBack);
    } else if (visual === 'wrongflag') {
      cell.flag.scale.setScalar(1);
      cell.wrong.scale.setScalar(0.6);
      this.#tween(0.25, (k) => {
        if (alive()) cell.wrong.scale.setScalar(0.6 + 0.4 * k);
      }, null, easeOutCubic);
    } else if (visual === 'mine' || visual === 'exploded') {
      cell.mine.scale.setScalar(0.2);
      this.#tween(0.3, (k) => {
        if (alive()) cell.mine.scale.setScalar(0.2 + 0.8 * k);
      }, null, easeOutBack);

      if (visual === 'exploded') {
        this.particles.spawn(x, BOARD.slabHeight + 0.35, z, {
          count: 74,
          color: 0xff7a24,
          speed: 5.4,
          rise: 4.2,
          gravity: 9,
          life: 1.15,
          spread: 0.42,
        });
        this.particles.spawn(x, BOARD.slabHeight + 0.3, z, {
          count: 26,
          color: 0xffd08a,
          speed: 2.2,
          rise: 2.6,
          gravity: 4,
          life: 0.8,
          spread: 0.3,
        });
        this.stage.pulse(1);
      }
    } else if (visual === 'hidden') {
      if (prev === 'open') {
        cell.hidden.scale.y = 0.06;
        this.#tween(0.18, (k) => {
          if (alive()) cell.hidden.scale.y = 0.06 + 0.94 * k;
        });
      }
    }
  }

  /** 按规则状态刷新整个棋盘；只在动作发生时调用。 */
  sync(game) {
    let opened = 0;
    for (let i = 0; i < this.cells.length; i++) {
      const cell = this.cells[i];
      const v = game.cellVisual(i);
      if (v !== cell.visual) {
        this.#transition(cell, v, game);
        if (v === 'open') opened += 1;
      }
    }
    // 悬停格可能刚被挖开/插旗，强制重算一次高亮（setHover 对同下标会早退）
    if (this.hoverIndex >= 0) {
      const idx = this.hoverIndex;
      this.hoverIndex = -1;
      this.setHover(idx, game);
    }
    return opened;
  }

  /** 结算后的烟花（分 6 波，错开时间）。 */
  celebrate() {
    const colors = [0xffb066, 0xffd68a, 0xff7a3c, 0xa9d4ff];
    for (let k = 0; k < 6; k++) {
      this.#later(0.12 * k, () => {
        const i = Math.floor(Math.random() * this.cells.length);
        const { x, z } = this.worldOf(i);
        this.particles.spawn(x, 1.4 + Math.random() * 1.6, z, {
          count: 60,
          color: colors[k % colors.length],
          speed: 5.5,
          rise: 3.2,
          gravity: 8,
          life: 1.35,
          spread: 0.35,
        });
      });
    }
  }

  setHover(index, game) {
    if (index === this.hoverIndex) return;
    this.hoverIndex = index;

    const cell = index >= 0 ? this.cells[index] : null;
    const ok =
      cell && !game.isOver && (cell.visual === 'hidden' || cell.visual === 'flag');
    if (!ok) {
      this.hoverBox.visible = false;
      this.hoverEdge.visible = false;
      return;
    }

    this.hoverBox.position.set(cell.x, BOARD.hiddenHeight / 2, cell.z);
    this.hoverEdge.position.set(cell.x, BOARD.hiddenHeight / 2, cell.z);
    this.hoverBox.visible = true;
    this.hoverEdge.visible = true;
  }

  hideHover() {
    this.hoverIndex = -1;
    this.hoverBox.visible = false;
    this.hoverEdge.visible = false;
  }

  /** 射线拾取：岩块与底板都算，返回格子下标，-1 表示没点到。 */
  pick(raycaster) {
    const hits = raycaster.intersectObjects(this.pickMeshes, false);
    for (const hit of hits) {
      if (!hit.object.visible) continue;
      const i = hit.object.userData.index;
      if (this.cells[i]) return i;
    }
    return -1;
  }

  update(dt) {
    this.particles.update(dt);

    for (let k = this.tweens.length - 1; k >= 0; k--) {
      const tw = this.tweens[k];
      tw.t += dt;
      const raw = Math.min(1, tw.t / tw.dur);
      tw.update(tw.ease(raw));
      if (raw >= 1) {
        if (tw.done) tw.done();
        this.tweens.splice(k, 1);
      }
    }

    for (let k = this.timers.length - 1; k >= 0; k--) {
      const tm = this.timers[k];
      tm.t += dt;
      if (tm.t >= tm.delay) {
        tm.fn();
        this.timers.splice(k, 1);
      }
    }
  }

  dispose() {
    this.clear();
    this.particles.dispose();

    for (const geo of this.geometries) geo.dispose();
    for (const mat of this.rockMats) mat.dispose();
    this.slabMat.dispose();
    for (const mat of this.numberMats) if (mat) mat.dispose();
    this.scorchMat.dispose();
    this.wrongMat.dispose();
    this.poleMat.dispose();
    this.clothMat.dispose();
    this.mineMat.dispose();
    this.mineRingMat.dispose();
    for (const tex of this.textures) tex.dispose();

    this.hoverBox.geometry.dispose();
    this.hoverBox.material.dispose();
    this.hoverEdge.geometry.dispose();
    this.hoverEdge.material.dispose();

    this.group.removeFromParent();
  }

  /** 清掉当前棋盘的所有格子对象（换难度 / 重开时用）。 */
  clear() {
    for (const cell of this.cells) {
      for (const obj of [cell.hidden, cell.slab, cell.num, cell.flag, cell.mine, cell.wrong, cell.scorch]) {
        obj.removeFromParent();
      }
    }
    this.cells = [];
    this.hiddenMeshes = [];
    // 和弦要能点到「已挖开」的数字格：拾取集合必须同时包含岩块与底板
    this.pickMeshes = [];
    this.tweens.length = 0;
    this.timers.length = 0;
    this.hoverIndex = -1;
    this.hoverBox.visible = false;
    this.hoverEdge.visible = false;
    this.particles.clear();
  }
}
