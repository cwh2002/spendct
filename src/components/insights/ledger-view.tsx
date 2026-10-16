"use client";

import { RotateCcw, Search } from "lucide-react";
import type { ECElementEvent } from "echarts/core";
import { useEffect, useMemo, useState } from "react";
import { EChart } from "@/components/charts/e-chart";
import { buildBarOption, buildDonutOption, formatYuan } from "@/components/charts/option-builders";
import { ChartCard } from "@/components/insights/chart-card";
import { MiniTable } from "@/components/insights/mini-table";
import { DEMO_ACCOUNT_META } from "@/lib/demo-data";
import { getDuckDB } from "@/lib/duckdb/service";
import { generateLedgerDemoRows, type LedgerDemoRow } from "@/lib/insights/ledger-demo";
import {
  categorySql,
  detailSql,
  merchantSql,
  type LedgerRange,
} from "@/lib/insights/ledger-sql";
import { usePipeline } from "@/lib/pipeline/store";
import { runWhitelistedAggregate } from "@/lib/sql-guard/whitelist";
import type { FollowUpAnchor } from "./follow-up-panel";

interface LedgerViewProps {
  /** 图表数据点点击 → 选中追问（05 §1.6 核心交互） */
  onAnchor(anchor: FollowUpAnchor): void;
}

/**
 * 日期范围筛选项。windowLabel 是进锚点标签的时间窗关键词写法（08 修订案 A18）：
 * 与 qa-engine 的 WINDOW_WORDS 对齐，锚点追问才能继承正确的时间窗——
 * 修复前锚点只写「占所选时间范围」，追问引擎识别不到时间窗，兜底成本月。
 */
const RANGES: { key: LedgerRange; label: string; windowLabel: string }[] = [
  { key: "7d", label: "近 7 天", windowLabel: "近7天" },
  { key: "30d", label: "近 30 天", windowLabel: "近30天" },
  { key: "90d", label: "近 90 天", windowLabel: "近90天" },
  { key: "month", label: "本月", windowLabel: "本月" },
  { key: "all", label: "全部", windowLabel: "整个账单" },
];

const CATEGORY_ORDER = ["餐饮", "购物", "交通", "娱乐", "居住", "其他"] as const;

/** 账本明细行：与商户统计视图共用同一演示行形态（见 ledger-demo.ts） */
type LedgerRow = LedgerDemoRow;

// ─────────────────── 真实数据动线（07 §6 白名单文法） ───────────────────

// 三块聚合 SQL 模板集中在 src/lib/insights/ledger-sql.ts（纯函数）：
// 日期范围筛选同步作用到类别 / 商户 / 明细三块，范围按钮在真实动线下同样生效。

/** 真实装载结果：null = 该模块查询失败或无数据，对应模块回退演示动线 */
interface RealLedgerData {
  /** 所选时间范围的类别支出总额（分），金额降序前 6 */
  categories: { category: string; cents: number }[] | null;
  /** 所选时间范围的商户排行（分 / 笔），已按金额降序 */
  merchants: { merchant: string; cents: number; count: number }[] | null;
  /** 所选时间范围的最近 50 笔支出明细（时间倒序） */
  rows: LedgerRow[] | null;
}

const EMPTY_REAL_DATA: RealLedgerData = {
  categories: null,
  merchants: null,
  rows: null,
};

/**
 * DuckDB 聚合值兜底转数值：BIGINT → bigint、INTEGER → number、
 * HUGEINT/SUM → 128 位大数对象（Number() 经 valueOf 转数值）。不可解析时兜底 0。
 */
