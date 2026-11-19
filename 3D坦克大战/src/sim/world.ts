import {
  BASE_CENTER,
  BASE_CELLS,
  BODY_TURN_SPEED,
  BULLET_RADIUS,
  BULLET_SUBSTEP,
  DIFFICULTIES,
  ENEMY_KINDS,
  ENEMY_SPAWN_CELLS,
  ENEMY_SPAWN_INTERVAL,
  HELMET_DURATION,
  MAX_ALIVE_ENEMIES,
  MAX_POWER_LEVEL,
  PLAYER_BULLET_SPEED,
  PLAYER_FIRE_CD_BY_POWER,
  PLAYER_MAX_BULLETS,
  PLAYER_REVERSE,
  PLAYER_SPAWN_CELLS,
  PLAYER_SPEED,
  POWERUP_DROP_EVERY,
  POWERUP_KINDS,
  POWERUP_LIFETIME,
  POWERUP_PICK_SCORE,
  RESPAWN_DELAY,
  SCORE_LEVEL_CLEAR,
  SHOVEL_DURATION,
  SPAWN_CLEAR_RADIUS,
  SPAWN_INVULN,
  STEEL_BREAK_POWER,
  TANK_SHOVE_RADIUS,
  TILE,
  TILE_BRICK,
  TILE_EMPTY,
  TILE_STEEL,
  TURRET_TURN_SPEED,
  WORLD_H,
  WORLD_W,
  cellCenter,
  toCell,
  type DifficultyId,
  type EnemyKind,
  type PowerupKind,
} from './constants';
import { angleDelta, hitsBase, moveTank, turnToward } from './collision';
import {
  buildEnemyQueue,
  inBounds,
  parseLevel,
  setBaseWallSteel,
  setTile,
  tileAt,
  type LevelDef,
} from './map';
import { findPath, hasLineOfSight, cellToWorld } from './pathfinding';
import { mulberry32, randInt, randRange } from './rng';
import type {
  AIState,
  Bullet,
  PlayerInput,
  PlayerSlot,
  SimEvent,
  Tank,
  World,
} from './types';

export interface CreateWorldOptions {
  levelDef: LevelDef;
  level: number;
  difficulty: DifficultyId;
  mode: 'solo' | 'coop';
  playerIds: string[];
  playerNames?: Record<string, string>;
  seed?: number;
}

const SPAWN_YAW = Math.PI; // 玩家出生朝向上方（-z）

function makeAI(): AIState {
  return {
    state: 'advance',
    repathTimer: 0,
    path: [],
    pathIndex: 0,
    targetTankId: null,
    aimTimer: 0,
    stuckTimer: 0,
    lastX: 0,
    lastZ: 0,
  };
}

function newTank(w: World, base: Omit<Tank, 'id'>): Tank {
  const tank: Tank = { ...base, id: w.nextId++ };
  w.tanks.push(tank);
  return tank;
}

function createPlayerTank(w: World, playerId: string, slotIndex: number): Tank {
  const spawn = PLAYER_SPAWN_CELLS[slotIndex % PLAYER_SPAWN_CELLS.length];
  const pos = cellCenter(spawn.cx, spawn.cz);
  const tank = newTank(w, {
    kind: 'player',
    playerId,
    name: w.players[playerId].name,
    x: pos.x,
    z: pos.z,
    yaw: SPAWN_YAW,
    turretYaw: SPAWN_YAW,
    hp: 1,
    maxHp: 1,
    alive: true,
    respawnAt: 0,
    invulnUntil: w.time + SPAWN_INVULN,
    fireCd: 0,
    power: 1,
    speed: PLAYER_SPEED,
    bulletSpeed: PLAYER_BULLET_SPEED,
  });
  w.players[playerId].tankId = tank.id;
  return tank;
}

