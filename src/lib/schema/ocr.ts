/**
 * OCR 截图识别 schema 单一来源（02 §12 逐字实现，07 §11 供应商口径）。
 *
 * OcrTransactionRow 是视觉模型输出的结构化行：金额单位为元（模型侧口径），
 * 进入管线前由 src/lib/ocr/ocr-to-clean.ts 换算为分并装配 CleanTransaction，
 * 与 CSV 行同一条落库路径（02 §12.1）。
 * confidence 为行级置信度（GLM 返回，缺失按 0.5——02 §12 注释口径，用
 * zod default 落实），低于 0.8 的行在确认表标黄并触发二次复核。
 */
import { z } from "zod";

/** 单行识别结果（02 §12 OcrTransactionRowSchema 逐字） */
export const OcrTransactionRowSchema = z.object({
  /** 'YYYY-MM-DD HH:mm'（本地时间，无时区后缀；格式由确认表导入前兜底校验） */
  time: z.string(),
  /** 金额（元，正数，≤100 万）；入库前由转换层换算为整数分 */
  amountYuan: z.number().positive().max(1_000_000),
  /** 商户名原文，最长 60 字 */
  merchant: z.string().max(60),
  /** 收付方向；账单截图绝大多数为支出，缺省 expense */
  direction: z.enum(["expense", "income"]).default("expense"),
  /** 行级置信度 0-1；模型未返回时按 0.5（02 §12 注释口径） */
  confidence: z.number().min(0).max(1).default(0.5),
});

/** 识别结果信封（02 §12 OcrResultSchema 逐字） */
export const OcrResultSchema = z.object({
  transactions: z.array(OcrTransactionRowSchema).max(200),
  rawText: z.string().max(5000).optional(),
});

/** 二次复核可聚焦的字段（02 §12.1 低置信字段复核动线） */
export const OCR_REVIEW_FIELDS = ["time", "amountYuan", "merchant", "direction"] as const;

/** 待复核单元格：行下标 + 字段名 */
export const OcrReviewCellSchema = z.object({
  rowIndex: z.number().int().min(0).max(199),
  field: z.enum(OCR_REVIEW_FIELDS),
});

/** 二次复核请求体（mode=review 的表单 JSON 字段合并后校验）：当前行 + 待复核单元格清单 */
export const OcrReviewRequestSchema = z.object({
  cells: z.array(OcrReviewCellSchema).min(1).max(50),
  transactions: z.array(OcrTransactionRowSchema).min(1).max(200),
});

export type OcrTransactionRow = z.infer<typeof OcrTransactionRowSchema>;
export type OcrResult = z.infer<typeof OcrResultSchema>;
export type OcrReviewCell = z.infer<typeof OcrReviewCellSchema>;
export type OcrReviewRequest = z.infer<typeof OcrReviewRequestSchema>;
