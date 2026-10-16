"use client";

/**
 * 攒钱目标中心（修订案 A17）主视图。
 *
 * 玩法：立一个目标（名称 + 金额 + 目标月），按月存入，页面用「预计月结余」
 * 估算还需几个月达成，并给出「每月需存多少、从哪个类目省」的加速建议。
 *
 * 数据动线（真实优先 + demo 兜底）：
 * - 有体检结果：GOALS_MONTHLY_SQL / GOALS_CATEGORY_SQL / GOALS_ACTIVE_MONTHS_SQL
 *   三条确定性聚合并行执行，结余按「最近 6 个月有收入月份的平均收支差」估算，
 *   类目月支出按活跃月数分摊；任一查询失败只降级对应字段；
 * - 无体检结果：demoMonthlySurplusCents / demoCategoryMonthlyCents 演示口径；
 * 目标列表与存入记录持久化在 localStorage（goals-store.ts）。
 * 挂载前不读本地存储与系统时钟：SSR 与水合首帧都按「无目标」渲染（两端一致）。
 */

import { AnimatePresence, motion } from "framer-motion";
import {
  CalendarClock,
  CircleCheck,
  HelpCircle,
  PiggyBank,
  Plus,
  Target,
  Trash2,
  TrendingUp,
  Trophy,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getDuckDB } from "@/lib/duckdb/service";
import {
  demoCategoryMonthlyCents,
  demoMonthlySurplusCents,
  estimateMonthlySurplus,
  GOALS_ACTIVE_MONTHS_SQL,
  GOALS_CATEGORY_SQL,
  GOALS_MONTHLY_SQL,
  parseCategoryMonthly,
  parseMonthlyIncomeExpense,
  type CategoryMonthlyCents,
} from "@/lib/insights/goals-sql";
import {
  addDeposit,
  addMonths,
  createGoal,
  currentMonthKey,
  formatMonthKey,
  monthsBetween,
  monthsToGoal,
  readGoals,
  removeGoal,
  saveGoals,
  totalSaved,
  type SavingsGoal,
} from "@/lib/insights/goals-store";
import { toDateKey } from "@/lib/insights/challenge-sql";
import { usePipeline } from "@/lib/pipeline/store";
import { fmtYuan } from "@/lib/pipeline/stages/spec";
import { runWhitelistedAggregate } from "@/lib/sql-guard/whitelist";
import { useMounted } from "@/lib/use-mounted";

/** 元输入 → 分：非法输入返回 NaN，由调用方统一判废 */
function yuanToCents(input: string): number {
  const parsed = Number.parseFloat(input);
  if (!Number.isFinite(parsed)) return NaN;
  return Math.round(parsed * 100);
}

const MONTH_KEY_RE = /^\d{4}-\d{2}$/;

/** 目标卡的达成文案与加速建议（纯函数：只吃入参，便于单测与复用） */
interface GoalAdvice {
  /** 预计达成主文案 */
  reachText: string;
  /** 达成状态：已达成 / 无法估算 / 按计划 / 会晚于目标月 */
  status: "done" | "unknown" | "on-track" | "late";
  /** 加速建议：为 null 时不渲染建议行 */
  tip: string | null;
}

