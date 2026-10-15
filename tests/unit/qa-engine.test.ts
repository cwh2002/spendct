/**
 * 账单问答引擎单测（qa-engine.ts）。
 *
 * 覆盖契约要求的全部断言点：
 * 1. analyzeQuestion：每个意图至少 3 种说法 + 槽位断言、意图优先级、
 *    误报检查（闲聊与无关输入返回 null）、锚点槽位继承、复合说法；
 * 2. 每条意图 SQL（buildIntentQueries / buildContextQueries 在固定时钟下生成）
 *    逐一通过 precheckAggregateSql 白名单预检；
 * 3. answerLocalQuestion：fake runner 按 SQL 内容正则分发夹具行（金额用 bigint、
 *    month 用 epoch 毫秒 number，模拟 DuckDB 解码后形态），答案文案精确断言；
 *    两种无数据文案（数据集为空 / 有数据但维度为空）与 unhandled 组合；
 * 4. buildAggregateContext：固定夹具下的内容与长度断言（≤2000 字、每条以「·」开头、
 *    空数据返回空串、单组查不到即省略）；
 * 5. buildDetailContext / DETAIL_SNAPSHOT_SQL（07 修订案 A8）：假行驱动的内容与
 *    截断断言、异常与空数据返回空串，以及固定 SQL 的静态口径断言（LIMIT 150、
 *    零动态拼接、不进聚合白名单的直连语句）；
 * 6. EXAMPLE_QUESTIONS：6 个示例问题非空且全部可被本地意图识别；
 * 7. createDuckDbSchemaSnapshot（07 §18 协议演示工具入参）：mock getDuckDB
 *    假连接按 SQL 内容分发夹具行，断言聚合元数据快照形状（无明细行、
 *    统计口径、零行数据）与失败返回 null。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  analyzeQuestion,
  answerLocalQuestion,
  buildAggregateContext,
  buildContextQueries,
  buildDetailContext,
  buildIntentQueries,
  createDuckDbSchemaSnapshot,
  DETAIL_SNAPSHOT_SQL,
  EXAMPLE_QUESTIONS,
  type QaIntent,
  type SqlRunner,
  type TimeWindow,
} from "@/lib/chat/qa-engine";
import { precheckAggregateSql } from "@/lib/sql-guard/whitelist";

// 快照测试的假 DuckDB 连接：qa-engine 内 getDuckDB 调用全部走这里
const getDuckDBMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/duckdb/service", () => ({
  getDuckDB: getDuckDBMock,
}));

// ─────────────────────────── 测试工具 ───────────────────────────

/** 固定时钟：2026-10-14 正午（本地时区），保证 buildIntentQueries 输出确定 */
const FIXED_NOW = new Date(2026, 9, 14, 12, 0, 0);

/** 2026-10-01 的 epoch 毫秒（DuckDB 月列解码后形态） */
const MS_OCT = new Date(2026, 9, 1, 12, 0, 0).getTime();

/** 本地时钟的「N 天前」YYYY-MM-DD（与引擎内部 dayStartKey 同口径，用于构造日期正则） */
function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

interface FakeRoute {
  match: RegExp;
  rows: Record<string, unknown>[];
}

/**
 * fake runner：按 SQL 内容正则顺序分发夹具行；未命中任何路由且是数据集探针
 * SQL 时返回 probeRows（默认视为数据集非空）；其余返回空数组。
 * 行对象模拟 DuckDB 解码后的形态：金额 bigint、month 为 epoch 毫秒 number。
 */
function makeRunner(
  routes: FakeRoute[],
  probeRows: Record<string, unknown>[] = [{ account_id: null, n: 5n }],
): SqlRunner {
  return async (sql: string): Promise<unknown[]> => {
    const hit = routes.find((route) => route.match.test(sql));
    if (hit) return hit.rows;
    if (/SELECT account_id, COUNT/.test(sql)) return probeRows;
    return [];
  };
}

/** 预检全部 SQL，任一未通过即整体断言失败并给出 SQL 原文 */
function expectAllPrecheckOk(queries: string[], label: string): void {
  expect(queries.length, `${label} 应生成查询`).toBeGreaterThan(0);
  for (const sql of queries) {
    const verdict = precheckAggregateSql(sql);
    expect(verdict, `${label} 未通过白名单预检：${sql}`).toEqual({ ok: true });
  }
}

// ─────────────────────────── 意图解析 ───────────────────────────

