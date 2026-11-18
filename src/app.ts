import * as THREE from 'three';
import { Sound } from './audio/sound';
import {
  aimStickToFire,
  aimStickToOffset,
  moveStickToMove,
  moveStickToTurn,
  stickDeadzone,
} from './inputMapping';
import { getLevel, LEVEL_COUNT } from './levels';
import { CameraRig } from './render/cameraRig';
import { createWorldScene, type WorldScene } from './render/scene';
import { WorldView } from './render/worldView';
import {
  DIFFICULTIES,
  GRID_H,
  GRID_W,
  SIM_DT,
  cellCenter,
  PLAYER_SPAWN_CELLS,
  type DifficultyId,
  type PowerupKind,
} from './sim/constants';
import { createWorld, nextLevelWorld, playerTank, stepWorld, totalEnemiesLeft } from './sim/world';
import { hasLineOfSight } from './sim/pathfinding';
import { angleDelta } from './sim/collision';
import type { PlayerInput, Tank, World } from './sim/types';
import { loadSave, patchSave, recordResult, type SaveData } from './storage';
import { Ui } from './ui/ui';
import { NetClient } from './net/client';

type Mode = 'menu' | 'playing' | 'paused' | 'levelClear' | 'gameOver' | 'victory' | 'lobby' | 'netPlaying';

const POWERUP_TEXT: Record<PowerupKind, string> = {
  star: '火力提升！',
  grenade: '手雷：全场清空！',
  helmet: '头盔：10 秒无敌',
  shovel: '工兵铲：基地钢墙 20 秒',
};

export class Game {
  private readonly worldScene: WorldScene;
  private readonly view: WorldView;
  private readonly rig: CameraRig;
  private readonly sound = new Sound();
  private readonly ui: Ui;
  private readonly canvas: HTMLCanvasElement;

  private save: SaveData;
  private mode: Mode = 'menu';
  private world: World | null = null;
  private localPlayerId = 'p1';
  private net: NetClient | null = null;
  private netLive = false;

  private readonly keys = new Set<string>();
  private fireHeld = false;
  private turretOffset = 0;
  private pointerLocked = false;
  private wasAlive = true;

  /** 触屏双摇杆状态：只存归一化数值，映射成 PlayerInput 的逻辑与键盘共用 buildInput。 */
  private touchMoveX = 0;
  private touchMoveY = 0;
  private touchAimX = 0;
  private touchAimY = 0;
  private touchFire = false;

  private accumulator = 0;
  private lastFrame = 0;
  private hintTimer = 9;
  private lastHudKey = '';
  private menuTime = 0;
  private readonly params = new URLSearchParams(location.search);
  /** ?demo=1：自动驾驶演示（用于自动化验收与吸引模式），走的是和玩家完全相同的输入链路。 */
  private readonly demo = this.params.has('demo');
  /** ?drive=1：只开自动驾驶、不自动开局（联机同步验证用）。 */
  private readonly autopilot = this.demo || this.params.has('drive');
  private demoLastX = 0;
  private demoLastZ = 0;
  private demoStuck = 0;
  private debugEl: HTMLDivElement | null = null;
  private debugTextEl: HTMLDivElement | null = null;
  private fpsAccum = 0;
  private fpsFrames = 0;
  private fps = 0;
  private readonly debug = this.params.has('debug');
  private readonly startLevelParam = Math.max(1, Math.min(LEVEL_COUNT, Number(this.params.get('level') ?? 1) || 1));

