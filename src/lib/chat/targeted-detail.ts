/**
 * 追问定向明细检索（08 修订案 A15）：让追问真正读取原始账单明细。
 *
 * 用户问「五月深夜消费了什么」这类需要逐笔明细的问题时，本模块从问题里
 * 识别检索条件（月份 / 年份 / 商户 / 类目 / 深夜时段），直连 DuckDB 查询
 * transactions 明细并拼成文本块，随深度分析的统计段、最近明细快照（A8）
 * 一起发送，模型据此能答出具体每一笔的消费内容。
 *
 * 安全口径（与 qa-engine 的 A8 明细快照并列，是第二个直连明细出口）：
 * - 与白名单聚合互不冲突：本模块走 DuckDB 直连（不经 runWhitelistedAggregate），
 *   聚合统计仍全部走白名单通道；
 * - SQL 模板固定，参数全部来自可信来源或正则校验：商户名只从数据库查询的
 *   可信名单匹配、类目只取常量词表成员、月份 / 年份只接受纯数字串，
 *   商户字符串进 SQL 前做单引号双写转义并限制长度；
 * - 只经浏览器内 DuckDB 直连执行，服务端接触不到本模块生成的语句。
 *
 * 浏览器安全约束同 qa-engine：禁止引用 React 与 server-only；
 * 时钟（new Date）只出现在 buildTargetedDetailPlan 的相对月份识别里，
 * 由追问面板在提交事件里调用，渲染路径不会执行到这里。
 */

import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";

import { CATEGORY_CODES } from "@/lib/schema/bill";

import { formatDetailLine } from "./qa-engine";

/** 定向明细文本块上限（字）：超长按行整条丢弃，保证单条语义完整 */
export const TARGETED_CONTEXT_MAX_LENGTH = 2500;

/** 商户名进 SQL 的长度上限：超长名称宁可整段放弃，也不硬拼超长语句 */
const MERCHANT_MAX_LENGTH = 60;

/**
 * 定向检索计划：全部字段可空，全空（且 nightOnly 为 false）表示没有识别出
 * 任何检索条件，不生成 SQL。month 存两位 MM（如 "05"），year 存四位 YYYY。
 */
export interface TargetedDetailPlan {
  /** 月份：两位 MM；用 SUBSTR(date_iso, 6, 2) 匹配，天然覆盖跨年账单 */
  month: string | null;
  /** 年份：YYYY；与 date_iso 前缀 LIKE 匹配 */
  year: string | null;
  /** 商户：来自数据库查询的可信名单，绝不直接取用户原文 */
  merchant: string | null;
  /** 类目：必须是 CATEGORY_CODES 常量词表成员 */
  category: string | null;
  /** 深夜限定：23:00-05:00 时段 */
  nightOnly: boolean;
}

/** 深夜时段关键词（与 qa-engine 的 NIGHT_SPEND_WORDS 同口径，多一个「熬夜」） */
const NIGHT_WORDS = ["深夜", "半夜", "凌晨", "夜宵", "熬夜"] as const;

/** 相对月份词：本月 / 这个月 → 当前月；上月 / 上个月 → 前一月（长词先于短词） */
const RELATIVE_MONTH_WORDS = [
  { words: ["上个月", "上月"], offset: -1 },
  { words: ["这个月", "本月"], offset: 0 },
] as const;

/** 中文数字 → 数值（月份识别用） */
const CN_DIGITS: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

/** 两位月号：1-12 的数字补零成 "01"-"12" */
function twoDigitMonth(n: number): string {
  return String(n).padStart(2, "0");
}

/** 相对月份词命中时的月号（offset 0 = 当前月，-1 = 前一月，按本地时间计算） */
function relativeMonthMm(now: Date, offset: number): string {
  return twoDigitMonth(new Date(now.getFullYear(), now.getMonth() + offset, 1).getMonth() + 1);
}

