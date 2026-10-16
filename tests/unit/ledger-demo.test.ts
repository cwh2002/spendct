/**
 * 账本类视图演示行生成器单测（2026-10-16 扩期）：
 * 日期跨度约 13 个月且向近期倾斜——各档日期筛选（近 7/30/90 天）在
 * 演示动线下必须有可见的样本差异，否则账本汇总的范围按钮形同虚设。
 */
import { describe, expect, it } from "vitest";

import { generateLedgerDemoRows } from "@/lib/insights/ledger-demo";

function daysAgo(date: Date, now: Date): number {
  return Math.floor((now.getTime() - date.getTime()) / 86_400_000);
}

describe("generateLedgerDemoRows 演示行形态", () => {
  it("固定 100 行、时间倒序、id 唯一", () => {
    const rows = generateLedgerDemoRows();
    expect(rows).toHaveLength(100);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.date.getTime()).toBeLessThanOrEqual(rows[i - 1]!.date.getTime());
    }
    expect(new Set(rows.map((row) => row.id)).size).toBe(100);
  });

  it("跨度约 13 个月且向近期倾斜：各档筛选行数单调递增且均非空", () => {
    const rows = generateLedgerDemoRows();
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const countWithin = (days: number) =>
      rows.filter((row) => daysAgo(row.date, now) <= days).length;
    const c7 = countWithin(7);
    const c30 = countWithin(30);
    const c90 = countWithin(90);
    expect(c7).toBeGreaterThan(0);
    expect(c30).toBeGreaterThan(c7);
    expect(c90).toBeGreaterThan(c30);
    // 最早一行超出 300 天（13 个月跨度覆盖全档筛选）
    const oldest = rows[rows.length - 1]!;
    expect(daysAgo(oldest.date, now)).toBeGreaterThan(300);
  });
});
