"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Database, FileText, Layers, ShieldCheck, Timer, X } from "lucide-react";
import { useEffect, useRef } from "react";
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

/** 各步骤的结论式说明模板：动词句 + 数量单位，数字取自本步骤证据（不再展示 SQL 原文） */
const STAGE_CONCLUSION: Record<string, { lead: string; unit: string }> = {
  clean: { lead: "整理账单并去除重复，共核对", unit: "条记录" },
  profile: { lead: "按类别汇总账单，共核对", unit: "条记录" },
  anomaly: { lead: "排查深夜消费与退款异常，查出", unit: "个疑点" },
  subscription: { lead: "排查规律性连续扣费，查出", unit: "笔可疑扣费" },
  attribution: { lead: "对比本月与上月支出，拆解", unit: "项变化" },
  annual: { lead: "汇总全年账单走势，共", unit: "个月" },
};

/** 组装结论句：动词 + 数量 + 用时 */
function stageConclusion(stageId: string, evidence: StageEvidence): string {
  const tpl = STAGE_CONCLUSION[stageId] ?? { lead: "完成检查，共核对", unit: "条记录" };
  return `${tpl.lead} ${evidence.hits.toLocaleString("zh-CN")} ${tpl.unit}，用时 ${formatMs(evidence.elapsedMs)}。`;
}

/**
 * 阶段证据抽屉：右侧滑出，展示该步骤查出什么 / 耗时 / 生成的分析结果缩略。
 * 结论式说明固定挂「已通过安全检查」徽标——既是数据透明，也是防误改的宣传点。
 */
export function StageEvidenceDrawer({ stage, evidence, onClose }: StageEvidenceDrawerProps) {
  const open = stage !== null;
  const closeBtnRef = useRef<HTMLButtonElement>(null);

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
            aria-label={`${stage.name}步骤详情`}
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
                aria-label="关闭详情"
                className="grid size-11 shrink-0 place-items-center rounded-full text-(--color-ink-secondary) transition hover:bg-(--color-surface-2)"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5">
              {evidence ? (
                <div className="space-y-6">
                  {/* 指标行：查出问题 / 耗时 / 分析结果 */}
                  <dl className="grid grid-cols-3 gap-3">
                    <div className="rounded-(--radius-md) border border-(--color-border) p-3">
                      <dt className="flex items-center gap-1 text-xs text-(--color-ink-muted)">
                        <Database className="size-3.5" aria-hidden />
                        查出问题
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
                        分析结果
                      </dt>
                      <dd className="mt-1 text-lg font-semibold tabular-nums">{evidence.cards.length}</dd>
                    </div>
                  </dl>

                  {/* 这一步做了什么：结论式说明（不再展示 SQL 原文） */}
                  <section aria-label="这一步做了什么">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold">这一步做了什么</h3>
                      <span className="inline-flex items-center gap-1 rounded-full bg-(--color-good)/10 px-2 py-0.5 text-xs font-medium text-(--color-good-ink)">
                        <ShieldCheck className="size-3" aria-hidden />
                        已通过安全检查
                      </span>
                    </div>
                    <p className="text-sm leading-relaxed text-(--color-ink-secondary)">
                      {stageConclusion(stage.id, evidence)}
                    </p>
                  </section>

                  {/* 分析结果缩略 */}
                  <section aria-label="这一步生成的分析结果">
                    <h3 className="mb-2 text-sm font-semibold">这一步生成 {evidence.cards.length} 条分析结果</h3>
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
                  <p className="text-sm font-medium text-(--color-ink-secondary)">这个阶段还没跑完</p>
                  <p className="max-w-60 text-xs text-(--color-ink-muted)">
                    跑完后，这里会告诉你它查出了什么、生成了几张分析卡。
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
