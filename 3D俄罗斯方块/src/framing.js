/*!
 * 取景几何 · 纯函数
 *
 * 相机要「完整看见井道」，本质是一个纯几何问题：
 * 给定需要看到的宽高、竖直视场角、屏幕宽高比，求相机距离，
 * 以及该距离下视锥在目标平面上的半宽/半高。
 *
 * 抽出来单独成模块的原因：窄屏/超宽屏会不会裁掉井道，
 * 必须能用单元测试断言，而不是靠某天在一台手机上肉眼确认。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Framing = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * @param {number} needW  需要完整看到的宽度（世界单位）
   * @param {number} needH  需要完整看到的高度（世界单位）
   * @param {number} vFovDeg 竖直视场角（度）
   * @param {number} aspect  屏幕宽高比 w/h
   * @param {number} [margin=1.04] 安全余量
   * @returns {{distance:number, halfWidth:number, halfHeight:number, limitedBy:string}}
   */
  function computeFraming(needW, needH, vFovDeg, aspect, margin) {
    var tanV = Math.tan((vFovDeg * Math.PI) / 360);
    var m = margin == null ? 1.04 : margin;
    var a = Math.max(aspect, 0.01);

    var distV = needH / 2 / tanV;              // 高度约束
    var distH = needW / 2 / (tanV * a);        // 宽度约束
    var distance = Math.max(distV, distH) * m;

    return {
      distance: distance,
      halfHeight: distance * tanV,
      halfWidth: distance * tanV * a,
      limitedBy: distV >= distH ? 'height' : 'width'
    };
  }

  return { computeFraming: computeFraming };
});
