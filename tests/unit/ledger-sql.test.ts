/**
 * 账本汇总日期范围 SQL 模板单测（2026-10-16 修订，07 §6 白名单文法）：
 * 五档范围 × 三块模板必须全部通过白名单预检；范围档注入 date_iso 下限
 * 字面量，「全部」档不加日期条件。日期字面量计算纯函数，不依赖时钟。
 */
import { describe, expect, it } from "vitest";

import {
  categorySql,
  detailSql,
  merchantSql,
  rangeSinceLiteral,
  type LedgerRange,
} from "@/lib/insights/ledger-sql";
import { precheckAggregateSql } from "@/lib/sql-guard/whitelist";

const NOW = new Date("2026-10-16T12:00:00");

describe("rangeSinceLiteral 日期字面量计算", () => {
  it("近 7/30/90 天从当天回拨", () => {
    expect(rangeSinceLiteral("7d", NOW)).toBe("2026-10-09");
    expect(rangeSinceLiteral("30d", NOW)).toBe("2026-09-16");
    expect(rangeSinceLiteral("90d", NOW)).toBe("2026-07-18");
  });

  it("本月取当月 1 日；全部返回 null（不加日期条件）", () => {
    expect(rangeSinceLiteral("month", NOW)).toBe("2026-10-01");
    expect(rangeSinceLiteral("all", NOW)).toBeNull();
  });

  it("跨年回拨正确（1 月初近 7 天回退到 12 月）", () => {
    expect(rangeSinceLiteral("7d", new Date("2026-01-03T08:00:00"))).toBe("2025-12-27");
  });
});

describe("三块 SQL 模板（白名单合规 + 范围生效）", () => {
  const RANGES: LedgerRange[] = ["7d", "30d", "90d", "month", "all"];

  it("全部范围 × 全部模板通过白名单预检（07 §6 文法）", () => {
    for (const range of RANGES) {
      expect(precheckAggregateSql(categorySql(range, NOW)).ok).toBe(true);
      expect(precheckAggregateSql(merchantSql(range, NOW)).ok).toBe(true);
      expect(precheckAggregateSql(detailSql(range, NOW)).ok).toBe(true);
    }
  });

  it("范围档注入 date_iso 下限字面量；「全部」档不含日期条件", () => {
    for (const sql of [categorySql("7d", NOW), merchantSql("7d", NOW), detailSql("7d", NOW)]) {
      expect(sql).toContain("date_iso >= '2026-10-09'");
    }
    for (const sql of [
      categorySql("all", NOW),
      merchantSql("all", NOW),
      detailSql("all", NOW),
    ]) {
      expect(sql).not.toContain("date_iso >=");
    }
  });
});
