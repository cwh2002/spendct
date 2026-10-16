/**
 * 省钱挑战（A17）本地状态层单测（node 环境无 localStorage，只测纯函数）：
 * 打卡/撤销幂等、连续打卡口径（今天没打卡从昨天起算）、逐日状态生成
 * （未来天不生成、挑战结束后最后一天仍计入）、汇总口径（节省只计正贡献、
 * 超支单独累计）与基线计算（开始日前 30 天日均）。
 */
import { describe, expect, it } from "vitest";

import {
  buildChallengeDays,
  checkIn,
  computeBaselineCents,
  streakOf,
  summarizeDays,
  uncheck,
  type ChallengeRecord,
} from "@/lib/insights/challenge-store";

const record = (overrides: Partial<ChallengeRecord> = {}): ChallengeRecord => ({
  category: "餐饮",
  quotaCents: 800,
  baselineCents: 1000,
  startDate: "2026-10-01",
  checkins: [],
  ...overrides,
});

describe("streakOf（连续打卡天数）", () => {
  it("今天没打卡从昨天起算；昨天断档则连续数为 0", () => {
    expect(streakOf([], "2026-10-16")).toBe(0);
    expect(streakOf(["2026-10-16"], "2026-10-16")).toBe(1);
    expect(streakOf(["2026-10-15"], "2026-10-16")).toBe(1);
    expect(streakOf(["2026-10-14", "2026-10-15"], "2026-10-16")).toBe(2);
    expect(streakOf(["2026-10-15", "2026-10-16"], "2026-10-16")).toBe(2);
    expect(streakOf(["2026-10-13", "2026-10-15"], "2026-10-16")).toBe(1);
  });
});

describe("checkIn / uncheck（打卡与撤销）", () => {
  it("checkIn 幂等：同一天重复打卡不产生重复记录", () => {
    const first = checkIn(record(), "2026-10-02");
    expect(first.checkins).toEqual(["2026-10-02"]);
    const again = checkIn(first, "2026-10-02");
    expect(again).toBe(first); // 已打卡直接返回原记录引用
  });

  it("打卡集升序去重；uncheck 只删指定日期，无记录时返回原引用", () => {
    const checked = checkIn(checkIn(record(), "2026-10-03"), "2026-10-01");
    expect(checked.checkins).toEqual(["2026-10-01", "2026-10-03"]);
    expect(uncheck(checked, "2026-10-03").checkins).toEqual(["2026-10-01"]);
    expect(uncheck(checked, "2026-10-09")).toBe(checked);
  });
});

describe("buildChallengeDays（挑战逐日状态）", () => {
  const points = [
    { category: "餐饮", date: "2026-10-01", cents: 700 },
    { category: "餐饮", date: "2026-10-02", cents: 900 },
    { category: "餐饮", date: "2026-10-04", cents: 600 },
    { category: "购物", date: "2026-10-01", cents: 9999 }, // 其他类目不参与
  ];

  it("从开始日生成到今天为止，逐日映射支出/达标/节省", () => {
    const days = buildChallengeDays(
      record({ checkins: ["2026-10-01", "2026-10-03"] }),
      points,
      "2026-10-05",
    );
    expect(days.map((d) => d.date)).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
    ]);
    expect(days[0]).toEqual({
      date: "2026-10-01",
      cents: 700,
      quotaCents: 800,
      checked: true,
      passed: true,
      savedCents: 300,
    });
    expect(days[1]?.cents).toBe(900);
    expect(days[1]?.passed).toBe(false); // 900 > 800 超预算
    expect(days[1]?.checked).toBe(false);
    expect(days[2]?.cents).toBe(0); // 无记录按 0 计
    expect(days[2]?.checked).toBe(true);
    expect(days[2]?.savedCents).toBe(1000); // 0 支出当天全额按基线计
  });

  it("今天晚于第 21 天时生成完整 21 天（结束日仍计入）", () => {
    const days = buildChallengeDays(record(), points, "2026-11-05");
    expect(days).toHaveLength(21);
    expect(days[0]?.date).toBe("2026-10-01");
    expect(days[20]?.date).toBe("2026-10-21");
  });

  it("开始日当天即挑战第 1 天：同一天只生成一天", () => {
    const days = buildChallengeDays(record(), points, "2026-10-01");
    expect(days).toHaveLength(1);
    expect(days[0]?.date).toBe("2026-10-01");
  });
});

describe("summarizeDays（挑战汇总）", () => {
  it("打卡/达标天数与节省口径：节省只计正贡献、超支单独累计", () => {
    const days = buildChallengeDays(
      record({ checkins: ["2026-10-01", "2026-10-03"] }),
      [
        { category: "餐饮", date: "2026-10-01", cents: 700 },
        { category: "餐饮", date: "2026-10-02", cents: 900 },
        { category: "餐饮", date: "2026-10-03", cents: 1300 }, // 超基线 1000
      ],
      "2026-10-03",
    );
    const totals = summarizeDays(days, false);
    expect(totals.checkedDays).toBe(2);
    expect(totals.passedDays).toBe(1);
    expect(totals.savedCents).toBe(300 + 100); // 10-01 与 10-02 的正贡献
    expect(totals.overCents).toBe(300); // 10-03 超基线
    expect(totals.finished).toBe(false);
  });

  it("finished 透传（完成回顾与进行中概览共用同一函数）", () => {
    const totals = summarizeDays([], true);
    expect(totals).toEqual({
      checkedDays: 0,
      passedDays: 0,
      savedCents: 0,
      overCents: 0,
      finished: true,
    });
  });
});

describe("computeBaselineCents（开始日前 30 天日均）", () => {
  it("窗口 [开始日−30, 开始日−1]，窗口外数据不计入", () => {
    const points = [
      { category: "餐饮", date: "2026-09-01", cents: 1000 }, // 窗口内
      { category: "餐饮", date: "2026-09-30", cents: 500 }, // 窗口内
      { category: "餐饮", date: "2026-10-01", cents: 99999 }, // 开始日当天，排除
    ];
    expect(computeBaselineCents(points, "餐饮", "2026-10-01")).toBe(50); // 1500/30
  });

  it("窗口内无记录返回 0（由视图提示「暂无记录」）", () => {
    expect(computeBaselineCents([], "餐饮", "2026-10-01")).toBe(0);
  });
});
