/**
 * 浏览器端账单问答引擎：追问面板的本地回答层（契约：全仓唯一的问答模块）。
 *
 * 一次提问的本地处理分三步，全部是确定性规则，数字只来自 DuckDB 查询结果：
 * 1. 意图解析（analyzeQuestion）：纯函数，把自然语言问题映射成
 *    QaIntent（意图种类 + 类目槽位 + 时间窗槽位）；锚点标签里出现的
 *    类目别名 / 时间窗关键词会补全问题里缺失的槽位。
 * 2. SQL 生成与执行（buildIntentQueries / createDuckDbRunner）：按意图与
 *    时间窗生成固定的白名单聚合 SQL（关系与列名以 src/lib/schema/bill.ts
 *    的视图定义为准），全部经 runWhitelistedAggregate 预检后执行，
 *    不拼接任何用户输入进 SQL。
 * 3. 文案组装（answerLocalQuestion）：把查询结果行组装成确定性中文回答；
 *    查不到数据时区分「数据集为空」与「有数据但该维度为空」两种措辞。
 *
 * 本地答不了的组合（如按天口径不存在的深夜 / 预算统计）返回 unhandled，
 * 由追问面板转在线兜底：buildAggregateContext 拼汇总统计，buildDetailContext
 * 拼最近明细快照，两段一并发送给在线服务（口径见 08 修订案 A8）。
 *
 * 浏览器安全约束：本模块禁止引用 React 与 server-only；
 * analyzeQuestion / buildIntentQueries / buildContextQueries 均为纯函数，
 * 时钟（new Date）只出现在 answerLocalQuestion / buildAggregateContext 内，
 * 由面板在提交事件里调用，渲染路径不会执行到这里。
 */

import { getDuckDB } from "@/lib/duckdb/service";
import { fmtDate, fmtMonth, fmtYuan, numAt, valAt } from "@/lib/pipeline/stages/spec";
import type { CategoryCode } from "@/lib/schema/bill";
import type { SessionSchema } from "@/lib/schema/session-schema";
import { runWhitelistedAggregate } from "@/lib/sql-guard/whitelist";

// ─────────────────────────── 公共类型 ───────────────────────────

/**
 * 时间窗：本月 / 上个月 / 上上个月 / 今年 / 最近7天 / 最近30天 / 最近90天 /
 * 指定月份（「1月份」「去年3月」这类问题里的具体月份，落点见 SpecificMonthRef）。
 * 新增值来自 08 修订案 A18：整年/整个账单等说法归入今年，上上个月独立成窗，
 * 具体月份问题不再被兜底成本月。
 */
export type TimeWindow =
  | "this_month"
  | "last_month"
  | "two_months_ago"
  | "this_year"
  | "last_7d"
  | "last_30d"
  | "last_90d"
  | "specific_month";

/** 「N月」类问题解析出的具体月份：month 为 1-12，year 的 current/last 在回答时刻解析 */
export interface SpecificMonthRef {
  month: number;
  year: number | "current" | "last";
}

/** 本地可回答的九类账单问题 */
export type QaKind =
  | "category_spend"
  | "month_total"
  | "balance"
  | "subscription"
  | "top_merchant"
  | "mom_compare"
  | "night_spend"
  | "budget"
  | "overview";

/** 解析后的提问意图：kind 为意图种类，category / window 为已补全的槽位 */
export interface QaIntent {
  kind: QaKind;
  category?: CategoryCode;
  window: TimeWindow;
  /**
   * specific_month 的落点。只有 window === "specific_month" 时才存在，
   * 其余时间窗不带此字段（契约断言：槽位字段按需出现）。
   */
  monthRef?: SpecificMonthRef;
  /** 预留槽位：当前版本不参与判定与取数，保留供后续按商户追问扩展 */
  merchant?: string;
}

/** SQL 执行器：入参是白名单聚合 SQL，出参是查询结果行（金额可能是 bigint / 大数对象 / number） */
export type SqlRunner = (sql: string) => Promise<unknown[]>;

/** 本地回答：data 为按查询结果作答，no-data 为无数据的两种确定文案，unhandled 转在线兜底 */
export type LocalAnswer = { kind: "data" | "no-data"; text: string } | { kind: "unhandled" };

// ─────────────────────────── 词表（确定性判定） ───────────────────────────

/** 12 类目的别名词表：命中即归入对应类目（多个类目词同现时取先声明的类目） */
const CATEGORY_ALIASES: readonly { category: CategoryCode; words: readonly string[] }[] = [
  { category: "订阅", words: ["订阅", "会员", "续费"] },
  { category: "餐饮", words: ["外卖", "吃饭", "吃喝", "餐饮"] },
  { category: "交通", words: ["打车", "地铁", "公交", "交通"] },
  { category: "购物", words: ["淘宝", "网购", "买东西", "购物"] },
  { category: "娱乐", words: ["视频", "游戏", "电影", "娱乐"] },
  { category: "居住", words: ["房租", "水电", "宿舍", "居住"] },
  { category: "通讯", words: ["话费", "流量", "通讯"] },
  { category: "医疗", words: ["看病", "买药", "医疗"] },
  { category: "教育", words: ["学费", "书", "课程", "教育"] },
  { category: "人情", words: ["红包", "送礼", "人情"] },
  { category: "金融", words: ["理财", "金融"] },
  { category: "其他", words: ["其他"] },
];

/**
 * 时间窗关键词：按声明顺序匹配，长词与含短词的词必须先声明
 * （「上上个月」含子串「上个月」，必须排在「上个月」之前；
 * 「最近90天」同理排在「最近30天」前）。
 */
const WINDOW_WORDS: readonly { window: TimeWindow; words: readonly string[] }[] = [
  { window: "last_90d", words: ["最近90天", "近90天"] },
  { window: "last_30d", words: ["最近30天", "近30天"] },
  { window: "last_7d", words: ["最近7天", "近7天"] },
  {
    window: "this_year",
    words: ["今年", "全年", "整年", "全期", "整个账单", "全部账单", "所有账单", "全账单"],
  },
  { window: "two_months_ago", words: ["上上个月", "前两个月"] },
  { window: "last_month", words: ["上个月", "上月"] },
  { window: "this_month", words: ["这个月", "本月"] },
];

/**
 * 意图关键词（优先级从高到低，命中即停）：
 * 1. balance（结余/盈余/收入/存了）——收支结余问题，只看月度收支汇总；
 * 2. subscription（订阅/会员/续费）——订阅类支出与疑似订阅商户；
 * 3. top_merchant（哪家/哪店/哪个商户/花最多/最贵/商家/排行/排名）——商户排行；
 * 4. mom_compare（为什么/涨了/涨/降了/变多/变少/增加/减少/环比/变化）——环比涨跌；
 * 5. night_spend（深夜/凌晨/半夜/夜宵）——深夜时段支出；
 * 6. budget（预算/超支/超标/还剩）——预算使用情况；
 * 7. overview（概况/总结/总体/整体/体检/健康）——账单总体概览；
 * 8. category_spend——含类目词且含「花/支出/多少/几笔」，或只出现类目词本身；
 * 9. month_total（花了/总共/一共/支出/花费/多少钱）——总额兜底。
 * 优先级的意义：同一句话可能同时命中多个词表（如“外卖为什么涨了”同时含类目词
 * 与“涨了”），按 1-9 顺序取第一个命中的意图。
 */
const BALANCE_WORDS = ["结余", "盈余", "收入", "存了"] as const;
const SUBSCRIPTION_WORDS = ["订阅", "会员", "续费"] as const;
const TOP_MERCHANT_WORDS = [
  "哪家",
  "哪店",
  "哪个商户",
  "花最多",
  "最贵",
  "商家",
  "排行",
  "排名",
] as const;
const MOM_COMPARE_WORDS = [
  "为什么",
  "涨了",
  "涨",
  "降了",
  "变多",
  "变少",
  "增加",
  "减少",
  "环比",
  "变化",
] as const;
const NIGHT_SPEND_WORDS = ["深夜", "凌晨", "半夜", "夜宵"] as const;
const BUDGET_WORDS = ["预算", "超支", "超标", "还剩"] as const;
const OVERVIEW_WORDS = ["概况", "总结", "总体", "整体", "体检", "健康"] as const;
const MONTH_TOTAL_WORDS = ["花了", "总共", "一共", "支出", "花费", "多少钱"] as const;

/** 数据集为空的统一文案（有数据但某维度为空时用另一套按意图区分的文案）。导出供面板做「未导入即答」短路 */
export const DATASET_EMPTY_TEXT =
  "还没有账单数据，先到「上传账单」导入一份账单，我就能回答这些问题了。";