  constructor(private readonly root: HTMLElement) {
    this.save = loadSave();
    this.canvas = document.createElement('canvas');
    root.appendChild(this.canvas);
    this.worldScene = createWorldScene(this.canvas);
    this.view = new WorldView(this.worldScene.scene);
    this.rig = new CameraRig(this.worldScene.camera);

    this.ui = new Ui(root, {
      onStartSolo: () => this.startSolo(),
      onOpenLobby: () => this.openLobby(),
      onCreateRoom: () => this.createRoom(),
      onJoinRoom: (code) => this.joinRoom(code),
      onLeaveLobby: () => this.leaveNet(),
      onResume: () => this.resume(),
      onRestartLevel: () => this.restartLevel(),
      onQuitToMenu: () => this.backToMenu(),
      onNextLevel: () => this.nextLevel(),
      onToggleDifficulty: () => this.toggleDifficulty(),
      onToggleSfx: () => this.toggleSfx(),
      onToggleMusic: () => this.toggleMusic(),
      // 触屏摇杆回调：只记录归一化向量，转 PlayerInput 仍走 buildInput（与键盘同一条路）。
      onTouchMove: (x, y) => {
        const v = stickDeadzone({ x, y });
        this.touchMoveX = v.x;
        this.touchMoveY = v.y;
      },
      onTouchAim: (x, y) => {
        const v = stickDeadzone({ x, y });
        this.touchAimX = v.x;
        this.touchAimY = v.y;
        // 瞄准即开火：推动右摇杆等价于按住左键（同一个 fire 字段，无新输入语义）。
        this.touchFire = aimStickToFire(v);
      },
      onPause: () => this.onEscape(),
      onToggleMute: () => this.toggleMute(),
    });

    this.applyAudioSettings();
    this.bindInput();
    this.showMenuBackdrop();
    this.ui.showMenu(this.save);
    if (this.debug) {
      const el = document.createElement('div');
      el.style.cssText =
        'position:absolute;left:8px;bottom:8px;z-index:99;padding:6px 10px;border-radius:8px;background:rgba(0,0,0,.62);color:#9fe870;font:12px/1.5 Consolas,monospace;white-space:pre;pointer-events:none';
      root.appendChild(el);
      this.debugEl = el;
      const textEl = document.createElement('div');
      el.appendChild(textEl);
      this.debugTextEl = textEl;
      const liveEl = document.createElement('div');
      liveEl.style.color = '#ffd27f';
      el.appendChild(liveEl);
      window.setInterval(() => {
        this.timerFrames += 1;
        liveEl.textContent =
          'rAF ' + this.rafFrames + ' timer ' + this.timerFrames +
          ' vis ' + document.visibilityState + ' focus ' + (document.hasFocus() ? 1 : 0);
      }, 500);
    }
    if (this.demo) {
      // 演示模式跳过菜单直接开打，便于自动化截图验收
      window.setTimeout(() => this.startSolo(), 300);
    }
    const forced = this.params.get('screen');
    if (forced) {
      window.setTimeout(() => this.showForcedScreen(forced), 600);
    }
  }

  start(): void {
    this.lastFrame = performance.now();
    requestAnimationFrame(this.loop);
    // 演示/验收模式：浏览器把隐藏页的 rAF 挂起，这里用定时器兜底推进，
    // 保证「后台标签页里跑自动化截图」也能看到真实演进。普通玩家视角不加这段，切走即停。
    if (this.autopilot) {
      // 隐藏标签页里浏览器把 setInterval 也压到 1 Hz，所以按真实经过时间补齐帧数，
      // 让自动化截图看到的是「实时推进」而不是慢放。
      let clock = performance.now();
      window.setInterval(() => {
        const now = performance.now();
        if (document.visibilityState === 'visible') {
          clock = now;
          return;
        }
        const behind = Math.min(2000, now - clock);
        const frames = Math.max(1, Math.round(behind / 33));
        for (let i = 0; i < frames; i++) {
          clock += 33;
          this.frame(clock);
        }
      }, 100);
    }
  }

  /* ── 主循环 ───────────────────────────────────────────────────── */

  private loop = (now: number): void => {
    try {
      this.frame(now);
    } catch (err) {
      this.reportLoopError(err);
    }
    requestAnimationFrame(this.loop);
  };

  private loopErrors = 0;

  private reportLoopError(err: unknown): void {
    this.loopErrors += 1;
    if (this.loopErrors <= 3) {
      console.error('[tank3d] 主循环异常:', err);
      const box = document.querySelector<HTMLPreElement>('#loop-error');
      if (box) {
        box.style.display = 'block';
        box.textContent += `LOOP ERROR: ${String(err instanceof Error ? err.stack ?? err.message : err)}
`;
      }
    }
  }

