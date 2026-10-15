"use client";

import { Table2 } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

interface ChartCardProps {
  title: string;
  caption?: string;
  chart: ReactNode;
  table: ReactNode;
}

/**
 * 图表卡：标题 + 数据表切换（05 §3.6 规则 6 的无障碍救济），图表与表格等价表达。
 * 账本汇总与商户统计两个视图共用：图表内容与表格内容由调用方传入，
 * 切换按钮、标题、说明行的样式在此统一。
 */
export function ChartCard({ title, caption, chart, table }: ChartCardProps) {
  const [tableMode, setTableMode] = useState(false);
  return (
    <section className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-4 shadow-(--shadow-sm)">
      <header className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          {caption ? <p className="mt-0.5 text-xs text-(--color-ink-muted)">{caption}</p> : null}
        </div>
        <button
          type="button"
          onClick={() => setTableMode((v) => !v)}
          // 动作按钮而非状态开关：可访问名描述下一次点击的动作（与可见文本一致），
          // 不用 aria-pressed——pressed 表达的是当前状态，与「动作目标」文案互相矛盾
          aria-label={tableMode ? "切换到图表视图" : "切换到数据表视图"}
          className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors ${
            tableMode
              ? "border-(--color-primary)/40 bg-(--color-primary-soft) text-(--color-brand-600)"
              : "border-(--color-border) text-(--color-ink-muted) hover:border-(--color-border-strong) hover:text-(--color-ink-secondary)"
          }`}
        >
          <Table2 className="size-3.5" aria-hidden />
          {tableMode ? "图表" : "数据表"}
        </button>
      </header>
      {tableMode ? table : chart}
    </section>
  );
}