export function createWorld(opts: CreateWorldOptions): World {
  const cfg = DIFFICULTIES[opts.difficulty];
  const seed = opts.seed ?? Math.floor(Math.random() * 0xffffffff);
  const map = parseLevel(opts.levelDef);
  const w: World = {
    tick: 0,
    time: 0,
    rng: mulberry32(seed),
    seed,
    level: opts.level,
    difficulty: opts.difficulty,
    mode: opts.mode,
    map,
    tanks: [],
    bullets: [],
    powerups: [],
    base: { hp: cfg.baseHp, maxHp: cfg.baseHp, alive: true, repairsLeft: cfg.baseRepairs },
    players: {},
    playerOrder: [...opts.playerIds],
    enemyQueue: buildEnemyQueue(cfg.enemiesPerLevel, opts.levelDef.mix),
    enemiesKilled: 0,
    enemySpawnTimer: 1.0,
    phase: 'playing',
    nextId: 1,
    shovelUntil: 0,
    events: [],
    killCounter: 0,
  };

  for (const playerId of opts.playerIds) {
    w.players[playerId] = {
      id: playerId,
      name: opts.playerNames?.[playerId] ?? playerId,
      lives: cfg.playerLives,
      score: 0,
      power: 1,
      tankId: 0,
      alive: true,
    };
  }
  opts.playerIds.forEach((id, i) => createPlayerTank(w, id, i));
  return w;
}

/** 进入下一关：保留玩家命数/分数/火力，重置地图与波次。 */
export function nextLevelWorld(prev: World, levelDef: LevelDef, level: number): World {
  const cfg = DIFFICULTIES[prev.difficulty];
  const map = parseLevel(levelDef);
  const w: World = {
    ...prev,
    tick: 0,
    time: 0,
    rng: mulberry32((prev.seed + level * 7919) >>> 0),
    seed: (prev.seed + level * 7919) >>> 0,
    level,
    map,
    tanks: [],
    bullets: [],
    powerups: [],
    base: { hp: cfg.baseHp, maxHp: cfg.baseHp, alive: true, repairsLeft: cfg.baseRepairs },
    players: {},
    enemyQueue: buildEnemyQueue(cfg.enemiesPerLevel, levelDef.mix),
    enemiesKilled: 0,
    enemySpawnTimer: 1.0,
    phase: 'playing',
    nextId: prev.nextId,
    shovelUntil: 0,
    events: [],
    killCounter: 0,
  };
  for (const id of prev.playerOrder) {
    const old = prev.players[id];
    w.players[id] = {
      id,
      name: old.name,
      lives: old.lives,
      score: old.score,
      power: old.power,
      tankId: 0,
      alive: true,
    };
  }
  prev.playerOrder.forEach((id, i) => createPlayerTank(w, id, i));
  return w;
}

export function playerTank(w: World, playerId: string): Tank | undefined {
  return w.tanks.find((t) => t.kind === 'player' && t.playerId === playerId);
}

export function enemyTanks(w: World): Tank[] {
  return w.tanks.filter((t) => t.kind === 'enemy' && t.alive);
}

export function alivePlayers(w: World): PlayerSlot[] {
  return w.playerOrder.map((id) => w.players[id]).filter((p) => p.alive);
}

function liveBulletsOf(w: World, playerId: string): number {
  let n = 0;
  for (const b of w.bullets) if (b.alive && b.playerId === playerId) n++;
  return n;
}

function spawnBullet(
  w: World,
  tank: Tank,
  yaw: number,
  team: 'player' | 'enemy',
  power: number,
  speed: number,
): void {
  const muzzle = 1.9;
  const bullet: Bullet = {
    id: w.nextId++,
    ownerTankId: tank.id,
    team,
    playerId: tank.playerId,
    x: tank.x + Math.sin(yaw) * muzzle,
    z: tank.z + Math.cos(yaw) * muzzle,
    yaw,
    speed,
    power,
    alive: true,
  };
  // 炮口贴墙时子弹会生在墙里：向前推进到第一个非阻挡位置。
  for (let i = 0; i < 6; i++) {
    const cx = Math.floor(bullet.x / TILE);
    const cz = Math.floor(bullet.z / TILE);
    if (!inBounds(cx, cz)) {
      bullet.alive = false;
      break;
    }
    const t = tileAt(w.map, cx, cz);
    if (t !== TILE_BRICK && t !== TILE_STEEL) break;
    bullet.x += Math.sin(yaw) * 0.25;
    bullet.z += Math.cos(yaw) * 0.25;
  }
  if (!bullet.alive) return;
  w.bullets.push(bullet);
  w.events.push({ type: 'shoot', x: bullet.x, z: bullet.z, yaw, team, power });
}

