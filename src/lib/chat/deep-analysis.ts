/**
 * 追问「深度分析」（08 修订案 A14）的全期账单聚合上下文。
 *
 * 追问面板开启「深度分析」开关后，提问跳过本地规则直接转在线兜底，
 * 上下文由本模块的全期聚合块 + qa-engine 的最近明细快照（A8）组成：
 * - 全部查询为代码常量白名单聚合 SQL（零用户输入、零动态拼接），
 *   每个结果 ≤50 行，只产出统计数字、绝不含逐笔明细；
 * - 时间口径为全期（不设时间窗），与日常兜底的本月/近 90 天口径互补；
 * - 组装成的文本块上限 2400 字，超长从末尾整条丢弃（每条一组统计，
 *   丢弃后语义仍完整）；任何一组查询失败即省略该组。
 */

import { fmtMonth, numAt, valAt } from "@/lib/pipeline/stages/spec";

import { asRowList, merchantName, yuanText, type SqlRunner } from "./qa-engine";

/** 深度分析上下文文本块上限（字）：超长按行整条丢弃，保证单条语义完整 */
export const DEEP_CONTEXT_MAX_LENGTH = 2400;

/** 逐月趋势在文本里保留的最近月数（查询仍取全期 ≤50 月，文本层截取头部） */
const TREND_MONTHS_IN_TEXT = 12;

/**
 * 深度分析使用的固定白名单查询清单（导出供单测逐一过 precheckAggregateSql 预检）。
 * 顺序即组装顺序，与 buildDeepAnalysisContext 的取值一一对应：
 *   0 全期数据范围（首末日期 + 支出笔数）｜1 全期支出类目排行
 *   2 全期商户 Top10｜3 逐月收支趋势｜4 单笔支出金额分布
 *   5 全期收入类目排行｜6 深夜消费逐月（≤50 月）｜7 冲动消费按类目（≤12 类目，全期不截断）｜8 订阅候选｜9 收支总额
 */
export function buildDeepAnalysisQueries(): string[] {
  return [
    `SELECT account_id, COUNT(*), MIN(date_iso), MAX(date_iso) FROM transactions WHERE direction = 'expense' AND status = 'paid' GROUP BY account_id LIMIT 1`,
    `SELECT category, SUM(amount_cents), COUNT(*) FROM transactions WHERE direction = 'expense' AND status = 'paid' GROUP BY category ORDER BY SUM(amount_cents) DESC LIMIT 50`,
    `SELECT merchant, SUM(amount_cents), COUNT(*) FROM transactions WHERE direction = 'expense' AND status = 'paid' GROUP BY merchant ORDER BY SUM(amount_cents) DESC LIMIT 10`,
    `SELECT month, SUM(expense_cents), SUM(income_cents), SUM(expense_tx) FROM v_monthly_summary GROUP BY month ORDER BY month DESC LIMIT 50`,
    `SELECT direction, COUNT(*), MIN(amount_cents), MAX(amount_cents), ROUND(AVG(amount_cents), 1), ROUND(MEDIAN(amount_cents), 1) FROM transactions WHERE direction = 'expense' AND status = 'paid' GROUP BY direction`,
    `SELECT category, SUM(amount_cents), COUNT(*) FROM transactions WHERE direction = 'income' AND status = 'paid' GROUP BY category ORDER BY SUM(amount_cents) DESC LIMIT 50`,
    `SELECT month, SUM(night_cents) FROM v_night_spend GROUP BY month ORDER BY month DESC LIMIT 50`,
    `SELECT category, SUM(amount_cents), COUNT(*) FROM v_impulse_events GROUP BY category LIMIT 50`,
    `SELECT merchant, MAX(avg_cents), SUM(n), MAX(months_active) FROM v_subscription_candidates GROUP BY merchant ORDER BY SUM(n) DESC LIMIT 10`,
    `SELECT direction, SUM(amount_cents) FROM transactions WHERE status = 'paid' GROUP BY direction`,
  ];
}

/**
 * 深度分析上下文文本：固定 10 组白名单统计拼成中文文本块，每条以「·」开头。
 * 口径说明（与 qa-engine.buildAggregateContext 的日常兜底互补）：
 * - 时间口径全期，面向「消费习惯 / 结构 / 趋势」类自由分析问题；
 * - 类目与商户排行带金额与笔数，逐月趋势只保留最近 12 个月进文本；
 * - 深夜与冲动消费按全期汇总，占比分母取全期支出总额（查询 9 的 expense 行）；
 *   深夜逐月查询带 50 个月上限，达到上限时占比标签诚实标注「近50个月」，
 *   不再宣称全期（冲动查询按类目聚合 ≤12 行，全期不截断）；
 * - 任何一组查不到即省略该组，全部查不到返回空串（面板不空手转在线）。
 */
