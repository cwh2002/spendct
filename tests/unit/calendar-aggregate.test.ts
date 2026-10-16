/**
 * 消费日历（A15 第四部分）聚合与流水纯函数单测：
 * 覆盖分页 SQL 拼接（整数校验）、DuckDB 行映射（含 bigint/字符串形态兜底）、
 * 每日聚合两条动线（真实查询行 / 演示流水行）、深夜判定（23:00-05:00）、
 * 秒级时间格式化与客户端流水筛选。
 */
import { describe, expect, it } from "vitest";
import {
  buildCalendarTimelineSql,
  dailyCentsFromQuery,
  dailyCentsFromRows,
  filterTimelineRows,
  formatTsToSeconds,
  isNightDate,
  parseTimestampCell,
  timelineRowsFromQuery,
  type CalendarTimelineRow,
} from "@/lib/insights/calendar-aggregate";

describe("buildCalendarTimelineSql（分页 SQL 拼接）", () => {
  it("非负整数偏移拼入 OFFSET，语句其余部分恒定", () => {
    const sql = buildCalendarTimelineSql(400);
    expect(sql).toContain("LIMIT 200");
    expect(sql).toContain("OFFSET 400");
    expect(sql).toContain("ORDER BY ts DESC");
    // 首页偏移 0 与 200 的语句只有 OFFSET 值不同
    expect(buildCalendarTimelineSql(200)).toBe(buildCalendarTimelineSql(0).replace("OFFSET 0", "OFFSET 200"));
  });

  it("负数 / 非整数 / 小数偏移直接拒绝（分页计数非用户输入，仍做兜底校验）", () => {
    expect(() => buildCalendarTimelineSql(-1)).toThrow(/非法的分页偏移量/);
    expect(() => buildCalendarTimelineSql(1.5)).toThrow(/非法的分页偏移量/);
    expect(() => buildCalendarTimelineSql(Number.NaN)).toThrow(/非法的分页偏移量/);
  });
});

describe("parseTimestampCell（TIMESTAMP 单元格 → Date）", () => {
  it("兼容 Date 对象 / bigint 微秒 / epoch 毫秒 number / ISO 字符串四种物化形态", () => {
    const date = new Date(2026, 9, 16, 23, 5, 7);
    expect(parseTimestampCell(date)?.getTime()).toBe(date.getTime());
    expect(parseTimestampCell(BigInt(date.getTime()) * 1000n)?.getTime()).toBe(date.getTime());
    expect(parseTimestampCell(date.getTime())?.getTime()).toBe(date.getTime());
    expect(parseTimestampCell("2026-10-16T23:05:07")?.getTime()).toBe(date.getTime());
  });

  it("非法值返回 null 由调用方过滤", () => {
    expect(parseTimestampCell("not-a-date")).toBeNull();
    expect(parseTimestampCell(null)).toBeNull();
    expect(parseTimestampCell(Number.NaN)).toBeNull();
  });
});