function destroyTileAt(w: World, cx: number, cz: number, big: boolean): void {
  const t = tileAt(w.map, cx, cz);
  if (t === TILE_BRICK) {
    setTile(w.map, cx, cz, TILE_EMPTY);
    w.events.push({ type: 'brickBreak', x: (cx + 0.5) * TILE, z: (cz + 0.5) * TILE });
    if (big) w.events.push({ type: 'explode', x: (cx + 0.5) * TILE, z: (cz + 0.5) * TILE, big: false });
  } else if (t === TILE_STEEL) {
    setTile(w.map, cx, cz, TILE_EMPTY);
    w.events.push({ type: 'steelBreak', x: (cx + 0.5) * TILE, z: (cz + 0.5) * TILE });
  }
}

function dropPowerup(w: World, x: number, z: number): void {
  // 在死亡点附近找一块空地放道具（最多试 12 次）。
  for (let i = 0; i < 12; i++) {
    const cx = Math.floor(x / TILE) + randInt(w.rng, 5) - 2;
    const cz = Math.floor(z / TILE) + randInt(w.rng, 5) - 2;
    if (!inBounds(cx, cz)) continue;
    const t = tileAt(w.map, cx, cz);
    if (t === TILE_BRICK || t === TILE_STEEL) continue;
    const pos = cellCenter(cx, cz);
    const kind = POWERUP_KINDS[randInt(w.rng, POWERUP_KINDS.length)];
    w.powerups.push({ id: w.nextId++, kind, x: pos.x, z: pos.z, until: w.time + POWERUP_LIFETIME });
    w.events.push({ type: 'powerupSpawn', kind, x: pos.x, z: pos.z });
    return;
  }
}

function bestPlayerScore(w: World, playerId: string | undefined, points: number): void {
  if (playerId && w.players[playerId]) w.players[playerId].score += points;
  else if (w.playerOrder.length > 0) w.players[w.playerOrder[0]].score += points;
}

function killEnemy(w: World, tank: Tank, byPlayerId: string | undefined): void {
  if (!tank.alive) return;
  tank.alive = false;
  tank.hp = 0;
  const kind = tank.enemyKind ?? 'normal';
  bestPlayerScore(w, byPlayerId, ENEMY_KINDS[kind].score);
  w.enemiesKilled++;
  w.killCounter++;
  w.events.push({ type: 'enemyDown', enemyKind: kind, x: tank.x, z: tank.z });
  w.events.push({ type: 'explode', x: tank.x, z: tank.z, big: true });
  if (w.killCounter % POWERUP_DROP_EVERY === 0) dropPowerup(w, tank.x, tank.z);
}

function killPlayer(w: World, tank: Tank): void {
  const playerId = tank.playerId;
  if (!playerId) return;
  tank.alive = false;
  const slot = w.players[playerId];
  slot.alive = false;
  slot.lives -= 1;
  slot.power = 1;
  w.events.push({ type: 'explode', x: tank.x, z: tank.z, big: true });
  w.events.push({ type: 'playerDown', playerId, lives: slot.lives });
  if (slot.lives > 0) {
    tank.respawnAt = w.time + RESPAWN_DELAY;
  } else {
    tank.respawnAt = 0;
    checkGameOver(w);
  }
}

function checkGameOver(w: World): void {
  if (w.phase !== 'playing') return;
  const anyLeft = w.playerOrder.some((id) => {
    const slot = w.players[id];
    const tank = playerTank(w, id);
    return slot.lives > 0 || (tank?.alive ?? false);
  });
  if (!anyLeft) {
    w.phase = 'gameOver';
    w.events.push({ type: 'gameOver', reason: 'lives' });
  }
}

