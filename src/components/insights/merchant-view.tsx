"use client";

import type { ECElementEvent } from "echarts/core";
import { ReceiptText, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EChart } from "@/components/charts/e-chart";
import { buildBarOption, formatYuan } from "@/components/charts/option-builders";
import { ChartCard } from "@/components/insights/chart-card";
import { getDuckDB } from "@/lib/duckdb/service";
import { generateLedgerDemoRows } from "@/lib/insights/ledger-demo";
import {
  aggregateMerchants,
  expenseTotalFromDirection,
  merchantAnchorLabel,
  merchantFooterText,
  merchantsFromQuery,
  type MerchantEntry,
} from "@/lib/insights/merchant-aggregate";
import {
  DETAIL_MAX_ROWS,
  DETAIL_PAGE_SIZE,
  buildDemoDetailRows,
  detailRowsFromQuery,
  directionLabel,
  filterDetailRows,
  type TransactionDetailRow,
} from "@/lib/insights/merchant-detail";
import { usePipeline, type LastRunSummary } from "@/lib/pipeline/store";
import { runWhitelistedAggregate } from "@/lib/sql-guard/whitelist";
import type { FollowUpAnchor } from "./follow-up-panel";

interface MerchantViewProps {
  /** 图表数据点点击 → 选中追问（05 §1.6 核心交互，与账本汇总同口径） */
  onAnchor(anchor: FollowUpAnchor): void;
}

/** 图表展示的商户名数：排名图只画头部，完整列表走数据表（白名单上限 50 行） */
const CHART_TOP_N = 10;

/** 白名单聚合行数上限（07 §7 追问档）：超过时按金额取前 50 名，表脚注如实说明 */
const QUERY_ROW_LIMIT = 50;

// ─────────────────── 真实数据动线（07 §6 白名单文法） ───────────────────

/**
 * 商户统计两条聚合 SQL（代码常量，无任何用户输入）：
 * - 商户排名：全账单口径（不设时间窗），按商户分组取支出总额与笔数，
 *   金额降序取前 50 名（白名单 LIMIT 上限）；
 * - 支出总额：按 direction 分组（结果仅 expense/income 两行），
 *   用于计算各商户占全账单总支出的比例。
 * 两条均只取已支付交易（status='paid'，退款不计入），与账本汇总、
 * qa-engine、深度分析（A14）的支出口径一致。
 * 均经 runWhitelistedAggregate 预检执行作双保险（与账本汇总 /report /budget 同口径）。
 */
const SQL_MERCHANT_TOTAL =
  "SELECT merchant, SUM(amount_cents), COUNT(*) FROM transactions WHERE direction = 'expense' AND status = 'paid' " +
  "GROUP BY merchant ORDER BY SUM(amount_cents) DESC LIMIT 50";

const SQL_DIRECTION_TOTAL =
  "SELECT direction, SUM(amount_cents) FROM transactions WHERE status = 'paid' GROUP BY direction";

// ─────────────────── 逐笔明细直连查询（A15 第二部分，仅本机展示） ───────────────────

/**
 * 逐笔明细直连查询（「逐笔明细」页签展示用，代码常量、零动态拼接）。
 *
 * 与 A8/A15 发送给模型的明细出口是两回事，互不相干：
 * - 本语句的结果只在本机渲染表格，不会发送给任何模型；随追问发送的明细
 *   走 qa-engine 的 DETAIL_SNAPSHOT_SQL（≤150 笔）与 targeted-detail
 *   的定向检索 SQL（≤200 笔），那是各自独立的直连出口；
 * - 投影 7 列与快照出口同列序（date_iso｜ts_text｜category｜merchant｜
 *   amount_cents｜direction｜night_flag，见 qa-engine.formatDetailLine
 *   的按位取值口径），仅行数上限不同（展示侧分页 300 行/页，累计 3000 行）；
 * - 逐行投影与函数表达式不是聚合形态，白名单文法不适用（与快照出口同款
 *   直连执行路径），执行走 getDuckDB 单例连接，不经 runWhitelistedAggregate。
 * 口径：排除 neutral 理财行与 refunded 退款行；时间倒序展示，同一秒多笔时
 * 以 tx_id 决胜，保证 OFFSET 翻页跨页不重行不丢行；深夜语义与
 * v_night_spend 视图一致（07 §3：23:00-05:00）。
 */
