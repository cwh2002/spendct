"use client";

import { motion } from "framer-motion";
import {
  Check,
  ChevronDown,
  CornerDownRight,
  Star,
  Table2,
  ThumbsDown,
  ThumbsUp,
  TriangleAlert,
} from "lucide-react";
import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ECElementEvent } from "echarts/core";
import { EChart, type ECOption } from "@/components/charts/e-chart";
import {
  buildBarOption,
  buildDonutOption,
  buildLineOption,
  formatYuan,
} from "@/components/charts/option-builders";
import type { DemoInsight } from "@/lib/demo-data";

/** 页面通过 ref 驱动键盘操作（j/k 聚焦、Enter 展开、t 切数据表） */
export interface InsightCardHandle {
  toggleExpand(): void;
  toggleTable(): void;
}

interface InsightCardProps {
  ref?: React.Ref<InsightCardHandle>;
  insight: DemoInsight;
  /** j/k 键盘焦点态：焦点环可见（05 §5 快捷键表） */
  focused: boolean;
  /** 图表廊压缩形态：只保留 headline + 证据图，隐藏叙事与操作行 */
  compact?: boolean;
  /** 收藏态由页面统一持有（FavoritesPanel 与卡片共享同一状态源） */
  favorite: boolean;
  /** 入场动画的错峰序号 */
  index?: number;
  onToggleFavorite(id: string): void;
  /** 深挖：把该卡锚定到追问面板 */
  onDelve(id: string, label: string): void;
}

/**
 * 洞察卡内嵌图表的 option 工厂：传函数形式给 EChart，
 * 暗色切换时组件会重新调用本函数、经 chartTokens() 取到暗面色板。
 */
function buildInsightChartOption(insight: DemoInsight): ECOption {
  const data = { labels: insight.chartLabels, values: insight.chartData };
  switch (insight.chartKind) {
    case "timeseries":
      // DEMO 口径：ins-2 为笔数、ins-4 为月度金额（元），原始值直接展示
      return buildLineOption(data);
    case "donut":
      return buildDonutOption(data);
    case "bar": {
      // 金额口径按分存储（与 DEMO_SUBSCRIPTIONS 同口径），展示换算为元；
      // 笔数/行数等聚合计数口径（真实管线卡携带 chartUnit）原样展示
      const unit = insight.chartUnit ?? "元";
      const formatValue = unit === "元" ? (v: number) => formatYuan(v) : (v: number) => String(v);
      return buildBarOption(data, { formatValue, unit: ` ${unit}` });
    }
  }
}

/** 数据表视图的行生成：与图表同源、逐项对应（05 §3.6 规则 6 的无障碍救济） */
function buildTableRows(insight: DemoInsight): { label: string; value: string; note?: string }[] {
  const rows = insight.chartLabels.map((label, i) => {
    const raw = insight.chartData[i] ?? 0;
    if (insight.chartKind === "bar") {
      // 与图表同口径：金额列换算为元，计数列（笔/行）原样展示
      const unit = insight.chartUnit ?? "元";
      const value = unit === "元" ? `${formatYuan(raw)} 元` : `${raw} ${unit}`;
      return { label, value };
    }
    if (insight.chartKind === "donut") {
      return { label, value: `${raw}%` };
    }
    // 时间序列按量级推断单位：两位数以内为笔数（深夜消费），其余为月度金额（元）
    const unit = insight.chartData.some((v) => v >= 100) ? "元" : "笔";
    return { label, value: `${raw} ${unit}` };
  });
  if (insight.chartKind === "bar") {
    const unit = insight.chartUnit ?? "元";
    rows.push({
      label: "口径",
      value: unit === "元" ? "金额单位分，已换算为元" : `聚合计数，单位 ${unit}`,
    });
  }
  return rows;
}

const CONFIDENCE_DOTS = [1, 2, 3, 4] as const;