function damageTank(w: World, tank: Tank, byPlayerId: string | undefined): void {
  if (tank.kind === 'enemy') {
    tank.hp -= 1;
    if (tank.hp <= 0) killEnemy(w, tank, byPlayerId);
    return;
  }
  if (tank.invulnUntil > w.time) return;
  killPlayer(w, tank);
}

function destroyBase(w: World): void {
  const base = w.base;
  if (!base.alive) return;
  base.hp -= 1;
  w.events.push({ type: 'baseHit', hp: base.hp });
  if (base.hp > 0) return;
  if (base.repairsLeft > 0) {
    base.repairsLeft -= 1;
    base.hp = base.maxHp;
    w.events.push({ type: 'explode', x: BASE_CENTER.x, z: BASE_CENTER.z, big: true });
    return;
  }
  base.alive = false;
  w.phase = 'gameOver';
  w.events.push({ type: 'explode', x: BASE_CENTER.x, z: BASE_CENTER.z, big: true });
  w.events.push({ type: 'gameOver', reason: 'base' });
}

/** 服务器/本地共用的固定步长推进。每步会清空 w.events 并重新填充。 */
export function stepWorld(w: World, inputs: Record<string, PlayerInput>, dt: number): void {
  w.events.length = 0;
  if (w.phase !== 'playing') return;
  w.tick += 1;
  w.time += dt;

  updatePlayers(w, inputs, dt);
  updateEnemies(w, dt);
  updateBullets(w, dt);
  resolveBulletClashes(w);
  updatePowerups(w);
  updateRespawns(w);
  spawnEnemies(w, dt);
  cleanup(w);

  if (
    w.phase === 'playing' &&
    w.enemyQueue.length === 0 &&
    !w.tanks.some((t) => t.kind === 'enemy' && t.alive)
  ) {
    w.phase = 'levelClear';
    bestPlayerScore(w, w.playerOrder[0], SCORE_LEVEL_CLEAR);
    w.events.push({
      type: 'levelClear',
      level: w.level,
      score: w.playerOrder.reduce((s, id) => Math.max(s, w.players[id].score), 0),
    });
  }
}

function updatePlayers(w: World, inputs: Record<string, PlayerInput>, dt: number): void {
  for (const playerId of w.playerOrder) {
    const tank = playerTank(w, playerId);
    if (!tank || !tank.alive) continue;
    const input = inputs[playerId] ?? { move: 0, turn: 0, aim: null, fire: false };

    const move = Math.max(-1, Math.min(1, input.move || 0));
    const turn = Math.max(-1, Math.min(1, input.turn || 0));
    tank.yaw = (tank.yaw + turn * BODY_TURN_SPEED * dt) % (Math.PI * 2);

    if (move !== 0) {
      const speed = move > 0 ? PLAYER_SPEED : PLAYER_REVERSE;
      const v = move * speed;
      const dx = Math.sin(tank.yaw) * v * dt;
      const dz = Math.cos(tank.yaw) * v * dt;
      moveTank(w, tank, dx, dz);
    }

    if (input.aim !== null && input.aim !== undefined && Number.isFinite(input.aim)) {
      tank.turretYaw = turnToward(tank.turretYaw, input.aim, TURRET_TURN_SPEED * dt);
    }

    tank.fireCd = Math.max(0, tank.fireCd - dt);
    if (input.fire) tryFire(w, tank);
  }
}

function tryFire(w: World, tank: Tank, spread = 0): boolean {
  if (tank.fireCd > 0) return false;
  const maxBullets = tank.kind === 'player' ? PLAYER_MAX_BULLETS[tank.power - 1] ?? 2 : 3;
  if (tank.kind === 'player' && tank.playerId) {
    if (liveBulletsOf(w, tank.playerId) >= maxBullets) return false;
  } else {
    const own = w.bullets.filter((b) => b.alive && b.ownerTankId === tank.id).length;
    if (own >= maxBullets) return false;
  }
  tank.fireCd = tank.kind === 'player' ? PLAYER_FIRE_CD_BY_POWER[tank.power - 1] ?? 0.3 : 1.2;
  spawnBullet(
    w,
    tank,
    tank.turretYaw + spread,
    tank.kind === 'player' ? 'player' : 'enemy',
    tank.power,
    tank.bulletSpeed,
  );
  return true;
}

