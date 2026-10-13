/**
 * 六阶段管线引擎（07 契约 §1 状态机 + §17 断点续跑 + §20 发布闸门）。
 *
 * runCheckup 状态机：
 *   run:start → 六阶段顺序执行 → reflect 闸门 → run:complete
 *
 * 每阶段：
 *   stage:start → 逐条确定性 SQL 经白名单 runWhitelistedAggregate 执行 →
 *   stage:evidence（sqlHash = sha256(sql) 前 12 位 hex）→
 *   模板卡组装（card-factory buildTemplateCard）→ card:delta + card:complete →
 *   stage:complete → checkpoint:saved（localStorage "spendct:run:latest"）
 *
 * 异常与降级：
 *   单阶段失败发 error 事件（EMPTY_DATASET / WHITELIST_REJECTED 不可重试，
 *   其余可重试），记录进 degraded，继续下一阶段；run:complete 携带 degraded。
 *   signal.abort → 发 abort 事件，终止并返回已产出的卡。
 *
 * reflect 闸门（07 §20）：每张卡自检 confidence≥0.6、阶段证据行数≥2、
 *   统计值不全为零、headline 8-120 / narrative 8-600；全过才 published，
 *   否则 withheld 并逐一发 reflect:result + card:withheld。
 *
 * 引擎不依赖 DuckDB wasm：聚合统一走 runWhitelistedAggregate（单测用 fake conn）。
 */
import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";

import { SIX_STAGES, type StageId } from "@/lib/pipeline/stage";
import { buildTemplateCard } from "@/lib/pipeline/card-factory";
import type { InsightCard } from "@/lib/schema/insight-card";
import type { ErrorCode, SpendctEvent } from "@/lib/protocol/events";
import { runWhitelistedAggregate, WhitelistRejectedError } from "@/lib/sql-guard/whitelist";

import { ANNUAL_EXECUTOR } from "./stages/annual";
import { ANOMALY_EXECUTOR } from "./stages/anomaly";
import { ATTRIBUTION_EXECUTOR } from "./stages/attribution";
import { CLEAN_EXECUTOR } from "./stages/clean";
import { PROFILE_EXECUTOR } from "./stages/profile";
import {
  EmptyDatasetError,
  type EvidenceResult,
  type StageCardContext,
  type StageExecutor,
} from "./stages/spec";
import { SUBSCRIPTION_EXECUTOR } from "./stages/subscription";

/** 体检运行入参（07 §17：demo 与上传共用同一引擎入口） */
export interface RunCheckupInput {
  conn: AsyncDuckDBConnection;
  datasetHash: string;
  source: "upload" | "sample";
  emit: (e: SpendctEvent) => void;
  signal?: AbortSignal;
}

/** 体检运行结果：全部卡（published + withheld）+ 总耗时 + 失败阶段清单 */
export interface RunCheckupResult {
  cards: InsightCard[];
  elapsedMs: number;
  degraded?: string[];
}

/** 断点存储键（07 §17：只存阶段与时间戳，不存行数据） */
const CHECKPOINT_KEY = "spendct:run:latest";

/** 六阶段执行器注册表（顺序 = SIX_STAGES） */
const STAGE_EXECUTORS: Record<StageId, StageExecutor> = {
  clean: CLEAN_EXECUTOR,
  profile: PROFILE_EXECUTOR,
  anomaly: ANOMALY_EXECUTOR,
  subscription: SUBSCRIPTION_EXECUTOR,
  attribution: ATTRIBUTION_EXECUTOR,
  annual: ANNUAL_EXECUTOR,
};

/** 阶段证据缓存键：v1:数据集哈希:阶段（阶段级缓存与断点续跑的公共口径） */
export function stageCacheKey(datasetHash: string, stage: StageId): string {
  return `v1:${datasetHash}:${stage}`;
}

