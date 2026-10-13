"use client";

import { HardDrive, Pause, Play, RotateCcw, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { CHECKPOINT_KEY, type PausedCheckpoint } from "./types";

/**
 * 断点键读写：03 §1.4 RunStateV1 的轻量前身（{paused, stage, ts}）。
 * 真实管线接入后写方迁移到 pipeline slice，本组件只改 import 不改交互。
 * 隐私模式下 localStorage 会抛异常，全部包 try/catch 静默降级。
 */

export function readPausedCheckpoint(): PausedCheckpoint | null {
  try {
    const raw = localStorage.getItem(CHECKPOINT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PausedCheckpoint>;
    return parsed?.paused === true && typeof parsed.stage === "string"
      ? (parsed as PausedCheckpoint)
      : null;
  } catch {
    return null;
  }
}

export function writePausedCheckpoint(stage: string) {
  try {
    const record: PausedCheckpoint = { paused: true, stage, ts: Date.now() };
    localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(record));
  } catch {
    // 写失败不阻断暂停交互
  }
}

export function clearCheckpoint() {
  try {
    localStorage.removeItem(CHECKPOINT_KEY);
  } catch {
    // 忽略
  }
}

export interface CheckpointBarProps {
  paused: boolean;
  /** 当前阶段 id：随断点一起写入，续跑时定位恢复点 */
  stageId?: string;
  /** 暂停写入的时间戳：展示「保存于 HH:mm:ss」 */
  pausedTs?: number | null;
  onPause: () => void;
  onResume: () => void;
  onRestart: () => void;
}

function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false });
}

/**
 * 断点提示条（05 §2.7）：运行中 [暂停]（二次确认后写断点键）；
 * 暂停态「已暂停 · 进度已保存于本机」+ [继续]（清键续跑）/ [重新开始]（清键重来）。
 */
export function CheckpointBar({
  paused,
  stageId,
  pausedTs,
  onPause,
  onResume,
  onRestart,
}: CheckpointBarProps) {
  const [confirming, setConfirming] = useState(false);

  const confirmPause = () => {
    if (stageId) writePausedCheckpoint(stageId);
    setConfirming(false);
    onPause();
  };

  const resume = () => {
    clearCheckpoint();
    onResume();
  };

  const restart = () => {
    clearCheckpoint();
    setConfirming(false);
    onRestart();
  };

  if (!paused) {
    return (
      <div className="mt-4 flex min-h-14 flex-wrap items-center justify-between gap-3 rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) px-4 py-3 shadow-(--shadow-sm)">
        <p className="flex items-center gap-2 text-sm text-(--color-ink-secondary)">
          <HardDrive className="size-4 shrink-0 text-(--color-ink-muted)" aria-hidden />
          运行中 · 暂停后进度保存在本机
        </p>
        {confirming ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-(--color-warning-ink)">确认暂停本阶段？</span>
            <button
              type="button"
              onClick={confirmPause}
              className="inline-flex h-11 items-center gap-1.5 rounded-full bg-(--color-btn-primary) px-4 text-sm font-medium text-white transition hover:bg-(--color-btn-primary-hover)"
            >
              <Pause className="size-4" aria-hidden />
              确认暂停
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="inline-flex h-11 items-center rounded-full border border-(--color-border) px-4 text-sm font-medium text-(--color-ink-secondary) transition hover:border-(--color-border-strong)"
            >
              取消
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="inline-flex h-11 items-center gap-1.5 rounded-full border border-(--color-border) px-4 text-sm font-medium text-(--color-ink-secondary) transition hover:border-(--color-border-strong)"
          >
            <Pause className="size-4" aria-hidden />
            暂停
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="mt-4 flex min-h-14 flex-wrap items-center justify-between gap-3 rounded-(--radius-lg) border border-(--color-warning)/40 bg-(--color-warn-soft)/60 px-4 py-3">
      <p className="flex items-center gap-2 text-sm text-(--color-warning-ink)">
        <TriangleAlert className="size-4 shrink-0" aria-hidden />
        已暂停 · 进度已保存于本机{pausedTs ? `（${formatClock(pausedTs)}）` : ""}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={resume}
          className="inline-flex h-11 items-center gap-1.5 rounded-full bg-(--color-btn-primary) px-4 text-sm font-medium text-white transition hover:bg-(--color-btn-primary-hover)"
        >
          <Play className="size-4" aria-hidden />
          继续
        </button>
        <button
          type="button"
          onClick={restart}
          className="inline-flex h-11 items-center gap-1.5 rounded-full border border-(--color-border) bg-(--color-surface) px-4 text-sm font-medium text-(--color-ink-secondary) transition hover:border-(--color-border-strong)"
        >
          <RotateCcw className="size-4" aria-hidden />
          重新开始
        </button>
      </div>
    </div>
  );
}