/* ── 敌人 AI ───────────────────────────────────────────────────────── */

function updateEnemies(w: World, dt: number): void {
  for (const enemy of w.tanks) {
    if (enemy.kind !== 'enemy' || !enemy.alive) continue;
    if (!enemy.ai) enemy.ai = makeAI();
    const ai = enemy.ai;
    const cfg = DIFFICULTIES[w.difficulty];

    ai.repathTimer -= dt;

    // 目标：最近的活着的玩家坦克；没有玩家就直奔基地。
    let targetX = BASE_CENTER.x;
    let targetZ = BASE_CENTER.z - 2.5;
    let targetTank: Tank | null = null;
    let bestDist = Infinity;
    for (const t of w.tanks) {
      if (t.kind !== 'player' || !t.alive) continue;
      const d = Math.hypot(t.x - enemy.x, t.z - enemy.z);
      if (d < bestDist) {
        bestDist = d;
        targetTank = t;
      }
    }
    if (targetTank) {
      targetX = targetTank.x;
      targetZ = targetTank.z;
      ai.targetTankId = targetTank.id;
    } else {
      ai.targetTankId = null;
    }

    const dist = Math.hypot(targetX - enemy.x, targetZ - enemy.z);
    const los = hasLineOfSight(w.map, enemy.x, enemy.z, targetX, targetZ);
    const inRange = dist < 26;
    const shouldEngage = los && inRange;

    // 重新寻路
    if (ai.repathTimer <= 0) {
      ai.repathTimer = randRange(w.rng, 0.5, 1.0);
      const from = toCell(enemy.x, enemy.z);
      let goal = targetTank ? toCell(targetTank.x, targetTank.z) : { cx: 12, cz: 23 };
      if (!inBounds(goal.cx, goal.cz)) goal = { cx: 12, cz: 23 };
      const path = findPath(w.map, from, goal, { allowBrick: true, adjacentGoal: true });
      ai.path = path ?? [];
      ai.pathIndex = 0;
    }

    if (shouldEngage) {
      ai.state = 'engage';
    } else {
      ai.state = 'advance';
    }

    if (ai.state === 'engage') {
      // 停车对射：炮塔平滑跟踪目标，瞄准误差只施加在出膛方向上。
      const desired = Math.atan2(targetX - enemy.x, targetZ - enemy.z);
      enemy.turretYaw = turnToward(enemy.turretYaw, desired, TURRET_TURN_SPEED * dt);
      if (Math.abs(angleDelta(enemy.turretYaw, desired)) < 0.12) ai.aimTimer += dt;
      else ai.aimTimer = 0;
      enemy.fireCd = Math.max(0, enemy.fireCd - dt);
      if (ai.aimTimer >= cfg.enemyReaction && enemy.fireCd <= 0) {
        const err = (w.rng() - 0.5) * 2 * cfg.enemyAimError;
        tryFire(w, enemy, err);
        ai.aimTimer = 0;
        enemy.fireCd = ENEMY_KINDS[enemy.enemyKind ?? 'normal'].fireCooldown * cfg.enemyFireCdMul;
      }
      // 仍在缓慢向目标推进，避免被玩家绕柱卡死
      if (dist > 14) steerAlongPath(w, enemy, ai, dt);
    } else {
      // 推进：走 A* 路径；没有路径就直线顶过去。
      let moved = 0;
      if (ai.path.length > 0 && ai.pathIndex < ai.path.length) {
        moved = followPath(w, enemy, ai, dt);
      } else {
        moved = steerDirect(w, enemy, targetX, targetZ, dt);
      }
      // 炮塔回正到车体方向
      enemy.turretYaw = turnToward(enemy.turretYaw, enemy.yaw, TURRET_TURN_SPEED * 0.6 * dt);
      enemy.fireCd = Math.max(0, enemy.fireCd - dt);

      const progressed = Math.hypot(enemy.x - ai.lastX, enemy.z - ai.lastZ);
      if (progressed < 0.02) ai.stuckTimer += dt;
      else ai.stuckTimer = Math.max(0, ai.stuckTimer - dt * 2);
      ai.lastX = enemy.x;
      ai.lastZ = enemy.z;

      // 卡住：朝车头开炮开路（砖墙会被打掉）。
      if (ai.stuckTimer > 0.7 && enemy.fireCd <= 0) {
        tryFire(w, enemy);
        ai.stuckTimer = 0;
        ai.repathTimer = 0;
      }
    }
  }
}

