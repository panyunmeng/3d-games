import { describe, expect, it } from 'vitest';
import {
  aimStickToFire,
  aimStickToOffset,
  moveStickToMove,
  moveStickToTurn,
  stickDeadzone,
} from '../src/inputMapping';

/**
 * 为什么这组测试存在：
 * 触屏适配的硬约束是「不许为手机发明新的输入语义」。证据就是摇杆映射出来的值
 * 与键盘按 W/S/A/D/鼠标 得到的 PlayerInput 字段逐字段一致——而不是「看起来差不多」。
 */
describe('摇杆 → PlayerInput 字段映射与键盘语义一致', () => {
  it('左摇杆上推 = W（move=+1），下推 = S（move=-1）', () => {
    expect(moveStickToMove(-1)).toBe(1); // 上推 y=-1 → 前进
    expect(moveStickToMove(1)).toBe(-1); // 下推 y=+1 → 后退
    expect(moveStickToMove(0)).toBe(0); // 不动
  });

  it('左摇杆右推 = D（turn=-1，yaw 减小/车头向右），左推 = A（turn=+1）', () => {
    expect(moveStickToTurn(1)).toBe(-1);
    expect(moveStickToTurn(-1)).toBe(1);
    expect(moveStickToTurn(0)).toBe(0);
  });

  it('move/turn 超出 ±1 时被夹取，与仿真层对键盘输入的夹取一致', () => {
    expect(moveStickToMove(-2)).toBe(1);
    expect(moveStickToTurn(3)).toBe(-1);
  });

  it('右摇杆正前方 = 炮塔相对车体偏移 0（与鼠标不动一致）', () => {
    expect(aimStickToOffset({ x: 0, y: -1 })).toBe(0);
  });

  it('右摇杆右推瞄准屏幕右侧：屏幕右=世界 -x，yaw 偏移为负', () => {
    expect(aimStickToOffset({ x: 1, y: 0 })).toBeCloseTo(-Math.PI / 2);
    expect(aimStickToOffset({ x: -1, y: 0 })).toBeCloseTo(Math.PI / 2);
  });

  it('右摇杆回中 = null（保持当前炮塔朝向），与鼠标停止移动一致', () => {
    expect(aimStickToOffset({ x: 0, y: 0 })).toBeNull();
  });

  it('推动右摇杆即开火（fire=true），回中停火，等价于按住/松开左键', () => {
    expect(aimStickToFire({ x: 0.5, y: 0 })).toBe(true);
    expect(aimStickToFire({ x: 0, y: 0 })).toBe(false);
    expect(aimStickToFire({ x: 0.1, y: 0 })).toBe(false); // 死区附近不误开火
  });

  it('死区过滤：微小抖动归零，不会带来持续转向或误开火', () => {
    expect(stickDeadzone({ x: 0.05, y: 0.05 })).toEqual({ x: 0, y: 0 });
    expect(stickDeadzone({ x: 0.5, y: 0 })).toEqual({ x: 0.5, y: 0 });
  });
});
