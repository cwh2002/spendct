/**
 * OCR 行 → CleanTransaction（02 §12.1「与 CSV 行同路径进映射/清洗」的落点）。
 *
 * 换算口径：
 * - 金额：元 → 分（Math.round(元 × 100)，全项目唯一金额单位是分，07 §3）；
 * - 时间：'YYYY-MM-DD HH:mm' → 本地 ISO 串（补 :00 秒位，与 clean-input
 *   的纯日期账单口径一致）；
 * - 类目：复用 clean-input 的商户关键词词典（classifyMerchant），
 *   与 CSV 导入得到完全相同的类目细分结果；
 * - 指纹：与 cleanBillRows 同一公式（渠道|日期|金额|商户|单号），
 *   同一笔交易经 CSV 或 OCR 导入产生相同 tx_id，跨文件去重依然生效。
 *
 * 调用方（上传页 OCR 面板）在确认导入前已做时间格式校验；
 * 这里对格式异常行仍做防御性跳过，绝不向上抛错中断导入。
 */
import type { CleanTransaction } from "@/lib/schema/bill";
import type { OcrTransactionRow } from "@/lib/schema/ocr";
import { classifyMerchant, sha256Hex } from "@/lib/import/clean-input";

/** 行时间格式（与 OcrTransactionRowSchema 注释口径一致；确认表导入前兜底校验同款正则） */
export const OCR_TIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

/**
 * OCR 行数组 → 可直接落库的清洗行。
 * channel 由上传入口的截图来源选择决定（微信/支付宝），
 * source 恒为 'ocr'（07 §3 渠道枚举，A3）。
 */
export async function ocrToCleanTransactions(
  rows: OcrTransactionRow[],
  channel: "wechat" | "alipay",
  fileName: string,
): Promise<CleanTransaction[]> {
  const cleaned: CleanTransaction[] = [];
  for (const row of rows) {
    if (!OCR_TIME_PATTERN.test(row.time)) continue;
    if (!Number.isFinite(row.amountYuan) || row.amountYuan <= 0) continue;
    const dateIso = row.time.slice(0, 10);
    const amountCents = Math.round(row.amountYuan * 100);
    const fingerprint = `${channel}|${dateIso}|${amountCents}|${row.merchant}|`;
    const txId = (await sha256Hex(fingerprint)).slice(0, 16);
    const { category, subCategory } = classifyMerchant(row.merchant, undefined);
    cleaned.push({
      tx_id: txId,
      account_id: null,
      ts: `${row.time.replace(" ", "T")}:00`,
      date_iso: dateIso,
      amount_cents: amountCents,
      direction: row.direction,
      merchant: row.merchant,
      counterparty: null,
      category,
      sub_category: subCategory,
      channel,
      status: "paid",
      external_id: null,
      note: null,
      raw_ref: null,
      source: "ocr",
      _meta: null,
      imported_files: [fileName],
    });
  }
  return cleaned;
}