/** 读取断点（07 §17）：返回最近一次已存盘阶段；无断点或数据非法时返回 null */
export async function resumeCheckpoint(): Promise<{ stage: StageId } | null> {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(CHECKPOINT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const stage = (parsed as { stage?: unknown }).stage;
      if (typeof stage === "string" && SIX_STAGES.includes(stage as StageId)) {
        return { stage: stage as StageId };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** 写断点：localStorage 不可用（隐私模式/非浏览器环境）时静默跳过 */
function saveCheckpoint(stage: StageId): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(CHECKPOINT_KEY, JSON.stringify({ paused: false, stage, ts: Date.now() }));
  } catch {
    // 存储不可用时断点降级为本次运行内有效，不阻塞主流程
  }
}

/** sha256 十六进制摘要；无 WebCrypto 环境退化为双种子 FNV-1a（仅事件摘要展示用） */
async function sha256Hex(text: string): Promise<string> {
  if (typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined") {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }
  const fnv1a = (seed: number): string => {
    let hash = seed >>> 0;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  };
  return (fnv1a(0x811c9dc5) + fnv1a(0x9e3779b9)).slice(0, 12);
}

/** 错误分类：空数据集与白名单拒绝不可重试；执行超时可重试，其余解析类错误可重试 */
function classifyError(err: unknown): { code: ErrorCode; retryable: boolean } {
  if (err instanceof EmptyDatasetError) {
    return { code: "EMPTY_DATASET", retryable: false };
  }
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("超时") || /timeout/i.test(message)) {
    return { code: "TIMEOUT", retryable: true };
  }
  if (err instanceof WhitelistRejectedError) {
    return { code: "WHITELIST_REJECTED", retryable: false };
  }
  return { code: "PARSE_FAILED", retryable: true };
}

/** 单卡自检（07 §20 发布闸门的输入） */
function reflectCard(card: InsightCard, evidenceRowCount: number): { pass: boolean; issues: string[] } {
  const issues: string[] = [];
  if (card.confidence < 0.6) {
    issues.push(`置信度 ${card.confidence.toFixed(2)} 低于 0.6 发布线`);
  }
  if (evidenceRowCount < 2) {
    issues.push(`阶段证据行数 ${evidenceRowCount} 不足 2 行，显著性未达标`);
  }
  const stats = card.evidence.stats;
  const allZero = stats.length > 0 && stats.every((s: { value: string }) => /^0(\.0+)?%?$/.test(s.value.trim()));
  if (allZero) {
    issues.push("统计值全为零，无有效发现");
  }
  if (card.headline.length < 8 || card.headline.length > 120) {
    issues.push(`标题长度 ${card.headline.length} 超出 8-120 区间`);
  }
  if (card.narrative.length < 8 || card.narrative.length > 600) {
    issues.push(`正文长度 ${card.narrative.length} 超出 8-600 区间`);
  }
  return { pass: issues.length === 0, issues };
}

/**
 * 执行一次完整六阶段体检。事件序列保证：
 * run:start 最先、run:complete 最后（中断时以 abort 结尾）；
 * 每阶段 stage:start 与 stage:complete 成对（失败阶段只有 error）。
 */
export async function runCheckup(input: RunCheckupInput): Promise<RunCheckupResult> {
  const startedAt = Date.now();
  const { conn, datasetHash, source, emit, signal } = input;
  const runId = crypto.randomUUID().replace(/-/g, "").slice(0, 10);

  const cards: InsightCard[] = [];
  const evidenceByStage = new Map<StageId, EvidenceResult[]>();
  const cardStage = new Map<string, StageId>();
  const degraded: string[] = [];

  /** 中断收尾：发 abort 事件并返回已产出的卡（不覆盖已有事件序列） */
  const finishAborted = (): RunCheckupResult => {
    emit({ t: "abort", ts: Date.now(), runId, reason: "用户主动中断" });
    const elapsedMs = Date.now() - startedAt;
    return { cards, elapsedMs, ...(degraded.length > 0 ? { degraded } : {}) };
  };

  emit({
    t: "run:start",
    ts: Date.now(),
    runId,
    datasetTxHash: datasetHash,
    source,
    stageOrder: [...SIX_STAGES],
  });

  for (const stage of SIX_STAGES) {
    if (signal?.aborted) return finishAborted();
    emit({ t: "stage:start", ts: Date.now(), runId, stage });

    const executor = STAGE_EXECUTORS[stage];
    try {
      // 确定性聚合：逐条过白名单（双保险：SQL 本身是代码常量）
      const evidence: EvidenceResult[] = [];
      for (const query of executor.queries) {
        if (signal?.aborted) return finishAborted();
        const aggregate = await runWhitelistedAggregate(conn, query.sql);
        if (signal?.aborted) return finishAborted();
        const sqlHash = (await sha256Hex(query.sql)).slice(0, 12);
        const result: EvidenceResult = {
          tableId: query.tableId,
          sqlHash,
          rows: aggregate.rows as Record<string, unknown>[],
          rowCount: aggregate.rowCount,
          elapsedMs: Math.round(aggregate.elapsedMs),
        };
        evidence.push(result);
        emit({
          t: "stage:evidence",
          ts: Date.now(),
          runId,
          stage,
          tableId: result.tableId,
          sqlHash: result.sqlHash,
          rowCount: result.rowCount,
          elapsedMs: result.elapsedMs,
        });
      }
      evidenceByStage.set(stage, evidence);

      // 模板卡组装：执行器把聚合结果折叠成 1-3 张模板卡输入
      const ctx: StageCardContext = {
        getEvidence: (s) => evidenceByStage.get(s) ?? [],
      };
      const inputs = executor.buildCardInputs(evidence, ctx);
      if (signal?.aborted) return finishAborted();

      const stageCardIds: string[] = [];
      for (const input of inputs) {
        const card = buildTemplateCard(stage, input);
        cards.push(card);
        cardStage.set(card.cardId, stage);
        stageCardIds.push(card.cardId);
        emit({
          t: "card:delta",
          ts: Date.now(),
          runId,
          stage,
          cardId: card.cardId,
          delta: { headline: card.headline, confidence: card.confidence },
        });
        emit({ t: "card:complete", ts: Date.now(), runId, stage, card });
      }

      emit({
        t: "stage:complete",
        ts: Date.now(),
        runId,
        stage,
        artifactCount: evidence.length,
        cards: stageCardIds,
      });
      saveCheckpoint(stage);
      emit({ t: "checkpoint:saved", ts: Date.now(), runId, stage });
    } catch (err) {
      // 降级原则：单阶段失败不中断体检，记录进 degraded 继续下一阶段
      const { code, retryable } = classifyError(err);
      const message = err instanceof Error ? err.message : String(err);
      emit({ t: "error", ts: Date.now(), runId, code, message, stage, retryable });
      degraded.push(stage);
    }
  }

  // reflect 闸门：全部阶段跑完后逐卡自检（07 §20 宁缺毋滥）
  for (const card of cards) {
    const stage = cardStage.get(card.cardId) ?? "annual";
    const evidenceRowCount =
      evidenceByStage.get(stage)?.reduce((sum, e) => sum + e.rowCount, 0) ?? 0;
    const verdict = reflectCard(card, evidenceRowCount);
    card.selfCheck = { pass: verdict.pass, issues: verdict.issues };
    emit({
      t: "reflect:result",
      ts: Date.now(),
      runId,
      cardId: card.cardId,
      pass: verdict.pass,
    });
    if (verdict.pass) {
      card.status = "published";
    } else {
      card.status = "withheld";
      emit({
        t: "card:withheld",
        ts: Date.now(),
        runId,
        stage,
        cardId: card.cardId,
        reason: verdict.issues.join("；"),
      });
    }
  }

  const elapsedMs = Date.now() - startedAt;
  emit({
    t: "run:complete",
    ts: Date.now(),
    runId,
    cards: cards.filter((card) => card.status === "published").map((card) => card.cardId),
    elapsedMs,
    ...(degraded.length > 0 ? { degraded } : {}),
  });
  return { cards, elapsedMs, ...(degraded.length > 0 ? { degraded } : {}) };
}