/** 时间窗的答案措辞（specific_month 按回答时刻解析年份，如「2026年1月」） */
function windowLabel(intent: QaIntent, now: Date): string {
  switch (intent.window) {
    case "this_month":
      return "本月";
    case "last_month":
      return "上个月";
    case "two_months_ago":
      return "上上个月";
    case "this_year":
      return "今年";
    case "last_7d":
      return "最近7天";
    case "last_30d":
      return "最近30天";
    case "last_90d":
      return "最近90天";
    case "specific_month":
      if (!intent.monthRef) return "该月";
      return `${specificMonthYear(intent.monthRef, now)}年${intent.monthRef.month}月`;
  }
}

/** 环比比较里“上一期”的措辞（按时间窗区分；指定月份的上一期是其前一个自然月） */
function prevWindowLabel(intent: QaIntent, now: Date): string {
  switch (intent.window) {
    case "this_month":
      return "上月";
    case "last_month":
      return "上上个月";
    case "two_months_ago":
      return "上上上个月";
    case "this_year":
      return "去年";
    case "last_7d":
      return "前一个7天";
    case "last_30d":
      return "前一个30天";
    case "last_90d":
      return "前一个90天";
    case "specific_month": {
      if (!intent.monthRef) return "前一月";
      const year = specificMonthYear(intent.monthRef, now);
      const prev = new Date(year, intent.monthRef.month - 2, 1);
      return `${prev.getFullYear()}年${prev.getMonth() + 1}月`;
    }
  }
}

/** 空态提问建议（6 个示例问题 chips，全部可被本地规则回答） */
export const EXAMPLE_QUESTIONS: readonly string[] = [
  "这个月花了多少",
  "这个月外卖花了多少",
  "哪家商户花得最多",
  "这个月结余多少",
  "最近90天花了多少",
  "有哪些订阅在扣费",
];

// ─────────────────────────── 词表匹配工具 ───────────────────────────

/** 文本里是否出现词表中任一关键词（中文按子串匹配） */
function hasAnyWord(text: string, words: readonly string[]): boolean {
  return words.some((word) => text.includes(word));
}

/** 识别文本里的类目（问题文本或锚点标签均可），找不到返回 null */
function detectCategory(text: string): CategoryCode | null {
  for (const entry of CATEGORY_ALIASES) {
    if (hasAnyWord(text, entry.words)) return entry.category;
  }
  return null;
}

/** 识别文本里的时间窗关键词，找不到返回 null（默认窗由调用方补 this_month） */
function detectWindow(text: string): TimeWindow | null {
  for (const entry of WINDOW_WORDS) {
    if (hasAnyWord(text, entry.words)) return entry.window;
  }
  return null;
}

/**
 * 中文数字月份：十一 / 十二必须排在 十 / 一 / 二 之前——
 * 「十一月」含子串「一月」，顺序命中才能取到正确的月份。
 */
const CHINESE_MONTH_WORDS: readonly { month: number; words: readonly string[] }[] = [
  { month: 12, words: ["十二"] },
  { month: 11, words: ["十一"] },
  { month: 10, words: ["十"] },
  { month: 9, words: ["九"] },
  { month: 8, words: ["八"] },
  { month: 7, words: ["七"] },
  { month: 6, words: ["六"] },
  { month: 5, words: ["五"] },
  { month: 4, words: ["四"] },
  { month: 3, words: ["三"] },
  { month: 2, words: ["二"] },
  { month: 1, words: ["一"] },
];

/** 文本里的「YYYY 年」（只认 19xx/20xx 带年字的写法，避免金额等裸数字误判） */
const YEAR_IN_TEXT = /((?:19|20)\d{2})\s*年/;

/**
 * 识别问题里的具体月份（「1月份」「3 月」「一月」「去年6月」「2025年4月」），
 * 找不到返回 null。年份解析规则：文本带「YYYY年」用该年；带「去年」用上一自然年；
 * 否则记 current（回答时刻所在年，由调用方解析）。纯函数：只做字符串匹配，
 * 不触碰时钟——year 的 current/last 解析推迟到取数阶段。
 */
function detectSpecificMonth(text: string): SpecificMonthRef | null {
  // 中文月份：词表按「十一/十二优先于 十/一/二」的顺序声明，命中即止
  for (const entry of CHINESE_MONTH_WORDS) {
    if (entry.words.some((word) => text.includes(`${word}月`))) {
      return { month: entry.month, year: resolveMonthYear(text) };
    }
  }
  // 阿拉伯数字月份：前面必须不是数字（避免「13月」被切成「3月」），可带空格
  const arabic = /(?:^|\D)(1[0-2]|[1-9])\s*月(?:份)?/.exec(text);
  if (!arabic) return null;
  return { month: Number(arabic[1]), year: resolveMonthYear(text) };
}

/** 具体月份的年份归属：显式「YYYY年」> 「去年」> 回答时刻所在年 */
function resolveMonthYear(text: string): number | "current" | "last" {
  if (text.includes("去年")) return "last";
  const yearMatch = YEAR_IN_TEXT.exec(text);
  return yearMatch ? Number(yearMatch[1]) : "current";
}

// ─────────────────────────── 意图解析 ───────────────────────────

/**
 * 解析提问意图（纯函数：只做字符串匹配，不触碰时钟与浏览器 API）。
 *
 * 槽位来源顺序：问题文本 > 锚点标签 > 默认值。
 * 锚点槽位继承：追问面板把锚点（洞察卡「深挖」或图表数据点）一并传入，
 * 锚点标签里出现的类目别名与时间窗关键词会补全问题里缺失的槽位，
 * 例如锚点「外卖 · 近30天 +14%」+ 问题「为什么涨了」→
 * mom_compare + category=餐饮 + window=last_30d。
 * 问题自己带出的槽位永远优先于锚点（例如问题说「上个月」而锚点带「近30天」）。
 *
 * 返回 null 表示未识别（闲聊由面板先行分流，这里不再处理）：
 * 面板会把 null 直接转在线兜底。
 */
export function analyzeQuestion(
  text: string,
  anchor: { id: string; label: string } | null,
): QaIntent | null {
  const normalized = text.trim();
  if (normalized === "") return null;

  const anchorLabel = anchor ? anchor.label : "";
  const category = detectCategory(normalized) ?? detectCategory(anchorLabel);
  // 问题里的具体月份（如「1月份」）比任何时间窗关键词都更精确，优先取；
  // 其次问题里的时间窗词，再锚点标签里的时间窗词，最后默认本月。
  const specificMonth = detectSpecificMonth(normalized);
  const window = specificMonth
    ? "specific_month"
    : (detectWindow(normalized) ?? detectWindow(anchorLabel) ?? "this_month");

  let intent: QaIntent | null;
  if (hasAnyWord(normalized, BALANCE_WORDS)) {
    intent = { kind: "balance", window };
  } else if (hasAnyWord(normalized, SUBSCRIPTION_WORDS)) {
    // 订阅意图的类目槽位恒为「订阅」，与问题里带出的其他类目词无关
    intent = { kind: "subscription", category: "订阅", window };
  } else if (hasAnyWord(normalized, TOP_MERCHANT_WORDS)) {
    intent = category ? { kind: "top_merchant", category, window } : { kind: "top_merchant", window };
  } else if (hasAnyWord(normalized, MOM_COMPARE_WORDS)) {
    intent = category ? { kind: "mom_compare", category, window } : { kind: "mom_compare", window };
  } else if (hasAnyWord(normalized, NIGHT_SPEND_WORDS)) {
    intent = { kind: "night_spend", window };
  } else if (hasAnyWord(normalized, BUDGET_WORDS)) {
    intent = category ? { kind: "budget", category, window } : { kind: "budget", window };
  } else if (hasAnyWord(normalized, OVERVIEW_WORDS)) {
    intent = { kind: "overview", window };
  } else if (category !== null) {
    // 含类目词且含「花/支出/多少/几笔」，或只出现类目词本身，都归为类目支出
    // （类目词也可能来自锚点：如锚点「外卖 · 近30天」+ 问题「花了多少」）。
    intent = { kind: "category_spend", category, window };
  } else if (hasAnyWord(normalized, MONTH_TOTAL_WORDS)) {
    intent = { kind: "month_total", window };
  } else {
    intent = null;
  }
  // specific_month 的落点只在取到具体月份时带上；其余窗口不出现 monthRef 字段
  return intent && specificMonth ? { ...intent, monthRef: specificMonth } : intent;
}

// ─────────────────────────── 本地日期键（纯函数，本地时钟口径） ───────────────────────────

