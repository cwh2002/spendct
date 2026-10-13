import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AccountError,
  type UserRecord,
} from "@/lib/account/types";
import {
  hashPassword,
  loginAccount,
  registerAccount,
  validateNickname,
  validatePassword,
  validateUsername,
} from "@/lib/account/auth";
import { getUserByUsername, upsertUser } from "@/lib/account/db";

// DB 层只做浏览器集成冒烟，单测用 mock 隔离开：本文件只验证纯逻辑与错误码分支
vi.mock("@/lib/account/db", () => ({
  openDb: vi.fn(),
  upsertUser: vi.fn(),
  getUserByUsername: vi.fn(),
  putSession: vi.fn(),
  getSession: vi.fn(),
  deleteSession: vi.fn(),
  listBooks: vi.fn(),
  createBook: vi.fn(),
  deleteBook: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// .rejects 只接受 Promise：同步抛出的校验函数先手动转成拒绝
async function expectAccountError(fn: () => void | Promise<unknown>, code: string) {
  let result: unknown;
  try {
    result = fn();
  } catch (err) {
    result = Promise.reject(err);
  }
  await expect(result).rejects.toMatchObject({ name: "AccountError", code });
}

describe("validateUsername", () => {
  it("接受 3-20 位小写字母、数字、下划线", () => {
    expect(() => validateUsername("abc")).not.toThrow();
    expect(() => validateUsername("a1_")).not.toThrow();
    expect(() => validateUsername("demo_user1")).not.toThrow();
    expect(() => validateUsername("a".repeat(20))).not.toThrow();
  });

  it("拒绝长度越界", () => {
    expect(() => validateUsername("ab")).toThrow(AccountError);
    expect(() => validateUsername("a".repeat(21))).toThrow(AccountError);
  });

  it("拒绝大写、连字符、空格与空串", () => {
    expect(() => validateUsername("Demo")).toThrow(AccountError);
    expect(() => validateUsername("a-b")).toThrow(AccountError);
    expect(() => validateUsername("a b")).toThrow(AccountError);
    expect(() => validateUsername("")).toThrow(AccountError);
  });

  it("失败时携带 USERNAME_INVALID 错误码", async () => {
    await expectAccountError(() => validateUsername("X"), "USERNAME_INVALID");
  });
});

describe("validatePassword", () => {
  it("接受至少 6 位且同时含字母数字的密码", () => {
    expect(() => validatePassword("abc123")).not.toThrow();
    expect(() => validatePassword("p1sssword")).not.toThrow();
    expect(() => validatePassword("1234567a")).not.toThrow();
  });

  it("拒绝过短密码", () => {
    expect(() => validatePassword("abc12")).toThrow(AccountError);
    expect(() => validatePassword("a1")).toThrow(AccountError);
  });

  it("拒绝纯字母或纯数字", () => {
    expect(() => validatePassword("abcdef")).toThrow(AccountError);
    expect(() => validatePassword("123456")).toThrow(AccountError);
  });

  it("失败时携带 WEAK_PASSWORD 错误码", async () => {
    await expectAccountError(() => validatePassword("short"), "WEAK_PASSWORD");
  });
});

describe("validateNickname", () => {
  it("接受去空白后 1-16 字符的昵称", () => {
    expect(() => validateNickname("a")).not.toThrow();
    expect(() => validateNickname(" 演示账户 ")).not.toThrow();
    expect(() => validateNickname("昵".repeat(16))).not.toThrow();
  });

  it("拒绝空串、纯空白与超长", () => {
    expect(() => validateNickname("")).toThrow(AccountError);
    expect(() => validateNickname("   ")).toThrow(AccountError);
    expect(() => validateNickname("昵".repeat(17))).toThrow(AccountError);
  });

  it("失败时携带 NICKNAME_INVALID 错误码", async () => {
    await expectAccountError(() => validateNickname(""), "NICKNAME_INVALID");
  });
});

describe("hashPassword", () => {
  it("相同输入与盐产生确定性结果（登录校验往返）", async () => {
    const salt = "a1".repeat(16);
    const first = await hashPassword("demo123", salt, 100);
    const second = await hashPassword("demo123", salt, 100);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it("盐、密码或迭代次数任一变化则输出变化", async () => {
    const base = await hashPassword("demo123", "a1".repeat(16), 100);
    const otherSalt = await hashPassword("demo123", "b2".repeat(16), 100);
    const otherPassword = await hashPassword("demo124", "a1".repeat(16), 100);
    const otherIterations = await hashPassword("demo123", "a1".repeat(16), 101);
    expect(otherSalt).not.toBe(base);
    expect(otherPassword).not.toBe(base);
    expect(otherIterations).not.toBe(base);
  });
});

describe("AccountError", () => {
  it("保留错误码与提示语，且是标准 Error 子类", () => {
    const err = new AccountError("INVALID_CREDENTIALS", "用户名或密码错误");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("INVALID_CREDENTIALS");
    expect(err.message).toBe("用户名或密码错误");
  });
});

describe("registerAccount（DB 层已 mock）", () => {
  it("重名时抛 USERNAME_TAKEN，且不写库", async () => {
    const taken: UserRecord = {
      id: "u1",
      username: "demo",
      nickname: "旧账户",
      passwordHash: "x",
      salt: "y",
      iterations: 100,
      createdAt: 0,
    };
    vi.mocked(getUserByUsername).mockResolvedValue(taken);

    await expectAccountError(
      () => registerAccount({ username: "demo", nickname: "新账户", password: "abc123" }),
      "USERNAME_TAKEN",
    );
    expect(upsertUser).not.toHaveBeenCalled();
  });

  it("用户名先归一化（去空白+转小写）再查重与存储", async () => {
    vi.mocked(getUserByUsername).mockResolvedValue(undefined);
    vi.mocked(upsertUser).mockResolvedValue(undefined);

    const user = await registerAccount({
      username: "  Demo_User1 ",
      nickname: " 演示账户 ",
      password: "abc123",
    });

    expect(getUserByUsername).toHaveBeenCalledWith("demo_user1");
    expect(user.username).toBe("demo_user1");
    expect(user.nickname).toBe("演示账户");
    expect(user.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(user.passwordHash).toMatch(/^[0-9a-f]{64}$/);
    expect(user.iterations).toBe(150000);
    expect(upsertUser).toHaveBeenCalledWith(user);
  });

  it("校验失败在查重之前抛出", async () => {
    await expectAccountError(
      () => registerAccount({ username: "X", nickname: "ok", password: "abc123" }),
      "USERNAME_INVALID",
    );
    expect(getUserByUsername).not.toHaveBeenCalled();
  });
});

describe("loginAccount（DB 层已 mock）", () => {
  it("用户不存在时抛 INVALID_CREDENTIALS，提示语固定", async () => {
    vi.mocked(getUserByUsername).mockResolvedValue(undefined);

    await expect(
      loginAccount("nobody", "abc123"),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS", message: "用户名或密码错误" });
  });

  it("密码错误时抛 INVALID_CREDENTIALS，与用户不存在同提示", async () => {
    const salt = "a1".repeat(16);
    const passwordHash = await hashPassword("correct1", salt, 100);
    const user: UserRecord = {
      id: "u1",
      username: "demo",
      nickname: "演示账户",
      passwordHash,
      salt,
      iterations: 100,
      createdAt: 0,
    };
    vi.mocked(getUserByUsername).mockResolvedValue(user);

    await expect(
      loginAccount("demo", "wrong1"),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS", message: "用户名或密码错误" });
  });

  it("查询用户名同样归一化为小写", async () => {
    vi.mocked(getUserByUsername).mockResolvedValue(undefined);

    await expect(loginAccount("  DEMO ", "abc123")).rejects.toBeInstanceOf(AccountError);
    expect(getUserByUsername).toHaveBeenCalledWith("demo");
  });
});
