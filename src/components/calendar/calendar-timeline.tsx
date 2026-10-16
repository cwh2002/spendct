"use client";

import { Moon, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { formatYuan } from "@/components/charts/option-builders";
import {
  filterTimelineRows,
  formatTsToSeconds,
  isNightDate,
  type CalendarTimelineRow,
  type TimelineDirectionFilter,
} from "@/lib/insights/calendar-aggregate";

interface CalendarTimelineProps {
  /** 已装载的流水行（时间倒序；真实动线为分页累加，演示动线为整批示例行） */
  rows: CalendarTimelineRow[];
  /** 数据来源：true = 真实账单流水，false = 内置示例数据 */
  real: boolean;
  /** 真实流水首屏查询中（占位提示，不伪造内容） */
  loading: boolean;
  /** 「加载更多」请求进行中（按钮转禁用态防重复点击） */
  loadingMore: boolean;
  /** 上一页取满整页 → 后面可能还有行（未到展示上限时才提供按钮） */
  hasMore: boolean;
  /** 累计已到展示上限（3,000 笔）：不再提供「加载更多」，引导去追问面板按需提问 */
  reachedMax: boolean;
  /** 加载下一页（OFFSET = 已装载行数，由父组件直连查询） */
  onLoadMore(): void;
}

/** 方向筛选档位：全部 / 支出 / 收入（筛选与流水行 direction 字段同口径） */
const DIRECTION_OPTIONS: { key: TimelineDirectionFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "expense", label: "支出" },
  { key: "income", label: "收入" },
];

/** 方向 → 徽标文案（CalendarTimelineRow.direction 仅两种取值） */
const DIRECTION_LABELS: Record<CalendarTimelineRow["direction"], string> = {
  expense: "支出",
  income: "收入",
};

/**
 * 消费日历的时间轴流水（A15 第四部分）：
 * 每笔消费一行——时间精确到秒、类目、商户、金额、方向徽标与深夜徽标
 * （23:00-05:00，07 §3 唯一深夜语义）。搜索框（商户/类目关键字）与方向
 * 筛选均为客户端过滤，不重新查库；分页「加载更多」由父组件直连 DuckDB
 * 追加（累计 3,000 笔后显示展示上限提示）。
 */
export function CalendarTimeline({
  rows,
  real,
  loading,
  loadingMore,
  hasMore,
  reachedMax,
  onLoadMore,
}: CalendarTimelineProps) {
  const [query, setQuery] = useState("");
  const [direction, setDirection] = useState<TimelineDirectionFilter>("all");

  // 客户端过滤：关键字同时匹配商户名与类目，方向档位精确匹配（纯函数见 calendar-aggregate）
  const visible = useMemo(
    () => filterTimelineRows(rows, { query, direction }),
    [rows, query, direction],
  );

  const filtersDirty = query.trim() !== "" || direction !== "all";

  return (
    <div className="overflow-hidden rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) shadow-(--shadow-sm)">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-(--color-border) px-4 py-3">
        <div>
          <h2 className="text-base font-semibold">逐笔流水</h2>
          <p className="mt-0.5 text-xs text-(--color-ink-muted)">
            {loading
              ? "正在读取账单流水…"
              : real
                ? `你的账单流水 · 已加载 ${rows.length} 笔${visible.length !== rows.length ? `（筛选后 ${visible.length} 笔）` : ""}`
                : `内置数据 · 共 ${rows.length} 笔演示流水${visible.length !== rows.length ? `（筛选后 ${visible.length} 笔）` : ""}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-(--color-ink-muted)"
              aria-hidden
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索商户 / 类目"
              aria-label="搜索流水"
              className="h-11 w-44 rounded-full border border-(--color-border) bg-(--color-surface) pl-10 pr-4 text-sm text-(--color-ink) placeholder:text-(--color-ink-muted) transition-colors hover:border-(--color-border-strong) sm:w-56"
            />
          </div>
          <div role="group" aria-label="方向筛选" className="flex gap-1.5">
            {DIRECTION_OPTIONS.map((option) => {
              const active = direction === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setDirection(option.key)}
                  aria-pressed={active}
                  className={`h-11 rounded-full border px-3.5 text-sm font-medium transition-colors ${
                    active
                      ? "border-(--color-primary) bg-(--color-primary-soft) text-(--color-brand-600)"
                      : "border-(--color-border) bg-(--color-surface) text-(--color-ink-secondary) hover:border-(--color-border-strong) hover:text-(--color-ink)"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {loading ? (
        // 真实流水首屏查询中：占位不伪造内容（与订阅视图加载态同口径）
        <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
          <p className="text-sm font-medium">正在读取账单流水…</p>
          <p className="text-xs text-(--color-ink-secondary)">从你本次体检的结果里逐笔整理，通常几秒钟就好</p>
        </div>
      ) : (
        <>
          <div className="max-h-[480px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-(--color-surface)">
                <tr className="border-b border-(--color-border) text-left text-xs text-(--color-ink-muted)">
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    时间
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    类目
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    商户
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">
                    金额（元）
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    方向
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    深夜
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.id} className="border-b border-(--color-border) last:border-0 hover:bg-(--color-surface-2)">
                    <td className="px-4 py-2.5 font-mono text-xs tabular-nums text-(--color-ink-secondary)">
                      {formatTsToSeconds(row.ts)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="rounded-full bg-(--color-surface-2) px-2 py-0.5 text-xs text-(--color-ink-secondary)">
                        {row.category}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">{row.merchant}</td>
                    <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                      ¥{formatYuan(row.amountCents)}
                    </td>
                    <td className="px-4 py-2.5">
                      {row.direction === "expense" ? (
                        <span className="rounded-full bg-(--color-critical)/10 px-2 py-0.5 text-xs font-medium text-(--color-critical-ink)">
                          {DIRECTION_LABELS.expense}
                        </span>
                      ) : (
                        <span className="rounded-full bg-(--color-good)/10 px-2 py-0.5 text-xs font-medium text-(--color-good-ink)">
                          {DIRECTION_LABELS.income}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {isNightDate(row.ts) ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-(--color-warning)/15 px-2 py-0.5 text-xs text-(--color-warning-ink)">
                          <Moon className="size-3" aria-hidden />
                          深夜
                        </span>
                      ) : (
                        <span className="text-xs text-(--color-ink-muted)">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {visible.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
                <p className="text-sm font-medium">没有匹配的流水</p>
                <p className="text-xs text-(--color-ink-secondary)">换个关键词试试，或放宽方向筛选</p>
                {filtersDirty ? (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      setDirection("all");
                    }}
                    className="h-10 rounded-full border border-(--color-border) bg-(--color-surface) px-4 text-sm font-medium text-(--color-ink-secondary) transition-colors hover:border-(--color-border-strong)"
                  >
                    清除筛选
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* 分页脚：展示上限 → 提示去追问；还有更多 → 加载更多按钮；两者皆无时不渲染空条 */}
          {reachedMax || hasMore ? (
            <div className="flex items-center justify-center border-t border-(--color-border) px-4 py-3">
              {reachedMax ? (
                <p className="text-xs text-(--color-ink-muted)">
                  已达展示上限，可在追问面板提问任意一笔
                </p>
              ) : (
                <button
                  type="button"
                  onClick={onLoadMore}
                  disabled={loadingMore}
                  className="h-10 rounded-full border border-(--color-border) bg-(--color-surface) px-5 text-sm font-medium text-(--color-ink-secondary) transition-colors hover:border-(--color-border-strong) hover:text-(--color-ink) disabled:opacity-60"
                >
                  {loadingMore ? "加载中…" : "加载更多"}
                </button>
              )}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
