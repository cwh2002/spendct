/**
 * 六阶段管线引擎单测（07 §17/§20 + 03 §1 状态机验收）。
 *
 * 引擎不依赖 DuckDB wasm：fake conn 在内存里把 demoTransactions() 的 793 行
 * 按 9 张预计算表/视图的语义（07 §3 DDL 口径）聚合成行，再按白名单 SQL 的
 * SELECT/GROUP BY/ORDER BY/LIMIT 投影，保证六阶段全链路用真实数字跑通。
 */
import { describe, expect, it, vi } from "vitest";

import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";

import { InsightCardSchema } from "@/lib/schema/insight-card";
import type { CleanTransaction } from "@/lib/schema/bill";
import {
  demoDatasetHash,
  demoTransactions,
  DEMO_NIGHT_CENTS,
  DEMO_NIGHT_COUNT,
  DEMO_TOTAL_EXPENSE_CENTS,
  DEMO_SUBSCRIPTION_SPECS,
} from "@/lib/pipeline/mock-run";
import { resumeCheckpoint, runCheckup, stageCacheKey } from "@/lib/pipeline/engine";
import { SIX_STAGES, type StageId } from "@/lib/pipeline/stage";
import { isSpendctEvent, type SpendctEvent } from "@/lib/protocol/events";
import { precheckAggregateSql } from "@/lib/sql-guard/whitelist";
import { CATEGORY_CODES } from "@/lib/schema/bill";
import { ANNUAL_EXECUTOR } from "@/lib/pipeline/stages/annual";
import { ANOMALY_EXECUTOR } from "@/lib/pipeline/stages/anomaly";
import { ATTRIBUTION_EXECUTOR } from "@/lib/pipeline/stages/attribution";
import { CLEAN_EXECUTOR } from "@/lib/pipeline/stages/clean";
import { PROFILE_EXECUTOR } from "@/lib/pipeline/stages/profile";
import { SUBSCRIPTION_EXECUTOR } from "@/lib/pipeline/stages/subscription";

const ALL_EXECUTORS = [
  CLEAN_EXECUTOR,
  PROFILE_EXECUTOR,
  ANOMALY_EXECUTOR,
  SUBSCRIPTION_EXECUTOR,
  ATTRIBUTION_EXECUTOR,
  ANNUAL_EXECUTOR,
] as const;

// ───────────────────────── 内存聚合 fake conn ─────────────────────────

