/**
 * SQL 聚合白名单单测（06 §2.0 W1D1 验收 + 02 §6 R1-R10）。
 * 恶意样本必须全部拒绝，合法聚合必须通过——预检结果只允许出现文档定义的 7 个原因码。
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_AGGREGATE_POLICY,
  precheckAggregateSql,
  runWhitelistedAggregate,
  WhitelistRejectedError,
} from "@/lib/sql-guard/whitelist";
import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";

/** 返回固定行数的假连接：单测不加载真实 wasm，只验证白名单校验与行数复检逻辑 */
function fakeConn(rows: unknown[]): AsyncDuckDBConnection {
  return {
    query: async () => ({ toArray: async () => rows }),
  } as unknown as AsyncDuckDBConnection;
}

describe("恶意样本拒绝（02 §6 R1-R5）", () => {
  it("拒绝没有 GROUP BY 的聚合（R1）", () => {
    const v = precheckAggregateSql("SELECT SUM(amount_cents) FROM transactions");
    expect(v).toEqual({ ok: false, reason: "NO_GROUP_BY" });
  });

  it("拒绝 SELECT *（R2）", () => {
    const v = precheckAggregateSql("SELECT * FROM v_monthly_summary");
    expect(v).toEqual({ ok: false, reason: "SELECT_STAR" });
  });

  it("拒绝明细列投影：SELECT 出现非分组键列（R3）", () => {
    const v = precheckAggregateSql(
      "SELECT category, merchant FROM transactions GROUP BY category",
    );
    expect(v).toEqual({ ok: false, reason: "DETAIL_COLUMN" });
  });

  it("拒绝 DDL：DROP TABLE（R4）", () => {
    const v = precheckAggregateSql("DROP TABLE transactions");
    expect(v).toEqual({ ok: false, reason: "BANNED_KEYWORD" });
  });

  it("拒绝写操作：DELETE / UPDATE / INSERT", () => {
    expect(precheckAggregateSql("DELETE FROM transactions WHERE status = 'refunded'")).toEqual({
      ok: false,
      reason: "BANNED_KEYWORD",
    });
    expect(precheckAggregateSql("UPDATE transactions SET note = 'x'")).toEqual({
      ok: false,
      reason: "BANNED_KEYWORD",
    });
    expect(precheckAggregateSql("INSERT INTO transactions VALUES (1)")).toEqual({
      ok: false,
      reason: "BANNED_KEYWORD",
    });
  });

  it("拒绝 PRAGMA（R4）", () => {
    const v = precheckAggregateSql("PRAGMA table_info(transactions)");
    expect(v).toEqual({ ok: false, reason: "BANNED_KEYWORD" });
  });

  it("拒绝子查询（R5）", () => {
    const v = precheckAggregateSql(
      "SELECT category, SUM(amount_cents) FROM transactions " +
        "WHERE amount_cents > (SELECT AVG(amount_cents) FROM transactions) GROUP BY category",
    );
    expect(v).toEqual({ ok: false, reason: "UNSUPPORTED_SYNTAX" });
  });

  it("拒绝多语句", () => {
    const v = precheckAggregateSql(
      "SELECT category, COUNT(*) FROM transactions GROUP BY category; SELECT 1",
    );
    expect(v).toEqual({ ok: false, reason: "UNSUPPORTED_SYNTAX" });
  });

  it("拒绝 UNION / JOIN / WITH（R5）", () => {
    expect(
      precheckAggregateSql(
        "SELECT category FROM transactions GROUP BY category UNION SELECT category FROM budgets GROUP BY category",
      ),
    ).toEqual({ ok: false, reason: "UNSUPPORTED_SYNTAX" });
    expect(
      precheckAggregateSql(
        "SELECT t.category, SUM(t.amount_cents) FROM transactions t JOIN budgets b ON t.category = b.category GROUP BY t.category",
      ),
    ).toEqual({ ok: false, reason: "UNSUPPORTED_SYNTAX" });
    expect(
      precheckAggregateSql("WITH x AS (SELECT 1) SELECT category FROM x GROUP BY category"),
    ).toEqual({ ok: false, reason: "UNSUPPORTED_SYNTAX" });
  });

  it("拒绝身份列出现在任何位置（02 §6.2）", () => {
    expect(
      precheckAggregateSql("SELECT tx_id, COUNT(*) FROM transactions GROUP BY tx_id"),
    ).toEqual({ ok: false, reason: "UNSUPPORTED_SYNTAX" });
    expect(
      precheckAggregateSql(
        "SELECT category, SUM(amount_cents) FROM transactions WHERE note = '红包' GROUP BY category",
      ),
    ).toEqual({ ok: false, reason: "UNSUPPORTED_SYNTAX" });
  });

  it("拒绝非白名单关系", () => {
    const v = precheckAggregateSql("SELECT id, COUNT(*) FROM secrets GROUP BY id");
    expect(v).toEqual({ ok: false, reason: "PARSE_ERROR" });
  });

  it("拒绝 LIMIT 超过上限（R6）", () => {
    const v = precheckAggregateSql(
      "SELECT category, COUNT(*) FROM transactions GROUP BY category LIMIT 100",
    );
    expect(v).toEqual({ ok: false, reason: "ROW_LIMIT_EXCEEDED" });
  });

  it("拒绝 LIKE / IN / 算术表达式（窄文法之外一律拒绝）", () => {
    expect(
      precheckAggregateSql(
        "SELECT category, COUNT(*) FROM transactions WHERE merchant LIKE '%瑞幸%' GROUP BY category",
      ),
    ).toEqual({ ok: false, reason: "UNSUPPORTED_SYNTAX" });
    expect(
      precheckAggregateSql(
        "SELECT category, COUNT(*) FROM transactions WHERE category IN ('餐饮', '交通') GROUP BY category",
      ),
    ).toEqual({ ok: false, reason: "UNSUPPORTED_SYNTAX" });
    expect(
      precheckAggregateSql(
        "SELECT category, SUM(amount_cents / 100) FROM transactions GROUP BY category",
      ),
    ).toEqual({ ok: false, reason: "UNSUPPORTED_SYNTAX" });
  });

  it("字符串字面量里的关键字不触发黑名单（整词扫描只针对标识符）", () => {
    const v = precheckAggregateSql(
      "SELECT category, COUNT(*) FROM transactions WHERE category = 'DROP' GROUP BY category",
    );
    expect(v.ok).toBe(true);
  });
});