describe("analyzeQuestion 意图解析", () => {
  it("month_total：至少 3 种说法 + 时间窗槽位", () => {
    expect(analyzeQuestion("这个月花了多少", null)).toEqual({ kind: "month_total", window: "this_month" });
    expect(analyzeQuestion("总共花了多少钱", null)).toEqual({ kind: "month_total", window: "this_month" });
    expect(analyzeQuestion("最近30天花费多少", null)).toEqual({ kind: "month_total", window: "last_30d" });
    expect(analyzeQuestion("上个月一共花了多少", null)).toEqual({ kind: "month_total", window: "last_month" });
    expect(analyzeQuestion("今年支出多少", null)).toEqual({ kind: "month_total", window: "this_year" });
  });

  it("category_spend：至少 3 种说法 + 类目与时间窗槽位（复合说法）", () => {
    expect(analyzeQuestion("这个月外卖花了多少", null)).toEqual({
      kind: "category_spend",
      category: "餐饮",
      window: "this_month",
    });
    expect(analyzeQuestion("打车花了多少", null)).toEqual({
      kind: "category_spend",
      category: "交通",
      window: "this_month",
    });
    expect(analyzeQuestion("淘宝买了几笔", null)).toEqual({
      kind: "category_spend",
      category: "购物",
      window: "this_month",
    });
    // 裸类目词也归类目支出（契约：或裸类目词）
    expect(analyzeQuestion("地铁", null)).toEqual({
      kind: "category_spend",
      category: "交通",
      window: "this_month",
    });
    // 别名覆盖抽查：红包→人情、买药→医疗、话费→通讯、学费→教育
    expect(analyzeQuestion("红包花了多少", null)?.category).toBe("人情");
    expect(analyzeQuestion("买药", null)?.category).toBe("医疗");
    expect(analyzeQuestion("话费多少", null)?.category).toBe("通讯");
    expect(analyzeQuestion("学费几笔", null)?.category).toBe("教育");
  });

  it("balance：至少 3 种说法", () => {
    expect(analyzeQuestion("这个月结余多少", null)).toEqual({ kind: "balance", window: "this_month" });
    expect(analyzeQuestion("这个月盈余多少", null)).toEqual({ kind: "balance", window: "this_month" });
    expect(analyzeQuestion("收入有多少", null)).toEqual({ kind: "balance", window: "this_month" });
    expect(analyzeQuestion("存了多少", null)).toEqual({ kind: "balance", window: "this_month" });
  });

  it("subscription：至少 3 种说法，类目槽位恒为订阅", () => {
    expect(analyzeQuestion("有哪些订阅", null)).toEqual({
      kind: "subscription",
      category: "订阅",
      window: "this_month",
    });
    expect(analyzeQuestion("会员扣费多少", null)?.kind).toBe("subscription");
    expect(analyzeQuestion("自动续费有哪些", null)?.kind).toBe("subscription");
  });

  it("top_merchant：至少 3 种说法", () => {
    expect(analyzeQuestion("哪家花得最多", null)).toEqual({ kind: "top_merchant", window: "this_month" });
    expect(analyzeQuestion("哪个商户最贵", null)?.kind).toBe("top_merchant");
    expect(analyzeQuestion("这个月商家排行", null)?.kind).toBe("top_merchant");
    expect(analyzeQuestion("我现在的商户排行是有哪些", null)).toEqual({
      kind: "top_merchant",
      window: "this_month",
    });
    expect(analyzeQuestion("商户排名", null)?.kind).toBe("top_merchant");
    expect(analyzeQuestion("哪家外卖花得最多", null)).toEqual({
      kind: "top_merchant",
      category: "餐饮",
      window: "this_month",
    });
  });

  it("mom_compare：至少 3 种说法", () => {
    expect(analyzeQuestion("为什么外卖涨了", null)).toEqual({
      kind: "mom_compare",
      category: "餐饮",
      window: "this_month",
    });
    expect(analyzeQuestion("支出为什么变多了", null)?.kind).toBe("mom_compare");
    expect(analyzeQuestion("上个月支出降了多少", null)).toEqual({
      kind: "mom_compare",
      window: "last_month",
    });
    expect(analyzeQuestion("环比变化大吗", null)?.kind).toBe("mom_compare");
  });

  it("night_spend：至少 3 种说法", () => {
    expect(analyzeQuestion("深夜花了多少", null)).toEqual({ kind: "night_spend", window: "this_month" });
    expect(analyzeQuestion("凌晨买过什么", null)?.kind).toBe("night_spend");
    expect(analyzeQuestion("这个月夜宵花了多少", null)?.kind).toBe("night_spend");
  });

  it("budget：至少 3 种说法", () => {
    expect(analyzeQuestion("预算还剩多少", null)).toEqual({ kind: "budget", window: "this_month" });
    expect(analyzeQuestion("这个月超支了吗", null)?.kind).toBe("budget");
    expect(analyzeQuestion("餐饮预算超标多少", null)).toEqual({
      kind: "budget",
      category: "餐饮",
      window: "this_month",
    });
  });

  it("overview：至少 3 种说法", () => {
    expect(analyzeQuestion("这个月概况", null)).toEqual({ kind: "overview", window: "this_month" });
    expect(analyzeQuestion("帮我总结一下", null)?.kind).toBe("overview");
    expect(analyzeQuestion("整体情况", null)?.kind).toBe("overview");
    expect(analyzeQuestion("体检结果", null)?.kind).toBe("overview");
  });

  it("意图优先级：同句命中多个词表时取高优先级", () => {
    // 类目词 + 涨了 → mom_compare（8 类目优先级 4）
    expect(analyzeQuestion("外卖为什么涨了", null)?.kind).toBe("mom_compare");
    // 结余 + 多少 → balance（1 类目优先级 1）
    expect(analyzeQuestion("这个月结余多少", null)?.kind).toBe("balance");
    // 会员（订阅别名与订阅意图词）→ subscription 而非 category_spend
    expect(analyzeQuestion("会员花了多少", null)?.kind).toBe("subscription");
    // 深夜 + 花了 → night_spend 而非 month_total
    expect(analyzeQuestion("深夜花了多少", null)?.kind).toBe("night_spend");
    // 还剩（预算词）优先于 多少钱
    expect(analyzeQuestion("这个月还剩多少钱", null)?.kind).toBe("budget");
  });

  it("误报检查：闲聊与无关输入返回 null（由面板分流）", () => {
    expect(analyzeQuestion("今天天气怎么样", null)).toBeNull();
    expect(analyzeQuestion("你好", null)).toBeNull();
    expect(analyzeQuestion("帮我写首诗", null)).toBeNull();
    expect(analyzeQuestion("", null)).toBeNull();
    expect(analyzeQuestion("   ", null)).toBeNull();
  });

  it("锚点槽位继承：类目与时间窗补全空槽位", () => {
    expect(analyzeQuestion("为什么涨了", { id: "card-1", label: "外卖 · 近30天 +14%" })).toEqual({
      kind: "mom_compare",
      category: "餐饮",
      window: "last_30d",
    });
    expect(analyzeQuestion("为什么涨了", { id: "card-1", label: "打车支出 1286 元" })).toEqual({
      kind: "mom_compare",
      category: "交通",
      window: "this_month",
    });
    // 锚点带时间窗、问题带花费词 → 类目与时间窗都来自锚点
    expect(analyzeQuestion("花了多少", { id: "card-1", label: "外卖 · 近30天 +14%" })).toEqual({
      kind: "category_spend",
      category: "餐饮",
      window: "last_30d",
    });
    // 锚点带「今年」→ 时间窗继承
    expect(analyzeQuestion("花了多少", { id: "card-1", label: "今年 总支出" })).toEqual({
      kind: "month_total",
      window: "this_year",
    });
  });

  it("锚点槽位继承：问题自带槽位优先于锚点", () => {
    expect(
      analyzeQuestion("上个月打车花了多少", { id: "card-1", label: "外卖 · 近30天 +14%" }),
    ).toEqual({ kind: "category_spend", category: "交通", window: "last_month" });
  });

  it("EXAMPLE_QUESTIONS：6 个示例问题全部可被本地意图识别", () => {
    expect(EXAMPLE_QUESTIONS).toHaveLength(6);
    for (const question of EXAMPLE_QUESTIONS) {
      expect(analyzeQuestion(question, null), question).not.toBeNull();
    }
  });
});

