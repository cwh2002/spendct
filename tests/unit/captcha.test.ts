import { describe, expect, it } from "vitest";
import { CAPTCHA_LENGTH, generateCaptchaCode, verifyCaptcha } from "@/lib/auth/captcha";

/**
 * 图形验证码纯函数单测：生成（长度/字符集/随机序列可注入）与校验
 * （通过/大小写不敏感/空白容忍/空输入拒绝/错误拒绝）。
 * drawCaptcha 依赖 canvas 2d 上下文，不在 jsdom 单测覆盖范围，由 e2e 验证码冒烟兜底。
 */

/** 固定序列随机源：全部取 0 → 始终命中字符集首位 */
function seededRandom(): number {
  return 0;
}

describe("generateCaptchaCode", () => {
  it("默认生成 4 位验证码", () => {
    const code = generateCaptchaCode();
    expect(code).toHaveLength(CAPTCHA_LENGTH);
  });

  it("每一位都来自合法字符集（不含 0/O/1/I/L）", () => {
    const charset = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
    for (let i = 0; i < 200; i += 1) {
      const code = generateCaptchaCode();
      for (const ch of code) {
        expect(charset).toContain(ch);
      }
    }
  });

  it("length 参数可定制位数", () => {
    expect(generateCaptchaCode(6)).toHaveLength(6);
  });

  it("随机源可注入：固定 0 时结果恒为字符集首位", () => {
    expect(generateCaptchaCode(4, seededRandom)).toBe("2222");
  });
});

describe("verifyCaptcha", () => {
  it("完全一致时通过", () => {
    expect(verifyCaptcha("AB3K", "AB3K")).toBe(true);
  });

  it("大小写不敏感", () => {
    expect(verifyCaptcha("ab3k", "AB3K")).toBe(true);
    expect(verifyCaptcha("Ab3K", "aB3k")).toBe(true);
  });

  it("容忍首尾空白", () => {
    expect(verifyCaptcha("  AB3K  ", "AB3K")).toBe(true);
  });

  it("空输入拒绝", () => {
    expect(verifyCaptcha("", "AB3K")).toBe(false);
    expect(verifyCaptcha("   ", "AB3K")).toBe(false);
  });

  it("空答案拒绝（防御性处理）", () => {
    expect(verifyCaptcha("AB3K", "")).toBe(false);
  });

  it("错误输入拒绝", () => {
    expect(verifyCaptcha("AB3J", "AB3K")).toBe(false);
    expect(verifyCaptcha("AB3", "AB3K")).toBe(false);
    expect(verifyCaptcha("AB3KK", "AB3K")).toBe(false);
  });
});