function followPath(w: World, enemy: Tank, ai: AIState, dt: number): number {
  const waypoint = ai.path[ai.pathIndex];
  if (!waypoint) return 0;
  const pos = cellToWorld(waypoint);
  const dx = pos.x - enemy.x;
  const dz = pos.z - enemy.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.7) {
    ai.pathIndex++;
    return 0;
  }
  const desired = Math.atan2(dx, dz);
  enemy.yaw = turnToward(enemy.yaw, desired, BODY_TURN_SPEED * dt);
  const err = Math.abs(angleDelta(enemy.yaw, desired));
  if (err < 0.9) {
    const speed = ENEMY_KINDS[enemy.enemyKind ?? 'normal'].speed;
    return moveTank(w, enemy, Math.sin(enemy.yaw) * speed * dt, Math.cos(enemy.yaw) * speed * dt);
  }
  return 0;
}

function steerAlongPath(w: World, enemy: Tank, ai: AIState, dt: number): void {
  if (ai.path.length > 0 && ai.pathIndex < ai.path.length) followPath(w, enemy, ai, dt);
}

function steerDirect(w: World, enemy: Tank, tx: number, tz: number, dt: number): number {
  const desired = Math.atan2(tx - enemy.x, tz - enemy.z);
  enemy.yaw = turnToward(enemy.yaw, desired, BODY_TURN_SPEED * dt);
  if (Math.abs(angleDelta(enemy.yaw, desired)) < 0.9) {
    const speed = ENEMY_KINDS[enemy.enemyKind ?? 'normal'].speed;
    return moveTank(w, enemy, Math.sin(enemy.yaw) * speed * dt, Math.cos(enemy.yaw) * speed * dt);
  }
  return 0;
}

/* ── 子弹 ─────────────────────────────────────────────────────────── */

function updateBullets(w: World, dt: number): void {
  for (const bullet of w.bullets) {
    if (!bullet.alive) continue;
    const travel = bullet.speed * dt;
    const steps = Math.max(1, Math.ceil(travel / BULLET_SUBSTEP));
    const stepDist = travel / steps;
    for (let s = 0; s < steps && bullet.alive; s++) {
      bullet.x += Math.sin(bullet.yaw) * stepDist;
      bullet.z += Math.cos(bullet.yaw) * stepDist;

      if (bullet.x < -1 || bullet.x > WORLD_W + 1 || bullet.z < -1 || bullet.z > WORLD_H + 1) {
        bullet.alive = false;
        break;
      }

      // 坦克命中：玩家子弹只打敌人，敌人子弹只打玩家（合作模式无友伤）。
      for (const tank of w.tanks) {
        if (!tank.alive) continue;
        if (tank.id === bullet.ownerTankId) continue;
        const sameTeam = (tank.kind === 'player') === (bullet.team === 'player');
        if (sameTeam) continue;
        const dx = tank.x - bullet.x;
        const dz = tank.z - bullet.z;
        if (dx * dx + dz * dz > TANK_SHOVE_RADIUS * TANK_SHOVE_RADIUS) continue;
        if (tank.kind === 'player' && tank.invulnUntil > w.time) {
          // 无敌：子弹消失但不掉血
          bullet.alive = false;
          w.events.push({ type: 'bulletClash', x: bullet.x, z: bullet.z });
          break;
        }
        bullet.alive = false;
        damageTank(w, tank, bullet.playerId);
        break;
      }
      if (!bullet.alive) break;

      // 基地
      if (bullet.team === 'enemy' && hitsBase(bullet.x, bullet.z, BULLET_RADIUS)) {
        bullet.alive = false;
        destroyBase(w);
        break;
      }

      // 地形
      const cx = Math.floor(bullet.x / TILE);
      const cz = Math.floor(bullet.z / TILE);
      if (!inBounds(cx, cz)) {
        bullet.alive = false;
        break;
      }
      const tile = tileAt(w.map, cx, cz);
      if (tile === TILE_BRICK) {
        destroyTileAt(w, cx, cz, true);
        bullet.alive = false;
        break;
      }
      if (tile === TILE_STEEL) {
        if (bullet.power >= STEEL_BREAK_POWER) destroyTileAt(w, cx, cz, true);
        bullet.alive = false;
        break;
      }
    }
  }
}