/** 月窗起始键：本地时钟的 YYYY-MM-01（offsetMonths 为 -1 时是上个月） */
function monthStartKey(now: Date, offsetMonths = 0): string {
  return fmtDate(new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1));
}

/** 日窗起始键：本地时钟的 YYYY-MM-DD（offsetDays 为负时向过去偏移） */
function dayStartKey(now: Date, offsetDays: number): string {
  return fmtDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays));
}

/** 时间窗对应的交易明细日期范围（date_iso 为 VARCHAR ISO 日期，字符串比较有效） */
interface DateRange {
  start: string;
  end: string;
}

function windowDateRange(window: TimeWindow, now: Date, monthRef?: SpecificMonthRef): DateRange {
  switch (window) {
    case "this_month":
      return { start: monthStartKey(now, 0), end: monthStartKey(now, 1) };
    case "last_month":
      return { start: monthStartKey(now, -1), end: monthStartKey(now, 0) };
    case "two_months_ago":
      return { start: monthStartKey(now, -2), end: monthStartKey(now, -1) };
    case "specific_month": {
      const key = monthRef ? specificMonthKey(monthRef, now) : monthStartKey(now, 0);
      return { start: key, end: nextMonthKey(key) };
    }
    case "this_year":
      return { start: `${now.getFullYear()}-01-01`, end: `${now.getFullYear() + 1}-01-01` };
    case "last_7d":
      return { start: dayStartKey(now, -7), end: dayStartKey(now, 0) };
    case "last_30d":
      return { start: dayStartKey(now, -30), end: dayStartKey(now, 0) };
    case "last_90d":
      return { start: dayStartKey(now, -90), end: dayStartKey(now, 0) };
  }
}

/** 具体月份归属的年份（current/last 按回答时刻解析） */
function specificMonthYear(ref: SpecificMonthRef, now: Date): number {
  if (ref.year === "current") return now.getFullYear();
  if (ref.year === "last") return now.getFullYear() - 1;
  return ref.year;
}

/** 具体月份 → YYYY-MM-01 */
function specificMonthKey(ref: SpecificMonthRef, now: Date): string {
  return fmtDate(new Date(specificMonthYear(ref, now), ref.month - 1, 1));
}

/** 月窗起始键的后一个月起始键（作日期范围的右开端点） */
function nextMonthKey(monthKey: string): string {
  const [year = 0, month = 1] = monthKey.split("-").map(Number);
  return fmtDate(new Date(year, month, 1));
}

/** 是否是按月粒度的窗口（这些窗有按月粒度的视图可用） */
function isMonthWindow(window: TimeWindow): boolean {
  return (
    window === "this_month" ||
    window === "last_month" ||
    window === "two_months_ago" ||
    window === "specific_month"
  );
}

/** 月窗对应的 month 键（YYYY-MM-01）：四个按月窗口各自解析 */
function monthWindowKey(intent: QaIntent, now: Date): string {
  switch (intent.window) {
    case "this_month":
      return monthStartKey(now, 0);
    case "last_month":
      return monthStartKey(now, -1);
    case "two_months_ago":
      return monthStartKey(now, -2);
    case "specific_month":
      return intent.monthRef ? specificMonthKey(intent.monthRef, now) : monthStartKey(now, 0);
    default:
      return monthStartKey(now, 0);
  }
}

// ─────────────────────────── SQL 生成（全部走白名单聚合口径） ───────────────────────────

/**
 * 按意图生成白名单聚合 SQL 列表（纯函数）。下标 0 是主查询，其余是补充查询；
 * 返回空数组表示本地没有该组合的取数口径（调用方应转在线兜底）。
 *
 * 口径说明（列名以 src/lib/schema/bill.ts 的 VIEW_DEFS / PRECOMPUTE_DEFS 为准）：
 * - v_monthly_summary：month（date_trunc 出的 TIMESTAMP，WHERE 里用
 *   'YYYY-MM-01' 字符串字面量比较）、expense_cents、income_cents、expense_tx；
 * - v_category_monthly：month、category、expense_cents、tx_count；
 * - v_merchant_monthly：month、merchant、total_cents、tx_count；
 * - v_daily_expense：date_iso、total_cents、tx_count（30/90 天窗按月粒度
 *   视图会混入窗外日期，改走日粒度视图求和）；
 * - v_top_merchants_90d：固定最近 90 天的商户聚合；
 * - v_mom_category：month、category、cur_cents、prev_cents、change_ratio，
 *   change_ratio 为 null 表示上月无记录；
 * - v_subscription_candidates：merchant、avg_cents、n、months_active 等；
 * - v_night_spend：month、night_cents、night_ratio（ratio 已是百分比数）；
 * - v_impulse_events：merchant、amount_cents、date_iso、category（补环比证据）；
 * - budget_vs_actual：ym（'YYYY-MM'）、category、budget_cents、actual_cents
 *   （DDL 见 08 修订案 A2，预算三表未进入 bill.ts，列名以 08 文档 DDL 为准）；
 * - transactions：30/90 天窗或按类目过滤的商户/类目统计直接查明细表聚合
 *   （direction/status/category/date_iso 均为白名单允许的 WHERE 比较列）。
 *
 * 白名单硬约束（src/lib/sql-guard/whitelist.ts）：必须 GROUP BY（≤3 列、
 * 列名在 ALLOWED_DIMENSIONS）；SELECT 只能是分组键或白名单聚合；
 * WHERE 只允许比较与 AND/OR/NOT；LIMIT ≤ 50；禁止注释/子查询/别名。
 * 每条 SQL 在单测里逐一通过 precheckAggregateSql 预检（qa-engine.test.ts）。
 */
