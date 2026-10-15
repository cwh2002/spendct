/**
 * query_bill_db_metadata 测试（docs/04-rag-mcp.md §8.4）：
 * 聚合元数据回执、严格校验拒收明细行与非法快照。
 */
import { describe, expect, it } from "vitest";
import { queryBillDbMetadata } from "../src/tools/bill-metadata.js";

const VALID_SNAPSHOT = {
  table: "transactions",
  rowCount: 1234,
  datasetTxHash: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
  schema: [
    { name: "amount_cents", type: "INTEGER", sample: "1280" },
    { name: "category", type: "VARCHAR", sample: "餐饮" },
  ],
  stats: [
    { column: "amount_cents", min: 10, max: 128000, mean: 3210.5, distinct: 301 },
    { column: "category", min: "餐饮", max: "娱乐", distinct: 12 },
  ],
};

describe("query_bill_db_metadata", () => {
  it("合法聚合快照回执原样通过", () => {
    const result = queryBillDbMetadata(VALID_SNAPSHOT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.table).toBe("transactions");
    expect(result.data.rowCount).toBe(1234);
    expect(result.meta.source).toContain("聚合元数据");
  });

  it("merchants 表同样在白名单内", () => {
    const result = queryBillDbMetadata({ ...VALID_SNAPSHOT, table: "merchants" });
    expect(result.ok).toBe(true);
  });

  it("明细行注入被严格模式拒绝：schema 列带未声明字段", () => {
    // 模拟把原始账单行（amount+merchant+time）塞进 schema 数组
    const injected = {
      ...VALID_SNAPSHOT,
      schema: [{ name: "amount", type: "INTEGER", sample: "1280", merchant: "某商户", time: "2026-09-01 12:00" }],
    };
    const result = queryBillDbMetadata(injected);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_input");
  });

  it("明细行注入被严格模式拒绝：stats 项带未声明字段", () => {
    const injected = {
      ...VALID_SNAPSHOT,
      stats: [{ column: "amount", min: 10, max: 128000, total: 99999 }],
    };
    const result = queryBillDbMetadata(injected);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_input");
  });

  it("表名白名单外一律拒绝", () => {
    const result = queryBillDbMetadata({ ...VALID_SNAPSHOT, table: "user_secrets" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_input");
      expect(result.error.message).toContain("table");
    }
  });

  it("数据集指纹格式不符拒绝", () => {
    const result = queryBillDbMetadata({ ...VALID_SNAPSHOT, datasetTxHash: "not-a-hash" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("指纹");
  });

  it("行数越界 / 负数拒绝", () => {
    const negative = queryBillDbMetadata({ ...VALID_SNAPSHOT, rowCount: -1 });
    expect(negative.ok).toBe(false);

    const tooMany = queryBillDbMetadata({ ...VALID_SNAPSHOT, rowCount: 10_000_001 });
    expect(tooMany.ok).toBe(false);
  });

  it("schema 为空数组拒绝（无元数据即无效回执）", () => {
    const result = queryBillDbMetadata({ ...VALID_SNAPSHOT, schema: [] });
    expect(result.ok).toBe(false);
  });

  it("快照根节点带未声明字段同样被严格模式拒绝", () => {
    const injected = { ...VALID_SNAPSHOT, rawRows: [{ amount: 1280 }] };
    const result = queryBillDbMetadata(injected);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_input");
  });
});
