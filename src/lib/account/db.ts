import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { BookRecord, PersistedDatasetRecord, SessionRecord, UserRecord } from "./types";

const DB_NAME = "spendct";
// v2（08 修订案 A18）：新增 datasets store——导入的行数据与体检结果落库，
// 供刷新后恢复（users/sessions/books 三表结构与 v1 完全一致）
const DB_VERSION = 2;

interface SpendCtSchema extends DBSchema {
  users: {
    key: string;
    value: UserRecord;
    indexes: { "by-username": string };
  };
  sessions: {
    key: string;
    value: SessionRecord;
    indexes: { "by-userId": string };
  };
  books: {
    key: string;
    value: BookRecord;
    indexes: { "by-userId": string };
  };
  datasets: {
    key: string;
    value: PersistedDatasetRecord;
    indexes: { "by-txHash": string };
  };
}

export type SpendCtDb = IDBPDatabase<SpendCtSchema>;

let dbPromise: Promise<SpendCtDb> | null = null;

/**
 * 获取（或建立）数据库连接。连接在页面生命周期内复用，
 * 避免每个操作都重新走一次 open 握手。
 */
export function openDb(): Promise<SpendCtDb> {
  if (!dbPromise) {
    dbPromise = openDB<SpendCtSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // 首次建库 / 后续版本升级共用；contains 防御性判断，防止升级函数重复建表
        if (!db.objectStoreNames.contains("users")) {
          const users = db.createObjectStore("users", { keyPath: "id" });
          users.createIndex("by-username", "username", { unique: true });
        }
        if (!db.objectStoreNames.contains("sessions")) {
          const sessions = db.createObjectStore("sessions", { keyPath: "id" });
          sessions.createIndex("by-userId", "userId");
        }
        if (!db.objectStoreNames.contains("books")) {
          const books = db.createObjectStore("books", { keyPath: "id" });
          books.createIndex("by-userId", "userId");
        }
        // v2 新增（08 修订案 A18）：按账本存导入数据集，txHash 索引供订阅同步定位
        if (!db.objectStoreNames.contains("datasets")) {
          const datasets = db.createObjectStore("datasets", { keyPath: "bookId" });
          datasets.createIndex("by-txHash", "txHash");
        }
      },
    });
    // 打开失败（如隐私模式禁用 IndexedDB）时清掉缓存，允许后续重试
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

export async function upsertUser(user: UserRecord): Promise<void> {
  const db = await openDb();
  await db.put("users", user);
}

/**
 * 用户名唯一索引查询。调用方传入的 username 会统一转小写，
 * 与注册时的归一化规则保持一致（大小写不敏感）。
 */
export async function getUserByUsername(username: string): Promise<UserRecord | undefined> {
  const db = await openDb();
  return db.getFromIndex("users", "by-username", username.toLowerCase());
}

export async function putSession(session: SessionRecord): Promise<void> {
  const db = await openDb();
  await db.put("sessions", session);
}

export async function getSession(sessionId: string): Promise<SessionRecord | undefined> {
  const db = await openDb();
  return db.get("sessions", sessionId);
}

export async function deleteSession(sessionId: string): Promise<void> {
  const db = await openDb();
  await db.delete("sessions", sessionId);
}

/** 按归属列账本，最近创建的在前。userId 为 null 时返回全部游客账本 */
export async function listBooks(userId: string | null): Promise<BookRecord[]> {
  const db = await openDb();
  if (userId === null) {
    // IndexedDB 索引不接受 null 键，游客账本不会进 by-userId 索引，只能全表过滤
    const all = await db.getAll("books");
    return all.filter((book) => book.userId === null).sort((a, b) => b.createdAt - a.createdAt);
  }
  const books = await db.getAllFromIndex("books", "by-userId", userId);
  return books.sort((a, b) => b.createdAt - a.createdAt);
}

export async function createBook(input: { name: string; userId: string | null }): Promise<BookRecord> {
  const book: BookRecord = {
    id: crypto.randomUUID(),
    name: input.name,
    userId: input.userId,
    createdAt: Date.now(),
    rowCount: 0,
  };
  const db = await openDb();
  await db.put("books", book);
  return book;
}

export async function deleteBook(id: string): Promise<void> {
  const db = await openDb();
  await db.delete("books", id);
}

// ─────────────────────────── 导入数据集（08 修订案 A18） ───────────────────────────

export async function putDataset(record: PersistedDatasetRecord): Promise<void> {
  const db = await openDb();
  await db.put("datasets", record);
}

export async function getDataset(bookId: string): Promise<PersistedDatasetRecord | undefined> {
  const db = await openDb();
  return db.get("datasets", bookId);
}

/** 最近一次导入的数据集记录（刷新恢复的口径：最新导入优先） */
export async function getLatestDataset(): Promise<PersistedDatasetRecord | undefined> {
  const db = await openDb();
  const all = await db.getAll("datasets");
  if (all.length === 0) return undefined;
  return all.reduce((latest, record) => (record.importedAt > latest.importedAt ? record : latest));
}

/** 按数据集指纹定位记录（体检结果订阅同步用） */
export async function getDatasetByTxHash(
  txHash: string,
): Promise<PersistedDatasetRecord | undefined> {
  const db = await openDb();
  return db.getFromIndex("datasets", "by-txHash", txHash);
}

export async function deleteDataset(bookId: string): Promise<void> {
  const db = await openDb();
  await db.delete("datasets", bookId);
}
