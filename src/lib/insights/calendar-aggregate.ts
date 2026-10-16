/**
 * 消费日历页（08 修订案 A15）的聚合与流水纯函数。
 *
 * 两条数据动线共用同一批输出形态：
 * - 每日热力图：白名单聚合 SQL（CALENDAR_DAILY_SQL，代码常量、无任何用户输入）
 *   经 runWhitelistedAggregate 执行。一天一行，结果行数上限经 overrides 放宽到
 *   CALENDAR_DAILY_ROWS_CAP（多年账单的日数也远低于该值），按 SELECT 位置取值
 *   （第 0 列 date_iso、第 1 列当日支出分）；
 * - 全账单流水：白名单文法结构性放不下明细投影（R3 禁明细列、语法无 OFFSET），
 *   与 qa-engine 的明细快照（08 修订案 A8 唯一明细出口）同一口径——固定语句、
 *   零动态拼接（OFFSET 只拼入经整数校验的非负整数，不接任何用户输入），
 *   直连单例连接执行，浏览器之外接触不到本条语句。每页 200 笔按 ts 倒序，
 *   累计最多 3,000 笔（展示上限，更早的流水看年度报告）。
 * 深夜判定：23:00-05:00（07 §3 唯一深夜语义，与 v_night_spend 视图同口径）。
 * 全部为纯函数：同一批输入每次输出相同，可直接单测。
 */

/** 时间轴流水行形态：真实流水（直连查询映射）与演示流水共用 */
export interface CalendarTimelineRow {
  /** 列表稳定键：按加载顺序编号（追加页从已加载笔数续号，过滤不改变键） */
  id: number;
  /** 原始交易时间（含时分秒） */
  ts: Date;
  /** YYYY-MM-DD（与 ts 同日，本地口径） */
  dateIso: string;
  /** 原始商户名（仅存于浏览器 DuckDB，不出本地） */
  merchant: string;
  /** 12 类目之一 */
  category: string;
  /** 金额：整数分（全项目唯一金额单位） */
  amountCents: number;
  /** 收付方向：支出 / 收入（neutral 理财行与 refunded 退款行不进流水） */
  direction: "expense" | "income";
}

/** 每日支出点：date_iso → 当日已支付支出合计（分），按日期升序 */
export interface DailyCents {
  date: string;
  cents: number;
}

/** 流水每页笔数：LIMIT 固定值（与 OFFSET 配合实现「加载更多」） */
export const CALENDAR_PAGE_SIZE = 200;

/** 流水展示上限：累计加载到 3,000 笔后不再提供「加载更多」 */
export const CALENDAR_MAX_ROWS = 3000;

/** 每日聚合查询的行数上限：一天一行，多年账单日数也远低于 2000（白名单默认 50 不够用） */
export const CALENDAR_DAILY_ROWS_CAP = 2000;

/** 每日支出聚合 SQL（白名单可执行：GROUP BY date_iso、无 LIMIT、行数靠 overrides 放行） */
export const CALENDAR_DAILY_SQL =
  "SELECT date_iso, SUM(amount_cents) FROM transactions " +
  "WHERE direction = 'expense' AND status = 'paid' " +
  "GROUP BY date_iso ORDER BY date_iso";

/**
 * 流水明细 SQL 的固定主体（明细出口，08 修订案 A8 同口径）：
 * 只取收支方向的行（neutral 理财行 / refunded 退款行不进流水），
 * 按原始交易时间（含时分秒）倒序，页大小 CALENDAR_PAGE_SIZE。
 * 列序契约：0 ts / 1 date_iso / 2 merchant / 3 category / 4 amount_cents / 5 direction
 */
const CALENDAR_TIMELINE_BASE_SQL =
  "SELECT ts, date_iso, merchant, category, amount_cents, direction " +
  "FROM transactions " +
  "WHERE direction <> 'neutral' AND status <> 'refunded' " +
  `ORDER BY ts DESC LIMIT ${CALENDAR_PAGE_SIZE}`;

/**
 * 拼分页流水 SQL：只有 OFFSET 值来自调用方的整数（分页计数，非用户输入），
 * 拼入前先做整数校验兜底，任何非「非负整数」形态直接拒绝，语句其余部分恒定。
 */
export function buildCalendarTimelineSql(offset: number): string {
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error(`非法的分页偏移量「${offset}」：只允许非负整数`);
  }
  return `${CALENDAR_TIMELINE_BASE_SQL} OFFSET ${offset}`;
}

