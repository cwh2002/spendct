"use client";

/**
 * OCR 确认与导入面板（上传页右侧，识别成功后接管预览区）。
 *
 * 动线（02 §12.1 / 07 §11 多模态二次确认）：
 * 1. 确认表（OcrReviewTable）：低置信行标黄，时间/商户/金额可直接编辑
 *    （人工确认兜底，07 §11「仍低置信 → 人工确认」）；
 * 2.〔重新核对低置信行〕：对低置信行按行序截取原图局部条带
 *    （cropImageBand）→ POST /api/ocr（mode=review）→ 复核结果整体替换；
 * 3.〔确认导入〕：时间格式校验 → ocrToCleanTransactions → 与最近一次导入行
 *    mergeCleanBatches 追加合并去重 → initDataset 装配（与 CSV 同一条落库路径，
 *    02 §12.1）→ setDataset('upload') → 账本登记 → 成功视图，工作台随后跳转体检。
 *
 * 全部状态为本地 useState：截图 Blob、识别行都不落任何持久化存储
 * （02 §12.1 / 07 §17 红线）；确认导入后的清洗行按 08 修订案 A18
 * 与 CSV 同路径落 IndexedDB datasets store（刷新恢复用）。
 */
import { useCallback, useState } from "react";
import { CheckCircle2, CircleAlert, Loader2 } from "lucide-react";

import { OcrReviewTable, type EditableOcrField } from "@/components/ocr/ocr-review-table";
import { recordProgressEvent, recheckAll, resetRecheckOverrides } from "@/lib/achievements";
import { getLatestDataset } from "@/lib/account/db";
import { useAuth } from "@/lib/account/store";
import { initDataset } from "@/lib/duckdb/dataset";
import { getDuckDB } from "@/lib/duckdb/service";
import { registerImportedBook } from "@/lib/import/active-book";
import { hashCleanRows } from "@/lib/import/clean-input";
import { mergeCleanBatches } from "@/lib/import/merge-batches";
import type { CleanTransaction } from "@/lib/schema/bill";
import { cropImageBand } from "@/lib/ocr/compress-image";
import { OCR_TIME_PATTERN, ocrToCleanTransactions } from "@/lib/ocr/ocr-to-clean";
import {
  restorePipelineSnapshot,
  saveImportedDataset,
} from "@/lib/persistence/pipeline-persistence";
import { usePipeline } from "@/lib/pipeline/store";
import type { OcrReviewCell, OcrTransactionRow } from "@/lib/schema/ocr";

import type { OcrRecognizedResult } from "./ocr-dropzone";

export interface OcrImportPanelProps {
  /** 识别结果（含压缩截图，二次复核裁剪的源图） */
  initial: OcrRecognizedResult;
  onCancel: () => void;
  /** 导入成功（行数）：工作台延时后跳转体检 */
  onImported: (count: number) => void;
}

/** /api/ocr 错误信封（07 §13 信封形状） */
interface OcrErrorEnvelope {
  ok: boolean;
  data?: unknown;
  error?: { code?: string; message?: string };
}

function isEnvelope(payload: unknown): payload is OcrErrorEnvelope {
  return typeof payload === "object" && payload !== null && "ok" in payload;
}

function describeReviewError(payload: unknown): string {
  const envelope = isEnvelope(payload) ? payload : null;
  const message = envelope?.error?.message;
  if (message) return `${message}。可以直接在表里改对黄底行后导入。`;
  return "二次复核未完成，可以直接在表里改对黄底行后导入。";
}

