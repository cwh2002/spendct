"use client";

/**
 * 体检管线跨页面状态（07 §17 内存态切片）。
 *
 * 只存「数据集标识 + 最近一次运行结果」，不存任何行数据：
 * - 行数据本体在 DuckDB-WASM 内存库里（单例连接，同会话内跨页面存活）；
 * - 洞察卡是聚合产物，放内存态供 /insights /report /subscriptions /budget 消费，
 *   刷新后丢失（localStorage 红线：不落任何行数据与聚合明细），
 *   由 /checkup 的断点条提示用户重新体检；
 * - datasetTxHash 由上传页导入成功后写入，/checkup 据此选择真实管线还是演示播放。
 */
import { create } from "zustand";

import type { InsightCard } from "@/lib/schema/insight-card";

export interface LastRunSummary {
  runId: string;
  source: "upload" | "sample";
  finishedAt: number;
  elapsedMs: number;
  /** 已发布的洞察卡（reflect 闸门通过，07 §20） */
  cards: InsightCard[];
  /** 失败降级的阶段清单（引擎 degraded 字段） */
  degraded: string[];
}

export interface PipelineState {
  /** 已就绪数据集哈希（null = 尚未导入，走演示播放动线） */
  datasetTxHash: string | null;
  source: "upload" | "sample" | null;
  lastRun: LastRunSummary | null;
  /** 导入成功后由上传页写入（数据集已 initDataset 落库） */
  setDataset(datasetTxHash: string, source: "upload" | "sample"): void;
  /** 体检运行结束后由 runner 写入（run:complete 事件载荷） */
  setRun(summary: LastRunSummary): void;
  /** 数据集被清空/换掉时复位（重新导入走 setDataset，同样清掉旧运行结果） */
  clear(): void;
}

export const usePipeline = create<PipelineState>()((set) => ({
  datasetTxHash: null,
  source: null,
  lastRun: null,

  setDataset(datasetTxHash, source) {
    // 换数据集 = 旧数据集上的体检结果作废，避免 /insights 等页读到上一份账单的卡
    set({ datasetTxHash, source, lastRun: null });
  },

  setRun(summary) {
    set({ lastRun: summary });
  },

  clear() {
    set({ datasetTxHash: null, source: null, lastRun: null });
  },
}));
