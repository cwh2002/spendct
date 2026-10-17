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
import { useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { ECElementEvent } from "echarts/core";
import { EChart, type ECOption } from "@/components/charts/e-chart";
import {
  buildBarOption,
  buildDonutOption,
  buildLineOption,
  formatYuan,
} from "@/components/charts/option-builders";
import { recordProgressEvent, recheckAll } from "@/lib/achievements";
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
  const unit = insight.chartUnit;
  switch (insight.chartKind) {
    case "timeseries":
      // 真实管线卡：金额口径按分存储，chartUnit 为元时换算为元（两位小数、
      // ¥ 轴刻度 + 月均参考线）；笔/行/% 计数与比率口径原样展示；
      // 演示卡（chartUnit 缺省，ins-2 为笔数、ins-4 为元）保持原状
      if (unit === "元") {
        return buildLineOption(data, {
          formatValue: formatYuan,
          unit: " 元",
          axisFormat: (v) => `¥${Math.round(v / 100)}`,
          markLineAverage: { label: "月均" },
        });
      }
      if (unit === "笔" || unit === "行" || unit === "%") {
        // 比率口径固定 1 位小数，与数据表/柱图标签口径一致
        return buildLineOption(data, {
          unit: ` ${unit}`,
          ...(unit === "%" ? { formatValue: (v: number) => v.toFixed(1) } : {}),
        });
      }
      return buildLineOption(data);
    case "donut":
      // 真实管线卡：金额口径分 → 元（tooltip 报金额 + 1 位小数占比）；
      // 演示百分比卡（chartUnit 缺省）数据本身就是占比，tooltip 只报占比
      if (unit === "元") {
        return buildDonutOption(data, {
          formatValue: formatYuan,
          unit: " 元",
          legendWithValue: data.labels.length <= 5,
        });
      }
      return buildDonutOption(data);
    case "bar": {
      // 金额口径按分存储（与 DEMO_SUBSCRIPTIONS 同口径），展示换算为元；
      // 笔数/行数等聚合计数原样展示；比率口径（%）固定 1 位小数，
      // 避免整数百分比（如 -61.0）与小数百分比混排时小数位不齐
      const barUnit = unit ?? "元";
      const formatValue =
        barUnit === "元"
          ? (v: number) => formatYuan(v)
          : barUnit === "%"
            ? (v: number) => v.toFixed(1)
            : (v: number) => String(v);
      return buildBarOption(data, { formatValue, unit: ` ${barUnit}` });
    }
  }
}

/** 数据表视图的行生成：与图表同源、逐项对应（05 §3.6 规则 6 的无障碍救济） */
function buildTableRows(insight: DemoInsight): { label: string; value: string; note?: string }[] {
  const rows = insight.chartLabels.map((label, i) => {
    const raw = insight.chartData[i] ?? 0;
    if (insight.chartKind === "bar") {
      // 与图表同口径：金额列换算为元，计数列（笔/行）原样展示，
      // 比率列（%）固定 1 位小数，与图表标签口径一致
      const unit = insight.chartUnit ?? "元";
      const value =
        unit === "元"
          ? `${formatYuan(raw)} 元`
          : unit === "%"
            ? `${raw.toFixed(1)} ${unit}`
            : `${raw} ${unit}`;
      return { label, value };
    }
    if (insight.chartKind === "donut") {
      // 真实卡按 chartUnit 定口径：元 = 分换算金额；演示百分比卡（无 chartUnit）原样 + %
      const unit = insight.chartUnit;
      if (unit === "元") return { label, value: `${formatYuan(raw)} 元` };
      if (unit === "笔" || unit === "行") return { label, value: `${raw} ${unit}` };
      return { label, value: `${raw}%` };
    }
    // 时间序列：真实卡按 chartUnit 定口径（元→分换算为元，笔/行原样+单位，
    // % 固定 1 位小数）；演示卡无 chartUnit，保留量级推断启发式（两位数以内为笔数，其余为元）
    const unit = insight.chartUnit;
    if (unit) {
      const value =
        unit === "元"
          ? `${formatYuan(raw)} 元`
          : unit === "%"
            ? `${raw.toFixed(1)} ${unit}`
            : `${raw} ${unit}`;
      return { label, value };
    }
    const inferred = insight.chartData.some((v) => v >= 100) ? "元" : "笔";
    return { label, value: `${raw} ${inferred}` };
  });
  return rows;
}

