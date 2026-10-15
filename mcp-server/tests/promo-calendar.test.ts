/**
 * get_promo_calendar 过滤逻辑测试（docs/04-rag-mcp.md §8.3）。
 */
import { describe, expect, it } from "vitest";
import { queryPromoCalendar } from "../src/tools/promo-calendar.js";

describe("get_promo_calendar", () => {
  it("无参查询返回全部档期且按日期升序", () => {
    const result = queryPromoCalendar({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.length).toBeGreaterThanOrEqual(6);
    const dates = result.data.map((p) => p.startDate);
    expect([...dates].sort()).toEqual(dates);
  });

  it("日期落点命中双11 预热期（2026-10-21）", () => {
    const result = queryPromoCalendar({ date: "2026-10-21" });
    if (!result.ok) throw new Error("信封应为 ok");
    expect(result.data.map((p) => p.id)).toContain("P2026-1020");
  });

  it("平台过滤：抖音只覆盖双11 相关与双12、年货节档期", () => {
    const result = queryPromoCalendar({ platform: "抖音" });
    if (!result.ok) throw new Error("信封应为 ok");
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data.every((p) => p.platforms.includes("抖音"))).toBe(true);
  });

  it("品类过滤：shopping 为当前唯一品类", () => {
    const result = queryPromoCalendar({ category: "shopping" });
    if (!result.ok) throw new Error("信封应为 ok");
    expect(result.data.every((p) => p.category === "shopping")).toBe(true);
  });

  it("日期 + 平台组合：跨年档在美团平台有投放", () => {
    const result = queryPromoCalendar({ date: "2026-12-28", platform: "美团" });
    if (!result.ok) throw new Error("信封应为 ok");
    expect(result.data.map((p) => p.id)).toContain("P2026-1225");
  });
});
