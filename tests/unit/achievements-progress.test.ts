/**
 * 成就行为进度层（WP8 §8a）单测：
 * applyProgressEvent 纯逻辑（adopt 同 cardId 去重 / 三类计数累加 / 不改入参 /
 * 多事件串联互不干扰）；readProgress 与 recordProgressEvent 存储边界
 * （node 环境无 localStorage 回退零值、stub 后落盘可读、损坏/脏数据防御）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { applyProgressEvent, readProgress, recordProgressEvent } from "@/lib/achievements/progress";
import type { AchievementProgress, ProgressEvent } from "@/lib/achievements/progress";

/** 零值基线（与模块内 zeroProgress 同形，逐字段断言用） */
const ZERO: AchievementProgress = {
  adopted: [],
  activatedBenefits: 0,
  dedupeSkippedTotal: 0,
  followupCount: 0,
};

/** 有既有进度的输入（断言「不改入参」与多事件串联用） */
function seeded(): AchievementProgress {
  return {
    adopted: [{ cardId: "c-1", stage: "anomaly", month: "2026-10" }],
    activatedBenefits: 2,
    dedupeSkippedTotal: 30,
    followupCount: 4,
  };
}

describe("applyProgressEvent（纯函数）", () => {
  it("adopt：首条采纳追加 cardId/stage/month 三字段", () => {
    const result = applyProgressEvent(ZERO, {
      type: "adopt",
      cardId: "c-1",
      stage: "anomaly",
      month: "2026-10",
    });
    expect(result.adopted).toEqual([{ cardId: "c-1", stage: "anomaly", month: "2026-10" }]);
  });

  it("adopt：同 cardId 重复采纳去重，保留首次记录的 stage/month", () => {
    const progress = seeded();
    const result = applyProgressEvent(progress, {
      type: "adopt",
      cardId: "c-1",
      stage: "rewind",
      month: "2026-11",
    });
    expect(result.adopted).toEqual([{ cardId: "c-1", stage: "anomaly", month: "2026-10" }]);
    expect(result.adopted).toHaveLength(1);
  });

  it("adopt：不同 cardId 各留一条", () => {
    const progress = seeded();
    const result = applyProgressEvent(progress, {
      type: "adopt",
      cardId: "c-2",
      stage: "spending",
      month: "2026-11",
    });
    expect(result.adopted).toEqual([
      { cardId: "c-1", stage: "anomaly", month: "2026-10" },
      { cardId: "c-2", stage: "spending", month: "2026-11" },
    ]);
  });

  it("activate-benefit：每次 +1，不碰其他字段", () => {
    const once = applyProgressEvent(ZERO, { type: "activate-benefit" });
    expect(once.activatedBenefits).toBe(1);
    const twice = applyProgressEvent(once, { type: "activate-benefit" });
    expect(twice.activatedBenefits).toBe(2);
    expect(twice.adopted).toEqual([]);
  });

  it("dedupe-skipped：count 累加（跨多次累计）", () => {
    const first = applyProgressEvent(ZERO, { type: "dedupe-skipped", count: 3 });
    expect(first.dedupeSkippedTotal).toBe(3);
    const second = applyProgressEvent(first, { type: "dedupe-skipped", count: 5 });
    expect(second.dedupeSkippedTotal).toBe(8);
  });

  it("followup：每次 +1", () => {
    const once = applyProgressEvent(ZERO, { type: "followup" });
    expect(once.followupCount).toBe(1);
    expect(applyProgressEvent(once, { type: "followup" }).followupCount).toBe(2);
  });

  it("四类事件串联应用：各自累计互不干扰", () => {
    const events: ProgressEvent[] = [
      { type: "adopt", cardId: "c-1", stage: "anomaly", month: "2026-10" },
      { type: "activate-benefit" },
      { type: "dedupe-skipped", count: 3 },
      { type: "followup" },
      { type: "dedupe-skipped", count: 5 },
      { type: "activate-benefit" },
    ];
    const result = events.reduce(applyProgressEvent, ZERO);
    expect(result).toEqual({
      adopted: [{ cardId: "c-1", stage: "anomaly", month: "2026-10" }],
      activatedBenefits: 2,
      dedupeSkippedTotal: 8,
      followupCount: 1,
    });
  });

  it("不改入参：adopted 数组与各计数保持原样", () => {
    const progress = seeded();
    const before = JSON.stringify(progress);
    applyProgressEvent(progress, {
      type: "adopt",
      cardId: "c-9",
      stage: "anomaly",
      month: "2026-11",
    });
    applyProgressEvent(progress, { type: "dedupe-skipped", count: 100 });
    applyProgressEvent(progress, { type: "activate-benefit" });
    applyProgressEvent(progress, { type: "followup" });
    expect(JSON.stringify(progress)).toBe(before);
  });
});

