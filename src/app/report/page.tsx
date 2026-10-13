"use client";

import * as echarts from "echarts/core";
import { RadarChart } from "echarts/charts";
import { RadarComponent } from "echarts/components";

// 页面级补充注册（use 幂等）：雷达图仅本页使用，避免共享组件注册集变动影响渲染
echarts.use([RadarChart, RadarComponent]);

import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BookOpenText,
  CircleCheck,
  CircleX,
  Download,
  FileText,
  Trophy,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AchievementWall } from "@/components/achievements/achievement-wall";
import {
  chartTokens,
  cssVar,
  EChart,
  type ECOption,
} from "@/components/charts/e-chart";
import { Container } from "@/components/layout/container";
import { RankBadge } from "@/components/report/rank-badge";
import { renderPosterPng } from "@/components/report/poster-canvas";
import { ACHIEVEMENT_DEFS, getUnlockedIds, unlockAchievement } from "@/lib/achievements";
import { DEMO_ACCOUNT_META, DEMO_REPORT } from "@/lib/demo-data";
import { featureFlags } from "@/lib/feature-flags";
import { getRankTier, saveRankTier } from "@/lib/rank";

/** 六维健康雷达演示静态值：正式版由 v_health_inputs 六维分聚合而来（0-100，越高越健康） */
const RADAR_DIMS = [
  { name: "餐饮", value: 82 },
  { name: "购物", value: 64 },
  { name: "交通", value: 78 },
  { name: "娱乐", value: 46 },
  { name: "居住", value: 81 },
  { name: "其他", value: 55 },
] as const;

/** 四态 → 页面展示元：色+图标+文案成对出现，不靠颜色单独传义（05 §3.1.2） */
const STATUS_META: Record<
  string,
  { label: string; icon: LucideIcon; chip: string; text: string }
> = {
  good: {
    label: "良好",
    icon: CircleCheck,
    chip: "bg-(--color-good)/10 text-(--color-good-ink) dark:text-(--color-good)",
    text: "text-(--color-good-ink) dark:text-(--color-good)",
  },
  warn: {
    label: "关注",
    icon: AlertTriangle,
    chip: "bg-(--color-warning)/15 text-(--color-warning-ink) dark:text-(--color-warning)",
    text: "text-(--color-warning-ink) dark:text-(--color-warning)",
  },
  serious: {
    label: "预警",
    icon: AlertCircle,
    chip: "bg-(--color-critical)/10 text-(--color-critical-ink) dark:text-(--color-critical)",
    text: "text-(--color-critical-ink) dark:text-(--color-critical)",
  },
};

/** hex 色值 → rgba：折线面积渐变需要半透明档，CSS 变量只给 hex */
function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** 健康指数仪表盘：270° 环形进度 + 中心大数字（工厂函数在暗色切换时重取色板） */
const buildGaugeOption = (): ECOption => {
  const t = chartTokens();
  return {
    series: [
      {
        type: "gauge",
        startAngle: 210,
        endAngle: -30,
        min: 0,
        max: 100,
        radius: "95%",
        center: ["50%", "58%"],
        progress: {
          show: true,
          width: 16,
          roundCap: true,
          itemStyle: { color: cssVar("--color-health", "#0fa87a") },
        },
        axisLine: { lineStyle: { width: 16, color: [[1, t.lineHair]] } },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        pointer: { show: false },
        anchor: { show: false },
        title: {
          show: true,
          offsetCenter: [0, "38%"],
          fontSize: 13,
          color: t.inkSecondary,
        },
        detail: {
          valueAnimation: true,
          offsetCenter: [0, "-12%"],
          fontSize: 46,
          fontWeight: 700,
          color: t.ink,
          formatter: "{value}",
        },
        data: [{ value: DEMO_REPORT.healthIndex, name: "健康指数" }],
      },
    ],
  };
};

/** 六维健康雷达：单系列多边形，面积填充半透明主色 */
const buildRadarOption = (): ECOption => {
  const t = chartTokens();
  const primary = t.palette[0] ?? "#2e7ce8";
  return {
    tooltip: {
      trigger: "item",
      backgroundColor: t.surface,
      borderColor: t.lineHair,
      textStyle: { color: t.ink },
    },
    radar: {
      indicator: RADAR_DIMS.map((d) => ({ name: d.name, max: 100 })),
      radius: "66%",
      splitNumber: 4,
      axisName: { color: t.inkSecondary, fontSize: 12 },
      axisLine: { lineStyle: { color: t.lineHair } },
      splitLine: { lineStyle: { color: t.lineHair } },
      splitArea: { areaStyle: { color: ["transparent"] } },
    },
    series: [
      {
        type: "radar",
        symbolSize: 6,
        lineStyle: { color: primary, width: 2 },
        itemStyle: { color: primary },
        areaStyle: { color: hexToRgba(primary, 0.18) },
        data: [{ value: RADAR_DIMS.map((d) => d.value), name: "六维健康分" }],
      },
    ],
  };
};