describe("合法聚合通过（06 §2.0 白名单示例形态）", () => {
  it("六阶段标准形态：分组键 + 聚合 + WHERE + ORDER BY + LIMIT", () => {
    const v = precheckAggregateSql(
      "SELECT category, SUM(amount_cents), COUNT(*) FROM transactions " +
        "WHERE direction = 'expense' GROUP BY category ORDER BY SUM(amount_cents) DESC LIMIT 10",
    );
    expect(v).toEqual({ ok: true });
  });

  it("HAVING 聚合过滤（含 COUNT(*)）", () => {
    const v = precheckAggregateSql(
      "SELECT merchant, COUNT(*) FROM transactions GROUP BY merchant HAVING COUNT(*) > 2",
    );
    expect(v).toEqual({ ok: true });
  });

  it("三列 GROUP BY 达到上限仍放行", () => {
    const v = precheckAggregateSql(
      "SELECT year, month, category, SUM(amount_cents) FROM v_monthly_summary GROUP BY year, month, category",
    );
    expect(v).toEqual({ ok: true });
  });

  it("预计算表与预算三表在白名单内（A2）", () => {
    expect(
      precheckAggregateSql("SELECT ym, SUM(amount_cents) FROM budget_vs_actual GROUP BY ym"),
    ).toEqual({ ok: true });
    expect(
      precheckAggregateSql("SELECT category, AVG(amount_cents) FROM profile_category_stats GROUP BY category"),
    ).toEqual({ ok: true });
    expect(
      precheckAggregateSql("SELECT ym, SUM(amount_cents) FROM forecast_monthly GROUP BY ym"),
    ).toEqual({ ok: true });
  });

  it("ROUND 双参数与大小写混写均放行", () => {
    const v = precheckAggregateSql(
      "select category, round(avg(amount_cents), 2) from transactions group by category",
    );
    expect(v).toEqual({ ok: true });
  });

  it("MEDIAN / STDDEV / MODE 白名单聚合可用", () => {
    const v = precheckAggregateSql(
      "SELECT category, MEDIAN(amount_cents), STDDEV(amount_cents), MODE(amount_cents) FROM transactions GROUP BY category",
    );
    expect(v).toEqual({ ok: true });
  });

  it("policy 覆盖收紧 maxGroupByCols 后四列分组被拒", () => {
    const v = precheckAggregateSql(
      "SELECT year, month, category, channel, SUM(amount_cents) FROM transactions GROUP BY year, month, category, channel",
      { maxGroupByCols: 3 },
    );
    expect(v).toEqual({ ok: false, reason: "UNSUPPORTED_SYNTAX" });
  });
});

describe("runWhitelistedAggregate 执行与行数复检（R6）", () => {
  it("通过预检后执行并返回结果与耗时", async () => {
    const rows = [{ category: "餐饮", total: 12345 }];
    const conn = fakeConn(rows);
    const result = await runWhitelistedAggregate(
      conn,
      "SELECT category, SUM(amount_cents) FROM transactions GROUP BY category",
    );
    expect(result.rowCount).toBe(1);
    expect(result.rows).toEqual(rows);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("预检不通过时直接抛 WhitelistRejectedError 且不执行 SQL", async () => {
    let executed = false;
    const conn = {
      query: async () => {
        executed = true;
        return { toArray: async () => [] };
      },
    } as unknown as AsyncDuckDBConnection;
    await expect(
      runWhitelistedAggregate(conn, "SELECT SUM(amount_cents) FROM transactions"),
    ).rejects.toThrow(WhitelistRejectedError);
    expect(executed).toBe(false);
  });

  it("执行后行数超过上限二次校验拒绝（R6）", async () => {
    const conn = fakeConn(Array.from({ length: 51 }, () => ({ k: 1 })));
    await expect(
      runWhitelistedAggregate(
        conn,
        "SELECT category, COUNT(*) FROM transactions GROUP BY category",
      ),
    ).rejects.toThrow(WhitelistRejectedError);
  });

  it("默认策略参数与契约一致（06 §2.0）", () => {
    expect(DEFAULT_AGGREGATE_POLICY).toEqual({
      maxResultRows: 50,
      maxGroupByCols: 3,
      allowedAggFns: [
        "COUNT",
        "SUM",
        "AVG",
        "MIN",
        "MAX",
        "STDDEV",
        "MEDIAN",
        "MODE",
        "ROUND",
      ],
      bannedKeywords: [
        "DELETE",
        "INSERT",
        "UPDATE",
        "DROP",
        "ALTER",
        "CREATE",
        "PRAGMA",
        "ATTACH",
        "DETACH",
        "COPY",
        "EXPORT",
        "IMPORT",
        "VACUUM",
        "REINDEX",
      ],
      maxSqlLength: 4000,
    });
  });
});
