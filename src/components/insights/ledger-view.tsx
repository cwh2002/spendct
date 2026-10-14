"use client";

import { RotateCcw, Search, Table2 } from "lucide-react";
import type { ECElementEvent } from "echarts/core";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { EChart } from "@/components/charts/e-chart";
import {
  buildBarOption,
  buildDonutOption,
  buildLineOption,
  formatYuan,
} from "@/components/charts/option-builders";
import { DEMO_ACCOUNT_META, DEMO_INSIGHTS } from "@/lib/demo-data";
import { getDuckDB } from "@/lib/duckdb/service";
import { usePipeline } from "@/lib/pipeline/store";
import { runWhitelistedAggregate } from "@/lib/sql-guard/whitelist";
import type { FollowUpAnchor } from "./follow-up-panel";

interface LedgerViewProps {
  /** 图表数据点点击 → 选中追问（05 §1.6 核心交互） */
  onAnchor(anchor: FollowUpAnchor): void;
}

type LedgerRange = "7d" | "30d" | "90d" | "month" | "all";

const RANGES: { key: LedgerRange; label: string }[] = [
  { key: "7d", label: "近 7 天" },
  { key: "30d", label: "近 30 天" },
  { key: "90d", label: "近 90 天" },
  { key: "month", label: "本月" },
  { key: "all", label: "全部" },
];

const CATEGORY_ORDER = ["餐饮", "购物", "交通", "娱乐", "居住", "其他"] as const;

interface LedgerRow {
  id: number;
  date: Date;
  merchant: string;
  category: string;
  amountCents: number;
}

// ─────────────────── 真实数据动线（07 §6 白名单文法） ───────────────────

/**
 * 账本四块数据的聚合 SQL（代码常量，无任何用户输入）：
 * 仍统一经 runWhitelistedAggregate 预检执行作双保险（与 /report /budget 同口径）。
 * 明细查询按 date_iso/merchant/category 三列分组（白名单 GROUP BY 上限 3 列），
 * 同一商户同一天同类别合并成一行，正好对齐账本「流水汇总」而非逐笔的展示粒度。
 */
const SQL_MONTHLY_TREND =
  "SELECT month, SUM(expense_cents) FROM v_monthly_summary GROUP BY month ORDER BY month DESC LIMIT 12";

const SQL_CATEGORY_TOTAL =
  "SELECT category, SUM(expense_cents) FROM v_category_monthly GROUP BY category";

const SQL_TOP_MERCHANTS =
  "SELECT merchant, SUM(total_cents), SUM(tx_count) FROM v_top_merchants_90d GROUP BY merchant ORDER BY SUM(total_cents) DESC LIMIT 6";

const SQL_RECENT_DETAIL =
  "SELECT date_iso, merchant, category, SUM(amount_cents) FROM transactions WHERE direction = 'expense' GROUP BY date_iso, merchant, category ORDER BY date_iso DESC LIMIT 50";

/** 真实装载结果：null = 该模块查询失败或无数据，对应模块回退演示动线 */
interface RealLedgerData {
  /** 近 12 月支出走势（升序，值已换算为元，与演示 ins-4 同口径） */
  timeseries: { labels: string[]; values: number[] } | null;
  /** 类别支出总额（分），v_category_monthly 聚合结果 */
  categories: { category: string; cents: number }[] | null;
  /** 近 90 天商户排行（分 / 笔），已按金额降序 */
  merchants: { merchant: string; cents: number; count: number }[] | null;
  /** 最近 50 笔支出明细（时间倒序） */
  rows: LedgerRow[] | null;
}

