"use client";

/**
 * OCR 识别结果确认表（05 §2.1 组件注册表成员；02 §12.1 确认表落点）。
 *
 * 三条交互动线（07 §11 多模态二次确认）：
 * 1. 标黄：confidence < 0.8 且未经人工确认的行整行黄底 + 低置信角标；
 * 2. 二次复核：「重新核对低置信行」对低置信行截取原图局部重发视觉模型
 *    （由调用方组装请求），复核结果整体替换本表数据；
 * 3. 人工确认：时间/商户/金额单元格失焦即提交（仍低置信 → 人工确认），
 *    编辑过的行退出标黄与复核清单。
 *
 * 本组件是纯展示 + 受控回调：请求与数据状态全部由上传页 OCR 面板持有，
 * 编辑提交用非受控输入 + onBlur 落实（避免每个按键回写父状态造成光标跳动）。
 */
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";

import type { OcrTransactionRow } from "@/lib/schema/ocr";

/** 可人工编辑的字段（复核清单之外的兜底路径，02 §12.1） */
export type EditableOcrField = "time" | "amountYuan" | "merchant";

export interface OcrReviewTableProps {
  rows: OcrTransactionRow[];
  fileName: string;
  /** 识别原文摘要（模型 rawText，可省略）；折叠展示供对照 */
  rawText?: string;
  /** 人工确认过的行下标（编辑即确认）：不再标黄、不进复核清单 */
  manuallyConfirmed: ReadonlySet<number>;
  /** 二次复核请求进行中 */
  reviewing: boolean;
  /** 确认导入进行中 */
  confirming: boolean;
  reviewError: string | null;
  onEdit: (rowIndex: number, field: EditableOcrField, value: string) => void;
  onReview: () => void;
  onConfirm: () => void;
  onReselect: () => void;
}

