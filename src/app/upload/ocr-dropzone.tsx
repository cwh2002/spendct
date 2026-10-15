"use client";

/**
 * 截图识别入口卡（05 §2.2 页面组件；02 §12.4 合规弹窗落点）。
 *
 * 动线：点卡 → 合规弹窗（02 §12.4 文案逐字 + 截图来源选择）→ 确认后
 * 打开文件选择 → compressBillImage 客户端压缩（≤1600px / JPEG q0.85）
 * → POST /api/ocr（mode=recognize）→ 结果交给右侧确认面板。
 *
 * 识别失败在本卡下方闭环提示，并按契约引导改用 CSV / 示例账单——
 * OCR 是第一入口但绝不阻塞主流程（07 §11）。
 * 识别中与失败均不保留任何图片引用：ObjectURL 全程不创建，
 * Blob 仅在成功时移交面板（内存态，02 §12.1）。
 */
import { createPortal } from "react-dom";
import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ChevronRight, CircleAlert, Loader2, ScanLine, ShieldCheck, X } from "lucide-react";

import { compressBillImage } from "@/lib/ocr/compress-image";
import type { OcrTransactionRow } from "@/lib/schema/ocr";
import { useMounted } from "@/lib/use-mounted";

/** 02 §12.4 合规声明定稿文案（逐字使用；07 §11 A11 起主模型为 DeepSeek V4.1 Flash） */
export const OCR_COMPLIANCE_TEXT =
  "账单截图将仅发送至视觉大模型 DeepSeek V4.1 Flash 用于本次文字识别（识别效果不佳时自动降级至 GLM-4V-Flash；低置信度字段会截取局部二次复核），服务端不保存图片、不用于任何训练，识别完成后立即丢弃。";

export interface OcrRecognizedResult {
  rows: OcrTransactionRow[];
  rawText?: string;
  fileName: string;
  /** 压缩后的截图（二次复核局部裁剪的源图；仅内存持有） */
  image: Blob;
  /** 截图来源（用户在合规弹窗中选择；入库 channel 的唯一依据） */
  channel: "wechat" | "alipay";
}

