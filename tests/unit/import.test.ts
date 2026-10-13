/**
 * 账单 CSV 解析单测（T3/T4 验收，07 契约 §9/§15）。
 *
 * 夹具全部为测试内常量字符串（不落盘），形状对齐真实导出：
 * 微信 11 列（07 §15 字段清单）、支付宝 16 列常见形态。
 * 金额断言一律整数分（07 §3 全项目唯一金额单位）。
 */
import { describe, expect, it } from "vitest";

import { buildCleanCsv, parseBillCsv, stripDuplicates } from "@/lib/import/parse-csv";
import type { BillRow } from "@/lib/import/types";

const WECHAT_HEADER =
  "交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注";

const ALIPAY_HEADER =
  "交易号,商家订单号,交易创建时间,付款时间,最近修改时间,交易来源地,类型,交易对方,商品名称,金额（元）,收/支,交易状态,服务费（元）,成功退款（元）,备注,资金状态";

function wechatBill(rows: string[]): string {
  return [WECHAT_HEADER, ...rows].join("\n");
}

describe("parseBillCsv：微信账单", () => {
  const csv = wechatBill([
    '2026-01-05 12:34:56,商户消费,美团外卖,外卖订单,支出,¥36.50,零钱,支付成功,42000012345678901234567890123456,SP202601051234,"/"',
    "2026-01-06 08:01:02,微信红包,张三,,收入,¥100.00,零钱,已存入零钱,42000012345678901234567890123457,,生日红包",
  ]);

  it("识别微信格式并映射表头别名", () => {
    const result = parseBillCsv(csv, "微信支付账单(20260101-20260701).csv");
    expect(result.format).toBe("wechat");
    expect(result.confidence).toBe("high");
    expect(result.mapping).toMatchObject({
      交易时间: "dateIso",
      "金额(元)": "amountCents",
      "收/支": "direction",
      交易对方: "merchant",
      交易单号: "rawRef",
      商品: "note",
    });
  });

  it("解析支出/收入方向与金额（分）", () => {
    const result = parseBillCsv(csv, "微信支付账单.csv");
    expect(result.rows).toHaveLength(2);
    const expense = result.rows[0]!;
    expect(expense).toMatchObject({
      dateIso: "2026-01-05",
      timeIso: "12:34:56",
      direction: "expense",
      amountCents: 3650,
      merchant: "美团外卖",
      channel: "wechat",
      category: "其他",
      note: "外卖订单",
    });
    expect(expense.rawRef).toBe("42000012345678901234567890123456");
    expect(result.rows[1]).toMatchObject({
      direction: "income",
      amountCents: 10000,
      note: "生日红包",
    });
  });

  it("收/支为「/」的微信行按支出记账（默认方向）", () => {
    const neutral = wechatBill([
      '2026-01-07 09:00:00,微信红包,李四,,/,¥50.00,零钱,已存入零钱,TX3,,"/"',
    ]);
    const result = parseBillCsv(neutral, "微信账单.csv");
    expect(result.rows[0]).toMatchObject({ direction: "expense", amountCents: 5000 });
  });
});

describe("parseBillCsv：支付宝账单", () => {
  const csv = [
    ALIPAY_HEADER,
    '2026100522001412345678901234,20261005220123456789000001,2026-10-05 12:34:56,2026-10-05 12:35:10,2026-10-05 12:35:10,北京市,即时到账交易,肯德基,汉堡套餐,¥45.00,支出,交易成功,¥0.00,¥0.00,"/",已支出',
    '2026100522001412345678901235,20261005220123456789000002,2026/10/6 9:05,2026/10/6 9:05,2026/10/6 9:05,北京市,即时到账交易,公司财务,工资,"8,000.00",收入,交易成功,¥0.00,¥0.00,"/",已收入',
  ].join("\n");

  it("识别支付宝格式（全角括号表头）并解析金额", () => {
    const result = parseBillCsv(csv, "alipay_record_20261005.csv");
    expect(result.format).toBe("alipay");
    expect(result.confidence).toBe("high");
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      dateIso: "2026-10-05",
      timeIso: "12:34:56",
      amountCents: 4500,
      merchant: "肯德基",
      direction: "expense",
      channel: "alipay",
      note: "汉堡套餐",
    });
    expect(result.rows[0]!.rawRef).toBe("2026100522001412345678901234");
    // 千分位逗号金额 + 斜杠日期格式
    expect(result.rows[1]).toMatchObject({
      dateIso: "2026-10-06",
      timeIso: "09:05:00",
      amountCents: 800000,
      direction: "income",
    });
  });
});