/**
 * 数据故事四段各自的图表工厂。storySegments 的 chartData 单位不统一：
 * timeseries/donut 为元或百分比刻度，bar（订阅段）为分——按段语义分别换算。
 */
function buildStoryOption(
  seg: (typeof DEMO_REPORT.storySegments)[number],
): () => ECOption {
  return () => {
    const t = chartTokens();
    const tooltipBase = {
      backgroundColor: t.surface,
      borderColor: t.lineHair,
      textStyle: { color: t.ink },
    };

    if (seg.chartKind === "timeseries") {
      const primary = t.palette[0] ?? "#2e7ce8";
      return {
        grid: { left: 8, right: 8, top: 28, bottom: 8, containLabel: true },
        tooltip: {
          ...tooltipBase,
          trigger: "axis",
          valueFormatter: (value: unknown) => `${value} 元`,
        },
        xAxis: {
          type: "category",
          data: seg.chartLabels,
          boundaryGap: false,
          axisTick: { show: false },
          axisLine: { lineStyle: { color: t.lineHair } },
          axisLabel: { color: t.inkMuted },
        },
        yAxis: {
          type: "value",
          splitLine: { lineStyle: { color: t.lineHair } },
          axisLabel: { color: t.inkMuted },
        },
        series: [
          {
            type: "line",
            data: seg.chartData,
            smooth: true,
            symbol: "circle",
            symbolSize: 7,
            lineStyle: { width: 2, color: primary },
            itemStyle: { color: primary, borderColor: t.surface, borderWidth: 2 },
            areaStyle: {
              color: {
                type: "linear",
                x: 0,
                y: 0,
                x2: 0,
                y2: 1,
                colorStops: [
                  { offset: 0, color: hexToRgba(primary, 0.22) },
                  { offset: 1, color: hexToRgba(primary, 0) },
                ],
              },
            },
          },
        ],
      };
    }

    if (seg.chartKind === "bar") {
      return {
        grid: { left: 8, right: 8, top: 24, bottom: 8, containLabel: true },
        tooltip: {
          ...tooltipBase,
          trigger: "axis",
          axisPointer: { type: "shadow" },
          valueFormatter: (value: unknown) => `¥${(Number(value) / 100).toFixed(2)}`,
        },
        xAxis: {
          type: "category",
          data: seg.chartLabels,
          axisTick: { show: false },
          axisLine: { lineStyle: { color: t.lineHair } },
          axisLabel: { color: t.inkSecondary },
        },
        yAxis: {
          type: "value",
          splitLine: { lineStyle: { color: t.lineHair } },
          axisLabel: {
            color: t.inkMuted,
            formatter: (value: number) => `¥${(value / 100).toFixed(0)}`,
          },
        },
        series: [
          {
            type: "bar",
            barWidth: 36,
            data: seg.chartData.map((value, i) => ({
              value,
              itemStyle: {
                color: t.palette[i % t.palette.length],
                borderRadius: [4, 4, 0, 0],
              },
            })),
          },
        ],
      };
    }

    // donut：分类占比，图例 + 直标百分比，颜色按实体固定顺序取色板
    return {
      tooltip: { ...tooltipBase, trigger: "item", formatter: "{b}：{d}%" },
      legend: {
        bottom: 0,
        icon: "circle",
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { color: t.inkSecondary },
      },
      series: [
        {
          type: "pie",
          radius: ["52%", "74%"],
          center: ["50%", "44%"],
          label: { show: true, color: t.ink, formatter: "{b}\n{d}%", fontSize: 11 },
          labelLine: { length: 8, length2: 6 },
          itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 6 },
          data: seg.chartLabels.map((name, i) => ({
            name,
            value: seg.chartData[i] ?? 0,
            itemStyle: { color: t.palette[i % t.palette.length] },
          })),
        },
      ],
    };
  };
}

