/**
 * 消费日历演示流水生成器单测：
 * 演示动线（无体检记录）下热力图与流水的兜底数据必须确定性存在
 * 深夜行、收入行与可搜索商户——这些也是 e2e（calendar.spec.ts）
 * 演示动线断言的先决条件，改动生成口径时同步更新本文件与 spec。
 */
import { describe, expect, it } from "vitest";
import { isNightDate } from "@/lib/insights/calendar-aggregate";
import { generateCalendarDemoRows } from "@/lib/insights/calendar-demo";

describe("generateCalendarDemoRows（演示流水生成）", () => {
  const rows = generateCalendarDemoRows();

  it("固定输出 100 行，按时间倒序，id 与 ts 稳定（重渲染不洗牌）", () => {
    expect(rows).toHaveLength(100);
    const sorted = rows.every((r, i) => i === 0 || (rows[i - 1]?.ts.getTime() ?? 0) >= r.ts.getTime());
    expect(sorted).toBe(true);
    // 同一批输入两次生成结果一致
    expect(generateCalendarDemoRows()).toEqual(rows);
  });

  it("含收入行（每 9 笔 1 笔，共 11 行）与深夜行（约 1/4），方向徽标两档均有内容", () => {
    const income = rows.filter((r) => r.direction === "income");
    expect(income).toHaveLength(11);
    expect(income.every((r) => r.category === "其他")).toBe(true);
    const night = rows.filter((r) => isNightDate(r.ts));
    expect(night.length).toBeGreaterThan(0);
    expect(night.length).toBeLessThan(rows.length);
  });

  it("含可搜索的演示商户（e2e 搜索过滤断言依赖）", () => {
    const merchants = new Set(rows.map((r) => r.merchant));
    expect(merchants.has("美团外卖")).toBe(true);
    expect(merchants.has("京东商城")).toBe(true);
  });

  it("dateIso 为 YYYY-MM-DD 且与 ts 同日（本地口径）", () => {
    for (const row of rows) {
      expect(row.dateIso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const pad = (n: number) => String(n).padStart(2, "0");
      expect(row.dateIso).toBe(
        `${row.ts.getFullYear()}-${pad(row.ts.getMonth() + 1)}-${pad(row.ts.getDate())}`,
      );
    }
  });
});
