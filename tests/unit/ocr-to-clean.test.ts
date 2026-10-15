/**
 * OCR 转换层单测（src/lib/ocr/ocr-to-clean.ts，02 §12.1「与 CSV 同路径清洗」）。
 *
 * 覆盖：元→分换算（含浮点取整）、时间字符串→ISO、类目词典细分、
 * 渠道/来源落值、指纹与 cleanBillRows 同一公式（16 位 hex）、
 * 格式异常行防御性跳过（绝不抛错）。
 */
import { describe, expect, it } from "vitest";

import { cleanBillRows } from "@/lib/import/clean-input";
import type { BillRow } from "@/lib/import/types";
import { OCR_TIME_PATTERN, ocrToCleanTransactions } from "@/lib/ocr/ocr-to-clean";
import type { OcrTransactionRow } from "@/lib/schema/ocr";

function row(overrides: Partial<OcrTransactionRow> = {}): OcrTransactionRow {
  return {
    time: "2026-10-14 08:12",
    amountYuan: 12.5,
    merchant: "瑞幸咖啡",
    direction: "expense",
    confidence: 0.9,
    ...overrides,
  };
}

describe("ocrToCleanTransactions 换算口径", () => {
  it("元 → 分：两位小数取整不丢精度", async () => {
    const cleaned = await ocrToCleanTransactions(
      [row({ amountYuan: 12.9 }), row({ amountYuan: 0.29 }), row({ amountYuan: 86.32 })],
      "wechat",
      "截图.png",
    );
    expect(cleaned.map((c) => c.amount_cents)).toEqual([1290, 29, 8632]);
  });

  it("时间字符串 → ISO（补秒位），date_iso 取日期部分", async () => {
    const [cleaned] = await ocrToCleanTransactions([row({ time: "2026-10-14 08:12" })], "wechat", "截图.png");
    expect(cleaned?.ts).toBe("2026-10-14T08:12:00");
    expect(cleaned?.date_iso).toBe("2026-10-14");
  });

  it("类目复用商户关键词词典（与 CSV 清洗同源）", async () => {
    const rows = [
      row({ merchant: "瑞幸咖啡" }),
      row({ merchant: "国家电网" }),
      row({ merchant: "某不知名小铺" }),
    ];
    const cleaned = await ocrToCleanTransactions(rows, "wechat", "截图.png");
    expect(cleaned.map((c) => [c.category, c.sub_category])).toEqual([
      ["餐饮", "餐饮"],
      ["居住", "住房水电"],
      ["其他", null],
    ]);
  });

  it("channel 取入口选择值，source 恒为 ocr，imported_files 记文件名", async () => {
    const cleaned = await ocrToCleanTransactions([row()], "alipay", "账单截图.png");
    expect(cleaned[0]?.channel).toBe("alipay");
    expect(cleaned[0]?.source).toBe("ocr");
    expect(cleaned[0]?.imported_files).toEqual(["账单截图.png"]);
    expect(cleaned[0]?.status).toBe("paid");
    expect(cleaned[0]?.account_id).toBeNull();
  });

  it("指纹与 CSV 清洗同一公式：同笔交易两条路径产出相同 tx_id", async () => {
    const ocrCleaned = await ocrToCleanTransactions([row({ amountYuan: 12.5 })], "wechat", "截图.png");
    const csvBillRow: BillRow = {
      dateIso: "2026-10-14",
      timeIso: "08:12:00",
      category: "其他",
      merchant: "瑞幸咖啡",
      channel: "wechat",
      direction: "expense",
      amountCents: 1250,
    };
    const csvCleaned = await cleanBillRows([csvBillRow], "微信账单.csv");
    expect(ocrCleaned[0]?.tx_id).toBe(csvCleaned[0]?.tx_id);
    expect(ocrCleaned[0]?.tx_id).toMatch(/^[0-9a-f]{16}$/);
  });

  it("direction 原样透传（含 income）", async () => {
    const cleaned = await ocrToCleanTransactions([row({ direction: "income" })], "wechat", "截图.png");
    expect(cleaned[0]?.direction).toBe("income");
  });
});

describe("防御性跳过（转换绝不抛错）", () => {
  it("时间格式异常的行被跳过，合法行照常转换", async () => {
    const cleaned = await ocrToCleanTransactions(
      [row({ time: "10月14日 8:12" }), row({ time: "2026-10-14 08:12" })],
      "wechat",
      "截图.png",
    );
    expect(cleaned).toHaveLength(1);
    expect(cleaned[0]?.merchant).toBe("瑞幸咖啡");
  });

  it("金额非法（0 / NaN）的行被跳过", async () => {
    const cleaned = await ocrToCleanTransactions(
      [row({ amountYuan: 0 }), row({ amountYuan: Number.NaN })],
      "wechat",
      "截图.png",
    );
    expect(cleaned).toHaveLength(0);
  });
});

describe("OCR_TIME_PATTERN 导入前校验口径", () => {
  it("严格匹配 YYYY-MM-DD HH:mm", () => {
    expect(OCR_TIME_PATTERN.test("2026-10-14 08:12")).toBe(true);
    expect(OCR_TIME_PATTERN.test("2026-10-14 8:12")).toBe(false);
    expect(OCR_TIME_PATTERN.test("2026/10/14 08:12")).toBe(false);
    expect(OCR_TIME_PATTERN.test("2026-10-14")).toBe(false);
  });
});
