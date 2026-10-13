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
import { useCallback, useMemo, useState } from "react";

import { Container } from "@/components/layout/container";
import { SubscriptionCard } from "@/components/subscriptions/subscription-card";
import { useCountUp } from "@/components/subscriptions/use-count-up";
import { DEMO_SUBSCRIPTIONS } from "@/lib/demo-data";

/** 演示口径：订阅年度合计 / 年度总支出，与 DEMO_ACCOUNT_META 咬合 */
const DEMO_EXPENSE_SHARE_PCT = 1.7;

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

/** 扫描口径卡：与三张订阅卡拼齐 2×2 网格，同时交代识别方式的确定性边界 */
function ScanCoverageCard() {
  const rows = [
    { icon: Database, label: "规则库", value: "12 条确定性 SQL" },
    { icon: CalendarClock, label: "扫描窗口", value: "近 12 个月" },
    { icon: ShieldCheck, label: "商户标识", value: "脱敏 m_+8hex" },
    { icon: CircleCheck, label: "误报", value: "0 笔（待你复核）" },
  ] as const;
  return (
    <div className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-5 shadow-(--shadow-sm)">
      <h2 className="flex items-center gap-2 font-semibold">
        <Radar className="size-4 text-(--color-primary)" aria-hidden />
        扫描口径
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
        命中即附规则编号与扣费流水证据，每一条都可以点开核对。
      </p>
    </div>
  );
}

const NOTIF_KEY = "spendct:notif:v1";
const LABEL_KEY = "spendct:sub-labels";

export default function SubscriptionsPage() {
  const subs = DEMO_SUBSCRIPTIONS;

  // 摘要口径：近一年合计与年度订阅合计在演示数据中同源（全年均衡扣费），
  // 真实数据下前者为滚动 365 天流水求和，后者为年化折算，二者会分开
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

  const stats = [
    {
      icon: Radar,
      label: "命中订阅",
      value: subs.length,
      format: (v: number) => `${Math.round(v)} 项`,
      hint: "全部经确定性 SQL 命中",
    },
    {
      icon: CalendarClock,
      label: "近一年合计",
      value: yearTotalCents,
      format: (v: number) => `¥${fmtYuan(v)}`,
      hint: "滚动 365 天扣费流水",
    },
    {
      icon: ShieldCheck,
      label: "占支出",
      value: DEMO_EXPENSE_SHARE_PCT,
      format: (v: number) => `${v.toFixed(1)}%`,
      hint: "订阅年化 / 年度总支出",
    },
    {
      icon: Database,
      label: "年度订阅合计",
      value: yearTotalCents,
      format: (v: number) => `¥${fmtYuan(v)}`,
      hint: "年化折算 · 12 个月",
    },
  ] as const;

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
            确定性 SQL 规则扫描连续扣费，不依赖大模型判断，每一条命中都可复核
          </p>
        </div>
        <div className="ml-auto hidden items-center gap-2 sm:flex">
          <span className="rounded-full border border-(--color-border) px-3 py-1 text-xs text-(--color-ink-secondary)">
            近 12 个月
          </span>
          <span className="rounded-full border border-(--color-border) px-3 py-1 text-xs text-(--color-ink-secondary)">
            演示数据
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
      <section aria-label="命中的订阅" className="mt-4 grid gap-4 md:grid-cols-2">
        {subs.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-(--radius-lg) border border-dashed border-(--color-border-strong) bg-(--color-surface) px-6 py-16 text-center md:col-span-2">
            <span className="grid size-14 place-items-center rounded-full bg-(--color-surface-2) text-(--color-ink-muted)">
              <Radar className="size-7" aria-hidden />
            </span>
            <h2 className="font-semibold">未发现订阅类扣费</h2>
            <p className="max-w-sm text-sm text-(--color-ink-secondary)">
              规则扫描窗口内没有稳定的周期性扣费，说明这份账单很干净。上传更多账单可以扩大扫描范围。
            </p>
          </div>
        ) : (
          <>
            {subs.map((sub) => (
              <SubscriptionCard key={sub.id} sub={sub} onToast={onToast} />
            ))}
            <ScanCoverageCard />
          </>
        )}
      </section>

      {/* 口径说明：确定性 SQL + 打标回流评测集 */}
      <section aria-label="识别与评测口径" className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-5 shadow-(--shadow-sm)">
          <h2 className="flex items-center gap-2 font-semibold">
            <Database className="size-4 text-(--color-primary)" aria-hidden />
            识别规则：确定性 SQL
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-(--color-ink-secondary)">
            订阅识别不经过大模型：DuckDB 内按脱敏商户分箱 + 金额分箱聚合，
            用窗口函数计算相邻扣费间隔的稳定性，命中后由规则编号直接给出证据链，不存在幻觉空间。
          </p>
          <pre className="mt-3 overflow-x-auto rounded-(--radius-md) bg-(--color-surface-page) p-3 font-(--font-mono) text-[11px] leading-relaxed text-(--color-ink-secondary)">
            <code>{`-- sql:subscription_patterns（简化口径）
SELECT merchant_bucket, amount_cents, COUNT(*) AS hits
FROM (
  SELECT *,
    date_diff('day', LAG(charge_date) OVER w, charge_date) AS gap_days
  FROM txn WHERE is_charge = 1
  WINDOW w AS (PARTITION BY merchant_bucket, amount_cents
               ORDER BY charge_date)
)
WHERE gap_days IS NOT NULL
GROUP BY 1, 2
HAVING COUNT(*) >= 4 AND MAX(ABS(gap_days - 30)) <= 2;`}</code>
          </pre>
        </div>
        <div className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-5 shadow-(--shadow-sm)">
          <h2 className="flex items-center gap-2 font-semibold">
            <CircleCheck className="size-4 text-(--color-primary)" aria-hidden />
            打标回流：评测集口径
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-(--color-ink-secondary)">
            点下「是订阅 / 误报」即完成一次打标：
            <span className="font-(--font-mono) text-xs">
              {`{merchantRef, ruleId, label}`}
            </span>{" "}
            三元组进入离线评测集。命中且确认记 TP，命中但误报记 FP，
            规则按精确率迭代，下一版只在误报收敛后上线。
          </p>
          <ul className="mt-3 flex flex-col gap-2 text-sm text-(--color-ink-secondary)">
            <li className="flex gap-2">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-(--color-good)" aria-hidden />
              演示模式下标记仅保存在浏览器本地（{LABEL_KEY}）
            </li>
            <li className="flex gap-2">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-(--color-primary)" aria-hidden />
              扣费提醒同样只写本机（{NOTIF_KEY}），不上传任何数据
            </li>
            <li className="flex gap-2">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-(--color-warning)" aria-hidden />
              正式版经匿名通道回流评测集，商户标识保持脱敏
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