export function buildIntentQueries(intent: QaIntent, now: Date): string[] {
  const { kind, category, window } = intent;
  const yearStart = `${now.getFullYear()}-01-01`;
  const range = windowDateRange(window, now, intent.monthRef);
  const catCond = category ? ` AND category = '${category}'` : "";

  switch (kind) {
    case "month_total": {
      // 月度总额：按 month 过滤本月/上个月，今年按年首起汇总，30/90 天走日粒度视图
      if (isMonthWindow(window)) {
        const month = monthWindowKey(intent, now);
        return [
          `SELECT month, SUM(expense_cents), SUM(income_cents), SUM(expense_tx) FROM v_monthly_summary WHERE month = '${month}' GROUP BY month`,
        ];
      }
      if (window === "this_year") {
        return [
          `SELECT month, SUM(expense_cents), SUM(income_cents), SUM(expense_tx) FROM v_monthly_summary WHERE month >= '${yearStart}' GROUP BY month ORDER BY month ASC LIMIT 12`,
        ];
      }
      return [
        `SELECT date_iso, SUM(total_cents), SUM(tx_count) FROM v_daily_expense WHERE date_iso >= '${range.start}' GROUP BY date_iso LIMIT 50`,
      ];
    }

    case "balance": {
      // 结余需要收入与支出两侧：7/30/90 天窗按 direction 分组直接汇总，
      // 月度与年度走 v_monthly_summary（income_cents 在内）
      if (window === "last_7d" || window === "last_30d" || window === "last_90d") {
        return [
          `SELECT direction, SUM(amount_cents), COUNT(*) FROM transactions WHERE status = 'paid' AND date_iso >= '${range.start}' GROUP BY direction`,
        ];
      }
      if (isMonthWindow(window)) {
        const month = monthWindowKey(intent, now);
        return [
          `SELECT month, SUM(expense_cents), SUM(income_cents), SUM(expense_tx) FROM v_monthly_summary WHERE month = '${month}' GROUP BY month`,
        ];
      }
      return [
        `SELECT month, SUM(expense_cents), SUM(income_cents), SUM(expense_tx) FROM v_monthly_summary WHERE month >= '${yearStart}' GROUP BY month ORDER BY month ASC LIMIT 12`,
      ];
    }

    case "category_spend": {
      if (!category) return [];
      if (isMonthWindow(window)) {
        const month = monthWindowKey(intent, now);
        return [
          `SELECT month, category, SUM(expense_cents), SUM(tx_count) FROM v_category_monthly WHERE month = '${month}' AND category = '${category}' GROUP BY month, category`,
        ];
      }
      if (window === "this_year") {
        return [
          `SELECT category, SUM(expense_cents), SUM(tx_count) FROM v_category_monthly WHERE month >= '${yearStart}' AND category = '${category}' GROUP BY category`,
        ];
      }
      // 30/90 天窗：v_daily_expense 没有类目列，直接按明细表聚合（日期下界即可，
      // 明细不会早于窗外也不会晚于今天）
      return [
        `SELECT category, SUM(amount_cents), COUNT(*) FROM transactions WHERE direction = 'expense' AND status = 'paid' AND category = '${category}' AND date_iso >= '${range.start}' GROUP BY category`,
      ];
    }

    case "top_merchant": {
      if (category) {
        // 带类目：商户视图没有类目列，改查明细表按日期范围聚合
        return [
          `SELECT merchant, SUM(amount_cents), COUNT(*) FROM transactions WHERE direction = 'expense' AND status = 'paid' AND category = '${category}' AND date_iso >= '${range.start}' AND date_iso < '${range.end}' GROUP BY merchant ORDER BY SUM(amount_cents) DESC LIMIT 5`,
        ];
      }
      if (window === "last_90d") {
        return [
          `SELECT merchant, SUM(total_cents), SUM(tx_count) FROM v_top_merchants_90d GROUP BY merchant ORDER BY SUM(total_cents) DESC LIMIT 5`,
        ];
      }
      if (window === "last_30d" || window === "last_7d") {
        return [
          `SELECT merchant, SUM(amount_cents), COUNT(*) FROM transactions WHERE direction = 'expense' AND status = 'paid' AND date_iso >= '${range.start}' AND date_iso < '${range.end}' GROUP BY merchant ORDER BY SUM(amount_cents) DESC LIMIT 5`,
        ];
      }
      if (window === "this_year") {
        return [
          `SELECT merchant, SUM(total_cents), SUM(tx_count) FROM v_merchant_monthly WHERE month >= '${yearStart}' GROUP BY merchant ORDER BY SUM(total_cents) DESC LIMIT 5`,
        ];
      }
      // 剩余四种按月窗口（本月/上月/上上个月/指定月份）共用按月粒度商户视图
      const month = monthWindowKey(intent, now);
      return [
        `SELECT merchant, SUM(total_cents), SUM(tx_count) FROM v_merchant_monthly WHERE month = '${month}' GROUP BY merchant ORDER BY SUM(total_cents) DESC LIMIT 5`,
      ];
    }

    case "mom_compare": {
      // 冲动消费证据：只在该窗日期范围内取，类目明确时才有意义
      const impulseSql = category
        ? `SELECT merchant, SUM(amount_cents), COUNT(*) FROM v_impulse_events WHERE category = '${category}' AND date_iso >= '${range.start}' AND date_iso < '${range.end}' GROUP BY merchant ORDER BY SUM(amount_cents) DESC LIMIT 3`
        : "";
      if (isMonthWindow(window)) {
        // 月窗：v_mom_category 一行同时带本期与上期（change_ratio 为 null 表示上月无记录）
        const month = monthWindowKey(intent, now);
        const queries = [
          `SELECT category, SUM(cur_cents), SUM(prev_cents), AVG(change_ratio) FROM v_mom_category WHERE month = '${month}'${catCond} GROUP BY category ORDER BY SUM(cur_cents) DESC LIMIT 5`,
        ];
        if (impulseSql) queries.push(impulseSql);
        return queries;
      }
      // 今年 / 7天 / 30天 / 90天窗：v_mom_category 是月粒度，跨月环比口径不精确，
      // 改为把窗口与前一个等长窗口分别按明细表聚合后在 JS 里比较。
      // 下标 0 = 本期、下标 1 = 上期、下标 2 = 冲动证据。
      const prevRange: DateRange =
        window === "this_year"
          ? { start: `${now.getFullYear() - 1}-01-01`, end: `${now.getFullYear()}-01-01` }
          : window === "last_7d"
            ? { start: dayStartKey(now, -14), end: dayStartKey(now, -7) }
            : window === "last_30d"
              ? { start: dayStartKey(now, -60), end: dayStartKey(now, -30) }
              : { start: dayStartKey(now, -180), end: dayStartKey(now, -90) };
      const queries = [
        `SELECT category, SUM(amount_cents), COUNT(*) FROM transactions WHERE direction = 'expense' AND status = 'paid'${catCond} AND date_iso >= '${range.start}' AND date_iso < '${range.end}' GROUP BY category LIMIT 5`,
        `SELECT category, SUM(amount_cents), COUNT(*) FROM transactions WHERE direction = 'expense' AND status = 'paid'${catCond} AND date_iso >= '${prevRange.start}' AND date_iso < '${prevRange.end}' GROUP BY category LIMIT 5`,
      ];
      if (impulseSql) queries.push(impulseSql);
      return queries;
    }

    case "subscription": {
      let amountSql: string;
      if (isMonthWindow(window)) {
        const month = monthWindowKey(intent, now);
        amountSql = `SELECT category, SUM(expense_cents), SUM(tx_count) FROM v_category_monthly WHERE month = '${month}' AND category = '订阅' GROUP BY category`;
      } else if (window === "this_year") {
        amountSql = `SELECT category, SUM(expense_cents), SUM(tx_count) FROM v_category_monthly WHERE month >= '${yearStart}' AND category = '订阅' GROUP BY category`;
      } else {
        amountSql = `SELECT category, SUM(amount_cents), COUNT(*) FROM transactions WHERE direction = 'expense' AND status = 'paid' AND category = '订阅' AND date_iso >= '${range.start}' GROUP BY category`;
      }
      // 下标 0 = 订阅类支出金额；下标 1 = 疑似订阅商户清单（按笔数倒序）
      return [
        amountSql,
        `SELECT merchant, MAX(avg_cents), SUM(n), MAX(months_active) FROM v_subscription_candidates GROUP BY merchant ORDER BY SUM(n) DESC LIMIT 10`,
      ];
    }

    case "night_spend": {
      if (isMonthWindow(window)) {
        const month = monthWindowKey(intent, now);
        return [
          `SELECT month, SUM(night_cents), AVG(night_ratio) FROM v_night_spend WHERE month = '${month}' GROUP BY month`,
        ];
      }
      if (window === "this_year") {
        // 年度深夜占比：v_night_spend 只有深夜金额与占比，年度总额需另查
        // v_monthly_summary 后在 JS 里相除。下标 0 = 深夜、下标 1 = 总支出。
        return [
          `SELECT month, SUM(night_cents) FROM v_night_spend WHERE month >= '${yearStart}' GROUP BY month ORDER BY month ASC LIMIT 12`,
          `SELECT month, SUM(expense_cents) FROM v_monthly_summary WHERE month >= '${yearStart}' GROUP BY month LIMIT 12`,
        ];
      }
      // 30/90 天窗：深夜口径依赖交易时刻的小时数，白名单 WHERE 不支持函数，
      // 且没有按天的深夜视图，本地不硬凑近似值，转在线兜底。
      return [];
    }

    case "budget": {
      // budget_vs_actual 的 ym 是 'YYYY-MM' 字符串（08 修订案 A2 DDL）
      if (window === "this_year") {
        return [
          `SELECT category, SUM(budget_cents), SUM(actual_cents) FROM budget_vs_actual WHERE ym >= '${now.getFullYear()}-01'${catCond} GROUP BY category LIMIT 50`,
        ];
      }
      if (isMonthWindow(window)) {
        const ym = monthWindowKey(intent, now).slice(0, 7);
        return [
          `SELECT ym, category, SUM(budget_cents), SUM(actual_cents) FROM budget_vs_actual WHERE ym = '${ym}'${catCond} GROUP BY ym, category LIMIT 50`,
        ];
      }
      // 30/90 天窗：预算表按月份粒度，没有按天口径，转在线兜底。
      return [];
    }

    case "overview": {
      // 下标 0 = 收支总额（月窗按月、日窗按天、30/90 天窗按 direction 分组）；
      // 下标 1 = 支出 Top5 类目。
      if (isMonthWindow(window)) {
        const month = monthWindowKey(intent, now);
        return [
          `SELECT month, SUM(expense_cents), SUM(income_cents), SUM(expense_tx), SUM(income_tx) FROM v_monthly_summary WHERE month = '${month}' GROUP BY month`,
          `SELECT category, SUM(expense_cents), SUM(tx_count) FROM v_category_monthly WHERE month = '${month}' GROUP BY category ORDER BY SUM(expense_cents) DESC LIMIT 5`,
        ];
      }
      if (window === "this_year") {
        return [
          `SELECT month, SUM(expense_cents), SUM(income_cents), SUM(expense_tx) FROM v_monthly_summary WHERE month >= '${yearStart}' GROUP BY month ORDER BY month ASC LIMIT 12`,
          `SELECT category, SUM(expense_cents), SUM(tx_count) FROM v_category_monthly WHERE month >= '${yearStart}' GROUP BY category ORDER BY SUM(expense_cents) DESC LIMIT 5`,
        ];
      }
      return [
        `SELECT direction, SUM(amount_cents), COUNT(*) FROM transactions WHERE status = 'paid' AND date_iso >= '${range.start}' GROUP BY direction`,
        `SELECT category, SUM(amount_cents), COUNT(*) FROM transactions WHERE direction = 'expense' AND status = 'paid' AND date_iso >= '${range.start}' GROUP BY category ORDER BY SUM(amount_cents) DESC LIMIT 5`,
      ];
    }
  }
}

