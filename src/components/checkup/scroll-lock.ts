/**
 * body 滚动锁（抽屉/底部抽屉共用）。
 * 用计数而非布尔：抽屉与移动端思考抽屉理论上可能同时打开，
 * 嵌套加锁时先关的那个不能提前解锁页面滚动。
 */

let lockCount = 0;

export function lockBodyScroll() {
  lockCount += 1;
  document.body.style.overflow = "hidden";
}

export function unlockBodyScroll() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    document.body.style.overflow = "";
  }
}
