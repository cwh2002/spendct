/**
 * 本地账户模式的数据模型与错误类型。
 * 无服务端：账户记录直接存浏览器 IndexedDB，密码只存 PBKDF2 派生哈希。
 */

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