const SQL_DETAIL_SELECT = [
  "SELECT date_iso, strftime('%Y-%m-%d %H:%M:%S', ts) AS ts_text, category, merchant, amount_cents, direction, CASE WHEN EXTRACT(HOUR FROM ts) >= 23 OR EXTRACT(HOUR FROM ts) < 5 THEN 1 ELSE 0 END AS night_flag",
  "FROM transactions",
  "WHERE direction <> 'neutral' AND status <> 'refunded'",
  "ORDER BY ts DESC, tx_id",
].join("\n");

/**
 * 逐笔明细分页 SQL：LIMIT/OFFSET 都来自受控常量与数值状态（已装载行数，
 * 非用户输入），取整钳制后拼入语句，不存在注入面；首页 offset 0 时
 * LIMIT 与 SELECT 一体返回。
 */
function buildDetailPageSql(offset: number): string {
  const safeOffset = Math.max(0, Math.floor(offset));
  return `${SQL_DETAIL_SELECT} LIMIT ${DETAIL_PAGE_SIZE} OFFSET ${safeOffset}`;
}

/** 页签枚举：「去向排名」= 既有聚合内容；「逐笔明细」= A15 第二部分新增流水表 */
type MerchantTab = "ranking" | "detail";

const MERCHANT_TABS: { key: MerchantTab; label: string }[] = [
  { key: "ranking", label: "去向排名" },
  { key: "detail", label: "逐笔明细" },
];

/**
 * 逐笔明细装载状态：run 打标沿用洞察页同款「对象身份比对」策略——
 * 体检重新运行后旧批次整体失效，读取侧按 run 身份比对即可，
 * 不在 effect 里同步清空（避免级联渲染）。
 */
interface DetailLoadState {
  run: LastRunSummary;
  /** "ready" = 首页装载成功（含 0 行空账单）；"failed" = 查询失败，回退演示行 */
  status: "ready" | "failed";
  /** 已装载的逐笔行（按页累加，时间倒序） */
  rows: TransactionDetailRow[];
  /** 已装载行数：既是计数也是「加载更多」下一页的 OFFSET 起点 */
  loadedCount: number;
  /** 上一页取满整页 → 后面可能还有行（未到展示上限时才继续提供按钮） */
  hasMore: boolean;
}

/** 真实装载结果：null = 查询失败或无数据，整视图回退演示动线 */
interface RealMerchantData {
  /** 商户聚合条目（金额降序，含占比与均笔；已过滤空商户名分组） */
  entries: MerchantEntry[] | null;
  /** 全账单支出总额（分），占比分母 */
  totalCents: number;
  /** 商户排名的原始聚合行数（未过滤空商户名）：截断判定唯一依据 */
  merchantRowCount: number;
}

const EMPTY_REAL_DATA: RealMerchantData = { entries: null, totalCents: 0, merchantRowCount: 0 };

/**
 * 商户消费统计视图（08 修订案 A13，/insights?view=merchants）：
 * 按商户聚合上传账单的全量支出——每个商户的总额、笔数、占全账单比例与均笔金额。
 * 排名横向条形图（前 10 名）+ 全量数据表（上限 50 名，超出如实标注）+ 商户搜索；
 * 数据点点击进入追问面板（与账本汇总同一锚点协议）。
 * 数据动线：体检运行过（lastRun 存在）且 DuckDB 查询成功时展示真实账单聚合
 * （浏览器内计算，账单不出本地），查询失败或无体检结果则回退确定性演示行。
 */