// ─────────────────────────── SQL 白名单预检 ───────────────────────────

describe("意图 SQL 全部通过 precheckAggregateSql", () => {
  const WINDOWS: TimeWindow[] = ["this_month", "last_month", "this_year", "last_30d", "last_90d"];

  it("每种意图 × 每类时间窗的 SQL 预检 ok:true", () => {
    // 构造器给 intent 参数提供上下文类型，避免 map 回调里 kind 被推断成 string
    const mk = (label: string, intent: QaIntent, hasQueries = true) => ({ label, intent, hasQueries });
    const cases = [
      ...WINDOWS.map((w) => mk(`month_total/${w}`, { kind: "month_total", window: w })),
      ...WINDOWS.map((w) => mk(`category_spend/${w}`, { kind: "category_spend", category: "餐饮", window: w })),
      ...WINDOWS.map((w) => mk(`balance/${w}`, { kind: "balance", window: w })),
      ...WINDOWS.map((w) => mk(`subscription/${w}`, { kind: "subscription", category: "订阅", window: w })),
      ...WINDOWS.map((w) => mk(`top_merchant/${w}`, { kind: "top_merchant", window: w })),
      ...WINDOWS.map((w) => mk(`top_merchant+cat/${w}`, { kind: "top_merchant", category: "交通", window: w })),
      ...WINDOWS.map((w) => mk(`mom_compare/${w}`, { kind: "mom_compare", window: w })),
      ...WINDOWS.map((w) => mk(`mom_compare+cat/${w}`, { kind: "mom_compare", category: "餐饮", window: w })),
      mk("night_spend/this_month", { kind: "night_spend", window: "this_month" }),
      mk("night_spend/last_month", { kind: "night_spend", window: "last_month" }),
      mk("night_spend/this_year", { kind: "night_spend", window: "this_year" }),
      mk("night_spend/last_30d（无按天口径，转在线兜底）", { kind: "night_spend", window: "last_30d" }, false),
      mk("night_spend/last_90d（无按天口径，转在线兜底）", { kind: "night_spend", window: "last_90d" }, false),
      mk("budget/this_month", { kind: "budget", window: "this_month" }),
      mk("budget/last_month", { kind: "budget", window: "last_month" }),
      mk("budget/this_year", { kind: "budget", window: "this_year" }),
      mk("budget+cat/this_month", { kind: "budget", category: "餐饮", window: "this_month" }),
      mk("budget/last_30d（按月粒度预算无按天口径，转在线兜底）", { kind: "budget", window: "last_30d" }, false),
      mk("budget/last_90d（按月粒度预算无按天口径，转在线兜底）", { kind: "budget", window: "last_90d" }, false),
      ...WINDOWS.map((w) => mk(`overview/${w}`, { kind: "overview", window: w })),
    ];

    for (const c of cases) {
      const queries = buildIntentQueries(c.intent, FIXED_NOW);
      if (c.hasQueries) {
        expectAllPrecheckOk(queries, c.label);
      } else {
        expect(queries, c.label).toEqual([]);
      }
    }
  });

  it("buildContextQueries 的固定 8 条 SQL 预检 ok:true", () => {
    expectAllPrecheckOk(buildContextQueries(FIXED_NOW), "buildContextQueries");
    expect(buildContextQueries(FIXED_NOW)).toHaveLength(8);
  });
});

