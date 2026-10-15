/**
 * 追问深度分析（08 修订案 A14）单测：
 * 1. 全部固定查询逐条过白名单预检——深度分析上下文是发送给大模型的账单数据，
 *    绝不允许任何一条 SQL 突破窄文法（与 A13 页面常量同口径的持久回归）；
 * 2. buildDeepAnalysisContext 用假行驱动，验证组装口径：全期类目/商户/逐月/
 *    金额分布/深夜冲动占比/订阅候选，超长丢弃与空查询容错。
 */
import { describe, expect, it } from "vitest";

import { buildDeepAnalysisContext, buildDeepAnalysisQueries, DEEP_CONTEXT_MAX_LENGTH } from "@/lib/chat/deep-analysis";
import { precheckAggregateSql } from "@/lib/sql-guard/whitelist";

describe("深度分析查询清单（白名单预检）", () => {
  it("10 条固定查询全部通过白名单文法（A14 上下文，零动态拼接）", () => {
    const queries = buildDeepAnalysisQueries();
    expect(queries).toHaveLength(10);
    queries.forEach((sql) => {
      expect(precheckAggregateSql(sql), `未通过白名单：${sql}`).toEqual({ ok: true });
    });
  });

  it("查询全部为代码常量形态：含 GROUP BY、无明细投影、无子查询", () => {
    for (const sql of buildDeepAnalysisQueries()) {
      expect(sql).toMatch(/GROUP BY/);
      expect(sql).not.toMatch(/SELECT \*/);
      expect(sql).not.toMatch(/;.+/s);
    }
  });
});