/* ---- 存储边界：node 环境无 localStorage，用 stub 模拟浏览器 ---- */

/** node 单测环境下的 localStorage 桩：读写照 Map，removeItem 清键 */
function stubLocalStorage(seed: Record<string, string>): Map<string, string> {
  const store = new Map(Object.entries(seed));
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
  return store;
}

describe("readProgress / recordProgressEvent（存储边界）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("node 环境无 localStorage：readProgress 返回零值，recordProgressEvent 不抛异常", () => {
    expect(readProgress()).toEqual(ZERO);
    expect(() => recordProgressEvent({ type: "followup" })).not.toThrow();
  });

  it("无记录 / 损坏 JSON：回退零值", () => {
    stubLocalStorage({});
    expect(readProgress()).toEqual(ZERO);
    stubLocalStorage({ "spendct:achievement-progress:v1": "{broken json" });
    expect(readProgress()).toEqual(ZERO);
  });

  it("形态不合法：非对象整体回退；字段类型错逐字段回退", () => {
    stubLocalStorage({ "spendct:achievement-progress:v1": JSON.stringify("just-a-string") });
    expect(readProgress()).toEqual(ZERO);
    stubLocalStorage({
      "spendct:achievement-progress:v1": JSON.stringify({
        adopted: "not-an-array",
        activatedBenefits: "3",
        dedupeSkippedTotal: -5,
        followupCount: 2.9,
      }),
    });
    expect(readProgress()).toEqual({
      adopted: [],
      activatedBenefits: 0,
      dedupeSkippedTotal: 0,
      followupCount: 2,
    });
  });

  it("合法数据逐字段还原；adopted 脏条目整条丢弃（缺字段 / month 非法 / 非对象）", () => {
    stubLocalStorage({
      "spendct:achievement-progress:v1": JSON.stringify({
        adopted: [
          { cardId: "c-1", stage: "anomaly", month: "2026-09" },
          { cardId: "c-2", stage: "spending" }, // 缺 month
          { cardId: "c-3", stage: "spending", month: "2026年9月" }, // month 不合法
          "not-an-object",
        ],
        activatedBenefits: 2,
        dedupeSkippedTotal: 30,
        followupCount: 4,
      }),
    });
    expect(readProgress()).toEqual({
      adopted: [{ cardId: "c-1", stage: "anomaly", month: "2026-09" }],
      activatedBenefits: 2,
      dedupeSkippedTotal: 30,
      followupCount: 4,
    });
  });

  it("recordProgressEvent：读 → apply → 写回，落盘 JSON 可被 readProgress 读回", () => {
    const store = stubLocalStorage({});
    recordProgressEvent({ type: "adopt", cardId: "c-1", stage: "anomaly", month: "2026-10" });
    recordProgressEvent({ type: "dedupe-skipped", count: 12 });
    const saved = store.get("spendct:achievement-progress:v1");
    expect(saved).toBeDefined();
    expect(JSON.parse(saved as string)).toEqual({
      adopted: [{ cardId: "c-1", stage: "anomaly", month: "2026-10" }],
      activatedBenefits: 0,
      dedupeSkippedTotal: 12,
      followupCount: 0,
    });
    expect(readProgress()).toEqual({
      adopted: [{ cardId: "c-1", stage: "anomaly", month: "2026-10" }],
      activatedBenefits: 0,
      dedupeSkippedTotal: 12,
      followupCount: 0,
    });
  });

  it("recordProgressEvent：同 cardId 重复记录落盘去重", () => {
    const store = stubLocalStorage({});
    recordProgressEvent({ type: "adopt", cardId: "c-1", stage: "anomaly", month: "2026-10" });
    recordProgressEvent({ type: "adopt", cardId: "c-1", stage: "rewind", month: "2026-11" });
    recordProgressEvent({ type: "activate-benefit" });
    const saved = JSON.parse(store.get("spendct:achievement-progress:v1") as string) as {
      adopted: unknown[];
      activatedBenefits: number;
    };
    expect(saved.adopted).toHaveLength(1);
    expect(saved.activatedBenefits).toBe(1);
  });
});