/**
 * DuckDB TIMESTAMP 单元格 → Date。兼容箭头层的三种物化形态：
 * Date 对象、bigint 微秒（订阅页 fmtDateCell 同口径）、epoch 毫秒 number 与字符串。
 * 非法值返回 null，由调用方过滤。展示层一律按本地钟表分量读取
 * （导入的 ts 是无时区本地时间，UTC 格式化会漂移，见 spec.ts fmtDate 口径）。
 */
export function parseTimestampCell(value: unknown): Date | null {
  const date =
    value instanceof Date
      ? value
      : typeof value === "bigint"
        ? new Date(Number(value / 1000n))
        : typeof value === "number" && Number.isFinite(value)
          ? new Date(value)
          : typeof value === "string"
            ? new Date(value)
            : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

/**
 * 流水查询行 → 时间轴流水行（按 SELECT 位置取值，不依赖 DuckDB 自动列名）。
 * ts 解析失败时退回 date_iso 兜底（仍有日期可展示），两者都失败的行跳过。
 */
export function timelineRowsFromQuery(
  rows: Record<string, unknown>[],
  startId = 0,
): CalendarTimelineRow[] {
  const out: CalendarTimelineRow[] = [];
  for (const row of rows) {
    const values = Object.values(row);
    const ts = parseTimestampCell(values[0]);
    const dateIso = String(values[1] ?? "").slice(0, 10);
    const merchant = String(values[2] ?? "未知商户");
    const category = String(values[3] ?? "其他");
    const amountCents = toCents(values[4]);
    const direction = values[5] === "income" ? "income" : "expense";
    // 时间缺失但日期有效：用当日 0 点兜底，行不丢（时间列显示 00:00:00）
    const fallback = dateIso.length === 10 ? new Date(`${dateIso}T00:00:00`) : null;
    const finalTs = ts ?? fallback;
    if (!finalTs || Number.isNaN(finalTs.getTime())) continue;
    out.push({ id: startId + out.length + 1, ts: finalTs, dateIso, merchant, category, amountCents, direction });
  }
  return out;
}

/** 每日聚合查询行 → 每日支出点（第 0 列 date_iso、第 1 列 SUM），脏行跳过 */
export function dailyCentsFromQuery(rows: Record<string, unknown>[]): DailyCents[] {
  return rows
    .map((row) => {
      const values = Object.values(row);
      return { date: String(values[0] ?? "").slice(0, 10), cents: toCents(values[1]) };
    })
    .filter((point) => point.date.length === 10 && point.cents > 0);
}

/** 演示流水行 → 每日支出点：只统计支出方向，按日期升序（浏览器内聚合，与真实聚合同形态） */
export function dailyCentsFromRows(rows: CalendarTimelineRow[]): DailyCents[] {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (row.direction !== "expense") continue;
    map.set(row.dateIso, (map.get(row.dateIso) ?? 0) + row.amountCents);
  }
  return [...map.entries()]
    .map(([date, cents]) => ({ date, cents }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** 深夜判定：23:00-05:00（07 §3 唯一深夜语义，与 v_night_spend / anomaly 阶段同口径） */
export function isNightDate(date: Date): boolean {
  const hour = date.getHours();
  return hour >= 23 || hour < 5;
}

/** 交易时间 → YYYY-MM-DD HH:mm:ss（本地钟表分量，精确到秒） */
export function formatTsToSeconds(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/** 方向筛选档位：全部 / 支出 / 收入 */
export type TimelineDirectionFilter = "all" | "expense" | "income";

/** 流水筛选条件：商户/类目关键字 + 方向档位（全部为客户端过滤，不重查数据库） */
export interface TimelineFilter {
  query: string;
  direction: TimelineDirectionFilter;
}

/** 流水筛选：关键字同时匹配商户名与类目（trim 后空关键字放行全部），方向档位精确匹配 */
export function filterTimelineRows(
  rows: CalendarTimelineRow[],
  filter: TimelineFilter,
): CalendarTimelineRow[] {
  const query = filter.query.trim();
  return rows.filter((row) => {
    if (filter.direction !== "all" && row.direction !== filter.direction) return false;
    if (!query) return true;
    return row.merchant.includes(query) || row.category.includes(query);
  });
}

/** DuckDB 数值兜底转数值：BIGINT → bigint、INTEGER → number、HUGEINT → 大数对象，不可解析兜底 0 */
function toCents(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return Math.round(value);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}
