/**
 * 追加合并去重（WP4 §4b）单测：键口径 (日期|金额|商户) 与 parse-csv 的
 * duplicateKey 同源（\u0000 分隔三元组）；existing 保序在前、只增不减；
 * 批内重复也计 skipped；同日同额不同商户不判重；入参不被改写。
 */
import { describe, expect, it } from "vitest";

import { cleanRowKey, mergeCleanBatches } from "@/lib/import/merge-batches";
import type { CleanTransaction } from "@/lib/schema/bill";

/** 最小清洗行工厂：键三字段必填，其余列填公共默认值 */
function tx(
  overrides: Partial<CleanTransaction> & {
    date_iso: string;
    amount_cents: number;
    merchant: string;
  },
): CleanTransaction {
  const { date_iso, amount_cents, merchant, ...rest } = overrides;
  return {
    tx_id: `t-${date_iso}-${amount_cents}-${merchant}`,
    account_id: null,
    ts: `${date_iso}T12:00:00`,
    date_iso,
    amount_cents,
    direction: "expense",
    merchant,
    counterparty: null,
    category: "餐饮",
    sub_category: null,
    channel: "wechat",
    status: "paid",
    external_id: null,
    note: null,
    raw_ref: null,
    source: "wechat",
    _meta: null,
    imported_files: ["账单.csv"],
    ...rest,
  };
}

describe("cleanRowKey（与 parse-csv duplicateKey 同口径）", () => {
  it("键 = 日期|金额|商户 三元组，\u0000 分隔", () => {
    expect(
      cleanRowKey(tx({ date_iso: "2026-10-14", amount_cents: 3500, merchant: "学校食堂" })),
    ).toBe("2026-10-14\u00003500\u0000学校食堂");
  });

  it("字段敏感性：日期 / 金额 / 商户任一不同都不共享键", () => {
    const base = tx({ date_iso: "2026-10-14", amount_cents: 3500, merchant: "学校食堂" });
    const baseKey = cleanRowKey(base);
    expect(
      cleanRowKey(tx({ date_iso: "2026-10-15", amount_cents: 3500, merchant: "学校食堂" })),
    ).not.toBe(baseKey);
    expect(
      cleanRowKey(tx({ date_iso: "2026-10-14", amount_cents: 3501, merchant: "学校食堂" })),
    ).not.toBe(baseKey);
    expect(
      cleanRowKey(tx({ date_iso: "2026-10-14", amount_cents: 3500, merchant: "隔壁食堂" })),
    ).not.toBe(baseKey);
  });
});

describe("mergeCleanBatches（追加合并去重）", () => {
  it("空 existing：incoming 全量新增，顺序保持", () => {
    const incoming = [
      tx({ date_iso: "2026-10-01", amount_cents: 1000, merchant: "食堂A" }),
      tx({ date_iso: "2026-10-02", amount_cents: 2000, merchant: "食堂B" }),
    ];
    const result = mergeCleanBatches([], incoming);
    expect(result.added).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.rows).toEqual(incoming);
  });

  it("全重复：全部计 skipped，行数不增", () => {
    const existing = [tx({ date_iso: "2026-10-01", amount_cents: 1000, merchant: "食堂A" })];
    const incoming = [tx({ date_iso: "2026-10-01", amount_cents: 1000, merchant: "食堂A" })];
    const result = mergeCleanBatches(existing, incoming);
    expect(result).toEqual({ rows: existing, added: 0, skipped: 1 });
  });

  it("部分重复：新增与跳过各计其数，existing 保序在前", () => {
    const existing = [
      tx({ date_iso: "2026-10-01", amount_cents: 1000, merchant: "食堂A" }),
      tx({ date_iso: "2026-10-02", amount_cents: 2000, merchant: "食堂B" }),
    ];
    const incoming = [
      tx({ date_iso: "2026-10-01", amount_cents: 1000, merchant: "食堂A" }), // 重复
      tx({ date_iso: "2026-10-03", amount_cents: 3000, merchant: "食堂C" }), // 新增
    ];
    const result = mergeCleanBatches(existing, incoming);
    expect(result.added).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.rows).toEqual([existing[0], existing[1], incoming[1]]);
  });

  it("批内重复：本批已收键也参与比对，第二笔同键计 skipped", () => {
    const incoming = [
      tx({ date_iso: "2026-10-03", amount_cents: 3000, merchant: "食堂C" }),
      tx({ date_iso: "2026-10-03", amount_cents: 3000, merchant: "食堂C" }),
    ];
    const result = mergeCleanBatches([], incoming);
    expect(result.added).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toBe(incoming[0]);
  });

  it("同日同额不同商户不判重：商户参与键", () => {
    const existing = [tx({ date_iso: "2026-10-14", amount_cents: 3500, merchant: "学校食堂" })];
    const incoming = [tx({ date_iso: "2026-10-14", amount_cents: 3500, merchant: "隔壁食堂" })];
    const result = mergeCleanBatches(existing, incoming);
    expect(result.added).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.rows).toHaveLength(2);
  });

  it("字段敏感性：日期或金额任一不同即不判重", () => {
    const existing = [tx({ date_iso: "2026-10-14", amount_cents: 3500, merchant: "学校食堂" })];
    expect(
      mergeCleanBatches(existing, [
        tx({ date_iso: "2026-10-15", amount_cents: 3500, merchant: "学校食堂" }),
      ]),
    ).toMatchObject({ added: 1, skipped: 0 });
    expect(
      mergeCleanBatches(existing, [
        tx({ date_iso: "2026-10-14", amount_cents: 3000, merchant: "学校食堂" }),
      ]),
    ).toMatchObject({ added: 1, skipped: 0 });
  });

  it("不改入参：existing 与 incoming 原数组保持原样", () => {
    const existing = [tx({ date_iso: "2026-10-01", amount_cents: 1000, merchant: "食堂A" })];
    const incoming = [tx({ date_iso: "2026-10-02", amount_cents: 2000, merchant: "食堂B" })];
    const existingBefore = JSON.stringify(existing);
    const incomingBefore = JSON.stringify(incoming);
    mergeCleanBatches(existing, incoming);
    expect(JSON.stringify(existing)).toBe(existingBefore);
    expect(JSON.stringify(incoming)).toBe(incomingBefore);
  });
});
