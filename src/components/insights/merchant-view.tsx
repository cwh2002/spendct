"use client";

import type { ECElementEvent } from "echarts/core";
import { ReceiptText, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EChart } from "@/components/charts/e-chart";
import { buildBarOption, formatYuan } from "@/components/charts/option-builders";
import { ChartCard } from "@/components/insights/chart-card";
import { getDuckDB } from "@/lib/duckdb/service";
import { generateLedgerDemoRows } from "@/lib/insights/ledger-demo";
import {
  aggregateMerchants,
  expenseTotalFromDirection,
  merchantAnchorLabel,
  merchantFooterText,
  merchantsFromQuery,
  type MerchantEntry,
} from "@/lib/insights/merchant-aggregate";
import { usePipeline } from "@/lib/pipeline/store";
import { runWhitelistedAggregate } from "@/lib/sql-guard/whitelist";
import type { FollowUpAnchor } from "./follow-up-panel";

interface MerchantViewProps {
  /** 图表数据点点击 → 选中追问（05 §1.6 核心交互，与账本汇总同口径） */
  onAnchor(anchor: FollowUpAnchor): void;
}

/** 图表展示的商户名数：排名图只画头部，完整列表走数据表（白名单上限 50 行） */
const CHART_TOP_N = 10;

/** 白名单聚合行数上限（07 §7 追问档）：超过时按金额取前 50 名，表脚注如实说明 */
const QUERY_ROW_LIMIT = 50;

// ─────────────────── 真实数据动线（07 §6 白名单文法） ───────────────────

/**
 * 商户统计两条聚合 SQL（代码常量，无任何用户输入）：
 * - 商户排名：全账单口径（不设时间窗），按商户分组取支出总额与笔数，
 *   金额降序取前 50 名（白名单 LIMIT 上限）；
 * - 支出总额：按 direction 分组（结果仅 expense/income 两行），
 *   用于计算各商户占全账单总支出的比例。
 * 两条均只取已支付交易（status='paid'，退款不计入），与账本汇总、
 * qa-engine、深度分析（A14）的支出口径一致。
 * 均经 runWhitelistedAggregate 预检执行作双保险（与账本汇总 /report /budget 同口径）。
 */
const SQL_MERCHANT_TOTAL =
  "SELECT merchant, SUM(amount_cents), COUNT(*) FROM transactions WHERE direction = 'expense' AND status = 'paid' " +
  "GROUP BY merchant ORDER BY SUM(amount_cents) DESC LIMIT 50";

const SQL_DIRECTION_TOTAL =
  "SELECT direction, SUM(amount_cents) FROM transactions WHERE status = 'paid' GROUP BY direction";

/** 真实装载结果：null = 查询失败或无数据，整视图回退演示动线 */
interface RealMerchantData {
  /** 商户聚合条目（金额降序，含占比与均笔；已过滤空商户名分组） */
  entries: MerchantEntry[] | null;
  /** 全账单支出总额（分），占比分母 */
  totalCents: number;
  /** 商户排名的原始聚合行数（未过滤空商户名）：截断判定唯一依据 */
  merchantRowCount: number;
}

const EMPTY_REAL_DATA: RealMerchantData = { entries: null, totalCents: 0, merchantRowCount: 0 };

/**
 * 商户消费统计视图（08 修订案 A13，/insights?view=merchants）：
 * 按商户聚合上传账单的全量支出——每个商户的总额、笔数、占全账单比例与均笔金额。
 * 排名横向条形图（前 10 名）+ 全量数据表（上限 50 名，超出如实标注）+ 商户搜索；
 * 数据点点击进入追问面板（与账本汇总同一锚点协议）。
 * 数据动线：体检运行过（lastRun 存在）且 DuckDB 查询成功时展示真实账单聚合
 * （浏览器内计算，账单不出本地），查询失败或无体检结果则回退确定性演示行。
 */
