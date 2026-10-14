/**
 * 阶段 5 attribution 环比归因（07 §3 注册表 attribution_mom_stats，
 * 物化自 v_mom_category：month × category 的 cur_cents / prev_cents / change_ratio）。
 *
 * 模板侧只做「最近完整月 vs 上月」的环比（v_mom_category 的 LAG 语义），
 * 取最新月各品类中涨幅/跌幅最大的两张卡。白名单限制 LIMIT ≤50，
 * 按月×类目分组后以 ORDER BY month DESC LIMIT 50 取最新若干行，
 * JS 侧再筛出最新月的行（每类目一行，共 ≤12 行，不会被截断）。
 * 无环比数据（如单月数据集、上月无支出）时产「未发现」卡交 reflect 拦下。
 */
import {
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

/** 环比变化率（百分数，1 位小数；上月无支出时返回 null 表示不可比） */
function momPct(cur: number, prev: number): number | null {
  if (prev <= 0) return null;
  return ((cur - prev) / prev) * 100;
}

export const ATTRIBUTION_EXECUTOR: StageExecutor = {
  stage: "attribution",
  queries: [
    {
      tableId: "attribution_mom_stats",
      sql: "SELECT month, category, SUM(cur_cents), SUM(prev_cents) FROM attribution_mom_stats GROUP BY month, category ORDER BY month DESC LIMIT 50",
    },
  ],
  buildCardInputs(evidence) {
    const mom = evidence[0]!;
    const inputs: TemplateCardInput[] = [];

    // 取最新月的类目行（SQL 已按 month DESC，这里再兜底按字符串比较取最大值）
    const rows = mom.rows;
    if (rows.length === 0) {
      inputs.push(
        noFindingsInput("attribution", 1, {
          headline: "环比归因样本不足",
          narrative: "类目环比聚合无数据，无法生成归因卡。请先导入更多账单后再体检。",
          tableId: "attribution_mom_stats",
        }),
      );
      return inputs;
    }
    const latestMonth = rows.reduce(
      (max, row) => {
        const m = fmtMonth(valAt(row, 0));
        return m > max ? m : max;
      },
      "",
    );
    // 图表行过滤的月份等值形态（month 列为 date_trunc 的月首 TIMESTAMP，
    // 字符串字面量比较由 DuckDB 自动转型；regex 见 ChartSpecSchema）
    const m01 = `${latestMonth}-01`;
    const pairs = rows.filter((row) => fmtMonth(valAt(row, 0)) === latestMonth);

    interface MomPair {
      category: string;
      cur: number;
      prev: number;
      pct: number;
    }
    const pairsWithPct: MomPair[] = [];
    for (const row of pairs) {
      const cur = numAt(row, 2);
      const prev = numAt(row, 3);
      const pct = momPct(cur, prev);
      if (pct !== null) {
        pairsWithPct.push({ category: String(valAt(row, 1)), cur, prev, pct });
      }
    }
    const risers = pairsWithPct.filter((p) => p.pct >= 5).sort((a, b) => b.pct - a.pct);
    const fallers = pairsWithPct.filter((p) => p.pct <= -5).sort((a, b) => a.pct - b.pct);

    let seq = 0;

    // 卡 1：涨幅最大类目
    const riser = risers[0];
    if (riser) {
      seq += 1;
      const pctText = riser.pct.toFixed(1);
      const delta = riser.cur - riser.prev;
      inputs.push({
        cardId: makeCardId("attribution", seq),
        headline: `${riser.category} 环比涨幅最大 · +${pctText}%`,
        narrative:
          `${latestMonth} 月 ${riser.category} 支出 ¥${fmtYuan(riser.cur)}，` +
          `较上月 ¥${fmtYuan(riser.prev)} 增加 ${pctText}%（+¥${fmtYuan(delta)}）。` +
          `若由单笔大额订单驱动属一次性脉冲；若连续多月爬升，建议纳入月度预算复盘。`,
        confidence: riser.pct >= 20 ? 0.85 : 0.7,
        significance: `${riser.category} 环比 +${pctText}% · 增量 ¥${fmtYuan(delta)}`,
        evidence: {
          chart: {
            tableId: "attribution_mom_stats",
            chartType: "bar",
            title: "各类目环比涨幅",
            dimField: "category",
            // 环比变化率（%）：只查最新月行，HAVING 排除上月无支出的 NULL 新类目假柱
            measureFields: ["change_ratio"],
            where: `month = '${m01}'`,
            having: "AVG(change_ratio) > 0",
            topN: 12,
          },
          stats: [
            { label: "本月支出", value: fmtYuan(riser.cur), unit: "元" },
            { label: "上月支出", value: fmtYuan(riser.prev), unit: "元" },
            { label: "环比变化", value: `+${pctText}%` },
          ],
        },
        sources: [sqlCitation("table", "attribution_mom_stats"), ruleCitation("mom-drift-v2")],
      });
    }

    // 卡 2：跌幅最大类目
    const faller = fallers[0];
    if (faller) {
      seq += 1;
      const pctText = Math.abs(faller.pct).toFixed(1);
      const delta = faller.prev - faller.cur;
      inputs.push({
        cardId: makeCardId("attribution", seq),
        headline: `${faller.category} 环比回落 · -${pctText}%`,
        narrative:
          `${latestMonth} 月 ${faller.category} 支出 ¥${fmtYuan(faller.cur)}，` +
          `较上月 ¥${fmtYuan(faller.prev)} 减少 ${pctText}%（-¥${fmtYuan(delta)}）。` +
          `支出回落通常是对上月高点的回归，可观察下月是否延续。`,
        confidence: Math.abs(faller.pct) >= 20 ? 0.85 : 0.7,
        significance: `${faller.category} 环比 -${pctText}% · 减少 ¥${fmtYuan(delta)}`,
        evidence: {
          chart: {
            tableId: "attribution_mom_stats",
            chartType: "bar",
            title: "各类目环比回落",
            dimField: "category",
            measureFields: ["change_ratio"],
            where: `month = '${m01}'`,
            having: "AVG(change_ratio) < 0",
            sortBy: "asc",
            topN: 12,
          },
          stats: [
            { label: "本月支出", value: fmtYuan(faller.cur), unit: "元" },
            { label: "上月支出", value: fmtYuan(faller.prev), unit: "元" },
            { label: "环比变化", value: `-${pctText}%` },
          ],
        },
        sources: [sqlCitation("table", "attribution_mom_stats"), ruleCitation("mom-drift-v2")],
      });
    }

    if (inputs.length === 0) {
      inputs.push(
        noFindingsInput("attribution", 1, {
          headline: "最近月未发现显著环比变化",
          narrative: "最新月各类目支出与上月基本持平（±5% 内），未命中归因门槛。",
          tableId: "attribution_mom_stats",
        }),
      );
    }
    return inputs;
  },
};
