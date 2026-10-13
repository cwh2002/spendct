/**
 * 账单 schema 单测（07 §3）：类目枚举、DDL 列集、13 视图 / 9 预计算表键集与契约清单逐一相等，
 * 订阅候选规则的 25-40 天相邻间隔与 ±1% 容差关键字断言。
 */
import { describe, expect, it } from "vitest";

import {
  CATEGORY_CODES,
  PRECOMPUTE_DEFS,
  TRANSACTION_COLUMNS,
  TRANSACTIONS_DDL,
  VIEW_DEFS,
} from "@/lib/schema/bill";

/** 07 §3 唯一清单（与 ALLOWED_RELATIONS 中 13 视图 + 9 预计算表同名） */
const CONTRACT_VIEW_NAMES = [
  "v_monthly_summary",
  "v_category_monthly",
  "v_merchant_monthly",
  "v_daily_expense",
  "v_merchant_periodic",
  "v_subscription_candidates",
  "v_anomaly_daily",
  "v_top_merchants_90d",
  "v_mom_category",
  "v_yearly",
  "v_impulse_events",
  "v_night_spend",
  "v_health_inputs",
] as const;

const CONTRACT_PRECOMPUTE_NAMES = [
  "clean_overview",
  "profile_category_stats",
  "profile_merchant_stats",
  "profile_monthly_stats",
  "anomaly_daily_stats",
  "anomaly_merchant_stats",
  "subscription_patterns",
  "attribution_mom_stats",
  "annual_summary",
] as const;

/** 07 §3 DDL 的 18 列 */
const DDL_COLUMNS = [
  "tx_id",
  "account_id",
  "ts",
  "date_iso",
  "amount_cents",
  "direction",
  "merchant",
  "counterparty",
  "category",
  "sub_category",
  "channel",
  "status",
  "external_id",
  "note",
  "raw_ref",
  "source",
  "_meta",
  "imported_files",
] as const;

describe("类目枚举（07 §3）", () => {
  it("CATEGORY_CODES 恰为 12 类且顺序与契约一致", () => {
    expect(CATEGORY_CODES).toHaveLength(12);
    expect([...CATEGORY_CODES]).toEqual([
      "餐饮",
      "交通",
      "购物",
      "娱乐",
      "居住",
      "通讯",
      "医疗",
      "教育",
      "人情",
      "金融",
      "订阅",
      "其他",
    ]);
  });

  it("类目无重复", () => {
    expect(new Set(CATEGORY_CODES).size).toBe(CATEGORY_CODES.length);
  });
});

describe("TRANSACTIONS_DDL（07 §3 逐字）", () => {
  it("以 CREATE TABLE transactions 开头且包含全部 18 列", () => {
    expect(TRANSACTIONS_DDL).toMatch(/^CREATE TABLE transactions \(/);
    for (const col of DDL_COLUMNS) {
      expect(TRANSACTIONS_DDL).toContain(`  ${col}`);
    }
  });

  it("金额单位整数分：amount_cents BIGINT NOT NULL", () => {
    expect(TRANSACTIONS_DDL).toContain("amount_cents BIGINT NOT NULL");
  });

  it("方向三值约束：expense/income/neutral", () => {
    expect(TRANSACTIONS_DDL).toContain(
      "CHECK (direction IN ('expense','income','neutral'))",
    );
  });

  it("TRANSACTION_COLUMNS 与 DDL 列集一致（18 列）", () => {
    expect(TRANSACTION_COLUMNS).toHaveLength(18);
    expect([...TRANSACTION_COLUMNS]).toEqual([...DDL_COLUMNS]);
  });
});

describe("VIEW_DEFS 键集（07 §3 唯一清单 13 视图）", () => {
  it("键集与契约清单逐一相等", () => {
    expect(Object.keys(VIEW_DEFS).sort()).toEqual([...CONTRACT_VIEW_NAMES].sort());
  });

  it("每条视图 SQL 以 CREATE OR REPLACE VIEW 开头且含自身视图名", () => {
    for (const [name, sql] of Object.entries(VIEW_DEFS)) {
      expect(sql).toMatch(/^CREATE OR REPLACE VIEW /);
      expect(sql).toContain(`VIEW ${name}`);
    }
  });
});

describe("PRECOMPUTE_DEFS 键集（07 §3 唯一清单 9 预计算表）", () => {
  it("键集与契约清单逐一相等", () => {
    expect(Object.keys(PRECOMPUTE_DEFS).sort()).toEqual(
      [...CONTRACT_PRECOMPUTE_NAMES].sort(),
    );
  });

  it("每条建表 SQL 以 CREATE OR REPLACE TABLE 开头且含自身表名", () => {
    for (const [name, sql] of Object.entries(PRECOMPUTE_DEFS)) {
      expect(sql).toMatch(/^CREATE OR REPLACE TABLE /);
      expect(sql).toContain(`TABLE ${name}`);
    }
  });
});

describe("订阅候选规则（07 §3：v_subscription_candidates）", () => {
  const sql = VIEW_DEFS["v_subscription_candidates"];
  if (!sql) {
    throw new Error("v_subscription_candidates 未定义");
  }

  it("相邻间隔 25-40 天窗口存在", () => {
    expect(sql).toContain("BETWEEN 25 AND 40");
    expect(sql).toContain("25");
    expect(sql).toContain("40");
  });

  it("相邻间隔用 LAG 窗口函数按商户时序计算", () => {
    expect(sql).toContain("LAG(ts) OVER (PARTITION BY merchant ORDER BY ts)");
    expect(sql).toContain("LAG(amount_cents) OVER (PARTITION BY merchant ORDER BY ts)");
  });

  it("单笔金额 1-60 元（100-6000 分）", () => {
    expect(sql).toContain("BETWEEN 100 AND 6000");
  });

  it("金额恒定容差 ±1%", () => {
    expect(sql).toContain("<= 1.0");
  });

  it("同商户至少 3 笔（合格相邻对 ≥2）", () => {
    expect(sql).toContain("HAVING COUNT(*) >= 2");
    expect(sql).toContain("HAVING COUNT(*) >= 3");
  });
});

describe("深夜语义（07 §3：23:00-05:00）", () => {
  it("v_night_spend 按 hour>=23 或 hour<5 判定深夜", () => {
    const sql = VIEW_DEFS["v_night_spend"];
    if (!sql) {
      throw new Error("v_night_spend 未定义");
    }
    expect(sql).toContain("EXTRACT(HOUR FROM ts) >= 23");
    expect(sql).toContain("EXTRACT(HOUR FROM ts) < 5");
  });
});

describe("v_health_inputs 六维健康输入", () => {
  const sql = VIEW_DEFS["v_health_inputs"];
  if (!sql) {
    throw new Error("v_health_inputs 未定义");
  }

  it("含六维占比字段：餐饮/订阅/冲动/深夜/结余/大额脉冲", () => {
    expect(sql).toContain("food_ratio");
    expect(sql).toContain("sub_ratio");
    expect(sql).toContain("impulse_ratio");
    expect(sql).toContain("night_ratio");
    expect(sql).toContain("surplus_ratio");
    expect(sql).toContain("big_pulse_ratio");
  });

  it("依赖 v_impulse_events（冲动消费维度）", () => {
    expect(sql).toContain("JOIN v_impulse_events");
  });
});