function resolveBulletClashes(w: World): void {
  const live = w.bullets.filter((b) => b.alive);
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i];
      const b = live[j];
      if (!a.alive || !b.alive) continue;
      if (a.team === b.team) continue;
      const dx = a.x - b.x;
      const dz = a.z - b.z;
      if (dx * dx + dz * dz < 0.6 * 0.6) {
        a.alive = false;
        b.alive = false;
        w.events.push({ type: 'bulletClash', x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
      }
    }
  }
}

/* ── 道具 ─────────────────────────────────────────────────────────── */

function updatePowerups(w: World): void {
  for (let i = w.powerups.length - 1; i >= 0; i--) {
    const p = w.powerups[i];
    if (w.time > p.until) {
      w.powerups.splice(i, 1);
      continue;
    }
    let picked: Tank | null = null;
    for (const tank of w.tanks) {
      if (tank.kind !== 'player' || !tank.alive) continue;
      if (Math.hypot(tank.x - p.x, tank.z - p.z) < 1.7) {
        picked = tank;
        break;
      }
    }
    if (!picked || !picked.playerId) continue;
    applyPowerup(w, picked, p.kind);
    w.powerups.splice(i, 1);
  }
}

function applyPowerup(w: World, tank: Tank, kind: PowerupKind): void {
  const playerId = tank.playerId as string;
  bestPlayerScore(w, playerId, POWERUP_PICK_SCORE);
  w.events.push({ type: 'powerupPickup', kind, playerId });
  switch (kind) {
    case 'star': {
      tank.power = Math.min(MAX_POWER_LEVEL, tank.power + 1);
      w.players[playerId].power = tank.power;
      break;
    }
    case 'grenade': {
      for (const enemy of w.tanks) {
        if (enemy.kind === 'enemy' && enemy.alive) killEnemy(w, enemy, playerId);
      }
      break;
    }
    case 'helmet': {
      tank.invulnUntil = Math.max(tank.invulnUntil, w.time + HELMET_DURATION);
      break;
    }
    case 'shovel': {
      w.shovelUntil = w.time + SHOVEL_DURATION;
      setBaseWallSteel(w.map, true);
      break;
    }
  }
}

/* ── 复活、刷新、清理 ─────────────────────────────────────────────── */

function updateRespawns(w: World): void {
  if (w.shovelUntil > 0 && w.time >= w.shovelUntil) {
    w.shovelUntil = 0;
    setBaseWallSteel(w.map, false);
  }
  for (const playerId of w.playerOrder) {
    const slot = w.players[playerId];
    const tank = playerTank(w, playerId);
    if (!tank || tank.alive || slot.lives <= 0) continue;
    if (tank.respawnAt > 0 && w.time >= tank.respawnAt) {
      respawnPlayer(w, tank, slot);
    }
  }
}