export interface OcrDropzoneProps {
  /** 识别动线已激活（右侧面板接管预览区） */
  active: boolean;
  /** 点卡开始（弹窗打开前）：工作台清空 CSV 预览态、右栏进入识别中视图 */
  onBegin: () => void;
  /** 弹窗取消 / 识别失败：工作台回到空态 */
  onCancel: () => void;
  /** 识别成功：工作台把结果交给右侧确认面板 */
  onRecognized: (result: OcrRecognizedResult) => void;
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

/** 错误码 → 面向用户的提示（失败一律给 CSV 兜底引导，07 §11 降级链终档） */
function describeOcrError(payload: unknown): string {
  const envelope = isEnvelope(payload) ? payload : null;
  const code = envelope?.error?.code;
  if (code === "OCR_TIMEOUT") return "识别超过 15 秒已中断，请改用 CSV 文件导入，或稍后重试";
  if (code === "OCR_RATE_LIMITED") return "识别次数太频繁（每小时 20 次），请稍后再试或改用 CSV 导入";
  if (code === "FILE_TOO_LARGE") return "截图超过 5MB，请换一张更小的截图或改用 CSV 导入";
  if (code === "OCR_PARSE_FAILED") return "这张截图没能识别出可用账单，请换一张更清晰的截图或改用 CSV 导入";
  if (code === "OCR_UNAVAILABLE") return "识别服务暂时不可用，请稍后重试或改用 CSV 文件导入";
  if (envelope?.error?.message) return envelope.error.message;
  return "识别失败，请改用 CSV 文件导入，或稍后重试";
}

export function OcrDropzone({ active, onBegin, onCancel, onRecognized }: OcrDropzoneProps) {
  const titleId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [channel, setChannel] = useState<"wechat" | "alipay">("wechat");
  const [recognizing, setRecognizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useMounted();
  const cancelEvent = useEffectEvent(onCancel);

  // 弹窗打开时：Esc 关闭 + 锁定页面滚动，关闭后焦点还给触发按钮
  useEffect(() => {
    if (!modalOpen) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        setModalOpen(false);
        cancelEvent();
      }
    }
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
      previouslyFocused?.focus();
    };
  }, [modalOpen]);

  function handleCardClick() {
    setError(null);
    onBegin();
    setModalOpen(true);
  }

  function handleConfirm() {
    setModalOpen(false);
    fileInputRef.current?.click();
  }

  function handleCancel() {
    setModalOpen(false);
    onCancel();
  }

  /** 选图 → 客户端压缩 → POST /api/ocr。图片只进请求体，本地不落任何持久化 */
  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    setRecognizing(true);
    try {
      const image = await compressBillImage(file);
      const form = new FormData();
      form.append("mode", "recognize");
      form.append("file", image, file.name);
      const response = await fetch("/api/ocr", { method: "POST", body: form });
      const payload: unknown = await response.json().catch(() => null);
      if (!isEnvelope(payload) || !payload.ok) {
        setError(describeOcrError(payload));
        onCancel();
        return;
      }
      const data = payload.data as {
        transactions?: OcrTransactionRow[];
        rawText?: string;
      } | null;
      const rows = data?.transactions ?? [];
      if (rows.length === 0) {
        setError("这张截图里没有识别出账单明细，请换一张或改用 CSV 导入");
        onCancel();
        return;
      }
      onRecognized({
        rows,
        rawText: data?.rawText,
        fileName: file.name,
        image,
        channel,
      });
    } catch {
      setError("识别失败，请检查网络后重试，或改用 CSV 文件导入");
      onCancel();
    } finally {
      setRecognizing(false);
    }
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={handleFileChange}
        aria-label="选择账单截图"
      />
      <button
        type="button"
        onClick={handleCardClick}
        disabled={recognizing}
        className={`flex w-full items-center gap-4 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-4 text-left shadow-(--shadow-sm) transition-colors disabled:cursor-not-allowed disabled:opacity-70 ${
          active ? "border-(--color-primary)" : "hover:border-(--color-primary)"
        }`}
      >
        <span className="grid size-11 shrink-0 place-items-center rounded-(--radius-md) bg-(--color-primary-soft)">
          {recognizing ? (
            <Loader2 className="size-5 animate-spin text-(--color-primary)" aria-hidden />
          ) : (
            <ScanLine className="size-5 text-(--color-primary)" aria-hidden />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-(--color-ink)">账单截图识别</span>
          <span className="mt-0.5 block text-sm text-(--color-ink-muted)">
            {recognizing
              ? "正在识别截图里的每一笔…"
              : "拍一张微信/支付宝账单截图，AI 直接读出每一笔，标黄可疑处二次核对"}
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-(--color-ink-muted)" aria-hidden />
      </button>

      {error ? (
        <p role="alert" className="mt-2 flex items-start gap-1.5 text-sm text-(--color-critical-ink)">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      {modalOpen && mounted
        ? createPortal(
            <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
              <motion.div
                aria-hidden
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2 }}
                onClick={handleCancel}
                className="absolute inset-0 bg-black/45"
              />
              <motion.div
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                initial={{ opacity: 0, y: 24, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
                className="relative w-full max-w-md rounded-(--radius-xl) border border-(--color-border) bg-(--color-surface) p-6 shadow-(--shadow-lg)"
              >
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden
                    className="grid size-11 shrink-0 place-items-center rounded-(--radius-md) bg-(--color-primary-soft) text-(--color-primary)"
                  >
                    <ShieldCheck className="size-5" />
                  </span>
                  <h3 id={titleId} className="min-w-0 flex-1 pt-1.5 text-lg font-semibold text-(--color-ink)">
                    截图上传说明
                  </h3>
                  <button
                    type="button"
                    onClick={handleCancel}
                    aria-label="关闭"
                    className="grid size-10 shrink-0 place-items-center rounded-full text-(--color-ink-muted) transition hover:bg-(--color-surface-2) hover:text-(--color-ink)"
                  >
                    <X className="size-5" aria-hidden />
                  </button>
                </div>

                <p className="mt-4 text-sm leading-relaxed text-(--color-ink-secondary)">
                  {OCR_COMPLIANCE_TEXT}
                </p>

                {/* 截图来源：channel 是入库渠道字段的唯一依据（OCR 行不做渠道猜测） */}
                <fieldset className="mt-5">
                  <legend className="text-xs font-semibold text-(--color-ink-secondary)">截图来源</legend>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {(
                      [
                        { value: "wechat", label: "微信账单" },
                        { value: "alipay", label: "支付宝账单" },
                      ] as const
                    ).map((option) => (
                      <label
                        key={option.value}
                        className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-(--radius-md) border px-3 py-2.5 text-sm transition-colors ${
                          channel === option.value
                            ? "border-(--color-primary) bg-(--color-primary-soft) font-medium text-(--color-primary)"
                            : "border-(--color-border) text-(--color-ink-secondary) hover:border-(--color-border-strong)"
                        }`}
                      >
                        <input
                          type="radio"
                          name="ocr-channel"
                          value={option.value}
                          checked={channel === option.value}
                          onChange={() => setChannel(option.value)}
                          className="sr-only"
                        />
                        {option.label}
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div className="mt-6 flex gap-2">
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="inline-flex h-11 flex-1 items-center justify-center rounded-full border border-(--color-border-strong) text-sm font-medium text-(--color-ink-secondary) transition-colors hover:bg-(--color-surface-2)"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirm}
                    className="inline-flex h-11 flex-1 items-center justify-center rounded-full bg-(--color-btn-primary) text-sm font-medium text-white transition-colors hover:bg-(--color-btn-primary-hover)"
                  >
                    确认并选择截图
                  </button>
                </div>
              </motion.div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
