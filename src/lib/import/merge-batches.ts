/**
 * 追加导入的合并去重（WP4 §4b）：同一会话内再导第二份账单时，新文件的
 * 清洗行与「最近一次导入的完整行」按 (日期|金额|商户) 三元组比对，
 * 已有行保序在前，新行只追加不重复的，数据集装配按合并后的完整行重建。
 *
 * 键口径与 src/lib/import/parse-csv.ts 的 duplicateKey 完全一致
 * （dateIso\u0000amountCents\u0000merchant）：同一笔交易跨文件重复导入
 * 会命中同一键；本批已收键同样计入比对，批内重复也计 skipped。
 * 纯函数：只吃入参、不改入参、返回新数组，可直接单测。
 */

import type { CleanTransaction } from "@/lib/schema/bill";

/** 行去重键：与 parse-csv 的 duplicateKey 同口径（\u0000 分隔三元组） */
export function cleanRowKey(row: CleanTransaction): string {
  return `${row.date_iso}\u0000${row.amount_cents}\u0000${row.merchant}`;
}

/**
 * 合并两批清洗行：
 * - existing 保持原序在前（旧记录不删，追加导入只增不减）；
 * - incoming 逐行比对 existing 键集 + 本批已收键：
 *   重复（含批内重复）计 skipped、不追加，否则计 added 并追加；
 * - 返回 { rows: 合并后完整行, added: 新增数, skipped: 跳过数 }。
 */
export function mergeCleanBatches(
  existing: readonly CleanTransaction[],
  incoming: readonly CleanTransaction[],
): { rows: CleanTransaction[]; added: number; skipped: number } {
  const seen = new Set<string>();
  const rows: CleanTransaction[] = [];
  for (const row of existing) {
    seen.add(cleanRowKey(row));
    rows.push(row);
  }
  let added = 0;
  let skipped = 0;
  for (const row of incoming) {
    const key = cleanRowKey(row);
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    rows.push(row);
    added += 1;
  }
  return { rows, added, skipped };
}
