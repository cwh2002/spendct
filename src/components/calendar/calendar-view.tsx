"use client";

import { CalendarDays, Inbox, Upload } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarHeatmap } from "./calendar-heatmap";
import { CalendarTimeline } from "./calendar-timeline";
import { getDuckDB } from "@/lib/duckdb/service";
import {
  CALENDAR_DAILY_ROWS_CAP,
  CALENDAR_DAILY_SQL,
  CALENDAR_MAX_ROWS,
  CALENDAR_PAGE_SIZE,
  buildCalendarTimelineSql,
  dailyCentsFromQuery,
  dailyCentsFromRows,
  timelineRowsFromQuery,
  type CalendarTimelineRow,
  type DailyCents,
} from "@/lib/insights/calendar-aggregate";
import { generateCalendarDemoRows } from "@/lib/insights/calendar-demo";
import { usePipeline, type LastRunSummary } from "@/lib/pipeline/store";
import { runWhitelistedAggregate } from "@/lib/sql-guard/whitelist";
import { useMounted } from "@/lib/use-mounted";

/** 真实装载结果：run 打标沿用订阅视图同款「对象身份比对」策略（runId 在
 *  上传/示例两档间复用不唯一，引用比对才能区分先后两次运行） */
interface RealCalendarData {
  run: LastRunSummary;
  /** 每日支出点（日期升序）；查询失败时整页走演示动线，不存失败态 */
  daily: DailyCents[];
  /** 流水装载态：首页成功即 ready（含 0 行空账单），失败由 failedRun 承担 */
  timeline: {
    status: "ready";
    /** 已装载的流水行（按页累加，时间倒序） */
    rows: CalendarTimelineRow[];
    /** 已装载行数：既是计数也是「加载更多」下一页的 OFFSET 起点 */
    loadedCount: number;
    /** 上一页取满整页 → 后面可能还有行 */
    hasMore: boolean;
  };
}

