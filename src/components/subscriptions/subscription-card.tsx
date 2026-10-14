"use client";

import {
  Activity,
  Bell,
  BellRing,
  CalendarClock,
  Check,
  Flag,
  Repeat,
} from "lucide-react";
import { useMemo, useState } from "react";

import type { DemoSubscription } from "@/lib/demo-data";

import { CancelGuide } from "./cancel-guide";
import { ChargeSparkline } from "./charge-sparkline";

const NOTIF_KEY = "spendct:notif:v1";
const LABEL_KEY = "spendct:sub-labels";

type SubLabel = "confirm" | "false-positive";

interface NotifRecord {
  id: string;
  merchantRef: string;
  nextChargeDate: string;
  amountCents: number;
  createdAt: number;
}

/** 周期展示文案：徽标用短文案（月/周），攻略与提醒用完整文案（每月/每周） */
const CYCLE_META = {
  daily: { short: "日", full: "每天" },
  weekly: { short: "周", full: "每周" },
  monthly: { short: "月", full: "每月" },
  yearly: { short: "年", full: "每年" },
} as const;

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 隐私模式不可写：仅内存态生效
  }
}

function fmtYuan(cents: number): string {
  return (cents / 100).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 按周期外推一天扣费日。跨月用「目标月末日截断」避免 1/31 + 1 月溢出到 3 月 */
function addCycle(date: Date, cycle: DemoSubscription["cycle"]): Date {
  const d = new Date(date);
  if (cycle === "daily") {
    d.setDate(d.getDate() + 1);
    return d;
  }
  if (cycle === "weekly") {
    d.setDate(d.getDate() + 7);
    return d;
  }
  if (cycle === "monthly") {
    const targetMonth = d.getMonth() + 1;
    const probe = new Date(d.getFullYear(), targetMonth, 1);
    const lastDay = new Date(probe.getFullYear(), probe.getMonth() + 1, 0).getDate();
    d.setMonth(targetMonth, Math.min(d.getDate(), lastDay));
    return d;
  }
  // yearly：2 月 29 日回落到 2 月 28 日
  const probe = new Date(d.getFullYear() + 1, d.getMonth(), 1);
  const lastDay = new Date(probe.getFullYear(), probe.getMonth() + 1, 0).getDate();
  d.setFullYear(d.getFullYear() + 1, d.getMonth(), Math.min(d.getDate(), lastDay));
  return d;
}

export interface SubscriptionCardProps {
  sub: DemoSubscription;
  /** 商户占位名：原始商户名已打码，由页面按卡片顺序生成「商户 A」式称呼 */
  merchantLabel: string;
  onToast: (text: string, kind?: "ok" | "error") => void;
}

/**
 * 订阅卡：商户名（已打码）+ 周期徽标 + 下次扣费倒计时（按真实当天
 * 从 lastChargeDate 按周期外推计算，不信任演示数据里的静态天数）+ 扣费轨迹
 * sparkline + 取消攻略 + 提醒/标记操作。
 */
export function SubscriptionCard({ sub, merchantLabel, onToast }: SubscriptionCardProps) {
  const cycleMeta = CYCLE_META[sub.cycle];

  // 下次扣费日：从最近扣费日按周期外推至 >= 今天；倒计时天数随之真实计算
  const { nextDate, daysLeft } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let next = new Date(`${sub.lastChargeDate}T00:00:00`);
    let guard = 0;
    while (next < today && guard < 64) {
      next = addCycle(next, sub.cycle);
      guard++;
    }
    const days = Math.round((next.getTime() - today.getTime()) / 86_400_000);
    return { nextDate: next, daysLeft: days };
  }, [sub.cycle, sub.lastChargeDate]);

  // 沉默订阅口径：相邻扣费间隔超过 90 天视为长时间无使用（与洞察卡叙事一致）
  const isSilent = useMemo(() => {
    const times = sub.charges.map((c) => new Date(`${c.date}T00:00:00`).getTime());
    for (let i = 1; i < times.length; i++) {
      if ((times[i]! - times[i - 1]!) / 86_400_000 > 90) return true;
    }
    return false;
  }, [sub.charges]);

  // 倒计时徽标三档：≤7 天红 / ≤14 天黄 / 其余灰
  const tone =
    daysLeft <= 7 ? "critical" : daysLeft <= 14 ? "warning" : "neutral";
  const toneClass = {
    critical: "bg-(--color-critical)/10 text-(--color-critical-ink) dark:text-(--color-critical)",
    warning: "bg-(--color-warning)/15 text-(--color-warning-ink) dark:text-(--color-warning)",
    neutral: "bg-(--color-surface-2) text-(--color-ink-secondary)",
  }[tone];

  const [reminded, setReminded] = useState<boolean>(() =>
    loadJson<NotifRecord[]>(NOTIF_KEY, []).some((n) => n.id === sub.id),
  );

  const toggleReminder = () => {
    const all = loadJson<NotifRecord[]>(NOTIF_KEY, []);
    const next = reminded
      ? all.filter((n) => n.id !== sub.id)
      : [
          ...all,
          {
            id: sub.id,
            merchantRef: sub.merchantRef,
            nextChargeDate: fmtDate(nextDate),
            amountCents: sub.amountCents,
            createdAt: Date.now(),
          },
        ];
    saveJson(NOTIF_KEY, next);
    setReminded(!reminded);
    onToast(reminded ? "已取消提醒" : "已设扣费提醒");
  };

  const [label, setLabel] = useState<SubLabel | null>(() =>
    loadJson<Record<string, SubLabel>>(LABEL_KEY, {})[sub.id] ?? null,
  );

  const markLabel = (next: SubLabel) => {
    const all = loadJson<Record<string, SubLabel>>(LABEL_KEY, {});
    const target = label === next ? null : next;
    if (target) all[sub.id] = target;
    else delete all[sub.id];
    saveJson(LABEL_KEY, all);
    setLabel(target);
    if (target === "confirm") onToast("已标记「是订阅」");
    else if (target === "false-positive") onToast("已标记「误报」");
    else onToast("已取消标记");
  };

  return (
    <article className="flex flex-col gap-4 rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-5 shadow-(--shadow-sm)">
      {/* 头行：商户名（已打码）+ 周期徽标 + 倒计时徽标 */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{merchantLabel}</span>
          <span className="inline-flex items-center gap-1 rounded-full border border-(--color-border) px-2 py-0.5 text-[11px] text-(--color-ink-secondary)">
            <Repeat className="size-3" aria-hidden />
            {cycleMeta.short}
          </span>
          {isSilent ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-(--color-warning)/15 px-2 py-0.5 text-[11px] font-medium text-(--color-warning-ink) dark:text-(--color-warning)">
              <BellRing className="size-3" aria-hidden />
              疑似沉默订阅
            </span>
          ) : null}
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium tabular-nums ${toneClass}`}
        >
          <CalendarClock className="size-3.5" aria-hidden />
          {daysLeft === 0 ? "今天扣费" : `距离下次扣费 ${daysLeft} 天`}
        </span>
      </div>

      {/* 金额行：单次 + 周期 + 近一年累计 */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-2xl font-bold tabular-nums">¥{fmtYuan(sub.amountCents)}</span>
        <span className="text-sm text-(--color-ink-secondary)">/ {cycleMeta.full}</span>
        <span className="text-sm text-(--color-ink-muted) tabular-nums">
          近一年合计 ¥{fmtYuan(sub.totalYearCents)} · 轨迹 {sub.charges.length} 笔
        </span>
      </div>

      {/* 扣费轨迹 */}
      <div>
        <p className="mb-1.5 flex items-center gap-1.5 text-xs text-(--color-ink-secondary)">
          <Activity className="size-3.5" aria-hidden />
          扣费轨迹
        </p>
        <ChargeSparkline charges={sub.charges} />
      </div>

      {/* 标记状态条：反馈的去向在页面下方说明 */}
      {label === "confirm" ? (
        <p className="flex items-center gap-1.5 rounded-(--radius-sm) bg-(--color-good)/10 px-3 py-2 text-xs font-medium text-(--color-good-ink) dark:text-(--color-good)">
          <Check className="size-3.5" aria-hidden />
          已标记为订阅，谢谢你的反馈！
        </p>
      ) : null}
      {label === "false-positive" ? (
        <p className="flex items-center gap-1.5 rounded-(--radius-sm) bg-(--color-critical)/10 px-3 py-2 text-xs font-medium text-(--color-critical-ink) dark:text-(--color-critical)">
          <Flag className="size-3.5" aria-hidden />
          已标记为误报，我们会减少对这类扣费的打扰
        </p>
      ) : null}

      <CancelGuide
        subId={sub.id}
        amountCents={sub.amountCents}
        cycleLabel={cycleMeta.full}
        nextChargeDate={fmtDate(nextDate)}
        onToast={onToast}
      />

      {/* 操作行：提醒 + 标记 */}
      <div className="flex flex-wrap items-center gap-2 border-t border-(--color-border) pt-4">
        <button
          type="button"
          onClick={toggleReminder}
          aria-pressed={reminded}
          className={`inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition-colors ${
            reminded
              ? "bg-(--color-primary-soft) text-(--color-brand-600)"
              : "border border-(--color-border) hover:border-(--color-border-strong)"
          }`}
        >
          {reminded ? <BellRing className="size-4" aria-hidden /> : <Bell className="size-4" aria-hidden />}
          {reminded ? `已设提醒 · ${fmtDate(nextDate)}` : "设为提醒"}
        </button>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => markLabel("confirm")}
            aria-pressed={label === "confirm"}
            className={`inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-sm font-medium transition-colors ${
              label === "confirm"
                ? "bg-(--color-good)/15 text-(--color-good-ink) dark:text-(--color-good)"
                : "border border-(--color-border) text-(--color-ink-secondary) hover:border-(--color-border-strong)"
            }`}
          >
            <Check className="size-4" aria-hidden />
            是订阅
          </button>
          <button
            type="button"
            onClick={() => markLabel("false-positive")}
            aria-pressed={label === "false-positive"}
            className={`inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-sm font-medium transition-colors ${
              label === "false-positive"
                ? "bg-(--color-critical)/10 text-(--color-critical-ink) dark:text-(--color-critical)"
                : "border border-(--color-border) text-(--color-ink-secondary) hover:border-(--color-border-strong)"
            }`}
          >
            <Flag className="size-4" aria-hidden />
            误报
          </button>
        </div>
      </div>
    </article>
  );
}
