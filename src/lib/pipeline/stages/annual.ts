/**
 * 阶段 6 annual 年度报告（07 §3 注册表 annual_summary，物化自 v_yearly：
 * 年度支出/收入/笔数 + 月均与结余率）。
 *
 * 产出 1-2 张卡：最新年度总览卡（支出/结余率/月均）+ 跨年同比卡
 * （数据跨两个日历年时）。年度无数据时产「未发现」卡交 reflect 拦下。
 */
import {
  fmtYuan,
  makeCardId,
  noFindingsInput,
  numAt,
  sqlCitation,
  valAt,
  type StageExecutor,
  type TemplateCardInput,
} from "./spec";

/** 年份展示：EXTRACT(YEAR) 可能返回 bigint/number/字符串，统一取整 */
function fmtYear(value: unknown): string {
  if (typeof value === "bigint") return String(Number(value));
  if (typeof value === "number") return String(Math.round(value));
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(Math.round(parsed)) : String(value ?? "");
}

export const ANNUAL_EXECUTOR: StageExecutor = {
  stage: "annual",
  queries: [
    {
      tableId: "annual_summary",
      sql: "SELECT year, SUM(expense_cents), SUM(income_cents), SUM(tx_count), AVG(avg_monthly_cents), AVG(savings_rate_pct) FROM annual_summary GROUP BY year ORDER BY year ASC LIMIT 50",
    },
  ],
  buildCardInputs(evidence) {
    const annual = evidence[0]!;
    const inputs: TemplateCardInput[] = [];

    const rows = [...annual.rows].sort((a, b) => numAt(a, 0) - numAt(b, 0));
    if (rows.length === 0) {
      inputs.push(
        noFindingsInput("annual", 1, {
          headline: "年度汇总样本不足",
          narrative: "年度聚合无数据，无法生成年度卡。请先导入更多账单后再体检。",
          tableId: "annual_summary",
        }),
      );
      return inputs;
    }

    // 卡 1：最新年度总览
    const last = rows[rows.length - 1]!;
    const lastYear = fmtYear(valAt(last, 0));
    const lastExpense = numAt(last, 1);
    const lastIncome = numAt(last, 2);
    const lastTx = numAt(last, 3);
    const lastAvgMonthly = numAt(last, 4);
    const lastSavings = numAt(last, 5);

    inputs.push({
      cardId: makeCardId("annual", 1),
      headline: `${lastYear} 年支出 ¥${fmtYuan(lastExpense)} · 结余率 ${lastSavings.toFixed(1)}%`,
      narrative:
        `${lastYear} 年支出 ¥${fmtYuan(lastExpense)}，收入 ¥${fmtYuan(lastIncome)}，` +
        `结余率 ${lastSavings.toFixed(1)}%，月均支出 ¥${fmtYuan(lastAvgMonthly)}，` +
        `全年共 ${lastTx} 笔。年度收支结构已汇总，可与年度预算完成情况对比复盘。`,
      confidence: 0.9,
      significance: `${lastYear} 年样本 ${lastTx} 笔 · 结余率 ${lastSavings.toFixed(1)}%`,
      evidence: {
        chart: {
          tableId: "annual_summary",
          chartType: "bar",
          title: "年度支出",
          dimField: "year",
          measureFields: ["expense_cents"],
        },
        stats: [
          { label: "年支出", value: fmtYuan(lastExpense), unit: "元" },
          { label: "年收入", value: fmtYuan(lastIncome), unit: "元" },
          { label: "结余率", value: `${lastSavings.toFixed(1)}%` },
          { label: "月均支出", value: fmtYuan(lastAvgMonthly), unit: "元" },
        ],
      },
      sources: [sqlCitation("table", "annual_summary")],
    });

    // 卡 2：跨年同比（数据跨两个日历年且两年都有支出时）
    const first = rows[0]!;
    if (rows.length >= 2 && numAt(first, 1) > 0 && lastExpense > 0) {
      const firstYear = fmtYear(valAt(first, 0));
      const firstExpense = numAt(first, 1);
      const firstSavings = numAt(first, 5);
      const pct = ((lastExpense - firstExpense) / firstExpense) * 100;
      const pctText = Math.abs(pct).toFixed(1);
      const direction = pct >= 0 ? "增长" : "回落";

      inputs.push({
        cardId: makeCardId("annual", 2),
        headline: `${lastYear} 年支出较 ${firstYear} 年${direction} ${pctText}%`,
        narrative:
          `${firstYear} 年支出 ¥${fmtYuan(firstExpense)}，` +
          `${lastYear} 年支出 ¥${fmtYuan(lastExpense)}，同比${direction} ${pctText}%。` +
          `结余率由 ${firstSavings.toFixed(1)}% 变为 ${lastSavings.toFixed(1)}%。` +
          `年度变化反映消费规模趋势，建议结合收入变动一起看。`,
        confidence: 0.8,
        significance: `同比${direction} ${pctText}% · 两年样本 ${numAt(first, 3) + lastTx} 笔`,
        evidence: {
          chart: {
            tableId: "annual_summary",
            chartType: "bar",
            title: "年度对比",
            dimField: "year",
            measureFields: ["expense_cents"],
          },
          stats: [
            { label: "当年支出", value: fmtYuan(lastExpense), unit: "元" },
            { label: "上年支出", value: fmtYuan(firstExpense), unit: "元" },
            { label: "同比变化", value: `${pct >= 0 ? "+" : "-"}${pctText}%` },
          ],
        },
        sources: [sqlCitation("table", "annual_summary")],
      });
    }

    return inputs;
  },
};
