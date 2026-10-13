/**
 * 阶段 2 profile 消费画像：类目占比 top3 + 月度走势（07 §3 注册表
 * profile_category_stats / profile_monthly_stats）。
 * 产出 2 张卡：「最大支出类目」卡（占比 top3）与「月均支出」卡。
 */
import {
  fmtMonth,
  fmtYuan,
  makeCardId,
  noFindingsInput,
  numAt,
  sqlCitation,
  valAt,
  type StageExecutor,
  type TemplateCardInput,
} from "./spec";

/** 占比百分比（1 位小数），total 为 0 时兜底 0.0 */
function sharePct(part: number, total: number): string {
  return total > 0 ? ((part / total) * 100).toFixed(1) : "0.0";
}

export const PROFILE_EXECUTOR: StageExecutor = {
  stage: "profile",
  queries: [
    {
      tableId: "profile_category_stats",
      sql: "SELECT category, SUM(expense_cents), SUM(expense_tx) FROM profile_category_stats GROUP BY category ORDER BY SUM(expense_cents) DESC LIMIT 50",
    },
    {
      tableId: "profile_monthly_stats",
      sql: "SELECT month, SUM(expense_cents), SUM(expense_tx), SUM(active_days) FROM profile_monthly_stats GROUP BY month ORDER BY month ASC LIMIT 50",
    },
  ],
  buildCardInputs(evidence) {
    const categories = evidence[0]!;
    const months = evidence[1]!;
    const inputs: TemplateCardInput[] = [];

    // 卡 1：最大支出类目（top3 占比）
    if (categories.rows.length > 0) {
      const rows = [...categories.rows].sort((a, b) => numAt(b, 1) - numAt(a, 1));
      const top = rows[0]!;
      const topCategory = String(valAt(top, 0));
      const topCents = numAt(top, 1);
      const topCount = numAt(top, 2);
      const totalCents = rows.reduce((sum, row) => sum + numAt(row, 1), 0);
      const second = rows[1];
      const third = rows[2];

      const narrativeParts = [
        `近 12 个月 ${topCategory} 类支出 ¥${fmtYuan(topCents)}，占总支出的 ${sharePct(topCents, totalCents)}%。`,
      ];
      if (second) {
        narrativeParts.push(
          `其次为 ${String(valAt(second, 0))}（${sharePct(numAt(second, 1), totalCents)}%）。`,
        );
      }
      if (third) {
        narrativeParts.push(
          `${String(valAt(third, 0))} 排第三（${sharePct(numAt(third, 1), totalCents)}%）。`,
        );
      }
      narrativeParts.push(
        `类目集中度可用作下月预算分配参考，明细见 /insights 账本汇总。`,
      );

      inputs.push({
        cardId: makeCardId("profile", 1),
        headline: `${topCategory} 是最大支出类目，占总支出的 ${sharePct(topCents, totalCents)}%`,
        narrative: narrativeParts.join(""),
        confidence: 0.9,
        significance: `${topCategory} 占比 ${sharePct(topCents, totalCents)}%，样本 ${topCount} 笔`,
        evidence: {
          chart: {
            tableId: "profile_category_stats",
            chartType: "pie",
            title: "类目占比",
            dimField: "category",
            measureFields: ["expense_cents"],
            sortBy: "desc",
            topN: 8,
          },
          stats: [
            { label: topCategory, value: fmtYuan(topCents), unit: "元" },
            { label: "占比", value: `${sharePct(topCents, totalCents)}%` },
            { label: "笔数", value: String(topCount) },
          ],
        },
        sources: [sqlCitation("table", "profile_category_stats")],
      });
    }

    // 卡 2：月均支出与月度波动
    if (months.rows.length > 0) {
      const totals = months.rows.map((row) => numAt(row, 1));
      const monthSum = totals.reduce((sum, value) => sum + value, 0);
      const monthAvg = monthSum / months.rows.length;
      let peakIndex = 0;
      let troughIndex = 0;
      for (let index = 1; index < totals.length; index++) {
        if (totals[index]! > totals[peakIndex]!) peakIndex = index;
        if (totals[index]! < totals[troughIndex]!) troughIndex = index;
      }
      const peakMonth = fmtMonth(valAt(months.rows[peakIndex]!, 0));
      const troughMonth = fmtMonth(valAt(months.rows[troughIndex]!, 0));

      inputs.push({
        cardId: makeCardId("profile", 2),
        headline: `月均支出 ¥${fmtYuan(monthAvg)}，${peakMonth} 支出最高`,
        narrative:
          `近 12 个月月均支出 ¥${fmtYuan(monthAvg)}；` +
          `最高月为 ${peakMonth}（¥${fmtYuan(totals[peakIndex]!)}），` +
          `最低月为 ${troughMonth}（¥${fmtYuan(totals[troughIndex]!)}）。` +
          `月度波动属于正常消费节奏，可与月度预算对比查看超支月份。`,
        confidence: 0.85,
        significance: `月度样本 ${months.rows.length} 个，月均 ¥${fmtYuan(monthAvg)}`,
        evidence: {
          chart: {
            tableId: "profile_monthly_stats",
            chartType: "line",
            title: "月度支出走势",
            dimField: "month",
            measureFields: ["expense_cents"],
          },
          stats: [
            { label: "月均支出", value: fmtYuan(monthAvg), unit: "元" },
            { label: "最高月", value: peakMonth },
            { label: "最低月", value: troughMonth },
          ],
        },
        sources: [sqlCitation("table", "profile_monthly_stats")],
      });
    }

    if (inputs.length === 0) {
      inputs.push(
        noFindingsInput("profile", 1, {
          headline: "消费画像样本不足",
          narrative: "类目与月度聚合均无数据，无法生成画像卡。请先导入更多账单后再体检。",
          tableId: "profile_category_stats",
        }),
      );
    }
    return inputs;
  },
};
