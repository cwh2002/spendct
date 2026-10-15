/**
 * 流式事件协议单测（07 §2 spendct协议@2）。
 * 覆盖：契约事件全集 round-trip、乱序重放按 ts 排序、断流/截断抛错、
 * 未知事件名拒绝、ErrorCode 全枚举、公共字段缺失拒绝。
 */
import { describe, expect, it } from "vitest";

import {
  ERROR_CODES,
  EVENT_NAMES,
  MODEL_IDS,
  isSpendctEvent,
  parseEvent,
  parseEvents,
  serializeEvent,
} from "@/lib/protocol/events";
import type { SpendctEvent } from "@/lib/protocol/events";
import type { InsightCard } from "@/lib/schema/insight-card";

const RUN_ID = "run_20261013_demo";
const BASE_TS = 1_726_000_000_000;

/** card:complete 的卡载荷：合法运行时卡（07 §4 insight-card@v1） */
const FIXTURE_CARD: InsightCard = {
  cardId: "card_profile_1_1",
  stage: "profile",
  status: "draft",
  headline: "餐饮类目占比最高，连续三个月领跑",
  narrative: "近 90 天餐饮支出占总支出的 36%，高于历史均值 8 个百分点。",
  confidence: 0.82,
  significance: "占比偏离历史均值 1.5 倍标准差",
  evidence: {
    chart: {
      tableId: "profile_category_stats",
      chartType: "bar",
      title: "近 90 天分类支出排行",
      dimField: "category",
      measureFields: ["expense_cents"],
    },
    stats: [{ label: "餐饮", value: "128530", unit: "分" }],
  },
  sources: [{ kind: "sql", ref: "sql:table:profile_category_stats" }],
  actions: ["confirm", "dispute", "drill"],
  disclaimer: "本结论基于账单聚合数据，金额已脱敏，仅供参考",
};

/** 07 §2 清单逐条对应的合法事件样本（每事件名一份） */
function contractEventFixtures(): SpendctEvent[] {
  const ts = (offset: number) => BASE_TS + offset;
  return [
    {
      t: "run:start",
      ts: ts(0),
      runId: RUN_ID,
      datasetTxHash: "9f2c1a4b8d3e5076",
      source: "sample",
      stageOrder: ["clean", "profile", "anomaly", "subscription", "attribution", "annual"],
    },
    {
      t: "run:complete",
      ts: ts(1),
      runId: RUN_ID,
      cards: ["card_profile_1_1"],
      elapsedMs: 3210,
      degraded: ["attribution"],
    },
    {
      t: "error",
      ts: ts(2),
      runId: RUN_ID,
      code: "PARSE_FAILED",
      message: "第 42 行金额列无法解析",
      stage: "clean",
      retryable: false,
    },
    { t: "abort", ts: ts(3), runId: RUN_ID, reason: "用户取消" },
    { t: "stage:start", ts: ts(4), runId: RUN_ID, stage: "clean" },
    {
      t: "stage:thinking",
      ts: ts(5),
      runId: RUN_ID,
      stage: "clean",
      text: "正在解析 1024 行明细……",
    },
    {
      t: "stage:evidence",
      ts: ts(6),
      runId: RUN_ID,
      stage: "clean",
      tableId: "clean_overview",
      sqlHash: "a1b2c3d4",
      rowCount: 12,
      elapsedMs: 45,
    },
    {
      t: "stage:complete",
      ts: ts(7),
      runId: RUN_ID,
      stage: "clean",
      artifactCount: 3,
      cards: ["card_clean_1_1"],
    },
    { t: "stage:skipped", ts: ts(8), runId: RUN_ID, stage: "annual", reason: "样本不足一年" },
    {
      t: "card:delta",
      ts: ts(9),
      runId: RUN_ID,
      stage: "profile",
      cardId: "card_profile_1_1",
      delta: { narrative: "餐饮占" },
    },
    { t: "card:complete", ts: ts(10), runId: RUN_ID, stage: "profile", card: FIXTURE_CARD },
    {
      t: "card:withheld",
      ts: ts(11),
      runId: RUN_ID,
      stage: "profile",
      cardId: "card_profile_1_2",
      reason: "L1 数字溯源失败",
    },
    {
      t: "llm:degraded",
      ts: ts(12),
      runId: RUN_ID,
      task: "stage narrative",
      from: "deepseek",
      to: "qwen",
      reason: "上游限流",
    },
    {
      t: "llm:repair",
      ts: ts(13),
      runId: RUN_ID,
      task: "stage narrative",
      attempt: 1,
      issues: ["confidence 超出 [0,1]"],
    },
    {
      t: "rag:retrieved",
      ts: ts(14),
      runId: RUN_ID,
      k: 5,
      ms: 320,
      mode: "dense",
      caseIds: ["sub_001", "sub_002"],
    },
    { t: "tool:start", ts: ts(15), runId: RUN_ID, tool: "weather", argsDigest: '{"city":"beijing"}' },
    { t: "tool:end", ts: ts(16), runId: RUN_ID, tool: "weather", ok: true, ms: 410 },
    {
      t: "reflect:result",
      ts: ts(17),
      runId: RUN_ID,
      cardId: "card_profile_1_1",
      pass: true,
      revisedConfidence: 0.81,
    },
    {
      t: "cache:hit",
      ts: ts(18),
      runId: RUN_ID,
      stage: "clean",
      cacheKey: "stage:v1:9f2c1a4b8d3e5076:clean",
    },
    { t: "checkpoint:saved", ts: ts(19), runId: RUN_ID, stage: "profile" },
    {
      t: "plan",
      ts: ts(20),
      runId: RUN_ID,
      goal: "围绕大促问题给出消费规划",
      steps: [
        { title: "查询大促日历确认档期与平台", tool: "get_promo_calendar" },
        { title: "对照账单统计评估购物节奏" },
      ],
    },
  ];
}

