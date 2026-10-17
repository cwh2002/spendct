/**
 * 挑战页手动记账合并（WP4 §4a）单测：
 * upsertManualDayEntry 覆盖金额保留 id/note、不同日不同类目独立、income 忽略；
 * mergeChallengePoints 已有组合叠加、缺失组合补点、income 忽略、不改入参；
 * manualDayCents 该日该类目 expense 合计。金额一律整数分断言。
 */
import { describe, expect, it } from "vitest";

import {
  manualDayCents,
  mergeChallengePoints,
  upsertManualDayEntry,
} from "@/lib/challenge/manual-day-merge";
import type { ManualEntry } from "@/lib/budget/manual-merge";
import type { CategoryDayCents } from "@/lib/insights/challenge-sql";

/** 手动账条目工厂：默认当日餐饮支出 2500 分 */
function entry(overrides: Partial<ManualEntry>): ManualEntry {
  return {
    id: "e-1",
    ts: "2026-10-17",
    direction: "expense",
    category: "餐饮",
    amountCents: 2500,
    note: "午餐",
    ...overrides,
  };
}

describe("upsertManualDayEntry（当日同类目覆盖 / 追加）", () => {
  it("当日同类目 expense 已有记录：覆盖金额，保留原 id 与 note", () => {
    const existing = entry({ id: "keep-me", note: "食堂", amountCents: 2000 });
    const result = upsertManualDayEntry([existing], {
      ts: "2026-10-17",
      category: "餐饮",
      amountCents: 3500,
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ ...existing, amountCents: 3500 });
    expect(result[0]?.id).toBe("keep-me");
    expect(result[0]?.note).toBe("食堂");
  });

  it("没有同类记录：追加新记录，direction 固定 expense，id 与预算页同款时间戳-随机尾缀", () => {
    const result = upsertManualDayEntry([], {
      ts: "2026-10-17",
      category: "餐饮",
      amountCents: 3500,
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      ts: "2026-10-17",
      direction: "expense",
      category: "餐饮",
      amountCents: 3500,
      note: "挑战页手动记录",
    });
    expect(result[0]?.id).toMatch(/^\d+-[a-z0-9]{1,6}$/);
  });

  it("不同日期同类目不覆盖：各自独立成两条", () => {
    const existing = entry({ ts: "2026-10-16", amountCents: 1000 });
    const result = upsertManualDayEntry([existing], {
      ts: "2026-10-17",
      category: "餐饮",
      amountCents: 3500,
    });
    expect(result).toHaveLength(2);
    expect(result[0]?.amountCents).toBe(1000);
    expect(result[1]?.amountCents).toBe(3500);
  });

  it("同日不同类目不覆盖：各自独立", () => {
    const existing = entry({ category: "交通", amountCents: 1000 });
    const result = upsertManualDayEntry([existing], {
      ts: "2026-10-17",
      category: "餐饮",
      amountCents: 3500,
    });
    expect(result).toHaveLength(2);
    expect(result.find((e) => e.category === "交通")?.amountCents).toBe(1000);
    expect(result.find((e) => e.category === "餐饮")?.amountCents).toBe(3500);
  });

  it("income 记录不参与匹配也不被覆盖", () => {
    const income = entry({ direction: "income", amountCents: 8000, note: "工资" });
    const result = upsertManualDayEntry([income], {
      ts: "2026-10-17",
      category: "餐饮",
      amountCents: 3500,
    });
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(income);
    expect(result[1]?.direction).toBe("expense");
  });

  it("不改入参数组", () => {
    const existing = [entry({ id: "keep-me" })];
    const before = JSON.stringify(existing);
    upsertManualDayEntry(existing, { ts: "2026-10-17", category: "餐饮", amountCents: 3500 });
    expect(JSON.stringify(existing)).toBe(before);
  });
});

describe("mergeChallengePoints（手动账叠加到逐日类目支出点）", () => {
  it("已有 (类目, 日期) 组合：叠加金额", () => {
    const points: CategoryDayCents[] = [{ category: "餐饮", date: "2026-10-17", cents: 4200 }];
    const result = mergeChallengePoints(points, [
      entry({ ts: "2026-10-17", category: "餐饮", amountCents: 2500 }),
    ]);
    expect(result).toEqual([{ category: "餐饮", date: "2026-10-17", cents: 6700 }]);
  });

  it("多条同日同类目手动账：逐条累加", () => {
    const points: CategoryDayCents[] = [{ category: "餐饮", date: "2026-10-17", cents: 1000 }];
    const result = mergeChallengePoints(points, [
      entry({ amountCents: 2000 }),
      entry({ id: "e-2", amountCents: 3000 }),
    ]);
    expect(result).toEqual([{ category: "餐饮", date: "2026-10-17", cents: 6000 }]);
  });

  it("points 中没有该组合：补一个新点（排在原有点之后）", () => {
    const points: CategoryDayCents[] = [{ category: "交通", date: "2026-10-16", cents: 800 }];
    const result = mergeChallengePoints(points, [
      entry({ ts: "2026-10-17", category: "餐饮", amountCents: 2500 }),
    ]);
    expect(result).toEqual([
      { category: "交通", date: "2026-10-16", cents: 800 },
      { category: "餐饮", date: "2026-10-17", cents: 2500 },
    ]);
  });

  it("income 记录不参与叠加", () => {
    const points: CategoryDayCents[] = [{ category: "餐饮", date: "2026-10-17", cents: 4200 }];
    const result = mergeChallengePoints(points, [
      entry({ direction: "income", amountCents: 9000 }),
    ]);
    expect(result).toEqual(points);
  });

  it("金额非数字的脏记录不参与叠加", () => {
    const points: CategoryDayCents[] = [{ category: "餐饮", date: "2026-10-17", cents: 4200 }];
    const result = mergeChallengePoints(points, [entry({ amountCents: Number.NaN })]);
    expect(result).toEqual(points);
  });

  it("空 points 全量补点；空 entries 原样返回且不改入参", () => {
    expect(mergeChallengePoints([], [entry({ amountCents: 2500 })])).toEqual([
      { category: "餐饮", date: "2026-10-17", cents: 2500 },
    ]);
    const points: CategoryDayCents[] = [{ category: "餐饮", date: "2026-10-17", cents: 4200 }];
    expect(mergeChallengePoints(points, [])).toEqual(points);
    expect(points[0]?.cents).toBe(4200); // 原数组未被改写
  });
});

describe("manualDayCents（该日该类目手动支出合计）", () => {
  it("多条同日同类目 expense 合计；其他日 / 类目 / income 不计入", () => {
    const entries: ManualEntry[] = [
      entry({ amountCents: 2000 }),
      entry({ id: "e-2", amountCents: 3000 }),
      entry({ id: "e-3", ts: "2026-10-16", amountCents: 5000 }),
      entry({ id: "e-4", category: "交通", amountCents: 4000 }),
      entry({ id: "e-5", direction: "income", amountCents: 8000 }),
    ];
    expect(manualDayCents(entries, "餐饮", "2026-10-17")).toBe(5000);
  });

  it("无匹配记录返回 0", () => {
    expect(manualDayCents([], "餐饮", "2026-10-17")).toBe(0);
    expect(manualDayCents([entry({ category: "交通" })], "餐饮", "2026-10-17")).toBe(0);
  });
});
