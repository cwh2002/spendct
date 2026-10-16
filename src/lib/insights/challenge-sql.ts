/**
 * 省钱挑战打卡（修订案 A17）的挑战数据动线。
 *
 * 挑战页需要「按类目、按天」的支出序列，两条动线共用同一批输出形态：
 * - 真实动线：CHALLENGE_DAILY_SQL（代码常量、零用户输入）经
 *   runWhitelistedAggregate 执行，一天一类一行，覆盖最近 120 天
 *   （挑战期 21 天 + 基线期 30 天 + 缓冲），行数上限经 overrides
 *   放宽（12 类 × 120 天约 1,400 行，白名单默认 50 行不够用）；
 * - 演示动线：challenge-demo.ts 的确定性生成器，行形态与真实查询一致。
 *
 * 日期键统一为本地口径 YYYY-MM-DD（date_iso 字典序即时间序，区间比较
 * 直接按字符串进行，无需解析成 Date）；金额一律整数分。全部为纯函数，
 * 同一批输入每次输出相同，可直接单测。
 */

/** 挑战周期：开始日起连续 21 天（第 21 天结束当天为最后一天） */
export const CHALLENGE_DURATION_DAYS = 21;

/** 基线窗口：挑战开始前 30 个自然日的该类目日均支出（节省额口径基准） */
export const CHALLENGE_BASELINE_DAYS = 30;

/** 每日预算建议系数：基线日均 × 0.8，留出 20% 的克制空间（低于基线才有挑战性） */
export const QUOTA_SUGGEST_RATIO = 0.8;

/** 每日聚合查询的行数上限：12 类 × 120 天 ≈ 1,400 行，白名单默认 50 不够用 */
export const CHALLENGE_DAILY_ROWS_CAP = 2000;

/** 按类目、按天聚合的支出 SQL（白名单可执行：GROUP BY 两列、无 LIMIT、行数靠 overrides 放行） */
export const CHALLENGE_DAILY_SQL =
  "SELECT category, date_iso, SUM(amount_cents) FROM transactions " +
  "WHERE direction = 'expense' AND status = 'paid' " +
  "GROUP BY category, date_iso ORDER BY date_iso";

/** 一天一类一行：真实查询映射与演示生成器共用的行形态 */
export interface CategoryDayCents {
  /** 12 类目之一 */
  category: string;
  /** YYYY-MM-DD（本地口径） */
  date: string;
  /** 当日该类目已支付支出合计（分） */
  cents: number;
}

/** DuckDB 数值兜底转数值：BIGINT → bigint、INTEGER → number、HUGEINT → 大数对象，不可解析兜底 0 */
function toCents(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return Math.round(value);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

/** 查询行 → 每日类目支出点（按 SELECT 位置取值：0 category / 1 date_iso / 2 SUM），脏行跳过 */
export function parseCategoryDayRows(rows: Record<string, unknown>[]): CategoryDayCents[] {
  return rows
    .map((row) => {
      const values = Object.values(row);
      return {
        category: String(values[0] ?? "").trim(),
        date: String(values[1] ?? "").slice(0, 10),
        cents: toCents(values[2]),
      };
    })
    .filter((point) => point.category.length > 0 && point.date.length === 10 && point.cents > 0);
}

/** 某类目的逐日支出映射：YYYY-MM-DD → 分（只留该类目，其余丢弃） */
export function seriesOf(points: CategoryDayCents[], category: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const point of points) {
    if (point.category !== category) continue;
    map.set(point.date, (map.get(point.date) ?? 0) + point.cents);
  }
  return map;
}

const PAD = (n: number) => String(n).padStart(2, "0");

/** Date → YYYY-MM-DD（本地钟表分量，不走 toISOString：UTC 格式化会漂一天） */
export function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${PAD(date.getMonth() + 1)}-${PAD(date.getDate())}`;
}

/** YYYY-MM-DD 加减自然日（跨月/跨年由 Date 归一），返回同格式日期键 */
export function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

/** 两个日期键的自然日差：toKey − fromKey（toKey 在前时为负数） */
export function daysBetween(fromKey: string, toKey: string): number {
  const [fy, fm, fd] = fromKey.split("-").map(Number);
  const [ty, tm, td] = toKey.split("-").map(Number);
  const from = new Date(fy ?? 1970, (fm ?? 1) - 1, fd ?? 1);
  const to = new Date(ty ?? 1970, (tm ?? 1) - 1, td ?? 1);
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

/** 闭区间 [fromKey, toKey] 的支出合计：无记录的天按 0 计入 */
export function sumBetween(series: Map<string, number>, fromKey: string, toKey: string): number {
  let sum = 0;
  for (let key = fromKey; key <= toKey; key = addDays(key, 1)) {
    sum += series.get(key) ?? 0;
  }
  return sum;
}

/** 闭区间 [fromKey, toKey] 的日均支出：总和 ÷ 窗口自然日数（窗口内无记录返回 0） */
export function averageDaily(series: Map<string, number>, fromKey: string, toKey: string): number {
  const span = daysBetween(fromKey, toKey) + 1;
  if (span <= 0) return 0;
  const sum = sumBetween(series, fromKey, toKey);
  return sum > 0 ? Math.round(sum / span) : 0;
}

/**
 * 每日预算建议：基线日均 × 0.8，向下取整到元（100 分）。
 * 下限 500 分（5 元）——再低的日预算没有可操作性；无历史记录（基线 0）时
 * 也落在 5 元档，由调用方在界面上提示「无历史记录」。
 */
export function quotaSuggestionCents(baselineCents: number): number {
  return Math.max(500, Math.floor((baselineCents * QUOTA_SUGGEST_RATIO) / 100) * 100);
}
