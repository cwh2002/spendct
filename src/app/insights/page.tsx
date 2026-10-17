"use client";

import {
  ArrowRight,
  ChartColumn,
  Inbox,
  LayoutGrid,
  MessageSquare,
  PiggyBank,
  Radar,
  ReceiptText,
  Rows3,
  Star,
  Upload,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Container } from "@/components/layout/container";
import { AuthGuard } from "@/components/auth/route-guard";
import {
  FilterBar,
  applyInsightFilters,
  DEFAULT_INSIGHT_FILTERS,
  type InsightFilters,
  type InsightMeta,
} from "@/components/insights/filter-bar";
import {
  FollowUpPanel,
  type FollowUpAnchor,
  type FollowUpPanelHandle,
} from "@/components/insights/follow-up-panel";
import { InsightCard, type InsightCardHandle } from "@/components/insights/insight-card";
import { LedgerView } from "@/components/insights/ledger-view";
import { MerchantView } from "@/components/insights/merchant-view";
import { SubscriptionView } from "@/components/insights/subscription-view";
import { recheckAll } from "@/lib/achievements";
import { CASES, type CaseRecord } from "@/lib/cases";
import { DEMO_BUDGET, DEMO_INSIGHTS, DEMO_STAGES, type DemoInsight } from "@/lib/demo-data";
import tfidfManifest from "@/data/tfidf-manifest.json";
import { tfidfSearch, type TfidfManifest } from "@/lib/rag/tfidf";
import { TFIDF_FALLBACK_K } from "@/lib/rag/types";
import { getDuckDB } from "@/lib/duckdb/service";
import { readFavorites, toggleFavoriteLocal } from "@/lib/insights/favorites";
import { STAGE_DISPLAY_NAMES } from "@/lib/pipeline/stage";
import { usePipeline, type LastRunSummary } from "@/lib/pipeline/store";
import type { InsightCard as RunInsightCard } from "@/lib/schema/insight-card";
import { runWhitelistedAggregate } from "@/lib/sql-guard/whitelist";
import { useMounted } from "@/lib/use-mounted";

type ViewMode = "cards" | "gallery" | "ledger" | "merchants" | "subscriptions";

/** 挂载前的空收藏快照：稳定引用，避免 activeFavorites 每次渲染生成新数组 */
const EMPTY_FAVORITES: string[] = [];

const VIEW_OPTIONS: { key: ViewMode; label: string; icon: typeof Rows3 }[] = [
  { key: "cards", label: "卡片流", icon: Rows3 },
  { key: "gallery", label: "图表廊", icon: LayoutGrid },
  { key: "ledger", label: "账本汇总", icon: ChartColumn },
  { key: "merchants", label: "商户统计", icon: ReceiptText },
  // 第 5 视图：订阅雷达自独立页迁入（A15 第四部分），Radar 与订阅页识别语义一致
  { key: "subscriptions", label: "订阅管理", icon: Radar },
];

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-(--radius-sm) border border-(--color-border) bg-(--color-surface) px-1.5 py-0.5 font-mono text-[10px] text-(--color-ink-secondary)">
      {children}
    </kbd>
  );
}

/** 无体检结果空态：仅在本地清除演示开关（localStorage spendct:demo:off=1）时出现 */
function EmptyState() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 rounded-(--radius-card) border border-dashed border-(--color-border-strong) px-6 py-16 text-center">
      <span className="grid size-16 place-items-center rounded-full bg-(--color-surface-2)">
        <Inbox className="size-7 text-(--color-ink-muted)" aria-hidden />
      </span>
      <div>
        <h2 className="text-lg font-semibold">体检完成前，这里还没有洞察</h2>
        <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-(--color-ink-secondary)">
          上传账单并跑完六阶段体检，洞察会一条条出现在这里，等待你的确认、质疑与追问。
        </p>
      </div>
      <Link
        href="/upload"
        className="inline-flex h-11 items-center gap-2 rounded-full bg-(--color-btn-primary) px-5 text-sm font-medium text-white transition-colors hover:bg-(--color-btn-primary-hover)"
      >
        <Upload className="size-4" aria-hidden />
        去上传账单
      </Link>
    </div>
  );
}

function NoMatch({ onReset }: { onReset(): void }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 rounded-(--radius-card) border border-dashed border-(--color-border-strong) px-6 py-12 text-center">
      <p className="text-sm font-medium">没有符合条件的洞察</p>
      <p className="text-xs text-(--color-ink-secondary)">试试放宽阶段、日期或类别筛选</p>
      <button
        type="button"
        onClick={onReset}
        className="h-10 rounded-full border border-(--color-border) bg-(--color-surface) px-4 text-sm font-medium text-(--color-ink-secondary) transition-colors hover:border-(--color-border-strong)"
      >
        重置筛选
      </button>
    </div>
  );
}