describe("金额与退款标记", () => {
  it("支持 ¥ 前缀、千分位逗号两种形态", () => {
    const csv = wechatBill([
      '2026-01-05 12:00:00,商户消费,超市,购物,支出,"¥1,234.56",零钱,支付成功,TX1,SP1,"/"',
      '2026-01-06 12:00:00,商户消费,超市,购物,支出,"1,234.56",零钱,支付成功,TX2,SP2,"/"',
    ]);
    const result = parseBillCsv(csv, "微信账单.csv");
    expect(result.rows.map((row) => row.amountCents)).toEqual([123456, 123456]);
  });

  it("负金额按退款处理：方向支出 + note 前缀标记", () => {
    const csv = wechatBill([
      "2026-01-07 12:00:00,商户消费,某商户,,支出,-12.34,零钱,支付成功,TX3,SP3,原订单退款",
    ]);
    const result = parseBillCsv(csv, "微信账单.csv");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ direction: "expense", amountCents: 1234 });
    expect(result.rows[0]!.note).toBe("[退款] 原订单退款");
  });

  it("状态列含退款时同样打标记（金额取绝对值）", () => {
    const csv = wechatBill([
      '2026-01-07 12:00:00,商户消费,某商户,,支出,¥12.34,零钱,已全额退款,TX3,SP3,"/"',
    ]);
    const result = parseBillCsv(csv, "微信账单.csv");
    expect(result.rows[0]!.note).toBe("[退款]");
    expect(result.rows[0]).toMatchObject({ direction: "expense", amountCents: 1234 });
  });

  it("金额为 0 的行跳过并计数", () => {
    const csv = wechatBill([
      '2026-01-07 12:00:00,转账,张三,,/,¥0.00,零钱,已存入零钱,TX4,,"/"',
      '2026-01-08 12:00:00,商户消费,超市,购物,支出,¥10.00,零钱,支付成功,TX5,SP5,"/"',
    ]);
    const result = parseBillCsv(csv, "微信账单.csv");
    expect(result.rows).toHaveLength(1);
    expect(result.warnings).toContain("跳过 1 行：金额为 0（多为不计收支的转账/红包）");
  });
});

describe("日期解析", () => {
  it("支持 2026-01-05 12:34:56 与 2026/1/5 12:34 两种形态", () => {
    const csv = ["日期,金额(元)", "2026-01-05 12:34:56,¥10.00", "2026/1/5 12:34,¥20.00"].join("\n");
    const result = parseBillCsv(csv, "微信账单.csv");
    expect(result.rows[0]).toMatchObject({ dateIso: "2026-01-05", timeIso: "12:34:56" });
    expect(result.rows[1]).toMatchObject({ dateIso: "2026-01-05", timeIso: "12:34:00" });
  });

  it("非法日期行被跳过并计数", () => {
    const csv = wechatBill([
      '2026-13-40 12:00:00,商户消费,A,商品,支出,¥1.00,零钱,支付成功,TX1,SP1,"/"',
      'not-a-date,商户消费,B,商品,支出,¥2.00,零钱,支付成功,TX2,SP2,"/"',
      '2026-01-05 12:00:00,商户消费,C,商品,支出,¥3.00,零钱,支付成功,TX3,SP3,"/"',
    ]);
    const result = parseBillCsv(csv, "微信账单.csv");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.merchant).toBe("C");
    expect(result.warnings).toContain("跳过 2 行：日期无法解析");
  });
});

describe("编码异常提示", () => {
  it("文本含替换符时提示另存 UTF-8", () => {
    const csv = "金额(元),收/支\n�12.34,支出";
    const result = parseBillCsv(csv, "微信账单.csv");
    expect(result.warnings).toContain("文件可能是 GBK/GB2312 编码，请用记事本另存为 UTF-8 后重试");
  });

  it("GBK 按 Latin-1 解码的乱码特征同样触发提示，且置信度降为 low", () => {
    const csv = wechatBill([
      "2026-01-05 12:00:00,商户消费,美团外卖,外卖订单,支出,¥36.50,零钱,支付成功,TX1,SP1,½ð¶î»ìÂÒ",
    ]);
    const result = parseBillCsv(csv, "微信账单.csv");
    expect(result.warnings).toContain("文件可能是 GBK/GB2312 编码，请用记事本另存为 UTF-8 后重试");
    expect(result.confidence).toBe("low");
    expect(result.rows).toHaveLength(1);
  });
});

