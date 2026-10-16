"use client";

/**
 * 省钱挑战打卡（修订案 A17）主视图。
 *
 * 玩法：挑一个类目、定一个每日预算，连续打卡 21 天——
 * 挑战页按「开始日前 30 天日均（基线）」计算每日节省额，结束出总结。
 *
 * 数据动线（真实优先 + demo 兜底）：
 * - 有体检结果：CHALLENGE_DAILY_SQL 经白名单聚合拉最近 120 天逐日类目支出，
 *   查询失败整页回退演示序列；
 * - 无体检结果：generateChallengeDemoRows 确定性演示序列；
 * 挑战配置与打卡记录持久化在 localStorage（challenge-store.ts）。
 * 挂载前不读本地存储：SSR 与水合首帧都按「未开始」渲染（两端一致），
 * 动态内容全部在挂载后呈现，不会出现水合不一致。
 */

import { AnimatePresence, motion } from "framer-motion";
import {
  CalendarCheck,
  CircleCheck,
  Flame,
  HelpCircle,
  RotateCcw,
  Sparkles,
  Trophy,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { unlockAchievement } from "@/lib/achievements";
import { getDuckDB } from "@/lib/duckdb/service";
import { generateChallengeDemoRows } from "@/lib/insights/challenge-demo";
import {
  CHALLENGE_DAILY_ROWS_CAP,
  CHALLENGE_DAILY_SQL,
  CHALLENGE_DURATION_DAYS,
  addDays,
  parseCategoryDayRows,
  quotaSuggestionCents,
  toDateKey,
  type CategoryDayCents,
} from "@/lib/insights/challenge-sql";
import {
  buildChallengeDays,
  checkIn,
  clearChallenge,
  computeBaselineCents,
  readChallenge,
  saveChallenge,
  streakOf,
  summarizeDays,
  uncheck,
  type ChallengeRecord,
} from "@/lib/insights/challenge-store";
import { usePipeline } from "@/lib/pipeline/store";
import { fmtYuan } from "@/lib/pipeline/stages/spec";
import { runWhitelistedAggregate } from "@/lib/sql-guard/whitelist";
import { useMounted } from "@/lib/use-mounted";

/** 12 类唯一枚举（07 §3）：与 quick-entry zod schema 同口径，模块自持副本（budget 页同款） */
const CATEGORIES_12 = [
  "餐饮",
  "交通",
  "购物",
  "娱乐",
  "居住",
  "通讯",
  "医疗",
  "教育",
  "人情",
  "金融",
  "订阅",
  "其他",
] as const;

/** 元输入 → 分：非法输入返回 NaN，由调用方统一判废 */
function yuanToCents(input: string): number {
  const parsed = Number.parseFloat(input);
  if (!Number.isFinite(parsed)) return NaN;
  return Math.round(parsed * 100);
}

/** 概览四宫格的小卡：标签 + 大数字，三态页共用 */
function StatCard({ label, value, icon: Icon }: { label: string; value: string; icon: LucideIcon }) {
  return (
    <div className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-4 shadow-(--shadow-sm)">
      <p className="flex items-center gap-1.5 text-sm font-medium text-(--color-ink-secondary)">
        <Icon className="size-4 text-(--color-primary)" aria-hidden />
        {label}
      </p>
      <p className="mt-2 text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

export function ChallengeView() {
  const lastRun = usePipeline((s) => s.lastRun);
  const mounted = useMounted();

  // 挑战数据：真实查询结果或演示序列（装载 effect 按来源切换）
  const [points, setPoints] = useState<CategoryDayCents[]>([]);
  const [dataMode, setDataMode] = useState<"demo" | "real">("demo");
  // 挑战记录：惰性初始化器在浏览器侧直读本地存储（readChallenge 自带 window 守卫），
  // null = 未开始；挂载前骨架分支不渲染记录相关节点，水合一致
  const [record, setRecord] = useState<ChallengeRecord | null>(() => readChallenge());
  // 新建表单态：类目选择与预算输入只在「未开始」页使用
  const [pickedCategory, setPickedCategory] = useState<string | null>(null);
  const [quotaInput, setQuotaInput] = useState("");
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);

  // 挂载前不取系统时钟（服务器与客户端时区可能不同，水合会不一致）
  const todayKey = mounted ? toDateKey(new Date()) : null;

  // 装载逐日支出：真实优先，查询失败回退演示（cancelled 标志防过期 setState）
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!lastRun) {
        setPoints(generateChallengeDemoRows());
        setDataMode("demo");
        return;
      }
      try {
        const conn = await getDuckDB();
        const { rows } = await runWhitelistedAggregate(conn, CHALLENGE_DAILY_SQL, {
          maxResultRows: CHALLENGE_DAILY_ROWS_CAP,
        });
        if (cancelled) return;
        setPoints(parseCategoryDayRows(rows as Record<string, unknown>[]));
        setDataMode("real");
      } catch {
        // 查询失败按演示动线继续（与账本类视图同一降级口径）
        if (!cancelled) {
          setPoints(generateChallengeDemoRows());
          setDataMode("demo");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lastRun]);

  // 逐日状态与汇总：只依赖记录 + 数据 + 今天，纯函数派生
  const days = useMemo(
    () => (record && todayKey ? buildChallengeDays(record, points, todayKey) : []),
    [record, points, todayKey],
  );
  const finished = useMemo(() => {
    if (!record || !todayKey) return false;
    const endKey = addDays(record.startDate, CHALLENGE_DURATION_DAYS - 1);
    return todayKey > endKey;
  }, [record, todayKey]);
  const totals = useMemo(() => summarizeDays(days, finished), [days, finished]);
  const streak = useMemo(
    () => (record && todayKey ? streakOf(record.checkins, todayKey) : 0),
    [record, todayKey],
  );

  // 连续打卡 7 天解锁「七日打卡王」成就（unlockAchievement 幂等且持久化）
  useEffect(() => {
    if (streak >= 7) unlockAchievement("challenge-streak");
  }, [streak]);

  // 新建表单的基线口径：选类目后按「开始日前 30 天日均」即时给建议
  const baseline = useMemo(() => {
    if (!pickedCategory || !todayKey) return 0;
    return computeBaselineCents(points, pickedCategory, todayKey);
  }, [pickedCategory, points, todayKey]);
  const suggestedCents = quotaSuggestionCents(baseline);
  const quotaCents = yuanToCents(quotaInput);
  const quotaValid = Number.isFinite(quotaCents) && quotaCents > 0;

  const showToast = useCallback((text: string) => {
    setToast({ id: Date.now(), text });
  }, []);

  const handleStart = () => {
    if (!pickedCategory || !todayKey || !quotaValid) return;
    const next: ChallengeRecord = {
      category: pickedCategory,
      quotaCents,
      baselineCents: computeBaselineCents(points, pickedCategory, todayKey),
      startDate: todayKey,
      checkins: [],
    };
    saveChallenge(next);
    setRecord(next);
    showToast("挑战开始，今天就来第一卡");
  };

  const handleCheckIn = () => {
    if (!record || !todayKey) return;
    const next = checkIn(record, todayKey);
    saveChallenge(next);
    setRecord(next);
    showToast("今日已打卡，明天继续");
  };

  const handleUncheck = () => {
    if (!record || !todayKey) return;
    const next = uncheck(record, todayKey);
    saveChallenge(next);
    setRecord(next);
    showToast("已撤销今日打卡");
  };

  const handleAbandon = () => {
    clearChallenge();
    setRecord(null);
    setPickedCategory(null);
    setQuotaInput("");
    showToast("挑战已结束，随时可以重新开始");
  };

  // 挂载前渲染骨架（SSR 与水合首帧一致，只含静态壳）
  if (!mounted || !todayKey) {
    return (
      <div>
        <header className="flex items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-(--radius-md) bg-(--color-primary-soft) text-(--color-primary)">
            <Flame className="size-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-bold">省钱挑战</h1>
            <p className="text-sm text-(--color-ink-secondary)">
              挑一个类目、定一个每日预算，连续打卡 21 天，看看能省下多少
            </p>
          </div>
        </header>
        <p className="mt-6 text-sm text-(--color-ink-muted)">加载中…</p>
      </div>
    );
  }

  const todayDay = days.find((d) => d.date === todayKey);
  const todayCents = todayDay?.cents ?? 0;
  const todayChecked = todayDay?.checked ?? false;
  const todayPassed = todayDay?.passed ?? true;
  const recentDays = days.slice(-7);
  const windowMax = record
    ? Math.max(record.quotaCents, ...recentDays.map((d) => d.cents))
    : 0;
  // 挑战期总支出与基线口径（完成回顾用）
  const periodSpend = days.reduce((sum, d) => sum + d.cents, 0);
  const periodBaseline = record ? record.baselineCents * CHALLENGE_DURATION_DAYS : 0;

  return (
    <div>
      {/* 页头 */}
      <header className="flex flex-wrap items-center gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-(--radius-md) bg-(--color-primary-soft) text-(--color-primary)">
          <Flame className="size-6" aria-hidden />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">省钱挑战</h1>
          <p className="text-sm text-(--color-ink-secondary)">
            挑一个类目、定一个每日预算，连续打卡 21 天，看看能省下多少
          </p>
        </div>
        <div className="ml-auto hidden items-center gap-2 sm:flex">
          <span className="rounded-full border border-(--color-border) px-3 py-1 text-xs text-(--color-ink-secondary)">
            {dataMode === "real" ? "本地数据" : "内置数据"}
          </span>
        </div>
      </header>

      {record ? (
        finished ? (
          /* 挑战完成：21 天回顾 + 再来一次 */
          <section
            aria-label="挑战完成"
            className="mt-6 rounded-(--radius-xl) border border-(--color-border) bg-(--color-surface) p-6 shadow-(--shadow-sm)"
          >
            <div className="flex items-center gap-2">
              <Trophy className="size-6 text-(--color-warning)" aria-hidden />
              <h2 className="text-lg font-bold">21 天挑战完成</h2>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-(--color-ink-secondary)">
              「{record.category}」21 天总结：打卡 {totals.checkedDays} 天、达标{" "}
              {totals.passedDays} 天，累计节省 ¥{fmtYuan(totals.savedCents)}
              {totals.overCents > 0 ? `、超支 ¥${fmtYuan(totals.overCents)}` : ""}。
              与基线口径（¥{fmtYuan(periodBaseline)}）相比，
              {totals.savedCents >= totals.overCents
                ? "这期挑战成功守住了钱包。"
                : "超支比节省多，下期试试更宽松一点的预算。"}
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <StatCard
                label="挑战期总支出"
                value={`¥${fmtYuan(periodSpend)}`}
                icon={Flame}
              />
              <StatCard
                label="打卡 / 达标"
                value={`${totals.checkedDays} / ${totals.passedDays} 天`}
                icon={CalendarCheck}
              />
              <StatCard
                label="净节省"
                value={`¥${fmtYuan(Math.max(0, totals.savedCents - totals.overCents))}`}
                icon={Trophy}
              />
            </div>
            <button
              type="button"
              onClick={handleAbandon}
              className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full bg-(--color-btn-primary) px-6 text-sm font-medium text-white transition-colors hover:bg-(--color-btn-primary-hover)"
            >
              <RotateCcw className="size-4" aria-hidden />
              再来一次
            </button>
          </section>
        ) : (
          /* 挑战进行中：概览 + 今日卡 + 近 7 天条 + 结束入口 */
          <section aria-label="挑战进行中" className="mt-6">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="进行天数"
                value={`${days.length} / ${CHALLENGE_DURATION_DAYS} 天`}
                icon={Flame}
              />
              <StatCard label="连续打卡" value={`${streak} 天`} icon={CalendarCheck} />
              <StatCard label="达标天数" value={`${totals.passedDays} 天`} icon={CircleCheck} />
              <StatCard
                label="累计节省"
                value={`¥${fmtYuan(totals.savedCents)}`}
                icon={Trophy}
              />
            </div>

            {/* 今日卡：当日支出 vs 预算 + 打卡按钮 */}
            <div className="mt-4 rounded-(--radius-xl) border border-(--color-border) bg-(--color-surface) p-5 shadow-(--shadow-sm)">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold">
                    今日 · {record.category}
                    {todayPassed ? (
                      <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-(--color-good)/10 px-2 py-0.5 text-xs font-medium text-(--color-good-ink) dark:text-(--color-good)">
                        <CircleCheck className="size-3.5" aria-hidden />
                        达标
                      </span>
                    ) : (
                      <span className="ml-2 inline-flex items-center rounded-full bg-(--color-warning)/15 px-2 py-0.5 text-xs font-medium text-(--color-warning-ink) dark:text-(--color-warning)">
                        已超预算
                      </span>
                    )}
                  </h2>
                  <p className="mt-1 text-sm text-(--color-ink-secondary)">
                    今日支出{" "}
                    <span className="font-semibold tabular-nums">¥{fmtYuan(todayCents)}</span>{" "}
                    / 预算{" "}
                    <span className="font-semibold tabular-nums">¥{fmtYuan(record.quotaCents)}</span>
                  </p>
                </div>
                {todayChecked ? (
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-(--color-primary-soft) px-3 py-1.5 text-sm font-medium text-(--color-primary)">
                      <CalendarCheck className="size-4" aria-hidden />
                      已打卡
                    </span>
                    <button
                      type="button"
                      onClick={handleUncheck}
                      className="rounded-full border border-(--color-border) px-3 py-1.5 text-xs text-(--color-ink-secondary) transition-colors hover:border-(--color-border-strong)"
                    >
                      撤销
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleCheckIn}
                    className="inline-flex min-h-11 items-center gap-2 rounded-full bg-(--color-btn-primary) px-6 text-sm font-medium text-white transition-colors hover:bg-(--color-btn-primary-hover)"
                  >
                    <CalendarCheck className="size-4" aria-hidden />
                    打卡今日
                  </button>
                )}
              </div>
              {/* 当日支出进度：占预算的比例，超支封顶满格 */}
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-(--color-surface-2)">
                <div
                  className={`h-full rounded-full ${todayPassed ? "bg-(--color-good)" : "bg-(--color-warning)"}`}
                  style={{
                    width: `${Math.min(100, Math.round((todayCents / record.quotaCents) * 100))}%`,
                  }}
                  aria-hidden
                />
              </div>
            </div>

            {/* 近 7 天条：柱高 = 当日支出，虚线 = 每日预算 */}
            <div className="mt-4 rounded-(--radius-xl) border border-(--color-border) bg-(--color-surface) p-5 shadow-(--shadow-sm)">
              <h3 className="text-sm font-semibold">近 7 天</h3>
              <p className="mt-1 text-xs text-(--color-ink-muted)">
                柱高为当日支出、虚线为每日预算；绿柱达标、橙柱超支，圆点表示当天已打卡
              </p>
              <div className="mt-4 flex items-end justify-between gap-2">
                {recentDays.map((day) => {
                  const pct = windowMax > 0 ? Math.round((day.cents / windowMax) * 100) : 0;
                  const quotaPct =
                    windowMax > 0 ? Math.round((record.quotaCents / windowMax) * 100) : 0;
                  return (
                    <div
                      key={day.date}
                      className="flex flex-1 flex-col items-center gap-1.5"
                    >
                      <span className="text-[10px] tabular-nums text-(--color-ink-muted)">
                        ¥{(day.cents / 100).toFixed(0)}
                      </span>
                      <div className="relative h-16 w-full max-w-9 overflow-hidden rounded-t-md bg-(--color-surface-2)">
                        <div
                          className="absolute inset-x-0 border-t border-dashed border-(--color-ink-muted)"
                          style={{ bottom: `${quotaPct}%` }}
                          aria-hidden
                        />
                        <div
                          className={`absolute inset-x-0 bottom-0 ${day.passed ? "bg-(--color-good)" : "bg-(--color-warning)"}`}
                          style={{ height: `${pct}%` }}
                          aria-hidden
                        />
                      </div>
                      <span className="text-[10px] text-(--color-ink-secondary)">
                        {day.date.slice(5).replace("-", "/")}
                      </span>
                      {day.checked ? (
                        <CircleCheck
                          className="size-3 text-(--color-primary)"
                          aria-label="已打卡"
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 结束入口：放在底部，避免误触 */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-(--radius-xl) border border-(--color-border) bg-(--color-surface) p-5 shadow-(--shadow-sm)">
              <p className="text-xs text-(--color-ink-muted)">
                中途放弃会清空本次挑战记录，随时可以重新开始。
              </p>
              <button
                type="button"
                onClick={handleAbandon}
                className="rounded-full border border-(--color-border) px-4 py-2 text-sm font-medium text-(--color-ink-secondary) transition-colors hover:border-(--color-critical) hover:text-(--color-critical-ink) dark:hover:text-(--color-critical)"
              >
                结束挑战
              </button>
            </div>
          </section>
        )
      ) : (
        /* 未开始：类目选择 + 预算输入 + 开始按钮 */
        <section
          aria-label="开始新挑战"
          className="mt-6 rounded-(--radius-xl) border border-(--color-border) bg-(--color-surface) p-5 shadow-(--shadow-sm)"
        >
          <h2 className="text-lg font-bold">开始一个新挑战</h2>
          <p className="mt-1 text-sm text-(--color-ink-secondary)">
            选一个常花钱的类目，定一个比平时低一点的每日预算。
          </p>

          <div className="mt-4">
            <p className="text-sm font-medium">挑战类目</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {CATEGORIES_12.map((category) => (
                <button
                  key={category}
                  type="button"
                  aria-pressed={pickedCategory === category}
                  onClick={() => {
                    setPickedCategory(category);
                    setQuotaInput("");
                  }}
                  className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                    pickedCategory === category
                      ? "border-(--color-primary) bg-(--color-primary-soft) text-(--color-primary)"
                      : "border-(--color-border) text-(--color-ink-secondary) hover:border-(--color-border-strong)"
                  }`}
                >
                  {category}
                </button>
              ))}
            </div>
            {pickedCategory ? (
              <p className="mt-2 text-xs leading-relaxed text-(--color-ink-muted)">
                「{pickedCategory}」近 30 天日均支出{" "}
                {baseline > 0 ? `¥${fmtYuan(baseline)}` : "暂无记录"}
                {baseline > 0
                  ? `，建议每日预算 ¥${fmtYuan(suggestedCents)}（基线的 80%）`
                  : "，建议先定 ¥5/天 试试"}
              </p>
            ) : null}
          </div>

          <div className="mt-4">
            <label htmlFor="challenge-quota" className="text-sm font-medium">
              每日预算（元）
            </label>
            <input
              id="challenge-quota"
              type="number"
              min="1"
              step="1"
              inputMode="decimal"
              value={quotaInput}
              onChange={(event) => setQuotaInput(event.target.value)}
              placeholder={
                pickedCategory ? `建议 ${Math.floor(suggestedCents / 100)} 元/天` : "先选类目"
              }
              className="mt-2 block w-full max-w-48 rounded-(--radius-md) border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm outline-none transition-colors focus:border-(--color-primary)"
            />
          </div>

          <button
            type="button"
            onClick={handleStart}
            disabled={!pickedCategory || !quotaValid}
            className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full bg-(--color-btn-primary) px-6 text-sm font-medium text-white transition-colors hover:bg-(--color-btn-primary-hover) disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Sparkles className="size-4" aria-hidden />
            开始挑战
          </button>
        </section>
      )}

      {/* 玩法说明：三态页共用，评审演示时能一眼看懂规则 */}
      <section
        aria-label="玩法说明"
        className="mt-6 rounded-(--radius-xl) border border-(--color-border) bg-(--color-surface) p-5 shadow-(--shadow-sm)"
      >
        <h2 className="flex items-center gap-2 text-base font-bold">
          <HelpCircle className="size-4 text-(--color-primary)" aria-hidden />
          怎么玩
        </h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-(--color-ink-secondary)">
          <li>选一个常花钱的类目，定一个比近 30 天日均低 20% 的每日预算；</li>
          <li>每天回来看一眼当天支出，点「打卡今日」记录坚持；</li>
          <li>支出 ≤ 预算算达标，节省额按「基线 − 实际」累计；连续打卡 7 天解锁「七日打卡王」成就；</li>
          <li>21 天为一期，结束后自动生成总结。</li>
        </ul>
        <p className="mt-3 text-xs text-(--color-ink-muted)">
          金额来自你的本地账单（浏览器内聚合），打卡记录只保存在本机，不上传。
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
