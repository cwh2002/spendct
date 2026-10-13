/**
 * 阶段 3 anomaly 异常检测：深夜消费卡 + 大额脉冲日卡（07 §3 注册表
 * v_night_spend / anomaly_daily_stats）。
 *
 * 深夜口径与视图一致：23:00-05:00（07 §3 唯一深夜语义），按月聚合；
 * 脉冲口径：anomaly_daily_stats 预计算表已含全量日基线的 mu/sigma/zscore，
 * 白名单禁止 WHERE 小数常量比较，模板侧在 JS 里筛 zscore > 2.5（与
 * v_anomaly_daily 视图口径一致）。脉冲日无命中时不产卡（该阶段允许 1-3 张）。
 */
import {
  fmtDate,
  fmtMonth,
  fmtYuan,
  makeCardId,
  noFindingsInput,
  numAt,
  ruleCitation,
  sqlCitation,
  valAt,
  type StageExecutor,
  type TemplateCardInput,
} from "./spec";

export const ANOMALY_EXECUTOR: StageExecutor = {
  stage: "anomaly",
  queries: [
    {
      tableId: "v_night_spend",
      sql: "SELECT month, SUM(night_cents), AVG(night_ratio) FROM v_night_spend GROUP BY month ORDER BY month ASC LIMIT 50",
    },
    {
      tableId: "anomaly_daily_stats",
      sql: "SELECT date_iso, SUM(total_cents), SUM(tx_count), MAX(zscore), AVG(mu), AVG(sigma) FROM anomaly_daily_stats GROUP BY date_iso ORDER BY SUM(total_cents) DESC LIMIT 50",
    },
  ],
  buildCardInputs(evidence, ctx) {
    const nights = evidence[0]!;
    const pulse = evidence[1]!;
    const inputs: TemplateCardInput[] = [];

    // 卡 1：深夜消费（23:00-05:00）
    const nightRows = nights.rows.filter((row) => numAt(row, 1) > 0);
    const totalNight = nightRows.reduce((sum, row) => sum + numAt(row, 1), 0);
    if (totalNight > 0) {
      // 深夜占比：深夜总额 / 体检期支出总额（clean 阶段 v_monthly_summary 证据）
      const cleanMonthly = ctx.getEvidence("clean")[1];
      const totalExpense = cleanMonthly
        ? cleanMonthly.rows.reduce((sum, row) => sum + numAt(row, 1), 0)
        : 0;
      const ratioPct = totalExpense > 0 ? ((totalNight / totalExpense) * 100).toFixed(1) : "0.0";
      const monthsWithNight = nightRows.length;
      const latestMonth = nightRows.length > 0 ? fmtMonth(valAt(nightRows[nightRows.length - 1]!, 0)) : "-";

      inputs.push({
        cardId: makeCardId("anomaly", 1),
        headline: `深夜消费（23:00-05:00）¥${fmtYuan(totalNight)} · 占支出 ${ratioPct}%`,
        narrative:
          `近 12 个月深夜时段累计消费 ¥${fmtYuan(totalNight)}，` +
          `${monthsWithNight} 个月出现，占体检期总支出的 ${ratioPct}%，最近出现在 ${latestMonth}。` +
          `深夜单笔多为即时冲动型消费，长期偏高建议设置夜间支付冷静期。`,
        confidence: 0.85,
        significance: `深夜消费 ${monthsWithNight} 个月 · 合计 ¥${fmtYuan(totalNight)}`,
        evidence: {
          chart: {
            tableId: "v_night_spend",
            chartType: "bar",
            title: "深夜消费分布",
            dimField: "month",
            measureFields: ["night_cents"],
          },
          stats: [
            { label: "深夜总支出", value: fmtYuan(totalNight), unit: "元" },
            { label: "出现月数", value: String(monthsWithNight) },
            { label: "占支出比", value: `${ratioPct}%` },
          ],
        },
        sources: [sqlCitation("view", "v_night_spend"), ruleCitation("late-night-v1")],
      });
    } else {
      inputs.push(
        noFindingsInput("anomaly", 1, {
          headline: "近 12 个月无深夜时段消费记录",
          narrative: "23:00-05:00 时段无支出记录，作息消费习惯健康。",
          tableId: "v_night_spend",
        }),
      );
    }

    // 卡 2：大额脉冲日（zscore > 2.5）
    const pulses = pulse.rows
      .filter((row) => numAt(row, 3) > 2.5)
      .sort((a, b) => numAt(b, 3) - numAt(a, 3));
    if (pulses.length > 0) {
      const top = pulses[0]!;
      const date = fmtDate(valAt(top, 0));
      const totalCents = numAt(top, 1);
      const txCount = numAt(top, 2);
      const zscore = numAt(top, 3);
      const mu = numAt(top, 4);

      inputs.push({
        cardId: makeCardId("anomaly", 2),
        headline: `${date} 单日支出 ¥${fmtYuan(totalCents)} · 偏离基线 ${zscore.toFixed(1)} 个标准差`,
        narrative:
          `${date} 支出 ¥${fmtYuan(totalCents)}（${txCount} 笔），` +
          `较日基线均值 ¥${fmtYuan(mu)} 高出 ${zscore.toFixed(1)} 个标准差，属于显著大额脉冲。` +
          `若为计划内大额支出（家电、旅行等）属正常波动；否则建议回看该日账单明细。` +
          (pulses.length > 1 ? `另有 ${pulses.length - 1} 个异常日可查看。` : ""),
        confidence: zscore >= 4 ? 0.9 : 0.8,
        significance: `z-score ${zscore.toFixed(1)} · 当日 ${txCount} 笔`,
        evidence: {
          chart: {
            tableId: "anomaly_daily_stats",
            chartType: "bar",
            title: "异常日支出",
            dimField: "date_iso",
            measureFields: ["total_cents"],
          },
          stats: [
            { label: "当日支出", value: fmtYuan(totalCents), unit: "元" },
            { label: "z-score", value: zscore.toFixed(1) },
            { label: "当日笔数", value: String(txCount) },
          ],
        },
        sources: [sqlCitation("table", "anomaly_daily_stats"), ruleCitation("pulse-z-v1")],
      });
    }

    return inputs;
  },
};