const isPaidExpense = (r: CleanTransaction) => r.direction === "expense" && r.status === "paid";
const isPaidIncome = (r: CleanTransaction) => r.direction === "income" && r.status === "paid";
const monthOf = (r: CleanTransaction) => r.date_iso.slice(0, 7);
const yearOf = (r: CleanTransaction) => r.date_iso.slice(0, 4);
const hourOf = (r: CleanTransaction) => Number(r.ts.slice(11, 13));
const isNight = (r: CleanTransaction) => hourOf(r) >= 23 || hourOf(r) < 5;

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return map;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 按 07 §3 预计算表/视图语义，从明细行聚合出全部证据行（列序与执行器 SQL 对应） */
function aggregateRows(rows: CleanTransaction[]): Record<string, Record<string, unknown>[]> {
  const byTable: Record<string, Record<string, unknown>[]> = {};

  // clean_overview：行数/重复/覆盖天数/退款行数
  const txIds = new Set(rows.map((r) => r.tx_id));
  byTable.clean_overview = [
    {
      account_id: "demo",
      total_rows: rows.length,
      duplicate_rows: rows.length - txIds.size,
      active_days: new Set(rows.map((r) => r.date_iso)).size,
      refund_rows: rows.filter((r) => r.status === "refunded").length,
    },
  ];

  // v_monthly_summary：逐月支出/收入/笔数
  byTable.v_monthly_summary = [...groupBy(rows, monthOf).entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([month, list]) => ({
      month,
      expense_cents: list.filter(isPaidExpense).reduce((s, r) => s + r.amount_cents, 0),
      income_cents: list.filter(isPaidIncome).reduce((s, r) => s + r.amount_cents, 0),
      expense_tx: list.filter(isPaidExpense).length,
    }));

  // profile_category_stats：逐类目支出/笔数
  byTable.profile_category_stats = [...groupBy(rows.filter(isPaidExpense), (r) => r.category).entries()]
    .map(([category, list]) => ({
      category,
      expense_cents: list.reduce((s, r) => s + r.amount_cents, 0),
      expense_tx: list.length,
    }))
    .sort((a, b) => b.expense_cents - a.expense_cents);

  // profile_monthly_stats：逐月支出/笔数/活跃天数
  byTable.profile_monthly_stats = [...groupBy(rows, monthOf).entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([month, list]) => ({
      month,
      expense_cents: list.filter(isPaidExpense).reduce((s, r) => s + r.amount_cents, 0),
      expense_tx: list.filter(isPaidExpense).length,
      active_days: new Set(list.map((r) => r.date_iso)).size,
    }));

  // v_night_spend：逐月深夜支出与占比
  byTable.v_night_spend = [...groupBy(rows, monthOf).entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([month, list]) => {
      const night = list.filter(isPaidExpense).filter(isNight).reduce((s, r) => s + r.amount_cents, 0);
      const total = list.filter(isPaidExpense).reduce((s, r) => s + r.amount_cents, 0);
      return {
        month,
        night_cents: night,
        night_ratio: round2(total > 0 ? (night / total) * 100 : 0),
      };
    });

  // anomaly_daily_stats：逐日支出/笔数/zscore（全量日基线）
  const daily = [...groupBy(rows.filter(isPaidExpense), (r) => r.date_iso).entries()].map(
    ([date, list]) => ({
      date_iso: date,
      total_cents: list.reduce((s, r) => s + r.amount_cents, 0),
      tx_count: list.length,
    }),
  );
  const mu = daily.reduce((s, d) => s + d.total_cents, 0) / daily.length;
  const sigma = Math.sqrt(
    daily.reduce((s, d) => s + (d.total_cents - mu) * (d.total_cents - mu), 0) / daily.length,
  );
  byTable.anomaly_daily_stats = daily.map((d) => ({
    ...d,
    zscore: round2(sigma > 0 ? (d.total_cents - mu) / sigma : 0),
    mu: round2(mu),
    sigma: round2(sigma),
  }));

  // subscription_patterns：v_subscription_candidates 口径的周期检测
  //（同一商户相邻间隔 25-40 天且金额相等的合格对 ≥2，聚合其全部支出行）
  const subRows: Record<string, unknown>[] = [];
  for (const [merchant, list] of groupBy(rows.filter(isPaidExpense), (r) => r.merchant)) {
    const sorted = [...list].sort((a, b) => (a.ts < b.ts ? -1 : 1));
    let qualifiedPairs = 0;
    const intervals: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const gapDays = (Date.parse(sorted[i]!.ts) - Date.parse(sorted[i - 1]!.ts)) / 86_400_000;
      intervals.push(gapDays);
      if (gapDays >= 25 && gapDays <= 40 && sorted[i]!.amount_cents === sorted[i - 1]!.amount_cents) {
        qualifiedPairs += 1;
      }
    }
    if (qualifiedPairs >= 2) {
      const amountSum = sorted.reduce((s, r) => s + r.amount_cents, 0);
      subRows.push({
        merchant,
        n: sorted.length,
        avg_cents: round2(amountSum / sorted.length),
        avg_interval_days: round2(intervals.reduce((s, v) => s + v, 0) / intervals.length),
        months_active: new Set(sorted.map(monthOf)).size,
      });
    }
  }
  byTable.subscription_patterns = subRows.sort((a, b) => (b.avg_cents as number) - (a.avg_cents as number));

  // attribution_mom_stats：逐月×类目 cur/prev（LAG 按类目时序取上一数据月）
  const byMonthCategory = new Map<string, Record<string, unknown>>();
  for (const [month, list] of groupBy(rows.filter(isPaidExpense), monthOf)) {
    for (const [category, catList] of groupBy(list, (r) => r.category)) {
      byMonthCategory.set(`${month}|${category}`, {
        month,
        category,
        cur_cents: catList.reduce((s, r) => s + r.amount_cents, 0),
      });
    }
  }
  const momRows: Record<string, unknown>[] = [];
  for (const entry of byMonthCategory.values()) {
    const curMonth = entry.month as string;
    const category = entry.category as string;
    // 上一数据月：同一类目、月份 < 当前月的最大月份
    let prev: number | null = null;
    for (const [key, value] of byMonthCategory) {
      if (key.endsWith(`|${category}`) && (value.month as string) < curMonth) {
        prev = Math.max(prev ?? 0, value.cur_cents as number);
      }
    }
    momRows.push({ ...entry, prev_cents: prev });
  }
  byTable.attribution_mom_stats = momRows.sort((a, b) => (a.month as string) < (b.month as string) ? 1 : -1);

  // annual_summary：逐年支出/收入/笔数/月均/结余率
  byTable.annual_summary = [...groupBy(rows, yearOf).entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([year, list]) => {
      const expense = list.filter(isPaidExpense).reduce((s, r) => s + r.amount_cents, 0);
      const income = list.filter(isPaidIncome).reduce((s, r) => s + r.amount_cents, 0);
      return {
        year: Number(year),
        expense_cents: expense,
        income_cents: income,
        tx_count: list.filter((r) => r.status === "paid").length,
        avg_monthly_cents: round2(expense / 12),
        savings_rate_pct: round2(income > 0 ? ((income - expense) / income) * 100 : 0),
      };
    });

  return byTable;
}

