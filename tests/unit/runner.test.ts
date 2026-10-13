/**
 * 管线运行桥单测（波 4 公共层：SpendctEvent → 体检页 ThinkingEvent 映射）。
 *
 * 用 vi.mock 替换 DuckDB 服务/数据集/引擎三个外部依赖，直接驱动引擎侧
 * emit 回调回放协议事件，断言页面回调序列与 pipeline store 的最终状态：
 * - 阶段状态随 stage:start/stage:complete/error 迁移；
 * - evidence 事件聚合进 getRunEvidence（SQL 全文来自执行器常量表）；
 * - 拦截/降级/缓存事件映射为确定性文案；
 * - run:complete 写 store（published 卡过滤）并触发 onDone。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InsightCard } from "@/lib/schema/insight-card";
import type { StageState, ThinkingEvent } from "@/components/checkup/types";

vi.mock("@/lib/duckdb/service", () => ({
  getDuckDB: vi.fn(async () => ({})),
}));

vi.mock("@/lib/duckdb/dataset", () => ({
  initDataset: vi.fn(async () => ({ rowCount: 789 })),
  verifySchema: vi.fn(async () => []),
  dropDataset: vi.fn(async () => {}),
}));

vi.mock("@/lib/pipeline/mock-run", () => ({
  demoTransactions: vi.fn(() => Array.from({ length: 789 }, () => ({ tx_id: "x" }))),
}));

const runCheckupMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/pipeline/engine", () => ({
  runCheckup: runCheckupMock,
}));

import { createPipelineRun, getRunEvidence } from "@/lib/pipeline/runner";
import { usePipeline } from "@/lib/pipeline/store";
import type { SpendctEvent } from "@/lib/protocol/events";

const FIXTURE_CARD: InsightCard = {
  cardId: "card_profile_2_1",
  stage: "profile",
  status: "draft",
  headline: "餐饮支出占比 36%，连续三个月高于历史均值",
  narrative: "近 90 天餐饮支出占总支出的 36.2%，高于历史均值 8 个百分点。",
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

interface Harness {
  stages: StageState[];
  events: ThinkingEvent[];
  done: number;
  emit: (event: SpendctEvent) => void;
}

/** 组装 harness：创建 run、捕获引擎 emit 回调并触发 start（自动等待装载流程） */
async function startHarness(source: "upload" | "sample"): Promise<Harness> {
  runCheckupMock.mockReset();
  runCheckupMock.mockImplementation(async (input: { emit: (e: SpendctEvent) => void }) => {
    emitRef.emit = input.emit;
    // 引擎返回的卡含 reflect 后的状态；runner 只保留 published（07 §20 口径）
    return {
      cards: [
        { ...FIXTURE_CARD, status: "published" as const },
        { ...FIXTURE_CARD, cardId: "card_profile_2_2", status: "withheld" as const },
      ],
      elapsedMs: 3210,
      degraded: [],
    };
  });

  const harness: Harness = {
    stages: [],
    events: [],
    done: 0,
    emit: (event) => emitRef.emit(event),
  };
  const run = createPipelineRun(
    {
      onStageChange: (stage) => harness.stages.push(stage),
      onEvent: (event) => harness.events.push(event),
      onDone: () => {
        harness.done += 1;
      },
    },
    { source, datasetTxHash: "abcd1234" },
  );
  run.start();
  // 等装载流程完成（getDuckDB/initDataset 都是微任务）
  await vi.waitFor(() => expect(runCheckupMock).toHaveBeenCalled());
  return harness;
}

/** 引擎 emit 回调的传递槽（mock 实现与 harness 之间的唯一共享状态） */
const emitRef: { emit: (e: SpendctEvent) => void } = { emit: () => {} };

beforeEach(() => {
  usePipeline.getState().clear();
});