/**
 * 从问题文本识别检索计划（纯字符串匹配 + 相对月份的本地时钟）。
 *
 * 各槽位相互独立、可同时命中；识别优先级（注释说明判定顺序的取舍）：
 * - 月份：相对词（上月/这个月等）优先——这是更明确的意图；其次阿拉伯数字
 *   「N 月 / N 月份」（N 限 1-12，允许「5月份」「5 月」带空格），
 *   最后中文数字「一月」到「十二月」（含「十一月」「十二月」两位）；
 * - 年份：「YYYY 年」（19xx/20xx），只认带「年」字的写法，避免把金额数字
 *   误当成年份；
 * - 深夜：命中「深夜/半夜/凌晨/夜宵/熬夜」任一关键词即 nightOnly=true；
 * - 类目：CATEGORY_CODES 常量词表里完整出现在问题中的类目词即命中；
 * - 商户：在 merchantNames（数据库查询出的可信名单）中找长度 ≥2 且完整
 *   出现在问题里的商户名，最长匹配优先（「蜜雪冰城」优先于「蜜雪」），
 *   等长时按名单顺序（支出金额降序）取先出现的。
 *
 * 可信来源原则：商户参数只从 DB 名单匹配、类目只来自常量词表，绝不直接
 * 把用户原文片段拼进 SQL。
 */
export function buildTargetedDetailPlan(
  question: string,
  merchantNames: string[],
): TargetedDetailPlan {
  const text = question.trim();

  // 月份：相对词 > 阿拉伯数字 > 中文数字
  let month: string | null = null;
  const now = new Date();
  for (const entry of RELATIVE_MONTH_WORDS) {
    if (entry.words.some((word) => text.includes(word))) {
      month = relativeMonthMm(now, entry.offset);
      break;
    }
  }
  if (month === null) {
    // (?:^|\D) 边界：数字前必须不是数字，避免「13月」被误切成「3月」
    const arabic = text.match(/(?:^|\D)([1-9]|1[0-2])\s*月(?:份)?/);
    if (arabic) month = twoDigitMonth(Number(arabic[1]));
  }
  if (month === null) {
    const chinese = text.match(/(十[一二]|[一二三四五六七八九十])月/);
    if (chinese) {
      const token = chinese[1] ?? "";
      if (token === "十一") month = "11";
      else if (token === "十二") month = "12";
      else if (CN_DIGITS[token] !== undefined) month = twoDigitMonth(CN_DIGITS[token]);
    }
  }

  // 年份：只认「YYYY 年」写法（19xx/20xx），避免金额等裸数字误判
  const yearMatch = text.match(/((?:19|20)\d{2})\s*年/);
  const year = yearMatch ? (yearMatch[1] ?? null) : null;

  // 深夜时段
  const nightOnly = NIGHT_WORDS.some((word) => text.includes(word));

  // 类目：常量词表成员完整出现在问题里即命中（词表顺序即优先级）
  let category: string | null = null;
  for (const name of CATEGORY_CODES) {
    if (text.includes(name)) {
      category = name;
      break;
    }
  }

  // 商户：DB 名单里最长完整匹配优先（等长按名单顺序取先出现的）
  let merchant: string | null = null;
  for (const rawName of merchantNames) {
    const name = rawName.trim();
    if (name.length < 2) continue;
    if (text.includes(name) && (merchant === null || name.length > merchant.length)) {
      merchant = name;
    }
  }

  return { month, year, merchant, category, nightOnly };
}

/**
 * 按计划生成定向明细 SQL；计划没有任何条件时返回 null（调用方跳过该段）。
 *
 * 这是 A8 明细快照之外的第二个直连明细出口（A15）：参数全部来自可信来源
 * 或正则校验，与白名单聚合互不冲突——本语句含明细列投影与函数表达式，
 * 只能直连执行，绝不能进 runWhitelistedAggregate。
 *
 * 校验口径：
 * - month 必须两位纯数字、year 必须四位纯数字，否则整个计划作废返回 null；
 * - merchant 单引号双写转义，长度超上限（60 字）整个计划作废返回 null；
 * - category 必须是 CATEGORY_CODES 常量词表成员，否则整个计划作废返回 null。
 */