export function OcrImportPanel({ initial, onCancel, onImported }: OcrImportPanelProps) {
  const { fileName, image, channel } = initial;
  const [rows, setRows] = useState<OcrTransactionRow[]>(initial.rows);
  const [rawText, setRawText] = useState<string | undefined>(initial.rawText);
  /** 人工确认过的行：编辑即确认，退出标黄与复核清单 */
  const [manuallyConfirmed, setManuallyConfirmed] = useState<ReadonlySet<number>>(new Set());
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [importedCount, setImportedCount] = useState(0);
  /** 跳过疑似重复行数（与已有数据集同键，WP4 追加合并去重） */
  const [skippedCount, setSkippedCount] = useState(0);

  /** 单元格编辑（人工确认）：值合法才落行，行无论如何都标记已确认 */
  const handleEdit = useCallback((rowIndex: number, field: EditableOcrField, value: string) => {
    setRows((prev) =>
      prev.map((row, index) => {
        if (index !== rowIndex) return row;
        if (field === "amountYuan") {
          const amount = Number(value);
          if (!Number.isFinite(amount) || amount <= 0) return row;
          return { ...row, amountYuan: amount };
        }
        if (field === "merchant") {
          const merchant = value.trim();
          if (merchant.length === 0) return row;
          return { ...row, merchant };
        }
        const time = value.trim();
        if (time.length === 0) return row;
        return { ...row, time };
      }),
    );
    setManuallyConfirmed((prev) => {
      const next = new Set(prev);
      next.add(rowIndex);
      return next;
    });
  }, []);

  /** 二次复核：低置信行截取原图局部条带重发视觉模型，结果整体替换 */
  const handleReview = useCallback(async () => {
    const flagged: OcrReviewCell[] = [];
    let firstIndex = rows.length;
    let lastIndex = -1;
    rows.forEach((row, index) => {
      if (row.confidence >= 0.8 || manuallyConfirmed.has(index)) return;
      firstIndex = Math.min(firstIndex, index);
      lastIndex = Math.max(lastIndex, index);
      // 金额与商户是截图识别最常见的两类错位，复核聚焦这两列
      flagged.push({ rowIndex: index, field: "amountYuan" });
      flagged.push({ rowIndex: index, field: "merchant" });
    });
    if (lastIndex < 0) return;

    setReviewing(true);
    setReviewError(null);
    try {
      // 行序即图上从上到下的顺序：条带前后各扩一行，避免边界裁掉字迹
      const top = Math.max(0, (firstIndex - 1) / rows.length);
      const bottom = Math.min(1, (lastIndex + 2) / rows.length);
      const crop = await cropImageBand(image, top, bottom);
      const form = new FormData();
      form.append("mode", "review");
      form.append("file", crop, fileName);
      form.append("cells", JSON.stringify(flagged));
      form.append("transactions", JSON.stringify(rows));
      const response = await fetch("/api/ocr", { method: "POST", body: form });
      const payload: unknown = await response.json().catch(() => null);
      if (!isEnvelope(payload) || !payload.ok) {
        setReviewError(describeReviewError(payload));
        return;
      }
      const data = payload.data as { transactions?: OcrTransactionRow[]; rawText?: string } | null;
      const next = data?.transactions;
      if (!next || next.length === 0) {
        setReviewError("复核没有返回有效结果，可以直接在表里改对黄底行后导入。");
        return;
      }
      setRows(next);
      if (data?.rawText) setRawText(data.rawText);
    } catch {
      setReviewError("网络异常，二次复核未完成；可以直接在表里改对黄底行后导入。");
    } finally {
      setReviewing(false);
    }
  }, [rows, manuallyConfirmed, image, fileName]);

  /** 确认导入：格式校验 → 转换 → 与 CSV 同一落库路径 */
  const handleConfirm = useCallback(async () => {
    const badIndex = rows.findIndex((row) => !OCR_TIME_PATTERN.test(row.time));
    if (badIndex >= 0) {
      setImportError(`第 ${badIndex + 1} 行的时间格式不正确，请改成「YYYY-MM-DD HH:mm」后重试`);
      return;
    }
    setConfirming(true);
    setImportError(null);
    try {
      // 会话恢复闸门（08 修订案 A18）：与 CSV 导入同口径，避免并发装配互相覆盖
      await restorePipelineSnapshot();
      const cleaned = await ocrToCleanTransactions(rows, channel, fileName);
      if (cleaned.length === 0) {
        setImportError("没有可导入的识别结果，请重新选择截图或改用 CSV 导入");
        return;
      }
      // 追加合并去重（WP4）：与 CSV 路径同款——已有行取「最近一次导入的完整行」
      // （getLatestDataset 全局最新，不过滤 userId），incoming 逐行比对
      // (日期|金额|商户) 键，重复跳过、新行追加，装配 = 替换整表重建为
      // 合并后完整行（旧记录不删，只增不减）。
      let existingRows: CleanTransaction[] = [];
      try {
        existingRows = (await getLatestDataset())?.rows ?? [];
      } catch {
        // 边界：IndexedDB 不可用且内存态已有数据时 existing=[] 会覆盖装配，
        // 与「落库失败只降级」口径一致，接受该降级（首次导入路径无差异）。
      }
      const merged = mergeCleanBatches(existingRows, cleaned);
      // 成就联动（WP8 §8c）：与 CSV 路径同口径，跳过条数累计进进度并全量校正（cleaner）
      if (merged.skipped > 0) {
        recordProgressEvent({ type: "dedupe-skipped", count: merged.skipped });
        recheckAll();
      }
      // 指纹按合并后完整行重算：与 CSV 路径同口径
      const datasetTxHash = await hashCleanRows(merged.rows);
      const conn = await getDuckDB();
      await initDataset(conn, merged.rows);
      // 账本登记与 CSV 导入同路径（游客账本 userId 为空也照常登记）
      const auth = useAuth.getState();
      await auth.hydrate().catch(() => {});
      const userId = useAuth.getState().user?.id ?? null;
      const book = await registerImportedBook({
        name: fileName || "未命名账单",
        userId,
        rowCount: merged.rows.length,
      });
      usePipeline.getState().setDataset(datasetTxHash, "upload");
      // 会话持久化（08 修订案 A18）：合并后完整行与指纹落 IndexedDB，刷新后自动恢复
      if (book) await saveImportedDataset({ book, txHash: datasetTxHash, rows: merged.rows });
      // 换数据集后旧视图侧成就缓存作废：与 CSV 路径同口径（saver 等判定不吃旧月表）
      resetRecheckOverrides();
      setImportedCount(merged.added);
      setSkippedCount(merged.skipped);
      setDone(true);
      onImported(merged.added);
    } catch {
      setImportError("导入失败，请重试；仍失败可改用 CSV 文件导入");
    } finally {
      setConfirming(false);
    }
  }, [rows, channel, fileName, onImported]);

  // 成功视图：与 CSV 路径同款确认感（新增 + 跳过疑似重复），工作台负责延时跳转
  if (done) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 py-10 text-center">
        <CheckCircle2 className="size-14 text-(--color-good)" aria-hidden />
        <p className="text-lg font-semibold text-(--color-ink)">
          已导入 {importedCount.toLocaleString("zh-CN")} 笔，跳过疑似重复{" "}
          {skippedCount.toLocaleString("zh-CN")} 笔，开始体检
        </p>
        <p className="flex items-center gap-2 text-sm text-(--color-ink-muted)">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          正在前往体检流程…
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <OcrReviewTable
        rows={rows}
        fileName={fileName}
        rawText={rawText}
        manuallyConfirmed={manuallyConfirmed}
        reviewing={reviewing}
        confirming={confirming}
        reviewError={reviewError}
        onEdit={handleEdit}
        onReview={() => void handleReview()}
        onConfirm={() => void handleConfirm()}
        onReselect={onCancel}
      />

      {importError ? (
        <div className="mt-4 rounded-(--radius-md) border border-(--color-critical) bg-(--color-surface-2) p-4">
          <p className="flex items-center gap-1.5 font-medium text-(--color-critical-ink)">
            <CircleAlert className="size-4" aria-hidden />
            无法导入
          </p>
          <p className="mt-1 text-sm text-(--color-ink-secondary)">{importError}</p>
        </div>
      ) : null}
    </div>
  );
}
