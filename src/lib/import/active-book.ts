/**
 * 导入成功后的账本登记（上传页 → 账户账本列表的桥）。
 *
 * 键的语义与 /me、/settings 已对齐：localStorage 的 spendct:active-book
 * 只存账本 ID（纯字符串）；账本的名称/行数/时间落在 IndexedDB 的
 * BookRecord 里（07 §17 红线：localStorage 不存任何行数据）。
 * 账本记录直接走 account/db 的 openDb 写入：createBook 固定 rowCount=0
 * 且不放行覆盖，导入流程需要在拿到真实行数后一次性落库。
 */
import { openDb } from "@/lib/account/db";
import type { BookRecord } from "@/lib/account/types";

export const ACTIVE_BOOK_KEY = "spendct:active-book";

export interface RegisterImportedBookInput {
  /** 账本展示名（原文件名或示例名） */
  name: string;
  /** 归属用户；游客账本为 null */
  userId: string | null;
  /** 去重后实际导入的行数 */
  rowCount: number;
}

/**
 * 登记一次成功导入：写入账本记录 + 标记为当前激活账本。
 * 任一环节失败只降级（不写登记），不向上抛错——DuckDB 已导入成功，
 * 账本列表缺失一条记录不应阻断「开始体检」。
 * 返回登记成功的 BookRecord（08 修订案 A18：调用方拿它把行数据按 bookId
 * 落进 datasets store）；登记失败返回 null，调用方跳过数据集持久化。
 */
export async function registerImportedBook(
  input: RegisterImportedBookInput,
): Promise<BookRecord | null> {
  const book: BookRecord = {
    id: crypto.randomUUID(),
    name: input.name,
    userId: input.userId,
    createdAt: Date.now(),
    rowCount: input.rowCount,
  };
  try {
    const db = await openDb();
    await db.put("books", book);
  } catch {
    // IndexedDB 不可用（隐私模式等）：账本登记失败，导入本身不受影响
    return null;
  }
  try {
    localStorage.setItem(ACTIVE_BOOK_KEY, book.id);
  } catch {
    // localStorage 不可用时只缺「当前激活账本」标记，账本记录已落库
  }
  return book;
}
