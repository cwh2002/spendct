/**
 * 手动记账并入分类预算视图（预算页单一入口，06 §⑥.1 快速记账链路）。
 *
 * 快速记账落在 localStorage 的手动账本与体检账单是两个数据源：图表原来只读
 * 体检账单，入账后数字不动，用户看不到反馈。这里把手动账的支出按类目累加到
 * 「实际」列，图表与总览即时联动；收入不进预算口径（预算只跟踪支出），
 * 由页面的手动记账汇总行单独展示。
 *
 * 口径约定：调用方必须先把外推系数（未来月 9 折递减）乘完再传入，
 * 手动账是真实金额、不做外推；金额一律整数分。
 */

export interface CategoryBudgetRow {
  category: string;
  budgetCents: number;
  actualCents: number;
}

/**
 * 按类目合并手动支出：已有类目累加实际值，预算不动；
 * 手动账出现的新类目补一行（预算 0），保证图表上能看到这笔支出。
 */
export function mergeManualExpenses(
  rows: readonly CategoryBudgetRow[],
  manualByCategory: Readonly<Record<string, number>>,
): CategoryBudgetRow[] {
  const next = rows.map((row) => ({
    ...row,
    actualCents: row.actualCents + (manualByCategory[row.category] ?? 0),
  }));
  for (const [category, cents] of Object.entries(manualByCategory)) {
    if (cents > 0 && !rows.some((row) => row.category === category)) {
      next.push({ category, budgetCents: 0, actualCents: cents });
    }
  }
  return next;
}

/** 手动账本条目（预算页与合并链路共用形状） */
export interface ManualEntry {
  id: string;
  ts: string; // YYYY-MM-DD
  direction: "expense" | "income";
  category: string;
  amountCents: number;
  note: string;
}

/**
 * localStorage 手动账本读取兜底：存储内容不受程序校验约束，可能被手工改坏
 * 或混入旧版本格式。逐条校验、不合格整条丢弃（id 缺失时用位置派生补上，
 * 保证列表 key 唯一），避免脏金额污染图表合并与汇总数字。
 */
export function sanitizeManualEntries(list: unknown): ManualEntry[] {
  if (!Array.isArray(list)) return [];
  const cleaned: ManualEntry[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const raw = item as Record<string, unknown>;
    const ts = typeof raw.ts === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.ts) ? raw.ts : "";
    const direction = raw.direction === "income" || raw.direction === "expense" ? raw.direction : "";
    const category = typeof raw.category === "string" && raw.category.trim() !== "" ? raw.category : "";
    const amountCents = typeof raw.amountCents === "number" && Number.isFinite(raw.amountCents)
      ? raw.amountCents
      : NaN;
    if (!ts || !direction || !category || !(amountCents > 0) || amountCents > 1e9) continue;
    const note = typeof raw.note === "string" ? raw.note.slice(0, 60) : "";
    const id = typeof raw.id === "string" && raw.id !== "" ? raw.id : `${ts}-${cleaned.length}`;
    cleaned.push({ id, ts, direction, category, amountCents, note });
  }
  return cleaned;
}
