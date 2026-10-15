/**
 * 商户消费统计（08 修订案 A13）的聚合映射纯函数。
 *
 * 两个数据源共用同一套输出形态 MerchantEntry：
 * - 真实动线：DuckDB 白名单聚合行（按位取值：第 0 列商户名、第 1 列总额分、第 2 列笔数）
 *   经 merchantsFromQuery 映射；
 * - 演示动线：generateLedgerDemoRows 的明细行经 aggregateMerchants 在浏览器内聚合。
 * 占比（share）统一按「全账单总支出」作分母，由调用方传入 totalCents：
 * 真实动线取 direction 分组查询的 expense 总额，演示动线取演示行支出合计。
 */

export interface MerchantEntry {
  /** 商户名（账单上的商户 / 支付单位名称） */
  merchant: string;
  /** 该商户在全账单内的支出总额（分） */
  cents: number;
  /** 交易笔数 */
  count: number;
  /** 占全账单总支出比例（0-100，一位小数） */
  share: number;
  /** 均笔金额（分，四舍五入） */
  avgCents: number;
}

/** DuckDB 聚合值兜底转数值：BIGINT → bigint、INTEGER → number、HUGEINT → 大数对象，不可解析兜底 0 */
function toCents(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return Math.round(value);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

/** 金额/笔数 → 占比与均笔（内部共用；share 分母为 0 时占比记 0） */
function attachShare<T extends { cents: number; count: number }>(
  entries: T[],
  totalCents: number,
): (T & { share: number; avgCents: number })[] {
  return entries.map((entry) => ({
    ...entry,
    share: totalCents > 0 ? Math.round((entry.cents / totalCents) * 1000) / 10 : 0,
    avgCents: entry.count > 0 ? Math.round(entry.cents / entry.count) : 0,
  }));
}

/**
 * 演示明细行 → 商户聚合（浏览器内计算，零 API）。
 * 按金额降序；totalCents 为全部行的支出合计（含未进列表的行，如有）。
 */
export function aggregateMerchants(
  rows: { merchant: string; amountCents: number }[],
  totalCents: number,
): MerchantEntry[] {
  const map = new Map<string, { cents: number; count: number }>();
  for (const row of rows) {
    const entry = map.get(row.merchant) ?? { cents: 0, count: 0 };
    entry.cents += row.amountCents;
    entry.count += 1;
    map.set(row.merchant, entry);
  }
  const grouped = [...map.entries()].map(([merchant, entry]) => ({ merchant, ...entry }));
  grouped.sort((a, b) => b.cents - a.cents || a.merchant.localeCompare(b.merchant, "zh-CN"));
  return attachShare(grouped, totalCents);
}

/**
 * DuckDB 聚合行 → 商户条目：按 SELECT 位置取值（与白名单文法「不支持 AS 别名」
 * 的按位取值口径一致，见 07 §6），过滤空商户名后按金额降序。
 */
export function merchantsFromQuery(
  rows: unknown[],
  totalCents: number,
): MerchantEntry[] {
  const entries = (rows as Record<string, unknown>[])
    .map((row) => {
      const values = Object.values(row);
      return { merchant: String(values[0] ?? ""), cents: toCents(values[1]), count: toCents(values[2]) };
    })
    .filter((entry) => entry.merchant !== "");
  entries.sort((a, b) => b.cents - a.cents || a.merchant.localeCompare(b.merchant, "zh-CN"));
  return attachShare(entries, totalCents);
}

/**
 * direction 分组查询行 → 支出总额（分）：查表取 direction = 'expense' 的行，
 * 未命中（如账单仅有收入行）返回 0，占比随之全部为 0（不展示占比列）。
 */
export function expenseTotalFromDirection(rows: unknown[]): number {
  const record = (rows as Record<string, unknown>[]).find(
    (row) => String(Object.values(row)[0] ?? "") === "expense",
  );
  return record ? toCents(Object.values(record)[1]) : 0;
}

/**
 * 追问锚点标签（图表柱子点击与数据表「追问」按钮共用同一文案，05 §1.6 锚点协议）。
 */
export function merchantAnchorLabel(merchant: string, cents: number, share: number): string {
  return `${merchant} 合计 ¥${(cents / 100).toFixed(2)} · 占全账单 ${share}%`;
}

/**
 * 商户统计脚注文案（视图底部数据来源与口径说明）。
 * 截断判定基于未过滤的原始聚合行数（rawRowCount），而非过滤空商户名后的展示条数：
 * 空名分组进入前 N 名时，展示条数可能略少于原始行数，二者不能混用。
 * - 截断（rawRowCount 已达查询上限）：只说明「按金额取前 N 名展示」，
 *   不宣称商户总数——展示条数不是账单商户总数；
 * - 未截断：展示条数即账单具名商户总数（空名分组未计入，口径如实）。
 */
export function merchantFooterText(options: {
  real: boolean;
  truncated: boolean;
  entryCount: number;
  rowLimit: number;
  totalCents: number;
}): string {
  if (!options.real) {
    return `内置数据 · 共 ${options.entryCount} 个商户 · 演示账单支出合计 ¥${(options.totalCents / 100).toFixed(2)}`;
  }
  if (options.truncated) {
    return `你的账单数据 · 商户较多，按金额取前 ${options.rowLimit} 名展示 · 全账单支出合计 ¥${(options.totalCents / 100).toFixed(2)}`;
  }
  return `你的账单数据 · 共 ${options.entryCount} 个商户 · 全部展示 · 全账单支出合计 ¥${(options.totalCents / 100).toFixed(2)}`;
}