const EMPTY_REAL_DATA: RealLedgerData = {
  timeseries: null,
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

/**
 * DuckDB 月份维度 → YYYY-MM（本地口径，与管线 fmtMonth 一致）：
 * 兼容 Date 对象、epoch 毫秒 number、字符串三种物化形态。
 */
function toMonthKey(value: unknown): string {
  const date =
    value instanceof Date
      ? value
      : typeof value === "number" && Number.isFinite(value)
        ? new Date(value)
        : typeof value === "string"
          ? new Date(value)
          : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** date_iso（YYYY-MM-DD VARCHAR）→ Date；非法值返回 null 由调用方过滤 */
function parseIsoDate(value: unknown): Date | null {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 确定性伪随机：同一种子每次生成同一批演示行，重渲染时明细表不会「洗牌」 */
function mulberry32(seed: number) {
  return function next() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 类别权重（大学生消费口径）：餐饮约占 42%，与下方金额区间换算出的月均约 1,733 元吻合 */
const CATEGORY_WEIGHTS: [string, number][] = [
  ["餐饮", 42],
  ["购物", 20],
  ["交通", 8],
  ["娱乐", 10],
  ["居住", 12],
  ["其他", 8],
];

const MERCHANT_POOL: Record<string, string[]> = {
  餐饮: ["美团外卖", "饿了么", "瑞幸咖啡", "麦当劳", "沙县小吃"],
  购物: ["京东商城", "淘宝", "拼多多", "优衣库", "名创优品"],
  交通: ["滴滴出行", "公交地铁", "中石化", "高德打车"],
  娱乐: ["Steam", "优酷视频", "网易云音乐", "万达影城"],
  居住: ["自如", "国家电网", "自来水公司", "中国移动"],
  其他: ["微信读书", "顺丰速运", "大参林药房", "家乐福"],
};

/** 金额区间（分，大学生口径）：按类别设定，让 90 天合计贴近「月均 1,733 元」 */
const AMOUNT_RANGE: Record<string, [number, number]> = {
  餐饮: [800, 8000],
  购物: [1000, 15000],
  交通: [200, 6000],
  娱乐: [500, 9000],
  居住: [1000, 15000],
  其他: [200, 2500],
};

function pickCategory(rand: () => number): string {
  const roll = rand() * 100;
  let acc = 0;
  for (const [category, weight] of CATEGORY_WEIGHTS) {
    acc += weight;
    if (roll < acc) return category;
  }
  return CATEGORY_WEIGHTS[CATEGORY_WEIGHTS.length - 1]![0];
}

/**
 * 生成 100 行演示明细（时间倒序）：仅作兜底动线——
 * 无体检结果（lastRun 为空）或 DuckDB 明细查询失败时使用；
 * 真实数据已接入（SQL_RECENT_DETAIL 经白名单查询，见组件内装载 effect）。
 */
function generateDemoRows(): LedgerRow[] {
  const rand = mulberry32(20261013);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const rows: LedgerRow[] = [];
  for (let i = 0; i < 100; i++) {
    const category = pickCategory(rand);
    const pool = MERCHANT_POOL[category] ?? ["未知商户"];
    const merchant = pool[Math.floor(rand() * pool.length)] ?? "未知商户";
    const [min, max] = AMOUNT_RANGE[category] ?? [100, 5000];
    const amountCents = Math.round(min + rand() * (max - min));
    const date = new Date(today);
    date.setDate(date.getDate() - Math.floor(rand() * 90));
    rows.push({ id: i + 1, date, merchant, category, amountCents });
  }
  return rows.sort((a, b) => b.date.getTime() - a.date.getTime());
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

/** 图表卡：标题 + 数据表切换（05 §3.6 规则 6 的无障碍救济），图表与表格等价表达 */
function ChartCard({
  title,
  caption,
  chart,
  table,
}: {
  title: string;
  caption?: string;
  chart: ReactNode;
  table: ReactNode;
}) {
  const [tableMode, setTableMode] = useState(false);
  return (
    <section className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-4 shadow-(--shadow-sm)">
      <header className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          {caption ? <p className="mt-0.5 text-xs text-(--color-ink-muted)">{caption}</p> : null}
        </div>
        <button
          type="button"
          onClick={() => setTableMode((v) => !v)}
          aria-pressed={tableMode}
          className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors ${
            tableMode
              ? "border-(--color-primary)/40 bg-(--color-primary-soft) text-(--color-brand-600)"
              : "border-(--color-border) text-(--color-ink-muted) hover:border-(--color-border-strong) hover:text-(--color-ink-secondary)"
          }`}
        >
          <Table2 className="size-3.5" aria-hidden />
          {tableMode ? "图表" : "数据表"}
        </button>
      </header>
      {tableMode ? table : chart}
    </section>
  );
}

/** 简易两列表格：图表数据表的通用载体 */
function MiniTable({ headers, rows }: { headers: [string, string]; rows: [string, string][] }) {
  return (
    <div className="h-[260px] overflow-y-auto rounded-(--radius-md) border border-(--color-border)">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-(--color-surface)">
          <tr className="border-b border-(--color-border) text-left text-xs text-(--color-ink-muted)">
            <th scope="col" className="px-3 py-2 font-medium">
              {headers[0]}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {headers[1]}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} className="border-b border-(--color-border) last:border-0">
              <td className="px-3 py-1.5 text-(--color-ink-secondary)">{label}</td>
              <td className="px-3 py-1.5 text-right font-medium tabular-nums">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 账本汇总视图（05 §1.6，原 /ledger 并入 /insights）：
 * 筛选行 + 支出走势 / 类别 donut / 商户排行三图（内置数据表切换与选中点击）+ 明细表。
 * 数据动线：体检运行过（lastRun 存在）且 DuckDB 查询成功时展示真实账单聚合，
 * 任一模块查询失败或无体检结果则回退内置数据演示动线（generateDemoRows）。
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
  // 四块数据各自 try/catch 模块级降级：哪块失败哪块回退演示，不阻断其余模块
  useEffect(() => {
    if (!lastRun) return; // 演示动线：不查库
    let cancelled = false;
    void (async () => {
      const loaded: RealLedgerData = { ...EMPTY_REAL_DATA };
      try {
        const conn = await getDuckDB();
        try {
          const result = await runWhitelistedAggregate(conn, SQL_MONTHLY_TREND);
          const series = (result.rows as Record<string, unknown>[])
            .map((row) => {
              const values = Object.values(row);
              return { monthKey: toMonthKey(values[0]), yuan: toCents(values[1]) / 100 };
            })
            .filter((row) => row.monthKey !== "")
            .reverse(); // SQL 侧 month DESC → 升序展示
          if (series.length > 0) {
            loaded.timeseries = {
              labels: series.map((row) => row.monthKey),
              values: series.map((row) => row.yuan),
            };
          }
        } catch {
          // 走势查询失败 → timeseries 保持 null，回退演示 ins-4
        }
        try {
          const result = await runWhitelistedAggregate(conn, SQL_CATEGORY_TOTAL);
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
          const result = await runWhitelistedAggregate(conn, SQL_TOP_MERCHANTS);
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
          const result = await runWhitelistedAggregate(conn, SQL_RECENT_DETAIL);
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
          // 明细查询失败 → rows 保持 null，回退 generateDemoRows
        }
      } catch {
        // getDuckDB 初始化失败：整页维持演示动线
      }
      if (!cancelled) setRealData(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [lastRun]);

  // 明细数据源：真实装载成功用最近 50 笔，否则回退确定性演示行（查询失败/无数据集）
  const allRows = useMemo(
    () => liveRealData.rows ?? generateDemoRows(),
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

  // 类别聚合（真实：v_category_monthly 全量结果；演示：占所选时间范围的总支出份额）
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

  // 商户排行（真实：v_top_merchants_90d 前 6；演示：所选时间范围 + 类别内取前 6）
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

  // 支出时间序列：真实装载成功用近 12 月聚合；否则取 DEMO_INSIGHTS.ins-4
  // （demo 单一来源，不再内置硬编码兜底数组，缺位时留空由图表自然处理）
  const ins4 = DEMO_INSIGHTS.find((insight) => insight.id === "ins-4");
  const timeseries = useMemo(
    () =>
      liveRealData.timeseries ?? {
        labels: ins4?.chartLabels ?? [],
        values: ins4?.chartData ?? [],
      },
    [liveRealData.timeseries, ins4],
  );

  const lineOption = useMemo(
    () => () =>
      buildLineOption(timeseries, {
        // 千分位 + 固定两位小数：tooltip 与轴刻度（¥ 整数元）各自独立，避免小数位漂移
        formatValue: (v) =>
          v.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        unit: " 元",
        axisFormat: (v) => `¥${Math.round(v)}`,
      }),
    [timeseries],
  );
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

  function handleTimeseriesClick(params: ECElementEvent) {
    onAnchor({ id: "ledger-timeseries", label: `${params.name ?? ""} 支出 ${String(params.value ?? "")} 元` });
  }

  function handleDonutClick(params: ECElementEvent) {
    const percent = typeof params.percent === "number" ? `${params.percent}%` : "";
    onAnchor({
      id: "ledger-donut",
      label: `${params.name ?? ""} 占所选时间范围 ${percent}`,
    });
  }

  function handleMerchantClick(params: ECElementEvent) {
    const cents = typeof params.value === "number" ? Math.round(params.value) : 0;
    onAnchor({ id: "ledger-merchant", label: `${params.name ?? ""} 合计 ¥${formatYuan(cents)}` });
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
        <div className="md:col-span-2">
          <ChartCard
            title="支出走势（月）"
            caption={
              liveRealData.timeseries ? "近 12 个月 · 点击柱子可以追问" : "内置数据 · 点击柱子可以追问"
            }
            chart={
              <EChart
                option={lineOption}
                height={260}
                ariaLabel="月度支出折线图"
                onClick={handleTimeseriesClick}
              />
            }
            table={
              <MiniTable
                headers={["月份", "支出（元）"]}
                rows={timeseries.labels.map((label, i) => [
                  label,
                  `${(timeseries.values[i] ?? 0).toLocaleString("zh-CN", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}`,
                ])}
              />
            }
          />
        </div>
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
                ? // 真实动线：明细查询 LIMIT 50，展示最近 50 笔
                  `最近 ${liveRealData.rows.length} 笔${tableRows.length !== liveRealData.rows.length ? `（筛选后 ${tableRows.length} 笔）` : ""}`
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
