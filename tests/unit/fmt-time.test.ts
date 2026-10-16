/**
 * fmtMonth / fmtDate 时间物化形态归一单测（spec.ts，08 修订案 A15 加固）。
 *
 * 覆盖四种物化形态：Date 对象、epoch 毫秒 number、epoch 微秒 number / bigint、
 * 日期字符串兜底（前 7 / 10 位截断），以及非法值（NaN / Infinity / 超出
 * double 范围的 bigint）回退字符串兜底路径。
 * 阈值口径：1970 年至今的毫秒值在 1e12~1e13 量级，微秒值在 1e14~1e15 量级，
 * 因此绝对值 >1e14 视为微秒（先除 1000 再当毫秒）。
 */
import { describe, expect, it } from "vitest";

import { fmtDate, fmtMonth } from "@/lib/pipeline/stages/spec";

/** 本地时钟的参考时刻（毫秒）：2026-05-15 23:40:15 */
const REF_MS = new Date(2026, 4, 15, 23, 40, 15).getTime();

describe("fmtMonth / fmtDate 物化形态归一", () => {
  it("Date 对象：按本地钟表分量输出 YYYY-MM / YYYY-MM-DD", () => {
    expect(fmtMonth(new Date(2026, 4, 15, 23, 40, 15))).toBe("2026-05");
    expect(fmtDate(new Date(2026, 4, 15, 23, 40, 15))).toBe("2026-05-15");
  });

  it("epoch 毫秒 number（1e12 量级）直接当毫秒", () => {
    expect(fmtMonth(REF_MS)).toBe("2026-05");
    expect(fmtDate(REF_MS)).toBe("2026-05-15");
  });

  it("epoch 微秒 number（>1e14）先除 1000 再当毫秒", () => {
    expect(fmtMonth(REF_MS * 1000)).toBe("2026-05");
    expect(fmtDate(REF_MS * 1000)).toBe("2026-05-15");
  });

  it("epoch 微秒 bigint 先转 number 再除 1000（毫秒 bigint 同理）", () => {
    expect(fmtMonth(BigInt(REF_MS) * 1000n)).toBe("2026-05");
    expect(fmtDate(BigInt(REF_MS) * 1000n)).toBe("2026-05-15");
    expect(fmtMonth(BigInt(REF_MS))).toBe("2026-05");
  });

  it("日期字符串形态：走字符串截断兜底，不误当时间戳", () => {
    expect(fmtMonth("2026-05-15")).toBe("2026-05");
    expect(fmtDate("2026-05-15")).toBe("2026-05-15");
    // 截断兜底：取前 7 / 10 位，多余部分丢弃
    expect(fmtMonth("2026-05-15T23:40:15")).toBe("2026-05");
    expect(fmtDate("2026-05-15T23:40:15")).toBe("2026-05-15");
  });

  it("非法值回退字符串兜底：NaN / Infinity / 非时间值 / null", () => {
    expect(fmtMonth(Number.NaN)).toBe("NaN");
    expect(fmtMonth(Number.POSITIVE_INFINITY)).toBe("Infinit");
    expect(fmtMonth(null)).toBe("");
    expect(fmtDate(undefined)).toBe("");
    expect(fmtMonth("abcdefghij")).toBe("abcdefg");
    expect(fmtDate("abcdefghij")).toBe("abcdefghij");
  });

  it("超出 double 范围的 bigint（Number 转 Infinity）回退字符串兜底，不产生非法日期", () => {
    const huge = 10n ** 1000n; // Number() 转出 Infinity
    const fallback = String(huge).slice(0, 7);
    expect(fmtMonth(huge)).toBe(fallback);
    expect(fmtMonth(huge)).toBe("1000000");
  });

  it("无效 Date 对象回退字符串兜底", () => {
    expect(fmtMonth(new Date(Number.NaN))).toBe("Invalid");
  });
});