function computeAdvice(
  goal: SavingsGoal,
  surplusCents: number | null,
  categories: CategoryMonthlyCents[],
  nowMonth: string,
): GoalAdvice {
  const saved = totalSaved(goal);
  if (saved >= goal.targetCents) {
    return {
      reachText: "已达成",
      status: "done",
      tip: "目标达成！可以开下一个目标，或把这笔钱转存到更长期的目标",
    };
  }
  if (surplusCents === null) {
    return {
      reachText: "暂无法估算",
      status: "unknown",
      tip: "账单里还没有收入记录，先按自己每月能负担的额度存起来",
    };
  }
  const months = monthsToGoal(saved, goal.targetCents, surplusCents) ?? 0;
  const reachMonth = addMonths(nowMonth, months);
  const monthsUntilDeadline = monthsBetween(nowMonth, goal.deadlineMonth);
  if (monthsUntilDeadline <= 0) {
    return {
      reachText: `按当前结余预计 ${formatMonthKey(reachMonth)} 达成`,
      status: "late",
      tip: "目标月已到，建议把目标月往后调，或加大每月存入",
    };
  }
  if (months <= monthsUntilDeadline) {
    const ahead = monthsUntilDeadline - months;
    return {
      reachText: `按当前结余预计 ${formatMonthKey(reachMonth)} 达成`,
      status: "on-track",
      tip:
        ahead > 0
          ? `比目标月提前 ${ahead} 个月，保持当前节奏即可`
          : "刚好踩在目标月上，保持当前节奏即可",
    };
  }
  // 按当前结余会晚于目标月：给出「每月需存多少」与「从哪个类目省」的加速建议
  const remain = goal.targetCents - saved;
  const needed = Math.ceil(remain / monthsUntilDeadline);
  const gap = needed - surplusCents;
  const top = categories[0];
  const base = `按当前结余要晚 ${months - monthsUntilDeadline} 个月；每月需存 ¥${fmtYuan(needed)}`;
  return {
    reachText: `按当前结余预计 ${formatMonthKey(reachMonth)} 达成`,
    status: "late",
    tip:
      gap > 0 && top
        ? `${base}，可在「${top.category}」（月均 ¥${fmtYuan(top.monthlyCents)}）里再省 ¥${fmtYuan(gap)}`
        : base,
  };
}

const ADVICE_STYLE: Record<GoalAdvice["status"], string> = {
  done: "text-(--color-good-ink) dark:text-(--color-good)",
  "on-track": "text-(--color-good-ink) dark:text-(--color-good)",
  unknown: "text-(--color-ink-secondary)",
  late: "text-(--color-warning-ink) dark:text-(--color-warning)",
};

/** 结余卡与类目卡共用的卡片壳 */
function InfoCard({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-(--radius-xl) border border-(--color-border) bg-(--color-surface) p-5 shadow-(--shadow-sm)">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="size-4 text-(--color-primary)" aria-hidden />
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </div>
  );
}