describe("buildDeepAnalysisContext（全期聚合上下文组装）", () => {
  const fakeRunner =
    (answers: unknown[][]): ((sql: string) => Promise<unknown[]>) =>
    async (sql: string) => {
      const index = buildDeepAnalysisQueries().indexOf(sql);
      return index >= 0 ? (answers[index] ?? []) : [];
    };

  it("全期统计按组拼接：范围 / 类目 / 商户 / 逐月 / 金额分布 / 深夜冲动 / 订阅", async () => {
    const text = await buildDeepAnalysisContext(
      fakeRunner([
        [{ account_id: "a", n: 12, min: "2026-01-01", max: "2026-10-15" }],
        [{ category: "餐饮", sum: 45000, count: 20 }, { category: "购物", sum: 30000, count: 8 }],
        [{ merchant: "美团外卖", sum: 25000, count: 15 }],
        [{ month: "2026-10", expense_cents: 9000, income_cents: 1000, expense_tx: 9 }],
        [{ direction: "expense", n: 28, min: 100, max: 8000, avg: 1500, median: 1200 }],
        [{ category: "工资", sum: 200000, count: 3 }],
        [{ month: "2026-10", night: 900, ratio: 0.1 }],
        [{ date_iso: "2026-10-02", sum: 600, count: 1 }],
        [{ merchant: "视频会员", avg: 1500, n: 3, months: 4 }],
        [
          { direction: "expense", sum: 75000 },
          { direction: "income", sum: 201000 },
        ],
      ]),
    );
    expect(text).toContain("数据范围：2026-01-01 至 2026-10-15，共 12 笔支出");
    expect(text).toContain("全期支出类目：「餐饮」¥450.00 元（20 笔）");
    expect(text).toContain("全期商户 Top10：「美团外卖」¥250.00 元（15 笔）");
    expect(text).toContain("逐月收支（近1个月）");
    expect(text).toContain("单笔支出分布：28 笔，最低 ¥1.00 元、最高 ¥80.00 元、均值 ¥15.00 元、中位数 ¥12.00 元");
    expect(text).toContain("全期收入类目：「工资」¥2000.00 元（3 笔）");
    expect(text).toContain("全期收支：支出 ¥750.00 元、收入 ¥2010.00 元、结余 ¥1260.00 元");
    expect(text).toContain("全期深夜支出占比 1.2%、冲动消费占比 0.8%");
    expect(text).toContain("订阅候选：「视频会员」月均 ¥15.00 元（活跃 4 个月）");
  });

  it("账单只有支出时：收入类目与结余省略，深夜冲动占比照常", async () => {
    const text = await buildDeepAnalysisContext(
      fakeRunner([
        [{ account_id: "a", n: 5, min: "2026-09-01", max: "2026-09-30" }],
        [{ category: "交通", sum: 5000, count: 4 }],
        [],
        [],
        [{ direction: "expense", n: 5, min: 100, max: 3000, avg: 1000, median: 800 }],
        [],
        [{ month: "2026-09", night: 400, ratio: 0.08 }],
        [],
        [],
        [{ direction: "expense", sum: 5000 }],
      ]),
    );
    expect(text).toContain("全期支出类目：「交通」¥50.00 元（4 笔）");
    expect(text).not.toContain("收入类目");
    expect(text).toContain("全期收支：支出 ¥50.00 元、收入 ¥0.00 元、结余 -¥50.00 元");
    expect(text).toContain("全期深夜支出占比 8.0%");
    expect(text).not.toContain("冲动消费");
  });

  it("全部查询失败时返回空串（面板不空手转在线）", async () => {
    const text = await buildDeepAnalysisContext(
      fakeRunner(Array.from({ length: 10 }, () => [])),
    );
    expect(text).toBe("");
  });

  it("超长上下文按整行从末尾丢弃，最终不超过上限", async () => {
    // fixture 撑出远超上限的未截断文本（65 条长类目行 + 长商户名 + 12 个月 +
    // 订阅候选），断言截断确实发生：最终 ≤ 上限、首行与类目组保留、
    // 商户 Top10 及之后的末尾组整条丢弃
    const categories = Array.from({ length: 65 }, (_, i) => ({
      category: `餐饮外卖与堂食深夜消费类目第${i}组`,
      sum: 100000 + i,
      count: 10 + i,
    }));
    const text = await buildDeepAnalysisContext(
      fakeRunner([
        [{ account_id: "a", n: 99, min: "2026-01-01", max: "2026-12-31" }],
        categories,
        Array.from({ length: 10 }, (_, i) => ({
          merchant: `连锁餐饮商户品牌第${i}家门店`,
          sum: 90000 - i,
          count: 5,
        })),
        Array.from({ length: 12 }, (_, i) => ({
          month: `2026-${String(i + 1).padStart(2, "0")}`,
          expense_cents: 8000,
          income_cents: 0,
          expense_tx: 8,
        })),
        [{ direction: "expense", n: 99, min: 1, max: 9999, avg: 500, median: 400 }],
        [{ category: "工资与奖学金收入", sum: 500000, count: 3 }],
        [{ month: "2026-09", night: 400, ratio: 0.08 }],
        [],
        Array.from({ length: 10 }, (_, i) => ({
          merchant: `视频会员自动续费平台第${i}家`,
          avg: 1500,
          n: 3,
          months: 4,
        })),
        [{ direction: "expense", sum: 1200000 }],
      ]),
    );
    expect(text.length).toBeLessThanOrEqual(DEEP_CONTEXT_MAX_LENGTH);
    expect(text.startsWith("· 数据范围：")).toBe(true);
    // 商户 Top10 及之后的组被整条丢弃——证明截断真的发生过，
    // 而不是 fixture 本来就没超上限；较早的类目组完整保留
    expect(text).toContain("全期支出类目");
    expect(text).not.toContain("全期商户 Top10");
    expect(text).not.toContain("逐月收支");
    expect(text).not.toContain("订阅候选");
  });

  it("深夜逐月查询达到 50 个月上限时，占比标签诚实标注「近50个月」", async () => {
    const text = await buildDeepAnalysisContext(
      fakeRunner([
        [],
        [],
        [],
        [],
        [],
        [],
        Array.from({ length: 50 }, (_, i) => ({
          month: `2022-${String((i % 12) + 1).padStart(2, "0")}`,
          night: 30,
        })),
        [{ category: "深夜餐饮", sum: 2000, count: 4 }],
        [],
        [{ direction: "expense", sum: 100000 }],
      ]),
    );
    expect(text).toContain("深夜支出占比（近50个月） 1.5%");
    expect(text).not.toContain("全期深夜");
  });
});
