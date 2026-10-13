"use client";

/**
 * 管线运行桥（07 §1 状态机 → 体检页 ThinkingEvent 展示协议的适配层）。
 *
 * 页面契约不变：/checkup 消费 DemoRun 同形的 start/pause/resume/stop + 回调，
 * 本模块把真实 runCheckup 的 SpendctEvent 流映射成页面 ThinkingEvent：
 *   stage:start      → onStageChange(running) + progress「开始阶段」
 *   stage:evidence   → evidence 事件（表名/命中行数/耗时，meta=sqlHash）
 *   stage:complete   → onStageChange(succeeded, cards 数) + progress
 *   card:delta       → progress「生成洞察卡 · headline」
 *   rag:retrieved    → rag 事件（案例库命中）
 *   llm:degraded     → degrade 事件（DegradeToast 触发源）
 *   card:withheld    → progress「未达发布线已拦截」（07 §20 宁缺毋滥）
 *   error            → tool 事件 + onStageChange(failed)（引擎降级继续）
 *   run:complete     → onDone + 写 pipeline store（/insights 等页消费）
 *
 * 暂停/恢复语义（与 demo 定时器驱动的差异）：pause 触发 AbortController，
 * 引擎中止并保留已产出卡（abort 事件）；resume 从断点阶段重跑（阶段级
 * 结果确定性，重跑产出一致）。行数据始终在 DuckDB-WASM 内存库里。
 */
import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";

import { getDuckDB } from "@/lib/duckdb/service";
import { initDataset, verifySchema } from "@/lib/duckdb/dataset";
import { runCheckup, type RunCheckupResult } from "@/lib/pipeline/engine";
import { demoTransactions } from "@/lib/pipeline/mock-run";
import { STAGE_DISPLAY_NAMES, type StageId } from "@/lib/pipeline/stage";
import type { SpendctEvent } from "@/lib/protocol/events";
import type { InsightCard } from "@/lib/schema/insight-card";
import type { StageState, ThinkingEvent } from "@/components/checkup/types";

import { usePipeline } from "./store";
import { ANNUAL_EXECUTOR } from "./stages/annual";
import { ANOMALY_EXECUTOR } from "./stages/anomaly";
import { ATTRIBUTION_EXECUTOR } from "./stages/attribution";
import { CLEAN_EXECUTOR } from "./stages/clean";
import { PROFILE_EXECUTOR } from "./stages/profile";
import { SUBSCRIPTION_EXECUTOR } from "./stages/subscription";

/** 页面回调协议：与 components/checkup/demo-run.ts 的 DemoRunCallbacks 同形 */
export interface PipelineRunCallbacks {
  onStageChange: (stage: StageState) => void;
  onEvent: (event: ThinkingEvent) => void;
  onDone: () => void;
}

export interface PipelineRun {
  start(): void;
  pause(): void;
  resume(): void;
  stop(): void;
}

export interface CreatePipelineRunOptions {
  source: "upload" | "sample";
  datasetTxHash: string;
}

/** 阶段执行器注册表 → tableId 到 SQL 全文字典（证据抽屉的只读展示源，07 §6） */
const STAGE_EXECUTORS = {
  clean: CLEAN_EXECUTOR,
  profile: PROFILE_EXECUTOR,
  anomaly: ANOMALY_EXECUTOR,
  subscription: SUBSCRIPTION_EXECUTOR,
  attribution: ATTRIBUTION_EXECUTOR,
  annual: ANNUAL_EXECUTOR,
} as const;

const TABLE_SQL: Record<string, string> = Object.fromEntries(
  Object.values(STAGE_EXECUTORS).flatMap((executor) =>
    executor.queries.map((query) => [query.tableId, query.sql]),
  ),
);

/** 最近一次运行的状态快照（证据抽屉数据源；demo 与真实两条动线各自的读取函数） */
interface RunSnapshot {
  stages: Map<StageId, StageState>;
  evidence: Map<StageId, { sql: string; hits: number; elapsedMs: number; cards: { title: string; ok: boolean }[] }>;
  cards: InsightCard[];
  degraded: string[];
}

