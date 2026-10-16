/**
 * 账本汇总视图的日期范围筛选 SQL 模板（纯函数模块，无 React 依赖）。
 *
 * 背景：日期范围筛选（近 7/30/90 天、本月、全部）是账本汇总的核心交互，
 * 真实动线下类别 / 商户 / 明细三块聚合都要随范围重查。白名单文法（07 §6）
 * 只允许「列 op 字面量」比较、函数调用与算术表达式都会被拒，因此范围
 * 条件用「date_iso >= 日期字面量」表达——date_iso 是 VARCHAR 的
 * YYYY-MM-DD，字典序即时间序，字面量由本地时钟计算后填入常量模板。
 * 全部语句仍经 runWhitelistedAggregate 预检执行作双保险（与
 * /report /budget 同口径）。
 */

export type LedgerRange = "7d" | "30d" | "90d" | "month" | "all";

/**
 * 日期范围 → date_iso 下限字面量（本地时钟计算，无任何用户输入）。
 * 「全部」返回 null（不加日期条件）；「本月」取当月 1 日。
 */
export function rangeSinceLiteral(range: LedgerRange, now: Date): string | null {
  const d = new Date(now);
  if (range === "7d") d.setDate(d.getDate() - 7);
  else if (range === "30d") d.setDate(d.getDate() - 30);
  else if (range === "90d") d.setDate(d.getDate() - 90);
  else if (range === "month") d.setDate(1);
  else return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 类别聚合：所选范围内支出按类别求和，金额降序前 6（环图最多 6 瓣，防挤图例） */
export function categorySql(range: LedgerRange, now: Date): string {
  const since = rangeSinceLiteral(range, now);
  return (
    "SELECT category, SUM(amount_cents) FROM transactions WHERE direction = 'expense'" +
    (since ? ` AND date_iso >= '${since}'` : "") +
    " GROUP BY category ORDER BY SUM(amount_cents) DESC LIMIT 6"
  );
}

/** 商户排行：所选范围内支出按商户求和（金额 + 笔数），金额降序前 6 */
export function merchantSql(range: LedgerRange, now: Date): string {
  const since = rangeSinceLiteral(range, now);
  return (
    "SELECT merchant, SUM(amount_cents), COUNT(*) FROM transactions WHERE direction = 'expense'" +
    (since ? ` AND date_iso >= '${since}'` : "") +
    " GROUP BY merchant ORDER BY SUM(amount_cents) DESC LIMIT 6"
  );
}

/**
 * 明细：所选范围内按 date_iso/merchant/category 三列分组（白名单 GROUP BY
 * 上限 3 列），同一商户同一天同类别合并成一行——对齐账本「流水汇总」而非
 * 逐笔的展示粒度；时间倒序 LIMIT 50。
 */
export function detailSql(range: LedgerRange, now: Date): string {
  const since = rangeSinceLiteral(range, now);
  return (
    "SELECT date_iso, merchant, category, SUM(amount_cents) FROM transactions WHERE direction = 'expense'" +
    (since ? ` AND date_iso >= '${since}'` : "") +
    " GROUP BY date_iso, merchant, category ORDER BY date_iso DESC LIMIT 50"
  );
}