function toCents(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return Math.round(value);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

/** date_iso（YYYY-MM-DD VARCHAR）→ Date；非法值返回 null 由调用方过滤 */
function parseIsoDate(value: unknown): Date | null {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function inRange(row: LedgerRow, range: LedgerRange, now: Date): boolean {
  if (range === "all") return true;
  const daysAgo = Math.floor((now.getTime() - row.date.getTime()) / 86_400_000);
  if (range === "7d") return daysAgo <= 7;
  if (range === "30d") return daysAgo <= 30;
  if (range === "90d") return daysAgo <= 90;
  return row.date.getFullYear() === now.getFullYear() && row.date.getMonth() === now.getMonth();
}

/**
 * 账本汇总视图（05 §1.6，原 /ledger 并入 /insights）：
 * 筛选行 + 类别 donut / 商户排行两图（内置数据表切换与选中点击）+ 明细表。
 * 日期范围筛选同步作用到全部图表与明细（真实动线由 SQL 日期下限过滤，
 * 演示动线按行日期过滤）；支出走势（月）已迁至商户统计视图。
 * 数据动线：体检运行过（lastRun 存在）且 DuckDB 查询成功时展示真实账单聚合，
 * 任一模块查询失败或无体检结果则回退内置数据演示动线（generateLedgerDemoRows）。
 */
export function LedgerView({ onAnchor }: LedgerViewProps) {
  const [range, setRange] = useState<LedgerRange>("90d");
  const [category, setCategory] = useState("all");
  const [merchantQuery, setMerchantQuery] = useState("");

  // 最近一次体检结果（内存态）：null = 尚无体检记录（含刷新后丢失），整页维持演示动线
  const lastRun = usePipeline((s) => s.lastRun);
  const [realData, setRealData] = useState<RealLedgerData>(EMPTY_REAL_DATA);
  // 演示动线时忽略残留装载结果：渲染期派生，避免在 effect 内同步 setState 重置
  const liveRealData = lastRun ? realData : EMPTY_REAL_DATA;

  // 真实数据装载：lastRun 存在时读 DuckDB（与体检同一单例连接、同一内存数据集）。
  // 日期范围变化时按新范围重查（真实动线的范围筛选，SQL 见模板函数注释）；
  // 三块数据各自 try/catch 模块级降级：哪块失败哪块回退演示，不阻断其余模块
  useEffect(() => {
    if (!lastRun) return; // 演示动线：不查库
    let cancelled = false;
    const now = new Date();
    void (async () => {
      const loaded: RealLedgerData = { ...EMPTY_REAL_DATA };
      try {
        const conn = await getDuckDB();
        try {
          const result = await runWhitelistedAggregate(conn, categorySql(range, now));
          const rows = (result.rows as Record<string, unknown>[])
            .map((row) => {
              const values = Object.values(row);
              return { category: String(values[0] ?? ""), cents: toCents(values[1]) };
            })
            .filter((row) => row.category !== "" && row.cents > 0);
          if (rows.length > 0) loaded.categories = rows;
        } catch {
          // 类别查询失败 → categories 保持 null，回退按演示行聚合
        }
        try {
          const result = await runWhitelistedAggregate(conn, merchantSql(range, now));
          const rows = (result.rows as Record<string, unknown>[])
            .map((row) => {
              const values = Object.values(row);
              return {
                merchant: String(values[0] ?? ""),
                cents: toCents(values[1]),
                count: toCents(values[2]),
              };
            })
            .filter((row) => row.merchant !== "");
          if (rows.length > 0) loaded.merchants = rows;
        } catch {
          // 商户查询失败 → merchants 保持 null，回退按演示行聚合
        }
        try {
          const result = await runWhitelistedAggregate(conn, detailSql(range, now));
          const rows = (result.rows as Record<string, unknown>[])
            .map((row, i) => {
              const values = Object.values(row);
              const date = parseIsoDate(values[0]);
              return {
                id: i + 1,
                date: date ?? new Date(0),
                merchant: String(values[1] ?? "未知商户"),
                category: String(values[2] ?? "其他"),
                amountCents: toCents(values[3]),
              };
            })
            .filter((row) => row.date.getTime() > 0);
          if (rows.length > 0) loaded.rows = rows;
        } catch {
          // 明细查询失败 → rows 保持 null，回退 generateLedgerDemoRows
        }
      } catch {
        // getDuckDB 初始化失败：整页维持演示动线
      }
      if (!cancelled) setRealData(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [lastRun, range]);

  // 明细数据源：真实装载成功用最近 50 笔，否则回退确定性演示行（查询失败/无数据集）
  const allRows = useMemo(
    () => liveRealData.rows ?? generateLedgerDemoRows(),
    [liveRealData.rows],
  );

  // 日期范围作用于全部图表与明细；类别作用于 donut 高亮与商户排行；商户搜索只作用于明细表
  const now = useMemo(() => new Date(), []);
  const rangeRows = useMemo(
    () => allRows.filter((row) => inRange(row, range, now)),
    [allRows, range, now],
  );
  const categoryRows = useMemo(
    () => rangeRows.filter((row) => category === "all" || row.category === category),
    [rangeRows, category],
  );
  const tableRows = useMemo(
    () =>
      categoryRows.filter(
        (row) => !merchantQuery.trim() || row.merchant.includes(merchantQuery.trim()),
      ),
    [categoryRows, merchantQuery],
  );

  // 类别聚合（真实：所选时间范围的聚合结果；演示：占所选时间范围的总支出份额）
  const categoryAgg = useMemo(() => {
    if (liveRealData.categories) {
      const total = liveRealData.categories.reduce((sum, c) => sum + c.cents, 0);
      return liveRealData.categories
        .map((c) => ({
          category: c.category,
          cents: c.cents,
          count: 0,
          share: total > 0 ? Math.round((c.cents / total) * 1000) / 10 : 0,
        }))
        .sort((a, b) => b.cents - a.cents);
    }
    const map = new Map<string, { cents: number; count: number }>();
    for (const row of rangeRows) {
      const entry = map.get(row.category) ?? { cents: 0, count: 0 };
      entry.cents += row.amountCents;
      entry.count += 1;
      map.set(row.category, entry);
    }
    const total = [...map.values()].reduce((sum, entry) => sum + entry.cents, 0);
    return CATEGORY_ORDER.map((cat) => ({
      category: cat,
      cents: map.get(cat)?.cents ?? 0,
      count: map.get(cat)?.count ?? 0,
      share: total > 0 ? Math.round(((map.get(cat)?.cents ?? 0) / total) * 1000) / 10 : 0,
    })).filter((entry) => entry.cents > 0);
  }, [liveRealData.categories, rangeRows]);

  // 商户排行（真实：所选时间范围前 6；演示：所选时间范围 + 类别内取前 6）
  const merchantAgg = useMemo(() => {
    if (liveRealData.merchants) return liveRealData.merchants;
    const map = new Map<string, { cents: number; count: number }>();
    for (const row of categoryRows) {
      const entry = map.get(row.merchant) ?? { cents: 0, count: 0 };
      entry.cents += row.amountCents;
      entry.count += 1;
      map.set(row.merchant, entry);
    }
    return [...map.entries()]
      .map(([merchant, entry]) => ({ merchant, ...entry }))
      .sort((a, b) => b.cents - a.cents)
      .slice(0, 6);
  }, [liveRealData.merchants, categoryRows]);

  const donutOption = useMemo(
    () => () =>
      buildDonutOption(
        {
          labels: categoryAgg.map((entry) => entry.category),
          // 传分为刻度：占比与 share 等比不变，tooltip 得以报「名称：¥金额（占比%）」
          values: categoryAgg.map((entry) => entry.cents),
        },
        {
          dimExcept: category === "all" ? undefined : category,
          formatValue: (v) => `¥${formatYuan(v)}`,
          legendWithValue: categoryAgg.length <= 5,
        },
      ),
    [categoryAgg, category],
  );
  const barOption = useMemo(
    () => () =>
      buildBarOption(
        {
          labels: merchantAgg.map((entry) => entry.merchant),
          values: merchantAgg.map((entry) => entry.cents),
        },
        {
          horizontal: true,
          formatValue: (v) => `¥${formatYuan(v)}`,
          axisFormat: (v) => `¥${Math.round(v / 100)}`,
        },
      ),
    [merchantAgg],
  );

  // 当前日期范围的时间窗关键词：写进锚点标签，追问引擎据此继承时间窗
  const rangeWindowLabel =
    RANGES.find((item) => item.key === range)?.windowLabel ?? "所选时间范围";

  function handleDonutClick(params: ECElementEvent) {
    const percent = typeof params.percent === "number" ? `${params.percent}%` : "";
    onAnchor({
      id: "ledger-donut",
      label: `${params.name ?? ""} 占${rangeWindowLabel}支出 ${percent}`,
    });
  }

  function handleMerchantClick(params: ECElementEvent) {
    const cents = typeof params.value === "number" ? Math.round(params.value) : 0;
    onAnchor({
      id: "ledger-merchant",
      label: `${params.name ?? ""} ${rangeWindowLabel}合计 ¥${formatYuan(cents)}`,
    });
  }

  const filtersDirty = range !== "90d" || category !== "all" || merchantQuery.trim() !== "";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">账本汇总</h2>
          <p className="mt-0.5 text-sm text-(--color-ink-secondary)">
            点击任意图表数据点即可追问 · 日期范围会同步到全部图表与明细
          </p>
        </div>
        {filtersDirty ? (
          <button
            type="button"
            onClick={() => {
              setRange("90d");
              setCategory("all");
              setMerchantQuery("");
            }}
            className="flex h-11 items-center gap-1.5 rounded-full px-3.5 text-sm text-(--color-ink-muted) transition-colors hover:text-(--color-ink-secondary)"
          >
            <RotateCcw className="size-3.5" aria-hidden />
            重置筛选
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2" aria-label="账本筛选">
        <div role="group" aria-label="日期范围" className="flex flex-wrap gap-1.5">
          {RANGES.map((item) => {
            const active = range === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setRange(item.key)}
                aria-pressed={active}
                className={`h-11 rounded-full border px-3.5 text-sm font-medium transition-colors ${
                  active
                    ? "border-(--color-primary) bg-(--color-primary-soft) text-(--color-brand-600)"
                    : "border-(--color-border) bg-(--color-surface) text-(--color-ink-secondary) hover:border-(--color-border-strong) hover:text-(--color-ink)"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
        <div className="relative">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label="按类别筛选"
            className="h-11 appearance-none rounded-(--radius-md) border border-(--color-border) bg-(--color-surface) pl-3.5 pr-8 text-sm text-(--color-ink) transition-colors hover:border-(--color-border-strong)"
          >
            <option value="all">全部类别</option>
            {CATEGORY_ORDER.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
          <span
            aria-hidden
            className="pointer-events-none absolute right-3 top-1/2 size-3 -translate-y-1/2 rounded-full border border-current text-(--color-ink-muted)"
          />
        </div>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-(--color-ink-muted)"
            aria-hidden
          />
          <input
            type="search"
            value={merchantQuery}
            onChange={(e) => setMerchantQuery(e.target.value)}
            placeholder="搜索商户"
            aria-label="搜索商户"
            className="h-11 w-44 rounded-full border border-(--color-border) bg-(--color-surface) pl-10 pr-4 text-sm text-(--color-ink) placeholder:text-(--color-ink-muted) transition-colors hover:border-(--color-border-strong) sm:w-56"
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ChartCard
          title="类别构成"
          caption={category === "all" ? "所选时间范围 · 点击扇区可以追问" : `高亮：${category}（其余扇区淡显）`}
          chart={
            <EChart option={donutOption} height={260} ariaLabel="类别构成环图" onClick={handleDonutClick} />
          }
          table={
            <MiniTable
              headers={["类别", "金额（元）/ 占比"]}
              rows={categoryAgg.map((entry) => [
                entry.category,
                `¥${formatYuan(entry.cents)} · ${entry.share}%`,
              ])}
            />
          }
        />
        <ChartCard
          title="商户排行"
          caption={category === "all" ? "所选时间范围 · 前 6 名" : `${category} · 前 6 名`}
          chart={
            <EChart option={barOption} height={260} ariaLabel="商户消费排行柱状图" onClick={handleMerchantClick} />
          }
          table={
            <MiniTable
              headers={["商户", "金额（元）/ 笔数"]}
              rows={merchantAgg.map((entry) => [
                entry.merchant,
                `¥${formatYuan(entry.cents)} · ${entry.count} 笔`,
              ])}
            />
          }
        />
      </div>

      <div className="overflow-hidden rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) shadow-(--shadow-sm)">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-(--color-border) px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold">明细表</h3>
            <p className="mt-0.5 text-xs text-(--color-ink-muted)">
              {liveRealData.rows
                ? // 真实动线：明细查询按所选范围过滤 + LIMIT 50
                  `所选时间范围 · 最近 ${liveRealData.rows.length} 笔${tableRows.length !== liveRealData.rows.length ? `（筛选后 ${tableRows.length} 笔）` : ""}`
                : // 演示动线：总数读 DEMO_ACCOUNT_META，避免文案与数据源脱钩
                  `共 ${DEMO_ACCOUNT_META.totalTransactions.toLocaleString("zh-CN")} 笔 · 展示最近 100 笔${tableRows.length !== 100 ? `（筛选后 ${tableRows.length} 笔）` : ""}`}
            </p>
          </div>
          <p className="text-xs text-(--color-ink-muted)">
            {liveRealData.rows ? "当前展示的是你的账单数据" : "当前展示的是内置数据"}
          </p>
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-(--color-surface)">
              <tr className="border-b border-(--color-border) text-left text-xs text-(--color-ink-muted)">
                <th scope="col" className="px-4 py-2.5 font-medium">
                  时间
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  商户
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  类别
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  金额（元）
                </th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row) => (
                <tr key={row.id} className="border-b border-(--color-border) last:border-0 hover:bg-(--color-surface-2)">
                  <td className="px-4 py-2.5 font-mono text-xs tabular-nums text-(--color-ink-secondary)">
                    {formatDate(row.date)}
                  </td>
                  <td className="px-4 py-2.5">{row.merchant}</td>
                  <td className="px-4 py-2.5">
                    <span className="rounded-full bg-(--color-surface-2) px-2 py-0.5 text-xs text-(--color-ink-secondary)">
                      {row.category}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                    ¥{formatYuan(row.amountCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {tableRows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
              <p className="text-sm font-medium">所选时间范围内没有交易</p>
              <p className="text-xs text-(--color-ink-secondary)">试试放宽时间范围，或清除部分筛选条件</p>
              <button
                type="button"
                onClick={() => {
                  setRange("90d");
                  setCategory("all");
                  setMerchantQuery("");
                }}
                className="h-10 rounded-full border border-(--color-border) bg-(--color-surface) px-4 text-sm font-medium text-(--color-ink-secondary) transition-colors hover:border-(--color-border-strong)"
              >
                清除筛选
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