// ─────────────────────────── 金额与文案工具 ───────────────────────────

/** 金额展示：整数分 → 「¥X.XX 元」字符串（负数写作 -¥X.XX 元）。导出供 deep-analysis（A14）共用 */
export function yuanText(cents: number): string {
  return cents < 0 ? `-¥${fmtYuan(Math.abs(cents))} 元` : `¥${fmtYuan(cents)} 元`;
}

/** 百分比展示：保留 1 位小数，非负数带 + 号（环比/同比正负方向一眼可辨） */
function signedPct(ratio: number): string {
  return `${ratio >= 0 ? "+" : ""}${ratio.toFixed(1)}%`;
}

/** 按 SELECT 位置对多行求和（金额可能是 bigint / 大数对象 / number，统一 Number() 兜底） */
function sumAt(rows: Record<string, unknown>[], index: number): number {
  return rows.reduce((sum, row) => sum + numAt(row, index), 0);
}

/** 把 SqlRunner 的 unknown[] 结果收窄为行对象数组（DuckDB 聚合结果行均为对象）。导出供 deep-analysis（A14）共用 */
export function asRowList(rows: unknown[]): Record<string, unknown>[] {
  return rows as Record<string, unknown>[];
}

/** 商户名展示：空值归并为「未注明商户」（聚合结果里 merchant 可能为 null）。导出供 deep-analysis（A14）共用 */
export function merchantName(value: unknown): string {
  const name = String(value ?? "").trim();
  return name === "" ? "未注明商户" : name;
}

/** 某维度查不到数据时的确定文案（有数据但该维度为空的第二种措辞） */
function emptyDimensionText(intent: QaIntent, now: Date): string {
  const win = windowLabel(intent, now);
  switch (intent.kind) {
    case "month_total":
    case "overview":
      return `${win}没有支出记录。`;
    case "category_spend":
      return `${win}没有「${intent.category ?? ""}」支出记录。`;
    case "balance":
      return `${win}没有收支记录。`;
    case "subscription":
      return `${win}没有订阅类支出记录。`;
    case "top_merchant":
      return intent.category
        ? `${win}没有「${intent.category}」的商户支出记录。`
        : `${win}没有商户支出记录。`;
    case "mom_compare":
      return intent.category
        ? `${win}没有「${intent.category}」支出记录。`
        : `${win}没有可比较的支出记录。`;
    case "night_spend":
      return `${win}没有深夜时段的支出记录。`;
    case "budget":
      return `${win}没有设置预算记录。`;
  }
}

/** 数据集是否为空：transactions 0 行即视为还没导入账单 */
const DATASET_PROBE_SQL =
  "SELECT account_id, COUNT(*) FROM transactions GROUP BY account_id LIMIT 1";

async function datasetIsEmpty(runSql: SqlRunner): Promise<boolean> {
  // 探针抛错时不再吞成「空数据集」：主查询刚成功过，探针失败是引擎故障，
  // 让它向上抛，由面板的本地查询 catch 转在线兜底（见 answerLocalQuestion）
  const rows = await runSql(DATASET_PROBE_SQL);
  return rows.length === 0;
}

/**
 * 环比回答里追加冲动消费证据（v_impulse_events 命中才追加，查不到就不提）。
 * 措辞只用“单笔较大的支出”这类事实描述，不推断原因。
 */
function appendImpulseEvidence(text: string, impulseRows: Record<string, unknown>[]): string {
  if (impulseRows.length === 0) return text;
  const items = impulseRows
    .slice(0, 3)
    .map((row) => `「${merchantName(valAt(row, 0))}」${yuanText(numAt(row, 1))}`);
  const base = text.endsWith("。") ? text.slice(0, -1) : text;
  return `${base}，相关冲动消费：${items.join("、")}。`;
}

// ─────────────────────────── 答案文案组装 ───────────────────────────

/**
 * 把意图、主查询结果与补充查询结果组装成确定性中文回答。
 * 所有数字只来自查询结果行；查不到的部分如实措辞，不编造结论。
 * secondary 与 buildIntentQueries 的下标一一对应（下标 0 起是补充查询）。
 */