/** 置信度展示：0-1 → 百分比 */
function formatConfidence(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function OcrReviewTable({
  rows,
  fileName,
  rawText,
  manuallyConfirmed,
  reviewing,
  confirming,
  reviewError,
  onEdit,
  onReview,
  onConfirm,
  onReselect,
}: OcrReviewTableProps) {
  const lowRows = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row, index }) => row.confidence < 0.8 && !manuallyConfirmed.has(index));
  const lowCount = lowRows.length;

  return (
    <div className="flex flex-1 flex-col">
      {/* 头部：文件名 + 记录数 + 低置信计数 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="max-w-40 truncate text-sm text-(--color-ink-muted)" title={fileName}>
          {fileName}
        </span>
        <span className="ml-auto text-sm text-(--color-ink-muted) tabular-nums">
          共 {rows.length.toLocaleString("zh-CN")} 笔
        </span>
        <span
          className={`inline-flex items-center gap-1 rounded-full border border-(--color-border) bg-(--color-surface-2) px-2.5 py-0.5 text-xs font-medium ${
            lowCount > 0 ? "text-(--color-warning-ink)" : "text-(--color-ink-secondary)"
          }`}
        >
          {lowCount > 0 ? <AlertTriangle className="size-3.5" aria-hidden /> : <CheckCircle2 className="size-3.5" aria-hidden />}
          低置信 {lowCount} 行
        </span>
      </div>

      <p className="mt-2 text-xs text-(--color-ink-muted)">
        黄底行为识别置信度较低的行：可直接在表内改对，或点「重新核对低置信行」截取原图局部二次复核
      </p>

      {/* 复核失败提示：可人工修改后直接导入 */}
      {reviewError ? (
        <div className="mt-3 rounded-(--radius-md) border-l-4 border-(--color-warn) bg-(--color-warn-soft) px-4 py-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-(--color-warning-ink)">
            <AlertTriangle className="size-4" aria-hidden />
            二次复核未完成
          </p>
          <p className="mt-1 text-sm text-(--color-ink-secondary)">{reviewError}</p>
        </div>
      ) : null}

      {/* 确认表 */}
      <div className="mt-4 overflow-x-auto rounded-(--radius-md) border border-(--color-border)">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-(--color-border) bg-(--color-surface-2)">
              <th scope="col" className="px-3 py-2 text-left font-medium text-(--color-ink-secondary)">时间</th>
              <th scope="col" className="px-3 py-2 text-left font-medium text-(--color-ink-secondary)">商户</th>
              <th scope="col" className="px-3 py-2 text-right font-medium text-(--color-ink-secondary)">金额（元）</th>
              <th scope="col" className="px-3 py-2 text-left font-medium text-(--color-ink-secondary)">方向</th>
              <th scope="col" className="px-3 py-2 text-right font-medium text-(--color-ink-secondary)">置信度</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const low = row.confidence < 0.8 && !manuallyConfirmed.has(index);
              const last = index === rows.length - 1;
              return (
                <tr
                  key={`${index}-${row.time}-${row.merchant}-${row.amountYuan}-${row.confidence}`}
                  className={`${low ? "bg-(--color-warn-soft)" : ""} ${last ? "" : "border-b border-(--color-border)"}`}
                >
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    {low ? (
                      <span className="mr-1 inline-flex items-center" title="识别置信度低，请核对">
                        <AlertTriangle className="size-3.5 text-(--color-warning-ink)" aria-hidden />
                      </span>
                    ) : null}
                    <input
                      type="text"
                      defaultValue={row.time}
                      onBlur={(event) => onEdit(index, "time", event.target.value)}
                      aria-label={`第 ${index + 1} 行时间`}
                      className="w-32 rounded border border-transparent bg-transparent px-1 py-0.5 font-(--font-mono) text-xs text-(--color-ink-secondary) tabular-nums outline-none hover:border-(--color-border) focus:border-(--color-primary)"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="text"
                      defaultValue={row.merchant}
                      maxLength={60}
                      onBlur={(event) => onEdit(index, "merchant", event.target.value)}
                      aria-label={`第 ${index + 1} 行商户`}
                      className="w-full min-w-28 rounded border border-transparent bg-transparent px-1 py-0.5 text-(--color-ink) outline-none hover:border-(--color-border) focus:border-(--color-primary)"
                    />
                  </td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap">
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      defaultValue={row.amountYuan}
                      onBlur={(event) => onEdit(index, "amountYuan", event.target.value)}
                      aria-label={`第 ${index + 1} 行金额`}
                      className={`w-24 rounded border border-transparent bg-transparent px-1 py-0.5 text-right font-(--font-mono) tabular-nums outline-none hover:border-(--color-border) focus:border-(--color-primary) ${
                        row.direction === "expense" ? "text-(--color-critical-ink)" : "text-(--color-good-ink)"
                      }`}
                    />
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    {row.direction === "expense" ? (
                      <span className="inline-flex items-center gap-1 text-(--color-critical-ink)">
                        <TrendingDown className="size-3.5" aria-hidden />
                        支出
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-(--color-good-ink)">
                        <TrendingUp className="size-3.5" aria-hidden />
                        收入
                      </span>
                    )}
                  </td>
                  <td
                    className={`px-3 py-1.5 text-right whitespace-nowrap font-(--font-mono) text-xs tabular-nums ${
                      low ? "font-medium text-(--color-warning-ink)" : "text-(--color-ink-secondary)"
                    }`}
                  >
                    {formatConfidence(row.confidence)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 识别原文折叠对照（模型 rawText，可选） */}
      {rawText ? (
        <details className="mt-3 rounded-(--radius-md) border border-(--color-border) bg-(--color-surface-2) px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-(--color-ink-secondary)">
            识别原文摘要（与表格对照）
          </summary>
          <pre className="mt-2 max-h-40 overflow-auto text-xs leading-relaxed whitespace-pre-wrap text-(--color-ink-muted)">{rawText}</pre>
        </details>
      ) : null}

      {/* 操作区 */}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-5">
        <button
          type="button"
          onClick={onReview}
          disabled={lowCount === 0 || reviewing || confirming}
          className="inline-flex h-11 items-center gap-1.5 rounded-full border border-(--color-border-strong) px-5 text-sm font-medium text-(--color-ink-secondary) transition-colors hover:bg-(--color-surface-2) disabled:cursor-not-allowed disabled:opacity-50"
        >
          {reviewing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
          {reviewing ? "正在二次复核…" : "重新核对低置信行"}
        </button>
        <button
          type="button"
          onClick={onReselect}
          disabled={confirming}
          className="inline-flex h-11 items-center rounded-full border border-transparent px-4 text-sm font-medium text-(--color-ink-muted) transition-colors hover:text-(--color-ink) disabled:cursor-not-allowed disabled:opacity-50"
        >
          重新选择截图
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={confirming}
          className="ml-auto inline-flex h-11 items-center gap-2 rounded-full bg-(--color-btn-primary) px-6 text-sm font-medium text-white transition-colors hover:bg-(--color-btn-primary-hover) disabled:cursor-not-allowed disabled:opacity-60"
        >
          {confirming ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              正在导入…
            </>
          ) : (
            <>
              确认导入
              <ArrowRight className="size-4" aria-hidden />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
