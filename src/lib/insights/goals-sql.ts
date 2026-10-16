/**
 * 攒钱目标中心（修订案 A17）的结余与类目动线。
 *
 * 目标页的「预计月结余」与「省 X 可提前 Y 个月」建议来自两条确定性聚合
 * SQL（代码常量、零用户输入），统一经 runWhitelistedAggregate 执行：
 * - 月度收支：v_monthly_summary 最近 6 个月，逐月 收入 − 支出 = 月结余，
 *   取有收入记录月份的平均作为预计月结余；
 * - 类目月支出：v_category_monthly 跨月求和取前 6 类，再除以活跃月数
 *   分摊到月（真实动线），供加速建议使用；
 * 演示动线：月结余 = 内置账户年结余 3,200 元 ÷ 12 个月（demo-data.ts 口径），
 * 类目月支出由 ledger-demo.ts 演示行聚合（跨度 13 个月）。
 * 全部为纯函数，可直接单测。
 */

import { DEMO_ACCOUNT_META } from "@/lib/demo-data";
import { generateLedgerDemoRows } from "@/lib/insights/ledger-demo";
import { fmtMonth } from "@/lib/pipeline/stages/spec";

/** 月度收支聚合：近 6 个月逐月收入/支出（白名单可执行：GROUP BY 单列、LIMIT 6） */
export const GOALS_MONTHLY_SQL =
  "SELECT month, SUM(income_cents), SUM(expense_cents) FROM v_monthly_summary " +
  "GROUP BY month ORDER BY month DESC LIMIT 6";

/** 类目月支出聚合：跨月求和取前 6 类（月分摊在解析层按活跃月数完成） */
export const GOALS_CATEGORY_SQL =
  "SELECT category, SUM(expense_cents) FROM v_category_monthly " +
  "GROUP BY category ORDER BY SUM(expense_cents) DESC LIMIT 6";

/** 活跃月数聚合：v_monthly_summary 每 (account_id, month) 一行，COUNT(*) 即去重月数 */
export const GOALS_ACTIVE_MONTHS_SQL =
  "SELECT COUNT(*) FROM v_monthly_summary GROUP BY account_id";

/** 逐月收支行：month 展示为 YYYY-MM（fmtMonth 口径，与引擎月份展示一致） */
export interface MonthlyIncomeExpense {
  month: string;
  incomeCents: number;
  expenseCents: number;
}

/** 类目月支出行：月分摊后的金额（分） */
export interface CategoryMonthlyCents {
  category: string;
  monthlyCents: number;
}

/** DuckDB 数值兜底转数值：BIGINT → bigint、INTEGER → number、HUGEINT → 大数对象，不可解析兜底 0 */
function toCents(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return Math.round(value);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

/** 月度收支查询行 → 逐月收支（按 SELECT 位置取值：0 month / 1 收入 / 2 支出），脏行跳过 */
export function parseMonthlyIncomeExpense(
  rows: Record<string, unknown>[],
): MonthlyIncomeExpense[] {
  return rows
    .map((row) => {
      const values = Object.values(row);
      return {
        month: fmtMonth(values[0]),
        incomeCents: toCents(values[1]),
        expenseCents: toCents(values[2]),
      };
    })
    .filter((row) => row.month.length >= 4 && (row.incomeCents > 0 || row.expenseCents > 0));
}

/**
 * 预计月结余：只取有收入记录的月份（纯支出账单估不出结余）平均 (收入 − 支出)。
 * 全部为 0 或无行时返回 null，由调用方回退演示口径。
 */
export function estimateMonthlySurplus(rows: MonthlyIncomeExpense[]): number | null {
  const withIncome = rows.filter((row) => row.incomeCents > 0);
  if (withIncome.length === 0) return null;
  const total = withIncome.reduce(
    (sum, row) => sum + row.incomeCents - row.expenseCents,
    0,
  );
  return Math.round(total / withIncome.length);
}

/** 类目月支出查询行 → 类目月支出（SELECT 位置 0 category / 1 SUM），再按活跃月数分摊到月 */
export function parseCategoryMonthly(
  rows: Record<string, unknown>[],
  activeMonths: number,
): CategoryMonthlyCents[] {
  const months = activeMonths > 0 ? activeMonths : 1;
  return rows
    .map((row) => {
      const values = Object.values(row);
      return {
        category: String(values[0] ?? "").trim(),
        monthlyCents: Math.round(toCents(values[1]) / months),
      };
    })
    .filter((point) => point.category.length > 0 && point.monthlyCents > 0);
}

/** 演示口径月结余：内置账户年结余 3,200 元 ÷ 12 个月 ≈ 267 元/月（demo-data.ts 口径） */
export function demoMonthlySurplusCents(): number {
  return Math.round(DEMO_ACCOUNT_META.savedCents / DEMO_ACCOUNT_META.monthsCovered);
}

/**
 * 演示口径类目月支出：ledger-demo.ts 的 100 行演示明细聚合到类目，
 * 跨度约 13 个月（该生成器的覆盖口径），取前 6 类。
 */
export function demoCategoryMonthlyCents(): CategoryMonthlyCents[] {
  const sums = new Map<string, number>();
  for (const row of generateLedgerDemoRows()) {
    sums.set(row.category, (sums.get(row.category) ?? 0) + row.amountCents);
  }
  const months = 13;
  return [...sums.entries()]
    .map(([category, cents]) => ({ category, monthlyCents: Math.round(cents / months) }))
    .sort((a, b) => b.monthlyCents - a.monthlyCents)
    .slice(0, 6);
}