describe("重复行检测与去重", () => {
  const csv = wechatBill([
    '2026-01-05 12:00:00,商户消费,美团外卖,外卖订单,支出,¥36.50,零钱,支付成功,TX1,SP1,"/"',
    '2026-01-05 12:00:00,商户消费,美团外卖,外卖订单,支出,¥36.50,零钱,支付成功,TX1,SP1,"/"',
    '2026-01-05 12:00:00,商户消费,美团外卖,外卖订单,支出,¥36.50,零钱,支付成功,TX1,SP1,"/"',
    '2026-01-06 12:00:00,商户消费,瑞幸咖啡,拿铁,支出,¥19.90,零钱,支付成功,TX2,SP2,"/"',
  ]);

  it("同 (日期,金额,商户) 的重复计入 warnings", () => {
    const result = parseBillCsv(csv, "微信账单.csv");
    expect(result.warnings).toContain("检测到 2 条疑似重复记录，导入时将去重");
    expect(result.rows).toHaveLength(4);
  });

  it("stripDuplicates 保留首次出现、维持顺序", () => {
    const parsed = parseBillCsv(csv, "微信账单.csv");
    const deduped = stripDuplicates(parsed.rows);
    expect(deduped).toHaveLength(2);
    expect(deduped[0]!.merchant).toBe("美团外卖");
    expect(deduped[1]!.merchant).toBe("瑞幸咖啡");
  });
});

describe("首行非表头的兜底", () => {
  it("微信位置规则：首行即数据时按 11 列顺序解析并降置信度", () => {
    const csv = [
      '2026-01-05 12:34:56,商户消费,美团外卖,外卖订单,支出,¥36.50,零钱,支付成功,42000012345678901234567890123456,SP202601051234,"/"',
      '2026-01-06 08:01:02,商户消费,瑞幸咖啡,拿铁,支出,¥19.90,零钱,支付成功,42000012345678901234567890123457,SP202601051235,"/"',
    ].join("\n");
    const result = parseBillCsv(csv, "微信账单.csv");
    expect(result.format).toBe("wechat");
    expect(result.confidence).toBe("low");
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      dateIso: "2026-01-05",
      timeIso: "12:34:56",
      amountCents: 3650,
      merchant: "美团外卖",
      direction: "expense",
      note: "外卖订单",
    });
    expect(result.warnings.some((warning) => warning.includes("首行不是表头"))).toBe(true);
    expect(result.mapping["第1列"]).toBe("dateIso");
    expect(result.mapping["第6列"]).toBe("amountCents");
  });
});

describe("无法识别的格式", () => {
  it("表头无法命中别名且不似数据时返回 unknown", () => {
    const result = parseBillCsv("A,B\n1,2", "账单.csv");
    expect(result.format).toBe("unknown");
    expect(result.rows).toEqual([]);
    expect(result.warnings.some((warning) => warning.includes("无法识别"))).toBe(true);
  });

  it("表头通用但渠道不明时返回 unknown 并提示渠道", () => {
    const result = parseBillCsv(["日期,金额", "2026-01-05,12.34"].join("\n"), "我的账单.csv");
    expect(result.format).toBe("unknown");
    expect(result.confidence).toBe("low");
    expect(result.rows).toEqual([]);
    expect(result.warnings.some((warning) => warning.includes("渠道"))).toBe(true);
  });

  it("文件名提示微信时按微信解析（medium）", () => {
    const result = parseBillCsv(
      ["日期,金额,说明", "2026-01-05,12.34,早餐"].join("\n"),
      "微信支付账单.csv",
    );
    expect(result.format).toBe("wechat");
    expect(result.confidence).toBe("medium");
    expect(result.rows[0]).toMatchObject({ dateIso: "2026-01-05", amountCents: 1234 });
  });
});

describe("buildCleanCsv", () => {
  it("产出标准列 CSV，含逗号/引号转义", () => {
    const rows: BillRow[] = [
      {
        dateIso: "2026-01-05",
        category: "餐饮",
        merchant: "美团外卖",
        channel: "wechat",
        direction: "expense",
        amountCents: 3650,
      },
      {
        dateIso: "2026-01-06",
        category: "其他",
        merchant: "肯德基,回龙观店",
        channel: "alipay",
        direction: "income",
        amountCents: 1234,
      },
    ];
    const csvText = buildCleanCsv(rows);
    const lines = csvText.split("\n");
    expect(lines[0]).toBe("date_iso,category,merchant,channel,direction,amount_cents");
    expect(lines[1]).toBe("2026-01-05,餐饮,美团外卖,wechat,expense,3650");
    expect(lines[2]).toBe('2026-01-06,其他,"肯德基,回龙观店",alipay,income,1234');
  });
});