function buildAnswerText(
  intent: QaIntent,
  primary: Record<string, unknown>[],
  secondary: Record<string, unknown>[][],
  now: Date,
): string {
  const { kind, window } = intent;
  const win = windowLabel(intent, now);
  const daily = window === "last_7d" || window === "last_30d" || window === "last_90d";

  switch (kind) {
    case "month_total": {
      const expense = sumAt(primary, 1);
      const tx = sumAt(primary, daily ? 2 : 3);
      return `${win}共支出 ${yuanText(expense)}，共 ${tx} 笔。`;
    }

    case "balance": {
      if (daily) {
        // 30/90 天窗按 direction 分组：分别取 expense / income 两行的金额与笔数
        const expenseRow = primary.find((row) => String(valAt(row, 0) ?? "") === "expense");
        const incomeRow = primary.find((row) => String(valAt(row, 0) ?? "") === "income");
        const expense = expenseRow ? numAt(expenseRow, 1) : 0;
        const income = incomeRow ? numAt(incomeRow, 1) : 0;
        const tx = expenseRow ? numAt(expenseRow, 2) : 0;
        if (income === 0) {
          return `${win}支出 ${yuanText(expense)}（${tx} 笔）；${win}没有收入记录，因此结余为 ${yuanText(-expense)}。`;
        }
        return `${win}收入 ${yuanText(income)}，支出 ${yuanText(expense)}（${tx} 笔），结余 ${yuanText(income - expense)}。`;
      }
      const expense = sumAt(primary, 1);
      const income = sumAt(primary, 2);
      const tx = sumAt(primary, 3);
      if (income === 0) {
        return `${win}支出 ${yuanText(expense)}（${tx} 笔）；${win}没有收入记录，因此结余为 ${yuanText(-expense)}。`;
      }
      return `${win}收入 ${yuanText(income)}，支出 ${yuanText(expense)}（${tx} 笔），结余 ${yuanText(income - expense)}。`;
    }

    case "category_spend": {
      // 月窗主查询是 4 列（month, category, expense, tx），其余窗口是 3 列
      const monthWindow = isMonthWindow(window);
      const expense = sumAt(primary, monthWindow ? 2 : 1);
      const tx = sumAt(primary, monthWindow ? 3 : 2);
      return `${win}「${intent.category ?? ""}」支出 ${yuanText(expense)}，共 ${tx} 笔。`;
    }

    case "top_merchant": {
      const rows = primary.filter((row) => numAt(row, 1) > 0).slice(0, 3);
      if (rows.length === 0) return `${win}没有商户支出记录。`;
      const catPrefix = intent.category ? `「${intent.category}」` : "";
      const first = rows[0]!;
      let text = `${win}${catPrefix}花得最多的是「${merchantName(valAt(first, 0))}」，共 ${yuanText(numAt(first, 1))}（${numAt(first, 2)} 笔）`;
      if (rows[1]) {
        text += `；其次是「${merchantName(valAt(rows[1], 0))}」${yuanText(numAt(rows[1], 1))}`;
      }
      if (rows[2]) {
        text += `、「${merchantName(valAt(rows[2], 0))}」${yuanText(numAt(rows[2], 1))}`;
      }
      return `${text}。`;
    }

    case "mom_compare": {
      const prevName = prevWindowLabel(intent, now);
      const monthWindow = isMonthWindow(window);
      if (intent.category) {
        if (monthWindow) {
          // 月窗主查询一行同时带本期/上期：下标 0=category、1=cur、2=prev、3=ratio
          const row = primary[0];
          if (!row) return `${win}没有「${intent.category}」支出记录。`;
          const cur = numAt(row, 1);
          const prev = numAt(row, 2);
          const ratio = numAt(row, 3);
          if (valAt(row, 2) == null || prev === 0) {
            // 上月无记录要如实措辞，不做环比
            const base = `${win}「${intent.category}」支出 ${yuanText(cur)}；${prevName}没有支出记录，无法计算环比。`;
            return appendImpulseEvidence(base, secondary[0] ?? []);
          }
          const base = `${win}「${intent.category}」支出 ${yuanText(cur)}，${prevName} ${yuanText(prev)}，环比${cur >= prev ? "涨" : "降"} ${yuanText(Math.abs(cur - prev))}（${signedPct(ratio)}）。`;
          return appendImpulseEvidence(base, secondary[0] ?? []);
        }
        // 今年/30/90 天窗：下标 0=本期行、下标 1=上期行、下标 2=冲动证据
        const cur = sumAt(primary, 1);
        const prev = sumAt(secondary[0] ?? [], 1);
        if (prev === 0) {
          const base = `${win}「${intent.category}」支出 ${yuanText(cur)}；${prevName}没有支出记录，无法计算环比。`;
          return appendImpulseEvidence(base, secondary[1] ?? []);
        }
        const pct = ((cur - prev) / prev) * 100;
        const label = window === "this_year" ? "同比" : "环比";
        const base = `${win}「${intent.category}」支出 ${yuanText(cur)}，${prevName} ${yuanText(prev)}，${label}${cur >= prev ? "涨" : "降"} ${yuanText(Math.abs(cur - prev))}（${signedPct(pct)}）。`;
        return appendImpulseEvidence(base, secondary[1] ?? []);
      }

      // 无类目：汇总各类目找变化最大的前 3 个
      interface Mover {
        name: string;
        cur: number;
        prev: number | null;
      }
      let movers: Mover[];
      if (monthWindow) {
        movers = primary
          .map((row) => ({
            name: String(valAt(row, 0) ?? ""),
            cur: numAt(row, 1),
            prev: valAt(row, 2) == null ? null : numAt(row, 2),
          }))
          .filter((m) => m.cur > 0 || m.prev !== null);
      } else {
        const prevMap = new Map<string, number>();
        for (const row of secondary[0] ?? []) {
          prevMap.set(String(valAt(row, 0) ?? ""), numAt(row, 1));
        }
        movers = primary
          .filter((row) => numAt(row, 1) > 0)
          .map((row) => ({
            name: String(valAt(row, 0) ?? ""),
            cur: numAt(row, 1),
            prev: prevMap.get(String(valAt(row, 0) ?? "")) ?? 0,
          }));
      }
      // 按变化绝对值从大到小排，同幅按类目名排（保证输出顺序确定）
      movers.sort((a, b) => {
        const da = Math.abs(a.cur - (a.prev ?? 0));
        const db = Math.abs(b.cur - (b.prev ?? 0));
        if (db !== da) return db - da;
        return a.name.localeCompare(b.name);
      });
      const top = movers.slice(0, 3);
      if (top.length === 0) return `${win}没有可比较的支出记录。`;
      const changeLabel = window === "this_year" ? "同比变化" : "环比变化";
      const items = top.map((m) => {
        if (m.prev == null || m.prev === 0) {
          return `「${m.name}」${yuanText(m.cur)}（${prevName}无记录）`;
        }
        const pct = ((m.cur - m.prev) / m.prev) * 100;
        return `「${m.name}」${yuanText(m.cur)}（较${prevName}${m.cur >= m.prev ? "涨" : "降"} ${yuanText(Math.abs(m.cur - m.prev))}，${signedPct(pct)}）`;
      });
      return `${win}支出${changeLabel}较大的类目：${items.join("；")}。`;
    }

    case "subscription": {
      const expense = sumAt(primary, 1);
      const tx = sumAt(primary, 2);
      const candidates = secondary[0] ?? [];
      const parts: string[] = [];
      if (expense > 0) {
        parts.push(`${win}订阅类支出 ${yuanText(expense)}（${tx} 笔）`);
      }
      if (candidates.length > 0) {
        const top = candidates
          .slice(0, 3)
          .map(
            (row) =>
              `「${merchantName(valAt(row, 0))}」月均 ${yuanText(numAt(row, 1))}（活跃 ${numAt(row, 3)} 个月）`,
          )
          .join("、");
        parts.push(`检测到疑似订阅 ${candidates.length} 个：${top}`);
      }
      if (parts.length === 0) return `${win}没有订阅类支出记录。`;
      return `${parts.join("；")}。`;
    }

    case "night_spend": {
      if (isMonthWindow(window)) {
        const row = primary[0];
        if (!row) return `${win}没有深夜时段的支出记录。`;
        const night = numAt(row, 1);
        if (night <= 0) return `${win}没有深夜时段（23:00-05:00）的支出记录。`;
        const ratio = numAt(row, 2);
        if (ratio <= 0) return `${win}深夜时段（23:00-05:00）支出 ${yuanText(night)}。`;
        return `${win}深夜时段（23:00-05:00）支出 ${yuanText(night)}，占${win}支出的 ${ratio.toFixed(1)}%。`;
      }
      // 年度：深夜金额与总支出分别在两个查询里（下标 0 / 下标 1）
      const night = sumAt(primary, 1);
      if (night <= 0) return "今年没有深夜时段（23:00-05:00）的支出记录。";
      const expense = sumAt(secondary[0] ?? [], 1);
      if (expense <= 0) return `今年深夜时段（23:00-05:00）支出 ${yuanText(night)}。`;
      return `今年深夜时段（23:00-05:00）支出 ${yuanText(night)}，占今年支出的 ${((night / expense) * 100).toFixed(1)}%。`;
    }

    case "budget": {
      // 月窗行：下标 0=ym、1=category、2=budget_cents、3=actual_cents；
      // 年度行：下标 0=category、1=budget_cents、2=actual_cents
      const isYear = window === "this_year";
      const catIdx = isYear ? 0 : 1;
      const budgetIdx = isYear ? 1 : 2;
      const actualIdx = isYear ? 2 : 3;
      const remainTail = (budget: number, actual: number): string =>
        budget - actual >= 0
          ? `还剩 ${yuanText(budget - actual)}`
          : `已超支 ${yuanText(actual - budget)}`;

      if (intent.category) {
        const row = primary[0];
        if (!row || numAt(row, budgetIdx) <= 0) {
          return `${win}没有设置「${intent.category}」的预算记录。`;
        }
        const budget = numAt(row, budgetIdx);
        const actual = numAt(row, actualIdx);
        return `${win}「${intent.category}」预算 ${yuanText(budget)}，已支出 ${yuanText(actual)}（已用 ${((actual / budget) * 100).toFixed(1)}%），${remainTail(budget, actual)}。`;
      }
      const lines: string[] = [];
      const totalRow = primary.find(
        (row) => String(valAt(row, catIdx) ?? "") === "total" && numAt(row, budgetIdx) > 0,
      );
      if (totalRow) {
        const budget = numAt(totalRow, budgetIdx);
        const actual = numAt(totalRow, actualIdx);
        lines.push(
          `${win}总预算 ${yuanText(budget)}，已支出 ${yuanText(actual)}，${remainTail(budget, actual)}`,
        );
      }
      for (const row of primary) {
        const name = String(valAt(row, catIdx) ?? "");
        if (name === "total") continue;
        if (numAt(row, budgetIdx) <= 0) continue;
        const budget = numAt(row, budgetIdx);
        const actual = numAt(row, actualIdx);
        lines.push(
          `·「${name}」预算 ${yuanText(budget)}，已支出 ${yuanText(actual)}，${remainTail(budget, actual)}`,
        );
      }
      if (lines.length === 0) return `${win}没有设置预算记录。`;
      return lines.join("\n");
    }

    case "overview": {
      if (daily) {
        const expenseRow = primary.find((row) => String(valAt(row, 0) ?? "") === "expense");
        const incomeRow = primary.find((row) => String(valAt(row, 0) ?? "") === "income");
        const expense = expenseRow ? numAt(expenseRow, 1) : 0;
        const income = incomeRow ? numAt(incomeRow, 1) : 0;
        const tx = expenseRow ? numAt(expenseRow, 2) : 0;
        let text = `${win}共支出 ${yuanText(expense)}（${tx} 笔）`;
        text +=
          income > 0
            ? `，收入 ${yuanText(income)}，结余 ${yuanText(income - expense)}`
            : "，没有收入记录";
        const tops = (secondary[0] ?? []).filter((row) => numAt(row, 1) > 0).slice(0, 5);
        if (tops.length > 0) {
          text += `。支出最多的类目：${tops
            .map(
              (row) =>
                `「${String(valAt(row, 0) ?? "")}」${yuanText(numAt(row, 1))}（${numAt(row, 2)} 笔）`,
            )
            .join("、")}`;
        }
        return `${text}。`;
      }
      const expense = sumAt(primary, 1);
      const income = sumAt(primary, 2);
      const tx = sumAt(primary, 3);
      let text = `${win}共支出 ${yuanText(expense)}（${tx} 笔）`;
      text +=
        income > 0
          ? `，收入 ${yuanText(income)}，结余 ${yuanText(income - expense)}`
          : "，没有收入记录";
      const tops = (secondary[0] ?? []).filter((row) => numAt(row, 1) > 0).slice(0, 5);
      if (tops.length > 0) {
        text += `。支出最多的类目：${tops
          .map(
            (row) =>
              `「${String(valAt(row, 0) ?? "")}」${yuanText(numAt(row, 1))}（${numAt(row, 2)} 笔）`,
          )
          .join("、")}`;
      }
      return `${text}。`;
    }
  }
}