export function InsightCard({
  ref,
  insight,
  focused,
  compact = false,
  favorite,
  index = 0,
  onToggleFavorite,
  onDelve,
}: InsightCardProps) {
  const rootRef = useRef<HTMLElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [tableMode, setTableMode] = useState(false);
  const [citationsOpen, setCitationsOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmCount, setConfirmCount] = useState(0);
  const [confirmFlash, setConfirmFlash] = useState(false);
  const [disputed, setDisputed] = useState(false);
  const flashTimer = useRef<number | null>(null);

  const chartOption = useMemo(() => () => buildInsightChartOption(insight), [insight]);
  const tableRows = useMemo(() => buildTableRows(insight), [insight]);

  // 键盘焦点切换后自动滚入视口（j/k 导航长卡流时保持目标可见）
  useEffect(() => {
    if (focused) {
      rootRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [focused]);

  // 确认按钮的高亮定时器随卸载清理，避免卸载后 setState 告警
  useEffect(
    () => () => {
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    },
    [],
  );

  useImperativeHandle(ref, () => ({
    toggleExpand: () => setExpanded((v) => !v),
    toggleTable: () => setTableMode((v) => !v),
  }));

  function handleConfirm() {
    const next = !confirmed;
    setConfirmed(next);
    setDisputed(false);
    if (next) {
      // 主色高亮 800ms 后回落到已确认态；计数演示单用户审阅记录
      setConfirmCount((c) => c + 1);
      setConfirmFlash(true);
      flashTimer.current = window.setTimeout(() => setConfirmFlash(false), 800);
    }
  }

  function handleDispute() {
    // 质疑：卡片降透明度 + 证据图折叠（05 §1.5 卡片状态），互斥覆盖确认态
    setDisputed((v) => !v);
    setConfirmed(false);
  }

  function handleChartClick(params: ECElementEvent) {
    // 证据图点选 = 锚点追问入口（ChartAnchorLayer）：标签带阶段名便于面板展示
    onDelve(insight.id, `${params.name ?? "数据点"}（${insight.stageName}）`);
  }

  const withheld = Boolean(insight.withheld);

  return (
    <motion.article
      ref={rootRef}
      id={`insight-${insight.id}`}
      aria-labelledby={`${insight.id}-headline`}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index * 0.04, 0.24) }}
      className={`rounded-(--radius-lg) border bg-(--color-surface) shadow-(--shadow-sm) transition-shadow ${
        withheld ? "border-(--color-warning)/50" : "border-(--color-border)"
      } ${focused ? "ring-2 ring-(--color-brand-600) ring-offset-2 ring-offset-(--color-surface-page) shadow-(--shadow-md)" : ""}`}
    >
      {insight.withheld ? (
        /* 低置信度卡顶部黄条：原因 + 补救动作，整体灰显但不阻断操作 */
        <div className="flex items-start gap-2 rounded-t-(--radius-lg) bg-(--color-warn-soft) px-4 py-2.5 sm:px-5">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-(--color-warning-ink)" aria-hidden />
          <div>
            <p className="text-sm font-medium text-(--color-warning-ink)">{insight.withheld.reason}</p>
            <p className="mt-0.5 text-xs text-(--color-warning-ink)/80">{insight.withheld.action}</p>
          </div>
        </div>
      ) : null}

      <div className={disputed ? "opacity-70 saturate-50" : ""}>
        <header className="flex flex-wrap items-center gap-2 px-4 pt-4 sm:px-5">
          <span className="rounded-full bg-(--color-primary-soft) px-2.5 py-1 text-xs font-medium text-(--color-brand-600)">
            {insight.stageName}
          </span>
          <span
            className="ml-auto flex items-center gap-1.5"
            role="img"
            aria-label={`置信度 ${insight.confidence}/4`}
            title={`置信度 ${insight.confidence}/4`}
          >
            {CONFIDENCE_DOTS.map((dot) => (
              <span
                key={dot}
                aria-hidden
                className={`size-2 rounded-full ${
                  dot <= insight.confidence ? "bg-(--color-primary)" : "bg-(--color-border-strong)/70"
                }`}
              />
            ))}
          </span>
          <button
            type="button"
            onClick={() => onToggleFavorite(insight.id)}
            aria-pressed={favorite}
            aria-label={favorite ? "取消收藏" : "收藏此洞察"}
            title={favorite ? "取消收藏" : "收藏"}
            className="grid size-11 place-items-center rounded-full text-(--color-ink-muted) transition-colors hover:bg-(--color-surface-2)"
          >
            <Star
              className={`size-5 ${favorite ? "fill-(--color-accent) text-(--color-accent)" : ""}`}
              aria-hidden
            />
          </button>
        </header>

        <h3
          id={`${insight.id}-headline`}
          className="px-4 pt-2.5 text-base font-semibold leading-snug text-(--color-ink) sm:px-5"
        >
          {insight.headline}
        </h3>

        {!compact ? (
          <div className="px-4 pt-1.5 sm:px-5">
            <p
              className={`text-sm leading-relaxed text-(--color-ink-secondary) ${expanded ? "" : "line-clamp-3"}`}
            >
              {insight.narrative}
            </p>
            {insight.narrative.length > 80 ? (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="mt-1 flex items-center gap-1 text-xs font-medium text-(--color-brand-600) hover:underline"
              >
                {expanded ? "收起" : "展开全文"}
                <ChevronDown
                  className={`size-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
                  aria-hidden
                />
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="mt-3 px-4 sm:px-5">
          {disputed ? (
            <div className="flex h-[180px] items-center justify-center rounded-(--radius-md) border border-dashed border-(--color-border-strong)">
              <button
                type="button"
                onClick={() => setDisputed(false)}
                className="flex items-center gap-1.5 rounded-full border border-(--color-border) bg-(--color-surface) px-3.5 py-2 text-xs text-(--color-ink-muted) transition-colors hover:text-(--color-ink-secondary)"
              >
                <TriangleAlert className="size-3.5" aria-hidden />
                证据图已折叠（已质疑），点击恢复
              </button>
            </div>
          ) : tableMode ? (
            <div className="h-[180px] overflow-y-auto rounded-(--radius-md) border border-(--color-border)">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-(--color-surface)">
                  <tr className="border-b border-(--color-border) text-left text-xs text-(--color-ink-muted)">
                    <th scope="col" className="px-3 py-2 font-medium">
                      标签
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      数值
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((row) => (
                    <tr key={row.label} className="border-b border-(--color-border) last:border-0">
                      <td className="px-3 py-1.5 text-(--color-ink-secondary)">{row.label}</td>
                      <td className="px-3 py-1.5 text-right font-medium tabular-nums">
                        {row.value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EChart
              option={chartOption}
              height={180}
              ariaLabel={`${insight.headline}的证据图，等价数据见数据表视图`}
              onClick={handleChartClick}
            />
          )}
        </div>

        {!compact ? (
          <>
            <div className="px-4 sm:px-5">
              <button
                type="button"
                onClick={() => setCitationsOpen((v) => !v)}
                aria-expanded={citationsOpen}
                className="mt-2 flex items-center gap-1 text-xs font-medium text-(--color-ink-muted) transition-colors hover:text-(--color-ink-secondary)"
              >
                引用 ({insight.citations.length})
                <ChevronDown
                  className={`size-3.5 transition-transform ${citationsOpen ? "rotate-180" : ""}`}
                  aria-hidden
                />
              </button>
              {citationsOpen ? (
                <ul className="mt-2 space-y-1 rounded-(--radius-md) bg-(--color-surface-2) px-3 py-2">
                  {insight.citations.map((citation) => (
                    <li
                      key={citation}
                      className="truncate font-mono text-xs text-(--color-ink-secondary)"
                      title={citation}
                    >
                      {citation}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <footer className="mt-3 flex flex-wrap items-center gap-2 border-t border-(--color-border) px-4 py-3 sm:px-5">
              <button
                type="button"
                onClick={handleConfirm}
                aria-pressed={confirmed}
                className={`inline-flex h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors duration-200 ${
                  confirmFlash
                    ? "border-(--color-primary) bg-(--color-primary) text-white"
                    : confirmed
                      ? "border-(--color-primary)/40 bg-(--color-primary-soft) text-(--color-brand-600)"
                      : "border-(--color-border) text-(--color-ink-secondary) hover:border-(--color-border-strong) hover:text-(--color-ink)"
                }`}
              >
                <Check className="size-4" aria-hidden />
                {confirmed ? `已确认 ${confirmCount}` : "确认"}
              </button>
              <button
                type="button"
                onClick={handleDispute}
                aria-pressed={disputed}
                className={`inline-flex h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors ${
                  disputed
                    ? "border-(--color-border) bg-(--color-surface-2) text-(--color-ink-muted)"
                    : "border-(--color-border) text-(--color-ink-secondary) hover:border-(--color-border-strong) hover:text-(--color-ink)"
                }`}
              >
                <ThumbsDown className="size-4" aria-hidden />
                {disputed ? "已质疑" : "质疑"}
              </button>
              <button
                type="button"
                onClick={() => onDelve(insight.id, insight.headline)}
                className="inline-flex h-11 items-center gap-1.5 rounded-full bg-(--color-primary-soft) px-4 text-sm font-medium text-(--color-brand-600) transition-colors hover:opacity-90"
              >
                <CornerDownRight className="size-4" aria-hidden />
                深挖
              </button>
              <button
                type="button"
                onClick={() => setTableMode((v) => !v)}
                aria-pressed={tableMode}
                className={`inline-flex h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors ${
                  tableMode
                    ? "border-(--color-primary)/40 bg-(--color-primary-soft) text-(--color-brand-600)"
                    : "border-(--color-border) text-(--color-ink-secondary) hover:border-(--color-border-strong) hover:text-(--color-ink)"
                }`}
              >
                <Table2 className="size-4" aria-hidden />
                数据表
              </button>
              {confirmed ? (
                <span className="ml-auto inline-flex items-center gap-1 text-xs text-(--color-good-ink)">
                  <ThumbsUp className="size-3.5" aria-hidden />
                  已反馈给评测集
                </span>
              ) : null}
            </footer>
          </>
        ) : null}
      </div>
    </motion.article>
  );
}