export async function buildDeepAnalysisContext(runSql: SqlRunner): Promise<string> {
  const queries = buildDeepAnalysisQueries();
  const groups: Record<string, unknown>[][] = [];
  for (const sql of queries) {
    try {
      groups.push(asRowList(await runSql(sql)));
    } catch {
      groups.push([]);
    }
  }

  const lines: string[] = [];
  const at = (index: number): Record<string, unknown>[] => groups[index] ?? [];
  const push = (line: string) => {
    if (line.length > 0) lines.push(line);
  };

  // 组 1：数据范围 + 支出笔数（多账户时取最早/最晚日期）
  const scopeRows = at(0);
  const txCount = scopeRows.reduce((sum, row) => sum + numAt(row, 1), 0);
  if (txCount > 0) {
    let first = "";
    let last = "";
    for (const row of scopeRows) {
      const f = String(valAt(row, 2) ?? "");
      const l = String(valAt(row, 3) ?? "");
      if (!first || f < first) first = f;
      if (l > last) last = l;
    }
    push(`· 数据范围：${first} 至 ${last}，共 ${txCount} 笔支出`);
  }

  // 组 2：全期支出类目排行（12 类目全出，≤50 行上限保护）
  const categoryRows = at(1);
  if (categoryRows.length > 0) {
    const parts = categoryRows.map(
      (row) => `「${String(valAt(row, 0) ?? "")}」${yuanText(numAt(row, 1))}（${numAt(row, 2)} 笔）`,
    );
    push(`· 全期支出类目：${parts.join("、")}`);
  }

  // 组 3：全期商户 Top10
  const merchantRows = at(2);
  if (merchantRows.length > 0) {
    const parts = merchantRows.map(
      (row) => `「${merchantName(valAt(row, 0))}」${yuanText(numAt(row, 1))}（${numAt(row, 2)} 笔）`,
    );
    push(`· 全期商户 Top10：${parts.join("、")}`);
  }

  // 组 4：逐月收支趋势（文本层只保留最近 12 个月，查询返回的旧月份省略）
  // month 列是 date_trunc('month', ts) 出的 TIMESTAMP，经箭头层物化为 epoch
  // 数字（毫秒/微秒），必须把原始值交给 fmtMonth 归一，不能再包 String()——
  // 包了字符串会被当成日期文本走截断兜底，切成 7 位 epoch 数字（如 1790812）
  const monthlyRows = at(3);
  if (monthlyRows.length > 0) {
    const parts = monthlyRows
      .slice(0, TREND_MONTHS_IN_TEXT)
      .map(
        (row) =>
          `${fmtMonth(valAt(row, 0))} 支出 ${yuanText(numAt(row, 1))}（${numAt(row, 3)} 笔）、收入 ${yuanText(numAt(row, 2))}`,
      );
    push(`· 逐月收支（近${Math.min(TREND_MONTHS_IN_TEXT, monthlyRows.length)}个月）：${parts.join("；")}`);
  }

  // 组 5：单笔支出金额分布（最低 / 最高 / 均值 / 中位数）
  const amountRows = at(4);
  if (amountRows.length > 0 && numAt(amountRows[0]!, 1) > 0) {
    const row = amountRows[0]!;
    push(
      `· 单笔支出分布：${numAt(row, 1)} 笔，最低 ${yuanText(numAt(row, 2))}、最高 ${yuanText(numAt(row, 3))}、均值 ${yuanText(Math.round(numAt(row, 4)))}、中位数 ${yuanText(Math.round(numAt(row, 5)))}`,
    );
  }

  // 组 6：全期收入类目排行（账单只有支出时整组省略）
  const incomeRows = at(5);
  if (incomeRows.length > 0) {
    const parts = incomeRows.map(
      (row) => `「${String(valAt(row, 0) ?? "")}」${yuanText(numAt(row, 1))}（${numAt(row, 2)} 笔）`,
    );
    push(`· 全期收入类目：${parts.join("、")}`);
  }

  // 组 7+8+9：深夜与冲动消费按全期汇总，占比分母取全期支出总额；
  // 深夜逐月查询最多带回 50 个月，行数达到上限时无法排除「还有更早月份」，
  // 占比标签诚实标注「近50个月」，且去掉「全期」前缀
  const nightRows = at(6);
  const impulseRows = at(7);
  const expenseRows = at(9).filter(
    (row) => String(valAt(row, 0) ?? "") === "expense",
  );
  const incomeRowsTotal = at(9).filter(
    (row) => String(valAt(row, 0) ?? "") === "income",
  );
  const totalExpense = expenseRows.reduce((sum, row) => sum + numAt(row, 1), 0);
  const totalIncome = incomeRowsTotal.reduce((sum, row) => sum + numAt(row, 1), 0);
  if (totalExpense > 0 || totalIncome > 0) {
    push(
      `· 全期收支：支出 ${yuanText(totalExpense)}、收入 ${yuanText(totalIncome)}、结余 ${yuanText(totalIncome - totalExpense)}`,
    );
  }
  if (totalExpense > 0) {
    const nightCents = nightRows.reduce((sum, row) => sum + numAt(row, 1), 0);
    const impulseCents = impulseRows.reduce((sum, row) => sum + numAt(row, 1), 0);
    const nightTruncated = nightCents > 0 && nightRows.length >= 50;
    const segments: string[] = [];
    if (nightCents > 0) {
      segments.push(
        `${nightTruncated ? "深夜支出占比（近50个月）" : "深夜支出占比"} ${((nightCents / totalExpense) * 100).toFixed(1)}%`,
      );
    }
    if (impulseCents > 0) {
      segments.push(`冲动消费占比 ${((impulseCents / totalExpense) * 100).toFixed(1)}%`);
    }
    if (segments.length > 0) {
      push(`· ${nightTruncated ? "" : "全期"}${segments.join("、")}`);
    }
  }

  // 组 10：订阅候选清单（金额降序后按笔数降序，与日常兜底同口径）
  const subscriptionRows = at(8);
  if (subscriptionRows.length > 0) {
    const parts = subscriptionRows
      .slice(0, 10)
      .map(
        (row) =>
          `「${merchantName(valAt(row, 0))}」月均 ${yuanText(numAt(row, 1))}（活跃 ${numAt(row, 3)} 个月）`,
      );
    push(`· 订阅候选：${parts.join("、")}`);
  }

  // 总长控制：超长时从末尾整条丢弃（每条一组统计，丢弃后语义仍完整）
  let output = lines.join("\n");
  while (output.length > DEEP_CONTEXT_MAX_LENGTH && lines.length > 1) {
    lines.pop();
    output = lines.join("\n");
  }
  return output;
}
