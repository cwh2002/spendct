/**
 * 省钱挑战（A17）演示序列单测：
 * 固定种子确定性（同输入同输出）、覆盖 120 天 × 12 类目、
 * 日期键与金额形态合法、日均支出校准在内置账户口径附近。
 */
import { describe, expect, it } from "vitest";

import { generateChallengeDemoRows } from "@/lib/insights/challenge-demo";

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const CATEGORIES_12 = [
  "餐饮",
  "交通",
  "购物",
  "娱乐",
  "居住",
  "通讯",
  "医疗",
  "教育",
  "人情",
  "金融",
  "订阅",
  "其他",
];

describe("generateChallengeDemoRows（演示逐日支出序列）", () => {
  it("固定种子：两次生成逐项一致（可复现的演示动线）", () => {
    expect(generateChallengeDemoRows()).toEqual(generateChallengeDemoRows());
  });

  it("按类目出现概率覆盖 120 天（每天至少一行，总行数在概率和附近）", () => {
    const rows = generateChallengeDemoRows();
    // 12 类出现概率合计 4.09/天 → 期望行数 ≈ 491（不逐类逐天强制出账）
    expect(rows.length).toBeGreaterThan(400);
    expect(rows.length).toBeLessThan(600);
    const days = new Set(rows.map((row) => row.date));
    expect(days.size).toBe(120);
  });

  it("全 12 类目都出现，形态合法（日期键 + 正整数金额）", () => {
    const rows = generateChallengeDemoRows();
    const categories = [...new Set(rows.map((row) => row.category))].sort();
    expect(categories).toEqual([...CATEGORIES_12].sort());
    for (const row of rows) {
      expect(row.date).toMatch(DATE_KEY_RE);
      expect(Number.isInteger(row.cents)).toBe(true);
      expect(row.cents).toBeGreaterThan(0);
      expect(row.cents).toBeLessThanOrEqual(5000);
    }
  });

  it("日均支出校准在内置账户口径附近（约 54 元/天，容差 ±20%）", () => {
    const rows = generateChallengeDemoRows();
    const total = rows.reduce((sum, row) => sum + row.cents, 0);
    const dailyAvg = total / 120;
    expect(dailyAvg).toBeGreaterThan(4500);
    expect(dailyAvg).toBeLessThan(6500);
  });
});