describe("timelineRowsFromQuery（DuckDB 流水行 → 时间轴流水行）", () => {
  const base = new Date(2026, 9, 16, 23, 5, 7);

  it("按 SELECT 列位置取值（ts/date_iso/merchant/category/amount/direction）", () => {
    const rows = timelineRowsFromQuery([
      { a: base, b: "2026-10-16", c: "美团外卖", d: "餐饮", e: 2350, f: "expense" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 1,
      ts: base,
      dateIso: "2026-10-16",
      merchant: "美团外卖",
      category: "餐饮",
      amountCents: 2350,
      direction: "expense",
    });
  });

  it("ts 缺失时退回当日 0 点兜底，行不丢；两者都缺失的行跳过", () => {
    const rows = timelineRowsFromQuery([
      { a: null, b: "2026-10-15", c: "京东商城", d: "购物", e: 9900, f: "expense" },
      { a: null, b: "", c: "脏行", d: "其他", e: 100, f: "expense" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ts.getTime()).toBe(new Date("2026-10-15T00:00:00").getTime());
  });

  it("bigint 金额与 bigint 时间戳按原物化形态换算；id 按 startId 续号", () => {
    const tsMs = base.getTime();
    const rows = timelineRowsFromQuery(
      [{ a: BigInt(tsMs) * 1000n, b: "2026-10-16", c: "瑞幸咖啡", d: "餐饮", e: 1500n, f: "income" }],
      10,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(11);
    expect(rows[0]!.amountCents).toBe(1500);
    expect(rows[0]!.direction).toBe("income");
  });

  it("direction 非 income 一律归 expense（neutral/refunded 已在 SQL 侧排除）", () => {
    const rows = timelineRowsFromQuery([
      { a: base, b: "2026-10-16", c: "未知商户", d: "其他", e: 100, f: "neutral" },
    ]);
    expect(rows[0]!.direction).toBe("expense");
  });
});

describe("dailyCentsFromQuery / dailyCentsFromRows（两条动线同形态每日聚合）", () => {
  it("查询行按 SELECT 位置取值（date_iso / SUM），脏行过滤", () => {
    const points = dailyCentsFromQuery([
      { a: "2026-10-15", b: 2350 },
      { a: "2026-10-16", b: BigInt(9900) },
      { a: "", b: 100 },
      { a: "2026-10-17", b: 0 },
    ]);
    expect(points).toEqual([
      { date: "2026-10-15", cents: 2350 },
      { date: "2026-10-16", cents: 9900 },
    ]);
  });

  it("演示流水行只聚合支出方向，按日期升序（与真实聚合同形态）", () => {
    const rows: CalendarTimelineRow[] = [
      { id: 1, ts: new Date(2026, 9, 16, 12, 0), dateIso: "2026-10-16", merchant: "A", category: "餐饮", amountCents: 2000, direction: "expense" },
      { id: 2, ts: new Date(2026, 9, 15, 12, 0), dateIso: "2026-10-15", merchant: "B", category: "其他", amountCents: 5000, direction: "income" },
      { id: 3, ts: new Date(2026, 9, 15, 13, 0), dateIso: "2026-10-15", merchant: "C", category: "餐饮", amountCents: 800, direction: "expense" },
    ];
    expect(dailyCentsFromRows(rows)).toEqual([
      { date: "2026-10-15", cents: 800 },
      { date: "2026-10-16", cents: 2000 },
    ]);
  });
});

describe("isNightDate（深夜判定，07 §3 唯一口径 23:00-05:00）", () => {
  it("23:00-次日 05:00 判深夜，05:00-23:00 判非深夜（边界小时）", () => {
    expect(isNightDate(new Date(2026, 9, 16, 23, 0))).toBe(true);
    expect(isNightDate(new Date(2026, 9, 16, 3, 59))).toBe(true);
    expect(isNightDate(new Date(2026, 9, 16, 4, 59))).toBe(true);
    expect(isNightDate(new Date(2026, 9, 16, 5, 0))).toBe(false);
    expect(isNightDate(new Date(2026, 9, 16, 12, 0))).toBe(false);
    expect(isNightDate(new Date(2026, 9, 16, 22, 59))).toBe(false);
  });
});

describe("formatTsToSeconds（交易时间 → YYYY-MM-DD HH:mm:ss，本地钟表分量）", () => {
  it("个位数时分秒补零，精确到秒", () => {
    expect(formatTsToSeconds(new Date(2026, 9, 16, 3, 5, 7))).toBe("2026-10-16 03:05:07");
    expect(formatTsToSeconds(new Date(2026, 0, 2, 23, 59, 59))).toBe("2026-01-02 23:59:59");
  });
});

describe("filterTimelineRows（流水客户端筛选）", () => {
  const rows: CalendarTimelineRow[] = [
    { id: 1, ts: new Date(2026, 9, 16, 12, 0), dateIso: "2026-10-16", merchant: "美团外卖", category: "餐饮", amountCents: 2350, direction: "expense" },
    { id: 2, ts: new Date(2026, 9, 16, 13, 0), dateIso: "2026-10-16", merchant: "奖学金到账", category: "其他", amountCents: 80000, direction: "income" },
    { id: 3, ts: new Date(2026, 9, 15, 12, 0), dateIso: "2026-10-15", merchant: "优衣库", category: "购物", amountCents: 9900, direction: "expense" },
  ];

  it("空关键字（含空白）放行全部", () => {
    expect(filterTimelineRows(rows, { query: "", direction: "all" })).toHaveLength(3);
    expect(filterTimelineRows(rows, { query: "   ", direction: "all" })).toHaveLength(3);
  });

  it("关键字同时匹配商户名与类目（trim 后）", () => {
    const byMerchant = filterTimelineRows(rows, { query: "美团", direction: "all" });
    expect(byMerchant.map((r) => r.id)).toEqual([1]);
    const byCategory = filterTimelineRows(rows, { query: "购物", direction: "all" });
    expect(byCategory.map((r) => r.id)).toEqual([3]);
  });

  it("方向档位精确匹配，可与关键字叠加", () => {
    expect(filterTimelineRows(rows, { query: "", direction: "income" }).map((r) => r.id)).toEqual([2]);
    expect(filterTimelineRows(rows, { query: "到账", direction: "expense" })).toEqual([]);
  });
});
