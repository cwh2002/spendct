/**
 * OCR schema 单测（src/lib/schema/ocr.ts，02 §12 逐字实现）。
 *
 * 覆盖：字段边界（金额/置信度/商户长度/行数上限）、缺省语义
 * （direction 缺省 expense、confidence 缺失按 0.5）、复核请求结构
 * （单元格下标与字段枚举、cells 数量边界）。
 */
import { describe, expect, it } from "vitest";

import {
  OcrResultSchema,
  OcrReviewRequestSchema,
  OcrTransactionRowSchema,
} from "@/lib/schema/ocr";

function row(overrides: Record<string, unknown> = {}) {
  return {
    time: "2026-10-14 08:12",
    amountYuan: 12.5,
    merchant: "瑞幸咖啡",
    direction: "expense",
    confidence: 0.9,
    ...overrides,
  };
}

describe("OcrTransactionRowSchema 字段边界（02 §12）", () => {
  it("完整行解析通过", () => {
    const parsed = OcrTransactionRowSchema.safeParse(row());
    expect(parsed.success).toBe(true);
  });

  it("direction 缺省 expense；confidence 缺失按 0.5（02 §12 注释口径）", () => {
    const parsed = OcrTransactionRowSchema.safeParse({
      time: "2026-10-14 08:12",
      amountYuan: 12.5,
      merchant: "瑞幸咖啡",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.direction).toBe("expense");
      expect(parsed.data.confidence).toBe(0.5);
    }
  });

  it("金额必须是正数且不超过 100 万", () => {
    expect(OcrTransactionRowSchema.safeParse(row({ amountYuan: 0 })).success).toBe(false);
    expect(OcrTransactionRowSchema.safeParse(row({ amountYuan: -3 })).success).toBe(false);
    expect(OcrTransactionRowSchema.safeParse(row({ amountYuan: 1_000_001 })).success).toBe(false);
    expect(OcrTransactionRowSchema.safeParse(row({ amountYuan: 1_000_000 })).success).toBe(true);
  });

  it("置信度必须在 0-1 区间", () => {
    expect(OcrTransactionRowSchema.safeParse(row({ confidence: -0.1 })).success).toBe(false);
    expect(OcrTransactionRowSchema.safeParse(row({ confidence: 1.1 })).success).toBe(false);
    expect(OcrTransactionRowSchema.safeParse(row({ confidence: 1 })).success).toBe(true);
    expect(OcrTransactionRowSchema.safeParse(row({ confidence: 0 })).success).toBe(true);
  });

  it("商户名最长 60 字", () => {
    expect(OcrTransactionRowSchema.safeParse(row({ merchant: "店".repeat(60) })).success).toBe(true);
    expect(OcrTransactionRowSchema.safeParse(row({ merchant: "店".repeat(61) })).success).toBe(false);
  });

  it("direction 只接受 expense / income", () => {
    expect(OcrTransactionRowSchema.safeParse(row({ direction: "income" })).success).toBe(true);
    expect(OcrTransactionRowSchema.safeParse(row({ direction: "refund" })).success).toBe(false);
  });
});

describe("OcrResultSchema 信封边界（02 §12）", () => {
  it("transactions 最多 200 行", () => {
    const rows = Array.from({ length: 200 }, () => row());
    expect(OcrResultSchema.safeParse({ transactions: rows }).success).toBe(true);
    expect(OcrResultSchema.safeParse({ transactions: [...rows, row()] }).success).toBe(false);
  });

  it("rawText 可选且最长 5000 字", () => {
    expect(OcrResultSchema.safeParse({ transactions: [row()] }).success).toBe(true);
    expect(
      OcrResultSchema.safeParse({ transactions: [row()], rawText: "文".repeat(5000) }).success,
    ).toBe(true);
    expect(
      OcrResultSchema.safeParse({ transactions: [row()], rawText: "文".repeat(5001) }).success,
    ).toBe(false);
  });
});

describe("OcrReviewRequestSchema 复核请求结构", () => {
  const transactions = [row(), row()];

  it("合法请求解析通过", () => {
    const parsed = OcrReviewRequestSchema.safeParse({
      cells: [
        { rowIndex: 0, field: "amountYuan" },
        { rowIndex: 1, field: "merchant" },
      ],
      transactions,
    });
    expect(parsed.success).toBe(true);
  });

  it("cells 至少 1 个、最多 50 个；下标限 0-199", () => {
    expect(
      OcrReviewRequestSchema.safeParse({ cells: [], transactions }).success,
    ).toBe(false);
    const tooMany = Array.from({ length: 51 }, () => ({ rowIndex: 0, field: "merchant" }));
    expect(
      OcrReviewRequestSchema.safeParse({ cells: tooMany, transactions }).success,
    ).toBe(false);
    expect(
      OcrReviewRequestSchema.safeParse({
        cells: [{ rowIndex: 200, field: "merchant" }],
        transactions,
      }).success,
    ).toBe(false);
    expect(
      OcrReviewRequestSchema.safeParse({
        cells: [{ rowIndex: -1, field: "merchant" }],
        transactions,
      }).success,
    ).toBe(false);
  });

  it("field 只接受复核字段枚举", () => {
    expect(
      OcrReviewRequestSchema.safeParse({
        cells: [{ rowIndex: 0, field: "confidence" }],
        transactions,
      }).success,
    ).toBe(false);
  });

  it("transactions 至少 1 行、最多 200 行", () => {
    expect(
      OcrReviewRequestSchema.safeParse({ cells: [{ rowIndex: 0, field: "time" }], transactions: [] })
        .success,
    ).toBe(false);
  });
});
