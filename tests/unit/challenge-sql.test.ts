/**
 * 省钱挑战（A17）挑战数据层单测：
 * 覆盖每日聚合 SQL 白名单预检、查询行映射（按 SELECT 位置取值 + 脏行过滤）、
 * 本地日期键工具（加减自然日/日差，跨月跨年归一）、类目逐日序列与
 * 区间求和/日均、每日预算建议的下限与取整口径。
 */
import { describe, expect, it } from "vitest";

import {
  addDays,
  averageDaily,
  CHALLENGE_DAILY_SQL,
  daysBetween,
  parseCategoryDayRows,
  quotaSuggestionCents,
  seriesOf,
  sumBetween,
  toDateKey,
} from "@/lib/insights/challenge-sql";
import { precheckAggregateSql } from "@/lib/sql-guard/whitelist";

describe("CHALLENGE_DAILY_SQL（每日类目聚合白名单预检）", () => {
  it("代码常量通过预检（GROUP BY 两列、无 LIMIT、行数靠 overrides 放行）", () => {
    expect(precheckAggregateSql(CHALLENGE_DAILY_SQL).ok).toBe(true);
  });
});

describe("parseCategoryDayRows（查询行 → 每日类目支出点）", () => {
  it("按 SELECT 列位置取值（0 category / 1 date_iso / 2 SUM）", () => {
    const rows = parseCategoryDayRows([{ a: "餐饮", b: "2026-10-01", c: 2350 }]);
    expect(rows).toEqual([{ category: "餐饮", date: "2026-10-01", cents: 2350 }]);
  });

  it("脏行跳过：空类目 / 日期不完整 / 非正金额", () => {
    const rows = parseCategoryDayRows([
      { a: " ", b: "2026-10-01", c: 100 },
      { a: "餐饮", b: "2026-10-1", c: 100 },
      { a: "餐饮", b: "2026-10-01", c: 0 },
      { a: "交通", b: "2026-10-02", c: 500 },
    ]);
    expect(rows).toEqual([{ category: "交通", date: "2026-10-02", cents: 500 }]);
  });

  it("bigint 形态金额兜底转 number", () => {
    const rows = parseCategoryDayRows([{ a: "餐饮", b: "2026-10-01", c: BigInt(1200) }]);
    expect(rows[0]?.cents).toBe(1200);
  });
});

describe("本地日期键工具", () => {
  it("toDateKey 取本地钟表分量（深夜不漂到 UTC 前一天/后一天）", () => {
    expect(toDateKey(new Date(2026, 9, 16, 23, 59, 59))).toBe("2026-10-16");
    expect(toDateKey(new Date(2026, 9, 16, 0, 0, 1))).toBe("2026-10-16");
    expect(toDateKey(new Date(2026, 0, 1))).toBe("2026-01-01");
  });

  it("addDays 跨月/跨年/闰年边界由 Date 归一", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29"); // 闰年
  });

  it("daysBetween 按自然日计差，方向反转取负", () => {
    expect(daysBetween("2026-10-01", "2026-10-16")).toBe(15);
    expect(daysBetween("2026-10-16", "2026-10-01")).toBe(-15);
    expect(daysBetween("2026-10-01", "2026-10-01")).toBe(0);
    expect(daysBetween("2025-12-31", "2026-01-01")).toBe(1);
  });
});

describe("类目序列与区间统计", () => {
  it("seriesOf 只留目标类目，同日多行求和", () => {
    const map = seriesOf(
      [
        { category: "餐饮", date: "2026-10-01", cents: 100 },
        { category: "购物", date: "2026-10-01", cents: 500 },
        { category: "餐饮", date: "2026-10-01", cents: 50 },
      ],
      "餐饮",
    );
    expect(map.get("2026-10-01")).toBe(150);
    expect(map.has("购物")).toBe(false);
  });

  it("sumBetween 闭区间求和，无记录的天按 0 计入", () => {
    const map = new Map([
      ["2026-10-01", 100],
      ["2026-10-03", 200],
    ]);
    expect(sumBetween(map, "2026-10-01", "2026-10-03")).toBe(300);
    expect(sumBetween(map, "2026-10-05", "2026-10-06")).toBe(0);
  });

  it("averageDaily 按窗口自然日数均分并取整，空窗口返回 0", () => {
    const map = new Map([
      ["2026-10-01", 100],
      ["2026-10-03", 200],
    ]);
    expect(averageDaily(map, "2026-10-01", "2026-10-03")).toBe(100);
    expect(averageDaily(new Map(), "2026-10-01", "2026-10-30")).toBe(0);
  });
});

describe("quotaSuggestionCents（每日预算建议）", () => {
  it("基线 × 0.8 向下取整到元，下限 500 分（5 元）", () => {
    expect(quotaSuggestionCents(1000)).toBe(800);
    expect(quotaSuggestionCents(1234)).toBe(900); // floor(987.2/100)=9 元
    expect(quotaSuggestionCents(0)).toBe(500); // 无历史记录也落在 5 元档
    expect(quotaSuggestionCents(600)).toBe(500); // 480 分低于下限
  });
});