// ─────────────────────────── 本地回答（fake runner） ───────────────────────────

describe("answerLocalQuestion 答案文案（数字全部来自夹具行）", () => {
  it("month_total 本月：精确文案", async () => {
    const runner = makeRunner([
      {
        match: /v_monthly_summary/,
        rows: [{ month: MS_OCT, expense_cents: 128600n, income_cents: 0n, expense_tx: 42n }],
      },
    ]);
    const answer = await answerLocalQuestion(runner, { kind: "month_total", window: "this_month" }, null);
    expect(answer).toEqual({ kind: "data", text: "本月共支出 ¥1286.00 元，共 42 笔。" });
  });

  it("month_total 最近30天：日粒度视图求和", async () => {
    const runner = makeRunner([
      {
        match: /v_daily_expense/,
        rows: [
          { date_iso: "2026-09-14", total_cents: 10000n, tx_count: 3n },
          { date_iso: "2026-09-15", total_cents: 5000n, tx_count: 1n },
        ],
      },
    ]);
    const answer = await answerLocalQuestion(runner, { kind: "month_total", window: "last_30d" }, null);
    expect(answer).toEqual({ kind: "data", text: "最近30天共支出 ¥150.00 元，共 4 笔。" });
  });

  it("balance 收入为 0：如实说本月没有收入记录", async () => {
    const runner = makeRunner([
      {
        match: /v_monthly_summary/,
        rows: [{ month: MS_OCT, expense_cents: 128600n, income_cents: 0n, expense_tx: 42n }],
      },
    ]);
    const answer = await answerLocalQuestion(runner, { kind: "balance", window: "this_month" }, null);
    expect(answer).toEqual({
      kind: "data",
      text: "本月支出 ¥1286.00 元（42 笔）；本月没有收入记录，因此结余为 -¥1286.00 元。",
    });
  });

  it("balance 有收入：结余 = 收入 - 支出", async () => {
    const runner = makeRunner([
      {
        match: /v_monthly_summary/,
        rows: [{ month: MS_OCT, expense_cents: 80000n, income_cents: 120000n, expense_tx: 30n }],
      },
    ]);
    const answer = await answerLocalQuestion(runner, { kind: "balance", window: "this_month" }, null);
    expect(answer).toEqual({
      kind: "data",
      text: "本月收入 ¥1200.00 元，支出 ¥800.00 元（30 笔），结余 ¥400.00 元。",
    });
  });

  it("balance 最近30天：direction 分组取收入与支出", async () => {
    const runner = makeRunner([
      {
        match: /GROUP BY direction/,
        rows: [
          { direction: "expense", s: 100000n, n: 30n },
          { direction: "income", s: 200000n, n: 2n },
        ],
      },
    ]);
    const answer = await answerLocalQuestion(runner, { kind: "balance", window: "last_30d" }, null);
    expect(answer).toEqual({
      kind: "data",
      text: "最近30天收入 ¥2000.00 元，支出 ¥1000.00 元（30 笔），结余 ¥1000.00 元。",
    });
  });

  it("category_spend 本月餐饮：精确文案", async () => {
    const runner = makeRunner([
      {
        match: /v_category_monthly/,
        rows: [{ month: MS_OCT, category: "餐饮", expense_cents: 32000n, tx_count: 12n }],
      },
    ]);
    const answer = await answerLocalQuestion(
      runner,
      { kind: "category_spend", category: "餐饮", window: "this_month" },
      null,
    );
    expect(answer).toEqual({ kind: "data", text: "本月「餐饮」支出 ¥320.00 元，共 12 笔。" });
  });

  it("category_spend 最近90天：明细表聚合", async () => {
    const runner = makeRunner([
      { match: /transactions.*category = '餐饮'/, rows: [{ category: "餐饮", s: 45000n, n: 9n }] },
    ]);
    const answer = await answerLocalQuestion(
      runner,
      { kind: "category_spend", category: "餐饮", window: "last_90d" },
      null,
    );
    expect(answer).toEqual({ kind: "data", text: "最近90天「餐饮」支出 ¥450.00 元，共 9 笔。" });
  });

  it("top_merchant 近90天：Top3 精确文案", async () => {
    const runner = makeRunner([
      {
        match: /v_top_merchants_90d/,
        rows: [
          { merchant: "美团", total_cents: 50000n, tx_count: 8n },
          { merchant: "瑞幸", total_cents: 20000n, tx_count: 4n },
          { merchant: "京东", total_cents: 10000n, tx_count: 2n },
        ],
      },
    ]);
    const answer = await answerLocalQuestion(runner, { kind: "top_merchant", window: "last_90d" }, null);
    expect(answer).toEqual({
      kind: "data",
      text: "最近90天花得最多的是「美团」，共 ¥500.00 元（8 笔）；其次是「瑞幸」¥200.00 元、「京东」¥100.00 元。",
    });
  });

  it("mom_compare 本月有上月记录：涨幅文案 + 冲动证据", async () => {
    const runner = makeRunner([
      {
        match: /v_mom_category/,
        rows: [{ category: "餐饮", cur_cents: 11230n, prev_cents: 10000n, change_ratio: 12.3 }],
      },
      {
        match: /v_impulse_events/,
        rows: [
          { merchant: "美团", s: 12000n, n: 1n },
          { merchant: "瑞幸", s: 8800n, n: 1n },
        ],
      },
    ]);
    const answer = await answerLocalQuestion(
      runner,
      { kind: "mom_compare", category: "餐饮", window: "this_month" },
      null,
    );
    expect(answer).toEqual({
      kind: "data",
      text: "本月「餐饮」支出 ¥112.30 元，上月 ¥100.00 元，环比涨 ¥12.30 元（+12.3%），相关冲动消费：「美团」¥120.00 元、「瑞幸」¥88.00 元。",
    });
  });

  it("mom_compare 上月无记录：如实措辞不做环比", async () => {
    const runner = makeRunner([
      {
        match: /v_mom_category/,
        rows: [{ category: "餐饮", cur_cents: 5000n, prev_cents: null, change_ratio: null }],
      },
      { match: /v_impulse_events/, rows: [] },
    ]);
    const answer = await answerLocalQuestion(
      runner,
      { kind: "mom_compare", category: "餐饮", window: "this_month" },
      null,
    );
    expect(answer).toEqual({
      kind: "data",
      text: "本月「餐饮」支出 ¥50.00 元；上月没有支出记录，无法计算环比。",
    });
  });

  it("mom_compare 最近30天：两个等长窗口分别聚合后比较", async () => {
    const start30 = isoDaysAgo(30);
    const start60 = isoDaysAgo(60);
    const runner = makeRunner([
      { match: /v_impulse_events/, rows: [] },
      { match: new RegExp(`date_iso >= '${start30}'`), rows: [{ category: "餐饮", cur: 11230n, n: 10n }] },
      { match: new RegExp(`date_iso >= '${start60}'`), rows: [{ category: "餐饮", prev: 10000n, n: 9n }] },
    ]);
    const answer = await answerLocalQuestion(
      runner,
      { kind: "mom_compare", category: "餐饮", window: "last_30d" },
      null,
    );
    expect(answer).toEqual({
      kind: "data",
      text: "最近30天「餐饮」支出 ¥112.30 元，前一个30天 ¥100.00 元，环比涨 ¥12.30 元（+12.3%）。",
    });
  });

  it("mom_compare 不带类目：按变化幅度列类目", async () => {
    const runner = makeRunner([
      {
        match: /v_mom_category/,
        rows: [
          { category: "餐饮", cur_cents: 11230n, prev_cents: 10000n, change_ratio: 12.3 },
          { category: "购物", cur_cents: 8000n, prev_cents: 10000n, change_ratio: -20.0 },
        ],
      },
    ]);
    const answer = await answerLocalQuestion(runner, { kind: "mom_compare", window: "this_month" }, null);
    expect(answer).toEqual({
      kind: "data",
      text: "本月支出环比变化较大的类目：「购物」¥80.00 元（较上月降 ¥20.00 元，-20.0%）；「餐饮」¥112.30 元（较上月涨 ¥12.30 元，+12.3%）。",
    });
  });

  it("subscription：订阅金额 + 疑似订阅清单", async () => {
    const runner = makeRunner([
      { match: /v_category_monthly/, rows: [{ category: "订阅", expense_cents: 4500n, tx_count: 2n }] },
      {
        match: /v_subscription_candidates/,
        rows: [{ merchant: "网盘会员", avg_cents: 2500n, n: 6n, months_active: 6n }],
      },
    ]);
    const answer = await answerLocalQuestion(runner, { kind: "subscription", window: "this_month" }, null);
    expect(answer).toEqual({
      kind: "data",
      text: "本月订阅类支出 ¥45.00 元（2 笔）；检测到疑似订阅 1 个：「网盘会员」月均 ¥25.00 元（活跃 6 个月）。",
    });
  });

  it("night_spend 本月：金额 + 占比精确文案", async () => {
    const runner = makeRunner([
      { match: /v_night_spend/, rows: [{ month: MS_OCT, night_cents: 3000n, night_ratio: 2.3 }] },
    ]);
    const answer = await answerLocalQuestion(runner, { kind: "night_spend", window: "this_month" }, null);
    expect(answer).toEqual({
      kind: "data",
      text: "本月深夜时段（23:00-05:00）支出 ¥30.00 元，占本月支出的 2.3%。",
    });
  });

  it("night_spend 深夜金额为 0：如实说没有深夜支出", async () => {
    const runner = makeRunner([
      { match: /v_night_spend/, rows: [{ month: MS_OCT, night_cents: 0n, night_ratio: null }] },
    ]);
    const answer = await answerLocalQuestion(runner, { kind: "night_spend", window: "this_month" }, null);
    expect(answer).toEqual({ kind: "data", text: "本月没有深夜时段（23:00-05:00）的支出记录。" });
  });

  it("night_spend 最近30天：无按天口径转在线兜底", async () => {
    const answer = await answerLocalQuestion(makeRunner([]), { kind: "night_spend", window: "last_30d" }, null);
    expect(answer).toEqual({ kind: "unhandled" });
  });

  it("budget 带类目：预算/已支出/剩余精确文案", async () => {
    const runner = makeRunner([
      {
        match: /budget_vs_actual/,
        rows: [{ ym: "2026-10", category: "餐饮", budget_cents: 50000n, actual_cents: 32000n }],
      },
    ]);
    const answer = await answerLocalQuestion(
      runner,
      { kind: "budget", category: "餐饮", window: "this_month" },
      null,
    );
    expect(answer).toEqual({
      kind: "data",
      text: "本月「餐饮」预算 ¥500.00 元，已支出 ¥320.00 元（已用 64.0%），还剩 ¥180.00 元。",
    });
  });

  it("budget 不带类目：总预算行 + 各类目逐行（含超支）", async () => {
    const runner = makeRunner([
      {
        match: /budget_vs_actual/,
        rows: [
          { ym: "2026-10", category: "total", budget_cents: 100000n, actual_cents: 80000n },
          { ym: "2026-10", category: "餐饮", budget_cents: 50000n, actual_cents: 60000n },
        ],
      },
    ]);
    const answer = await answerLocalQuestion(runner, { kind: "budget", window: "this_month" }, null);
    expect(answer).toEqual({
      kind: "data",
      text:
        "本月总预算 ¥1000.00 元，已支出 ¥800.00 元，还剩 ¥200.00 元\n" +
        "·「餐饮」预算 ¥500.00 元，已支出 ¥600.00 元，已超支 ¥100.00 元",
    });
  });

  it("budget 最近90天：无按天口径转在线兜底", async () => {
    const answer = await answerLocalQuestion(makeRunner([]), { kind: "budget", window: "last_90d" }, null);
    expect(answer).toEqual({ kind: "unhandled" });
  });

  it("overview 本月：总额 + 收入结余 + 类目 Top", async () => {
    const runner = makeRunner([
      {
        match: /v_monthly_summary/,
        rows: [{ month: MS_OCT, expense_cents: 100000n, income_cents: 200000n, expense_tx: 30n, income_tx: 2n }],
      },
      {
        match: /v_category_monthly/,
        rows: [
          { category: "餐饮", expense_cents: 32000n, tx_count: 12n },
          { category: "交通", expense_cents: 18000n, tx_count: 6n },
        ],
      },
    ]);
    const answer = await answerLocalQuestion(runner, { kind: "overview", window: "this_month" }, null);
    expect(answer).toEqual({
      kind: "data",
      text:
        "本月共支出 ¥1000.00 元（30 笔），收入 ¥2000.00 元，结余 ¥1000.00 元。" +
        "支出最多的类目：「餐饮」¥320.00 元（12 笔）、「交通」¥180.00 元（6 笔）。",
    });
  });

  it("no-data 文案一：数据集为空", async () => {
    // 所有查询（含数据集探针）都返回空 → 数据集为空文案
    const answer = await answerLocalQuestion(
      makeRunner([], []),
      { kind: "month_total", window: "this_month" },
      null,
    );
    expect(answer).toEqual({
      kind: "no-data",
      text: "还没有账单数据，先到「上传账单」导入一份账单，我就能回答这些问题了。",
    });
  });

  it("no-data 文案二：有数据但该维度为空", async () => {
    // 主查询空、数据集探针非空 → 维度为空的按意图文案
    const runner = makeRunner([{ match: /v_category_monthly/, rows: [] }]);
    const answer = await answerLocalQuestion(
      runner,
      { kind: "category_spend", category: "餐饮", window: "this_month" },
      null,
    );
    expect(answer).toEqual({ kind: "no-data", text: "本月没有「餐饮」支出记录。" });
  });

  it("主查询抛错返回 unhandled：引擎故障转在线兜底，不假称「还没有账单数据」", async () => {
    const answer = await answerLocalQuestion(
      async () => Promise.reject(new Error("duckdb dead")),
      { kind: "month_total", window: "this_month" },
      null,
    );
    expect(answer).toEqual({ kind: "unhandled" });
  });

  it("主查询成功但数据集探针抛错时向上抛出：探针故障不吞成空数据集", async () => {
    const runner: SqlRunner = async (sql: string) => {
      if (/SELECT account_id, COUNT/.test(sql)) throw new Error("probe boom");
      return [];
    };
    await expect(
      answerLocalQuestion(runner, { kind: "month_total", window: "this_month" }, null),
    ).rejects.toThrow("probe boom");
  });
});

