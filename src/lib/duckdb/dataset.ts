/**
 * 数据集初始化与 schema 校验（07 §3：唯一事实源 src/lib/schema/bill.ts）。
 *
 * 建库顺序：transactions 表 → 索引 → 批量插入 → 13 视图 → 9 预计算表。
 * 视图之间有依赖（v_health_inputs 依赖 v_impulse_events），
 * 预计算表有依赖（subscription_patterns/attribution_mom_stats/annual_summary 物化视图），
 * 因此一律按 bill.ts 中的定义顺序执行。换数据集前必须 dropDataset 全量清理。
 */
import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";

import {
  PRECOMPUTE_DEFS,
  TRANSACTION_COLUMNS,
  TRANSACTIONS_DDL,
  VIEW_DEFS,
  type CleanTransaction,
} from "@/lib/schema/bill";

/** 单批插入行数（07 §3 导入分批口径） */
const INSERT_BATCH_SIZE = 2000;

/** 02 §5.2 的 4 个索引（依附 transactions，随表一并重建） */
const INDEX_DEFS = [
  "CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date_iso)",
  "CREATE INDEX IF NOT EXISTS idx_tx_category ON transactions(category)",
  "CREATE INDEX IF NOT EXISTS idx_tx_merchant ON transactions(merchant)",
  "CREATE INDEX IF NOT EXISTS idx_tx_account ON transactions(account_id)",
] as const;

/**
 * 参数绑定口径（duckdb-wasm 1.32 实测）：
 * - BIGINT 列不能直接绑 JS number/bigint，一律绑字符串 + SQL 侧 ?::BIGINT 显式转；
 * - TIMESTAMP 列绑 ISO 字符串（引擎可解析）；
 * - JSON 与 VARCHAR[] 列绑 JSON 字符串（如 '["a.csv"]'），null 直绑。
 */
const INSERT_SQL = `INSERT INTO transactions VALUES (${TRANSACTION_COLUMNS.map((col) =>
  col === "amount_cents" ? "?::BIGINT" : "?",
).join(", ")})`;

/** 按 TRANSACTION_COLUMNS 顺序绑定参数 */
function toInsertParams(row: CleanTransaction): unknown[] {
  return [
    row.tx_id,
    row.account_id,
    row.ts,
    row.date_iso,
    String(row.amount_cents),
    row.direction,
    row.merchant,
    row.counterparty,
    row.category,
    row.sub_category,
    row.channel,
    row.status,
    row.external_id,
    row.note,
    row.raw_ref,
    row.source,
    row._meta,
    JSON.stringify(row.imported_files),
  ];
}

/**
 * 建 transactions 表并落数据，随后建 13 视图与 9 预计算表。
 * 幂等：入口先清理旧数据集；空 rows 也照常建 schema（视图基于空表同样可用）。
 * 返回落库后的实际行数。
 */
export async function initDataset(
  conn: AsyncDuckDBConnection,
  rows: CleanTransaction[],
): Promise<{ rowCount: number }> {
  await dropDataset(conn);

  await conn.query(TRANSACTIONS_DDL);
  for (const sql of INDEX_DEFS) {
    await conn.query(sql);
  }

  if (rows.length > 0) {
    const stmt = await conn.prepare(INSERT_SQL);
    try {
      for (let start = 0; start < rows.length; start += INSERT_BATCH_SIZE) {
        const batch = rows.slice(start, start + INSERT_BATCH_SIZE);
        for (const row of batch) {
          await stmt.query(...toInsertParams(row));
        }
      }
    } finally {
      stmt.close();
    }
  }

  // 视图按定义顺序建：v_health_inputs 引用 v_impulse_events，顺序不可调换
  for (const viewSql of Object.values(VIEW_DEFS)) {
    await conn.query(viewSql);
  }
  // 预计算表在视图之后：三张表物化自视图
  for (const tableSql of Object.values(PRECOMPUTE_DEFS)) {
    await conn.query(tableSql);
  }

  const countTable = await conn.query("SELECT COUNT(*) AS n FROM transactions");
  const countRows = await countTable.toArray();
  return { rowCount: Number(countRows[0]?.n ?? 0) };
}

/**
 * 校验数据集 schema 齐全：transactions 表 + 13 视图 + 9 预计算表。
 * 返回缺失关系名清单（空数组 = 齐全）。查 information_schema.tables 对表/视图类型。
 */
export async function verifySchema(conn: AsyncDuckDBConnection): Promise<string[]> {
  const expected: ReadonlyArray<{ name: string; kind: "table" | "view" }> = [
    { name: "transactions", kind: "table" },
    ...Object.keys(VIEW_DEFS).map((name) => ({ name, kind: "view" as const })),
    ...Object.keys(PRECOMPUTE_DEFS).map((name) => ({ name, kind: "table" as const })),
  ];

  const res = await conn.query(
    "SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = 'main'",
  );
  const rows = await res.toArray();
  const found = new Map<string, string>();
  for (const row of rows) {
    found.set(String(row.table_name), String(row.table_type).toUpperCase());
  }

  const missing: string[] = [];
  for (const rel of expected) {
    const expectedType = rel.kind === "view" ? "VIEW" : "BASE TABLE";
    if (found.get(rel.name) !== expectedType) {
      missing.push(rel.name);
    }
  }
  return missing;
}

/** 全量清理本模块建出的关系（换数据集前调用）：9 预计算表 → 13 视图 → transactions */
export async function dropDataset(conn: AsyncDuckDBConnection): Promise<void> {
  for (const name of [...Object.keys(PRECOMPUTE_DEFS)].reverse()) {
    await conn.query(`DROP TABLE IF EXISTS ${name}`);
  }
  for (const name of [...Object.keys(VIEW_DEFS)].reverse()) {
    await conn.query(`DROP VIEW IF EXISTS ${name}`);
  }
  await conn.query("DROP TABLE IF EXISTS transactions");
}
