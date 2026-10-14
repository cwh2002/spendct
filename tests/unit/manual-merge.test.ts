/**
 * 手动记账并入分类预算视图的单测（预算页图表联动链路，06 §⑥.1）：
 * 金额一律整数分断言；已有类目累加、新类目补零预算行、预算列不动、空表不报错。
 */
import { describe, expect, it } from "vitest";

import {
  mergeManualExpenses,
  sanitizeManualEntries,
  type CategoryBudgetRow,
} from "@/lib/budget/manual-merge";

describe("mergeManualExpenses（手动支出并入「实际」列）", () => {
  const rows: CategoryBudgetRow[] = [
    { category: "餐饮", budgetCents: 80000, actualCents: 62350 },
    { category: "交通", budgetCents: 20000, actualCents: 15000 },
  ];

  it("已有类目累加实际值，预算不动", () => {
    const result = mergeManualExpenses(rows, { 餐饮: 3000 });
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ category: "餐饮", budgetCents: 80000, actualCents: 65350 });
    expect(result[1]).toEqual({ category: "交通", budgetCents: 20000, actualCents: 15000 });
  });

  it("多类目同时累加", () => {
    const result = mergeManualExpenses(rows, { 餐饮: 3000, 交通: 2350 });
    expect(result.find((r) => r.category === "餐饮")?.actualCents).toBe(65350);
    expect(result.find((r) => r.category === "交通")?.actualCents).toBe(17350);
  });

  it("手动账出现的新类目补一行：预算 0、实际为手动金额", () => {
    const result = mergeManualExpenses(rows, { 其他: 5000 });
    expect(result).toHaveLength(3);
    expect(result.find((r) => r.category === "其他")).toEqual({
      category: "其他",
      budgetCents: 0,
      actualCents: 5000,
    });
  });

  it("金额为 0 的新类目不补行（过滤噪音）", () => {
    const result = mergeManualExpenses(rows, { 其他: 0 });
    expect(result).toHaveLength(2);
    expect(result.some((r) => r.category === "其他")).toBe(false);
  });

  it("空映射返回等值副本，不修改入参", () => {
    const snapshot = JSON.stringify(rows);
    const result = mergeManualExpenses(rows, {});
    expect(result).toEqual(rows);
    expect(JSON.stringify(rows)).toBe(snapshot); // 入参未被就地修改
  });

  it("空行集 + 手动账 → 只有手动类目行", () => {
    const result = mergeManualExpenses([], { 餐饮: 1500, 购物: 2000 });
    expect(result).toHaveLength(2);
    expect(result).toEqual([
      { category: "餐饮", budgetCents: 0, actualCents: 1500 },
      { category: "购物", budgetCents: 0, actualCents: 2000 },
    ]);
  });
});

describe("sanitizeManualEntries（localStorage 脏数据防御）", () => {
  const valid = {
    id: "a1",
    ts: "2026-10-13",
    direction: "expense",
    category: "餐饮",
    amountCents: 1500,
    note: "中午食堂花了 15",
  };

  it("合法条目原样保留", () => {
    expect(sanitizeManualEntries([valid])).toEqual([valid]);
  });

  it("非数组输入返回空数组", () => {
    expect(sanitizeManualEntries(null)).toEqual([]);
    expect(sanitizeManualEntries("oops")).toEqual([]);
    expect(sanitizeManualEntries({ a: 1 })).toEqual([]);
  });

  it("金额脏数据整条丢弃：负值 / 0 / 字符串 / 超上限 / 缺失", () => {
    const dirty = [
      { ...valid, amountCents: -500 },
      { ...valid, amountCents: 0 },
      { ...valid, amountCents: "1500" },
      { ...valid, amountCents: 2e9 },
      { ...valid, amountCents: undefined },
    ];
    expect(sanitizeManualEntries(dirty)).toEqual([]);
  });

  it("日期/方向/类别不合法丢弃；id 缺失用位置派生补上", () => {
    const badDate = { ...valid, ts: "13/10/2026" };
    const badDirection = { ...valid, direction: "transfer" };
    const badCategory = { ...valid, category: "  " };
    const noId = { ...valid, id: undefined };
    const result = sanitizeManualEntries([badDate, badDirection, badCategory, noId]);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("2026-10-13-0");
  });

  it("备注超长截断到 60 字、缺失补空串", () => {
    const longNote = { ...valid, note: "x".repeat(120) };
    const noNote = { ...valid, note: undefined };
    const result = sanitizeManualEntries([longNote, noNote]);
    expect(result).toHaveLength(2);
    expect(result[0]?.note).toHaveLength(60);
    expect(result[1]?.note).toBe("");
  });
});
