"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, Database, FileText, Layers, ShieldCheck, Timer, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { lockBodyScroll, unlockBodyScroll } from "./scroll-lock";
import { formatMs } from "./pipeline-stepper";
import type { StageEvidence, StageState, StageStatus } from "./types";

const STATUS_LABEL: Record<StageStatus, string> = {
  pending: "等待中",
  running: "执行中",
  succeeded: "已完成",
  skipped: "已跳过",
  failed: "失败",
  paused: "已暂停",
};

function StatusChip({ status }: { status: StageStatus }) {
  const tone =
    status === "succeeded"
      ? "bg-(--color-good)/10 text-(--color-good-ink)"
      : status === "running"
        ? "bg-(--color-primary-soft) text-(--color-primary)"
        : status === "failed"
          ? "bg-(--color-critical)/10 text-(--color-critical-ink)"
          : status === "paused"
            ? "bg-(--color-warn-soft) text-(--color-warning-ink)"
            : "bg-(--color-surface-2) text-(--color-ink-secondary)";
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export interface StageEvidenceDrawerProps {
  stage: StageState | null;
  evidence: StageEvidence | null;
  onClose: () => void;
}

/**
 * 阶段证据抽屉：右侧滑出，展示该阶段聚合 SQL 全文 / 命中数 / 耗时 / 产出卡缩略。
 * SQL 是白名单校验通过的聚合产物（07 §6），固定挂「已聚合 · 只读 · 白名单通过」徽标——
 * 既是数据透明，也是防注入的宣传点（05 §2.5）。
 */
export function StageEvidenceDrawer({ stage, evidence, onClose }: StageEvidenceDrawerProps) {
  const open = stage !== null;
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  // 「已复制」与阶段绑定存储：切换阶段时反馈自然失效，无需 effect 复位
  const [copiedFor, setCopiedFor] = useState<string | null>(null);
  const copied = stage !== null && copiedFor === stage.id;

  // Esc 关闭 + 打开时锁定页面滚动并把焦点移入抽屉
  useEffect(() => {
    if (!open) return;
    lockBodyScroll();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    closeBtnRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      unlockBodyScroll();
    };
  }, [open, onClose]);

  const copySql = async () => {
    if (!evidence || !stage) return;
    try {
      await navigator.clipboard.writeText(evidence.sql);
      setCopiedFor(stage.id);
    } catch {
      // 非安全上下文剪贴板可能被拒，静默失败即可
    }
  };

  return (
    <AnimatePresence>
      {open && stage ? (
        <>
          <motion.div
            className="fixed inset-0 z-50 bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            aria-hidden
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label={`${stage.name}阶段证据`}
            className="fixed top-0 right-0 z-50 flex h-full w-full max-w-md flex-col bg-(--color-surface) shadow-(--shadow-lg)"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "tween", duration: 0.22, ease: "easeOut" }}
          >
            {/* 头：阶段名 + 状态 + 关闭 */}
            <div className="flex items-center justify-between gap-3 border-b border-(--color-border) px-5 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <h2 className="truncate text-base font-semibold">{stage.name}</h2>
                <StatusChip status={stage.status} />
              </div>
              <button
                ref={closeBtnRef}
                type="button"
                onClick={onClose}
                aria-label="关闭证据抽屉"
                className="grid size-11 shrink-0 place-items-center rounded-full text-(--color-ink-secondary) transition hover:bg-(--color-surface-2)"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5">
              {evidence ? (
                <div className="space-y-6">
                  {/* 指标行：命中 / 耗时 / 产出卡 */}
                  <dl className="grid grid-cols-3 gap-3">
                    <div className="rounded-(--radius-md) border border-(--color-border) p-3">
                      <dt className="flex items-center gap-1 text-xs text-(--color-ink-muted)">
                        <Database className="size-3.5" aria-hidden />
                        命中
                      </dt>
                      <dd className="mt-1 text-lg font-semibold tabular-nums">
                        {evidence.hits.toLocaleString("zh-CN")}
                      </dd>
                    </div>
                    <div className="rounded-(--radius-md) border border-(--color-border) p-3">
                      <dt className="flex items-center gap-1 text-xs text-(--color-ink-muted)">
                        <Timer className="size-3.5" aria-hidden />
                        耗时
                      </dt>
                      <dd className="mt-1 text-lg font-semibold tabular-nums">
                        {formatMs(evidence.elapsedMs)}
                      </dd>
                    </div>
                    <div className="rounded-(--radius-md) border border-(--color-border) p-3">
                      <dt className="flex items-center gap-1 text-xs text-(--color-ink-muted)">
                        <Layers className="size-3.5" aria-hidden />
                        产出卡
                      </dt>
                      <dd className="mt-1 text-lg font-semibold tabular-nums">{evidence.cards.length}</dd>
                    </div>
                  </dl>

                  {/* SQL 全文 */}
                  <section aria-label="执行 SQL">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold">执行 SQL</h3>
                      <span className="inline-flex items-center gap-1 rounded-full bg-(--color-good)/10 px-2 py-0.5 text-xs font-medium text-(--color-good-ink)">
                        <ShieldCheck className="size-3" aria-hidden />
                        已聚合 · 只读 · 白名单通过
                      </span>
                      <button
                        type="button"
                        onClick={copySql}
                        aria-label={copied ? "已复制 SQL" : "复制 SQL"}
                        className="ml-auto inline-flex h-11 min-w-20 items-center justify-center gap-1.5 rounded-full border border-(--color-border) px-3 text-xs font-medium text-(--color-ink-secondary) transition hover:border-(--color-border-strong)"
                      >
                        {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
                        {copied ? "已复制" : "复制"}
                      </button>
                    </div>
                    <pre className="overflow-x-auto rounded-(--radius-md) bg-(--color-surface-2) p-3 font-(--font-mono) text-xs leading-relaxed whitespace-pre-wrap break-words text-(--color-ink)">
                      {evidence.sql}
                    </pre>
                  </section>

                  {/* 产出卡缩略 */}
                  <section aria-label="本阶段产出">
                    <h3 className="mb-2 text-sm font-semibold">本阶段产出 {evidence.cards.length} 张卡</h3>
                    <ul className="space-y-2">
                      {evidence.cards.map((card) => (
                        <li
                          key={card.title}
                          className="flex items-start gap-2.5 rounded-(--radius-md) border border-(--color-border) px-3 py-2.5"
                        >
                          <FileText className="mt-0.5 size-4 shrink-0 text-(--color-ink-muted)" aria-hidden />
                          <span className="min-w-0 flex-1 text-sm leading-snug">{card.title}</span>
                          {!card.ok ? (
                            <span className="shrink-0 rounded-full bg-(--color-warn-soft) px-2 py-0.5 text-xs font-medium text-(--color-warning-ink)">
                              待确认
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </section>
                </div>
              ) : (
                <div className="flex h-full min-h-48 flex-col items-center justify-center gap-2 text-center">
                  <Database className="size-8 text-(--color-ink-muted)" aria-hidden />
                  <p className="text-sm font-medium text-(--color-ink-secondary)">该阶段尚未产出证据</p>
                  <p className="max-w-60 text-xs text-(--color-ink-muted)">
                    阶段完成后，这里会展示聚合 SQL、命中数与产出卡清单。
                  </p>
                </div>
              )}
            </div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}