function respawnPlayer(w: World, tank: Tank, slot: PlayerSlot): void {
  const index = w.playerOrder.indexOf(slot.id);
  const spawn = PLAYER_SPAWN_CELLS[index % PLAYER_SPAWN_CELLS.length];
  const pos = cellCenter(spawn.cx, spawn.cz);
  // 出生点被占：依次尝试其它出生点。
  let chosen = pos;
  for (let i = 0; i < PLAYER_SPAWN_CELLS.length; i++) {
    const c = PLAYER_SPAWN_CELLS[(index + i) % PLAYER_SPAWN_CELLS.length];
    const p = cellCenter(c.cx, c.cz);
    const occupied = w.tanks.some(
      (t) => t !== tank && t.alive && Math.hypot(t.x - p.x, t.z - p.z) < TANK_SHOVE_RADIUS * 2,
    );
    if (!occupied) {
      chosen = p;
      break;
    }
  }
  tank.x = chosen.x;
  tank.z = chosen.z;
  tank.yaw = SPAWN_YAW;
  tank.turretYaw = SPAWN_YAW;
  tank.hp = tank.maxHp;
  tank.alive = true;
  tank.respawnAt = 0;
  tank.invulnUntil = w.time + SPAWN_INVULN;
  tank.fireCd = 0;
  tank.power = 1;
  slot.alive = true;
  // 清掉出生点附近的敌弹，避免复活即死。
  for (const b of w.bullets) {
    if (b.alive && Math.hypot(b.x - tank.x, b.z - tank.z) < SPAWN_CLEAR_RADIUS + 1.2) b.alive = false;
  }
}

function spawnEnemies(w: World, dt: number): void {
  if (w.enemyQueue.length === 0) return;
  if (enemyTanks(w).length >= MAX_ALIVE_ENEMIES) return;
  w.enemySpawnTimer -= dt;
  if (w.enemySpawnTimer > 0) return;
  w.enemySpawnTimer = ENEMY_SPAWN_INTERVAL;

  const kind = w.enemyQueue.shift();
  if (!kind) return;
  // 选一个没有被占用的刷新点（轮流用三个点）。
  let chosen = ENEMY_SPAWN_CELLS[0];
  for (let i = 0; i < ENEMY_SPAWN_CELLS.length; i++) {
    const cand = ENEMY_SPAWN_CELLS[(w.enemiesKilled + i) % ENEMY_SPAWN_CELLS.length];
    const p = cellCenter(cand.cx, cand.cz);
    const occupied = w.tanks.some(
      (t) => t.alive && Math.hypot(t.x - p.x, t.z - p.z) < TANK_SHOVE_RADIUS * 2.4,
    );
    if (!occupied) {
      chosen = cand;
      break;
    }
  }
  const pos = cellCenter(chosen.cx, chosen.cz);
  const cfg = ENEMY_KINDS[kind];
  const tank = newTank(w, {
    kind: 'enemy',
    enemyKind: kind,
    name: cfg.label,
    x: pos.x,
    z: pos.z,
    yaw: 0,
    turretYaw: 0,
    hp: cfg.hp,
    maxHp: cfg.hp,
    alive: true,
    respawnAt: 0,
    invulnUntil: w.time + 1.0,
    fireCd: 0.8,
    power: 1,
    speed: cfg.speed,
    bulletSpeed: cfg.bulletSpeed,
  });
  tank.ai = makeAI();
  tank.ai.lastX = tank.x;
  tank.ai.lastZ = tank.z;
}

function cleanup(w: World): void {
  w.bullets = w.bullets.filter((b) => b.alive);
  w.tanks = w.tanks.filter((t) => t.alive || (t.kind === 'player' && w.players[t.playerId ?? '']?.lives > 0));
}

/* ── 工具 ─────────────────────────────────────────────────────────── */

export function totalEnemiesLeft(w: World): number {
  return w.enemyQueue.length + enemyTanks(w).length;
}

export function createWorldForLevel(
  levelDef: LevelDef,
  level: number,
  opts: Omit<CreateWorldOptions, 'levelDef' | 'level'>,
): World {
  return createWorld({ ...opts, levelDef, level });
}
