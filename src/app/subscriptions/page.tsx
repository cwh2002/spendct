"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  CalendarClock,
  CircleCheck,
  CircleX,
  Database,
  Radar,
  ShieldCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Container } from "@/components/layout/container";
import { SubscriptionCard } from "@/components/subscriptions/subscription-card";
import { useCountUp } from "@/components/subscriptions/use-count-up";
import { DEMO_SUBSCRIPTIONS, type DemoSubscription } from "@/lib/demo-data";
import { getDuckDB } from "@/lib/duckdb/service";
import { usePipeline, type LastRunSummary } from "@/lib/pipeline/store";
import { runWhitelistedAggregate } from "@/lib/sql-guard/whitelist";

/** 内置账单口径：订阅年化 66,000 分 ÷ 年度总支出 2,080,000 分 ≈ 3.2%，
 *  与 demo-data.ts 新口径一致（仅内置数据动线使用，真实动线按 annual_summary 现算） */
const DEMO_EXPENSE_SHARE_PCT = 3.2;

function fmtYuan(cents: number): string {
  return (cents / 100).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** 摘要数字卡：数字滚动 + tabular-nums，展示层各自决定格式 */
function StatCard({
  icon: Icon,
  label,
  value,
  format,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  format: (v: number) => string;
  hint: string;
}) {
  const animated = useCountUp(value);
  return (
    <div className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-4 shadow-(--shadow-sm)">
      <p className="flex items-center gap-2 text-sm text-(--color-ink-secondary)">
        <Icon className="size-4 text-(--color-primary)" aria-hidden />
        {label}
      </p>
      <p className="mt-2 text-2xl font-bold tabular-nums md:text-3xl">{format(animated)}</p>
      <p className="mt-1 text-xs text-(--color-ink-muted)">{hint}</p>
    </div>
  );
}

/** 扫描说明卡：与订阅卡拼齐 2×2 网格，交代识别范围与复核方式 */
function ScanCoverageCard() {
  const rows = [
    { icon: Database, label: "识别规则", value: "内置 12 条" },
    { icon: CalendarClock, label: "扫描范围", value: "近 12 个月账单" },
    { icon: ShieldCheck, label: "商户名", value: "已打码显示" },
    { icon: CircleCheck, label: "疑似误报", value: "0 笔（等你确认）" },
  ] as const;
  return (
    <div className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-5 shadow-(--shadow-sm)">
      <h2 className="flex items-center gap-2 font-semibold">
        <Radar className="size-4 text-(--color-primary)" aria-hidden />
        扫描说明
      </h2>
      <ul className="mt-3 flex flex-col gap-2.5">
        {rows.map(({ icon: Icon, label, value }) => (
          <li key={label} className="flex items-center gap-2.5 text-sm">
            <Icon className="size-4 shrink-0 text-(--color-ink-muted)" aria-hidden />
            <span className="text-(--color-ink-secondary)">{label}</span>
            <span className="ml-auto font-medium tabular-nums">{value}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 border-t border-(--color-border) pt-3 text-xs leading-relaxed text-(--color-ink-muted)">
        每一条识别结果都附上扣费时间记录，可以点开逐笔核对。
      </p>
    </div>
  );
}

/**
 * 真实订阅查询：确定性 SQL 代码常量，经白名单 runWhitelistedAggregate 执行（07 §6 唯一入口）。
 * subscription_patterns 由 initDataset 物化（07 §3 预计算表），每行 = 一个订阅命中商户。
 * 白名单窄文法不支持 AS 别名（自动列名不稳定）、不允许非分组键明细列（R3），
 * 因此按 merchant 分组后对其余列取 MAX（组内单行，MAX 即原值），结果按列位置取值。
 * 列序契约：0 merchant / 1 n / 2 last_ts / 3 avg_cents / 4 avg_interval_days
 */
const SUBSCRIPTION_PATTERNS_SQL =
  "SELECT merchant, MAX(n), MAX(last_ts), MAX(avg_cents), MAX(avg_interval_days) " +
  "FROM subscription_patterns GROUP BY merchant ORDER BY MAX(last_ts) DESC LIMIT 50";

/**
 * 「占支出」统计分母查询：annual_summary 按年一行（07 §3 预计算表），
 * 多年份时在 JS 侧求和得到体检期总支出。列序契约：0 year / 1 expense_cents
 */
const ANNUAL_SUMMARY_SQL = "SELECT year, MAX(expense_cents) FROM annual_summary GROUP BY year";

/** DuckDB 单元格 → YYYY-MM-DD：兼容箭头层 Date 对象 / ISO 字符串 / 微秒整数三种物化形态 */
function fmtDateCell(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // Date 形态：按本地钟表分量格式（导入 ts 为无时区本地时间，与管线引擎 fmtDate 同口径）
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  if (typeof value === "bigint") {
    // TIMESTAMP 物化为微秒整数：UTC 回读避免时区漂移
    const date = new Date(Number(value / 1000n));
    return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
  }
  return String(value ?? "").slice(0, 10);
}

/** 行内按 SELECT 列位置取值（DuckDB 自动列名不稳定，与管线引擎同口径） */
function cellAt(row: Record<string, unknown>, index: number): unknown {
  return Object.values(row)[index] ?? null;
}

/** 按列位置取数值：兼容 BIGINT 物化为 bigint 的形态 */
function numCell(row: Record<string, unknown>, index: number): number {
  const value = cellAt(row, index);
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** sha256 前 8 位 hex；无 WebCrypto 环境降级 FNV-1a 32 位（与管线引擎同一降级口径） */
async function sha256Hex8(text: string): Promise<string> {
  if (typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined") {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 8);
  }
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * 周期分桶：按平均相邻扣费间隔推断。
 * 订阅候选视图只放行 25-40 天相邻间隔（07 §3 唯一业务规则），正常命中几乎全落
 * monthly；daily/weekly/yearly 桶为非标间隔账单的兜底口径。
 */
function cycleOf(avgIntervalDays: number): DemoSubscription["cycle"] {
  if (avgIntervalDays <= 2) return "daily";
  if (avgIntervalDays <= 15) return "weekly";
  if (avgIntervalDays <= 92) return "monthly";
  return "yearly";
}

/** 周期步进（dir 为 +1 前进 / -1 后退）：跨月按目标月末日截断，避免 1/31 加一月溢出到次月 */
function stepCycle(date: Date, cycle: DemoSubscription["cycle"], dir: 1 | -1): Date {
  const d = new Date(date);
  if (cycle === "daily") {
    d.setDate(d.getDate() + dir);
    return d;
  }
  if (cycle === "weekly") {
    d.setDate(d.getDate() + 7 * dir);
    return d;
  }
  if (cycle === "monthly") {
    const targetMonth = d.getMonth() + dir;
    const probe = new Date(d.getFullYear(), targetMonth, 1);
    const lastDay = new Date(probe.getFullYear(), probe.getMonth() + 1, 0).getDate();
    d.setMonth(targetMonth, Math.min(d.getDate(), lastDay));
    return d;
  }
  // yearly：2 月 29 日回落到 2 月 28 日
  const targetYear = d.getFullYear() + dir;
  const probe = new Date(targetYear, d.getMonth(), 1);
  const lastDay = new Date(probe.getFullYear(), probe.getMonth() + 1, 0).getDate();
  d.setFullYear(targetYear, d.getMonth(), Math.min(d.getDate(), lastDay));
  return d;
}

/** 扣费轨迹回填上限：sparkline 展示超出无增益，超出只保留最近 N 条 */
const MAX_CHARGE_POINTS = 24;

/**
 * 等额明细回填：subscription_patterns 只有聚合粒度（无逐笔明细表），
 * 从 last_ts 按周期逐条后退生成 n 条等额轨迹（末位 = lastChargeDate）。
 * 展示层近似口径：真实扣费日与逐笔金额以原账单为准，本页轨迹仅作趋势示意。
 */
function buildBackfillCharges(
  lastChargeDate: string,
  cycle: DemoSubscription["cycle"],
  amountCents: number,
  count: number,
): { date: string; amountCents: number }[] {
  const charges: { date: string; amountCents: number }[] = [];
  let cursor = new Date(`${lastChargeDate}T00:00:00`);
  const limit = Math.min(count, MAX_CHARGE_POINTS);
  for (let i = 0; i < limit; i++) {
    const pad = (n: number) => String(n).padStart(2, "0");
    charges.push({
      date: `${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}-${pad(cursor.getDate())}`,
      amountCents,
    });
    cursor = stepCycle(cursor, cycle, -1);
  }
  return charges.reverse(); // 时间升序：最早在前，末位为 lastChargeDate
}

/**
 * subscription_patterns 聚合行 → 页面订阅模型（DemoSubscription 形状）。
 * 日期锚 = 全部命中行中最大的 last_ts（数据内最大日期，不读系统时钟，保证同一数据集结果恒定）。
 */
async function mapPatternRows(rows: Record<string, unknown>[]): Promise<DemoSubscription[]> {
  // 数据锚：全部命中行的最大 last_ts，nextChargeInDays 推算的确定性基准
  const lastDates = rows
    .map((row) => fmtDateCell(cellAt(row, 2)))
    .filter((iso) => iso.length === 10 && !Number.isNaN(new Date(`${iso}T00:00:00`).getTime()));
  const anchorMs =
    lastDates.length > 0
      ? Math.max(...lastDates.map((iso) => new Date(`${iso}T00:00:00`).getTime()))
      : 0;

  const subs: DemoSubscription[] = [];
  for (const row of rows) {
    const merchant = String(cellAt(row, 0) ?? "");
    const n = numCell(row, 1);
    const lastIso = fmtDateCell(cellAt(row, 2));
    const avgCents = numCell(row, 3);
    const avgIntervalDays = numCell(row, 4);
    const lastDate = new Date(`${lastIso}T00:00:00`);

    // 脏行防御：商户名或末次扣费日期缺失的行无法映射，直接跳过
    if (!merchant || lastIso.length !== 10 || Number.isNaN(lastDate.getTime()) || n <= 0) {
      continue;
    }

    const cycle = cycleOf(avgIntervalDays > 0 ? avgIntervalDays : 30);
    const amountCents = Math.round(avgCents);
    // 无 merchant_ref 列：商户名 sha256 前 8 位 hex 脱敏（m_+8hex，与演示数据同形，
    // 原始商户名永不进入页面与打标记录，符合 02 §6.2 脱敏口径）
    const merchantRef = `m_${await sha256Hex8(merchant)}`;

    // nextChargeInDays：lastCharge 前进一个周期后距数据锚日的天数（确定性口径，
    // 不读系统时钟；卡片组件展示时会按真实时钟从 lastChargeDate 自行外推倒计时，
    // 本字段仅为模型契约占位）
    const nextMs = stepCycle(lastDate, cycle, 1).getTime();
    const nextChargeInDays =
      anchorMs > 0 ? Math.max(0, Math.round((nextMs - anchorMs) / 86_400_000)) : 0;

    subs.push({
      // 稳定 ID：打标与提醒记录（localStorage 键）跨刷新仍能对上同一商户
      id: `sub-${merchantRef}`,
      merchantRef,
      // 与演示数据同形；真实规则注册号见阶段 4（rule:subscription-cycle-v1）
      ruleId: `rule:sub-${cycle}-1`,
      cycle,
      amountCents,
      lastChargeDate: lastIso,
      nextChargeInDays,
      charges: buildBackfillCharges(lastIso, cycle, amountCents, n),
      // 年度合计：预计算表无年度总额列，取「单笔均值 × 笔数」（07 §3 阶段 4 年化口径）
      totalYearCents: Math.round(avgCents * n),
    });
  }
  return subs;
}

/** 订阅卡商户占位名：原始商户名已打码、永不进入页面，按卡片顺序用「商户 A」式称呼区分 */
const MERCHANT_NAME_MARKS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function merchantLabelFor(index: number): string {
  const mark =
    index < MERCHANT_NAME_MARKS.length
      ? `商户 ${MERCHANT_NAME_MARKS[index]}`
      : `商户 ${index + 1}`;
  return `${mark}（已打码）`;
}

export default function SubscriptionsPage() {
  const lastRun = usePipeline((s) => s.lastRun);

  // 真实数据查询状态：以 lastRun 对象引用为键（runner 的 runId 只在 upload/sample 两档间复用，
  // 不唯一；用引用比对才能区分先后两次运行）。查询失败时记 failedRun，按同引用降级演示
  const [realData, setRealData] = useState<{
    run: LastRunSummary;
    subs: DemoSubscription[];
    sharePct: number;
  } | null>(null);
  const [failedRun, setFailedRun] = useState<LastRunSummary | null>(null);

  useEffect(() => {
    // 演示动线（尚未体检，lastRun 为空）不查询，维持 DEMO_SUBSCRIPTIONS 现状
    if (!lastRun) return;
    let cancelled = false;

    void (async () => {
      try {
        // 两条确定性 SQL 并行执行：订阅命中 + 年度支出（「占支出」分母）
        const conn = await getDuckDB();
        const [patterns, annual] = await Promise.all([
          runWhitelistedAggregate(conn, SUBSCRIPTION_PATTERNS_SQL),
          runWhitelistedAggregate(conn, ANNUAL_SUMMARY_SQL),
        ]);
        const subs = await mapPatternRows(patterns.rows as Record<string, unknown>[]);
        if (cancelled) return;
        // 占支出：订阅年化合计 / 体检期总支出（annual_summary 按年一行，多年求和）
        const totalExpenseCents = (annual.rows as Record<string, unknown>[]).reduce(
          (sum, row) => sum + numCell(row, 1),
          0,
        );
        const yearTotalCents = subs.reduce((sum, s) => sum + s.totalYearCents, 0);
        setRealData({
          run: lastRun,
          subs,
          sharePct: totalExpenseCents > 0 ? (yearTotalCents / totalExpenseCents) * 100 : 0,
        });
      } catch (err) {
        // 查询失败（wasm 加载失败 / 白名单拒绝 / 超时）→ 兜底演示列表，页面不白屏
        if (cancelled) return;
        console.warn("[subscriptions] 真实订阅查询失败，降级演示数据：", err);
        setFailedRun(lastRun);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [lastRun]);

  // 数据源判定：lastRun 为空或该次运行查询失败 → 演示列表；查询中取空数组（统计先显示 0，不伪造数字）
  const isDemoMode = lastRun === null || failedRun === lastRun;
  const realReady = realData !== null && realData.run === lastRun;
  const loading = lastRun !== null && failedRun !== lastRun && !realReady;
  const subs = useMemo(
    () => (isDemoMode ? DEMO_SUBSCRIPTIONS : realReady ? realData.subs : []),
    [isDemoMode, realReady, realData],
  );
  const sharePct = isDemoMode ? DEMO_EXPENSE_SHARE_PCT : (realReady ? realData.sharePct : 0);

  // 摘要口径：两条动线都取「单笔均值 × 笔数」求和。演示数据全年均衡扣费，
  // 与滚动 365 天流水求和同值；真实数据为命中商户全窗口合计（近一年近似）
  const yearTotalCents = useMemo(() => subs.reduce((sum, s) => sum + s.totalYearCents, 0), [subs]);

  const [toast, setToast] = useState<{ id: number; text: string; kind: "ok" | "error" } | null>(
    null,
  );
  const showToast = useCallback((text: string, kind: "ok" | "error" = "ok") => {
    setToast({ id: Date.now(), text, kind });
  }, []);
  const onToast = useCallback(
    (text: string, kind: "ok" | "error" = "ok") => showToast(text, kind),
    [showToast],
  );

  const stats = useMemo(
    () => [
      {
        icon: Radar,
        label: "识别出的订阅",
        value: subs.length,
        format: (v: number) => `${Math.round(v)} 项`,
        hint: "自动识别出的连续扣费项目数",
      },
      {
        icon: CalendarClock,
        label: "近一年合计",
        value: yearTotalCents,
        format: (v: number) => `¥${fmtYuan(v)}`,
        hint: "近一年这些订阅一共扣了多少钱",
      },
      {
        icon: ShieldCheck,
        label: "占全年支出",
        value: sharePct,
        format: (v: number) => `${v.toFixed(1)}%`,
        hint: "订阅扣费占全年支出的比例",
      },
      {
        icon: Database,
        label: "年度订阅合计",
        value: yearTotalCents,
        format: (v: number) => `¥${fmtYuan(v)}`,
        hint: "照这个扣费节奏，一年大概要花这么多",
      },
    ],
    [subs.length, yearTotalCents, sharePct],
  );

  return (
    <Container className="py-8">
      {/* 页头 */}
      <header className="flex flex-wrap items-center gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-(--radius-md) bg-(--color-primary-soft) text-(--color-primary)">
          <Radar className="size-6" aria-hidden />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">订阅雷达</h1>
          <p className="text-sm text-(--color-ink-secondary)">
            自动扫描账单里的连续扣费，找出你可能忘了的订阅，每一笔都能点开核对
          </p>
        </div>
        <div className="ml-auto hidden items-center gap-2 sm:flex">
          <span className="rounded-full border border-(--color-border) px-3 py-1 text-xs text-(--color-ink-secondary)">
            近 12 个月
          </span>
          <span className="rounded-full border border-(--color-border) px-3 py-1 text-xs text-(--color-ink-secondary)">
            {isDemoMode ? "内置数据" : "真实数据"}
          </span>
        </div>
      </header>

      {/* 摘要统计 */}
      <section aria-label="订阅摘要" className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </section>

      {/* 订阅卡墙 */}
      <section aria-label="识别出的订阅" className="mt-4 grid gap-4 md:grid-cols-2">
        {loading ? (
          // 真实数据查询中：占位不伪造内容，统计区此时显示 0
          <div className="flex flex-col items-center gap-3 rounded-(--radius-lg) border border-dashed border-(--color-border-strong) bg-(--color-surface) px-6 py-16 text-center md:col-span-2">
            <span className="grid size-14 place-items-center rounded-full bg-(--color-surface-2) text-(--color-ink-muted)">
              <Database className="size-7" aria-hidden />
            </span>
            <h2 className="font-semibold">正在扫描你的账单…</h2>
            <p className="max-w-sm text-sm text-(--color-ink-secondary)">
              正在从你本次体检的结果里找出连续扣费的项目，通常几秒钟就好
            </p>
          </div>
        ) : subs.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-(--radius-lg) border border-dashed border-(--color-border-strong) bg-(--color-surface) px-6 py-16 text-center md:col-span-2">
            <span className="grid size-14 place-items-center rounded-full bg-(--color-surface-2) text-(--color-ink-muted)">
              <Radar className="size-7" aria-hidden />
            </span>
            <h2 className="font-semibold">未发现订阅类扣费</h2>
            <p className="max-w-sm text-sm text-(--color-ink-secondary)">
              这段时间的账单里没有稳定的周期性扣费，说明这份账单很干净。导入更多账单可以查得更全。
            </p>
          </div>
        ) : (
          <>
            {subs.map((sub, index) => (
              <SubscriptionCard
                key={sub.id}
                sub={sub}
                merchantLabel={merchantLabelFor(index)}
                onToast={onToast}
              />
            ))}
            <ScanCoverageCard />
          </>
        )}
      </section>

      {/* 识别说明 + 反馈说明 */}
      <section aria-label="识别与反馈说明" className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-5 shadow-(--shadow-sm)">
          <h2 className="flex items-center gap-2 font-semibold">
            <Database className="size-4 text-(--color-primary)" aria-hidden />
            我们是怎么认出订阅的
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-(--color-ink-secondary)">
            把同一家商户、金额一致的扣费按时间排开：连续扣费 3 次以上、间隔规律、金额一致，就提醒你核对。每笔扣费时间都留在卡片的时间线里，你可以点开逐笔核对。
          </p>
        </div>
        <div className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-5 shadow-(--shadow-sm)">
          <h2 className="flex items-center gap-2 font-semibold">
            <CircleCheck className="size-4 text-(--color-primary)" aria-hidden />
            你的反馈会帮我们改进
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-(--color-ink-secondary)">
            你的每次标记都在帮我们改进识别：点「是订阅」，下次同类扣费会更快被认出；点「误报」，我们会减少对这类扣费的打扰。放心，所有标记只存在你自己的浏览器里，不会上传。
          </p>
          <ul className="mt-3 flex flex-col gap-2 text-sm text-(--color-ink-secondary)">
            <li className="flex gap-2">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-(--color-good)" aria-hidden />
              标记只保存在你的浏览器里，不会上传
            </li>
            <li className="flex gap-2">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-(--color-primary)" aria-hidden />
              扣费提醒同样只保存在你的浏览器里，不上传任何数据
            </li>
            <li className="flex gap-2">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-(--color-warning)" aria-hidden />
              大家的反馈会以匿名方式汇总，用来改进识别，商户名称始终打码
            </li>
          </ul>
        </div>
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
                // 2.6s 后自动收起；新 toast 替换旧 id 时计时器自然失效
                window.setTimeout(() => {
                  setToast((current) => (current?.id === toast.id ? null : current));
                }, 2600);
              }}
              className="flex items-center gap-2 rounded-full bg-(--color-ink) px-4 py-2.5 text-sm text-(--color-surface) shadow-(--shadow-lg)"
            >
              {toast.kind === "ok" ? (
                <CircleCheck className="size-4 text-(--color-good)" aria-hidden />
              ) : (
                <CircleX className="size-4 text-(--color-critical)" aria-hidden />
              )}
              {toast.text}
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
    </Container>
  );
}