/** 骨架屏：Suspense fallback（useSearchParams 客户端渲染期间占位） */
function InsightsSkeleton() {
  return (
    <div className="animate-pulse pt-6" aria-label="洞察页加载中">
      <div className="flex items-center gap-3">
        <div className="h-7 w-20 rounded-full bg-(--color-surface-2)" />
        <div className="h-10 w-64 rounded-full bg-(--color-surface-2)" />
      </div>
      <div className="mt-3 h-11 w-full max-w-3xl rounded-full bg-(--color-surface-2)" />
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-80 rounded-(--radius-lg) bg-(--color-surface-2)" />
        ))}
      </div>
    </div>
  );
}

// ─────────────────── 真实运行卡 → 页面卡模型（真实优先 + demo 兜底） ───────────────────

/** 图表数据的异步回填单元：labels 与 values 一一对应 */
interface ChartResultEntry {
  labels: string[];
  values: number[];
}

/**
 * 引擎置信度（0-1 数值）→ 卡面四档（● 点数，与演示卡同口径）。
 * 换算边界：≥0.9 → 4 档、≥0.8 → 3 档、≥0.7 → 2 档、其余 → 1 档。
 * 发布线为 0.6（07 §20 闸门），已发布卡最低 1 档，不会出现 0 档。
 */
function mapConfidence(confidence: number): DemoInsight["confidence"] {
  if (confidence >= 0.9) return 4;
  if (confidence >= 0.8) return 3;
  if (confidence >= 0.7) return 2;
  return 1;
}

/**
 * 引擎图表七类 → 卡组件三类（组件只支持三态，07 组件契约）：
 * line→timeseries（折线）、pie→donut（环形）；
 * 其余 bar/histogram/table/scatter/heatmap 统一降为 bar（柱状）。
 */
function mapChartKind(
  chartType: RunInsightCard["evidence"]["chart"]["chartType"],
): DemoInsight["chartKind"] {
  if (chartType === "line") return "timeseries";
  if (chartType === "pie") return "donut";
  return "bar";
}

/**
 * 度量字段 → 展示单位：金额列（*_cents）为元、行数（*_rows）为行、
 * 比率列（*_ratio / *_pct）为 %，其余聚合为笔数。
 */
function mapChartUnit(measureField: string | undefined): DemoInsight["chartUnit"] {
  if (!measureField) return undefined;
  if (measureField.includes("cents")) return "元";
  if (measureField.includes("rows")) return "行";
  if (measureField.includes("ratio") || measureField.includes("pct")) return "%";
  return "笔";
}

/**
 * 引用 → 口语化来源文案（07 §4 CitationSchema 五类映射）：
 * 表名、规则编号、案例编号等内部标识不直接展示，
 * 统一说成账单明细、识别规则、消费案例等用户能懂的说法。
 */
function formatCitation(source: RunInsightCard["sources"][number]): string {
  switch (source.kind) {
    case "sql":
      return "来自你的账单明细";
    case "rule":
      return "依据内置识别规则";
    case "rag":
      return "参考常见消费案例";
    case "tool":
      return "由内置工具计算得出";
    case "personal":
      return "来自你的历史记录";
    default:
      return "其他来源";
  }
}