/** 引用条目 → 口语化来源：带 kind 前缀的内部标识（sql:表名等）映射为人话，已是人话的原文原样直出 */
function humanCitation(citation: string): string {
  const sep = citation.indexOf(":");
  if (sep < 0) return citation;
  switch (citation.slice(0, sep)) {
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
      return citation;
  }
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
      // 采纳持久化（WP8 §8c）：进度落盘后全量校正成就（night-guard 判 stage
      // 为 anomaly 的深夜冲动卡，saver 用采纳月对比月度支出）。stage 取卡上
      // 归一化阶段值（stageId，与管线六阶段枚举同口径）；卡片没有所属月字段，
      // month 取当前月 YYYY-MM。同 cardId 去重，重复确认不会重复计数。
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      recordProgressEvent({
        type: "adopt",
        cardId: insight.id,
        stage: insight.stageId,
        month,
      });
      recheckAll();
      // 主色高亮 800ms 后回落到已确认态
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
    // 证据图点选 = 选中追问入口（ChartAnchorLayer）：标签带阶段名便于面板展示
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
      } ${focused ? "shadow-(--shadow-md) ring-2 ring-(--color-brand-600) ring-offset-2 ring-offset-(--color-surface-page)" : ""}`}
    >
      {insight.withheld ? (
        /* 低置信度卡顶部黄条：原因 + 补救动作，整体灰显但不阻断操作 */
        <div className="flex items-start gap-2 rounded-t-(--radius-lg) bg-(--color-warn-soft) px-4 py-2.5 sm:px-5">
          <TriangleAlert
            className="mt-0.5 size-4 shrink-0 text-(--color-warning-ink)"
            aria-hidden
          />
          <div>
            <p className="text-sm font-medium text-(--color-warning-ink)">
              {insight.withheld.reason}
            </p>
            <p className="mt-0.5 text-xs text-(--color-warning-ink)/80">
              {insight.withheld.action}
            </p>
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
                  dot <= insight.confidence
                    ? "bg-(--color-primary)"
                    : "bg-(--color-border-strong)/70"
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
          className="px-4 pt-2.5 text-base leading-snug font-semibold text-(--color-ink) sm:px-5"
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
            <>
              {insight.chartTitle ? (
                <p className="mb-1.5 text-xs text-(--color-ink-muted)">
                  {insight.chartTitle}
                  {insight.chartKind === "bar" ? ` · 单位：${insight.chartUnit ?? "元"}` : ""}
                </p>
              ) : null}
              <EChart
                option={chartOption}
                // 环图图例置顶 + 环体下移，180px 下标签线会顶到卡片边缘，单独加高 40px
                height={insight.chartKind === "donut" ? 220 : 180}
                ariaLabel={`${insight.headline}的证据图，等价数据见数据表视图`}
                onClick={handleChartClick}
              />
            </>
          )}
        </div>

        {insight.chartStats && insight.chartStats.length > 0 ? (
          <div className="px-4 sm:px-5">
            <ul className="flex flex-wrap items-baseline gap-x-5 gap-y-1 pt-1.5 text-xs text-(--color-ink-secondary)">
              {insight.chartStats.map((stat) => (
                <li key={stat.label} className="flex items-baseline gap-1">
                  <span className="text-(--color-ink-muted)">{stat.label}</span>
                  <span className="font-medium tabular-nums">
                    {stat.value}
                    {stat.unit ?? ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {!compact ? (
          <>
            <div className="px-4 sm:px-5">
              <button
                type="button"
                onClick={() => setCitationsOpen((v) => !v)}
                aria-expanded={citationsOpen}
                className="mt-2 flex items-center gap-1 text-xs font-medium text-(--color-ink-muted) transition-colors hover:text-(--color-ink-secondary)"
              >
                来源 ({insight.citations.length})
                <ChevronDown
                  className={`size-3.5 transition-transform ${citationsOpen ? "rotate-180" : ""}`}
                  aria-hidden
                />
              </button>
              {citationsOpen ? (
                <ul className="mt-2 space-y-1 rounded-(--radius-md) bg-(--color-surface-2) px-3 py-2">
                  {[...new Set(insight.citations.map(humanCitation))].map((citation) => (
                    <li
                      key={citation}
                      className="truncate text-xs text-(--color-ink-secondary)"
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
                {confirmed ? "已确认 · 再点取消" : "确认"}
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
                  谢谢反馈，我们会记下这个评价
                </span>
              ) : null}
            </footer>
          </>
        ) : null}
      </div>
    </motion.article>
  );
}
