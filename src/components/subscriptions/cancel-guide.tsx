"use client";

import { Check, Copy, ListChecks } from "lucide-react";
import { useState } from "react";

export interface CancelGuideProps {
  subId: string;
  merchantRef: string;
  ruleId: string;
  amountCents: number;
  /** 周期文案：每月 / 每周，由订阅卡换算后传入 */
  cycleLabel: string;
  /** 预计下次扣费日期 YYYY-MM-DD */
  nextChargeDate: string;
  onToast: (text: string, kind?: "ok" | "error") => void;
}

/** 取消攻略四步：各支付平台通用路径，文案随订阅字段拼装后一键复制 */
const CANCEL_STEPS = [
  "打开对应 App，进入「设置 → 订阅管理 / 自动续费」",
  "关闭自动续费，并截图留存「已关闭」页面",
  "核对最后一期扣费时间与剩余权益，确认不再扣费",
  "若 App 内无入口：支付宝「支付设置 → 免密支付/自动扣款」，或微信「支付 → 扣费服务」解约",
] as const;

const STEP_MARKS = ["①", "②", "③", "④"] as const;
const PROGRESS_KEY = "spendct:cancel-progress:v1";

function loadProgress(): Record<string, number[]> {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const out: Record<string, number[]> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (Array.isArray(value)) {
        out[key] = value.filter((n): n is number => typeof n === "number");
      }
    }
    return out;
  } catch {
    return {};
  }
}

function saveProgress(all: Record<string, number[]>): void {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
  } catch {
    // 隐私模式不可写：勾选进度仅内存态生效
  }
}

/**
 * 取消攻略清单：四步 checkbox + 勾选进度条 + 一键复制操作要点。
 * 勾选进度按订阅持久化（spendct:cancel-progress:v1），刷新后保留，
 * 复制的操作要点把商户标识、规则编号、金额、下次扣费日一并带上，
 * 方便用户在客服/支付渠道对账时直接粘贴。
 */
export function CancelGuide({
  subId,
  merchantRef,
  ruleId,
  amountCents,
  cycleLabel,
  nextChargeDate,
  onToast,
}: CancelGuideProps) {
  const [done, setDone] = useState<number[]>(() => loadProgress()[subId] ?? []);

  const toggleStep = (step: number) => {
    const next = done.includes(step) ? done.filter((s) => s !== step) : [...done, step];
    setDone(next);
    const all = loadProgress();
    all[subId] = next;
    saveProgress(all);
  };

  const copyPlan = async () => {
    const amount = (amountCents / 100).toFixed(2);
    const text = [
      "【SpendCT 订阅取消操作要点】",
      `商户标识：${merchantRef}（${ruleId}）`,
      `单次扣费：¥${amount} / ${cycleLabel}，预计下次扣费 ${nextChargeDate}`,
      ...CANCEL_STEPS.map((step, i) => `${STEP_MARKS[i] ?? ""} ${step}`),
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      onToast("操作要点已复制");
    } catch {
      // 剪贴板 API 不可用（非安全上下文/权限拒绝）：textarea + execCommand 兜底
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        onToast("操作要点已复制");
      } catch {
        onToast("复制失败，请手动选择文本", "error");
      }
    }
  };

  return (
    <div className="rounded-(--radius-md) border border-(--color-border) bg-(--color-surface-page) p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <ListChecks className="size-4 text-(--color-primary)" aria-hidden />
          取消攻略
        </p>
        <p className="text-xs text-(--color-ink-muted) tabular-nums">
          已完成 {done.length}/{CANCEL_STEPS.length} 步
        </p>
      </div>
      <div
        aria-hidden
        className="mt-2 h-1 overflow-hidden rounded-full bg-(--color-surface-2)"
      >
        <div
          className="h-full rounded-full bg-(--color-primary) transition-all"
          style={{ width: `${(done.length / CANCEL_STEPS.length) * 100}%` }}
        />
      </div>

      <ul className="mt-3 flex flex-col gap-1.5">
        {CANCEL_STEPS.map((step, i) => {
          const checked = done.includes(i);
          return (
            <li key={i}>
              {/* 整行可点：触控目标 ≥44px */}
              <button
                type="button"
                onClick={() => toggleStep(i)}
                aria-pressed={checked}
                className={`flex min-h-11 w-full items-start gap-2.5 rounded-(--radius-sm) px-2 py-2 text-left transition-colors ${
                  checked
                    ? "bg-(--color-primary-soft)"
                    : "hover:bg-(--color-surface-2)"
                }`}
              >
                <span
                  aria-hidden
                  className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border transition-colors ${
                    checked
                      ? "border-(--color-primary) bg-(--color-primary) text-white"
                      : "border-(--color-border-strong) bg-(--color-surface)"
                  }`}
                >
                  {checked ? <Check className="size-3" aria-hidden /> : null}
                </span>
                <span
                  className={`text-sm leading-relaxed ${
                    checked ? "text-(--color-ink-secondary)" : "text-(--color-ink)"
                  }`}
                >
                  {step}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={() => void copyPlan()}
        className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full border border-(--color-border) px-4 text-sm font-medium transition-colors hover:border-(--color-border-strong) hover:bg-(--color-surface)"
      >
        <Copy className="size-4" aria-hidden />
        一键复制操作要点
      </button>
    </div>
  );
}