/** 行内取值兜底为数值：兼容 DuckDB BIGINT 返回的 bigint 与 number/string 形态 */
function toFiniteNumber(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * 分组维度值 → 展示标签：month 维度截为 YYYY-MM，其余日期形态保留完整日期。
 * 兼容 Date 对象、epoch 毫秒 number（DATE 经箭头层的时间整数）与字符串；
 * bigint 是年份等整型维度（如 EXTRACT(YEAR)），按整数原样展示，不做时间换算。
 */
function formatDimValue(value: unknown, dimField: string): string {
  const asIso = (date: Date): string => {
    const iso = date.toISOString().slice(0, 10);
    return dimField === "month" ? iso.slice(0, 7) : iso;
  };
  if (value instanceof Date) return asIso(value);
  if (typeof value === "number" && Number.isFinite(value)) return asIso(new Date(value));
  if (typeof value === "bigint") return String(Number(value));
  return String(value ?? "");
}

/**
 * 统计值兜底解析：stats.value 是格式化展示串（可能带 ¥、千分位、%、pp 后缀），
 * 只保留数字、小数点与负号后转数值；解析失败记 0（仅用于退化图的渲染）。
 */
function parseStatNumber(raw: string): number {
  const parsed = Number(raw.replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** 时间维度：折线/柱图凡按时间维度分组，一律按维度升序取全量序列（不按金额截断） */
const TIME_DIM_FIELDS = new Set(["month", "date_iso", "year"]);

/**
 * 按卡内图表规格拼确定性聚合 SQL（07 §6 硬约束下的合法路径）。
 * 表名/维度/度量全部来自引擎产出的卡（代码常量或经 schema 校验的草稿），
 * 无任何用户输入；执行仍走 runWhitelistedAggregate 预检作双保险。
 * 口径说明：
 * - 时间维度（month/date_iso/year）：按维度升序、LIMIT 50（白名单上限）取全量序列，
 *   时间序列若按聚合值排序会被截成乱序片段，画出锯齿假趋势；
 * - 其余维度：白名单文法不支持「ORDER BY 2」位置序号，聚合列排序须写完整
 *   SUM(<度量>) 表达式（语义等价）；方向取 chart.sortBy，缺省降序取头部；
 *   行数上限取 chart.topN，缺省 8；
 * - where/having 为引擎模板专用行过滤（ChartSpecSchema 正则限定形态），
 *   缺省不输出子句。
 */
function buildCardChartSql(chart: RunInsightCard["evidence"]["chart"]): string {
  // schema 保证至少 1 个度量（ChartSpecSchema.min(1)），此处为防御兜底
  const measure = chart.measureFields[0] ?? "amount_cents";
  const isTimeDim = TIME_DIM_FIELDS.has(chart.dimField);
  const orderBy = isTimeDim
    ? `${chart.dimField} ASC`
    : `SUM(${measure}) ${chart.sortBy === "asc" ? "ASC" : "DESC"}`;
  const limit = isTimeDim ? 50 : (chart.topN ?? 8);
  return (
    `SELECT ${chart.dimField}, SUM(${measure}) ` +
    `FROM ${chart.tableId} ` +
    (chart.where ? `WHERE ${chart.where} ` : "") +
    `GROUP BY ${chart.dimField} ` +
    (chart.having ? `HAVING ${chart.having} ` : "") +
    `ORDER BY ${orderBy} ` +
    `LIMIT ${limit}`
  );
}

/**
 * 聚合行 → 图表数据。白名单文法子集不支持 AS 别名，聚合列名由 DuckDB
 * 自动生成，故按 SELECT 位置取值（第 0 列分组维度、第 1 列聚合值），
 * 与引擎 EvidenceResult 的按位取值口径一致（见 stages/spec.ts）。
 */
function rowsToChartData(rows: unknown[], dimField: string): ChartResultEntry {
  const records = rows as Record<string, unknown>[];
  return {
    labels: records.map((row) => formatDimValue(Object.values(row)[0], dimField)),
    values: records.map((row) => toFiniteNumber(Object.values(row)[1])),
  };
}

/**
 * 查询失败/白名单拒绝时的退化数据：用 evidence.stats 的 label/value 兜底，
 * 图表仍可渲染（降级口径：stats 是引擎产出该卡时已算好的摘要统计）。
 *
 * 金额卡（measureFields 含 *_cents）的 stats.value 已是引擎换算好的元串
 * （fmtYuan 小数，如 "8507.20"），乘 100 回到分刻度，与正常查询路径
 * （SUM(*_cents) 原始分）同口径，再由展示层 ÷100 还原——避免「已格式化元串
 * 再 ÷100」的双重换算。非金额项（占比/笔数/z-score/月份文本）原值往返。
 */
function statsFallbackChartData(card: RunInsightCard): ChartResultEntry {
  const isCents = (card.evidence.chart.measureFields[0] ?? "").includes("cents");
  return {
    labels: card.evidence.stats.map((stat) => stat.label),
    values: card.evidence.stats.map((stat) => parseStatNumber(stat.value) * (isCents ? 100 : 1)),
  };
}

/**
 * 真实卡的类别推断：在 headline + narrative 里找最先命中的 12 类目词，
 * 全部未命中归「其他」。类别筛选因此对真实卡生效（与演示卡元数据表同口径）。
 */
function inferCardCategory(card: DemoInsight): string {
  const text = `${card.headline}${card.narrative}`;
  const keyword = [
    "餐饮",
    "交通",
    "购物",
    "娱乐",
    "居住",
    "通讯",
    "医疗",
    "教育",
    "人情",
    "金融",
    "订阅",
  ].find((item) => text.includes(item));
  return keyword ?? "其他";
}

/** 运行时 InsightCard → 页面卡模型（对齐 DEMO_INSIGHTS 字段语义） */
function mapRunCard(card: RunInsightCard): DemoInsight {
  return {
    id: card.cardId,
    stageId: card.stage,
    stageName: STAGE_DISPLAY_NAMES[card.stage].name,
    confidence: mapConfidence(card.confidence),
    headline: card.headline,
    narrative: card.narrative,
    chartKind: mapChartKind(card.evidence.chart.chartType),
    chartUnit: mapChartUnit(card.evidence.chart.measureFields[0]),
    // 图表数据异步回填：查询中保持空数组，成功/退化后由 chartResults 覆盖
    chartData: [],
    chartLabels: [],
    // 图表说明行与证据统计行：真实卡携带，演示卡缺省不渲染
    chartTitle: card.evidence.chart.title,
    chartStats: card.evidence.stats,
    citations: [...new Set(card.sources.map(formatCitation))],
  };
}

// ─────────────────── 年度阶段省钱贴士（学生权益案例匹配） ───────────────────

/** 学生权益标签 → 中文名（与知识课堂案例卡同口径） */
const BENEFIT_TAG_LABELS: Record<string, string> = {
  student_cert: "学生认证",
  edu_discount: "教育优惠",
  campus_card: "校园资源",
  budget_substitute: "平价替代",
  rights_tip: "权益提示",
};

/**
 * 支出类目 → 案例标题/摘要关键词。类目按用户支出排名依次扫描，先命中的类目优先。
 * 关键词表同时用于构造 TF-IDF 查询文本与兜底的包含匹配（见 matchStudentTips）。
 */
const CATEGORY_TIP_KEYWORDS: Record<string, string[]> = {
  餐饮: ["外卖", "食堂", "餐饮"],
  购物: ["Apple", "购物", "数码", "超市"],
  交通: ["火车票", "公交", "地铁", "通勤", "出行"],
  娱乐: ["电影", "演出", "景区", "门票", "音乐"],
  教育: ["课程", "电子书", "软件", "图书馆", "MOOC"],
  金融: ["金融", "银行", "校园贷", "贷款", "信用卡"],
  订阅: ["订阅", "会员", "付费"],
};

/** 案例检索文本：标题 + 摘要 + 权益标签中文名（包含匹配在这段文本上进行） */
function tipSearchText(item: CaseRecord): string {
  const tags = item.benefitTags
    .map((tag) => BENEFIT_TAG_LABELS[tag] ?? "")
    .filter(Boolean)
    .join(" ");
  return `${item.title} ${item.summary} ${tags}`;
}

/**
 * 按用户支出 top 类目匹配学生权益案例：
 * 每个类目先经 TF-IDF 语义检索（类目名 + 关键词构造查询）按分数降序取案例，
 * 词表外查询检索不到时回退到关键词包含匹配补位；类目优先级与不重复口径不变，
 * 超出 limit 截断（04 §5.6 省钱贴士接入口径）。
 */
function matchStudentTips(topCategories: string[], limit = 4): CaseRecord[] {
  const pool = CASES.filter((item) => item.category === "student_benefits");
  const seen = new Set<string>();
  const picked: CaseRecord[] = [];
  for (const category of topCategories) {
    const keywords = CATEGORY_TIP_KEYWORDS[category];
    if (!keywords || keywords.length === 0) continue;
    const ranked = tfidfSearch(
      `${category} ${keywords.join(" ")}`,
      pool,
      tfidfManifest as TfidfManifest,
      TFIDF_FALLBACK_K,
    );
    for (const hit of ranked) {
      if (picked.length >= limit) return picked;
      if (seen.has(hit.case.id)) continue;
      seen.add(hit.case.id);
      picked.push(hit.case);
    }
    // TF-IDF 兜底：查询全部落在词表外时按关键词包含匹配补位（维持既有行为）
    if (ranked.length === 0) {
      for (const item of pool) {
        if (picked.length >= limit) return picked;
        if (seen.has(item.id)) continue;
        const text = tipSearchText(item);
        if (keywords.some((keyword) => text.includes(keyword))) {
          seen.add(item.id);
          picked.push(item);
        }
      }
    }
  }
  return picked;
}

/** 内置动线 top3 类目：按内置预算的实际支出降序（与预算页演示口径一致） */
function demoTopCategories(): string[] {
  return [...DEMO_BUDGET.categories]
    .sort((a, b) => b.actualCents - a.actualCents)
    .slice(0, 3)
    .map((entry) => entry.category);
}

/** 真实数据 top3 类目查询：白名单聚合（LIMIT 3 远低于 50 行上限） */
const TOP_CATEGORIES_SQL =
  "SELECT category, SUM(expense_cents) FROM v_category_monthly " +
  "GROUP BY category ORDER BY SUM(expense_cents) DESC LIMIT 3";

/**
 * 省钱贴士卡：视觉沿用洞察卡 token（圆角/描边/底色/阴影），
 * 但交互只保留「看全文」跳转——确认/质疑/图表等是洞察卡专属能力，不复用卡组件。
 */
function StudentTipCard({ tip }: { tip: CaseRecord }) {
  const tags = tip.benefitTags
    .map((tag) => BENEFIT_TAG_LABELS[tag])
    .filter((label): label is string => Boolean(label));
  return (
    <article className="flex flex-col gap-3 rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-5 shadow-(--shadow-sm)">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-full bg-(--color-primary-soft) px-2.5 py-0.5 text-xs font-medium text-(--color-brand-600)">
          学生权益
        </span>
        {tags.map((label) => (
          <span
            key={label}
            className="rounded-full border border-(--color-border) px-2 py-0.5 text-[11px] text-(--color-ink-secondary)"
          >
            {label}
          </span>
        ))}
      </div>
      <h4 className="text-sm leading-snug font-semibold">{tip.title}</h4>
      <p className="line-clamp-3 text-xs leading-5 text-(--color-ink-secondary)">{tip.summary}</p>
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-(--color-border) pt-3 text-xs">
        <span className="min-w-0 truncate text-(--color-ink-muted)">{tip.source}</span>
        <Link
          href="/learn"
          className="inline-flex shrink-0 items-center gap-1 font-medium text-(--color-brand-600) transition-colors hover:underline"
        >
          看全文
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>
    </article>
  );
}

function InsightsView() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // ?view=ledger 为主入口（顶部导航「账本」链接）；?tab=ledger 为旧参数兼容
  const rawView = searchParams.get("view") ?? searchParams.get("tab") ?? "cards";
  const view: ViewMode =
    rawView === "gallery" ||
    rawView === "ledger" ||
    rawView === "merchants" ||
    rawView === "subscriptions"
      ? rawView
      : "cards";

  const [filters, setFilters] = useState<InsightFilters>(DEFAULT_INSIGHT_FILTERS);
  // 收藏与演示开关在初始 state 里同步读取：本子树经 Suspense 客户端渲染，无 SSR HTML 需要对齐；
  // 隐私模式抛异常时 readFavorites 已兜底返回空列表，demoOff 用 typeof window 守卫。
  // 渲染侧仍按 mounted 门控：即便未来移除 Suspense 客户端门控，
  // 挂载前两端也同口径渲染空收藏，不产生水合不一致
  const mounted = useMounted();
  const [favorites, setFavorites] = useState<string[]>(() => readFavorites());
  const activeFavorites = mounted ? favorites : EMPTY_FAVORITES;
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [anchor, setAnchor] = useState<FollowUpAnchor | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [focusIndex, setFocusIndex] = useState(-1);
  // 本地「关闭演示数据」开关：置 1 后页面进入真实空态，用于验收空态设计
  const [demoOff] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem("spendct:demo:off") === "1";
    } catch {
      return false;
    }
  });

  const cardRefs = useRef(new Map<string, InsightCardHandle>());
  const panelRef = useRef<FollowUpPanelHandle>(null);

  // 真实优先 + demo 兜底：lastRun 为空（本会话尚未跑完体检）时维持演示数据路径
  const lastRun = usePipeline((s) => s.lastRun);

  // 真实卡的图表数据回填表：以 lastRun 对象身份打标，运行切换后旧批次整体失效
  // （不做 effect 内同步清空，避免级联渲染；读取侧按 run 身份比对即可）
  const [chartResults, setChartResults] = useState<{
    run: LastRunSummary | null;
    entries: Record<string, ChartResultEntry>;
  }>({ run: null, entries: {} });

  // 真实数据 top3 类目：与 chartResults 同款「run 身份打标」策略，
  // 加载中为 null（贴士区块隐藏不闪烁），失败回退空数组（视为无匹配）
  const [topCategoriesState, setTopCategoriesState] = useState<{
    run: LastRunSummary | null;
    categories: string[];
  }>({ run: null, categories: [] });

  useEffect(() => {
    // 无体检结果时不做同步清空：读取侧按 run 身份比对（见下 topCategories），
    // 旧 run 的类目不会被采用，无需在 effect 里级联 setState
    if (!lastRun) return;
    let cancelled = false;
    void (async () => {
      try {
        const conn = await getDuckDB();
        const result = await runWhitelistedAggregate(conn, TOP_CATEGORIES_SQL);
        if (cancelled) return;
        const categories = (result.rows as Record<string, unknown>[])
          .map((row) => String(Object.values(row)[0] ?? ""))
          .filter((name) => name !== "");
        setTopCategoriesState({ run: lastRun, categories });
      } catch {
        // 查询失败视为无匹配：贴士区块隐藏，不影响卡流
        if (!cancelled) setTopCategoriesState({ run: lastRun, categories: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lastRun]);

  // 真实卡图表数据加载：取 DuckDB 单例连接后逐卡执行白名单聚合。
  // 查询失败或白名单拒绝时仅该卡退化到 stats 兜底，不阻断其他卡；
  // 只在 lastRun 存在时执行，demo 路径不触碰 DuckDB（演示卡自带静态图表数据）。
  useEffect(() => {
    if (!lastRun) return;
    let cancelled = false;

    // 异步回填（await 之后的 setState 不受 effect 内同步 setState 规则约束）；
    // 若期间运行已切换（对象身份变化），整批丢弃从新运行重新累积
    const applyResult = (cardId: string, entry: ChartResultEntry) => {
      if (cancelled) return;
      setChartResults((prev) => ({
        run: lastRun,
        entries: prev.run === lastRun ? { ...prev.entries, [cardId]: entry } : { [cardId]: entry },
      }));
    };

    void (async () => {
      let conn: Awaited<ReturnType<typeof getDuckDB>>;
      try {
        conn = await getDuckDB();
      } catch {
        // 单例初始化失败（Worker 被拦截/资源耗尽）：整批直接走 stats 退化
        for (const card of lastRun.cards) {
          applyResult(card.cardId, statsFallbackChartData(card));
        }
        return;
      }
      for (const card of lastRun.cards) {
        if (cancelled) return;
        try {
          const result = await runWhitelistedAggregate(
            conn,
            buildCardChartSql(card.evidence.chart),
          );
          applyResult(card.cardId, rowsToChartData(result.rows, card.evidence.chart.dimField));
        } catch {
          // 白名单拒绝/查询超时/数据集缺失：退化到 stats 兜底，图表仍可渲染
          applyResult(card.cardId, statsFallbackChartData(card));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [lastRun]);

  // 卡流数据源：lastRun 存在时映射真实卡（图表数据由 chartResults 逐卡回填，
  // 回填前为空数组占位），否则维持演示卡原路径（本路径一行不改）
  const cards = useMemo(() => {
    if (!lastRun) return DEMO_INSIGHTS;
    const entries = chartResults.run === lastRun ? chartResults.entries : {};
    return lastRun.cards.map((card) => {
      const mapped = mapRunCard(card);
      const filled = entries[card.cardId];
      return filled ? { ...mapped, chartData: filled.values, chartLabels: filled.labels } : mapped;
    });
  }, [lastRun, chartResults]);

  // 过滤 + withheld 卡置底（05 §1.5：低置信度卡不抢高位视线），排序稳定不破坏流式顺序。
  // 真实卡的筛选元数据经第三参传入：类别由 headline/narrative 关键词推断，
  // 发布时间无语义约定为 0 天前（本次体检刚产出），日期筛选全放行
  const visible = useMemo(() => {
    const metaLookup = lastRun
      ? (id: string): InsightMeta | undefined => {
          const card = cards.find((item) => item.id === id);
          if (!card) return undefined;
          return { category: inferCardCategory(card), publishedDaysAgo: 0 };
        }
      : undefined;
    const filtered = applyInsightFilters(cards, filters, metaLookup);
    return [...filtered].sort((a, b) => Number(Boolean(a.withheld)) - Number(Boolean(b.withheld)));
  }, [cards, filters, lastRun]);

  // 贴士匹配源：真实数据按 run 身份比对（未加载时为 null），内置动线取演示支出 top3
  const topCategories = lastRun
    ? topCategoriesState.run === lastRun
      ? topCategoriesState.categories
      : null
    : demoTopCategories();

  // 年度阶段贴士：无匹配/加载中为空数组，区块整体隐藏
  const tips = useMemo(
    () => (topCategories === null ? [] : matchStudentTips(topCategories)),
    [topCategories],
  );

  // 焦点索引为原始值，渲染期钳到当前可见列表长度内（不在 effect 里同步，避免级联渲染）
  const clampedFocus =
    visible.length === 0 ? -1 : Math.min(Math.max(focusIndex, -1), visible.length - 1);

  const setView = useCallback(
    (next: ViewMode) => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("tab");
      if (next === "cards") params.delete("view");
      else params.set("view", next);
      const qs = params.toString();
      router.replace(`/insights${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [router, searchParams],
  );

  // 设置锚点并同步展开面板（桌面折叠态与移动端抽屉同口径）：面板开合跟着触发动作走
  const openPanelForAnchor = useCallback((next: FollowUpAnchor) => {
    setAnchor(next);
    setPanelOpen(true);
    setPanelCollapsed(false);
  }, []);

  const handleDelve = useCallback(
    (id: string, label: string) => {
      openPanelForAnchor({ id, label });
    },
    [openPanelForAnchor],
  );

  const handleToggleFavorite = useCallback((id: string) => {
    // 先算好下一份收藏列表（toggleFavoriteLocal 同步落盘），再以返回值更新
    // 状态：比函数式更新先一步拿到结果，成就校正用的收藏数与状态严格一致
    const next = toggleFavoriteLocal(readFavorites(), id);
    setFavorites(next);
    // 成就联动（WP8 §8c）：收藏数已落盘，全量校正（collector）
    recheckAll({ favoriteCount: next.length });
  }, []);

  // 键盘快捷键（05 §5）：j/k 切卡、Enter 展开、t 数据表、/ 聚焦追问、Esc 取消锚点
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target;
      const inField =
        target instanceof HTMLElement &&
        ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName);
      const hasModifier = e.metaKey || e.ctrlKey || e.altKey;

      if (e.key === "Escape") {
        if (anchor) setAnchor(null);
        setFavoritesOpen(false);
        setPanelOpen(false);
        return;
      }
      if (e.key === "/" && !hasModifier) {
        e.preventDefault();
        setPanelOpen(true);
        setPanelCollapsed(false);
        requestAnimationFrame(() => panelRef.current?.focusInput());
        return;
      }
      if (
        inField ||
        hasModifier ||
        view === "ledger" ||
        view === "merchants" ||
        view === "subscriptions" ||
        visible.length === 0
      ) {
        return;
      }

      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        setFocusIndex((i) => {
          if (i < 0) return 0;
          return e.key === "j" ? Math.min(i + 1, visible.length - 1) : Math.max(i - 1, 0);
        });
      } else if (e.key === "Enter" && clampedFocus >= 0) {
        e.preventDefault();
        const card = visible[clampedFocus];
        if (card) cardRefs.current.get(card.id)?.toggleExpand();
      } else if (e.key === "t" && clampedFocus >= 0) {
        e.preventDefault();
        const card = visible[clampedFocus];
        if (card) cardRefs.current.get(card.id)?.toggleTable();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [anchor, view, visible, clampedFocus]);

  // 卡片 ref 注册表：键盘事件经此驱动对应卡的展开/数据表操作
  const setCardRef = useCallback((id: string) => {
    return (node: InsightCardHandle | null) => {
      if (node) cardRefs.current.set(id, node);
      else cardRefs.current.delete(id);
    };
  }, []);

  // 收藏夹与卡流同源（真实卡 id=cardId 与演示卡 id 天然兼容同一套收藏键）
  const favoriteInsights = useMemo(
    () => cards.filter((insight) => activeFavorites.includes(insight.id)),
    [cards, activeFavorites],
  );

  return (
    <div className="pt-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight">洞察</h1>

        <div
          role="group"
          aria-label="视图切换"
          className="inline-flex rounded-full border border-(--color-border) bg-(--color-surface) p-1"
        >
          {VIEW_OPTIONS.map((option) => {
            const active = view === option.key;
            const Icon = option.icon;
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => setView(option.key)}
                aria-pressed={active}
                className={`inline-flex h-11 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-(--color-primary-soft) text-(--color-brand-600)"
                    : "text-(--color-ink-secondary) hover:text-(--color-ink)"
                }`}
              >
                <Icon className="size-4" aria-hidden />
                {option.label}
              </button>
            );
          })}
        </div>

        <div className="relative ml-auto">
          <button
            type="button"
            onClick={() => setFavoritesOpen((v) => !v)}
            aria-pressed={favoritesOpen}
            aria-label={`收藏夹（${activeFavorites.length} 项）`}
            className="inline-flex h-11 items-center gap-2 rounded-full border border-(--color-border) bg-(--color-surface) px-4 text-sm font-medium text-(--color-ink-secondary) transition-colors hover:border-(--color-border-strong) hover:text-(--color-ink)"
          >
            <Star
              className={`size-4 ${activeFavorites.length > 0 ? "fill-(--color-accent) text-(--color-accent)" : ""}`}
              aria-hidden
            />
            收藏夹
            {activeFavorites.length > 0 ? (
              <span className="rounded-full bg-(--color-primary-soft) px-2 py-0.5 text-xs font-semibold text-(--color-brand-600) tabular-nums">
                {activeFavorites.length}
              </span>
            ) : null}
          </button>
          {favoritesOpen ? (
            <>
              {/* 点击面板外区域关闭（Esc 亦关闭，见键盘监听） */}
              <button
                type="button"
                aria-hidden
                tabIndex={-1}
                onClick={() => setFavoritesOpen(false)}
                className="fixed inset-0 z-30 cursor-default"
              />
              <div
                role="dialog"
                aria-label="收藏夹"
                className="absolute top-full right-0 z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-(--radius-xl) border border-(--color-border) bg-(--color-surface) p-3 shadow-(--shadow-lg)"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold">收藏的洞察</h2>
                  <button
                    type="button"
                    onClick={() => setFavoritesOpen(false)}
                    aria-label="关闭收藏夹"
                    className="grid size-8 place-items-center rounded-full text-(--color-ink-muted) transition-colors hover:bg-(--color-surface-2) hover:text-(--color-ink)"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                </div>
                {favoriteInsights.length === 0 ? (
                  <div className="py-6 text-center">
                    <p className="text-sm text-(--color-ink-secondary)">还没有收藏任何洞察卡</p>
                    <button
                      type="button"
                      onClick={() => {
                        setFavoritesOpen(false);
                        if (view !== "cards") setView("cards");
                      }}
                      className="mt-3 h-10 rounded-full bg-(--color-primary) px-4 text-sm font-medium text-white transition-colors hover:bg-(--color-btn-primary-hover)"
                    >
                      去逛洞察卡流
                    </button>
                  </div>
                ) : (
                  <ul className="space-y-1">
                    {favoriteInsights.map((insight) => (
                      <li
                        key={insight.id}
                        className="flex items-start gap-2 rounded-(--radius-md) px-2 py-2 hover:bg-(--color-surface-2)"
                      >
                        <p className="min-w-0 flex-1 text-sm leading-snug">{insight.headline}</p>
                        <button
                          type="button"
                          onClick={() => handleToggleFavorite(insight.id)}
                          aria-label={`取消收藏：${insight.headline}`}
                          className="grid size-8 shrink-0 place-items-center rounded-full text-(--color-ink-muted) transition-colors hover:text-(--color-critical-ink)"
                        >
                          <Star
                            className="size-4 fill-(--color-accent) text-(--color-accent)"
                            aria-hidden
                          />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>

      {view === "cards" || view === "gallery" ? (
        <div className="mt-3">
          <FilterBar
            value={filters}
            onChange={setFilters}
            stages={DEMO_STAGES}
            resultCount={visible.length}
          />
        </div>
      ) : null}

      {view === "cards" || view === "gallery" ? (
        <p className="mt-2 hidden flex-wrap items-center gap-x-3 gap-y-1 text-xs text-(--color-ink-muted) md:flex">
          <span>快捷键</span>
          <span>
            <Kbd>j</Kbd> / <Kbd>k</Kbd> 切换卡片
          </span>
          <span>
            <Kbd>Enter</Kbd> 展开
          </span>
          <span>
            <Kbd>t</Kbd> 数据表
          </span>
          <span>
            <Kbd>/</Kbd> 追问
          </span>
          <span>
            <Kbd>Esc</Kbd> 取消选中
          </span>
        </p>
      ) : null}

      <div className="mt-5 flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          {view === "ledger" ? (
            <LedgerView onAnchor={openPanelForAnchor} />
          ) : view === "merchants" ? (
            <MerchantView onAnchor={openPanelForAnchor} />
          ) : view === "subscriptions" ? (
            <SubscriptionView />
          ) : demoOff ? (
            <EmptyState />
          ) : visible.length === 0 ? (
            <NoMatch onReset={() => setFilters(DEFAULT_INSIGHT_FILTERS)} />
          ) : (
            <div
              className={
                view === "gallery"
                  ? "grid gap-4 md:grid-cols-2 xl:grid-cols-3"
                  : "grid gap-4 md:grid-cols-2"
              }
            >
              {visible.map((insight, index) => (
                <InsightCard
                  key={insight.id}
                  ref={setCardRef(insight.id)}
                  insight={insight}
                  index={index}
                  compact={view === "gallery"}
                  focused={clampedFocus === index}
                  favorite={activeFavorites.includes(insight.id)}
                  onToggleFavorite={handleToggleFavorite}
                  onDelve={handleDelve}
                />
              ))}
            </div>
          )}

          {/* 年度阶段省钱贴士：仅卡片/图表廊视图 + 全部或年度阶段筛选下出现；
              无匹配案例（含真实数据加载中）时整个区块隐藏 */}
          {(view === "cards" || view === "gallery") &&
          !demoOff &&
          (filters.stage === "all" || filters.stage === "annual") &&
          tips.length > 0 ? (
            <section aria-label="省钱贴士" className="mt-8">
              <div className="flex items-center gap-2">
                <PiggyBank className="size-4 text-(--color-primary)" aria-hidden />
                <h2 className="text-base font-bold tracking-tight">省钱贴士</h2>
              </div>
              <p className="mt-1 text-xs text-(--color-ink-secondary)">
                按你支出最多的类目，挑了几条学生权益省钱案例
              </p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {tips.map((tip) => (
                  <StudentTipCard key={tip.id} tip={tip} />
                ))}
              </div>
            </section>
          ) : null}
        </div>

        {/* 追问面板：桌面为右侧固定列（可折叠），移动端收为右侧抽屉 */}
        <aside
          className={`fixed inset-y-0 right-0 z-50 flex w-[min(92vw,360px)] flex-col transition-transform duration-200 ease-out lg:sticky lg:top-[88px] lg:z-auto lg:h-[calc(100vh-96px)] lg:w-auto lg:translate-x-0 lg:transition-none ${
            panelOpen ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <FollowUpPanel
            ref={panelRef}
            open={panelOpen}
            collapsed={panelCollapsed}
            anchor={anchor}
            onClose={() => setPanelOpen(false)}
            onToggleCollapsed={() => setPanelCollapsed((v) => !v)}
            onCancelAnchor={() => setAnchor(null)}
          />
        </aside>
        {panelOpen ? (
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setPanelOpen(false)}
            className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          />
        ) : null}
      </div>

      {/* 移动端：面板未打开时的悬浮入口（底部 tab bar 上方） */}
      {!panelOpen ? (
        <button
          type="button"
          onClick={() => setPanelOpen(true)}
          aria-label="打开追问面板"
          className="fixed right-4 bottom-24 z-40 grid size-13 place-items-center rounded-full bg-(--color-primary) text-white shadow-(--shadow-lg) transition-colors hover:bg-(--color-btn-primary-hover) lg:hidden"
        >
          <MessageSquare className="size-5" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

export default function InsightsPage() {
  return (
    <AuthGuard>
      <Container wide>
        {/* useSearchParams 需位于 Suspense 边界内（Next 16 预渲染要求），骨架屏作为 fallback */}
        <Suspense fallback={<InsightsSkeleton />}>
          <InsightsView />
        </Suspense>
      </Container>
    </AuthGuard>
  );
}
