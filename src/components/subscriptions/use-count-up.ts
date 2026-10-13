"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 数字滚动动画：requestAnimationFrame + easeOutCubic，约 900ms 完成。
 * 返回动画中的当前值，展示层自行格式化（金额两位小数、整数取整）。
 * 尊重系统「减少动态效果」设置：开启时直接落位目标值，不播放动画。
 */
export function useCountUp(target: number, duration = 900): number {
  const [value, setValue] = useState(0);
  const rafRef = useRef(0);

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      // setState 放进 rAF 回调：不在 effect 体内同步 setState，避免级联渲染
      const raf = requestAnimationFrame(() => setValue(target));
      return () => cancelAnimationFrame(raf);
    }
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(target * eased);
      if (progress < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return value;
}