/**
 * 白名单 SQL 投影：SELECT 列表按序取预聚合列（聚合函数参数即列名），
 * 再应用 ORDER BY 与 LIMIT，模拟 DuckDB 对分组聚合的执行结果。
 */
function applyQuery(
  fullRows: Record<string, unknown>[],
  sql: string,
): Record<string, unknown>[] {
  const selectPart = /SELECT\s+(.+?)\s+FROM/is.exec(sql)?.[1] ?? "";
  const cols = selectPart.split(",").map((part) => {
    const agg = /(?:SUM|AVG|MIN|MAX|STDDEV|MEDIAN|MODE|ROUND)\s*\(\s*([a-z_]+)/i.exec(part.trim());
    return (agg ? agg[1] : part.trim().toLowerCase())!;
  });

  let out = fullRows.map((row) => {
    const projected: Record<string, unknown> = {};
    for (const col of cols) projected[col] = row[col];
    return projected;
  });

  const orderPart = /ORDER BY\s+(.+?)(?:LIMIT|$)/is.exec(sql)?.[1];
  if (orderPart) {
    const orders = orderPart.split(",").map((item) => {
      const m =
        /(?:SUM|AVG|MIN|MAX)\s*\(\s*([a-z_]+)\)\s*(ASC|DESC)?/i.exec(item.trim()) ??
        /([a-z_]+)\s*(ASC|DESC)?/i.exec(item.trim());
      const col = m?.[1] ?? item.trim();
      const dir = (m?.[2] ?? "ASC").toUpperCase() === "DESC" ? -1 : 1;
      return { col, dir };
    });
    out = [...out].sort((a, b) => {
      for (const { col, dir } of orders) {
        const va = a[col];
        const vb = b[col];
        if (va === vb) continue;
        const cmp = va === null || va === undefined ? -1 : vb === null || vb === undefined ? 1 : va < vb ? -1 : 1;
        return cmp * dir;
      }
      return 0;
    });
  }

  const limit = /LIMIT\s+(\d+)/i.exec(sql);
  if (limit) out = out.slice(0, Number(limit[1]));
  return out;
}

/** 从明细行构建 fake conn（每表预聚合后按 SQL 投影；不加载真实 wasm） */
function buildFakeConn(rows: CleanTransaction[]): AsyncDuckDBConnection {
  const byTable = aggregateRows(rows);
  return {
    query: async (sql: string) => {
      const match = /FROM\s+([a-z_]+)/i.exec(sql);
      const table = match?.[1];
      const full = table ? (byTable[table] ?? []) : [];
      return { toArray: async () => applyQuery(full, sql) };
    },
  } as unknown as AsyncDuckDBConnection;
}

/** 固定行假连接：不区分 SQL，一律返回同一批行（用于行数超限/超时场景） */
function fixedConn(rows: unknown[]): AsyncDuckDBConnection {
  return {
    query: async () => ({ toArray: async () => rows }),
  } as unknown as AsyncDuckDBConnection;
}

function rejectConn(error: Error): AsyncDuckDBConnection {
  return {
    query: async () => {
      throw error;
    },
  } as unknown as AsyncDuckDBConnection;
}

/** 收集事件并返回 runCheckup 结果 */
async function collectRun(
  conn: AsyncDuckDBConnection,
  options?: { signal?: AbortSignal; onEvent?: (e: SpendctEvent) => void },
) {
  const events: SpendctEvent[] = [];
  const result = await runCheckup({
    conn,
    datasetHash: demoDatasetHash(),
    source: "sample",
    emit: (e) => {
      events.push(e);
      options?.onEvent?.(e);
    },
    signal: options?.signal,
  });
  return { events, result };
}

// ───────────────────────── 测试用例 ─────────────────────────

describe("demoTransactions 内置数据口径", () => {
  it("确定性：两次调用逐字节一致，共 793 行", () => {
    const a = demoTransactions();
    const b = demoTransactions();
    expect(a.length).toBe(793);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("已支付支出总额恒为 2,080,000 分，覆盖 12 类目", () => {
    const rows = demoTransactions();
    const expense = rows
      .filter((r) => r.direction === "expense" && r.status === "paid")
      .reduce((sum, r) => sum + r.amount_cents, 0);
    expect(expense).toBe(DEMO_TOTAL_EXPENSE_CENTS);

    const categories = new Set(rows.filter((r) => r.direction === "expense").map((r) => r.category));
    for (const code of CATEGORY_CODES) {
      expect(categories.has(code)).toBe(true);
    }
  });

  it("深夜 23 笔合计 35,000 分；3 订阅商户各 12 笔；12 收入 2 退款 2 重复", () => {
    const rows = demoTransactions();
    const night = rows.filter((r) => r.direction === "expense" && r.status === "paid" && isNight(r));
    expect(night.length).toBe(DEMO_NIGHT_COUNT);
    expect(night.reduce((sum, r) => sum + r.amount_cents, 0)).toBe(DEMO_NIGHT_CENTS);

    for (const spec of DEMO_SUBSCRIPTION_SPECS) {
      const charges = rows.filter(
        (r) => r.merchant === spec.merchant && r.direction === "expense" && r.status === "paid",
      );
      expect(charges.length).toBe(12);
      expect(charges.every((r) => r.amount_cents === spec.cents)).toBe(true);
    }

    expect(rows.filter((r) => r.direction === "income").length).toBe(12);
    expect(rows.filter((r) => r.status === "refunded").length).toBe(2);
    const ids = rows.map((r) => r.tx_id);
    expect(ids.length - new Set(ids).size).toBe(2);
  });
});

describe("阶段 SQL 白名单预检", () => {
  it("全部执行器 SQL 均通过预检", () => {
    for (const executor of ALL_EXECUTORS) {
      for (const query of executor.queries) {
        expect(precheckAggregateSql(query.sql), `${executor.stage}: ${query.sql}`).toEqual({ ok: true });
      }
    }
  });
});

describe("runCheckup 完整六阶段流程", () => {
  it("事件序列合法：run:start 最先、run:complete 最后、阶段事件成对、全部事件过协议校验", async () => {
    const { events, result } = await collectRun(buildFakeConn(demoTransactions()));

    for (const event of events) {
      expect(isSpendctEvent(event), JSON.stringify(event).slice(0, 200)).toBe(true);
    }
    expect(events[0]!.t).toBe("run:start");
    expect(events[events.length - 1]!.t).toBe("run:complete");
    expect(events[0]).toMatchObject({
      datasetTxHash: demoDatasetHash(),
      source: "sample",
      stageOrder: [...SIX_STAGES],
    });

    for (const stage of SIX_STAGES) {
      const starts = events.filter((e) => e.t === "stage:start" && e.stage === stage);
      const completes = events.filter((e) => e.t === "stage:complete" && e.stage === stage);
      expect(starts.length, `${stage} stage:start`).toBe(1);
      expect(completes.length, `${stage} stage:complete`).toBe(1);
      expect(starts[0]!.ts).toBeLessThanOrEqual(completes[0]!.ts);

      const executor = ALL_EXECUTORS.find((x) => x.stage === stage)!;
      const evidences = events.filter(
        (e): e is Extract<SpendctEvent, { t: "stage:evidence" }> =>
          e.t === "stage:evidence" && e.stage === stage,
      );
      expect(evidences.length).toBe(executor.queries.length);
      for (const evidence of evidences) {
        expect(evidence).toMatchObject({
          tableId: expect.any(String),
          sqlHash: expect.stringMatching(/^[0-9a-f]{12}$/),
          rowCount: expect.any(Number),
          elapsedMs: expect.any(Number),
        });
        expect(Number.isInteger(evidence.rowCount)).toBe(true);
        expect(Number.isInteger(evidence.elapsedMs)).toBe(true);
      }

      const checkpoint = events.filter((e) => e.t === "checkpoint:saved" && e.stage === stage);
      expect(checkpoint.length).toBe(1);
    }

    // 无失败阶段：run:complete 不带 degraded
    const complete = events[events.length - 1]!;
    expect(complete.t).toBe("run:complete");
    if (complete.t === "run:complete") {
      expect(complete.degraded).toBeUndefined();
    }
    expect(result.degraded).toBeUndefined();
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("全量卡通过 insight-card@v1 schema，published 卡进入 run:complete.cards，无 withheld", async () => {
    const { events, result } = await collectRun(buildFakeConn(demoTransactions()));
    expect(result.cards.length).toBeGreaterThanOrEqual(8);
    for (const card of result.cards) {
      expect(() => InsightCardSchema.parse(card), card.cardId).not.toThrow();
    }

    const complete = events[events.length - 1]!;
    expect(complete.t).toBe("run:complete");
    if (complete.t === "run:complete") {
      const published = result.cards.filter((c) => c.status === "published");
      expect(published.map((c) => c.cardId).sort()).toEqual([...complete.cards].sort());
      expect(published.length).toBe(result.cards.length);
    }
    expect(result.cards.some((c) => c.status === "withheld")).toBe(false);
  });

  it("关键数字与 demo 口径咬合：清洗总数/订阅年化/深夜金额/脉冲日/环比双卡/年度结余", async () => {
    const { result } = await collectRun(buildFakeConn(demoTransactions()));
    const byStage = new Map<string, (typeof result.cards)[number][]>();
    for (const card of result.cards) {
      const list = byStage.get(card.cardId.split("_")[1] ?? "") ?? [];
      list.push(card);
      byStage.set(card.cardId.split("_")[1] ?? "", list);
    }

    const clean = byStage.get("clean")![0]!;
    expect(clean.headline).toContain("共 793 笔账单");

    const subscription = byStage.get("subscription")!;
    expect(
      subscription.some((c) => c.evidence.stats.some((s: { value: string }) => s.value === "660.00")),
    ).toBe(true);

    const anomaly = byStage.get("anomaly")!;
    expect(
      anomaly.some((c) => c.evidence.stats.some((s: { value: string }) => s.value === "350.00")),
    ).toBe(true);
    expect(anomaly.some((c) => c.headline.includes("2026-06-18"))).toBe(true);

    const attribution = byStage.get("attribution")!;
    expect(attribution.some((c) => c.headline.includes("环比涨幅最大"))).toBe(true);
    expect(attribution.some((c) => c.headline.includes("环比回落"))).toBe(true);

    const annual = byStage.get("annual")!;
    // 年度卡标题已通俗化：「结余率」改写为「存下收入的」（数字口径不变）
    expect(annual.some((c) => c.headline.includes("存下收入的"))).toBe(true);
  });
});

describe("reflect 闸门与 withheld", () => {
  it("无显著发现时产 withheld 卡：reflect:result + card:withheld 事件，不进 run:complete.cards", async () => {
    // 极简数据集：3 笔小额支出，无深夜/无订阅/单月
    const minimal = demoTransactions()
      .filter((r) => r.direction === "expense" && r.status === "paid")
      .slice(0, 3);
    const { events, result } = await collectRun(buildFakeConn(minimal));

    const withheld = result.cards.filter((c) => c.status === "withheld");
    const published = result.cards.filter((c) => c.status === "published");
    expect(withheld.length).toBeGreaterThan(0);
    expect(published.length).toBeGreaterThan(0);

    const withheldIds = new Set(withheld.map((c) => c.cardId));
    for (const card of withheld) {
      expect(card.selfCheck?.pass).toBe(false);
      expect(card.selfCheck?.issues.length).toBeGreaterThan(0);
      const reflect = events.filter((e) => e.t === "reflect:result" && e.cardId === card.cardId);
      expect(reflect.length).toBe(1);
      const withholdEvent = events.find((e) => e.t === "card:withheld" && e.cardId === card.cardId);
      expect(withholdEvent).toBeDefined();
    }

    const complete = events[events.length - 1]!;
    expect(complete.t).toBe("run:complete");
    if (complete.t === "run:complete") {
      for (const id of complete.cards) {
        expect(withheldIds.has(id)).toBe(false);
      }
      expect([...complete.cards].sort()).toEqual(published.map((c) => c.cardId).sort());
    }
  });
});

describe("异常与降级", () => {
  it("空数据集：clean 发 EMPTY_DATASET（不可重试），degraded 记录失败阶段，后续阶段继续跑完", async () => {
    const { events, result } = await collectRun(buildFakeConn([]));

    const error = events.find((e) => e.t === "error");
    expect(error).toMatchObject({ code: "EMPTY_DATASET", retryable: false, stage: "clean" });

    expect(result.degraded).toEqual(["clean"]);
    const complete = events[events.length - 1]!;
    expect(complete.t).toBe("run:complete");
    if (complete.t === "run:complete") {
      expect(complete.degraded).toEqual(["clean"]);
      expect(complete.cards).toEqual([]);
    }
    // 后续阶段仍执行：profile 等产出「未发现」卡且全部被闸门拦下
    expect(result.cards.length).toBeGreaterThan(0);
    expect(result.cards.every((c) => c.status === "withheld")).toBe(true);
  });

  it("聚合行数超限：WHITELIST_REJECTED 不可重试，全部阶段降级但 run:complete 收尾", async () => {
    const overLimit = Array.from({ length: 60 }, (_, i) => ({ v: i }));
    const { events, result } = await collectRun(fixedConn(overLimit));

    const errors = events.filter((e) => e.t === "error");
    expect(errors.length).toBe(SIX_STAGES.length);
    for (const error of errors) {
      expect(error.code).toBe("WHITELIST_REJECTED");
      expect(error.retryable).toBe(false);
    }
    expect(result.degraded).toEqual([...SIX_STAGES]);
    expect(events[events.length - 1]!.t).toBe("run:complete");
  });

  it("执行超时：TIMEOUT 可重试", async () => {
    const { events, result } = await collectRun(rejectConn(new Error("DuckDB 查询超时（3000ms）")));

    const errors = events.filter((e) => e.t === "error");
    expect(errors.length).toBe(SIX_STAGES.length);
    for (const error of errors) {
      expect(error.code).toBe("TIMEOUT");
      expect(error.retryable).toBe(true);
    }
    expect(result.degraded).toEqual([...SIX_STAGES]);
  });

  it("中途 abort：发 abort 事件收尾，不发 run:complete，返回已产出卡", async () => {
    const controller = new AbortController();
    const events: SpendctEvent[] = [];
    const result = await runCheckup({
      conn: buildFakeConn(demoTransactions()),
      datasetHash: demoDatasetHash(),
      source: "sample",
      emit: (e) => {
        events.push(e);
        if (e.t === "stage:complete" && e.stage === "clean") controller.abort();
      },
      signal: controller.signal,
    });

    expect(events[events.length - 1]!.t).toBe("abort");
    expect(events.some((e) => e.t === "run:complete")).toBe(false);
    expect(events.filter((e) => e.t === "stage:start").length).toBe(1);
    expect(result.cards.length).toBeGreaterThanOrEqual(1);
  });
});

describe("断点与缓存键", () => {
  it("stageCacheKey：v1:数据集哈希:阶段", () => {
    expect(stageCacheKey("hash-1", "clean")).toBe("v1:hash-1:clean");
    expect(stageCacheKey(demoDatasetHash(), "annual")).toBe(`v1:${demoDatasetHash()}:annual`);
  });

  it("resumeCheckpoint：非浏览器环境返回 null", async () => {
    expect(await resumeCheckpoint()).toBeNull();
  });

  it("resumeCheckpoint：读取 localStorage 断点，非法数据返回 null", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });

    store.set("spendct:run:latest", JSON.stringify({ paused: false, stage: "profile", ts: 123 }));
    expect(await resumeCheckpoint()).toEqual({ stage: "profile" });

    store.set("spendct:run:latest", "{broken json");
    expect(await resumeCheckpoint()).toBeNull();

    store.set("spendct:run:latest", JSON.stringify({ paused: false, stage: "unknown-stage" }));
    expect(await resumeCheckpoint()).toBeNull();

    vi.unstubAllGlobals();
  });

  it("运行期间写入断点：末阶段完成时断点为 annual", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });
    await collectRun(buildFakeConn(demoTransactions()));
    const saved = JSON.parse(store.get("spendct:run:latest")!) as { paused: boolean; stage: StageId; ts: number };
    expect(saved.paused).toBe(false);
    expect(saved.stage).toBe("annual");
    expect(Number.isFinite(saved.ts)).toBe(true);
    vi.unstubAllGlobals();
  });
});