export function MerchantView({ onAnchor }: MerchantViewProps) {
  const [activeTab, setActiveTab] = useState<MerchantTab>("ranking");
  const [merchantQuery, setMerchantQuery] = useState("");
  const [detailQuery, setDetailQuery] = useState("");
  const [detailState, setDetailState] = useState<DetailLoadState | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // 最近一次体检结果（内存态）：null = 尚无体检记录（含刷新后丢失），整页维持演示动线
  const lastRun = usePipeline((s) => s.lastRun);
  const [realData, setRealData] = useState<RealMerchantData>(EMPTY_REAL_DATA);
  // 演示动线时忽略残留装载结果：渲染期派生，避免在 effect 内同步 setState 重置
  const liveRealData = lastRun ? realData : EMPTY_REAL_DATA;

  // 真实数据装载：lastRun 存在时读 DuckDB（与体检同一单例连接、同一内存数据集）。
  // 两条查询各自 try/catch：任一条失败整视图回退演示动线（占比口径依赖总额查询）
  useEffect(() => {
    if (!lastRun) return; // 演示动线：不查库
    let cancelled = false;
    void (async () => {
      try {
        const conn = await getDuckDB();
        const ranking = await runWhitelistedAggregate(conn, SQL_MERCHANT_TOTAL);
        const direction = await runWhitelistedAggregate(conn, SQL_DIRECTION_TOTAL);
        if (cancelled) return;
        const totalCents = expenseTotalFromDirection(direction.rows);
        const entries = merchantsFromQuery(ranking.rows, totalCents);
        if (entries.length > 0) {
          setRealData({ entries, totalCents, merchantRowCount: ranking.rowCount });
        }
      } catch {
        // 白名单拒绝/查询失败/数据集缺失：保持 null 回退演示动线
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lastRun]);

  // 逐笔明细装载（A15 第二部分）：lastRun 存在时直连 DuckDB 读首页（≤300 行）。
  // 与排名聚合不同：逐笔明细不是聚合形态，不走白名单（见 SQL_DETAIL_SELECT 注释）。
  // 查询失败与排名动线同口径回退演示行；空账单（0 行）保留真实空态提示。
  useEffect(() => {
    if (!lastRun) return; // 演示动线：不查库
    let cancelled = false;
    void (async () => {
      try {
        const conn = await getDuckDB();
        const result = await conn.query(buildDetailPageSql(0));
        const rows = await result.toArray();
        if (cancelled) return;
        const mapped = detailRowsFromQuery(rows);
        setDetailState({
          run: lastRun,
          status: "ready",
          rows: mapped,
          loadedCount: mapped.length,
          hasMore: rows.length >= DETAIL_PAGE_SIZE,
        });
      } catch {
        // 查询失败/数据集缺失：与排名动线同口径回退演示行
        if (!cancelled) {
          setDetailState({
            run: lastRun,
            status: "failed",
            rows: [],
            loadedCount: 0,
            hasMore: false,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lastRun]);

  /** 加载更多：以已装载行数为 OFFSET 读下一页并追加；失败保留已加载部分，按钮可重试 */
  async function handleLoadMore() {
    const state = detailState;
    if (!state || state.run !== lastRun || state.loadedCount >= DETAIL_MAX_ROWS || loadingMore) {
      return;
    }
    setLoadingMore(true);
    try {
      const conn = await getDuckDB();
      const result = await conn.query(buildDetailPageSql(state.loadedCount));
      const rows = await result.toArray();
      const mapped = detailRowsFromQuery(rows);
      const loadedCount = state.loadedCount + mapped.length;
      // run 身份比对：期间若重跑了体检，旧批次结果直接丢弃（见 DetailLoadState 注释）
      setDetailState((prev) =>
        prev && prev.run === lastRun
          ? {
              ...prev,
              rows: [...prev.rows, ...mapped],
              loadedCount,
              hasMore: rows.length >= DETAIL_PAGE_SIZE,
            }
          : prev,
      );
    } catch {
      // 加载更多失败：保留已加载部分（按钮仍在，可重试），不整页回退
    } finally {
      setLoadingMore(false);
    }
  }

  // 聚合源：真实装载成功用全账单商户聚合，否则回退确定性演示行（浏览器内聚合）
  const demoRows = useMemo(() => generateLedgerDemoRows(), []);
  const source = useMemo(() => {
    if (liveRealData.entries) {
      return {
        entries: liveRealData.entries,
        totalCents: liveRealData.totalCents,
        real: true,
        // 截断判定用未过滤空名的原始聚合行数：空名分组进入前 50 名时，
        // 展示条数会小于原始行数，用展示条数判截断会误标「全部展示」
        truncated: liveRealData.merchantRowCount >= QUERY_ROW_LIMIT,
      };
    }
    const total = demoRows.reduce((sum, row) => sum + row.amountCents, 0);
    return {
      entries: aggregateMerchants(demoRows, total),
      totalCents: total,
      real: false,
      truncated: false,
    };
  }, [liveRealData, demoRows]);

  // 商户搜索只作用于展示（图表与数据表同步过滤），不改变聚合口径
  const visible = useMemo(() => {
    const query = merchantQuery.trim();
    if (!query) return source.entries;
    return source.entries.filter((entry) => entry.merchant.includes(query));
  }, [source, merchantQuery]);

  const chartEntries = visible.slice(0, CHART_TOP_N);

  const barOption = useMemo(
    () => () =>
      buildBarOption(
        {
          labels: chartEntries.map((entry) => entry.merchant),
          values: chartEntries.map((entry) => entry.cents),
        },
        {
          horizontal: true,
          formatValue: (v) => `¥${formatYuan(v)}`,
          axisFormat: (v) => `¥${Math.round(v / 100)}`,
        },
      ),
    [chartEntries],
  );

  function handleBarClick(params: ECElementEvent) {
    const cents = typeof params.value === "number" ? Math.round(params.value) : 0;
    const entry = chartEntries.find((item) => item.merchant === params.name);
    const share = entry ? entry.share : 0;
    onAnchor({
      id: "merchant-view",
      label: merchantAnchorLabel(String(params.name ?? ""), cents, share),
    });
  }

  /** 数据表行「追问」按钮：与柱子点击同一锚点协议，键盘 / 读屏可到达（05 §6.1） */
  function askFromRow(entry: MerchantEntry) {
    onAnchor({
      id: "merchant-view",
      label: merchantAnchorLabel(entry.merchant, entry.cents, entry.share),
    });
  }

  const shareTotal = source.entries.reduce((sum, entry) => sum + entry.share, 0);
  const caption = source.real
    ? "全账单口径 · 点击柱子或数据表「追问」按钮可以追问"
    : "内置数据 · 点击柱子或数据表「追问」按钮可以追问";

  // ─────────────────── 逐笔明细渲染派生（A15 第二部分） ───────────────────

  // 演示明细行（确定性，与排名演示行同动线）：无体检记录或查询失败时回退
  const demoDetailRows = useMemo(() => buildDemoDetailRows(), []);

  /**
   * 逐笔明细展示行源（渲染期派生，与排名侧 liveRealData 同策略——不在 effect
   * 里同步清空状态，避免级联渲染）：
   * - 无体检记录（演示动线）或查询失败 → 演示行（与排名动线同口径回退）；
   * - lastRun 已切换但新批次还没装完 → loading（不闪旧批次数据）；
   * - 装载成功 → 真实行（0 行 = 空账单，保留真实空态提示）。
   */
  const detailSource = useMemo(() => {
    if (!lastRun) return { kind: "demo" as const, rows: demoDetailRows };
    if (detailState?.run !== lastRun) return { kind: "loading" as const, rows: [] };
    if (detailState.status === "failed") return { kind: "demo" as const, rows: demoDetailRows };
    return { kind: "ready" as const, rows: detailState.rows };
  }, [lastRun, detailState, demoDetailRows]);

  // 明细关键字过滤只作用于展示（客户端过滤，不触碰 DuckDB），与商户搜索同一策略
  const detailVisible = useMemo(
    () => filterDetailRows(detailSource.rows, detailQuery),
    [detailSource, detailQuery],
  );

  // 「加载更多」可用条件：装载成功 + 上一页取满整页 + 未到展示上限
  const canLoadMore =
    detailState !== null &&
    detailSource.kind === "ready" &&
    detailState.hasMore &&
    detailState.loadedCount < DETAIL_MAX_ROWS;

  /** 逐笔明细数据来源脚注：真实动线如实标注已展示行数与上限，演示动线标明内置数据 */
  const detailFooterText =
    detailSource.kind === "demo"
      ? "内置数据 · 演示明细的时间按确定性规则生成"
      : `全账单口径 · 已展示 ${detailState?.loadedCount ?? 0} 行${
          (detailState?.loadedCount ?? 0) >= DETAIL_MAX_ROWS
            ? "，已达展示上限，更多明细可到追问面板按条件提问"
            : ""
        }`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">商户统计</h2>
          <p className="mt-0.5 text-sm text-(--color-ink-secondary)">
            {activeTab === "ranking"
              ? "每个商户 / 支付单位的全账单支出总额、笔数与占比 · 点击柱子即可追问"
              : "全账单逐笔收支流水 · 深夜（23:00-05:00）交易带徽标，可按商户或类目搜索"}
          </p>
        </div>
        {activeTab === "ranking" ? (
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-(--color-ink-muted)"
              aria-hidden
            />
            <input
              type="search"
              value={merchantQuery}
              onChange={(e) => setMerchantQuery(e.target.value)}
              placeholder="搜索商户"
              aria-label="搜索商户"
              className="h-11 w-44 rounded-full border border-(--color-border) bg-(--color-surface) pr-4 pl-10 text-sm text-(--color-ink) transition-colors placeholder:text-(--color-ink-muted) hover:border-(--color-border-strong) sm:w-56"
            />
          </div>
        ) : (
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-(--color-ink-muted)"
              aria-hidden
            />
            <input
              type="search"
              value={detailQuery}
              onChange={(e) => setDetailQuery(e.target.value)}
              placeholder="搜索商户或类目"
              aria-label="搜索明细"
              className="h-11 w-44 rounded-full border border-(--color-border) bg-(--color-surface) pr-4 pl-10 text-sm text-(--color-ink) transition-colors placeholder:text-(--color-ink-muted) hover:border-(--color-border-strong) sm:w-56"
            />
          </div>
        )}
      </div>

      {/* 页签切换：「去向排名」= 既有聚合视图；「逐笔明细」= A15 第二部分新增流水表。
          与洞察页视图切换同款分段控件样式（role=group + aria-pressed 表达当前页签） */}
      <div
        role="group"
        aria-label="商户统计视图切换"
        className="inline-flex rounded-full border border-(--color-border) bg-(--color-surface) p-1"
      >
        {MERCHANT_TABS.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              aria-pressed={active}
              className={`inline-flex h-10 items-center rounded-full px-3.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-(--color-primary-soft) text-(--color-brand-600)"
                  : "text-(--color-ink-secondary) hover:text-(--color-ink)"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "ranking" ? (
        <>
          <ChartCard
            title="商户支出排名"
            caption={
              visible.length > CHART_TOP_N
                ? `${caption} · 图展示前 ${CHART_TOP_N} 名，完整排名看数据表`
                : caption
            }
            chart={
              visible.length > 0 ? (
                <EChart
                  option={barOption}
                  height={280}
                  ariaLabel="商户支出排名柱状图"
                  onClick={handleBarClick}
                />
              ) : (
                <div className="flex h-[280px] flex-col items-center justify-center gap-2 rounded-(--radius-md) border border-dashed border-(--color-border-strong) text-center">
                  <p className="text-sm font-medium">没有匹配的商户</p>
                  <p className="text-xs text-(--color-ink-secondary)">换个关键词试试</p>
                </div>
              )
            }
            table={
              <div className="max-h-[280px] overflow-auto rounded-(--radius-md) border border-(--color-border)">
                <table className="w-full min-w-[520px] text-sm">
                  <thead className="sticky top-0 z-10 bg-(--color-surface)">
                    <tr className="border-b border-(--color-border) text-left text-xs text-(--color-ink-muted)">
                      <th scope="col" className="px-3 py-2 font-medium">
                        商户 / 支付单位
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        总额（元）
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        笔数
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        占全账单
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        均笔（元）
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        <span className="sr-only">操作</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((entry) => (
                      <tr
                        key={entry.merchant}
                        className="border-b border-(--color-border) last:border-0 hover:bg-(--color-surface-2)"
                      >
                        <td className="px-3 py-2">{entry.merchant}</td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums">
                          ¥{formatYuan(entry.cents)}
                        </td>
                        <td className="px-3 py-2 text-right text-(--color-ink-secondary) tabular-nums">
                          {entry.count}
                        </td>
                        <td className="px-3 py-2 text-right text-(--color-ink-secondary) tabular-nums">
                          {entry.share}%
                        </td>
                        <td className="px-3 py-2 text-right text-(--color-ink-secondary) tabular-nums">
                          ¥{formatYuan(entry.avgCents)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => askFromRow(entry)}
                            aria-label={`追问${entry.merchant}`}
                            className="rounded-full border border-(--color-border) px-2.5 py-1 text-xs text-(--color-ink-secondary) transition-colors hover:border-(--color-border-strong) hover:text-(--color-ink)"
                          >
                            追问
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {visible.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-12 text-center">
                    <p className="text-sm font-medium">没有匹配的商户</p>
                    <p className="text-xs text-(--color-ink-secondary)">换个关键词试试</p>
                  </div>
                ) : null}
              </div>
            }
          />

          {/* 数据来源与口径脚注：真实动线如实标注行数上限，演示动线标明内置数据 */}
          <p className="text-xs text-(--color-ink-muted)">
            <ReceiptText className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
            {merchantFooterText({
              real: source.real,
              truncated: source.truncated,
              entryCount: source.entries.length,
              rowLimit: QUERY_ROW_LIMIT,
              totalCents: source.totalCents,
            })}
            <span className="ml-1 text-(--color-ink-muted/70)">
              · 占比为各商户占全账单支出比例（合计约 {Math.round(shareTotal)}%）
            </span>
          </p>
        </>
      ) : (
        <>
          {/* 逐笔明细页签（A15 第二部分）：流水表定位到秒（时间列带时分秒），
          深夜行（23:00-05:00）带「深夜」徽标；搜索为客户端过滤；装载失败
          与无体检记录同口径回退演示行（见 detailSource 派生说明） */}
          <section className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-4 shadow-(--shadow-sm)">
            <header className="mb-3">
              <h3 className="text-sm font-semibold">逐笔明细</h3>
              <p className="mt-0.5 text-xs text-(--color-ink-muted)">
                {detailSource.kind === "demo"
                  ? "内置数据 · 演示流水的时间按确定性规则生成"
                  : "全账单口径 · 排除理财与退款行，按交易时间倒序展示"}
              </p>
            </header>
            {detailSource.kind === "loading" ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center">
                <p className="text-sm font-medium">正在装载逐笔明细…</p>
              </div>
            ) : detailSource.kind === "ready" && detailSource.rows.length === 0 ? (
              // 真实空账单：保留真实空态提示，不回退演示行（与「装载成功含 0 行」语义一致）
              <div className="flex flex-col items-center gap-2 py-12 text-center">
                <p className="text-sm font-medium">本地账单还没有可展示的收支明细</p>
                <p className="text-xs text-(--color-ink-secondary)">导入账单并完成体检后查看</p>
              </div>
            ) : (
              <div className="max-h-[420px] overflow-auto rounded-(--radius-md) border border-(--color-border)">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="sticky top-0 z-10 bg-(--color-surface)">
                    <tr className="border-b border-(--color-border) text-left text-xs text-(--color-ink-muted)">
                      <th scope="col" className="px-3 py-2 font-medium">
                        时间
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        类目
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        商户 / 支付单位
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        方向
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        金额（元）
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailVisible.map((row, index) => (
                      <tr
                        // tsText 定位到秒，同一秒可能多笔，拼上序号保证 key 唯一
                        key={`${row.tsText}-${index}`}
                        className="border-b border-(--color-border) last:border-0 hover:bg-(--color-surface-2)"
                      >
                        <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                          {row.tsText}
                          {row.night ? (
                            <span className="ml-1.5 rounded-full bg-(--color-primary-soft) px-1.5 py-0.5 text-[11px] font-medium text-(--color-brand-600)">
                              深夜
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2">{row.category}</td>
                        <td className="px-3 py-2">{row.merchant}</td>
                        <td className="px-3 py-2 text-(--color-ink-secondary)">
                          {directionLabel(row.direction)}
                        </td>
                        <td className="px-3 py-2 text-right font-medium whitespace-nowrap tabular-nums">
                          ¥{formatYuan(row.amountCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {detailVisible.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-12 text-center">
                    <p className="text-sm font-medium">没有匹配的明细</p>
                    <p className="text-xs text-(--color-ink-secondary)">换个关键词试试</p>
                  </div>
                ) : null}
              </div>
            )}
            {canLoadMore ? (
              <div className="mt-3 flex justify-center">
                <button
                  type="button"
                  onClick={() => void handleLoadMore()}
                  disabled={loadingMore}
                  className="inline-flex h-10 items-center rounded-full border border-(--color-border) bg-(--color-surface) px-4 text-sm font-medium text-(--color-ink-secondary) transition-colors hover:border-(--color-border-strong) hover:text-(--color-ink) disabled:opacity-60"
                >
                  {loadingMore ? "加载中…" : "加载更多明细"}
                </button>
              </div>
            ) : null}
          </section>
          {/* 数据来源与口径脚注：演示动线标明内置数据，真实动线如实标注已展示行数 */}
          <p className="text-xs text-(--color-ink-muted)">
            <ReceiptText className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
            {detailFooterText}
            <span className="ml-1 text-(--color-ink-muted/70)">· 深夜为 23:00-05:00 的交易</span>
          </p>
        </>
      )}
    </div>
  );
}
