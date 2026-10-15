/**
 * 结果脱敏器单测（07 §5 五步口径，修订案 A12 落地为 async 签名）。
 * 覆盖：S1 金额分箱（明细列）与聚合列豁免、S2 商户加盐哈希（同盐稳定/
 * 换盐变化）、S3 禁列剥离、S4 统计列 2 位舍入、S5 行截断、非有限值置空告警、
 * 输入行不被修改、applied 步骤报告。
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_AMOUNT_BUCKETS,
  FORBIDDEN_COLUMNS,
  getRunSalt,
  sanitizeResult,
} from "@/lib/sanitize/sanitizer";

const SALT = "test-salt-123";

describe("S1 金额分箱", () => {
  it("明细金额按档位分箱（≤5元…>500元）", async () => {
    const { rows } = await sanitizeResult(
      [
        { amount_cents: 350 }, // 3.5 元
        { amount_cents: 1500 }, // 15 元 → 落在 ≤20 元档
        { amount_cents: 60000 }, // 600 元 → 最高档之上
      ],
      ["amount_cents"],
      { merchantSalt: SALT },
    );
    expect(rows.map((row) => row.amount_cents)).toEqual(["≤5元", "≤20元", ">500元"]);
  });

  it("聚合列（sum_/total_）不分箱，仅明细列 amount_cents 分箱", async () => {
    const { rows } = await sanitizeResult(
      [{ amount_cents: 500, sum_expense: 123456 }],
      ["amount_cents", "sum_expense"],
      { merchantSalt: SALT },
    );
    expect(rows[0]?.amount_cents).toBe("≤5元");
    expect(rows[0]?.sum_expense).toBe(123456);
  });

  it("自定义分箱上限生效", async () => {
    const { rows } = await sanitizeResult(
      [{ amount_cents: 3000 }, { amount_cents: 6000 }],
      ["amount_cents"],
      { merchantSalt: SALT, amountBuckets: [10, 50] },
    );
    // 30 元落在 ≤50 元档，60 元超出最高档
    expect(rows[0]?.amount_cents).toBe("≤50元");
    expect(rows[1]?.amount_cents).toBe(">50元");
  });
});

describe("S2 商户加盐哈希", () => {
  it("同盐下同一商户哈希稳定，格式为 m_+8 位 hex", async () => {
    const { rows } = await sanitizeResult(
      [
        { merchant: "学校食堂" },
        { merchant: "学校食堂" },
        { merchant: "瑞幸咖啡" },
      ],
      ["merchant"],
      { merchantSalt: SALT },
    );
    expect(rows[0]?.merchant).toMatch(/^m_[0-9a-f]{8}$/);
    expect(rows[0]?.merchant).toBe(rows[1]?.merchant);
    expect(rows[0]?.merchant).not.toBe(rows[2]?.merchant);
  });

  it("换盐后同一商户哈希变化（防彩虹表，07 §5 盐策略）", async () => {
    const first = await sanitizeResult([{ merchant: "学校食堂" }], ["merchant"], {
      merchantSalt: "salt-a",
    });
    const second = await sanitizeResult([{ merchant: "学校食堂" }], ["merchant"], {
      merchantSalt: "salt-b",
    });
    expect(first.rows[0]?.merchant).not.toBe(second.rows[0]?.merchant);
  });
});

describe("S3 禁列剥离", () => {
  it("禁列从列清单与行数据中整体移除，并报告步骤", async () => {
    const { rows, columns, applied } = await sanitizeResult(
      [{ tx_id: "202610150001", note: "备注", category: "餐饮" }],
      ["tx_id", "note", "category"],
      { merchantSalt: SALT },
    );
    expect(columns).toEqual(["category"]);
    expect(rows[0]).toEqual({ category: "餐饮" });
    expect(applied).toContain(`forbidden-stripped:${FORBIDDEN_COLUMNS.filter((c) => ["tx_id", "note"].includes(c)).join(",")}`);
  });
});

describe("S4 统计列舍入", () => {
  it("avg_/stddev_ 列四舍五入 2 位小数，普通数值列不动", async () => {
    const { rows } = await sanitizeResult(
      [{ avg_expense: 12.345, stddev_expense: 0.4567, month: 202610 }],
      ["avg_expense", "stddev_expense", "month"],
      { merchantSalt: SALT },
    );
    expect(rows[0]?.avg_expense).toBe(12.35);
    expect(rows[0]?.stddev_expense).toBe(0.46);
    expect(rows[0]?.month).toBe(202610);
  });
});

describe("S5 行截断", () => {
  it("超过 maxRows 只保留前 maxRows 行并报告", async () => {
    const { rows, applied } = await sanitizeResult(
      [1, 2, 3, 4, 5].map((n) => ({ amount_cents: n * 100 })),
      ["amount_cents"],
      { merchantSalt: SALT, maxRows: 3 },
    );
    expect(rows).toHaveLength(3);
    expect(applied).toContain("truncated:3");
  });
});

describe("健壮性与不变式", () => {
  it("非有限数值置空并告警，不阻断脱敏", async () => {
    const { rows, warnings } = await sanitizeResult(
      [{ amount_cents: Number.NaN, category: "餐饮" }],
      ["amount_cents", "category"],
      { merchantSalt: SALT },
    );
    expect(rows[0]?.amount_cents).toBeNull();
    expect(warnings).toContain("non-finite:amount_cents");
    expect(rows[0]?.category).toBe("餐饮");
  });

  it("输入行不被修改（五步均在拷贝上行进）", async () => {
    const input = [{ merchant: "学校食堂", tx_id: "t1", amount_cents: 350 }];
    await sanitizeResult(input, ["merchant", "tx_id", "amount_cents"], { merchantSalt: SALT });
    expect(input[0]).toEqual({ merchant: "学校食堂", tx_id: "t1", amount_cents: 350 });
  });

  it("applied 报告实际执行的步骤", async () => {
    const { applied } = await sanitizeResult(
      [
        { merchant: "学校食堂", avg_expense: 1.234, amount_cents: 500, tx_id: "t1" },
        { merchant: "学校食堂", avg_expense: 1.234, amount_cents: 500, tx_id: "t1" },
      ],
      ["merchant", "avg_expense", "amount_cents", "tx_id"],
      { merchantSalt: SALT, maxRows: 1 },
    );
    expect(applied).toContain("forbidden-stripped:tx_id");
    expect(applied).toContain("truncated:1");
    expect(applied).toContain("merchant-hashed:merchant");
    expect(applied).toContain("amount-bucketed:1rows");
    expect(applied).toContain("rounded:1cells");
  });
});

describe("运行盐", () => {
  it("无 sessionStorage 的环境每次取新盐（服务端/测试口径）", () => {
    const saltA = getRunSalt();
    const saltB = getRunSalt();
    expect(saltA.length).toBeGreaterThan(0);
    expect(saltA).not.toBe(saltB);
  });

  it("默认分箱上限为 07 §5 档位表", () => {
    expect(DEFAULT_AMOUNT_BUCKETS).toEqual([0, 5, 10, 20, 50, 100, 200, 500]);
  });
});
