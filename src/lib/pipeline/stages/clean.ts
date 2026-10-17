/**
 * 阶段 1 clean 清洗：行数/总额总览（07 §3 注册表 clean_overview）。
 * 输出「共 N 笔 · 总额 ¥X」卡；0 行时抛 EmptyDatasetError，
 * 引擎映射 EMPTY_DATASET（不可重试），该阶段 failed 后继续后续阶段（降级原则）。
 */
import {
  EmptyDatasetError,
  fmtMonth,
  fmtYuan,
  makeCardId,
  numAt,
  sqlCitation,
  valAt,
  type StageExecutor,
  type TemplateCardInput,
} from "./spec";

export const CLEAN_EXECUTOR: StageExecutor = {
  stage: "clean",
  queries: [
    {
      tableId: "clean_overview",
      sql: "SELECT account_id, SUM(total_rows), SUM(duplicate_rows), SUM(active_days), SUM(refund_rows) FROM clean_overview GROUP BY account_id LIMIT 50",
    },
    {
      tableId: "v_monthly_summary",
      sql: "SELECT month, SUM(expense_cents), SUM(income_cents), SUM(expense_tx) FROM v_monthly_summary GROUP BY month ORDER BY month ASC LIMIT 50",
    },
  ],
  buildCardInputs(evidence) {
    const overview = evidence[0]!;
    const monthly = evidence[1]!;

    const totalRows = overview.rows.reduce((sum, row) => sum + numAt(row, 1), 0);
    if (totalRows <= 0) {
      throw new EmptyDatasetError();
    }
    const activeDays = overview.rows.reduce((sum, row) => sum + numAt(row, 3), 0);
    const refundRows = overview.rows.reduce((sum, row) => sum + numAt(row, 4), 0);

    const totalOut = monthly.rows.reduce((sum, row) => sum + numAt(row, 1), 0);
    const totalIn = monthly.rows.reduce((sum, row) => sum + numAt(row, 2), 0);
    const firstMonth = monthly.rows.length > 0 ? fmtMonth(valAt(monthly.rows[0]!, 0)) : "-";
    const lastMonth =
      monthly.rows.length > 0 ? fmtMonth(valAt(monthly.rows[monthly.rows.length - 1]!, 0)) : "-";

    const input: TemplateCardInput = {
      cardId: makeCardId("clean", 1),
      headline: `共 ${totalRows} 笔账单 · 支出总额 ¥${fmtYuan(totalOut)}`,
      narrative:
        `本次体检解析账单 ${totalRows} 笔，` +
        `覆盖 ${activeDays} 个自然日（${firstMonth} 至 ${lastMonth}）；` +
        `支出合计 ¥${fmtYuan(totalOut)}，收入合计 ¥${fmtYuan(totalIn)}，含退款 ${refundRows} 笔。` +
        `后续五个阶段均基于该清洗结果分析。`,
      confidence: 0.95,
      significance: `样本 ${totalRows} 笔`,
      evidence: {
        chart: {
          tableId: "clean_overview",
          chartType: "bar",
          title: "清洗总览",
          dimField: "account_id",
          measureFields: ["total_rows"],
        },
        stats: [
          { label: "总笔数", value: String(totalRows) },
          { label: "支出总额", value: fmtYuan(totalOut), unit: "元" },
          { label: "覆盖天数", value: String(activeDays) },
        ],
      },
      sources: [sqlCitation("table", "clean_overview")],
    };
    return [input];
  },
};
