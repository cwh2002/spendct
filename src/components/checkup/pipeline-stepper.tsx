"use client";

import { Check, ChevronRight, CirclePause, X } from "lucide-react";
import type { StageState, StageStatus } from "./types";

/** 耗时展示：不足 1s 显示毫秒，超过显示秒（保留 1 位） */
export function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function StatusDot({ status }: { status: StageStatus }) {
  switch (status) {
    case "running":
      return (
        <span
          aria-hidden
          className="grid size-6 shrink-0 place-items-center rounded-full border-2 border-(--color-primary) bg-(--color-primary-soft)"
        >
          <span className="size-2 animate-pulse rounded-full bg-(--color-primary)" />
        </span>
      );
    case "succeeded":
      return (
        <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full bg-(--color-good)">
          <Check className="size-3.5 text-white" strokeWidth={3.5} />
        </span>
      );
    case "failed":
      return (
        <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full bg-(--color-critical)">
          <X className="size-3.5 text-white" strokeWidth={3.5} />
        </span>
      );
    case "paused":
      return (
        <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full bg-(--color-warning)">
          <CirclePause className="size-3.5 text-white" fill="currentColor" strokeWidth={0} />
        </span>
      );
    case "skipped":
      return (
        <span
          aria-hidden
          className="grid size-6 shrink-0 place-items-center rounded-full border border-(--color-border) text-xs leading-none text-(--color-ink-muted)"
        >
          –
        </span>
      );
    default:
      return (
        <span
          aria-hidden
          className="size-6 shrink-0 rounded-full border-2 border-(--color-border) bg-(--color-surface)"
        />
      );
  }
}

/** 阶段卡摘要行：各状态展示口径固定，数字一律 tabular-nums */
function StageSummary({ stage }: { stage: StageState }) {
  switch (stage.status) {
    case "running":
      return (
        <p className="mt-1.5 flex items-center gap-1.5 text-sm text-(--color-ink-secondary)">
          <span className="size-1.5 animate-pulse rounded-full bg-(--color-primary)" aria-hidden />
          执行中…
        </p>
      );
    case "succeeded":
      return (
        <p className="mt-1.5 text-sm tabular-nums text-(--color-ink-secondary)">
          产出 {stage.cards} 张卡 · {formatMs(stage.elapsedMs)}
        </p>
      );
    case "paused":
      return <p className="mt-1.5 text-sm text-(--color-warning-ink)">已暂停 · 进度已保存于本机</p>;
    case "failed":
      return <p className="mt-1.5 text-sm text-(--color-critical-ink)">阶段失败 · 点开查看详情</p>;
    case "skipped":
      return <p className="mt-1.5 text-sm text-(--color-ink-muted)">已跳过</p>;
    default:
      return null;
  }
}

export interface PipelineStepperProps {
  stages: StageState[];
  /** 点击阶段卡展开证据抽屉；顺序执行，不支持跳转（05 §2.7） */
  onStageClick?: (stage: StageState) => void;
}

/**
 * 六阶段垂直步骤卡：状态圆点 + 2px 连接线 + 阶段名 + 产出摘要。
 * 整卡为点击目标（高度 ≥44px 触控约束），paused 是 UI 局部覆盖态。
 */
export function PipelineStepper({ stages, onStageClick }: PipelineStepperProps) {
  return (
    <ol aria-label="体检六阶段" className="flex flex-col gap-3">
      {stages.map((stage, i) => {
        const isLast = i === stages.length - 1;
        const skipped = stage.status === "skipped";
        return (
          <li key={stage.id} className="flex gap-3">
            {/* 左轨：状态圆点 + 连接线 */}
            <div className="flex w-6 shrink-0 flex-col items-center">
              <StatusDot status={stage.status} />
              {!isLast ? (
                <span aria-hidden className="mt-1 w-0.5 flex-1 rounded-full bg-(--color-border)" />
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => onStageClick?.(stage)}
              aria-label={`${stage.name}阶段详情`}
              aria-current={stage.status === "running" ? "step" : undefined}
              className={`mb-3 flex min-h-16 w-full items-center justify-between gap-3 rounded-(--radius-lg) border bg-(--color-surface) p-4 text-left shadow-(--shadow-sm) transition ${
                stage.status === "running"
                  ? "border-(--color-primary)/40 shadow-(--shadow-md)"
                  : "border-(--color-border) hover:border-(--color-border-strong) hover:shadow-(--shadow-md)"
              }`}
            >
              <span className="min-w-0">
                <span className="flex items-baseline gap-2">
                  <span className="text-xs font-semibold tabular-nums text-(--color-ink-muted)">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span
                    className={`font-semibold ${skipped ? "text-(--color-ink-muted) line-through" : ""}`}
                  >
                    {stage.name}
                  </span>
                </span>
                <StageSummary stage={stage} />
              </span>
              <ChevronRight
                className="size-4 shrink-0 text-(--color-ink-muted)"
                aria-hidden
              />
            </button>
          </li>
        );
      })}
    </ol>
  );
}
