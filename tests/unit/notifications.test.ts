/**
 * 通知中心派生层单测（F13 规格）。
 *
 * deriveNotifications / buildBudgetSnapshot 都是纯函数（数据全参数注入），
 * 断言不依赖 localStorage 与浏览器环境；时间戳注入固定值，
 * id 的日期分量按本地时区从注入时间构造，时区无关。
 */
import { describe, expect, it } from "vitest";

import {
  buildBudgetSnapshot,
  countUnread,
  deriveNotifications,
  type DeriveNotifInputs,
  type NotifSettings,
} from "@/lib/notifications";
import { DEMO_BUDGET } from "@/lib/demo-data";

const SETTINGS_ALL: NotifSettings = { subDue: true, budgetOver: true, resume: true };

// 用本地分量构造时间戳：id 里取的是本地日期，断言与运行机器时区解耦
const NOW = new Date(2026, 9, 14, 10, 0).getTime(); // 2026-10-14 10:00 本地

function baseInputs(over: Partial<DeriveNotifInputs> = {}): DeriveNotifInputs {
  return {
    subscriptions: [],
    budget: null,
    checkpoint: null,
    settings: SETTINGS_ALL,
    now: NOW,
    ...over,
  };
}

describe("deriveNotifications：订阅扣费临近（规则①）", () => {
  it("nextChargeInDays ≤ 3 触发，聚合为一条且金额合计", () => {
    const items = deriveNotifications(
      baseInputs({
        subscriptions: [
          { id: "s1", amountCents: 1500, nextChargeInDays: 3 },
          { id: "s2", amountCents: 900, nextChargeInDays: 1 },
        ],
      }),
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("sub-due");
    expect(items[0]?.id).toBe("sub-due-2026-10-14");
    expect(items[0]?.body).toContain("2 项订阅");
    expect(items[0]?.body).toContain("24.00"); // 1500+900=2400 分
    expect(items[0]?.body).toContain("1 天"); // 最近的一次
  });

  it("nextChargeInDays = 3 恰好在窗口边界内，4 天不触发", () => {
    const atEdge = deriveNotifications(
      baseInputs({ subscriptions: [{ id: "s1", amountCents: 1500, nextChargeInDays: 3 }] }),
    );
    expect(atEdge.some((i) => i.kind === "sub-due")).toBe(true);

    const outside = deriveNotifications(
      baseInputs({ subscriptions: [{ id: "s1", amountCents: 1500, nextChargeInDays: 4 }] }),
    );
    expect(outside.some((i) => i.kind === "sub-due")).toBe(false);
  });

  it("单项订阅文案走单数口径", () => {
    const items = deriveNotifications(
      baseInputs({ subscriptions: [{ id: "s1", amountCents: 2500, nextChargeInDays: 2 }] }),
    );
    expect(items[0]?.body).toContain("1 项订阅");
    expect(items[0]?.body).toContain("25.00");
  });
});

describe("deriveNotifications：预算使用率（规则②）", () => {
  it("使用率 ≥ 80% 触发（含恰好 80%），低于阈值不触发", () => {
    const atEdge = deriveNotifications(
      baseInputs({ budget: { usedCents: 8000, budgetCents: 10000 } }),
    );
    expect(atEdge.some((i) => i.kind === "budget-over")).toBe(true);

    const below = deriveNotifications(
      baseInputs({ budget: { usedCents: 7999, budgetCents: 10000 } }),
    );
    expect(below.some((i) => i.kind === "budget-over")).toBe(false);
  });

  it("预算快照缺失或预算为 0 时不触发（避免除零与空态误报）", () => {
    expect(deriveNotifications(baseInputs({ budget: null }))).toHaveLength(0);
    expect(
      deriveNotifications(baseInputs({ budget: { usedCents: 100, budgetCents: 0 } })),
    ).toHaveLength(0);
  });

  it("正文包含已用/预算与使用率百分比", () => {
    const items = deriveNotifications(
      baseInputs({ budget: { usedCents: 90000, budgetCents: 100000 } }),
    );
    expect(items[0]?.body).toContain("900.00");
    expect(items[0]?.body).toContain("1000.00");
    expect(items[0]?.body).toContain("90%");
  });
});

describe("deriveNotifications：断点续跑（规则③）", () => {
  it("有断点触发，正文带阶段中文名", () => {
    const items = deriveNotifications(
      baseInputs({ checkpoint: { stage: "annual" } }),
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("resume");
    expect(items[0]?.body).toContain("年度报告");
  });

  it("无断点不触发；未知阶段 id 原样回退", () => {
    expect(deriveNotifications(baseInputs({ checkpoint: null }))).toHaveLength(0);
    const items = deriveNotifications(
      baseInputs({ checkpoint: { stage: "unknown-stage" } }),
    );
    expect(items[0]?.body).toContain("unknown-stage");
  });
});

describe("deriveNotifications：开关与去重", () => {
  it("设置开关关闭时对应规则不触发", () => {
    const inputs = baseInputs({
      subscriptions: [{ id: "s1", amountCents: 1500, nextChargeInDays: 1 }],
      budget: { usedCents: 9000, budgetCents: 10000 },
      checkpoint: { stage: "annual" },
    });

    const offSub = deriveNotifications({
      ...inputs,
      settings: { ...SETTINGS_ALL, subDue: false },
    });
    expect(offSub.some((i) => i.kind === "sub-due")).toBe(false);
    expect(offSub).toHaveLength(2);

    const offBudget = deriveNotifications({
      ...inputs,
      settings: { ...SETTINGS_ALL, budgetOver: false },
    });
    expect(offBudget.some((i) => i.kind === "budget-over")).toBe(false);

    const offResume = deriveNotifications({
      ...inputs,
      settings: { ...SETTINGS_ALL, resume: false },
    });
    expect(offResume.some((i) => i.kind === "resume")).toBe(false);
  });

  it("同一天同一规则只出一条且 id 稳定，跨天出新 id", () => {
    const inputs = baseInputs({
      subscriptions: [
        { id: "s1", amountCents: 1500, nextChargeInDays: 0 },
        { id: "s2", amountCents: 900, nextChargeInDays: 2 },
        { id: "s3", amountCents: 2500, nextChargeInDays: 3 },
      ],
    });
    const first = deriveNotifications(inputs);
    const second = deriveNotifications(inputs);
    expect(first).toEqual(second); // 确定性：同输入同输出
    expect(first.filter((i) => i.kind === "sub-due")).toHaveLength(1);

    const nextDay = deriveNotifications({ ...inputs, now: NOW + 86_400_000 });
    expect(nextDay[0]?.id).toBe("sub-due-2026-10-15");
    expect(nextDay[0]?.id).not.toBe(first[0]?.id);
  });

  it("空输入不产生任何通知", () => {
    expect(deriveNotifications(baseInputs())).toHaveLength(0);
  });
});

describe("countUnread：未读计数", () => {
  const items = [
    { id: "a-2026-10-14", kind: "sub-due" as const, title: "t", body: "b", ts: NOW },
    { id: "b-2026-10-14", kind: "resume" as const, title: "t", body: "b", ts: NOW },
  ];

  it("已读集合差集计数，未知 id 忽略", () => {
    expect(countUnread(items, [])).toBe(2);
    expect(countUnread(items, ["a-2026-10-14"])).toBe(1);
    expect(countUnread(items, ["a-2026-10-14", "b-2026-10-14", "c-other"])).toBe(0);
  });
});

describe("buildBudgetSnapshot：预算快照口径", () => {
  // 本月前缀按运行时刻构造，保证手动记账断言与测试机器日期无关
  const thisMonthPrefix = `${new Date().getFullYear()}-${String(
    new Date().getMonth() + 1,
  ).padStart(2, "0")}`;

  // 期望值从 DEMO_BUDGET 现算而非硬编码：内置数据口径随生成器修订联动，
  // 测试固定断言的是「覆盖替换 / 演示默认命中 / 未知类目取整基线」三条逻辑
  const demoBudgetTotal = DEMO_BUDGET.categories.reduce((sum, c) => sum + c.budgetCents, 0);
  const demoUsedTotal = DEMO_BUDGET.categories.reduce((sum, c) => sum + c.actualCents, 0);
  const foodDefault =
    DEMO_BUDGET.categories.find((c) => c.category === "餐饮")?.budgetCents ?? 0;

  it("demo 动线：演示月支出 + 本地覆盖 + 本月手动记账，收入与上月记账不计", () => {
    const snapshot = buildBudgetSnapshot({
      category90d: null,
      windowMonths: 3,
      overrides: { 餐饮: 100_000 },
      manualEntries: [
        { ts: `${thisMonthPrefix}-05`, direction: "expense", amountCents: 2000 },
        { ts: `${thisMonthPrefix}-06`, direction: "income", amountCents: 5000 },
        { ts: "2026-01-05", direction: "expense", amountCents: 9999 },
        null,
        { direction: "expense", amountCents: 9999 }, // 缺 ts：跳过
      ],
    });
    // 预算 = 演示默认各档合计，餐饮档被覆盖值替换
    expect(snapshot?.budgetCents).toBe(demoBudgetTotal - foodDefault + 100_000);
    // 已用 = 演示类目实际支出合计 + 本月手动支出 2_000（收入与上月记账不计）
    expect(snapshot?.usedCents).toBe(demoUsedTotal + 2000);
  });

  it("真实动线：已知类目命中内置默认档，未知类目按月均取整基线", () => {
    const snapshot = buildBudgetSnapshot({
      // 未知类目刻意取内置 12 类之外的名字：内置档命中与否是这条断言的核心
      category90d: { 餐饮: 90_000, 未知类目: 10_000 },
      windowMonths: 3,
      overrides: {},
      manualEntries: [],
    });
    // 餐饮命中内置默认档；未知类目无默认，基线 = ceil(10_000/3/100)*100 = 3_400
    expect(snapshot?.budgetCents).toBe(foodDefault + 3400);
    expect(snapshot?.usedCents).toBe(Math.round(90_000 / 3) + Math.round(10_000 / 3));
  });

  it("预算合计为 0 时返回 null，规则②不触发", () => {
    const snapshot = buildBudgetSnapshot({
      category90d: {},
      windowMonths: 3,
      overrides: {},
      manualEntries: [],
    });
    expect(snapshot).toBeNull();
  });
});
