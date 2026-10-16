/**
 * 年度海报数据层（A17，报告页与海报页共用）单测：
 * 覆盖三条聚合 SQL 白名单预检、年度总览行解析（空库兜底）、六维健康行解析
 * （查询 DESC 倒序为升序）、健康分映射（极端值与中间值）、四指标状态规则与
 * 演示海报输入形态。
 */
import { describe, expect, it } from "vitest";

import {
  ACTIVE_MONTHS_SQL,
  ANNUAL_OVERVIEW_SQL,
  buildDemoMetrics,
  buildRealMetrics,
  computeHealthScore,
  demoPosterInput,
  HEALTH_INPUTS_SQL,
  parseAnnualOverview,
  parseHealthRows,
  type HealthStats,
} from "@/lib/report/poster-input";
import { precheckAggregateSql } from "@/lib/sql-guard/whitelist";

describe("海报数据层三条聚合 SQL（白名单预检）", () => {
  it("年度总览 / 六维健康输入 / 活跃月数全部通过预检", () => {
    expect(precheckAggregateSql(ANNUAL_OVERVIEW_SQL).ok).toBe(true);
    expect(precheckAggregateSql(HEALTH_INPUTS_SQL).ok).toBe(true);
    expect(precheckAggregateSql(ACTIVE_MONTHS_SQL).ok).toBe(true);
  });
});

describe("parseAnnualOverview（年度总览行解析）", () => {
  it("按 SELECT 位置取值；非字符串 top_category 归一为 null", () => {
    const annual = parseAnnualOverview([
      { a: "2026", b: 173300, c: 200000, d: 42, e: "餐饮" },
    ]);
    expect(annual).toEqual({
      year: "2026",
      totalExpenseCents: 173300,
      totalIncomeCents: 200000,
      totalTx: 42,
      topCategory: "餐饮",
    });
    expect(parseAnnualOverview([{ a: "2026", b: 100, c: 0, d: 1, e: 7 }])?.topCategory).toBeNull();
  });

  it("空行或全零聚合（空库）返回 null：整份海报保持 demo 口径", () => {
    expect(parseAnnualOverview([])).toBeNull();
    expect(parseAnnualOverview([{ a: "2026", b: 0, c: 0, d: 0, e: null }])).toBeNull();
  });
});

describe("parseHealthRows（六维健康行解析）", () => {
  it("查询 DESC 输入倒序为升序，month 走 fmtMonth 口径", () => {
    const rows = parseHealthRows([
      { a: "2026-10", b: 30, c: 5, d: 8, e: 6, f: 20, g: 10 },
      { a: "2026-09", b: 34, c: 6, d: 9, e: 7, f: 18, g: 12 },
    ]);
    expect(rows.map((row) => row.month)).toEqual(["2026-09", "2026-10"]);
    expect(rows[1]?.foodRatio).toBe(30);
    expect(rows[1]?.bigPulseRatio).toBe(10);
  });
});

describe("computeHealthScore（六维比率 → 健康指数）", () => {
  const health = (ratios: Partial<HealthStats["rows"][number]>): HealthStats => ({
    rows: [
      {
        month: "2026-10",
        foodRatio: 50,
        subRatio: 20,
        impulseRatio: 30,
        nightRatio: 15,
        surplusRatio: 0,
        bigPulseRatio: 40,
        ...ratios,
      },
    ],
  });

  it("全指标触零分线得 0，全指标触满分线得 100", () => {
    expect(computeHealthScore(health({})).healthIndex).toBe(0);
    expect(
      computeHealthScore(
        health({ foodRatio: 10, subRatio: 0, impulseRatio: 0, nightRatio: 0, surplusRatio: 40, bigPulseRatio: 0 }),
      ).healthIndex,
    ).toBe(100);
  });

  it("中间值线性插值并六维等权合成", () => {
    // 只有餐饮一项落在中段（50 分），其余五项满分 → (50 + 100×5) / 6 ≈ 92
    expect(
      computeHealthScore(health({ foodRatio: 30, subRatio: 0, impulseRatio: 0, nightRatio: 0, surplusRatio: 40, bigPulseRatio: 0 })).healthIndex,
    ).toBe(92);
  });
});

describe("buildRealMetrics（真实四指标状态规则）", () => {
  const health: HealthStats = {
    rows: [
      {
        month: "2026-09",
        foodRatio: 30,
        subRatio: 1,
        impulseRatio: 10,
        nightRatio: 5,
        surplusRatio: 10,
        bigPulseRatio: 8,
      },
      {
        month: "2026-10",
        foodRatio: 34,
        subRatio: 2,
        impulseRatio: 12,
        nightRatio: 6,
        surplusRatio: 12,
        bigPulseRatio: 9,
      },
    ],
  };

  it("展示值取均值、环比取最近两月之差（百分点带符号）", () => {
    const metrics = buildRealMetrics(health);
    expect(metrics).toHaveLength(4);
    const dining = metrics.find((m) => m.id === "dining-share")!;
    expect(dining.value).toBe("32.0%"); // (30+34)/2
    expect(dining.delta).toBe("+4.0 个百分点");
    expect(dining.status).toBe("warn"); // ≥29.3 关注、<40 未达预警
    expect(dining.benchmark).toBe("29.3%");
  });

  it("结余率低于关注线判预警，公开基准挂国家统计局推算值", () => {
    const save = buildRealMetrics(health).find((m) => m.id === "save-rate")!;
    expect(save.value).toBe("11.0%");
    expect(save.status).toBe("serious"); // <15 预警
    expect(save.benchmark).toMatch(/^\d+\.\d%$/);
  });

  it("无公开基准的指标 benchmark 为 null（不渲染基准行）", () => {
    const sub = buildRealMetrics(health).find((m) => m.id === "hidden-subscription")!;
    expect(sub.benchmark).toBeNull();
  });
});

describe("演示海报输入（内置数据兜底）", () => {
  it("形态完整：年度元信息、0-100 健康指数、四具名指标", () => {
    const input = demoPosterInput();
    expect(input.isReal).toBe(false);
    expect(input.meta.year).toBe("2026");
    expect(input.meta.monthsCovered).toBeGreaterThan(0);
    expect(input.healthIndex).toBeGreaterThanOrEqual(0);
    expect(input.healthIndex).toBeLessThanOrEqual(100);
    expect(input.namedMetrics).toHaveLength(4);
  });

  it("演示指标值统一一位小数百分比，基准与说明走真实口径常量", () => {
    const metrics = buildDemoMetrics();
    for (const metric of metrics) {
      expect(metric.value).toMatch(/^\d+\.\d%$/);
      expect(metric.explain.length).toBeGreaterThan(0);
    }
    expect(metrics.find((m) => m.id === "dining-share")?.benchmark).toBe("29.3%");
    expect(metrics.find((m) => m.id === "hidden-subscription")?.benchmark).toBeNull();
  });
});
