/**
 * 本地账户模式的数据模型与错误类型。
 * 无服务端：账户记录直接存浏览器 IndexedDB，密码只存 PBKDF2 派生哈希。
 */

import type { LastRunSummary } from "@/lib/pipeline/store";
import type { CleanTransaction } from "@/lib/schema/bill";

export interface UserRecord {
  id: string;
  /** 统一小写存储与查询，登录时对输入做同样的归一化 */
  username: string;
  nickname: string;
  /** PBKDF2-SHA256 派生结果，hex 编码（64 字符，256 bit） */
  passwordHash: string;
  /** 16 字节随机盐，hex 编码 */
  salt: string;
  /** 派生时使用的迭代次数，验证时从记录读取，避免未来调整强度后旧账户失效 */
  iterations: number;
  createdAt: number;
}

export interface SessionRecord {
  id: string;
  userId: string;
  createdAt: number;
  /** 超过该时间戳即视为过期，读取时校验 */
  expiresAt: number;
}

export interface BookRecord {
  id: string;
  name: string;
  /** null 表示游客账本（未登录时创建的临时账本） */
  userId: string | null;
  createdAt: number;
  /** 账本内交易行数，供列表页直接展示，避免打开账本才能取到 */
  rowCount: number;
}

/**
 * 刷新恢复用的导入数据集记录（08 修订案 A18）。
 *
 * 修复前行数据只在 DuckDB-WASM 内存库里、体检结果只在管线内存态，
 * 刷新即全丢；A18 起导入时把 18 列清洗行与数据集指纹一并写入 IndexedDB
 * 的 datasets store，体检完成后由浏览器端订阅把 lastRun 同步进来，
 * 页面加载时据此重建（见 src/lib/persistence/pipeline-persistence.ts）。
 * 隐私口径与账本元数据同源：只落浏览器 IndexedDB，绝不上传。
 */
export interface PersistedDatasetRecord {
  /** 与 BookRecord.id 一致：账本删除时联动清除 */
  bookId: string;
  /** 账本展示名（原文件名或示例名） */
  name: string;
  /** 数据集指纹（与管线 store 的 datasetTxHash 同值） */
  txHash: string;
  source: "upload" | "sample";
  importedAt: number;
  rowCount: number;
  /** 18 列清洗行（CleanTransaction）：恢复时整批重放进 DuckDB */
  rows: CleanTransaction[];
  /** 最近一次体检结果：导入时为 null，体检完成后由浏览器端订阅落库 */
  lastRun: LastRunSummary | null;
}

export type AccountErrorCode =
  | "USERNAME_TAKEN"
  | "INVALID_CREDENTIALS"
  | "WEAK_PASSWORD"
  | "USERNAME_INVALID"
  | "NICKNAME_INVALID";

/** 账户流程的统一错误类型：UI 层按 code 分支展示对应提示 */
export class AccountError extends Error {
  readonly code: AccountErrorCode;

  constructor(code: AccountErrorCode, message: string) {
    super(message);
    this.name = "AccountError";
    this.code = code;
  }
}
