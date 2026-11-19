'use strict';
/**
 * 取景几何单测：保证任何宽高比下井道都不会被裁掉。
 * 这是「窄屏未验证」那条待办的机械化替代——不靠某台手机的截图。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../src/framing.js');

const V_FOV = 38;      // 与 game.js 的 PerspectiveCamera fov 一致
const NEED_W = 10 + 4.2;
const NEED_H = 20 + 3.4;

test('取景：从 0.4 到 3.0 的宽高比都完整覆盖井道', () => {
  const aspects = [0.4, 0.45, 0.5, 0.56, 0.62, 0.75, 1, 1.33, 1.6, 1.78, 2, 2.5, 3];
  for (const aspect of aspects) {
    const f = F.computeFraming(NEED_W, NEED_H, V_FOV, aspect, 1.04);
    assert.ok(f.halfWidth >= NEED_W / 2,
      `aspect=${aspect} 横向不够：${f.halfWidth.toFixed(2)} < ${(NEED_W / 2).toFixed(2)}`);
    assert.ok(f.halfHeight >= NEED_H / 2,
      `aspect=${aspect} 纵向不够：${f.halfHeight.toFixed(2)} < ${(NEED_H / 2).toFixed(2)}`);
  }
});

test('取景：窄屏由宽度约束，宽屏由高度约束', () => {
  assert.equal(F.computeFraming(NEED_W, NEED_H, V_FOV, 0.5).limitedBy, 'width');
  assert.equal(F.computeFraming(NEED_W, NEED_H, V_FOV, 2.2).limitedBy, 'height');
});

test('取景：宽高比越大，相机可以越近（距离单调不增）', () => {
  let prev = Infinity;
  for (const aspect of [0.4, 0.5, 0.62, 0.75, 1, 1.33, 1.78, 2.2, 3]) {
    const f = F.computeFraming(NEED_W, NEED_H, V_FOV, aspect);
    assert.ok(f.distance <= prev + 1e-9, `aspect=${aspect} 距离反而变大`);
    prev = f.distance;
  }
});

test('取景：余量生效，且 halfWidth/halfHeight 与距离自洽', () => {
  const f = F.computeFraming(NEED_W, NEED_H, V_FOV, 1, 1.2);
  const tanV = Math.tan((V_FOV * Math.PI) / 360);
  assert.ok(Math.abs(f.halfHeight - f.distance * tanV) < 1e-9);
  assert.ok(Math.abs(f.halfWidth - f.distance * tanV * 1) < 1e-9);
  // 余量 1.2 应该让可视范围比刚好放下再大 20%
  assert.ok(f.halfHeight >= (NEED_H / 2) * 1.2 - 1e-9);
});

test('取景：极端窄屏（aspect 0.01）不会算出 0 或 NaN', () => {
  const f = F.computeFraming(NEED_W, NEED_H, V_FOV, 0);
  assert.ok(Number.isFinite(f.distance) && f.distance > 0);
  assert.ok(Number.isFinite(f.halfWidth) && f.halfWidth > 0);
});
