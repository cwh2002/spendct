/**
 * OCR mock 剧本单测（src/server/ocr/mock.ts，07 §7 确定性口径）。
 *
 * 覆盖：recognize 剧本确定性（两次调用逐字节一致）、剧本通过
 * OcrResultSchema 校验、故意含两行低置信（演示动线依赖）、
 * review 只提升被标记单元格所在行的置信度、不虚构文本修正。
 */
import { describe, expect, it } from "vitest";

import { OcrResultSchema } from "@/lib/schema/ocr";
import { MOCK_OCR_ROWS, mockOcrResult, mockOcrReview } from "@/server/ocr/mock";

describe("mockOcrResult 确定性剧本", () => {
  it("两次调用逐字节一致（纯常量，零随机零时钟）", () => {
    expect(mockOcrResult()).toEqual(mockOcrResult());
  });

  it("剧本通过 OcrResultSchema 校验", () => {
    expect(OcrResultSchema.safeParse(mockOcrResult()).success).toBe(true);
  });

  it("剧本含两行低置信（标黄演示动线的锚点）且行数稳定", () => {
    const result = mockOcrResult();
    const lowRows = result.transactions.filter((row) => row.confidence < 0.8);
    expect(lowRows).toHaveLength(2);
    expect(result.transactions).toHaveLength(8);
    expect(result.rawText).toBeTruthy();
  });

  it("低置信行为金额与商户各一行（复核聚焦两列的演示口径）", () => {
    const lowRows = MOCK_OCR_ROWS.filter((row) => row.confidence < 0.8);
    // 第 4 行（地铁出行，金额存疑）与第 6 行（喜茶，商户存疑）
    expect(lowRows[0]?.merchant).toBe("地铁出行");
    expect(lowRows[1]?.merchant).toBe("喜茶");
  });
});

describe("mockOcrReview 二次复核剧本", () => {
  const transactions = mockOcrResult().transactions;

  it("被标记单元格所在行置信度提升到 0.95", () => {
    const reviewed = mockOcrReview(transactions, [
      { rowIndex: 3, field: "amountYuan" },
      { rowIndex: 3, field: "merchant" },
    ]);
    expect(reviewed.transactions[3]?.confidence).toBe(0.95);
  });

  it("未标记行保持原值（动线前后可对照）", () => {
    const reviewed = mockOcrReview(transactions, [{ rowIndex: 3, field: "amountYuan" }]);
    expect(reviewed.transactions[0]).toEqual(transactions[0]);
    expect(reviewed.transactions[5]).toEqual(transactions[5]);
  });

  it("行文本不做虚构修正（复核是确认不是改写）", () => {
    const reviewed = mockOcrReview(transactions, [{ rowIndex: 5, field: "merchant" }]);
    expect(reviewed.transactions[5]?.merchant).toBe("喜茶");
  });

  it("越界下标安全忽略", () => {
    const reviewed = mockOcrReview(transactions, [{ rowIndex: 99, field: "merchant" }]);
    expect(reviewed.transactions).toHaveLength(transactions.length);
  });
});