// ─────────────────────────── 在线兜底汇总上下文 ───────────────────────────

describe("buildAggregateContext 汇总上下文", () => {
  const fullRoutes: FakeRoute[] = [
    {
      match: /MIN\(date_iso\)/,
      rows: [{ account_id: null, c: 42n, first: "2026-01-05", last: "2026-10-14" }],
    },
    {
      match: /v_monthly_summary GROUP BY month ORDER BY month DESC/,
      rows: [
        { month: MS_OCT, expense: 128600n, income: 0n, tx: 42n },
        { month: new Date(2026, 8, 1, 12).getTime(), expense: 20000n, income: 0n, tx: 10n },
        { month: new Date(2026, 7, 1, 12).getTime(), expense: 10000n, income: 0n, tx: 5n },
      ],
    },
    {
      match: /v_category_monthly/,
      rows: [
        { category: "餐饮", expense: 32000n, tx: 12n },
        { category: "交通", expense: 18000n, tx: 6n },
      ],
    },
    {
      match: /v_top_merchants_90d/,
      rows: [{ merchant: "美团", total_cents: 50000n, tx_count: 8n }],
    },
    {
      match: /v_subscription_candidates/,
      rows: [{ merchant: "网盘会员", avg_cents: 2500n, n: 6n, months_active: 6n }],
    },
    {
      match: /v_night_spend/,
      rows: [{ month: MS_OCT, night_cents: 3000n, night_ratio: 2.3 }],
    },
    {
      match: /v_impulse_events/,
      rows: [{ date_iso: "2026-10-01", s: 5000n, n: 1n }],
    },
    {
      match: /v_monthly_summary WHERE month/,
      rows: [{ month: MS_OCT, e: 100000n }],
    },
  ];

  it("固定 6 组统计全部拼出，每条以「·」开头，长度 ≤2000 字", async () => {
    const context = await buildAggregateContext(makeRunner(fullRoutes));
    const lines = context.split("\n");
    expect(lines).toHaveLength(6);
    for (const line of lines) {
      expect(line.startsWith("·"), line).toBe(true);
    }
    expect(context.length).toBeLessThanOrEqual(2000);
    expect(lines[0]).toBe("· 数据范围：2026-01-05 至 2026-10-14，共 42 笔支出");
    expect(lines[1]).toBe(
      "· 近3个月：2026-10 支出 ¥1286.00 元（42 笔）、收入 ¥0.00 元、结余 -¥1286.00 元；" +
        "2026-09 支出 ¥200.00 元（10 笔）、收入 ¥0.00 元、结余 -¥200.00 元；" +
        "2026-08 支出 ¥100.00 元（5 笔）、收入 ¥0.00 元、结余 -¥100.00 元",
    );
    expect(lines[2]).toBe("· 本月类目 Top5：「餐饮」¥320.00 元（12 笔）、「交通」¥180.00 元（6 笔）");
    expect(lines[3]).toBe("· 近90天商户 Top5：「美团」¥500.00 元（8 笔）");
    expect(lines[4]).toBe("· 订阅候选：「网盘会员」月均 ¥25.00 元（活跃 6 个月）");
    expect(lines[5]).toBe("· 本月深夜支出占比 3.0%、冲动消费占比 5.0%");
  });

  it("任何一组查不到就省略该组（部分数据时只输出有数据的组）", async () => {
    const context = await buildAggregateContext(makeRunner(fullRoutes.slice(0, 2)));
    const lines = context.split("\n");
    expect(lines).toHaveLength(2);
    expect(context).not.toContain("订阅候选");
    expect(context).not.toContain("深夜支出占比");
  });

  it("没有任何数据时返回空串", async () => {
    const context = await buildAggregateContext(makeRunner([], []));
    expect(context).toBe("");
  });
});