export default function ReportPage() {
  const rank = useMemo(() => getRankTier(), []);
  const [unlockedIds, setUnlockedIds] = useState<string[]>(() => getUnlockedIds());
  const [posterBusy, setPosterBusy] = useState(false);
  const [toast, setToast] = useState<{ id: number; text: string; kind: "ok" | "error" } | null>(
    null,
  );

  // 报告页是段位的计算源头：重算后写回本地，个人中心与海报读同一份
  useEffect(() => {
    saveRankTier(rank.tier);
  }, [rank.tier]);

  const showToast = useCallback((text: string, kind: "ok" | "error" = "ok") => {
    setToast({ id: Date.now(), text, kind });
  }, []);

  const storyOptions = useMemo(
    () => DEMO_REPORT.storySegments.map((seg) => buildStoryOption(seg)),
    [],
  );

  const handlePoster = useCallback(async () => {
    setPosterBusy(true);
    try {
      const blob = await renderPosterPng();
      if (!blob) {
        showToast("海报生成失败，请重试", "error");
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "spendct-annual-poster.png";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // 延迟回收：等浏览器取完 Blob 再释放对象 URL
      window.setTimeout(() => URL.revokeObjectURL(url), 3000);
      showToast("海报已生成，开始下载");
      // 生成海报即解锁对应成就，成就墙对新徽章播放弹入动画
      setUnlockedIds(unlockAchievement("annual-poster"));
    } catch {
      showToast("海报生成失败，请重试", "error");
    } finally {
      setPosterBusy(false);
    }
  }, [showToast]);

  return (
    <Container wide className="py-8">
      {/* 页头 */}
      <header className="flex flex-wrap items-center gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-(--radius-md) bg-(--color-primary-soft) text-(--color-primary)">
          <BookOpenText className="size-6" aria-hidden />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">2026 年度报告</h1>
          <p className="text-sm text-(--color-ink-secondary)">
            六阶段体检的年度汇总：健康指数、四段数据故事、段位与成就
          </p>
        </div>
        <div className="ml-auto hidden items-center gap-2 sm:flex">
          <span className="rounded-full border border-(--color-border) px-3 py-1 text-xs text-(--color-ink-secondary)">
            覆盖 {DEMO_ACCOUNT_META.monthsCovered} 个月
          </span>
          <span className="rounded-full border border-(--color-border) px-3 py-1 text-xs text-(--color-ink-secondary)">
            {DEMO_ACCOUNT_META.totalTransactions.toLocaleString("zh-CN")} 笔
          </span>
          <span className="rounded-full border border-(--color-border) px-3 py-1 text-xs text-(--color-ink-secondary)">
            演示数据
          </span>
        </div>
      </header>

      {/* Hero：健康仪表 + 四具名指标 */}
      <section aria-label="健康总览" className="mt-6 grid gap-4 lg:grid-cols-5">
        <div className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-4 shadow-(--shadow-sm) lg:col-span-2">
          <EChart option={buildGaugeOption} height={272} ariaLabel="消费健康指数仪表盘：78 分" />
          <p className="text-center text-xs text-(--color-ink-muted)">
            综合六维消费健康分 · 满分 100
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:col-span-3">
          {DEMO_REPORT.namedMetrics.map((m) => {
            const meta = STATUS_META[m.status] ?? STATUS_META.warn!;
            const StatusIcon = meta.icon;
            const DeltaIcon = m.delta.startsWith("+") ? ArrowUpRight : ArrowDownRight;
            return (
              <div
                key={m.id}
                className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-4 shadow-(--shadow-sm)"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-(--color-ink-secondary)">{m.name}</p>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${meta.chip}`}
                  >
                    <StatusIcon className="size-3.5" aria-hidden />
                    {meta.label}
                  </span>
                </div>
                <p className="mt-2 text-3xl font-bold tabular-nums">{m.value}</p>
                <p className="mt-1 flex items-center gap-2 text-sm">
                  <span
                    className={`inline-flex items-center gap-0.5 font-semibold tabular-nums ${meta.text}`}
                  >
                    <DeltaIcon className="size-4" aria-hidden />
                    {m.delta}
                  </span>
                  <span className="text-(--color-ink-muted)">同龄基准 {m.benchmark}</span>
                </p>
                <p className="mt-2 text-xs leading-relaxed text-(--color-ink-muted)">
                  {m.explain}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* 滚动式数据故事 */}
      {featureFlags.reportStory ? (
        <section aria-label="年度数据故事" className="mt-8">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <BookOpenText className="size-5 text-(--color-primary)" aria-hidden />
            年度数据故事
          </h2>
          <div className="mt-4 flex flex-col gap-4">
            {DEMO_REPORT.storySegments.map((seg, i) => (
              <motion.article
                key={seg.headline}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.24, ease: "easeOut" }}
                className="grid gap-4 rounded-(--radius-xl) border border-(--color-border) bg-(--color-surface) p-5 shadow-(--shadow-sm) md:grid-cols-2 md:p-6"
              >
                <div className="flex flex-col justify-center">
                  <span className="w-max rounded-full bg-(--color-primary-soft) px-2.5 py-0.5 text-xs font-semibold text-(--color-brand-600) tabular-nums">
                    {String(i + 1).padStart(2, "0")} / {DEMO_REPORT.storySegments.length}
                  </span>
                  <h3 className="mt-3 text-lg font-bold">{seg.headline}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-(--color-ink-secondary)">
                    {seg.narrative}
                  </p>
                </div>
                <EChart
                  option={storyOptions[i] ?? (() => ({}))}
                  height={260}
                  ariaLabel={seg.headline}
                />
              </motion.article>
            ))}
          </div>
        </section>
      ) : null}

      {/* 段位与成就 */}
      <section aria-label="段位与成就" className="mt-8 grid gap-4 lg:grid-cols-5">
        <RankBadge tier={rank} className="lg:col-span-2" />
        <div className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-4 shadow-(--shadow-sm) lg:col-span-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Trophy className="size-4 text-(--color-primary)" aria-hidden />
              六维健康雷达
            </h2>
            <span className="text-xs text-(--color-ink-muted)">分数越高越健康</span>
          </div>
          <EChart option={buildRadarOption} height={300} ariaLabel="六维健康雷达图：餐饮、购物、交通、娱乐、居住、其他六个维度的健康分" />
        </div>
      </section>

      {featureFlags.achievements ? (
        <section aria-label="成就墙" className="mt-4">
          <div className="mb-3">
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <Trophy className="size-5 text-(--color-primary)" aria-hidden />
              成就徽章
            </h2>
            <p className="mt-1 text-sm text-(--color-ink-secondary)">
              已解锁 {unlockedIds.length}/{ACHIEVEMENT_DEFS.length} 枚，完成条件即自动解锁
            </p>
          </div>
          <AchievementWall unlockedIds={unlockedIds} compact />
        </section>
      ) : null}

      {/* 海报与导出 */}
      <section aria-label="海报与导出" className="mt-8">
        <div className="rounded-(--radius-xl) border border-(--color-border) bg-(--color-surface) p-5 shadow-(--shadow-sm) md:p-6">
          <h2 className="text-lg font-bold">海报与导出</h2>
          <p className="mt-1 text-sm text-(--color-ink-secondary)">
            生成一张 1080×1920 的年度海报，长按可分享；海报在浏览器本地绘制，不上传任何数据。
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void handlePoster()}
              disabled={posterBusy}
              className="inline-flex min-h-11 items-center gap-2 rounded-full bg-(--color-btn-primary) px-5 text-sm font-medium text-white transition-colors hover:bg-(--color-btn-primary-hover) disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Download className="size-4" aria-hidden />
              {posterBusy ? "生成中…" : "生成年度海报"}
            </button>
            <button
              type="button"
              onClick={() => showToast("PDF 导出即将上线")}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-(--color-border) px-5 text-sm font-medium transition-colors hover:border-(--color-border-strong)"
            >
              <FileText className="size-4" aria-hidden />
              导出 PDF
            </button>
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-xs text-(--color-ink-muted)">
            <CircleCheck className="size-3.5" aria-hidden />
            生成海报会自动解锁「年度海报」成就；PDF 导出将在正式版接入。
          </p>
        </div>
      </section>

      {/* 轻提示：底部居中，不打断操作 */}
      <AnimatePresence>
        {toast ? (
          <div
            key={toast.id}
            className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-4 md:bottom-8"
          >
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.18 }}
              onAnimationComplete={() => {
                window.setTimeout(() => {
                  setToast((current) => (current?.id === toast.id ? null : current));
                }, 2600);
              }}
              className="flex items-center gap-2 rounded-full bg-(--color-ink) px-4 py-2.5 text-sm text-(--color-surface) shadow-(--shadow-lg)"
            >
              {toast.kind === "ok" ? (
                <CircleCheck className="size-4 text-(--color-good)" aria-hidden />
              ) : (
                <CircleX className="size-4 text-(--color-critical)" aria-hidden />
              )}
              {toast.text}
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
    </Container>
  );
}