// ─────────────────────────── 本地回答入口 ───────────────────────────

/**
 * 本地回答入口：解析不出来的组合返回 unhandled（面板转在线兜底）；
 * 主查询查不到数据时用数据集探针区分两种无数据文案；
 * 补充查询失败只省略对应部分，不影响主回答。
 * anchor 参数保留契约签名：槽位补全已在 analyzeQuestion 阶段并入 intent。
 */
export async function answerLocalQuestion(
  runSql: SqlRunner,
  intent: QaIntent,
  anchor: { id: string; label: string } | null,
): Promise<LocalAnswer> {
  // 契约签名里保留 anchor 参数，便于后续追问链路扩展；当前版本不读取。
  void anchor;

  const now = new Date();
  const queries = buildIntentQueries(intent, now);
  if (queries.length === 0) return { kind: "unhandled" };

  let primary: Record<string, unknown>[];
  try {
    primary = asRowList(await runSql(queries[0]!));
  } catch {
    // 主查询抛错是引擎接线故障（白名单拒绝 / DuckDB 报错 / 超时），本地给不出
    // 可信答案；按 unhandled 转在线兜底，不能假称「还没有账单数据」盖本地计算章。
    // 「本会话没导入账单」的场景由面板在调用前用 datasetTxHash 闸门拦住，不会到这里
    return { kind: "unhandled" };
  }
  if (primary.length === 0) {
    if (await datasetIsEmpty(runSql)) {
      return { kind: "no-data", text: DATASET_EMPTY_TEXT };
    }
    return { kind: "no-data", text: emptyDimensionText(intent, now) };
  }

  const secondary: Record<string, unknown>[][] = [];
  for (let i = 1; i < queries.length; i += 1) {
    try {
      secondary.push(asRowList(await runSql(queries[i]!)));
    } catch {
      secondary.push([]);
    }
  }
  return { kind: "data", text: buildAnswerText(intent, primary, secondary, now) };
}

// ─────────────────────────── 在线兜底用的汇总上下文 ───────────────────────────

/**
 * 生成 buildAggregateContext 使用的固定白名单查询清单（导出供单测逐一过
 * precheckAggregateSql 预检）。全部是聚合统计口径，绝不含逐笔明细。
 */
export function buildContextQueries(now: Date): string[] {
  const curMonth = monthStartKey(now, 0);
  const nextMonth = monthStartKey(now, 1);
  return [
    // 0：数据时间跨度 + 支出笔数（status='paid' 的支出行）
    `SELECT account_id, COUNT(*), MIN(date_iso), MAX(date_iso) FROM transactions WHERE direction = 'expense' AND status = 'paid' GROUP BY account_id LIMIT 1`,
    // 1：近 3 个月逐月支出 / 收入 / 笔数（month DESC 保证第一行是最近月）
    `SELECT month, SUM(expense_cents), SUM(income_cents), SUM(expense_tx) FROM v_monthly_summary GROUP BY month ORDER BY month DESC LIMIT 3`,
    // 2：本月类目支出 Top5
    `SELECT category, SUM(expense_cents), SUM(tx_count) FROM v_category_monthly WHERE month = '${curMonth}' GROUP BY category ORDER BY SUM(expense_cents) DESC LIMIT 5`,
    // 3：近 90 天商户支出 Top5
    `SELECT merchant, SUM(total_cents), SUM(tx_count) FROM v_top_merchants_90d GROUP BY merchant ORDER BY SUM(total_cents) DESC LIMIT 5`,
    // 4：疑似订阅商户清单（按笔数倒序，最多 10 个）
    `SELECT merchant, MAX(avg_cents), SUM(n), MAX(months_active) FROM v_subscription_candidates GROUP BY merchant ORDER BY SUM(n) DESC LIMIT 10`,
    // 5：本月深夜支出与占比
    `SELECT month, SUM(night_cents), AVG(night_ratio) FROM v_night_spend WHERE month = '${curMonth}' GROUP BY month`,
    // 6：本月冲动消费金额（按天分组后在 JS 里求和）
    `SELECT date_iso, SUM(amount_cents), COUNT(*) FROM v_impulse_events WHERE date_iso >= '${curMonth}' AND date_iso < '${nextMonth}' GROUP BY date_iso LIMIT 50`,
    // 7：本月支出总额（深夜/冲动占比的分母）
    `SELECT month, SUM(expense_cents) FROM v_monthly_summary WHERE month = '${curMonth}' GROUP BY month`,
  ];
}

/**
 * 在线兜底用的账单汇总上下文：固定 6 组白名单统计拼成中文文本块，
 * 每条以「·」开头；任何一组查不到就省略该组；总长不超过 2000 字；
 * 全部是汇总统计，绝不含逐笔明细。无任何数据时返回空串。
 */
export async function buildAggregateContext(runSql: SqlRunner): Promise<string> {
  const queries = buildContextQueries(new Date());
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

  // 组 1：数据时间跨度 + 总笔数
  const scopeRows = at(0);
  const total = scopeRows.reduce((sum, row) => sum + numAt(row, 1), 0);
  if (total > 0) {
    let first = "";
    let last = "";
    for (const row of scopeRows) {
      const f = String(valAt(row, 2) ?? "");
      const l = String(valAt(row, 3) ?? "");
      if (!first || f < first) first = f;
      if (l > last) last = l;
    }
    lines.push(`· 数据范围：${first} 至 ${last}，共 ${total} 笔支出`);
  }

  // 组 2：近 3 个月逐月收支（month DESC，第一行是最近月）
  const monthlyRows = at(1);
  if (monthlyRows.length > 0) {
    const parts = monthlyRows.map(
      (row) =>
        `${fmtMonth(valAt(row, 0))} 支出 ${yuanText(numAt(row, 1))}（${numAt(row, 3)} 笔）、收入 ${yuanText(numAt(row, 2))}、结余 ${yuanText(numAt(row, 2) - numAt(row, 1))}`,
    );
    lines.push(`· 近3个月：${parts.join("；")}`);
  }

  // 组 3：本月类目 Top5
  const categoryRows = at(2);
  if (categoryRows.length > 0) {
    const parts = categoryRows.map(
      (row) =>
        `「${String(valAt(row, 0) ?? "")}」${yuanText(numAt(row, 1))}（${numAt(row, 2)} 笔）`,
    );
    lines.push(`· 本月类目 Top5：${parts.join("、")}`);
  }

  // 组 4：近 90 天商户 Top5
  const merchantRows = at(3);
  if (merchantRows.length > 0) {
    const parts = merchantRows.map(
      (row) =>
        `「${merchantName(valAt(row, 0))}」${yuanText(numAt(row, 1))}（${numAt(row, 2)} 笔）`,
    );
    lines.push(`· 近90天商户 Top5：${parts.join("、")}`);
  }

  // 组 5：订阅候选清单
  const subscriptionRows = at(4);
  if (subscriptionRows.length > 0) {
    const parts = subscriptionRows
      .slice(0, 10)
      .map(
        (row) =>
          `「${merchantName(valAt(row, 0))}」月均 ${yuanText(numAt(row, 1))}（活跃 ${numAt(row, 3)} 个月）`,
      );
    lines.push(`· 订阅候选：${parts.join("、")}`);
  }

  // 组 6：本月深夜占比与冲动消费占比（分母是本月支出总额，组内三个查询）
  const nightRows = at(5);
  const impulseRows = at(6);
  const expenseRows = at(7);
  const monthExpense = expenseRows.reduce((sum, row) => sum + numAt(row, 1), 0);
  const nightCents = nightRows.reduce((sum, row) => sum + numAt(row, 1), 0);
  const impulseCents = impulseRows.reduce((sum, row) => sum + numAt(row, 1), 0);
  if (monthExpense > 0) {
    const segments: string[] = [];
    if (nightCents > 0) {
      segments.push(`深夜支出占比 ${((nightCents / monthExpense) * 100).toFixed(1)}%`);
    }
    if (impulseCents > 0) {
      segments.push(`冲动消费占比 ${((impulseCents / monthExpense) * 100).toFixed(1)}%`);
    }
    if (segments.length > 0) {
      lines.push(`· 本月${segments.join("、")}`);
    }
  }

  // 总长控制：超长时从末尾整条丢弃（每条一组统计，丢弃后语义仍完整）
  let output = lines.join("\n");
  while (output.length > 2000 && lines.length > 1) {
    lines.pop();
    output = lines.join("\n");
  }
  return output;
}