let lastSnapshot: RunSnapshot | null = null;

/** 证据抽屉数据源（真实管线）：stage:evidence 事件聚合 + 执行器 SQL 全文 */
export function getRunEvidence(stageId: string): {
  stageId: string;
  sql: string;
  hits: number;
  elapsedMs: number;
  cards: { title: string; ok: boolean }[];
} | null {
  const snap = lastSnapshot;
  if (!snap) return null;
  const stage = stageId as StageId;
  const evidence = snap.evidence.get(stage);
  if (!evidence) return null;
  return { stageId, ...evidence };
}

/** 事件序列号：与 demo 的 ev-N 同形，页面排序/去重逻辑无感知 */
function makeEventSeq(): () => number {
  let seq = 0;
  return () => ++seq;
}

/**
 * 创建真实管线运行驱动。
 * sample 模式先加载演示数据集（demoTransactions → initDataset），
 * upload 模式假定上传页已完成 initDataset，只做 schema 完整性校验。
 */
export function createPipelineRun(cb: PipelineRunCallbacks, opts: CreatePipelineRunOptions): PipelineRun {
  let controller: AbortController | null = null;
  let conn: AsyncDuckDBConnection | null = null;
  let running = false;
  // 排水期间的恢复请求登记位：pause 后引擎返回前用户点了 resume（running 尚未复位）
  let resumeRequested = false;

  const nextSeq = makeEventSeq();
  const push = (kind: ThinkingEvent["kind"], text: string, meta?: string) => {
    cb.onEvent({ id: `run-ev-${nextSeq()}`, kind, text, meta, ts: Date.now() });
  };

  /** SpendctEvent → 页面回调 + 快照更新。事件文本全部确定性，不伪造百分比（05 §5.1） */
  const handleEvent = (snapshot: RunSnapshot, event: SpendctEvent) => {
    switch (event.t) {
      case "stage:start": {
        const display = STAGE_DISPLAY_NAMES[event.stage];
        snapshot.stages.set(event.stage, {
          id: event.stage,
          name: display.name,
          status: "running",
          cards: 0,
          elapsedMs: 0,
        });
        cb.onStageChange(snapshot.stages.get(event.stage)!);
        push("progress", `开始「${display.name}」阶段 · ${display.subtitle}`);
        break;
      }
      case "stage:evidence": {
        const elapsedSec = (event.elapsedMs / 1000).toFixed(2);
        push("evidence", `${event.tableId} · 命中 ${event.rowCount} 行 · ${elapsedSec}s`, event.sqlHash);
        const stage = snapshot.evidence.get(event.stage);
        if (stage) {
          stage.hits += event.rowCount;
          stage.elapsedMs += event.elapsedMs;
        } else {
          snapshot.evidence.set(event.stage, {
            sql: TABLE_SQL[event.tableId] ?? "",
            hits: event.rowCount,
            elapsedMs: event.elapsedMs,
            cards: [],
          });
        }
        break;
      }
      case "card:delta": {
        const headline = String((event.delta as { headline?: unknown }).headline ?? "");
        push("progress", `生成洞察卡 · ${headline}`);
        break;
      }
      case "card:complete": {
        const card = event.card as unknown as InsightCard;
        snapshot.cards.push(card);
        const stageEvidence = snapshot.evidence.get(event.stage);
        if (stageEvidence) {
          stageEvidence.cards.push({ title: card.headline, ok: card.confidence >= 0.6 });
        }
        push("progress", `洞察卡完成 · ${card.headline}`);
        break;
      }
      case "stage:complete": {
        const stage = snapshot.stages.get(event.stage);
        if (stage) {
          stage.status = "succeeded";
          stage.cards = event.cards.length;
          cb.onStageChange(stage);
        }
        push("progress", `「${STAGE_DISPLAY_NAMES[event.stage].name}」完成 · 产出 ${event.cards.length} 张洞察卡`);
        break;
      }
      case "stage:skipped": {
        const stage = snapshot.stages.get(event.stage);
        if (stage) {
          stage.status = "skipped";
          cb.onStageChange(stage);
        }
        push("progress", `阶段跳过 · ${event.reason}`);
        break;
      }
      case "rag:retrieved": {
        push("rag", `案例库命中 ${event.k} 条（${event.mode}）`, event.caseIds.join("、"));
        break;
      }
      case "llm:degraded": {
        push("degrade", `模型降级 · ${event.from} → ${event.to} · ${event.reason}`);
        break;
      }
      case "tool:start": {
        push("tool", `调用工具 · ${event.tool}`);
        break;
      }
      case "cache:hit": {
        push("progress", `阶段缓存命中 · ${event.cacheKey}`, "cache");
        break;
      }
      case "checkpoint:saved": {
        push("tool", `断点已保存 · ${event.stage}`);
        break;
      }
      case "card:withheld": {
        push("progress", `洞察卡未达发布线已拦截 · 证据不足（07 §20 宁缺毋滥）`);
        break;
      }
      case "error": {
        const stage = event.stage ? snapshot.stages.get(event.stage) : undefined;
        if (stage && stage.status === "running") {
          stage.status = "failed";
          cb.onStageChange(stage);
        }
        snapshot.degraded.push(event.stage ?? "pipeline");
        push("tool", `阶段 ${event.stage ?? "?"} 失败 · ${event.code} · ${event.message}`);
        break;
      }
      case "abort": {
        push("progress", "体检已中止 · 已产出的洞察卡保留");
        break;
      }
      case "run:start":
      case "run:complete":
      case "stage:thinking":
      case "llm:repair":
      case "tool:end":
      case "reflect:result":
        // 运行边界事件由 start/onDone 路径处理，其余为冗余进度事件不重复展示
        break;
    }
  };

  /** 收口：复位 running。中止排水期间若收到过 resume 请求，立即自动重跑一轮（不触发 onDone） */
  const finish = () => {
    running = false;
    if (resumeRequested) {
      resumeRequested = false;
      void execute();
      return;
    }
    cb.onDone();
  };

  /** 主流程：装载数据 → 跑引擎 → 收口。任何装载失败都发失败态并终止（无卡可产出） */
  const execute = async () => {
    if (running) return;
    running = true;
    controller = new AbortController();

    const snapshot: RunSnapshot = {
      stages: new Map(),
      evidence: new Map(),
      cards: [],
      degraded: [],
    };
    lastSnapshot = snapshot;

    try {
      conn = await getDuckDB();
      if (opts.source === "sample") {
        const rows = demoTransactions();
        await initDataset(conn, rows);
        push("progress", `演示数据集就绪 · ${rows.length} 行已载入本地 DuckDB`);
      } else {
        const missing = await verifySchema(conn);
        if (missing.length > 0) {
          throw new Error(`数据集 schema 不完整（缺失 ${missing.join("、")}），请重新导入账单`);
        }
        push("progress", "数据集校验通过 · 本地 DuckDB schema 完整");
      }

      const result: RunCheckupResult = await runCheckup({
        conn,
        datasetHash: opts.datasetTxHash,
        source: opts.source,
        emit: (event) => handleEvent(snapshot, event),
        signal: controller.signal,
      });

      usePipeline.getState().setRun({
        runId: `run-${opts.source}`,
        source: opts.source,
        finishedAt: Date.now(),
        elapsedMs: result.elapsedMs,
        cards: result.cards.filter((card) => card.status === "published"),
        degraded: result.degraded ?? [],
      });
      finish();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      push("tool", `体检引擎装载失败 · ${message}`);
      finish();
    }
  };

  return {
    start() {
      void execute();
    },
    pause() {
      // 真实管线无法暂停 SQL 执行：中止当前运行（abort 事件收口），已产出卡保留
      controller?.abort();
    },
    resume() {
      // 断点续跑：数据仍在内存库，从最近断点阶段重跑（阶段结果确定性，产出一致）。
      // 引擎仍在排水（running 未复位）时先登记请求，收口后自动重跑，恢复请求不被吞
      if (running) resumeRequested = true;
      else void execute();
    },
    stop() {
      resumeRequested = false;
      controller?.abort();
      running = false;
      controller = null;
    },
  };
}