export function MerchantView({ onAnchor }: MerchantViewProps) {
  const [merchantQuery, setMerchantQuery] = useState("");

  // 最近一次体检结果（内存态）：null = 尚无体检记录（含刷新后丢失），整页维持演示动线
  const lastRun = usePipeline((s) => s.lastRun);
  const [realData, setRealData] = useState<RealMerchantData>(EMPTY_REAL_DATA);
  // 演示动线时忽略残留装载结果：渲染期派生，避免在 effect 内同步 setState 重置
  const liveRealData = lastRun ? realData : EMPTY_REAL_DATA;

  // 真实数据装载：lastRun 存在时读 DuckDB（与体检同一单例连接、同一内存数据集）。
  // 两条查询各自 try/catch：任一条失败整视图回退演示动线（占比口径依赖总额查询）
  useEffect(() => {
    if (!lastRun) return; // 演示动线：不查库
    let cancelled = false;
    void (async () => {
      try {
        const conn = await getDuckDB();
        const ranking = await runWhitelistedAggregate(conn, SQL_MERCHANT_TOTAL);
        const direction = await runWhitelistedAggregate(conn, SQL_DIRECTION_TOTAL);
        if (cancelled) return;
        const totalCents = expenseTotalFromDirection(direction.rows);
        const entries = merchantsFromQuery(ranking.rows, totalCents);
        if (entries.length > 0) {
          setRealData({ entries, totalCents, merchantRowCount: ranking.rowCount });
        }
      } catch {
        // 白名单拒绝/查询失败/数据集缺失：保持 null 回退演示动线
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lastRun]);

  // 聚合源：真实装载成功用全账单商户聚合，否则回退确定性演示行（浏览器内聚合）
  const demoRows = useMemo(() => generateLedgerDemoRows(), []);
  const source = useMemo(() => {
    if (liveRealData.entries) {
      return {
        entries: liveRealData.entries,
        totalCents: liveRealData.totalCents,
        real: true,
        // 截断判定用未过滤空名的原始聚合行数：空名分组进入前 50 名时，
        // 展示条数会小于原始行数，用展示条数判截断会误标「全部展示」
        truncated: liveRealData.merchantRowCount >= QUERY_ROW_LIMIT,
      };
    }
    const total = demoRows.reduce((sum, row) => sum + row.amountCents, 0);
    return {
      entries: aggregateMerchants(demoRows, total),
      totalCents: total,
      real: false,
      truncated: false,
    };
  }, [liveRealData, demoRows]);

  // 商户搜索只作用于展示（图表与数据表同步过滤），不改变聚合口径
  const visible = useMemo(() => {
    const query = merchantQuery.trim();
    if (!query) return source.entries;
    return source.entries.filter((entry) => entry.merchant.includes(query));
  }, [source, merchantQuery]);

  const chartEntries = visible.slice(0, CHART_TOP_N);

  const barOption = useMemo(
    () => () =>
      buildBarOption(
        {
          labels: chartEntries.map((entry) => entry.merchant),
          values: chartEntries.map((entry) => entry.cents),
        },
        {
          horizontal: true,
          formatValue: (v) => `¥${formatYuan(v)}`,
          axisFormat: (v) => `¥${Math.round(v / 100)}`,
        },
      ),
    [chartEntries],
  );

  function handleBarClick(params: ECElementEvent) {
    const cents = typeof params.value === "number" ? Math.round(params.value) : 0;
    const entry = chartEntries.find((item) => item.merchant === params.name);
    const share = entry ? entry.share : 0;
    onAnchor({
      id: "merchant-view",
      label: merchantAnchorLabel(String(params.name ?? ""), cents, share),
    });
  }

  /** 数据表行「追问」按钮：与柱子点击同一锚点协议，键盘 / 读屏可到达（05 §6.1） */
  function askFromRow(entry: MerchantEntry) {
    onAnchor({
      id: "merchant-view",
      label: merchantAnchorLabel(entry.merchant, entry.cents, entry.share),
    });
  }

  const shareTotal = source.entries.reduce((sum, entry) => sum + entry.share, 0);
  const caption = source.real
    ? "全账单口径 · 点击柱子或数据表「追问」按钮可以追问"
    : "内置数据 · 点击柱子或数据表「追问」按钮可以追问";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">商户统计</h2>
          <p className="mt-0.5 text-sm text-(--color-ink-secondary)">
            每个商户 / 支付单位的全账单支出总额、笔数与占比 · 点击柱子即可追问
          </p>
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

      <ChartCard
        title="商户支出排名"
        caption={
          visible.length > CHART_TOP_N
            ? `${caption} · 图展示前 ${CHART_TOP_N} 名，完整排名看数据表`
            : caption
        }
        chart={
          visible.length > 0 ? (
            <EChart
              option={barOption}
              height={280}
              ariaLabel="商户支出排名柱状图"
              onClick={handleBarClick}
            />
          ) : (
            <div className="flex h-[280px] flex-col items-center justify-center gap-2 rounded-(--radius-md) border border-dashed border-(--color-border-strong) text-center">
              <p className="text-sm font-medium">没有匹配的商户</p>
              <p className="text-xs text-(--color-ink-secondary)">换个关键词试试</p>
            </div>
          )
        }
        table={
          <div className="max-h-[280px] overflow-auto rounded-(--radius-md) border border-(--color-border)">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="sticky top-0 z-10 bg-(--color-surface)">
                <tr className="border-b border-(--color-border) text-left text-xs text-(--color-ink-muted)">
                  <th scope="col" className="px-3 py-2 font-medium">
                    商户 / 支付单位
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    总额（元）
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    笔数
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    占全账单
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    均笔（元）
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    <span className="sr-only">操作</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((entry) => (
                  <tr
                    key={entry.merchant}
                    className="border-b border-(--color-border) last:border-0 hover:bg-(--color-surface-2)"
                  >
                    <td className="px-3 py-2">{entry.merchant}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">
                      ¥{formatYuan(entry.cents)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-(--color-ink-secondary)">
                      {entry.count}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-(--color-ink-secondary)">
                      {entry.share}%
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-(--color-ink-secondary)">
                      ¥{formatYuan(entry.avgCents)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => askFromRow(entry)}
                        aria-label={`追问${entry.merchant}`}
                        className="rounded-full border border-(--color-border) px-2.5 py-1 text-xs text-(--color-ink-secondary) transition-colors hover:border-(--color-border-strong) hover:text-(--color-ink)"
                      >
                        追问
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {visible.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center">
                <p className="text-sm font-medium">没有匹配的商户</p>
                <p className="text-xs text-(--color-ink-secondary)">换个关键词试试</p>
              </div>
            ) : null}
          </div>
        }
      />

      {/* 数据来源与口径脚注：真实动线如实标注行数上限，演示动线标明内置数据 */}
      <p className="text-xs text-(--color-ink-muted)">
        <ReceiptText className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
        {merchantFooterText({
          real: source.real,
          truncated: source.truncated,
          entryCount: source.entries.length,
          rowLimit: QUERY_ROW_LIMIT,
          totalCents: source.totalCents,
        })}
        <span className="ml-1 text-(--color-ink-muted/70)">
          · 占比为各商户占全账单支出比例（合计约 {Math.round(shareTotal)}%）
        </span>
      </p>
    </div>
  );
}