// ─────────────────────────── 明细快照（在线兜底口径，08 修订案 A8） ───────────────────────────

/**
 * 明细快照 SQL：在线兜底时随汇总统计一并发送给大模型的最近明细（≤150 笔）。
 *
 * 口径（与聚合白名单「明细列禁投影」互为边界，直连明细出口之一，见 08 修订案 A8；
 * 另一个直连明细出口是按问题定向检索的 targeted-detail.ts，见 08 修订案 A15）：
 * - 固定语句、零动态拼接：无时间窗参数、无用户输入，不可能注入；
 * - 只 SELECT 收支方向的行（neutral 理财行 / refunded 退款行不进快照）；
 * - LIMIT 150 按交易时刻倒序 = 最近 150 笔，体积不随数据集规模增长；
 * - 投影 7 列（顺序即列序，formatDetailLine 按位置取值）：
 *   0 date_iso 日期；1 ts_text 完整时刻（YYYY-MM-DD HH:MM:SS）；
 *   2 category 类目；3 merchant 商户；4 amount_cents 金额（分）；
 *   5 direction 收支方向；6 night_flag 深夜标记（23:00-05:00 记为 1）；
 * - 只经浏览器内 DuckDB 直连执行，服务端接触不到本条语句。
 */
export const DETAIL_SNAPSHOT_SQL = [
  "SELECT date_iso, strftime('%Y-%m-%d %H:%M:%S', ts) AS ts_text, category, merchant, amount_cents, direction, CASE WHEN EXTRACT(HOUR FROM ts) >= 23 OR EXTRACT(HOUR FROM ts) < 5 THEN 1 ELSE 0 END AS night_flag",
  "FROM transactions",
  "WHERE direction <> 'neutral' AND status <> 'refunded'",
  "ORDER BY ts DESC",
  "LIMIT 150",
].join("\n");

/** 明细快照执行器工厂：固定 SQL 直连单例连接执行（不经聚合白名单） */
export function createDuckDbDetailSnapshot(): () => Promise<Record<string, unknown>[]> {
  return async () => {
    const conn = await getDuckDB();
    const result = await conn.query(DETAIL_SNAPSHOT_SQL);
    return result.toArray() as unknown as Record<string, unknown>[];
  };
}

/**
 * 明细行文本拼装（A8 明细快照与 A15 定向明细共用的行格式），按 SELECT 位置取值：
 *   0 date_iso（日期兜底）｜1 ts_text（YYYY-MM-DD HH:MM:SS，优先展示）
 *   2 category｜3 merchant｜4 amount_cents｜5 direction｜6 night_flag（0/1）
 * 输出「YYYY-MM-DD HH:MM:SS 类目 商户 支出/收入¥X.XX 元」，
 * night_flag 为 1 的行末尾追加「（深夜）」。导出供 targeted-detail（A15）共用。
 */
export function formatDetailLine(row: Record<string, unknown>): string {
  const timeText = String(valAt(row, 1) ?? "").trim();
  // ts 为空时（理论上不存在，防御性兜底）退回 date_iso 纯日期
  const time = timeText !== "" ? timeText : String(valAt(row, 0) ?? "");
  const category = String(valAt(row, 2) ?? "");
  const merchant = merchantName(valAt(row, 3));
  const direction = String(valAt(row, 5) ?? "") === "income" ? "收入" : "支出";
  const nightSuffix = numAt(row, 6) === 1 ? "（深夜）" : "";
  return `${time} ${category} ${merchant} ${direction}${yuanText(numAt(row, 4))}${nightSuffix}`;
}

/**
 * 会话快照构建器（07 §18 协议演示工具 query_bill_db_metadata 的输入侧）：
 * 直读 DuckDB-WASM 收集聚合元数据——行数、列 schema（information_schema.columns）、
 * 金额列统计与类目基数。只发聚合元数据与单值样例，不发明细行；
 * 任何一步失败返回 null（面板省略快照段，追问照常）。
 * datasetTxHash 由面板从管线 store 注入（浏览器侧本地生成）。
 */
export function createDuckDbSchemaSnapshot(
  datasetTxHash: string,
): () => Promise<SessionSchema | null> {
  return async () => {
    try {
      const conn = await getDuckDB();

      const countRows = await (
        await conn.query("SELECT COUNT(*) AS n FROM transactions")
      ).toArray();
      const rowCount = Number(countRows[0]?.n ?? 0);

      // 列元数据：按物理列序取列名与类型，样例取首行单值（截断到 128 字）
      const columnRows = await (
        await conn.query(
          "SELECT column_name, data_type FROM information_schema.columns " +
            "WHERE table_name = 'transactions' ORDER BY ordinal_position",
        )
      ).toArray();
      const firstRow =
        rowCount > 0
          ? ((await (await conn.query("SELECT * FROM transactions LIMIT 1")).toArray())[0] as
              Record<string, unknown> | undefined)
          : undefined;
      const schema = columnRows.map((row) => {
        const name = String(row.column_name);
        const value = firstRow?.[name];
        const sampleText = value === null || value === undefined ? "" : String(value);
        return { name, type: String(row.data_type), sample: sampleText.slice(0, 128) };
      });
      if (schema.length === 0) return null;

      // 统计：金额列数字统计 + 类目基数（列名与 MCP 工具白名单口径一致）
      const stats: NonNullable<SessionSchema["stats"]> = [];
      if (rowCount > 0) {
        const amountRows = await (
          await conn.query(
            "SELECT MIN(amount_cents) AS mn, MAX(amount_cents) AS mx, " +
              "ROUND(MEAN(amount_cents), 1) AS av, COUNT(DISTINCT amount_cents) AS dc FROM transactions",
          )
        ).toArray();
        const amount = amountRows[0];
        if (amount) {
          const stat: {
            column: string;
            min?: number;
            max?: number;
            mean?: number;
            distinct?: number;
          } = {
            column: "amount_cents",
          };
          const mn = Number(amount.mn);
          const mx = Number(amount.mx);
          const av = Number(amount.av);
          const dc = Number(amount.dc);
          if (Number.isFinite(mn)) stat.min = mn;
          if (Number.isFinite(mx)) stat.max = mx;
          if (Number.isFinite(av)) stat.mean = av;
          if (Number.isFinite(dc)) stat.distinct = dc;
          stats.push(stat);
        }
        const categoryRows = await (
          await conn.query("SELECT COUNT(DISTINCT category) AS dc FROM transactions")
        ).toArray();
        const categoryDistinct = Number(categoryRows[0]?.dc ?? 0);
        if (Number.isFinite(categoryDistinct)) {
          stats.push({ column: "category", distinct: categoryDistinct });
        }
      }

      return {
        table: "transactions",
        rowCount,
        datasetTxHash,
        schema,
        stats,
      } satisfies SessionSchema;
    } catch {
      return null; // 快照读不到时省略该段，由面板决定是否仍转在线
    }
  };
}

/**
 * 明细快照文本：把快照行拼成「YYYY-MM-DD HH:MM:SS 类目 商户 支出/收入¥X.XX」
 * 文本块（深夜行末尾带「（深夜）」标记），行间以「；」连接，总长 ≤maxChars
 * （超长按行截断，整行丢弃保证单条语义完整）。runDetail 入参注入便于单测用假行驱动。
 */
export async function buildDetailContext(
  runDetail: () => Promise<Record<string, unknown>[]>,
  maxChars = 3000,
): Promise<string> {
  let rows: Record<string, unknown>[] = [];
  try {
    rows = await runDetail();
  } catch {
    rows = []; // 快照读不到时省略该段，由面板决定是否仍转在线
  }

  const lines: string[] = [];
  let used = 0;
  for (const row of rows) {
    const line = formatDetailLine(row);
    if (used + line.length > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join("；");
}

// ─────────────────────────── DuckDB 执行器接线 ───────────────────────────

/**
 * 浏览器侧 SQL 执行器：单例 DuckDB 连接 + 白名单聚合执行（预检、3s 超时、
 * 行数复检都在 runWhitelistedAggregate 内完成）。由追问面板在首次提问时惰性创建。
 */
export function createDuckDbRunner(): SqlRunner {
  return async (sql: string) => {
    const conn = await getDuckDB();
    const result = await runWhitelistedAggregate(conn, sql);
    return result.rows;
  };
}
