/**
 * 流式事件协议 spendct协议@2 —— 全仓唯一事件类型源（07 契约 §2）。
 *
 * SSE 传输，每事件一个 JSON 对象；公共字段 { t: 事件名, ts: 毫秒时间戳, runId }，
 * 可携带 stage / cardId。主流程（POST /api/pipeline/stage）与锚点追问
 * （POST /api/followup）共用本协议；其余文件只 import 不复制，任何文件不得自造事件名。
 *
 * 序列化 → 解析 round-trip、乱序重放排序、断流与未知事件名的判定均在本文件闭环，
 * 对应单测见 tests/unit/protocol.test.ts。
 */
import { z } from "zod";

import { SIX_STAGES } from "@/lib/pipeline/stage";

/**
 * 协议事件名全集（07 §2 清单逐条对应）。
 * 07 等文档章节标题口径为「21 类」，清单实际列出 20 个事件名；
 * 协议禁止自造事件名，本文件以清单为准。
 */
export const EVENT_NAMES = [
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
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

/** 错误码全集（07 §2，全项目唯一） */
export const ERROR_CODES = [
  "EMPTY_DATASET",
  "PARSE_FAILED",
  "LLM_EXHAUSTED",
  "DUCKDB_LOAD_FAILED",
  "QUOTA_EXCEEDED",
  "NETWORK_OFFLINE",
  "WHITELIST_REJECTED",
  "TIMEOUT",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** 模型标识全集（07 §12 任务级路由表枚举） */
export const MODEL_IDS = ["deepseek", "qwen", "glm4v", "local-tfjs"] as const;

export type ModelId = (typeof MODEL_IDS)[number];

// 卡片类型（card:complete 的 card 字段）：全仓唯一来源是 src/lib/schema/insight-card.ts
// （07 契约 §4）。协议层直接复用运行时卡 Schema，不复制校验逻辑。
import { InsightCardSchema } from "@/lib/schema/insight-card";

// —— 公共字段 ——
const tsField = z.number().int().nonnegative();
const runIdField = z.string().min(1);
const stageField = z.enum(SIX_STAGES);

// —— 运行级 ——
export const RunStartEventSchema = z.object({
  t: z.literal("run:start"),
  ts: tsField,
  runId: runIdField,
  datasetTxHash: z.string().min(1),
  source: z.enum(["upload", "sample"]),
  stageOrder: z.array(stageField),
});
export type RunStartEvent = z.infer<typeof RunStartEventSchema>;

export const RunCompleteEventSchema = z.object({
  t: z.literal("run:complete"),
  ts: tsField,
  runId: runIdField,
  cards: z.array(z.string()),
  elapsedMs: z.number().int().nonnegative(),
  degraded: z.array(z.string()).optional(),
});
export type RunCompleteEvent = z.infer<typeof RunCompleteEventSchema>;

export const ErrorEventSchema = z.object({
  t: z.literal("error"),
  ts: tsField,
  runId: runIdField,
  code: z.enum(ERROR_CODES),
  message: z.string().min(1),
  stage: stageField.optional(),
  retryable: z.boolean(),
});
export type ErrorEvent = z.infer<typeof ErrorEventSchema>;

export const AbortEventSchema = z.object({
  t: z.literal("abort"),
  ts: tsField,
  runId: runIdField,
  reason: z.string().min(1),
});
export type AbortEvent = z.infer<typeof AbortEventSchema>;

// —— 阶段级 ——
export const StageStartEventSchema = z.object({
  t: z.literal("stage:start"),
  ts: tsField,
  runId: runIdField,
  stage: stageField,
});
export type StageStartEvent = z.infer<typeof StageStartEventSchema>;

export const StageThinkingEventSchema = z.object({
  t: z.literal("stage:thinking"),
  ts: tsField,
  runId: runIdField,
  stage: stageField,
  text: z.string(),
});
export type StageThinkingEvent = z.infer<typeof StageThinkingEventSchema>;

export const StageEvidenceEventSchema = z.object({
  t: z.literal("stage:evidence"),
  ts: tsField,
  runId: runIdField,
  stage: stageField,
  tableId: z.string().min(1),
  sqlHash: z.string().min(1),
  rowCount: z.number().int().nonnegative(),
  elapsedMs: z.number().int().nonnegative(),
});
export type StageEvidenceEvent = z.infer<typeof StageEvidenceEventSchema>;

export const StageCompleteEventSchema = z.object({
  t: z.literal("stage:complete"),
  ts: tsField,
  runId: runIdField,
  stage: stageField,
  artifactCount: z.number().int().nonnegative(),
  cards: z.array(z.string()),
});
export type StageCompleteEvent = z.infer<typeof StageCompleteEventSchema>;

export const StageSkippedEventSchema = z.object({
  t: z.literal("stage:skipped"),
  ts: tsField,
  runId: runIdField,
  stage: stageField,
  reason: z.string().min(1),
});
export type StageSkippedEvent = z.infer<typeof StageSkippedEventSchema>;

// —— 卡片级 ——
export const CardDeltaEventSchema = z.object({
  t: z.literal("card:delta"),
  ts: tsField,
  runId: runIdField,
  stage: stageField,
  cardId: z.string().min(1),
  delta: z.record(z.string(), z.unknown()),
});
export type CardDeltaEvent = z.infer<typeof CardDeltaEventSchema>;

export const CardCompleteEventSchema = z.object({
  t: z.literal("card:complete"),
  ts: tsField,
  runId: runIdField,
  stage: stageField,
  card: InsightCardSchema,
});
export type CardCompleteEvent = z.infer<typeof CardCompleteEventSchema>;

export const CardWithheldEventSchema = z.object({
  t: z.literal("card:withheld"),
  ts: tsField,
  runId: runIdField,
  stage: stageField,
  cardId: z.string().min(1),
  reason: z.string().min(1),
});
export type CardWithheldEvent = z.infer<typeof CardWithheldEventSchema>;

// —— LLM 运行态 ——
export const LlmDegradedEventSchema = z.object({
  t: z.literal("llm:degraded"),
  ts: tsField,
  runId: runIdField,
  task: z.string().min(1),
  from: z.enum(MODEL_IDS),
  to: z.union([z.enum(MODEL_IDS), z.literal("template")]),
  reason: z.string().min(1),
});
export type LlmDegradedEvent = z.infer<typeof LlmDegradedEventSchema>;

export const LlmRepairEventSchema = z.object({
  t: z.literal("llm:repair"),
  ts: tsField,
  runId: runIdField,
  task: z.string().min(1),
  attempt: z.number().int().positive(),
  issues: z.array(z.string()),
});
export type LlmRepairEvent = z.infer<typeof LlmRepairEventSchema>;

// —— RAG / 工具 / 反思 / 缓存 ——
export const RagRetrievedEventSchema = z.object({
  t: z.literal("rag:retrieved"),
  ts: tsField,
  runId: runIdField,
  k: z.number().int().positive(),
  ms: z.number().int().nonnegative(),
  mode: z.enum(["dense", "tfidf"]),
  caseIds: z.array(z.string()),
});
export type RagRetrievedEvent = z.infer<typeof RagRetrievedEventSchema>;

export const ToolStartEventSchema = z.object({
  t: z.literal("tool:start"),
  ts: tsField,
  runId: runIdField,
  tool: z.string().min(1),
  argsDigest: z.string(),
});
export type ToolStartEvent = z.infer<typeof ToolStartEventSchema>;

export const ToolEndEventSchema = z.object({
  t: z.literal("tool:end"),
  ts: tsField,
  runId: runIdField,
  tool: z.string().min(1),
  ok: z.boolean(),
  ms: z.number().int().nonnegative(),
  errorReason: z.string().optional(),
});
export type ToolEndEvent = z.infer<typeof ToolEndEventSchema>;

export const ReflectResultEventSchema = z.object({
  t: z.literal("reflect:result"),
  ts: tsField,
  runId: runIdField,
  cardId: z.string().min(1),
  pass: z.boolean(),
  revisedConfidence: z.number().min(0).max(1).optional(),
});
export type ReflectResultEvent = z.infer<typeof ReflectResultEventSchema>;

export const CacheHitEventSchema = z.object({
  t: z.literal("cache:hit"),
  ts: tsField,
  runId: runIdField,
  stage: stageField,
  cacheKey: z.string().min(1),
});
export type CacheHitEvent = z.infer<typeof CacheHitEventSchema>;

export const CheckpointSavedEventSchema = z.object({
  t: z.literal("checkpoint:saved"),
  ts: tsField,
  runId: runIdField,
  stage: stageField,
});
export type CheckpointSavedEvent = z.infer<typeof CheckpointSavedEventSchema>;

/** 事件判别联合：以 t 为判别键的协议事件全集 */
export const SpendctEventSchema = z.discriminatedUnion("t", [
  RunStartEventSchema,
  RunCompleteEventSchema,
  ErrorEventSchema,
  AbortEventSchema,
  StageStartEventSchema,
  StageThinkingEventSchema,
  StageEvidenceEventSchema,
  StageCompleteEventSchema,
  StageSkippedEventSchema,
  CardDeltaEventSchema,
  CardCompleteEventSchema,
  CardWithheldEventSchema,
  LlmDegradedEventSchema,
  LlmRepairEventSchema,
  RagRetrievedEventSchema,
  ToolStartEventSchema,
  ToolEndEventSchema,
  ReflectResultEventSchema,
  CacheHitEventSchema,
  CheckpointSavedEventSchema,
]);

export type SpendctEvent = z.infer<typeof SpendctEventSchema>;

/**
 * 序列化：先过协议校验再落 JSON，保证产物必然可被 parseEvent 解析。
 * 非法事件（缺公共字段、未知 t 等）直接抛错，不让坏数据进 SSE。
 */
export function serializeEvent(e: SpendctEvent): string {
  return JSON.stringify(SpendctEventSchema.parse(e));
}

/** 解析单个事件 JSON：JSON 损坏（断流/截断）或协议不合法（未知 t / 字段缺失）都抛错 */
export function parseEvent(json: string): SpendctEvent {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (cause) {
    throw new Error("事件 JSON 无法解析（断流或截断）", { cause });
  }
  return SpendctEventSchema.parse(raw);
}

/**
 * 乱序事件数组重放：逐条解析后按 ts 升序稳定排序（ES2019 起 Array#sort 稳定），
 * 同 ts 的事件保持原始到达顺序。断流恢复时由客户端调用（01 §6.1）。
 */
export function parseEvents(jsonLines: string[]): SpendctEvent[] {
  return jsonLines.map(parseEvent).sort((a, b) => a.ts - b.ts);
}

/** 类型守卫：运行时判定任意值是否为合法协议事件 */
export function isSpendctEvent(v: unknown): v is SpendctEvent {
  return SpendctEventSchema.safeParse(v).success;
}
