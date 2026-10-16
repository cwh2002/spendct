/**
 * 攒钱目标中心（A17）结余与类目动线单测：
 * 覆盖三条聚合 SQL 白名单预检、月度收支行映射（按 SELECT 位置取值 + 脏行过滤）、
 * 预计月结余口径（只取有收入月份平均，无收入返回 null）、类目月支出分摊
 * （活跃月数兜底为 1）与两条演示口径的确定性。
 */
import { describe, expect, it } from "vitest";

import { DEMO_ACCOUNT_META } from "@/lib/demo-data";
import {
  demoCategoryMonthlyCents,
  demoMonthlySurplusCents,
  estimateMonthlySurplus,
  GOALS_ACTIVE_MONTHS_SQL,
  GOALS_CATEGORY_SQL,
  GOALS_MONTHLY_SQL,
  parseCategoryMonthly,
  parseMonthlyIncomeExpense,
} from "@/lib/insights/goals-sql";
import { precheckAggregateSql } from "@/lib/sql-guard/whitelist";

describe("攒钱目标三条聚合 SQL（白名单预检）", () => {
  it("月度收支 / 类目月支出 / 活跃月数全部通过预检", () => {
    expect(precheckAggregateSql(GOALS_MONTHLY_SQL).ok).toBe(true);
    expect(precheckAggregateSql(GOALS_CATEGORY_SQL).ok).toBe(true);
    expect(precheckAggregateSql(GOALS_ACTIVE_MONTHS_SQL).ok).toBe(true);
  });
});

describe("parseMonthlyIncomeExpense（月度收支行映射）", () => {
  it("按 SELECT 列位置取值（0 month / 1 收入 / 2 支出），month 走 fmtMonth 口径", () => {
    const rows = parseMonthlyIncomeExpense([
      { a: "2026-10-01", b: 500000, c: 200000 },
    ]);
    expect(rows).toEqual([{ month: "2026-10", incomeCents: 500000, expenseCents: 200000 }]);
  });

  it("脏行跳过：收支全 0 或月份不完整", () => {
    const rows = parseMonthlyIncomeExpense([
      { a: "2026-10", b: 0, c: 0 },
      { a: "20", b: 100, c: 0 },
      { a: "2026-09", b: 100, c: 0 },
    ]);
    expect(rows).toEqual([{ month: "2026-09", incomeCents: 100, expenseCents: 0 }]);
  });
});

describe("estimateMonthlySurplus（预计月结余）", () => {
  it("只取有收入记录的月份平均（纯支出月份不影响口径）", () => {
    const rows = parseMonthlyIncomeExpense([
      { a: "2026-10", b: 5000, c: 2000 },
      { a: "2026-09", b: 4000, c: 3000 },
      { a: "2026-08", b: 0, c: 1000 },
    ]);
    expect(estimateMonthlySurplus(rows)).toBe(2000); // (3000 + 1000) / 2
  });

  it("无收入记录或空行返回 null（纯支出账单估不出结余）", () => {
    expect(estimateMonthlySurplus(parseMonthlyIncomeExpense([{ a: "2026-10", b: 0, c: 3000 }]))).toBeNull();
    expect(estimateMonthlySurplus([])).toBeNull();
  });
});

describe("parseCategoryMonthly（类目月支出分摊）", () => {
  it("跨月求和按活跃月数分摊到月，活跃月数非法兜底为 1", () => {
    const rows = [
      { a: "餐饮", b: 12000 },
      { a: "交通", b: 6000 },
    ];
    expect(parseCategoryMonthly(rows, 12)).toEqual([
      { category: "餐饮", monthlyCents: 1000 },
      { category: "交通", monthlyCents: 500 },
    ]);
    expect(parseCategoryMonthly(rows, 0)).toEqual([
      { category: "餐饮", monthlyCents: 12000 },
      { category: "交通", monthlyCents: 6000 },
    ]);
  });

  it("脏行跳过：空类目或分摊后金额非正", () => {
    const rows = parseCategoryMonthly(
      [
        { a: " ", b: 1200 },
        { a: "餐饮", b: 1200 },
      ],
      12,
    );
    expect(rows).toEqual([{ category: "餐饮", monthlyCents: 100 }]);
  });
});

describe("演示口径（内置数据兜底）", () => {
  it("演示月结余 = 内置账户年结余 ÷ 覆盖月数（取整）", () => {
    expect(demoMonthlySurplusCents()).toBe(
      Math.round(DEMO_ACCOUNT_META.savedCents / DEMO_ACCOUNT_META.monthsCovered),
    );
  });

  it("演示类目月支出：至多 6 类、按月降序、金额为正、两次生成一致", () => {
    const first = demoCategoryMonthlyCents();
    expect(first.length).toBeGreaterThan(0);
    expect(first.length).toBeLessThanOrEqual(6);
    for (let i = 0; i < first.length; i++) {
      expect(first[i]?.monthlyCents).toBeGreaterThan(0);
      if (i > 0) {
        expect(first[i - 1]!.monthlyCents).toBeGreaterThanOrEqual(first[i]!.monthlyCents);
      }
    }
    expect(demoCategoryMonthlyCents()).toEqual(first);
  });
});