export function GoalsView() {
  const lastRun = usePipeline((s) => s.lastRun);
  const mounted = useMounted();

  // 结余与类目动线：真实聚合或演示口径（装载 effect 按来源切换）
  const [surplusCents, setSurplusCents] = useState<number | null>(null);
  const [categories, setCategories] = useState<CategoryMonthlyCents[]>([]);
  const [dataMode, setDataMode] = useState<"demo" | "real">("demo");
  // 目标列表：挂载后从本地存储读
  // 目标列表：惰性初始化器在浏览器侧直读本地存储（readGoals 自带 window 守卫）；
  // 挂载前骨架分支不渲染列表节点，水合一致
  const [goals, setGoals] = useState<SavingsGoal[]>(() => readGoals());
  // 新建表单态与逐卡存入输入、两步删除确认
  const [nameInput, setNameInput] = useState("");
  const [amountInput, setAmountInput] = useState("");
  // 目标月默认 12 个月后；同样是惰性初始化（服务器无 window 时留空，
  // 挂载前骨架不渲染表单输入，水合一致）
  const [deadlineInput, setDeadlineInput] = useState(() =>
    typeof window === "undefined" ? "" : addMonths(currentMonthKey(new Date()), 12),
  );
  const [depositInputs, setDepositInputs] = useState<Record<string, string>>({});
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);

  // 挂载前不取系统时钟（服务器与客户端时区可能不同，水合会不一致）
  const todayKey = mounted ? toDateKey(new Date()) : null;
  const nowMonth = mounted ? currentMonthKey(new Date()) : null;

  // 装载结余与类目动线：真实优先，查询失败回退演示（cancelled 标志防过期 setState）
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!lastRun) {
        setSurplusCents(demoMonthlySurplusCents());
        setCategories(demoCategoryMonthlyCents());
        setDataMode("demo");
        return;
      }
      try {
        const conn = await getDuckDB();
        const [monthlyRes, categoryRes, monthsRes] = await Promise.allSettled([
          runWhitelistedAggregate(conn, GOALS_MONTHLY_SQL),
          runWhitelistedAggregate(conn, GOALS_CATEGORY_SQL),
          runWhitelistedAggregate(conn, GOALS_ACTIVE_MONTHS_SQL),
        ]);
        if (cancelled) return;
        const rowsOf = (res: PromiseSettledResult<{ rows: unknown[] }>) =>
          res.status === "fulfilled" ? (res.value.rows as Record<string, unknown>[]) : [];
        const monthlyRows =
          monthlyRes.status === "fulfilled" ? parseMonthlyIncomeExpense(rowsOf(monthlyRes)) : [];
        const activeMonths =
          monthsRes.status === "fulfilled"
            ? Number(Object.values(rowsOf(monthsRes)[0] ?? {})[0] ?? 0)
            : 0;
        // 结余失败或无收入记录 → 演示口径；类目失败或无行 → 演示口径（字段级兜底）
        setSurplusCents(estimateMonthlySurplus(monthlyRows) ?? demoMonthlySurplusCents());
        const parsed =
          categoryRes.status === "fulfilled" && activeMonths > 0
            ? parseCategoryMonthly(rowsOf(categoryRes), activeMonths)
            : [];
        setCategories(parsed.length > 0 ? parsed : demoCategoryMonthlyCents());
        setDataMode("real");
      } catch {
        // 查询失败按演示动线继续（与账本类视图同一降级口径）
        if (!cancelled) {
          setSurplusCents(demoMonthlySurplusCents());
          setCategories(demoCategoryMonthlyCents());
          setDataMode("demo");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lastRun]);

  // 各目标的达成文案与加速建议：纯函数派生
  const advices = useMemo(
    () => goals.map((goal) => computeAdvice(goal, surplusCents, categories, nowMonth ?? "2026-01")),
    [goals, surplusCents, categories, nowMonth],
  );

  const amountCents = yuanToCents(amountInput);
  const createValid =
    nameInput.trim().length > 0 &&
    Number.isFinite(amountCents) &&
    amountCents > 0 &&
    MONTH_KEY_RE.test(deadlineInput);

  const showToast = useCallback((text: string) => {
    setToast({ id: Date.now(), text });
  }, []);

  const handleCreate = () => {
    if (!createValid) return;
    const next = createGoal(goals, {
      name: nameInput,
      targetCents: amountCents,
      deadlineMonth: deadlineInput,
    });
    saveGoals(next);
    setGoals(next);
    setNameInput("");
    setAmountInput("");
    showToast("目标已创建，存下第一笔吧");
  };

  const handleDeposit = (goal: SavingsGoal) => {
    if (!todayKey) return;
    const cents = yuanToCents(depositInputs[goal.id] ?? "");
    if (!Number.isFinite(cents) || cents <= 0) return;
    const next = addDeposit(goals, goal.id, todayKey, cents);
    saveGoals(next);
    setGoals(next);
    setDepositInputs((current) => ({ ...current, [goal.id]: "" }));
    showToast(`已存入 ¥${fmtYuan(cents)}`);
  };

  const handleRemove = (goal: SavingsGoal) => {
    const next = removeGoal(goals, goal.id);
    saveGoals(next);
    setGoals(next);
    setConfirmingId(null);
    showToast("目标已删除");
  };

  // 挂载前渲染骨架（SSR 与水合首帧一致，只含静态壳）
  if (!mounted || !todayKey || !nowMonth) {
    return (
      <div>
        <header className="flex items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-(--radius-md) bg-(--color-primary-soft) text-(--color-primary)">
            <Target className="size-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-bold">攒钱目标</h1>
            <p className="text-sm text-(--color-ink-secondary)">
              立一个目标、按月存入，用月结余估算多久能攒到
            </p>
          </div>
        </header>
        <p className="mt-6 text-sm text-(--color-ink-muted)">加载中…</p>
      </div>
    );
  }

  const topCategory = categories[0];
  const maxMonthly = categories.reduce((max, item) => Math.max(max, item.monthlyCents), 0);

  return (
    <div>
      {/* 页头 */}
      <header className="flex flex-wrap items-center gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-(--radius-md) bg-(--color-primary-soft) text-(--color-primary)">
          <Target className="size-6" aria-hidden />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">攒钱目标</h1>
          <p className="text-sm text-(--color-ink-secondary)">
            立一个目标、按月存入，用月结余估算多久能攒到
          </p>
        </div>
        <div className="ml-auto hidden items-center gap-2 sm:flex">
          <span className="rounded-full border border-(--color-border) px-3 py-1 text-xs text-(--color-ink-secondary)">
            {dataMode === "real" ? "本地数据" : "内置数据"}
          </span>
        </div>
      </header>

      {/* 结余与类目动线：两个信息卡并排 */}
      <section aria-label="结余与类目" className="mt-6 grid gap-3 md:grid-cols-2">
        <InfoCard icon={PiggyBank} title="预计月结余">
          {surplusCents !== null ? (
            <>
              <p className="text-3xl font-bold tabular-nums">
                ¥{fmtYuan(surplusCents)}
                <span className="ml-1 text-base font-medium text-(--color-ink-secondary)">/月</span>
              </p>
              <p className="mt-2 text-xs leading-relaxed text-(--color-ink-muted)">
                {dataMode === "real"
                  ? "按最近 6 个月有收入月份的「收入 − 支出」平均估算，目标是按这个节奏推算的"
                  : "内置数据演示口径：按年结余 ÷ 12 个月估算"}
              </p>
            </>
          ) : (
            <>
              <p className="text-3xl font-bold">暂无法估算</p>
              <p className="mt-2 text-xs leading-relaxed text-(--color-ink-muted)">
                账单里还没有收入记录，先按自己每月能负担的额度存起来
              </p>
            </>
          )}
        </InfoCard>
        <InfoCard icon={TrendingUp} title="月均支出 TOP">
          {topCategory ? (
            <>
              <p className="text-sm leading-relaxed text-(--color-ink-secondary)">
                月均支出最高的类目是
                <span className="font-semibold text-(--color-ink)">「{topCategory.category}」</span>
                ，每从这里省 10%，每月就多
                <span className="font-semibold text-(--color-ink)">
                  ¥{fmtYuan(Math.round(topCategory.monthlyCents * 0.1))}
                </span>{" "}
                可以存。
              </p>
              <div className="mt-3 space-y-2">
                {categories.slice(0, 3).map((item) => (
                  <div key={item.category} className="flex items-center gap-2">
                    <span className="w-12 shrink-0 text-xs text-(--color-ink-secondary)">
                      {item.category}
                    </span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-(--color-surface-2)">
                      <div
                        className="h-full rounded-full bg-(--color-primary)"
                        style={{
                          width: `${maxMonthly > 0 ? Math.round((item.monthlyCents / maxMonthly) * 100) : 0}%`,
                        }}
                        aria-hidden
                      />
                    </div>
                    <span className="w-20 shrink-0 text-right text-xs tabular-nums text-(--color-ink-secondary)">
                      ¥{fmtYuan(item.monthlyCents)}/月
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-(--color-ink-muted)">暂无支出记录</p>
          )}
        </InfoCard>
      </section>

      {/* 新建目标 */}
      <section
        aria-label="新建目标"
        className="mt-4 rounded-(--radius-xl) border border-(--color-border) bg-(--color-surface) p-5 shadow-(--shadow-sm)"
      >
        <h2 className="text-lg font-bold">立一个新目标</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="goal-name" className="text-sm font-medium">
              目标名称
            </label>
            <input
              id="goal-name"
              type="text"
              maxLength={20}
              value={nameInput}
              onChange={(event) => setNameInput(event.target.value)}
              placeholder="例如：攒一台新键盘"
              className="mt-2 block w-full rounded-(--radius-md) border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm outline-none transition-colors focus:border-(--color-primary)"
            />
          </div>
          <div>
            <label htmlFor="goal-amount" className="text-sm font-medium">
              目标金额（元）
            </label>
            <input
              id="goal-amount"
              type="number"
              min="1"
              step="1"
              inputMode="decimal"
              value={amountInput}
              onChange={(event) => setAmountInput(event.target.value)}
              placeholder="例如：500"
              className="mt-2 block w-full rounded-(--radius-md) border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm outline-none transition-colors focus:border-(--color-primary)"
            />
          </div>
          <div>
            <label htmlFor="goal-deadline" className="text-sm font-medium">
              目标月
            </label>
            <input
              id="goal-deadline"
              type="month"
              min={nowMonth}
              value={deadlineInput}
              onChange={(event) => setDeadlineInput(event.target.value)}
              className="mt-2 block w-full rounded-(--radius-md) border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm outline-none transition-colors focus:border-(--color-primary)"
            />
          </div>
        </div>
        <button
          type="button"
          onClick={handleCreate}
          disabled={!createValid}
          className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full bg-(--color-btn-primary) px-6 text-sm font-medium text-white transition-colors hover:bg-(--color-btn-primary-hover) disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Plus className="size-4" aria-hidden />
          创建目标
        </button>
      </section>

      {/* 目标列表 */}
      <section aria-label="目标列表" className="mt-4">
        {goals.length === 0 ? (
          <div className="rounded-(--radius-xl) border border-dashed border-(--color-border) bg-(--color-surface) p-8 text-center shadow-(--shadow-sm)">
            <PiggyBank className="mx-auto size-8 text-(--color-ink-muted)" aria-hidden />
            <p className="mt-3 text-sm font-medium">还没有攒钱目标</p>
            <p className="mt-1 text-xs text-(--color-ink-muted)">
              先立一个小目标——比如「三个月内攒一台新键盘」，页面会帮你估算每月要存多少
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {goals.map((goal, index) => {
              const saved = totalSaved(goal);
              const pct = Math.min(100, Math.round((saved / goal.targetCents) * 100));
              const advice = advices[index] ?? null;
              const recent = goal.deposits.slice(-5).reverse();
              return (
                <article
                  key={goal.id}
                  className="rounded-(--radius-xl) border border-(--color-border) bg-(--color-surface) p-5 shadow-(--shadow-sm)"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="flex flex-wrap items-center gap-2 text-base font-bold">
                        {goal.name}
                        {advice?.status === "done" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-(--color-good)/10 px-2 py-0.5 text-xs font-medium text-(--color-good-ink) dark:text-(--color-good)">
                            <Trophy className="size-3.5" aria-hidden />
                            已达成
                          </span>
                        ) : null}
                      </h3>
                      <p className="mt-1 text-xs text-(--color-ink-muted)">
                        目标 {formatMonthKey(goal.deadlineMonth)} · 创建于 {goal.createdAt}
                      </p>
                    </div>
                    {confirmingId === goal.id ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-(--color-ink-secondary)">确认删除？</span>
                        <button
                          type="button"
                          onClick={() => handleRemove(goal)}
                          className="rounded-full bg-(--color-critical) px-3 py-1 text-xs font-medium text-white"
                        >
                          删除
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingId(null)}
                          className="rounded-full border border-(--color-border) px-3 py-1 text-xs text-(--color-ink-secondary)"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmingId(goal.id)}
                        aria-label={`删除目标 ${goal.name}`}
                        className="rounded-full border border-(--color-border) p-2 text-(--color-ink-muted) transition-colors hover:border-(--color-critical) hover:text-(--color-critical-ink) dark:hover:text-(--color-critical)"
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    )}
                  </div>

                  {/* 进度条 */}
                  <div className="mt-4 flex items-baseline justify-between gap-3">
                    <p className="text-sm tabular-nums text-(--color-ink-secondary)">
                      已存{" "}
                      <span className="text-lg font-bold text-(--color-ink)">
                        ¥{fmtYuan(saved)}
                      </span>{" "}
                      / ¥{fmtYuan(goal.targetCents)}
                    </p>
                    <p className="text-sm font-semibold tabular-nums">{pct}%</p>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-(--color-surface-2)">
                    <div
                      className="h-full rounded-full bg-(--color-primary)"
                      style={{ width: `${pct}%` }}
                      aria-hidden
                    />
                  </div>

                  {/* 预计达成 + 加速建议 */}
                  <p className="mt-3 flex items-start gap-1.5 text-sm">
                    <CalendarClock className="mt-0.5 size-4 shrink-0 text-(--color-ink-muted)" aria-hidden />
                    <span>
                      <span className={advice ? ADVICE_STYLE[advice.status] : ""}>
                        {advice?.reachText}
                      </span>
                      {advice?.tip ? (
                        <span className="ml-2 text-(--color-ink-secondary)">{advice.tip}</span>
                      ) : null}
                    </span>
                  </p>

                  {/* 存入与最近记录 */}
                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-(--color-border) pt-4">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      inputMode="decimal"
                      aria-label={`存入金额：${goal.name}`}
                      value={depositInputs[goal.id] ?? ""}
                      onChange={(event) =>
                        setDepositInputs((current) => ({
                          ...current,
                          [goal.id]: event.target.value,
                        }))
                      }
                      placeholder="存入金额（元）"
                      className="w-36 rounded-(--radius-md) border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm outline-none transition-colors focus:border-(--color-primary)"
                    />
                    <button
                      type="button"
                      onClick={() => handleDeposit(goal)}
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-(--color-btn-primary) px-4 text-sm font-medium text-white transition-colors hover:bg-(--color-btn-primary-hover)"
                    >
                      <Plus className="size-4" aria-hidden />
                      存入
                    </button>
                    {recent.length > 0 ? (
                      <p className="ml-auto text-xs tabular-nums text-(--color-ink-muted)">
                        {recent
                          .map((dep) => `${dep.dateIso.slice(5).replace("-", "/")} ¥${fmtYuan(dep.cents)}`)
                          .join(" · ")}
                      </p>
                    ) : (
                      <p className="ml-auto text-xs text-(--color-ink-muted)">还没有存入记录</p>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* 用法说明 */}
      <section
        aria-label="用法说明"
        className="mt-6 rounded-(--radius-xl) border border-(--color-border) bg-(--color-surface) p-5 shadow-(--shadow-sm)"
      >
        <h2 className="flex items-center gap-2 text-base font-bold">
          <HelpCircle className="size-4 text-(--color-primary)" aria-hidden />
          怎么用
        </h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-(--color-ink-secondary)">
          <li>立一个目标：写下想买的东西或想攒的数目，定一个目标月；</li>
          <li>每次有余钱就点「存入」记一笔，进度条实时更新；</li>
          <li>页面用「预计月结余」估算还需几个月，并给出从哪个类目省的加速建议；</li>
          <li>没有收入记录时估算不可用，但存入记录照常累计。</li>
        </ul>
        <p className="mt-3 text-xs text-(--color-ink-muted)">
          结余估算来自你的本地账单（浏览器内聚合），目标与存入记录只保存在本机，不上传。
        </p>
      </section>

      {/* 轻提示：底部居中，不打断操作 */}
      <AnimatePresence>
        {toast ? (
          <div
            key={toast.id}
            className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-4 md:bottom-8"
          >
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.18 }}
              onAnimationComplete={() => {
                window.setTimeout(() => {
                  setToast((current) => (current?.id === toast.id ? null : current));
                }, 2600);
              }}
              className="flex items-center gap-2 rounded-full bg-(--color-ink) px-4 py-2.5 text-sm text-(--color-surface) shadow-(--shadow-lg)"
            >
              <CircleCheck className="size-4 text-(--color-good)" aria-hidden />
              {toast.text}
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
