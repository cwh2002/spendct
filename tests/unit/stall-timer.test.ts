/**
 * 停滞计时器单测（src/lib/assistant/stall-timer.ts，A18 热修复）。
 *
 * 覆盖：
 * 1. 创建后完全沉默：超过阈值只触发一次，再推进也不重复触发；
 * 2. 持续 reset 时计时基准不断后移：慢而健康的流永不被触发；
 * 3. clear 后不再触发；
 * 4. 触发后再次 reset 重新武装：下一次沉默仍可触发；
 * 5. reset 传入新阈值：切换后按新窗口计时（响应前长窗 → 流内短窗）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createStallTimer } from "@/lib/assistant/stall-timer";

describe("createStallTimer（以最近一次活动为基准的超时控制）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("创建后完全沉默：超过阈值触发一次，再推进也不再重复触发", () => {
    const onFire = vi.fn();
    createStallTimer(30_000, onFire);
    vi.advanceTimersByTime(29_999);
    expect(onFire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onFire).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it("持续 reset 时基准不断后移：活动间隔小于阈值的慢流永不被触发", () => {
    const onFire = vi.fn();
    const timer = createStallTimer(30_000, onFire);
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(25_000); // 每次事件间隔 25s < 30s 阈值
      timer.reset();
    }
    vi.advanceTimersByTime(25_000);
    expect(onFire).not.toHaveBeenCalled();
  });

  it("clear 后不再触发", () => {
    const onFire = vi.fn();
    const timer = createStallTimer(30_000, onFire);
    timer.clear();
    vi.advanceTimersByTime(120_000);
    expect(onFire).not.toHaveBeenCalled();
  });

  it("触发后再次 reset 会重新武装：下一次沉默仍可触发", () => {
    const onFire = vi.fn();
    const timer = createStallTimer(30_000, onFire);
    vi.advanceTimersByTime(30_000);
    expect(onFire).toHaveBeenCalledTimes(1);
    timer.reset(); // 触发后的活动重新武装
    vi.advanceTimersByTime(29_999);
    expect(onFire).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(onFire).toHaveBeenCalledTimes(2);
  });

  it("reset 传入新阈值切换计时窗口：响应前长窗 → 流内短窗", () => {
    const onFire = vi.fn();
    const timer = createStallTimer(120_000, onFire);
    // 响应前阶段：120s 长窗内即使只有零散活动也不触发
    vi.advanceTimersByTime(100_000);
    timer.reset();
    vi.advanceTimersByTime(100_000);
    expect(onFire).not.toHaveBeenCalled();
    // 首字节到达：把窗口收紧到 30s 流内停滞窗
    timer.reset(30_000);
    vi.advanceTimersByTime(29_999);
    expect(onFire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onFire).toHaveBeenCalledTimes(1);
    // 切换后的 reset（不传阈值）沿用当前短窗
    timer.reset();
    vi.advanceTimersByTime(29_999);
    expect(onFire).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(onFire).toHaveBeenCalledTimes(2);
  });
});
