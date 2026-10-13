/**
 * DuckDB-WASM 浏览器单例服务（T2×T1 集成，07 契约 §8 加载方式）。
 *
 * 三个硬约束：
 * 1. 只允许动态 import：@duckdb/duckdb-wasm 包体大且强依赖 Worker/WebAssembly，
 *    静态 import 会让 SSR 与首包直接失败。调用方（上传页）用 next/dynamic 的
 *    ssr:false 包裹组件，或在用户交互事件里触发 getDuckDB()；本模块禁止被
 *    server component / route handler 引用；
 * 2. 单例连接：wasm 实例化是秒级开销，同一页面生命周期复用一条连接。
 *    dbPromise 缓存的是 Promise 本身，并发调用只会初始化一次；
 * 3. 与 spike 同源同路径：/duckdb/ 自托管产物 + mvp 包 + pthreadWorker:null
 *    （无 COOP/COEP 头时的单线程模式），基准数字见 docs/benchmarks.md。
 */
import type { AsyncDuckDB, AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";

/** 注册进虚拟文件系统的固定文件名（内存缓冲，不落盘） */
const CSV_FILE_NAME = "spendct.csv";

/** 表名白名单：值来自调用方，进 SQL 前必须校验，只允许纯小写字母与下划线 */
const TABLE_NAME_PATTERN = /^[a-z_]{1,40}$/;

let dbPromise: Promise<AsyncDuckDBConnection> | null = null;

/** 实例单独保存：连接的 close 不等于 worker 销毁，terminate 需要 AsyncDuckDB 实例 */
let dbInstance: AsyncDuckDB | null = null;

async function initDuckDB(): Promise<AsyncDuckDBConnection> {
  const duckdb = await import("@duckdb/duckdb-wasm");
  // 只声明 mvp：selectBundle 返回的 bundle 即
  // { mainModule, mainWorker, pthreadWorker: null }，与 public/spike/duckdb-wasm 一致
  const bundle = await duckdb.selectBundle({
    mvp: {
      mainModule: "/duckdb/duckdb-mvp.wasm",
      mainWorker: "/duckdb/duckdb-browser-mvp.worker.js",
    },
  });
  if (!bundle.mainWorker) {
    throw new Error("当前浏览器不支持 DuckDB Worker 加载");
  }
  const worker = new Worker(bundle.mainWorker);
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  try {
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    const conn = await db.connect();
    dbInstance = db;
    return conn;
  } catch (err) {
    // 实例化失败必须回收 worker，否则每次重试都泄漏一个线程
    await db.terminate().catch(() => {});
    throw err;
  }
}

/** 获取单例连接。初始化失败时 dbPromise 复位，允许下次调用重试（网络抖动场景） */
export function getDuckDB(): Promise<AsyncDuckDBConnection> {
  if (!dbPromise) {
    dbPromise = initDuckDB().catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

/** 销毁单例（worker 一并 terminate）。销毁后旧连接全部失效，须重新 getDuckDB() */
export async function closeDuckDB(): Promise<void> {
  if (dbPromise) {
    try {
      await dbPromise;
    } catch {
      // 初始化本身失败时没有可销毁的实例
    }
  }
  dbPromise = null;
  const db = dbInstance;
  dbInstance = null;
  if (db) {
    try {
      await db.terminate();
    } catch {
      // worker 已被浏览器回收时忽略
    }
  }
}

export interface ImportBillCsvInput {
  csvText: string;
  tableName: string;
}

export interface ImportBillCsvResult {
  rowCount: number;
  columns: string[];
}

/**
 * 把标准列 CSV 导入为 DuckDB 表（CREATE OR REPLACE，重复导入天然幂等）。
 * 表名是调用方给的动态值，必须过白名单正则再拼 SQL（防注入）；
 * 建出的表结构 = buildCleanCsv 的 6 个标准列，白名单聚合可直接引用
 * （表名 transactions 时命中 ALLOWED_RELATIONS，07 §6）。
 */
export async function importBillCsv(
  conn: AsyncDuckDBConnection,
  input: ImportBillCsvInput,
): Promise<ImportBillCsvResult> {
  if (!TABLE_NAME_PATTERN.test(input.tableName)) {
    throw new Error(`非法表名「${input.tableName}」：仅允许 [a-z_]，长度 1-40`);
  }

  // registerFileText 挂在 bindings（AsyncDuckDB）上，不在连接对象上
  await conn.bindings.registerFileText(CSV_FILE_NAME, input.csvText);

  // read_csv_auto 自动推断列类型；标准 CSV 自带表头，header=true 与 spike 相同
  await conn.query(
    `CREATE OR REPLACE TABLE ${input.tableName} AS SELECT * FROM read_csv_auto('${CSV_FILE_NAME}', header = true)`,
  );

  const countTable = await conn.query(`SELECT COUNT(*) AS row_count FROM ${input.tableName}`);
  const countRows = await countTable.toArray();
  const rowCount = Number(countRows[0]?.row_count ?? 0);

  const describeTable = await conn.query(`DESCRIBE ${input.tableName}`);
  const describeRows = await describeTable.toArray();
  const columns = describeRows.map((row) => String(row.column_name));

  return { rowCount, columns };
}