// ─────────────────────────── 明细快照（07 修订案 A8） ───────────────────────────

describe("buildDetailContext / DETAIL_SNAPSHOT_SQL", () => {
  /** 假快照行：列序与 DETAIL_SNAPSHOT_SQL 的 SELECT 顺序一致 */
  function detailRow(over: Partial<Record<string, unknown>>): Record<string, unknown> {
    return {
      0: "2026-10-10",
      1: "餐饮",
      2: "美团",
      3: 2560n,
      4: "expense",
      ...over,
    };
  }

  const runDetail = (rows: Record<string, unknown>[]) => async () => rows;

  it("按「日期 类目 商户 方向金额」拼行，行间以「；」连接，支出 / 收入标签正确", async () => {
    const text = await buildDetailContext(
      runDetail([
        detailRow({}),
        detailRow({ 0: "2026-10-09", 1: "通讯", 2: "中国移动", 3: 5000n, 4: "income" }),
      ]),
    );
    expect(text).toBe(
      "2026-10-10 餐饮 美团 支出¥25.60 元；2026-10-09 通讯 中国移动 收入¥50.00 元",
    );
  });

  it("商户为空归并「未注明商户」，金额为负写 -¥ 前缀", async () => {
    const text = await buildDetailContext(runDetail([detailRow({ 2: null, 3: -1234n })]));
    expect(text).toBe("2026-10-10 餐饮 未注明商户 支出-¥12.34 元");
  });

  it("超 maxChars 时整行丢弃（不截断半个行），短预算下只保留放得下的行", async () => {
    const rows = [
      detailRow({ 0: "2026-10-10", 2: "美团", 3: 2560n }),
      detailRow({ 0: "2026-10-09", 2: "肯德基", 3: 4500n }),
    ];
    // 第 1 行恰好放得下（预算 = 第 1 行长度），第 2 行加分隔符后必然超预算
    const onlyFirst = await buildDetailContext(runDetail(rows), "2026-10-10 餐饮 美团 支出¥25.60 元".length);
    expect(onlyFirst).toBe("2026-10-10 餐饮 美团 支出¥25.60 元");
    expect(onlyFirst).not.toContain("肯德基");
  });

  it("空快照返回空串，执行器抛异常也返回空串（由面板决定是否仍转在线）", async () => {
    expect(await buildDetailContext(runDetail([]))).toBe("");
    expect(await buildDetailContext(async () => Promise.reject(new Error("boom")))).toBe("");
  });

  it("DETAIL_SNAPSHOT_SQL 固定口径：LIMIT 150、倒序、只收支行、零动态拼接", () => {
    expect(DETAIL_SNAPSHOT_SQL).toContain("FROM transactions");
    expect(DETAIL_SNAPSHOT_SQL).toContain("ORDER BY date_iso DESC");
    expect(DETAIL_SNAPSHOT_SQL).toContain("LIMIT 150");
    expect(DETAIL_SNAPSHOT_SQL).toContain("direction <> 'neutral'");
    expect(DETAIL_SNAPSHOT_SQL).toContain("status <> 'refunded'");
    // 零动态拼接：固定语句里不允许出现模板插值痕迹
    expect(DETAIL_SNAPSHOT_SQL).not.toContain("${");
    // 直连语句不经聚合白名单，本测试不调用 precheckAggregateSql（该语句会被
    // 白名单的「明细列禁投影」拒绝，正说明它不在聚合通道内）
  });
});