describe("事件名全集", () => {
  it("与契约 §2 清单一致（21 个名字，plan 为修订案 A12 新增，顺序固定）", () => {
    expect(EVENT_NAMES).toEqual([
      "run:start",
      "run:complete",
      "error",
      "abort",
      "stage:start",
      "stage:thinking",
      "stage:evidence",
      "stage:complete",
      "stage:skipped",
      "card:delta",
      "card:complete",
      "card:withheld",
      "llm:degraded",
      "llm:repair",
      "rag:retrieved",
      "tool:start",
      "tool:end",
      "reflect:result",
      "cache:hit",
      "checkpoint:saved",
      "plan",
    ]);
  });
});

describe("契约事件全集 round-trip", () => {
  it("每种事件 serialize → parse 后与原值无损相等", () => {
    for (const e of contractEventFixtures()) {
      const parsed = parseEvent(serializeEvent(e));
      expect(parsed).toEqual(e);
      expect(isSpendctEvent(parsed)).toBe(true);
    }
  });
});

describe("乱序重放", () => {
  it("parseEvents 按 ts 升序排序，同 ts 保持到达顺序", () => {
    const late: SpendctEvent = { t: "stage:start", ts: BASE_TS + 300, runId: RUN_ID, stage: "clean" };
    const first: SpendctEvent = {
      t: "stage:thinking",
      ts: BASE_TS + 100,
      runId: RUN_ID,
      stage: "clean",
      text: "先思考",
    };
    const second: SpendctEvent = {
      t: "stage:evidence",
      ts: BASE_TS + 100,
      runId: RUN_ID,
      stage: "clean",
      tableId: "clean_overview",
      sqlHash: "a1b2c3d4",
      rowCount: 1,
      elapsedMs: 1,
    };
    const replayed = parseEvents([
      serializeEvent(late),
      serializeEvent(first),
      serializeEvent(second),
    ]);
    expect(replayed.map((e) => e.ts)).toEqual([BASE_TS + 100, BASE_TS + 100, BASE_TS + 300]);
    expect(replayed[0]?.t).toBe("stage:thinking");
    expect(replayed[1]?.t).toBe("stage:evidence");
    expect(replayed[2]?.t).toBe("stage:start");
  });
});