describe("createPipelineRun 事件映射", () => {
  it("sample 模式先装载演示数据集再跑引擎", async () => {
    const harness = await startHarness("sample");
    const demoTransactions = await import("@/lib/pipeline/mock-run");
    expect(demoTransactions.demoTransactions).toHaveBeenCalled();
    expect(harness.events.some((e) => e.text.includes("789"))).toBe(true);
  });

  it("stage:start → running 阶段状态与 progress 事件", async () => {
    const harness = await startHarness("upload");
    harness.emit({ t: "stage:start", ts: 1, runId: "r1", stage: "clean" });
    expect(harness.stages.at(-1)).toMatchObject({ id: "clean", status: "running" });
    expect(harness.events.at(-1)?.text).toContain("清洗");
  });

  it("stage:evidence 聚合进 getRunEvidence（SQL 全文来自执行器常量）", async () => {
    const harness = await startHarness("upload");
    harness.emit({ t: "stage:start", ts: 1, runId: "r1", stage: "clean" });
    harness.emit({
      t: "stage:evidence",
      ts: 2,
      runId: "r1",
      stage: "clean",
      tableId: "clean_overview",
      sqlHash: "9f2c1a4b8d3e",
      rowCount: 12,
      elapsedMs: 130,
    });
    const evidence = getRunEvidence("clean");
    expect(evidence?.hits).toBe(12);
    expect(evidence?.elapsedMs).toBe(130);
    expect(evidence?.sql).toContain("clean_overview");
  });

  it("stage:complete → succeeded 并携带卡片数", async () => {
    const harness = await startHarness("upload");
    harness.emit({ t: "stage:start", ts: 1, runId: "r1", stage: "profile" });
    harness.emit({
      t: "stage:complete",
      ts: 2,
      runId: "r1",
      stage: "profile",
      artifactCount: 2,
      cards: ["card_profile_2_1"],
    });
    expect(harness.stages.at(-1)).toMatchObject({ id: "profile", status: "succeeded", cards: 1 });
  });

  it("error → 阶段 failed + 降级清单 + tool 事件", async () => {
    const harness = await startHarness("upload");
    harness.emit({ t: "stage:start", ts: 1, runId: "r1", stage: "anomaly" });
    harness.emit({
      t: "error",
      ts: 2,
      runId: "r1",
      code: "PARSE_FAILED",
      message: "模板卡输入未通过契约校验",
      stage: "anomaly",
      retryable: true,
    });
    expect(harness.stages.at(-1)).toMatchObject({ id: "anomaly", status: "failed" });
    expect(harness.events.at(-1)?.text).toContain("PARSE_FAILED");
  });

  it("card:complete → progress + 证据抽屉卡缩略（ok 由置信度判定）", async () => {
    const harness = await startHarness("upload");
    harness.emit({ t: "stage:start", ts: 1, runId: "r1", stage: "profile" });
    harness.emit({ t: "stage:evidence", ts: 2, runId: "r1", stage: "profile", tableId: "profile_category_stats", sqlHash: "h1", rowCount: 8, elapsedMs: 90 });
    harness.emit({ t: "card:complete", ts: 3, runId: "r1", stage: "profile", card: FIXTURE_CARD });
    const evidence = getRunEvidence("profile");
    expect(evidence?.cards).toEqual([{ title: FIXTURE_CARD.headline, ok: true }]);
    expect(harness.events.at(-1)?.text).toContain(FIXTURE_CARD.headline);
  });

  it("llm:degraded / rag:retrieved / cache:hit / card:withheld 映射为确定性文案", async () => {
    const harness = await startHarness("upload");
    harness.emit({
      t: "llm:degraded",
      ts: 1,
      runId: "r1",
      task: "narrative",
      from: "deepseek",
      to: "qwen",
      reason: "上游限流",
    });
    harness.emit({ t: "rag:retrieved", ts: 2, runId: "r1", k: 3, ms: 12, mode: "tfidf", caseIds: ["rag:a", "rag:b", "rag:c"] });
    harness.emit({ t: "cache:hit", ts: 3, runId: "r1", stage: "clean", cacheKey: "v1:hash:clean" });
    harness.emit({
      t: "card:withheld",
      ts: 4,
      runId: "r1",
      stage: "profile",
      cardId: "card_profile_2_2",
      reason: "证据不足",
    });
    const texts = harness.events.map((e) => e.text);
    expect(texts.some((t) => t.includes("deepseek") && t.includes("qwen"))).toBe(true);
    expect(texts.some((t) => t.includes("案例库命中 3 条"))).toBe(true);
    const cacheEvent = harness.events.find((e) => e.text.includes("缓存命中"));
    expect(cacheEvent?.meta).toBe("cache");
    expect(texts.some((t) => t.includes("发布线"))).toBe(true);
  });

  it("run:complete → store 只写入 published 卡（withheld 被过滤）+ onDone 触发一次", async () => {
    const harness = await startHarness("upload");
    harness.emit({
      t: "run:complete",
      ts: 9,
      runId: "r1",
      cards: ["card_profile_2_1"],
      elapsedMs: 3210,
    });
    await vi.waitFor(() => expect(harness.done).toBe(1));
    const state = usePipeline.getState();
    expect(state.lastRun?.cards).toHaveLength(1);
    expect(state.lastRun?.source).toBe("upload");
  });

  it("pause 触发引擎 abort 信号；resume 从断点重跑一轮", async () => {
    const harness = await startHarness("upload");
    const firstCall = runCheckupMock.mock.calls[0]![0] as { signal: AbortSignal };
    expect(firstCall.signal.aborted).toBe(false);

    const run = createPipelineRun(
      {
        onStageChange: (stage) => harness.stages.push(stage),
        onEvent: (event) => harness.events.push(event),
        onDone: () => {
          harness.done += 1;
        },
      },
      { source: "upload", datasetTxHash: "abcd1234" },
    );
    run.start();
    // 等第二个 run 的引擎调用落地，再取它的 signal（第一个 run 属于 startHarness）
    await vi.waitFor(() => expect(runCheckupMock.mock.calls.length).toBeGreaterThanOrEqual(2));

    const currentCall = runCheckupMock.mock.calls.at(-1)![0] as { signal: AbortSignal };
    run.pause();
    expect(currentCall.signal.aborted).toBe(true);

    run.resume();
    await vi.waitFor(() => expect(runCheckupMock.mock.calls.length).toBeGreaterThan(1));
  });

  it("中止排水期间的 resume 请求不丢失：收口后自动重跑一轮", async () => {
    runCheckupMock.mockReset();
    // 第 1 次调用在 abort 后再挂 60ms 才返回（模拟引擎排水窗口），后续调用立即返回
    let calls = 0;
    runCheckupMock.mockImplementation(
      (input: { signal: AbortSignal }) =>
        new Promise((resolve) => {
          const result = {
            cards: [{ ...FIXTURE_CARD, status: "published" as const }],
            elapsedMs: 10,
            degraded: [],
          };
          const settle = () => resolve(result);
          calls += 1;
          if (input.signal.aborted || calls > 1) return settle();
          input.signal.addEventListener("abort", () => setTimeout(settle, 60), { once: true });
        }),
    );

    const harness: Harness = { stages: [], events: [], done: 0, emit: () => {} };
    const run = createPipelineRun(
      {
        onStageChange: (stage) => harness.stages.push(stage),
        onEvent: (event) => harness.events.push(event),
        onDone: () => {
          harness.done += 1;
        },
      },
      { source: "upload", datasetTxHash: "abcd1234" },
    );
    run.start();
    await vi.waitFor(() => expect(runCheckupMock).toHaveBeenCalledTimes(1));

    run.pause();
    // 引擎仍在排水（running 未复位）：resume 登记请求，收口后自动重跑
    run.resume();

    await vi.waitFor(() => expect(runCheckupMock).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(harness.done).toBe(1));
    // 排水轮的 onDone 被跳过，done 只来自重跑轮的收口
    expect(harness.done).toBe(1);
  });
});
