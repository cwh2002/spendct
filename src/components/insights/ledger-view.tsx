"use client";

import { RotateCcw, Search, Table2 } from "lucide-react";
import type { ECElementEvent } from "echarts/core";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { EChart } from "@/components/charts/e-chart";
import {
  buildBarOption,
  buildDonutOption,
  buildLineOption,
  formatYuan,
} from "@/components/charts/option-builders";
import { DEMO_INSIGHTS } from "@/lib/demo-data";
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

/** 确定性伪随机：同一种子每次生成同一批演示行，重渲染时明细表不会「洗牌」 */
function mulberry32(seed: number) {
  return function next() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 类别权重与 ins-1 的类目占比同口径（餐饮 34% / 购物 22% / …） */
const CATEGORY_WEIGHTS: [string, number][] = [
  ["餐饮", 34],
  ["购物", 22],
  ["交通", 14],
  ["娱乐", 12],
  ["居住", 10],
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

/** 金额区间（分）：按类别设定，让 90 天合计贴近「月均 2,860 元」的演示口径 */
const AMOUNT_RANGE: Record<string, [number, number]> = {
  餐饮: [800, 6800],
  购物: [2500, 26000],
  交通: [200, 6500],
  娱乐: [1500, 12800],
  居住: [4000, 16000],
  其他: [600, 5200],
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

/** 生成 100 行演示明细（时间倒序）；全量 3,214 行在 DuckDB 接入后替换 */
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
 */
export function LedgerView({ onAnchor }: LedgerViewProps) {
  const [range, setRange] = useState<LedgerRange>("90d");
  const [category, setCategory] = useState("all");
  const [merchantQuery, setMerchantQuery] = useState("");

  const allRows = useMemo(() => generateDemoRows(), []);

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

  // 类别聚合（占所选时间范围的总支出份额）
  const categoryAgg = useMemo(() => {
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
  }, [rangeRows]);

  // 商户排行（所选时间范围 + 类别内，取前 6）
  const merchantAgg = useMemo(() => {
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
  }, [categoryRows]);

  // 支出时间序列数据源 = DEMO_INSIGHTS.ins-4（demo 单一来源，缺位时退内置常量）
  const ins4 = DEMO_INSIGHTS.find((insight) => insight.id === "ins-4");
  const timeseries = useMemo(
    () => ({
      labels: ins4?.chartLabels ?? ["5月", "6月", "7月", "8月", "9月", "10月"],
      values: ins4?.chartData ?? [2100, 2280, 2140, 2390, 2260, 2640],
    }),
    [ins4],
  );

  const lineOption = useMemo(
    () => () => buildLineOption(timeseries, { formatValue: (v) => v.toLocaleString("zh-CN"), unit: " 元" }),
    [timeseries],
  );
  const donutOption = useMemo(
    () => () =>
      buildDonutOption(
        {
          labels: categoryAgg.map((entry) => entry.category),
          values: categoryAgg.map((entry) => entry.share),
        },
        { dimExcept: category === "all" ? undefined : category },
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
        { horizontal: true, formatValue: (v) => `¥${formatYuan(v)}` },
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
            caption="演示数据 · 点击柱子可以追问"
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
                  `${(timeseries.values[i] ?? 0).toLocaleString("zh-CN")}`,
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
              共 3,214 笔 · 展示最近 100 笔{tableRows.length !== 100 ? `（筛选后 ${tableRows.length} 笔）` : ""}
            </p>
          </div>
          <p className="text-xs text-(--color-ink-muted)">当前展示的是演示数据</p>
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
