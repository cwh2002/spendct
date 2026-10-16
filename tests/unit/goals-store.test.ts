/**
 * 攒钱目标中心（A17）本地状态层单测（node 环境无 localStorage，只测纯函数）：
 * 目标创建（id/名称/金额/日期形态）、存入追加与删除、已存求和、
 * 达成月估算（向上取整、结余非正不可估算）与月份键工具（加减自然月/月差/展示格式）。
 */
import { describe, expect, it } from "vitest";

import {
  addDeposit,
  addMonths,
  createGoal,
  currentMonthKey,
  formatMonthKey,
  monthsBetween,
  monthsToGoal,
  removeGoal,
  totalSaved,
  type SavingsGoal,
} from "@/lib/insights/goals-store";

const goal = (overrides: Partial<SavingsGoal> = {}): SavingsGoal => ({
  id: "goal-1",
  name: "新键盘",
  targetCents: 50000,
  deadlineMonth: "2027-01",
  createdAt: "2026-10-16",
  deposits: [],
  ...overrides,
});

describe("createGoal（新建目标）", () => {
  it("追加到列表末尾：id 前缀稳定、名称去首尾空白、金额取整、创建日为本地日期键", () => {
    const next = createGoal([goal()], {
      name: "  旅行基金  ",
      targetCents: 123456,
      deadlineMonth: "2027-06",
    });
    expect(next).toHaveLength(2);
    const created = next[1]!;
    expect(created.id.startsWith("goal-")).toBe(true);
    expect(created.name).toBe("旅行基金");
    expect(created.targetCents).toBe(123456);
    expect(created.deposits).toEqual([]);
    expect(created.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("addDeposit / removeGoal / totalSaved", () => {
  it("存入只追加到匹配目标，金额取整，其余目标不动", () => {
    const other = goal({ id: "goal-2" });
    const next = addDeposit([goal(), other], "goal-1", "2026-10-16", 10000);
    expect(next[0]?.deposits).toEqual([{ dateIso: "2026-10-16", cents: 10000 }]);
    expect(next[1]?.deposits).toEqual([]);
  });

  it("删除目标按 id 过滤；已存金额为全部存入之和", () => {
    const withDeposits = goal({
      id: "goal-2",
      deposits: [
        { dateIso: "2026-10-01", cents: 10000 },
        { dateIso: "2026-10-10", cents: 25000 },
      ],
    });
    expect(totalSaved(withDeposits)).toBe(35000);
    expect(removeGoal([goal(), withDeposits], "goal-1")).toEqual([withDeposits]);
  });
});

describe("monthsToGoal（达成还需几个月）", () => {
  it("向上取整：差 1 分也是 1 个月；已达成返回 0", () => {
    expect(monthsToGoal(0, 1000, 300)).toBe(4); // ceil(1000/300)=4
    expect(monthsToGoal(900, 1000, 300)).toBe(1);
    expect(monthsToGoal(1000, 1000, 300)).toBe(0);
  });

  it("结余为 0 或负数无法估算，返回 null", () => {
    expect(monthsToGoal(500, 1000, 0)).toBeNull();
    expect(monthsToGoal(500, 1000, -5)).toBeNull();
  });
});

describe("月份键工具", () => {
  it("addMonths 跨年/回退由 Date 归一", () => {
    expect(addMonths("2026-12", 2)).toBe("2027-02");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-10", 0)).toBe("2026-10");
  });

  it("monthsBetween 按自然月计差，方向反转取负", () => {
    expect(monthsBetween("2026-10", "2027-01")).toBe(3);
    expect(monthsBetween("2027-01", "2026-10")).toBe(-3);
    expect(monthsBetween("2026-10", "2026-10")).toBe(0);
  });

  it("formatMonthKey 输出「YYYY年M月」；currentMonthKey 取本地分量", () => {
    expect(formatMonthKey("2026-10")).toBe("2026年10月");
    expect(currentMonthKey(new Date(2026, 9, 16))).toBe("2026-10");
    expect(currentMonthKey(new Date(2025, 11, 31))).toBe("2025-12");
  });
});
