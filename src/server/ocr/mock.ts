/**
 * OCR mock 剧本（DEMO_MODE=mock 或双视觉 key 全缺时的确定性返回，07 §7）。
 *
 * 与 mock-narratives 同口径：纯常量、零随机、零时钟，结果逐字节可复现。
 * 剧本故意含两行低置信度（金额、商户各一行），保证「标黄 → 截取局部
 * 二次复核 → 确认导入」的多模态演示动线在零密钥部署下完整可走
 * （07 §11 多模态二次确认的第二落点）。
 *
 * 数据口径对齐内置账单生成器（sample-bill）：学生消费画像、
 * 2026-10 上旬时间窗、类目覆盖餐饮/交通/购物/娱乐/居住，
 * 保证导入后六阶段管线能产出与演示数据同类的洞察。
 */
import type { OcrResult, OcrReviewCell, OcrTransactionRow } from "@/lib/schema/ocr";

/** 固定剧本：8 行支出，第 4 行（金额）与第 6 行（商户）低置信 */
export const MOCK_OCR_ROWS: readonly OcrTransactionRow[] = [
  { time: "2026-10-14 08:12", amountYuan: 12.9, merchant: "瑞幸咖啡", direction: "expense", confidence: 0.96 },
  { time: "2026-10-14 12:34", amountYuan: 26.5, merchant: "美团外卖", direction: "expense", confidence: 0.97 },
  { time: "2026-10-14 18:05", amountYuan: 86.32, merchant: "永辉超市", direction: "expense", confidence: 0.91 },
  { time: "2026-10-13 07:50", amountYuan: 3, merchant: "地铁出行", direction: "expense", confidence: 0.62 },
  { time: "2026-10-13 19:22", amountYuan: 45, merchant: "万达影城", direction: "expense", confidence: 0.98 },
  { time: "2026-10-12 21:40", amountYuan: 15, merchant: "喜茶", direction: "expense", confidence: 0.55 },
  { time: "2026-10-12 09:15", amountYuan: 199, merchant: "京东商城", direction: "expense", confidence: 0.94 },
  { time: "2026-10-11 11:30", amountYuan: 68.75, merchant: "国家电网", direction: "expense", confidence: 0.99 },
];

/** 固定 rawText 摘要（模拟图片文字抓取结果，供确认表「识别原文」角标展示） */
const MOCK_RAW_TEXT = [
  "微信支付账单 10月11日-10月14日",
  "瑞幸咖啡 12.9 支出",
  "美团外卖 26.5 支出",
  "永辉超市 86.32 支出",
  "地铁出行 3 支出（金额存疑）",
  "万达影城 45 支出",
  "喜茶 15 支出（商户存疑）",
  "京东商城 199 支出",
  "国家电网 68.75 支出",
].join("\n");

/** recognize 模式：返回剧本副本（调用方不得改共享常量，防御性拷贝） */
export function mockOcrResult(): OcrResult {
  return {
    transactions: MOCK_OCR_ROWS.map((row) => ({ ...row })),
    rawText: MOCK_RAW_TEXT,
  };
}

/**
 * review 模式：对标记单元格所在行执行「二次复核」——
 * 剧本口径为复核确认（置信度提升到 0.95），不虚构文本修正。
 * 未在 cells 中出现的行保持原样，保证动线前后数据可对照。
 */
export function mockOcrReview(
  transactions: OcrTransactionRow[],
  cells: OcrReviewCell[],
): OcrResult {
  const next = transactions.map((row) => ({ ...row }));
  for (const cell of cells) {
    const row = next[cell.rowIndex];
    if (row) row.confidence = 0.95;
  }
  return { transactions: next };
}
