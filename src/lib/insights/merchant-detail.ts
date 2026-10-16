/**
 * 商户统计视图「逐笔明细」页签（A15 第二部分）的纯函数模块。
 *
 * 与 merchant-aggregate.ts 同属商户统计视图：这里承载逐笔流水行的
 * 行映射、搜索过滤与深夜判定，全部为无副作用的纯函数，供组件渲染与单测共用。
 * 深夜语义沿用 07 §3 唯一口径：23:00-05:00（与 v_night_spend 视图一致）。
 */

import { generateLedgerDemoRows } from "@/lib/insights/ledger-demo";

/** 逐笔明细每页行数：与 SQL 侧 LIMIT 一致（见 merchant-view.tsx 的 buildDetailPageSql） */
export const DETAIL_PAGE_SIZE = 300;

/** 展示行数累计上限：账单可能上万行，全量渲染会拖垮浏览器；超限后引导去追问面板按需提问 */
export const DETAIL_MAX_ROWS = 3000;

/**
 * 逐笔明细行（真实 DuckDB 行与演示行共用同一形态）。
 * 真实动线由 SQL 投影 7 列按位映射（列序与 A8 明细快照一致，见 qa-engine 的
 * formatDetailLine 口径）：date_iso / ts_text / category / merchant /
 * amount_cents / direction / night_flag。
 */
export interface TransactionDetailRow {
  /** 交易时间展示串：YYYY-MM-DD HH:MM:SS（SQL 侧 strftime 生成，定位到秒） */
  tsText: string;
  /** 12 类目之一（空值兜底「其他」） */
  category: string;
  /** 原始商户名（空值兜底「未知商户」） */
  merchant: string;
  /** 金额：整数分（全项目唯一金额单位） */
  amountCents: number;
  /** 收付方向原始值（expense/income），展示文案经 directionLabel 映射 */
  direction: string;
  /** 是否深夜交易（23:00-05:00） */
  night: boolean;
}

/**
 * 深夜判定（07 §3 唯一深夜语义）：小时 ∈ [23, 5)，即 23:00-次日 05:00。
 * 真实动线由 SQL 的 night_flag 判定（EXTRACT(HOUR FROM ts)），演示动线
 * 由确定性时分秒计算后经本函数判定，两条路径同一口径。
 */
export function isNightHour(hour: number): boolean {
  return hour >= 23 || hour < 5;
}

/** 收付方向 → 展示文案：expense=支出、income=收入，其余（含空值）兜底「其他」 */
export function directionLabel(direction: string): string {
  if (direction === "expense") return "支出";
  if (direction === "income") return "收入";
  return "其他";
}

/**
 * 明细行关键字过滤（客户端执行，不触碰 DuckDB）：按商户名或类目匹配，
 * 大小写不敏感（英文商户如 Steam 可用 steam 命中）；空关键字返回全部副本。
 * 泛型放宽为「有商户与类目字段」的结构，真实行与演示行共用同一过滤。
 */
export function filterDetailRows<T extends { merchant: string; category: string }>(
  rows: readonly T[],
  query: string,
): T[] {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return [...rows];
  return rows.filter(
    (row) =>
      row.merchant.toLowerCase().includes(keyword) || row.category.toLowerCase().includes(keyword),
  );
}

/** DuckDB 聚合值兜底转数值：BIGINT → bigint、INTEGER → number、不可解析兜底 0 */
function toCents(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return Math.round(value);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

/**
 * DuckDB 直连明细行 → TransactionDetailRow：按 SELECT 位置取值
 * （0 date_iso｜1 ts_text｜2 category｜3 merchant｜4 amount_cents｜
 * 5 direction｜6 night_flag，与 A8 明细快照 / merchant-view 的
 * 直连明细查询同一列序，见 qa-engine.formatDetailLine 口径）。
 * ts_text 为 SQL 侧 strftime('%Y-%m-%d %H:%M:%S', ts) 的展示串，直接透传；
 * 时间串缺失的行过滤掉（无法定位到秒，展示出来反而误导）。
 */
export function detailRowsFromQuery(rows: unknown[]): TransactionDetailRow[] {
  return (rows as Record<string, unknown>[])
    .map((row) => {
      const values = Object.values(row);
      return {
        tsText: String(values[1] ?? ""),
        category: String(values[2] ?? "其他"),
        merchant: String(values[3] ?? "未知商户"),
        amountCents: toCents(values[4]),
        direction: String(values[5] ?? "expense"),
        night: Number(values[6]) === 1,
      };
    })
    .filter((row) => row.tsText !== "");
}

/**
 * 演示明细行（确定性）：账本演示行只有日期没有时分秒，逐笔明细页签要求
 * 定位到秒，这里按行 id 生成确定性的时分秒点缀——hour=(id*7)%24 因
 * gcd(7,24)=1 在 0-23 全量循环，深夜小时（23、0-4）约占 1/4，保证演示
 * 动线下深夜徽标可见；分钟/秒同理取模。固定输入固定输出，重渲染不抖动。
 * 演示账单口径：全部为支出（与 generateLedgerDemoRows 一致，不含收入行）。
 */
export function buildDemoDetailRows(): TransactionDetailRow[] {
  const pad = (n: number) => String(n).padStart(2, "0");
  const rows = generateLedgerDemoRows().map((row) => {
    const hour = (row.id * 7) % 24;
    const minute = (row.id * 13) % 60;
    const second = (row.id * 29) % 60;
    const date = new Date(row.date);
    date.setHours(hour, minute, second, 0);
    return {
      tsText: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(hour)}:${pad(minute)}:${pad(second)}`,
      category: row.category,
      merchant: row.merchant,
      amountCents: row.amountCents,
      direction: "expense",
      night: isNightHour(hour),
    };
  });
  // 固定格式下按字符串倒序 == 时间倒序，与真实动线的 ORDER BY ts DESC 同向
  return rows.sort((a, b) => (a.tsText < b.tsText ? 1 : -1));
}
