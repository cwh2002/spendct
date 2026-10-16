"use client";

/**
 * 管线会话持久化（08 修订案 A18）：让「刷新丢数据」成为过去。
 *
 * 修复前的问题：行数据只活在 DuckDB-WASM 内存库、体检结果只活在管线
 * 内存态（07 §17 红线：localStorage 不落行数据与聚合明细），刷新后
 * 账本列表只剩元数据，所有功能回到演示态。
 *
 * A18 口径：把「行数据 + 数据集指纹 + 体检结果」落进 IndexedDB 的
 * datasets store（与账户/账本元数据同库同源，只在浏览器本地），
 * 页面加载时由布局常驻组件调 restorePipelineSnapshot 重建 DuckDB
 * 数据集与管线内存态；体检结果经 zustand 订阅增量同步（startPipelineSnapshotSync）。
 *
 * 安全与降级口径：
 * - 只经浏览器 IndexedDB，任何网络通道接触不到行数据（02 §1.2 不变）；
 * - 所有写入/恢复失败都只降级（回到修复前的内存态行为），不阻断导入与体检；
 * - 恢复只在内存态无数据时发生，绝不覆盖本会话新导入的数据集；
 * - e2e / 空浏览器：无记录时恢复是零成本的 no-op，不启动 DuckDB。
 */

import {
  deleteDataset,
  getDatasetByTxHash,
  getLatestDataset,
  putDataset,
} from "@/lib/account/db";
import type { BookRecord, PersistedDatasetRecord } from "@/lib/account/types";
import { initDataset } from "@/lib/duckdb/dataset";
import { getDuckDB } from "@/lib/duckdb/service";
import { usePipeline, type LastRunSummary } from "@/lib/pipeline/store";
import type { CleanTransaction } from "@/lib/schema/bill";

/**
 * 保存一次成功导入：行数据 + 数据集指纹落 IndexedDB。
 * 任何失败只降级（刷新后恢复不可用），不阻断导入成功动线。
 */
export async function saveImportedDataset(input: {
  book: BookRecord;
  txHash: string;
  rows: CleanTransaction[];
}): Promise<void> {
  try {
    const record: PersistedDatasetRecord = {
      bookId: input.book.id,
      name: input.book.name,
      txHash: input.txHash,
      source: "upload",
      importedAt: Date.now(),
      rowCount: input.rows.length,
      rows: input.rows,
      lastRun: null,
    };
    await putDataset(record);
  } catch {
    // IndexedDB 不可用（隐私模式等）：刷新后恢复不可用，导入不受影响
  }
  // 新数据集落库后，允许后续按新记录恢复（旧恢复结果作废）
  restorePromise = null;
}

/** 恢复的并发闸门：页面加载与导入路径可能同时触发，只跑一次 */
let restorePromise: Promise<boolean> | null = null;

/**
 * 刷新后恢复：内存态已有数据集则 no-op；否则读最近一次导入记录，
 * 把行数据重放进 DuckDB 并重建管线内存态（含体检结果）。
 * 返回是否完成恢复（false = 没有可恢复的记录或恢复失败）。
 */
export function restorePipelineSnapshot(): Promise<boolean> {
  if (usePipeline.getState().datasetTxHash !== null) return Promise.resolve(true);
  restorePromise ??= (async () => {
    try {
      if (typeof indexedDB === "undefined") return false;
      const record = await getLatestDataset();
      if (!record || record.rows.length === 0) return false;
      // 等待期间用户可能已完成新导入：内存态优先，绝不覆盖
      if (usePipeline.getState().datasetTxHash !== null) return true;
      const conn = await getDuckDB();
      await initDataset(conn, record.rows);
      usePipeline.getState().setDataset(record.txHash, record.source);
      if (record.lastRun) usePipeline.getState().setRun(record.lastRun);
      return true;
    } catch {
      return false; // 恢复失败保持「未导入」内存态，动线与修复前一致
    }
  })();
  return restorePromise;
}

/**
 * 浏览器端订阅：数据集 / 体检结果变化时把 lastRun 同步进 IndexedDB。
 * 只同步落过库的 upload 源数据集（演示播放的 sample 源维持内存态口径）；
 * 任何同步失败静默忽略（只影响刷新后的体检结果恢复）。
 */
export function startPipelineSnapshotSync(): () => void {
  return usePipeline.subscribe((state, previous) => {
    const changed =
      state.datasetTxHash !== previous.datasetTxHash ||
      state.lastRun !== previous.lastRun ||
      state.source !== previous.source;
    if (changed) {
      void syncLastRun(state.datasetTxHash, state.source, state.lastRun);
    }
  });
}

async function syncLastRun(
  txHash: string | null,
  source: "upload" | "sample" | null,
  lastRun: LastRunSummary | null,
): Promise<void> {
  if (txHash === null || source !== "upload") return;
  try {
    const record = await getDatasetByTxHash(txHash);
    if (!record) return; // 该数据集没有落库（保存失败）：跳过同步
    await putDataset({ ...record, lastRun });
  } catch {
    // 同步失败只影响刷新后的体检结果恢复，不影响当前会话
  }
}

/**
 * 删除账本时联动：清除该账本的持久化数据集（行数据与体检结果一并清除，
 * 隐私口径：账本删除即数据删除）。账本删除本身失败时由调用方决定是否调用。
 */
export async function discardDatasetForBook(bookId: string): Promise<void> {
  try {
    await deleteDataset(bookId);
  } catch {
    // 删除失败只留一条无主记录，不影响账本删除动线
  }
}
