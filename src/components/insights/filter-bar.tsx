"use client";

import { ChevronDown, ListFilter, RotateCcw } from "lucide-react";
import { useMemo } from "react";
import type { DemoInsight, DemoStage } from "@/lib/demo-data";

export type DateRangeKey = "all" | "7d" | "30d" | "90d" | "month";

export interface InsightFilters {
  /** "all" 或六阶段之一的 stageId */
  stage: string;
  /** 显示低置信度（≤2 档）卡；关闭后只剩 3–4 档高置信卡 */
  showLow: boolean;
  range: DateRangeKey;
  /** "all" 或演示类别名 */
  category: string;
}

export const DEFAULT_INSIGHT_FILTERS: InsightFilters = {
  stage: "all",
  showLow: true,
  range: "all",
  category: "all",
};

export const INSIGHT_CATEGORIES = ["餐饮", "购物", "交通", "娱乐", "居住", "其他", "订阅"] as const;

const DATE_RANGES: { key: DateRangeKey; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "7d", label: "近 7 天" },
  { key: "30d", label: "近 30 天" },
  { key: "90d", label: "近 90 天" },
  { key: "month", label: "本月" },
];

/**
 * DEMO_INSIGHTS 没有类别与发布时间字段，筛选要真实生效就补一张本地映射表：
 * 正式管线接入后这两列来自 DuckDB 聚合结果，本表随演示数据一起退役。
 */
const DEMO_INSIGHT_META: Record<string, { category: string; publishedDaysAgo: number }> = {
  "ins-1": { category: "餐饮", publishedDaysAgo: 6 },
  "ins-2": { category: "娱乐", publishedDaysAgo: 2 },
  "ins-3": { category: "订阅", publishedDaysAgo: 9 },
  "ins-4": { category: "购物", publishedDaysAgo: 18 },
  "ins-5": { category: "餐饮", publishedDaysAgo: 60 },
  "ins-6": { category: "购物", publishedDaysAgo: 12 },
};

/** 四维筛选（阶段 / 置信度 / 日期 / 类别）的真实过滤逻辑，页面与收藏夹共用 */
export function applyInsightFilters(insights: DemoInsight[], filters: InsightFilters): DemoInsight[] {
  return insights.filter((insight) => {
    if (filters.stage !== "all" && insight.stageId !== filters.stage) return false;
    if (!filters.showLow && insight.confidence <= 2) return false;
    const meta = DEMO_INSIGHT_META[insight.id];
    if (filters.category !== "all" && meta?.category !== filters.category) return false;
    if (filters.range !== "all") {
      const daysAgo = meta?.publishedDaysAgo ?? 0;
      if (filters.range === "7d" && daysAgo > 7) return false;
      if (filters.range === "30d" && daysAgo > 30) return false;
      if (filters.range === "90d" && daysAgo > 90) return false;
      // 「本月」= 发布日期落在当前日历月内（demo 数据锚定今天前 N 天）
      if (filters.range === "month" && daysAgo > new Date().getDate() - 1) return false;
    }
    return true;
  });
}

interface FilterBarProps {
  value: InsightFilters;
  onChange(next: InsightFilters): void;
  stages: readonly DemoStage[];
  resultCount: number;
}

const chipBase =
  "h-11 rounded-full border px-3.5 text-sm font-medium transition-colors";
const chipActive =
  "border-(--color-primary) bg-(--color-primary-soft) text-(--color-brand-600)";
const chipIdle =
  "border-(--color-border) bg-(--color-surface) text-(--color-ink-secondary) hover:border-(--color-border-strong) hover:text-(--color-ink)";

/**
 * 洞察卡流筛选行（05 §1.5 InsightFilterBar）：
 * 阶段 chips + 日期预设 + 类别下拉 + 低置信度开关，筛选即时生效。
 */
export function FilterBar({ value, onChange, stages, resultCount }: FilterBarProps) {
  const dirty = useMemo(
    () =>
      value.stage !== "all" ||
      value.showLow !== true ||
      value.range !== "all" ||
      value.category !== "all",
    [value],
  );

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2" aria-label="洞察筛选">
      <span className="flex items-center gap-1.5 text-xs font-medium text-(--color-ink-muted)">
        <ListFilter className="size-3.5" aria-hidden />
        筛选
      </span>

      <div role="group" aria-label="按体检阶段筛选" className="flex flex-wrap items-center gap-1.5">
        {[{ id: "all", name: "全部" }, ...stages].map((stage) => {
          const active = value.stage === stage.id;
          return (
            <button
              key={stage.id}
              type="button"
              onClick={() => onChange({ ...value, stage: stage.id })}
              aria-pressed={active}
              className={`${chipBase} ${active ? chipActive : chipIdle}`}
            >
              {stage.name}
            </button>
          );
        })}
      </div>

      <span className="hidden h-5 w-px bg-(--color-border) sm:block" aria-hidden />

      <div role="group" aria-label="按日期范围筛选" className="flex flex-wrap items-center gap-1.5">
        {DATE_RANGES.map((range) => {
          const active = value.range === range.key;
          return (
            <button
              key={range.key}
              type="button"
              onClick={() => onChange({ ...value, range: range.key })}
              aria-pressed={active}
              className={`${chipBase} ${active ? chipActive : chipIdle}`}
            >
              {range.label}
            </button>
          );
        })}
      </div>

      <div className="relative">
        <select
          value={value.category}
          onChange={(e) => onChange({ ...value, category: e.target.value })}
          aria-label="按类别筛选"
          className="h-11 appearance-none rounded-(--radius-md) border border-(--color-border) bg-(--color-surface) pl-3.5 pr-9 text-sm text-(--color-ink) transition-colors hover:border-(--color-border-strong)"
        >
          <option value="all">全部类别</option>
          {INSIGHT_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-(--color-ink-muted)"
          aria-hidden
        />
      </div>

      <label className="relative flex h-11 cursor-pointer items-center gap-2.5 rounded-full border border-(--color-border) bg-(--color-surface) px-3.5 text-sm text-(--color-ink-secondary) transition-colors hover:border-(--color-border-strong)">
        {/* 不可见但全尺寸的 checkbox：指针事件落在真实控件上（可自动化测试），
            键盘焦点环经 peer-focus-visible 投到视觉 track 上；peer-checked 驱动变色 */}
        <input
          type="checkbox"
          role="switch"
          checked={value.showLow}
          onChange={(e) => onChange({ ...value, showLow: e.target.checked })}
          className="peer absolute left-3.5 top-1/2 z-10 h-11 w-9 -translate-y-1/2 cursor-pointer opacity-0 focus-visible:outline-none"
        />
        <span
          aria-hidden
          className="relative h-5 w-9 rounded-full bg-(--color-border-strong) transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:bg-(--color-primary) peer-checked:after:translate-x-4 peer-focus-visible:outline-2 peer-focus-visible:outline-(--color-brand-600)"
        />
        显示低置信度
      </label>

      {dirty ? (
        <button
          type="button"
          onClick={() => onChange(DEFAULT_INSIGHT_FILTERS)}
          className="flex h-11 items-center gap-1.5 rounded-full px-3.5 text-sm text-(--color-ink-muted) transition-colors hover:text-(--color-ink-secondary)"
        >
          <RotateCcw className="size-3.5" aria-hidden />
          重置
        </button>
      ) : null}

      <span className="ml-auto text-xs text-(--color-ink-muted) tabular-nums">
        {resultCount} 张洞察卡
      </span>
    </div>
  );
}