  private frame(now: number): void {
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    if (this.mode === 'playing' || this.mode === 'netPlaying') {
      // 右摇杆是一个「相对车体的方向」：右推=车右侧、上推=车前方，和鼠标一样只改
      // turretOffset。相机在车后、屏幕右 = 世界 -x；而 yaw 增大把炮口转向 +x（屏幕左）。
      // 故右推（x>0）对应负的 yaw 偏移：atan2(-x, -y)。y 向上为负→车头正前方偏移 0。
      // 结果仍是 aim = yaw + turretOffset，与键盘/鼠标共用同一字段，仿真层无从分辨来源。
      if (this.touchAimX !== 0 || this.touchAimY !== 0) {
        const offset = aimStickToOffset({ x: this.touchAimX, y: this.touchAimY });
        if (offset !== null) this.turretOffset = wrapAngle(offset);
      }
    }

    if (this.mode === 'playing') {
      if (this.autopilot) this.demoDrive();
      this.stepLocal(dt);
      this.updateHud();
    }
    if (this.netLive) {
      this.net?.update(dt);
      if (this.world) {
        this.view.sync(this.world, dt);
        if (this.mode === 'netPlaying') {
          if (this.autopilot) this.demoDrive();
          this.net?.sendInput(this.buildInput());
          this.updateHud();
        }
        const evts = this.net?.takeEvents() ?? [];
        if (evts.length > 0) {
          this.processEvents(evts);
          this.view.handleEvents(evts);
        }
      }
    } else if (this.mode !== 'playing') {
      this.menuTime += dt;
    }

    if (this.world) {
      const follow = this.mode === 'playing' || this.mode === 'netPlaying' || this.netLive;
      const tank = playerTank(this.world, this.localPlayerId);
      if (follow && tank) {
        this.rig.update(dt, tank.x, tank.z, tank.yaw, this.world.map);
      } else if (follow) {
        this.rig.update(dt, 26, 42, 0, this.world.map);
      } else {
        this.rig.cinematic(this.menuTime);
      }
      this.view.updateAim(
        this.mode === 'playing' || this.mode === 'netPlaying' ? tank ?? null : null,
        this.world.map,
        this.world,
      );
      this.view.update(dt);
      this.updateEngineSound();
    }

    if (this.mode === 'playing' || this.mode === 'netPlaying') {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0 && this.hintTimer > -1) this.ui.setHintFaded();
    }

