/**
 * get_school_calendar 过滤逻辑测试（docs/04-rag-mcp.md §8.1）。
 */
import { describe, expect, it } from "vitest";
import { querySchoolCalendar } from "../src/tools/school-calendar.js";

describe("get_school_calendar", () => {
  it("无参查询返回全部事件且按日期升序", () => {
    const result = querySchoolCalendar({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.length).toBeGreaterThanOrEqual(8);
    const dates = result.data.map((e) => e.startDate);
    expect([...dates].sort()).toEqual(dates);
  });

  it("按类型过滤只返回假期类事件", () => {
    const result = querySchoolCalendar({ type: "vacation" });
    if (!result.ok) throw new Error("信封应为 ok");
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data.every((e) => e.type === "vacation")).toBe(true);
  });

  it("日期落点命中考试周（2026-11-05 在期中考试周内）", () => {
    const result = querySchoolCalendar({ date: "2026-11-05" });
    if (!result.ok) throw new Error("信封应为 ok");
    expect(result.data.map((e) => e.id)).toContain("SC-2026-11");
  });

  it("日期落点支持区间边界（含首尾）", () => {
    const start = querySchoolCalendar({ date: "2026-11-02" });
    const end = querySchoolCalendar({ date: "2026-11-13" });
    if (!start.ok || !end.ok) throw new Error("信封应为 ok");
    expect(start.data.map((e) => e.id)).toContain("SC-2026-11");
    expect(end.data.map((e) => e.id)).toContain("SC-2026-11");
  });

  it("组合过滤：毕业季 + 2027-06-15 命中毕业季事件", () => {
    const result = querySchoolCalendar({ type: "graduation", date: "2027-06-15" });
    if (!result.ok) throw new Error("信封应为 ok");
    expect(result.data.map((e) => e.id)).toContain("SC-2027-grad");
  });

  it("无命中时返回 ok 信封 + 空数组（而非失败）", () => {
    const result = querySchoolCalendar({ date: "1999-01-01" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual([]);
  });
});
