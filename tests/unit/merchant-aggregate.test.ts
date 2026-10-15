/**
 * 商户统计（08 修订案 A13）聚合纯函数单测：
 * 覆盖演示行聚合、DuckDB 行映射（含 bigint 兜底）、总额分母与占比计算、
 * 追问锚点标签与数据来源脚注（截断口径如实性）。
 */
import { describe, expect, it } from "vitest";
import {
  aggregateMerchants,
  expenseTotalFromDirection,
  merchantAnchorLabel,
  merchantFooterText,
  merchantsFromQuery,
} from "@/lib/insights/merchant-aggregate";

describe("aggregateMerchants（演示行 → 商户聚合）", () => {
  const rows = [
    { merchant: "美团外卖", amountCents: 1200 },
    { merchant: "京东商城", amountCents: 3000 },
    { merchant: "美团外卖", amountCents: 1800 },
    { merchant: "公交地铁", amountCents: 500 },
    { merchant: "京东商城", amountCents: 3000 },
  ];

  it("按商户分组汇总金额与笔数，金额降序排列", () => {
    const entries = aggregateMerchants(rows, 9500);
    expect(entries.map((e) => e.merchant)).toEqual(["京东商城", "美团外卖", "公交地铁"]);
    expect(entries[0]).toMatchObject({ cents: 6000, count: 2 });
    expect(entries[1]).toMatchObject({ cents: 3000, count: 2 });
    expect(entries[2]).toMatchObject({ cents: 500, count: 1 });
  });

  it("占比按传入的全账单总额作分母，一位小数四舍五入", () => {
    const entries = aggregateMerchants(rows, 9500);
    expect(entries[0]!.share).toBe(63.2); // 6000/9500
    expect(entries[1]!.share).toBe(31.6); // 3000/9500
    expect(entries[2]!.share).toBe(5.3); // 500/9500
  });

  it("均笔金额 = 总额 / 笔数，四舍五入到分", () => {
    const entries = aggregateMerchants(rows, 9500);
    expect(entries[0]!.avgCents).toBe(3000);
    expect(entries[2]!.avgCents).toBe(500);
  });

  it("总额分母为 0 时占比全为 0，不产生除零异常", () => {
    const entries = aggregateMerchants([], 0);
    expect(entries).toEqual([]);
    const withRows = aggregateMerchants([{ merchant: "A", amountCents: 100 }], 0);
    expect(withRows[0]!.share).toBe(0);
  });
});

describe("merchantsFromQuery（DuckDB 行 → 商户条目）", () => {
  it("按 SELECT 位置取值（商户 / 总额 / 笔数），金额降序", () => {
    const entries = merchantsFromQuery(
      [
        { merchant: "瑞幸咖啡", "sum(amount_cents)": 4500, "count_star()": 3 },
        { merchant: "优衣库", "sum(amount_cents)": 8900, "count_star()": 1 },
      ],
      13400,
    );
    expect(entries[0]).toMatchObject({ merchant: "优衣库", cents: 8900, count: 1 });
    expect(entries[0]!.share).toBe(66.4);
    expect(entries[1]).toMatchObject({ merchant: "瑞幸咖啡", cents: 4500, count: 3 });
  });

  it("bigint 聚合值兜底转数值", () => {
    const entries = merchantsFromQuery([{ merchant: "B", sum: BigInt(7000), count: BigInt(2) }], 7000);
    expect(entries[0]).toMatchObject({ cents: 7000, count: 2, share: 100 });
  });

  it("空商户名行被过滤，不影响其余条目", () => {
    const entries = merchantsFromQuery(
      [
        { merchant: "", sum: 9999, count: 1 },
        { merchant: "A", sum: 100, count: 1 },
      ],
      100,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]!.merchant).toBe("A");
  });
});

describe("expenseTotalFromDirection（direction 分组 → 支出总额）", () => {
  it("取 direction = expense 行的聚合值", () => {
    const total = expenseTotalFromDirection([
      { direction: "expense", total: 123450 },
      { direction: "income", total: 500 },
    ]);
    expect(total).toBe(123450);
  });

  it("无支出行时返回 0（占比随之全 0）", () => {
    expect(expenseTotalFromDirection([{ direction: "income", total: 500 }])).toBe(0);
    expect(expenseTotalFromDirection([])).toBe(0);
  });
});

describe("merchantAnchorLabel（追问锚点标签）", () => {
  it("图表点击与数据表按钮共用同口径文案：商户 + 合计 + 占比", () => {
    expect(merchantAnchorLabel("美团外卖", 63325, 12.5)).toBe(
      "美团外卖 合计 ¥633.25 · 占全账单 12.5%",
    );
    expect(merchantAnchorLabel("公交地铁", 500, 0)).toBe("公交地铁 合计 ¥5.00 · 占全账单 0%");
  });
});

describe("merchantFooterText（数据来源脚注）", () => {
  it("截断时只说明按金额取前 N 名展示，不把展示条数宣称为商户总数", () => {
    const text = merchantFooterText({
      real: true,
      truncated: true,
      entryCount: 49, // 空商户名分组被过滤后少于原始 50 行，展示条数不是总数
      rowLimit: 50,
      totalCents: 950000,
    });
    expect(text).toContain("按金额取前 50 名展示");
    expect(text).not.toContain("共 49 个商户");
    expect(text).not.toContain("全部展示");
    expect(text).toContain("¥9500.00");
  });

  it("未截断时展示条数即账单具名商户总数，标注全部展示", () => {
    const text = merchantFooterText({
      real: true,
      truncated: false,
      entryCount: 12,
      rowLimit: 50,
      totalCents: 123456,
    });
    expect(text).toBe("你的账单数据 · 共 12 个商户 · 全部展示 · 全账单支出合计 ¥1234.56");
  });

  it("演示动线标明内置数据，不出现「你的账单数据」口径", () => {
    const text = merchantFooterText({
      real: false,
      truncated: false,
      entryCount: 8,
      rowLimit: 50,
      totalCents: 60000,
    });
    expect(text).toBe("内置数据 · 共 8 个商户 · 演示账单支出合计 ¥600.00");
  });
});