    if (this.debugEl) this.updateDebug(dt);
    this.worldScene.renderer.render(this.worldScene.scene, this.worldScene.camera);
  }

  private rafFrames = 0;
  private timerFrames = 0;

  private updateDebug(dt: number): void {
    this.rafFrames += 1;
    this.fpsAccum += dt;
    this.fpsFrames += 1;
    if (this.fpsAccum >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsAccum);
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }
    if (!this.debugTextEl) return;
    const w = this.world;
    const tank = w ? playerTank(w, this.localPlayerId) : undefined;
    const cam = this.worldScene.camera.position;
    const dc = this.worldScene.renderer.info.render;
    this.debugTextEl.textContent = [
      `fps ${this.fps}  mode ${this.mode}  phase ${w?.phase ?? '-'}`,
      `tank ${tank ? `${tank.x.toFixed(1)},${tank.z.toFixed(1)} alive=${tank.alive} yaw=${tank.yaw.toFixed(2)} tur=${tank.turretYaw.toFixed(2)}` : 'none'}`,
      `cam ${cam.x.toFixed(1)},${cam.y.toFixed(1)},${cam.z.toFixed(1)} rigYaw ${this.rig.debugState().yaw.toFixed(2)} calls ${dc.calls}`,
      `tanks ${w?.tanks.length ?? 0} bullets ${w?.bullets.length ?? 0} powers ${w?.powerups.length ?? 0}`,
      `auto ${this.autopilot ? 1 : 0} keys ${[...this.keys].join('/')} fire ${this.fireHeld ? 1 : 0} netLive ${this.netLive ? 1 : 0}`,
      `net sent ${this.net?.sentInputs ?? -1} srvLeft ${this.net?.enemiesLeft ?? -1} last ${JSON.stringify(this.net?.lastInput ?? null)}`,
      `players ${w ? w.tanks.filter((t) => t.kind === 'player').map((t) => `${t.playerId}@${t.x.toFixed(1)},${t.z.toFixed(1)}${t.alive ? '' : '(dead)'}`).join(' ') : '-'}`,
      `rig tgt ${this.rig.debugState().targetYaw.toFixed(2)} upd ${this.rig.debugState().count} dist ${this.rig.debugState().dist.toFixed(1)}`,
    ].join(String.fromCharCode(10));
  }

  private stepLocal(dt: number): void {
    const world = this.world;
    if (!world) return;
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= SIM_DT && steps < 5) {
      const input = this.buildInput();
      stepWorld(world, { [this.localPlayerId]: input }, SIM_DT);
      this.processEvents(world.events);
      this.view.handleEvents(world.events);
      this.accumulator -= SIM_DT;
      steps += 1;
    }
    if (steps === 5) this.accumulator = 0;
    this.view.sync(world, dt);
    this.checkTransitions();
  }

  private checkTransitions(): void {
    const world = this.world;
    if (!world) return;
    if (world.phase === 'levelClear' && this.mode === 'playing') {
      this.mode = 'levelClear';
      this.fireHeld = false;
      this.exitPointerLock();
      this.sound.levelClear();
      const score = this.maxScore();
      if (world.level >= LEVEL_COUNT) {
        this.mode = 'victory';
        this.save = recordResult(score, world.level, true);
        this.ui.showVictory(score, this.save);
      } else {
        this.ui.showLevelClear(world.level, score, false);
      }
    } else if (world.phase === 'gameOver' && this.mode === 'playing') {
      const reason = world.base.alive ? 'lives' : 'base';
      this.mode = 'gameOver';
      this.fireHeld = false;
      this.exitPointerLock();
      this.sound.gameOver();
      this.save = recordResult(this.maxScore(), world.level, false);
      this.ui.showGameOver(reason, this.maxScore(), world.level, this.save);
    }
  }

  private maxScore(): number {
    if (!this.world) return 0;
    return this.world.playerOrder.reduce((s, id) => Math.max(s, this.world!.players[id].score), 0);
  }

  private processEvents(events: readonly import('./sim/types').SimEvent[]): void {
    for (const ev of events) {
      switch (ev.type) {
        case 'shoot':
          this.sound.shot(ev.team);
          break;
        case 'explode':
          this.sound.explosion(ev.big);
          break;
        case 'steelBreak':
          this.sound.clank();
          break;
        case 'powerupPickup':
          this.sound.pickup();
          this.ui.toast(POWERUP_TEXT[ev.kind]);
          break;
        case 'levelClear':
          this.save = patchSave({ maxLevel: Math.max(this.save.maxLevel, ev.level) });
          break;
        case 'gameOver':
          break;
        case 'baseHit':
          this.ui.toast('基地受到攻击！');
          break;
        case 'playerDown': {
          const left = ev.lives;
          this.ui.toast(left > 0 ? `坦克被击毁，还剩 ${left} 条命` : '最后一辆坦克被击毁');
          break;
        }
        default:
          break;
      }
    }
  }

  private updateHud(): void {
    const world = this.world;
    if (!world) return;
    const slot = world.players[this.localPlayerId];
    if (!slot) return;
    const tank = playerTank(world, this.localPlayerId);
    const key = `${slot.lives}|${slot.score}|${slot.power}|${world.level}|${totalEnemiesLeft(world)}|${world.base.hp}`;
    if (key === this.lastHudKey) return;
    this.lastHudKey = key;
    this.ui.updateHud({
      level: world.level,
      lives: slot.lives,
      power: tank?.power ?? slot.power,
      score: slot.score,
      best: Math.max(this.save.highScore, slot.score),
      enemiesLeft: this.netLive ? (this.net?.enemiesLeft ?? 0) : totalEnemiesLeft(world),
      hint: this.ui.isTouchMode()
        ? '左摇杆移动 · 右摇杆瞄准开火 · 右上角暂停'
        : 'WASD 移动 · 鼠标转炮塔 · 左键开火 · 滚轮缩放 · Esc 暂停',
    });
  }

  private updateEngineSound(): void {
    const world = this.world;
    if (!world) return;
    const tank = playerTank(world, this.localPlayerId);
    const playing = this.mode === 'playing' || this.mode === 'netPlaying';
    if (!tank || !tank.alive || !playing) {
      this.sound.setEngine(0, false);
      return;
    }
    const moving = this.keys.has('KeyW') || this.keys.has('KeyS');
    this.sound.setEngine(moving ? 1 : 0.25, true);
  }

  /* ── 输入 ─────────────────────────────────────────────────────── */

  private bindInput(): void {
    // 首次真实触摸才切到触屏模式：桌面（哪怕有触摸屏）不显示摇杆，避免退化。
    // 用 once 的 pointerdown（pointerType=touch）作为触发，比媒体查询更可靠。
    window.addEventListener(
      'pointerdown',
      (ev) => {
        if (ev.pointerType === 'touch') this.enableTouchMode();
      },
      { once: false },
    );

    window.addEventListener('keydown', (ev) => {
      const target = ev.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      this.keys.add(ev.code);
      if (ev.code === 'Escape') {
        this.onEscape();
        return;
      }
      if (ev.code === 'KeyM') {
        this.toggleMute();
        return;
      }
      // 规范 §二：P 与 Esc 都能暂停 / 继续
      if (ev.code === 'KeyP') {
        this.onEscape();
        return;
      }
      // 规范 §二：R 重开本局（联机局不重开——那会打断队友）
      if (ev.code === 'KeyR') {
        if (this.mode === 'playing') {
          ev.preventDefault();
          this.restartLevel();
        }
        return;
      }
      if (ev.code === 'Space' || ev.code.startsWith('Arrow')) ev.preventDefault();
    });
    window.addEventListener('keyup', (ev) => {
      this.keys.delete(ev.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.fireHeld = false;
    });

    this.canvas.addEventListener('mousedown', (ev) => {
      if (ev.button === 0) {
        this.fireHeld = true;
        if ((this.mode === 'playing' || this.mode === 'netPlaying') && !this.pointerLocked) {
          this.requestPointerLock();
        }
      }
    });
    window.addEventListener('mouseup', (ev) => {
      if (ev.button === 0) this.fireHeld = false;
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      this.ui.setPointerLocked(this.pointerLocked);
    });
    window.addEventListener('mousemove', (ev) => {
      if (this.mode !== 'playing' && this.mode !== 'netPlaying') return;
      // 锁定时用 movementX 做无限转塔；未锁定时同样可用（光标会碰到屏幕边缘，属可接受的降级）
      const dx = ev.movementX ?? 0;
      if (dx === 0) return;
      this.turretOffset = wrapAngle(this.turretOffset + dx * 0.0026);
    });
    this.canvas.addEventListener(
      'wheel',
      (ev) => {
        if (this.mode !== 'playing' && this.mode !== 'netPlaying') return;
        ev.preventDefault();
        this.rig.zoom(ev.deltaY);
      },
      { passive: false },
    );
    this.canvas.addEventListener('click', () => {
      if ((this.mode === 'playing' || this.mode === 'netPlaying') && !this.pointerLocked) {
        this.requestPointerLock();
      }
    });
  }

  private buildInput(): PlayerInput {
    // 键盘的 W/S 与左摇杆的 Y（上为负）映射成同一个 move 字段；取绝对值大者，
    // 两种输入同时存在时也不会互相抵消。语义与键盘完全一致，仿真层无从分辨来源。
    const keyForward = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const touchForward = moveStickToMove(this.touchMoveY);
    const forward = Math.abs(touchForward) > Math.abs(keyForward) ? touchForward : keyForward;
    // A 左转 = yaw 增大（相机在车后，+yaw 把车头转向屏幕左侧）。
    // 左摇杆 X（右为正）经 moveStickToTurn 映射：右推 turn=-1（顺时针/车头向右），与按 D 一致。
    const keyTurn = (this.keys.has('KeyA') ? 1 : 0) - (this.keys.has('KeyD') ? 1 : 0);
    const touchTurn = moveStickToTurn(this.touchMoveX);
    const turn = Math.abs(touchTurn) > Math.abs(keyTurn) ? touchTurn : keyTurn;
    const tank = this.world ? playerTank(this.world, this.localPlayerId) : undefined;
    if (tank && tank.alive !== this.wasAlive) {
      this.wasAlive = tank.alive;
      if (tank.alive) this.turretOffset = 0;
    }
    const aim = tank ? wrapAngle(tank.yaw + this.turretOffset) : null;
    // fire：鼠标左键 与 右摇杆推动 共用同一字段，无「触屏专用」语义。
    return { move: forward, turn, aim, fire: this.fireHeld || this.touchFire };
  }

  /** 演示自驾：找最近敌人，有视线就瞄准开火，没视线就开车去找。 */
  private demoDrive(): void {
    const world = this.world;
    if (!world) return;
    const tank = playerTank(world, this.localPlayerId);
    if (!tank || !tank.alive) {
      this.keys.clear();
      this.fireHeld = false;
      return;
    }
    let target: Tank | null = null;
    let best = Infinity;
    for (const t of world.tanks) {
      if (t.kind !== 'enemy' || !t.alive) continue;
      const d = Math.hypot(t.x - tank.x, t.z - tank.z);
      if (d < best) {
        best = d;
        target = t;
      }
    }

    let desiredYaw = Math.PI;
    let fire = false;
    if (target) {
      const dx = target.x - tank.x;
      const dz = target.z - tank.z;
      const los = hasLineOfSight(world.map, tank.x, tank.z, target.x, target.z);
      const aimYaw = Math.atan2(dx, dz);
      if (los && best < 30) {
        this.turretOffset = wrapAngle(aimYaw - tank.yaw);
        fire = true;
        if (best > 13) desiredYaw = aimYaw;
        else if (best < 7) desiredYaw = aimYaw + Math.PI;
        else desiredYaw = tank.yaw;
      } else {
        this.turretOffset = 0;
        desiredYaw = aimYaw;
      }
    } else {
      this.turretOffset = 0;
    }

    const delta = angleDelta(tank.yaw, desiredYaw);
    this.keys.delete('KeyA');
    this.keys.delete('KeyD');
    this.keys.add('KeyW');
    if (delta > 0.16) this.keys.add('KeyA');
    else if (delta < -0.16) this.keys.add('KeyD');

    // 卡住（撞钢墙/被围）时朝车头开炮，并稍微转向找路
    const moved = Math.hypot(tank.x - this.demoLastX, tank.z - this.demoLastZ);
    this.demoLastX = tank.x;
    this.demoLastZ = tank.z;
    if (moved < 0.06) this.demoStuck += 1 / 60;
    else this.demoStuck = Math.max(0, this.demoStuck - 0.05);
    if (this.demoStuck > 1.0) {
      this.turretOffset = 0;
      fire = true;
      if (this.demoStuck > 2.2) {
        this.keys.add('KeyD');
        this.demoStuck = 1.2;
      }
    }
    this.fireHeld = fire;
  }

  /** 调试用：?screen=pause|levelclear|gameover|victory 直接展示对应界面。 */
  private showForcedScreen(kind: string): void {
    const score = 4200;
    this.ui.setHudVisible(kind === 'pause');
    if (kind === 'pause') this.ui.showPause();
    else if (kind === 'levelclear') this.ui.showLevelClear(4, score, false);
    else if (kind === 'gameover') this.ui.showGameOver('base', score, 4, this.save);
    else if (kind === 'victory') this.ui.showVictory(score, this.save);
    else if (kind === 'lobby') {
      this.mode = 'lobby';
      this.ui.showLobby();
    }
  }

  private requestPointerLock(): void {
    // 触屏下绝不请求指针锁定：手机上会失败，还可能吞掉后续 pointer 事件，导致摇杆失灵。
    if (this.ui.isTouchMode()) return;
    // 指针锁定在嵌入式/无焦点窗口里会抛 WrongDocumentError 或返回被拒绝的 Promise；
    // 这里必须吃掉异常——它曾经把 requestAnimationFrame 主循环直接打断。
    try {
      const result = this.canvas.requestPointerLock?.() as unknown;
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch(() => undefined);
      }
    } catch {
      // 没有指针锁定也能用鼠标移动瞄准（movementX 不依赖锁定）
    }
  }

  private exitPointerLock(): void {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock?.();
  }

  /** 首次触摸切换到触屏布局：显示摇杆、退出可能已锁定的鼠标、刷新提示。 */
  private enableTouchMode(): void {
    if (this.ui.isTouchMode()) return;
    this.ui.setTouchMode(true);
    this.exitPointerLock();
    this.ui.setPointerLocked(false);
  }

  /* ── 模式切换 ─────────────────────────────────────────────────── */

  private showMenuBackdrop(): void {
    const world = createWorld({
      levelDef: getLevel(1),
      level: 1,
      difficulty: this.save.difficulty,
      mode: 'solo',
      playerIds: ['p1'],
      seed: 20260101,
    });
    this.world = world;
    this.view.setWorld(world);
    this.ui.setHudVisible(false);
  }

  private startSolo(): void {
    this.sound.unlock();
    this.leaveNet();
    const level = this.demo ? this.startLevelParam : 1;
    this.world = createWorld({
      levelDef: getLevel(level),
      level,
      difficulty: this.save.difficulty,
      mode: 'solo',
      playerIds: ['p1'],
      seed: (Date.now() & 0xffffffff) >>> 0,
    });
    this.applyWorld();
    this.mode = 'playing';
    this.hintTimer = 9;
    this.save = patchSave({});
  }

  private applyWorld(): void {
    if (!this.world) return;
    this.view.setWorld(this.world);
    this.ui.hideScreen();
    this.ui.setHudVisible(true);
    this.localPlayerId = this.world.playerOrder[0];
    this.turretOffset = 0;
    this.accumulator = 0;
    this.wasAlive = true;
    this.lastHudKey = '';
    const spawn = PLAYER_SPAWN_CELLS[0];
    const p = cellCenter(spawn.cx, spawn.cz);
    this.rig.snapTo(p.x, p.z, Math.PI);
    this.requestPointerLock();
  }

  private resume(): void {
    if (this.mode !== 'paused') return;
    this.mode = this.netLive ? 'netPlaying' : 'playing';
    this.ui.hideScreen();
    this.ui.setHudVisible(true);
    this.requestPointerLock();
  }

  private onEscape(): void {
    if (this.mode === 'netPlaying') {
      this.mode = 'paused';
      this.fireHeld = false;
      this.exitPointerLock();
      this.ui.showPause();
      return;
    }
    if (this.mode === 'playing') {
      this.mode = 'paused';
      this.fireHeld = false;
      this.exitPointerLock();
      this.ui.showPause();
    } else if (this.mode === 'paused') {
      this.resume();
    }
  }

  private restartLevel(): void {
    if (!this.world) return;
    const level = this.world.level;
    const difficulty = this.world.difficulty;
    this.sound.unlock();
    this.leaveNet();
    this.world = createWorld({
      levelDef: getLevel(level),
      level,
      difficulty,
      mode: 'solo',
      playerIds: ['p1'],
      seed: (Date.now() & 0xffffffff) >>> 0,
    });
    this.applyWorld();
    this.mode = 'playing';
  }

  private nextLevel(): void {
    if (!this.world) return;
    const completed = this.world.level;
    if (completed >= LEVEL_COUNT) {
      const score = this.maxScore();
      this.save = recordResult(score, completed, true);
      this.mode = 'victory';
      this.ui.showVictory(score, this.save);
      return;
    }
    if (this.net && this.mode === 'levelClear') {
      this.net.requestNextLevel();
      return;
    }
    this.world = nextLevelWorld(this.world, getLevel(completed + 1), completed + 1);
    this.applyWorld();
    this.mode = 'playing';
  }

  private backToMenu(): void {
    this.leaveNet();
    this.mode = 'menu';
    this.exitPointerLock();
    this.fireHeld = false;
    this.showMenuBackdrop();
    this.applyAudioSettings();
    this.ui.setHudVisible(false);
    this.ui.showMenu(this.save);
    this.rig.cinematic(0);
  }

  /* ── 设置 ─────────────────────────────────────────────────────── */

  private toggleDifficulty(): void {
    const next: DifficultyId = this.save.difficulty === 'classic' ? 'casual' : 'classic';
    this.save = patchSave({ difficulty: next });
    this.ui.showMenu(this.save);
  }

  private toggleSfx(): void {
    this.save = patchSave({ sfx: !this.save.sfx });
    this.applyAudioSettings();
    this.ui.showMenu(this.save);
  }

  private toggleMusic(): void {
    this.save = patchSave({ music: !this.save.music });
    this.applyAudioSettings();
    this.ui.showMenu(this.save);
  }

  private toggleMute(): void {
    this.save = patchSave({ sfx: !this.save.sfx });
    this.applyAudioSettings();
    this.ui.toast(this.save.sfx ? '音效已开启' : '音效已静音');
  }

  private applyAudioSettings(): void {
    this.sound.setSfxEnabled(this.save.sfx);
    this.sound.setMusicEnabled(this.save.music);
    this.sound.setVolume(this.save.volume);
    this.ui.syncMuteButton(this.save.sfx);
  }

  /* ── 联机 ─────────────────────────────────────────────────────── */

  private openLobby(): void {
    this.sound.unlock();
    this.mode = 'lobby';
    this.ui.setHudVisible(false);
    this.ui.showLobby();
    if (!this.net) this.net = this.createNetClient();
    this.net.connect();
  }

  private createNetClient(): NetClient {
    return new NetClient({
      onStatus: (text, kind) => this.ui.setLobbyStatus(text, kind),
      onRoom: (code) => {
        this.ui.setRoomCode(code);
      },
      onPeerJoined: () => this.ui.setLobbyStatus('队友已加入，准备战斗！', 'ok'),
      onStart: (payload) => {
        this.world = payload.world;
        this.localPlayerId = payload.playerId;
        this.view.setWorld(this.world);
        this.mode = 'netPlaying';
        this.netLive = true;
        this.ui.hideScreen();
        this.ui.setHudVisible(true);
        this.hintTimer = 9;
        this.requestPointerLock();
      },
      onSnapshot: () => {
        // 快照已经由 NetClient 写进 world；这里不需要做别的，
        // 渲染层每帧 sync 时会自己对比地形差异。
      },
      onPhase: (phase, payload) => {
        if (phase === 'levelClear') {
          this.mode = 'levelClear';
          this.exitPointerLock();
          this.ui.showLevelClear(payload.level, payload.score, payload.level >= LEVEL_COUNT);
        } else if (phase === 'gameOver') {
          this.mode = 'gameOver';
          this.exitPointerLock();
          this.save = recordResult(payload.score, payload.level, false);
          this.ui.showGameOver(payload.reason, payload.score, payload.level, this.save);
        } else if (phase === 'victory') {
          this.mode = 'victory';
          this.exitPointerLock();
          this.save = recordResult(payload.score, 10, true);
          this.ui.showVictory(payload.score, this.save);
        }
      },
      onShareWorld: (world) => {
        this.world = world;
        this.view.setWorld(world);
        // 队友点了「下一关」后服务器下发新关卡：本机也要退出结算界面回到战斗
        if (this.mode === 'levelClear' && this.netLive) {
          this.mode = 'netPlaying';
          this.ui.hideScreen();
          this.ui.setHudVisible(true);
          this.turretOffset = 0;
          this.hintTimer = 9;
        }
      },
      onError: (msg) => this.ui.setLobbyStatus(msg, 'error'),
      onClosed: () => {
        if (this.mode === 'netPlaying' || this.mode === 'lobby') {
          this.ui.setHudVisible(false);
          this.ui.showNetStatus('连接已断开', '队友离开或服务器关闭，可返回主菜单再开一局。');
          this.mode = 'lobby';
        }
      },
    });
  }

  private createRoom(): void {
    this.sound.unlock();
    if (!this.net) this.net = this.createNetClient();
    this.net.createRoom(this.save.difficulty);
  }

  private joinRoom(code: string): void {
    this.sound.unlock();
    if (!this.net) this.net = this.createNetClient();
    this.net.joinRoom(code);
  }

  private leaveNet(): void {
    this.net?.close();
    this.net = null;
    this.netLive = false;
  }

  /** 提供给 NetClient 在帧循环里读取当前输入。 */
  currentInput(): PlayerInput {
    return this.buildInput();
  }
}

function wrapAngle(a: number): number {
  let x = a % (Math.PI * 2);
  if (x > Math.PI) x -= Math.PI * 2;
  if (x < -Math.PI) x += Math.PI * 2;
  return x;
}

export function boot(root: HTMLElement): Game {
  const game = new Game(root);
  game.start();
  return game;
}

/** 常量导出给测试与调试使用。 */
export const GRID_SIZE = { w: GRID_W, h: GRID_H };
export const DIFFICULTY_TABLE = DIFFICULTIES;
export const THREE_NS = THREE;