/** 无数据空态：未导入账单（关闭演示开关）或真实账单 0 笔流水时整页提示 */
function CalendarEmptyState({ hint }: { hint: string }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 rounded-(--radius-card) border border-dashed border-(--color-border-strong) px-6 py-16 text-center">
      <span className="grid size-16 place-items-center rounded-full bg-(--color-surface-2)">
        <Inbox className="size-7 text-(--color-ink-muted)" aria-hidden />
      </span>
      <div>
        <h2 className="text-lg font-semibold">这里还没有消费日历</h2>
        <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-(--color-ink-secondary)">
          {hint}
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

/**
 * 消费日历视图（08 修订案 A15 第四部分，/calendar）：
 * 每日支出热力图 + 逐笔时间轴流水，把「哪天花得多、哪笔在深夜」摊开在日历上。
 * 数据动线：体检运行过（lastRun 存在）且 DuckDB 查询成功时展示真实账单
 * （浏览器内计算，账单不出本地）；查询失败或无体检结果则回退确定性演示流水
 * （generateCalendarDemoRows，与账本汇总 / 商户统计同款兜底口径）。
 * 热力图走白名单聚合（CALENDAR_DAILY_SQL，行数上限放宽到多年账单日数）；
 * 流水明细不是聚合形态，走直连查询（代码常量、零动态拼接，同 A8 明细出口口径）。
 */
export function CalendarView() {
  const lastRun = usePipeline((s) => s.lastRun);

  // 真实数据查询状态：查询失败时记 failedRun，按同引用降级演示（订阅视图同款口径）
  const [realData, setRealData] = useState<RealCalendarData | null>(null);
  const [failedRun, setFailedRun] = useState<LastRunSummary | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // 本地「关闭演示数据」开关：置 1 后页面进入真实空态，用于验收空态设计（洞察页同口径）。
  // 本页无 Suspense 边界兜底，渲染期读 localStorage 会与服务端首帧不一致，
  // 故读取值保持不变、分支处用 mounted 门控（见 useMounted 注释）
  const [demoOff] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem("spendct:demo:off") === "1";
    } catch {
      return false;
    }
  });
  // 挂载门控：水合首帧两端同口径渲染演示动线，挂载后再按本地开关切换空态
  const mounted = useMounted();

  useEffect(() => {
    // 演示动线（尚未体检，lastRun 为空）不查询，维持内置示例数据
    if (!lastRun) return;
    let cancelled = false;

    void (async () => {
      try {
        // 两条查询并行：每日聚合走白名单（行数上限按多年账单日数放宽），
        // 流水首屏走直连常量 SQL（LIMIT 200，OFFSET 由 buildCalendarTimelineSql 拼入）
        const conn = await getDuckDB();
        const [daily, timelineRows] = await Promise.all([
          runWhitelistedAggregate(conn, CALENDAR_DAILY_SQL, {
            maxResultRows: CALENDAR_DAILY_ROWS_CAP,
          }),
          conn.query(buildCalendarTimelineSql(0)).then((result) => result.toArray()),
        ]);
        if (cancelled) return;
        const points = dailyCentsFromQuery(daily.rows as Record<string, unknown>[]);
        const rows = timelineRowsFromQuery(timelineRows as Record<string, unknown>[]);
        setRealData({
          run: lastRun,
          daily: points,
          timeline: {
            status: "ready",
            rows,
            loadedCount: rows.length,
            hasMore: timelineRows.length >= CALENDAR_PAGE_SIZE,
          },
        });
      } catch (err) {
        // 查询失败（wasm 加载失败 / 白名单拒绝 / 超时）→ 兜底演示数据，页面不白屏
        if (cancelled) return;
        console.warn("[calendar] 真实账单查询失败，降级演示数据：", err);
        setFailedRun(lastRun);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [lastRun]);

  /** 加载更多：以已装载行数为 OFFSET 读下一页并追加；失败保留已加载部分，按钮可重试 */
  const handleLoadMore = useCallback(async () => {
    const data = realData;
    if (
      !data ||
      data.run !== lastRun ||
      data.timeline.loadedCount >= CALENDAR_MAX_ROWS ||
      loadingMore
    ) {
      return;
    }
    setLoadingMore(true);
    try {
      const conn = await getDuckDB();
      const result = await conn.query(buildCalendarTimelineSql(data.timeline.loadedCount));
      const rows = await result.toArray();
      const mapped = timelineRowsFromQuery(rows as Record<string, unknown>[], data.timeline.loadedCount);
      const loadedCount = data.timeline.loadedCount + mapped.length;
      // run 身份比对：期间若重跑了体检，旧批次结果直接丢弃（见 RealCalendarData 注释）
      setRealData((prev) =>
        prev && prev.run === lastRun
          ? {
              ...prev,
              timeline: {
                ...prev.timeline,
                rows: [...prev.timeline.rows, ...mapped],
                loadedCount,
                hasMore: rows.length >= CALENDAR_PAGE_SIZE,
              },
            }
          : prev,
      );
    } catch {
      // 加载更多失败：保留已加载部分（按钮仍在，可重试），不整页回退
    } finally {
      setLoadingMore(false);
    }
  }, [realData, lastRun, loadingMore]);

  // 数据源判定：lastRun 为空或该次运行查询失败 → 演示动线；查询中取空数组（不伪造数字）
  const isDemoMode = lastRun === null || failedRun === lastRun;
  const realReady = realData !== null && realData.run === lastRun;
  const loading = lastRun !== null && failedRun !== lastRun && !realReady;

  // 演示流水（确定性）：无体检结果或真实查询失败时整页使用（热力图与流水同源，不混搭）
  const demoRows = useMemo(() => generateCalendarDemoRows(), []);
  const demoDaily = useMemo(() => dailyCentsFromRows(demoRows), [demoRows]);
  const dailyPoints = isDemoMode ? demoDaily : realReady ? realData.daily : [];
  const timelineRows = isDemoMode ? demoRows : realReady ? realData.timeline.rows : [];

  // 真实空账单（0 笔流水）：整页空态引导重新导入
  if (realReady && realData.timeline.rows.length === 0) {
    return <CalendarEmptyState hint="这次体检的账单里没有交易流水。导入更多账单后，这里会按天展示支出热力图与逐笔流水。" />;
  }
  // 演示开关关闭且尚未体检：与洞察页同口径的真实空态（mounted 门控保证水合一致）
  if (mounted && demoOff && lastRun === null) {
    return <CalendarEmptyState hint="上传账单并跑完体检，消费日历会按天铺开你的每一笔支出，深夜消费单独标记。" />;
  }

  return (
    <div className="space-y-4">
      {/* 页头 */}
      <header className="flex flex-wrap items-center gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-(--radius-md) bg-(--color-primary-soft) text-(--color-primary)">
          <CalendarDays className="size-6" aria-hidden />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">消费日历</h1>
          <p className="text-sm text-(--color-ink-secondary)">
            把每一笔消费铺在日历上：花得多的日子颜色更深，深夜消费单独标记
          </p>
        </div>
        <div className="ml-auto hidden items-center gap-2 sm:flex">
          <span className="rounded-full border border-(--color-border) px-3 py-1 text-xs text-(--color-ink-secondary)">
            {isDemoMode ? "内置数据" : "真实数据"}
          </span>
        </div>
      </header>

      {/* 每日支出热力图 */}
      <section aria-label="每日支出热力图">
        {loading ? (
          <div className="flex h-[240px] flex-col items-center justify-center gap-2 rounded-(--radius-lg) border border-dashed border-(--color-border-strong) bg-(--color-surface) text-center">
            <p className="text-sm font-medium">正在生成消费日历…</p>
            <p className="text-xs text-(--color-ink-secondary)">从你本次体检的结果里按天汇总支出，通常几秒钟就好</p>
          </div>
        ) : (
          <CalendarHeatmap points={dailyPoints} real={realReady} />
        )}
      </section>

      {/* 时间轴流水 */}
      <CalendarTimeline
        rows={timelineRows}
        real={realReady}
        loading={loading}
        loadingMore={loadingMore}
        hasMore={realReady ? realData.timeline.hasMore : false}
        reachedMax={realReady ? realData.timeline.loadedCount >= CALENDAR_MAX_ROWS : false}
        onLoadMore={handleLoadMore}
      />
    </div>
  );
}