describe("断流与非法输入", () => {
  it("截断 JSON 抛错", () => {
    const line = serializeEvent({ t: "abort", ts: BASE_TS, runId: RUN_ID, reason: "断流演示" });
    const cut = Math.floor(line.length / 2);
    expect(() => parseEvent(line.slice(0, cut))).toThrow();
    expect(() => parseEvent("")).toThrow();
    expect(() => parseEvent("{ t: 'abort' }")).toThrow();
  });

  it("未知事件名拒绝（协议禁止自造事件名）", () => {
    const forged = JSON.stringify({ t: "card:published", ts: BASE_TS, runId: RUN_ID, cardId: "x" });
    expect(() => parseEvent(forged)).toThrow();
    expect(isSpendctEvent(JSON.parse(forged))).toBe(false);
  });

  it("缺公共字段或事件字段拒绝", () => {
    // 缺 reason
    expect(() => parseEvent(JSON.stringify({ t: "abort", ts: BASE_TS, runId: RUN_ID }))).toThrow();
    // 缺 runId
    expect(() => parseEvent(JSON.stringify({ t: "stage:start", ts: BASE_TS }))).toThrow();
    // 缺 t 与 ts
    expect(() => parseEvent(JSON.stringify({ runId: RUN_ID }))).toThrow();
  });

  it("plan 事件越界拒绝（步骤超过 4 步或 goal 为空）", () => {
    const manySteps = JSON.stringify({
      t: "plan",
      ts: BASE_TS,
      runId: RUN_ID,
      goal: "目标",
      steps: [1, 2, 3, 4, 5].map((n) => ({ title: `步骤${n}` })),
    });
    expect(() => parseEvent(manySteps)).toThrow();
    const emptyGoal = JSON.stringify({
      t: "plan",
      ts: BASE_TS,
      runId: RUN_ID,
      goal: "",
      steps: [{ title: "步骤1" }],
    });
    expect(() => parseEvent(emptyGoal)).toThrow();
  });

  it("isSpendctEvent 对垃圾值返回 false", () => {
    expect(isSpendctEvent(null)).toBe(false);
    expect(isSpendctEvent(42)).toBe(false);
    expect(isSpendctEvent({ t: "abort" })).toBe(false);
  });
});

describe("ErrorCode 与 ModelId 枚举", () => {
  it("ErrorCode 为契约 §2 的 8 个值，逐码 round-trip", () => {
    expect(ERROR_CODES).toEqual([
      "EMPTY_DATASET",
      "PARSE_FAILED",
      "LLM_EXHAUSTED",
      "DUCKDB_LOAD_FAILED",
      "QUOTA_EXCEEDED",
      "NETWORK_OFFLINE",
      "WHITELIST_REJECTED",
      "TIMEOUT",
    ]);
    for (const code of ERROR_CODES) {
      const e: SpendctEvent = {
        t: "error",
        ts: BASE_TS,
        runId: RUN_ID,
        code,
        message: `演示错误 ${code}`,
        retryable: code === "TIMEOUT",
      };
      expect(parseEvent(serializeEvent(e))).toEqual(e);
    }
  });

  it("ModelId 为契约 §12 的 4 个值，llm:degraded 的 to 另允许 template", () => {
    expect(MODEL_IDS).toEqual(["deepseek", "qwen", "glm4v", "local-tfjs"]);
    const e: SpendctEvent = {
      t: "llm:degraded",
      ts: BASE_TS,
      runId: RUN_ID,
      task: "stage narrative",
      from: "deepseek",
      to: "template",
      reason: "双模型均不可用，回退确定性模板",
    };
    expect(parseEvent(serializeEvent(e))).toEqual(e);
  });
});