describe("createDuckDbSchemaSnapshot 会话快照（07 §18 协议演示工具入参）", () => {
  // 指纹口径与导入层 hashCleanRows 一致：SHA-256 前 16 位十六进制
  const TX_HASH = "a".repeat(16);

  beforeEach(() => {
    getDuckDBMock.mockReset();
  });

  /** 假 DuckDB 连接：按 SQL 内容分发夹具行；overrides 可覆盖特定关键字的返回 */
  function fakeConnection(overrides: Record<string, unknown[]> = {}) {
    const rowsFor = (sql: string): unknown[] => {
      for (const [keyword, rows] of Object.entries(overrides)) {
        if (sql.includes(keyword)) return rows;
      }
      if (sql.includes("COUNT(*) AS n")) return [{ n: 3 }];
      if (sql.includes("information_schema")) {
        return [
          { column_name: "amount_cents", data_type: "BIGINT" },
          { column_name: "category", data_type: "VARCHAR" },
        ];
      }
      if (sql.includes("LIMIT 1")) return [{ amount_cents: 1234n, category: "餐饮" }];
      if (sql.includes("MIN(amount_cents)")) return [{ mn: 100, mx: 9999, av: 3200.5, dc: 3 }];
      if (sql.includes("COUNT(DISTINCT category)")) return [{ dc: 2 }];
      return [];
    };
    return { query: async (sql: string) => ({ toArray: async () => rowsFor(sql) }) };
  }

  it("读出聚合元数据快照：表名/行数/哈希/列元数据/统计，不含明细行", async () => {
    getDuckDBMock.mockResolvedValue(fakeConnection());
    await expect(createDuckDbSchemaSnapshot(TX_HASH)()).resolves.toEqual({
      table: "transactions",
      rowCount: 3,
      datasetTxHash: TX_HASH,
      schema: [
        { name: "amount_cents", type: "BIGINT", sample: "1234" },
        { name: "category", type: "VARCHAR", sample: "餐饮" },
      ],
      stats: [
        { column: "amount_cents", min: 100, max: 9999, mean: 3200.5, distinct: 3 },
        { column: "category", distinct: 2 },
      ],
    });
  });

  it("连接抛错 → null（面板按省略处理，不阻断在线兜底）", async () => {
    getDuckDBMock.mockRejectedValue(new Error("WASM 未就绪"));
    await expect(createDuckDbSchemaSnapshot(TX_HASH)()).resolves.toBeNull();
  });

  it("列元数据为空 → null", async () => {
    getDuckDBMock.mockResolvedValue(fakeConnection({ information_schema: [] }));
    await expect(createDuckDbSchemaSnapshot(TX_HASH)()).resolves.toBeNull();
  });

  it("零行数据：schema 仍读出，stats 为空数组", async () => {
    getDuckDBMock.mockResolvedValue(fakeConnection({ "COUNT(*) AS n": [{ n: 0 }] }));
    const snapshot = await createDuckDbSchemaSnapshot(TX_HASH)();
    expect(snapshot).not.toBeNull();
    expect(snapshot?.rowCount).toBe(0);
    expect(snapshot?.stats).toEqual([]);
  });
});
