import { deleteSession, getSession, getUserByUsername, openDb, upsertUser } from "./db";
import { AccountError, type SessionRecord, type UserRecord } from "./types";

/** PBKDF2 迭代次数：15 万次在主流浏览器约百毫秒级，兼顾强度与登录等待 */
export const PBKDF2_ITERATIONS = 150000;

/** 评审与首次体验用的演示账户，启动时幂等种子 */
export const DEMO_ACCOUNT = {
  username: "demo",
  password: "demo123",
  nickname: "演示账户",
} as const;

/** localStorage 中当前会话 ID 的键名 */
export const SESSION_STORAGE_KEY = "spendct:session";

/** 会话有效期：30 天 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;
const PASSWORD_LETTER_PATTERN = /[a-zA-Z]/;
const PASSWORD_DIGIT_PATTERN = /\d/;

/** 用户名校验：3-20 位小写字母、数字、下划线 */
export function validateUsername(username: string): void {
  if (!USERNAME_PATTERN.test(username)) {
    throw new AccountError("USERNAME_INVALID", "用户名需为 3-20 位小写字母、数字或下划线");
  }
}

/** 密码强度：至少 6 位，且同时包含字母与数字 */
export function validatePassword(password: string): void {
  const strongEnough =
    password.length >= 6 &&
    PASSWORD_LETTER_PATTERN.test(password) &&
    PASSWORD_DIGIT_PATTERN.test(password);
  if (!strongEnough) {
    throw new AccountError("WEAK_PASSWORD", "密码至少 6 位，且需同时包含字母和数字");
  }
}

/** 昵称校验：去首尾空白后 1-16 个字符 */
export function validateNickname(nickname: string): void {
  const trimmed = nickname.trim();
  if (trimmed.length < 1 || trimmed.length > 16) {
    throw new AccountError("NICKNAME_INVALID", "昵称需为 1-16 个字符");
  }
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (hex.length % 2 !== 0) {
    throw new Error("盐的十六进制串长度必须为偶数");
  }
  // 显式 ArrayBuffer 泛型：deriveBits 的 salt 参数要求非 SharedArrayBuffer 视图
  const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    const value = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(value)) {
      throw new Error("盐包含非十六进制字符");
    }
    bytes[i] = value;
  }
  return bytes;
}

/** 创建 16 字节随机盐（hex 编码），每账户独立，避免同密码同哈希 */
function randomSaltHex(): string {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return bytesToHex(salt);
}

/**
 * Web Crypto PBKDF2-SHA256 派生，输出 256 bit hex。
 * 导出供单测用低迭代数验证确定性；业务路径始终传 PBKDF2_ITERATIONS。
 */
export async function hashPassword(password: string, saltHex: string, iterations: number): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(saltHex), iterations },
    keyMaterial,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

/**
 * 建会话：写入 sessions 表并记录当前会话 ID。
 * remember 决定 ID 的存放位置——localStorage 持久（跨标签页与重启有效），
 * sessionStorage 仅当前标签页有效（关页即失效，符合「不记住我」预期）。
 */
export async function createSession(userId: string, remember = true): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("sessions", "readwrite");
  // 一个账户只保留最新会话：先清旧会话，防止表随登录次数膨胀
  const staleKeys = await tx.store.index("by-userId").getAllKeys(userId);
  for (const key of staleKeys) {
    await tx.store.delete(key);
  }
  const session: SessionRecord = {
    id: crypto.randomUUID(),
    userId,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  await tx.store.put(session);
  await tx.done;
  writeSessionId(session.id, remember);
}

export async function registerAccount(input: {
  username: string;
  nickname: string;
  password: string;
}): Promise<UserRecord> {
  const username = input.username.trim().toLowerCase();
  const nickname = input.nickname.trim();
  validateUsername(username);
  validatePassword(input.password);
  validateNickname(nickname);

  const existing = await getUserByUsername(username);
  if (existing) {
    throw new AccountError("USERNAME_TAKEN", "用户名已被占用");
  }

  const salt = randomSaltHex();
  const passwordHash = await hashPassword(input.password, salt, PBKDF2_ITERATIONS);
  const user: UserRecord = {
    id: crypto.randomUUID(),
    username,
    nickname,
    passwordHash,
    salt,
    iterations: PBKDF2_ITERATIONS,
    createdAt: Date.now(),
  };
  await upsertUser(user);
  return user;
}

export async function loginAccount(
  username: string,
  password: string,
  remember = true,
): Promise<UserRecord> {
  const user = await getUserByUsername(username.trim().toLowerCase());
  // 用户不存在与密码错误合并为同一提示，不暴露哪些用户名已注册
  if (!user) {
    throw new AccountError("INVALID_CREDENTIALS", "用户名或密码错误");
  }
  const passwordHash = await hashPassword(password, user.salt, user.iterations);
  if (passwordHash !== user.passwordHash) {
    throw new AccountError("INVALID_CREDENTIALS", "用户名或密码错误");
  }
  await createSession(user.id, remember);
  return user;
}

/**
 * 写入会话 ID：勾选「记住我」持久到 localStorage，否则进 sessionStorage。
 * 写入一侧时清空另一侧，避免 getSessionUser 先命中旧的持久会话而回错账户。
 */
function writeSessionId(sessionId: string, remember: boolean): void {
  try {
    if (remember) {
      localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    } else {
      sessionStorage.setItem(SESSION_STORAGE_KEY, sessionId);
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {
    // 存储不可用（隐私模式）时静默：会话已落 IndexedDB，本次登录由内存状态维持
  }
}

function readSessionId(): string | null {
  // 先查持久档（记住我），再查标签页档（临时会话），与写入侧的优先级一致
  try {
    const remembered = localStorage.getItem(SESSION_STORAGE_KEY);
    if (remembered) {
      return remembered;
    }
  } catch {
    // 隐私模式下 localStorage 读取会抛异常，继续尝试 sessionStorage
  }
  try {
    return sessionStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function removeSessionId(): void {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // 忽略：存储不可用时无会话可清
  }
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // 忽略：同上
  }
}

/**
 * 会话恢复：localStorage/sessionStorage 的会话 ID → 会话表校验（含 30 天过期）→ 取用户。
 * 会话缺失/过期/用户已删时顺带清理，返回 null 表示游客态。
 */
export async function getSessionUser(): Promise<UserRecord | null> {
  const sessionId = readSessionId();
  if (!sessionId) {
    return null;
  }

  const session = await getSession(sessionId);
  if (!session) {
    removeSessionId();
    return null;
  }
  if (session.expiresAt < Date.now()) {
    removeSessionId();
    await deleteSession(session.id).catch(() => undefined);
    return null;
  }

  const db = await openDb();
  const user = await db.get("users", session.userId);
  if (!user) {
    removeSessionId();
    await deleteSession(session.id).catch(() => undefined);
    return null;
  }
  return user;
}

export async function logoutAccount(): Promise<void> {
  const sessionId = readSessionId();
  removeSessionId();
  if (sessionId) {
    await deleteSession(sessionId).catch(() => undefined);
  }
}

/** 幂等种子演示账户：已存在则跳过；失败不阻塞应用启动 */
export async function ensureDemoAccount(): Promise<void> {
  try {
    const existing = await getUserByUsername(DEMO_ACCOUNT.username);
    if (!existing) {
      await registerAccount(DEMO_ACCOUNT);
    }
  } catch {
    // 种子失败（如 IndexedDB 被禁用）不影响注册/登录主流程
  }
}
