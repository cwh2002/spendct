"use client";

import { CalendarDays } from "lucide-react";
import { useMemo } from "react";
import { EChart } from "@/components/charts/e-chart";
import {
  buildCalendarHeatmapOption,
  formatYuan,
} from "@/components/charts/option-builders";
import { ChartCard } from "@/components/insights/chart-card";
import type { DailyCents } from "@/lib/insights/calendar-aggregate";

interface CalendarHeatmapProps {
  /** 每日支出点（日期升序）；为空时渲染空态提示，不画图 */
  points: DailyCents[];
  /** 数据来源：true = 真实账单聚合，false = 内置示例数据（决定说明行文案） */
  real: boolean;
}

/**
 * 消费日历的每日支出热力图卡（A15 第四部分）：
 * ECharts calendar 坐标系 heatmap，每个日期格子的颜色深浅 = 当日支出金额
 * 高低，分段图例按金额档标注（小额日常消费细分多档），图下附口径说明
 * 「颜色越深花得越多」。数据表视图（ChartCard 无障碍救济）按日期列出
 * 每日支出，与色块等价表达。
 */
export function CalendarHeatmap({ points, real }: CalendarHeatmapProps) {
  // 数据点 → 构造器入参（分刻度原样传入，展示换算交给 formatValue）
  const heatmapOption = useMemo(
    () => () =>
      buildCalendarHeatmapOption(
        points.map((p) => ({ date: p.date, value: p.cents })),
        { formatValue: (v) => `¥${formatYuan(v)}` },
      ),
    [points],
  );

  const totalCents = useMemo(() => points.reduce((sum, p) => sum + p.cents, 0), [points]);

  return (
    <ChartCard
      title="每日支出热力图"
      caption={
        real
          ? `${points.length} 个有支出的日子 · 来自你的账单`
          : `${points.length} 个有支出的日子 · 内置数据`
      }
      chart={
        points.length > 0 ? (
          <div>
            <EChart option={heatmapOption} height={240} ariaLabel="消费日历热力图" />
            <p className="mt-2 text-xs text-(--color-ink-muted)">
              颜色越深花得越多：图例按金额分档着色，几十到几百元的小额日常支出也细分多档，深浅差异一目了然
            </p>
          </div>
        ) : (
          <div className="flex h-[240px] flex-col items-center justify-center gap-2 rounded-(--radius-md) border border-dashed border-(--color-border-strong) text-center">
            <CalendarDays className="size-6 text-(--color-ink-muted)" aria-hidden />
            <p className="text-sm font-medium">这段时间没有支出记录</p>
            <p className="text-xs text-(--color-ink-secondary)">
              热力图只统计已支付的支出，导入账单后再来看看
            </p>
          </div>
        )
      }
      table={
        <div className="max-h-[240px] overflow-y-auto rounded-(--radius-md) border border-(--color-border)">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-(--color-surface)">
              <tr className="border-b border-(--color-border) text-left text-xs text-(--color-ink-muted)">
                <th scope="col" className="px-3 py-2 font-medium">
                  日期
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  支出（元）
                </th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.date} className="border-b border-(--color-border) last:border-0 hover:bg-(--color-surface-2)">
                  <td className="px-3 py-1.5 tabular-nums text-(--color-ink-secondary)">{p.date}</td>
                  <td className="px-3 py-1.5 text-right font-medium tabular-nums">¥{formatYuan(p.cents)}</td>
                </tr>
              ))}
              {points.length > 0 ? (
                <tr className="bg-(--color-surface-2)/60">
                  <td className="px-3 py-2 font-medium">合计</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">¥{formatYuan(totalCents)}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
          {points.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <p className="text-sm font-medium">没有支出记录</p>
              <p className="text-xs text-(--color-ink-secondary)">导入账单并跑完体检后，这里会按天列出支出</p>
            </div>
          ) : null}
        </div>
      }
    />
  );
}
