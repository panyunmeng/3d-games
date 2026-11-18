/**
 * 摇杆 → PlayerInput 的纯映射函数（无 three / 无 DOM / 无 Math.random）。
 *
 * 为什么单独抽出来：这段是「触屏和键盘共用同一输入语义」的可验证证据。
 * 它只产出与键盘路径完全相同的四个字段，仿真层看到的值没有任何「手机专用」痕迹。
 * 键盘路径见 app.buildInput()：move=W/S、turn=A/D、aim=yaw+turretOffset、fire=左键。
 */

/** 摇杆死区：小于这个幅度的抖动忽略，避免手指微动带来持续转向/误开火。 */
export const STICK_DEAD = 0.16;

export interface StickVec {
  x: number;
  y: number;
}

/** 保留死区后的摇杆向量：幅度小于死区归零，否则保持原方向原幅度（不放大）。 */
export function stickDeadzone(v: StickVec): StickVec {
  return Math.hypot(v.x, v.y) < STICK_DEAD ? { x: 0, y: 0 } : v;
}

/**
 * 左摇杆 X → turn：右推（x>0）等价于按 D（顺时针/车头向右，yaw 减小）。
 * 与键盘 turn=(KeyA?1:0)-(KeyD?1:0) 完全同一语义，取值夹到 ±1。
 */
export function moveStickToTurn(x: number): number {
  return x === 0 ? 0 : -clamp1(x);
}

/**
 * 左摇杆 Y → move：上推（y<0）等价于按 W（前进 +1）。
 * 与键盘 move=(KeyW?1:0)-(KeyS?1:0) 完全同一语义，取值夹到 ±1。
 */
export function moveStickToMove(y: number): number {
  return y === 0 ? 0 : -clamp1(y);
}

/**
 * 右摇杆方向 → 炮塔相对车体的朝向偏移 turretOffset。
 * 相机在车后，屏幕右 = 世界 -x，yaw 增大把炮口转向 +x（屏幕左）；
 * 因此右推（x>0）对应负的 yaw 偏移：atan2(-x, -y)。
 * 上推（y<0）对应正前方（偏移 0）。返回值与鼠标 movementX 累计到 turretOffset 同义。
 */
export function aimStickToOffset(v: StickVec): number | null {
  if (v.x === 0 && v.y === 0) return null; // 与 aim=null（保持当前朝向）一致
  const a = Math.atan2(-v.x, -v.y);
  return a === 0 ? 0 : a; // 抹掉 Math.atan2(-0, 1) 产生的 -0，语义仍是 0
}

/** 右摇杆幅度超过阈值即开火，等价于按住鼠标左键（同一个 fire 字段）。 */
export function aimStickToFire(v: StickVec): boolean {
  return Math.hypot(v.x, v.y) > 0.2;
}

function clamp1(n: number): number {
  return Math.max(-1, Math.min(1, n));
}