export function buildTargetedDetailSql(plan: TargetedDetailPlan): string | null {
  const conditions: string[] = [];
  if (plan.month !== null) {
    if (!/^\d{2}$/.test(plan.month)) return null;
    conditions.push(`AND SUBSTR(date_iso, 6, 2) = '${plan.month}'`);
  }
  if (plan.year !== null) {
    if (!/^\d{4}$/.test(plan.year)) return null;
    conditions.push(`AND date_iso LIKE '${plan.year}-%'`);
  }
  if (plan.merchant !== null) {
    const escaped = plan.merchant.replaceAll("'", "''");
    if (escaped.length > MERCHANT_MAX_LENGTH) return null;
    conditions.push(`AND merchant = '${escaped}'`);
  }
  if (plan.category !== null) {
    if (!(CATEGORY_CODES as readonly string[]).includes(plan.category)) return null;
    conditions.push(`AND category = '${plan.category}'`);
  }
  if (plan.nightOnly) {
    conditions.push("AND (EXTRACT(HOUR FROM ts) >= 23 OR EXTRACT(HOUR FROM ts) < 5)");
  }
  if (conditions.length === 0) return null;

  return [
    "SELECT date_iso, strftime('%Y-%m-%d %H:%M:%S', ts) AS ts_text, category, merchant, amount_cents, direction, CASE WHEN EXTRACT(HOUR FROM ts) >= 23 OR EXTRACT(HOUR FROM ts) < 5 THEN 1 ELSE 0 END AS night_flag",
    "FROM transactions",
    "WHERE direction <> 'neutral' AND status <> 'refunded'",
    ...conditions,
    "ORDER BY ts DESC",
    "LIMIT 200",
  ].join("\n");
}

/** 计划的命中文案（范围说明）：如「2026 年 5 月」「商户 蜜雪冰城」，组合用顿号连接 */
export function planScopeText(plan: TargetedDetailPlan): string {
  const parts: string[] = [];
  if (plan.year !== null && plan.month !== null) {
    parts.push(`${plan.year} 年 ${Number(plan.month)} 月`);
  } else if (plan.year !== null) {
    parts.push(`${plan.year} 年`);
  } else if (plan.month !== null) {
    parts.push(`${Number(plan.month)} 月`);
  }
  if (plan.merchant !== null) parts.push(`商户 ${plan.merchant}`);
  if (plan.category !== null) parts.push(`类目 ${plan.category}`);
  if (plan.nightOnly) parts.push("深夜");
  return parts.join("、");
}

/**
 * 定向明细文本块：执行计划 SQL 后拼「与问题直接相关的明细（范围说明，
 * 共 N 笔）：」前缀 + formatDetailLine 行（列序与 DETAIL_SNAPSHOT_SQL 一致）。
 * - 空结果返回诚实空态文案「本地账单里没有查到与问题直接相关的明细（范围说明）。」；
 * - 文本总长 ≤TARGETED_CONTEXT_MAX_LENGTH，超长按行整条丢弃；
 * - 执行异常返回空串（调用方省略该段，不阻断主链路）。
 */
export async function buildTargetedDetailContext(
  runSql: (sql: string) => Promise<unknown[]>,
  plan: TargetedDetailPlan,
): Promise<string> {
  const sql = buildTargetedDetailSql(plan);
  if (!sql) return ""; // 计划为空或校验不过：不查，调用方省略该段

  let rows: unknown[] = [];
  try {
    rows = await runSql(sql);
  } catch {
    return ""; // 执行异常返回空串，调用方省略该段
  }

  const scope = planScopeText(plan);
  if (rows.length === 0) {
    return `本地账单里没有查到与问题直接相关的明细（${scope}）。`;
  }

  const header = `与问题直接相关的明细（${scope}，共 ${rows.length} 笔）：`;
  const lines: string[] = [header];
  let used = header.length + 1;
  for (const row of rows as Record<string, unknown>[]) {
    const line = formatDetailLine(row);
    if (used + line.length > TARGETED_CONTEXT_MAX_LENGTH) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join("\n");
}

/**
 * 定向明细执行器工厂：直连单例 DuckDB 连接执行（不经聚合白名单），
 * 与 qa-engine.createDuckDbDetailSnapshot 的接线方式一致。
 */
export function createTargetedDetailRunner(
  getConn: () => Promise<unknown>,
): (sql: string) => Promise<unknown[]> {
  return async (sql: string) => {
    const conn = (await getConn()) as AsyncDuckDBConnection;
    const result = await conn.query(sql);
    return result.toArray() as unknown as unknown[];
  };
}
