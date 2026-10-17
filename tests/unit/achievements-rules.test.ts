/**
 * 成就判定规则（WP8 §8a）单测：
 * 12 枚快照判定徽章每枚覆盖命中/未命中边界（按计划 §8f 的边界对：
 * early-bird 5 点 vs 6 点、streak 6 天 vs 7 天、budget 恰等 vs 超 1 分、
 * saver 4.9% / 恰 5% / 5% 再省 1 分、cleaner 99 vs 100、questioner 9 vs 10、
 * collector 9 vs 10、sub-hunter 90 天 vs 91 天），annual-poster 固定排除；
 * hasSilentSubscription 边界；evaluateAchievements 聚合顺序；
 * recheckAll 组装（存储读取 + overrides 缓存 + 与已解锁集并集写回）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { evaluateAchievements, hasSilentSubscription } from "@/lib/achievements";
import type { AchievementSnapshot, BudgetMonth } from "@/lib/achievements";
import { addDays } from "@/lib/insights/challenge-sql";

const TODAY = "2026-10-17";

/** 快照工厂：默认全零全空（today 固定），测试按需覆盖单个字段 */
function snap(overrides: Partial<AchievementSnapshot>): AchievementSnapshot {
  return {
    today: TODAY,
    checkupCount: 0,
    lastCheckupHour: null,
    silentSubscription: false,
    manualDays: [],
    budgetMonths: [],
    adopted: [],
    monthlyExpenses: [],
    activatedBenefits: 0,
    dedupeSkippedTotal: 0,
    followupCount: 0,
    favoriteCount: 0,
    challengeCheckins: [],
    ...overrides,
  };
}

/** 从 start 起连续 n 天的日期键（含 start），连续类规则造数据用 */
function consecutiveDays(start: string, n: number): string[] {
  const days: string[] = [];
  for (let i = 0; i < n; i += 1) days.push(addDays(start, i));
  return days;
}

/** 预算月工厂：month 为 YYYY-MM */
function budgetMonth(month: string, budgetCents: number, expenseCents: number): BudgetMonth {
  return { month, budgetCents, expenseCents };
}

describe("evaluateAchievements：单规则边界", () => {
  it("first-checkup：0 次不命中", () => {
    expect(evaluateAchievements(snap({}))).not.toContain("first-checkup");
  });

  it("first-checkup：1 次命中（多次同样命中）", () => {
    expect(evaluateAchievements(snap({ checkupCount: 1 }))).toContain("first-checkup");
    expect(evaluateAchievements(snap({ checkupCount: 3 }))).toContain("first-checkup");
  });

  it("early-bird：无体检记录（null）与 6 点不命中", () => {
    expect(evaluateAchievements(snap({}))).not.toContain("early-bird");
    expect(evaluateAchievements(snap({ lastCheckupHour: 6 }))).not.toContain("early-bird");
  });

  it("early-bird：5 点与 0 点命中", () => {
    expect(evaluateAchievements(snap({ lastCheckupHour: 5 }))).toContain("early-bird");
    expect(evaluateAchievements(snap({ lastCheckupHour: 0 }))).toContain("early-bird");
  });

  it("sub-hunter：无沉默订阅标记不命中", () => {
    expect(evaluateAchievements(snap({}))).not.toContain("sub-hunter");
  });

  it("sub-hunter：silentSubscription 标记直接采信", () => {
    expect(evaluateAchievements(snap({ silentSubscription: true }))).toContain("sub-hunter");
  });

  it("streak-7：连续 6 天不命中，7 天命中；7 天到今天不含今天（到昨天）也命中（streakOf 口径）", () => {
    expect(
      evaluateAchievements(snap({ manualDays: consecutiveDays("2026-10-12", 6) })),
    ).not.toContain("streak-7");
    expect(evaluateAchievements(snap({ manualDays: consecutiveDays("2026-10-11", 7) }))).toContain(
      "streak-7",
    );
    expect(evaluateAchievements(snap({ manualDays: consecutiveDays("2026-10-10", 7) }))).toContain(
      "streak-7",
    );
  });

  it("streak-7：中间断档只算最后一段，6 天断档不命中", () => {
    const broken = ["2026-10-10", ...consecutiveDays("2026-10-12", 6)];
    expect(evaluateAchievements(snap({ manualDays: broken }))).not.toContain("streak-7");
    expect(evaluateAchievements(snap({ manualDays: [] }))).not.toContain("streak-7");
  });

  it("budget-master：3 个月全部不超预算命中（含恰等），超 1 分不命中", () => {
    const ok = [
      budgetMonth("2026-07", 1000, 900),
      budgetMonth("2026-08", 1000, 1000),
      budgetMonth("2026-09", 1200, 1000),
    ];
    expect(evaluateAchievements(snap({ budgetMonths: ok }))).toContain("budget-master");
    const over = [
      budgetMonth("2026-07", 1000, 900),
      budgetMonth("2026-08", 1000, 1000),
      budgetMonth("2026-09", 1200, 1201),
    ];
    expect(evaluateAchievements(snap({ budgetMonths: over }))).not.toContain("budget-master");
  });

  it("budget-master：不足 3 个月不命中；4 个月只判最近 3 月（更早超支不翻旧账）", () => {
    expect(
      evaluateAchievements(
        snap({
          budgetMonths: [budgetMonth("2026-08", 1000, 900), budgetMonth("2026-09", 1200, 1000)],
        }),
      ),
    ).not.toContain("budget-master");
    const four = [
      budgetMonth("2026-06", 1000, 1500), // 最旧一月超支
      budgetMonth("2026-07", 1000, 900),
      budgetMonth("2026-08", 1000, 1000),
      budgetMonth("2026-09", 1200, 1000),
    ];
    expect(evaluateAchievements(snap({ budgetMonths: four }))).toContain("budget-master");
    expect(evaluateAchievements(snap({ budgetMonths: [...four].reverse() }))).toContain(
      "budget-master",
    );
  });

  it("night-guard：采纳过 anomaly 卡命中", () => {
    expect(
      evaluateAchievements(
        snap({ adopted: [{ cardId: "c-1", stage: "anomaly", month: "2026-10" }] }),
      ),
    ).toContain("night-guard");
  });

  it("night-guard：普通 stage 或空采纳不命中", () => {
    expect(
      evaluateAchievements(
        snap({ adopted: [{ cardId: "c-1", stage: "spending", month: "2026-10" }] }),
      ),
    ).not.toContain("night-guard");
    expect(evaluateAchievements(snap({}))).not.toContain("night-guard");
  });

  it("saver：下降 4.9% 不命中", () => {
    expect(
      evaluateAchievements(
        snap({
          adopted: [{ cardId: "c-1", stage: "anomaly", month: "2026-08" }],
          monthlyExpenses: [
            { month: "2026-08", expenseCents: 10000 },
            { month: "2026-09", expenseCents: 9510 }, // 下降 4.9%
          ],
        }),
      ),
    ).not.toContain("saver");
  });

  it("saver：恰等 5% 与再省 1 分命中（基线 95% 线含边界，与徽章文案一致）", () => {
    const base = {
      adopted: [{ cardId: "c-1", stage: "anomaly", month: "2026-08" }],
      monthlyExpenses: [
        { month: "2026-08", expenseCents: 10000 },
        { month: "2026-09", expenseCents: 9500 },
      ],
    };
    expect(evaluateAchievements(snap(base))).toContain("saver");
    expect(
      evaluateAchievements(
        snap({
          ...base,
          monthlyExpenses: base.monthlyExpenses.map((m) =>
            m.month === "2026-09" ? { ...m, expenseCents: 9499 } : m,
          ),
        }),
      ),
    ).toContain("saver");
  });

  it("saver：基月缺失回退到采纳月后第一个有数据的月，无晚月不命中", () => {
    // 回退基线 = 2026-09（100），没有更晚的月份 → 不命中
    expect(
      evaluateAchievements(
        snap({
          adopted: [{ cardId: "c-1", stage: "anomaly", month: "2026-08" }],
          monthlyExpenses: [{ month: "2026-09", expenseCents: 100 }],
        }),
      ),
    ).not.toContain("saver");
    // 回退基线 = 2026-09（10000），2026-10 恰省 5% → 命中
    expect(
      evaluateAchievements(
        snap({
          adopted: [{ cardId: "c-1", stage: "anomaly", month: "2026-08" }],
          monthlyExpenses: [
            { month: "2026-09", expenseCents: 10000 },
            { month: "2026-10", expenseCents: 9500 },
          ],
        }),
      ),
    ).toContain("saver");
    // 只有基月一条数据，没有晚于基线月的月份
    expect(
      evaluateAchievements(
        snap({
          adopted: [{ cardId: "c-1", stage: "anomaly", month: "2026-08" }],
          monthlyExpenses: [{ month: "2026-08", expenseCents: 10000 }],
        }),
      ),
    ).not.toContain("saver");
  });

  it("saver：与基线月同月的支出不参与；晚月里有一条达标即命中", () => {
    // 与基线月同月的支出不参与（必须晚于基线月）
    expect(
      evaluateAchievements(
        snap({
          adopted: [{ cardId: "c-1", stage: "anomaly", month: "2026-08" }],
          monthlyExpenses: [
            { month: "2026-08", expenseCents: 10000 },
            { month: "2026-08", expenseCents: 100 },
          ],
        }),
      ),
    ).not.toContain("saver");
    // 晚月里有一条超一条达标：存在即命中
    expect(
      evaluateAchievements(
        snap({
          adopted: [{ cardId: "c-1", stage: "anomaly", month: "2026-08" }],
          monthlyExpenses: [
            { month: "2026-08", expenseCents: 10000 },
            { month: "2026-09", expenseCents: 12000 },
            { month: "2026-10", expenseCents: 9000 },
          ],
        }),
      ),
    ).toContain("saver");
    expect(evaluateAchievements(snap({}))).not.toContain("saver");
  });

  it("scholar：0 不命中", () => {
    expect(evaluateAchievements(snap({}))).not.toContain("scholar");
  });

  it("scholar：1 命中", () => {
    expect(evaluateAchievements(snap({ activatedBenefits: 1 }))).toContain("scholar");
  });

  it("cleaner：99 条不命中", () => {
    expect(evaluateAchievements(snap({ dedupeSkippedTotal: 99 }))).not.toContain("cleaner");
  });

  it("cleaner：100 条命中", () => {
    expect(evaluateAchievements(snap({ dedupeSkippedTotal: 100 }))).toContain("cleaner");
  });

  it("questioner：9 次不命中", () => {
    expect(evaluateAchievements(snap({ followupCount: 9 }))).not.toContain("questioner");
  });

  it("questioner：10 次命中", () => {
    expect(evaluateAchievements(snap({ followupCount: 10 }))).toContain("questioner");
  });

  it("collector：9 张不命中", () => {
    expect(evaluateAchievements(snap({ favoriteCount: 9 }))).not.toContain("collector");
  });

  it("collector：10 张命中", () => {
    expect(evaluateAchievements(snap({ favoriteCount: 10 }))).toContain("collector");
  });

  it("challenge-streak：连续 6 天不命中；断档不命中", () => {
    expect(
      evaluateAchievements(snap({ challengeCheckins: consecutiveDays("2026-10-12", 6) })),
    ).not.toContain("challenge-streak");
    const broken = ["2026-10-10", ...consecutiveDays("2026-10-12", 6)];
    expect(evaluateAchievements(snap({ challengeCheckins: broken }))).not.toContain(
      "challenge-streak",
    );
  });

  it("challenge-streak：连续 7 天命中；到昨天为止的 7 天也命中（streakOf 口径）", () => {
    expect(
      evaluateAchievements(snap({ challengeCheckins: consecutiveDays("2026-10-11", 7) })),
    ).toContain("challenge-streak");
    expect(
      evaluateAchievements(snap({ challengeCheckins: consecutiveDays("2026-10-10", 7) })),
    ).toContain("challenge-streak");
  });
});

describe("hasSilentSubscription：沉默订阅扣费序列", () => {
  it("少于 2 条没有间隔可言，一律 false", () => {
    expect(hasSilentSubscription([])).toBe(false);
    expect(hasSilentSubscription(["2026-01-01"])).toBe(false);
  });

  it("相邻间隔恰好 90 天不命中，91 天命中", () => {
    expect(hasSilentSubscription(["2026-01-01", "2026-04-01"])).toBe(false);
    expect(hasSilentSubscription(["2026-01-01", "2026-04-02"])).toBe(true);
  });

  it("乱序输入按日期排序后再判；多处扣费里有一处超过 90 天即命中", () => {
    expect(hasSilentSubscription(["2026-09-01", "2026-01-01", "2026-05-01"])).toBe(true);
    expect(hasSilentSubscription(["2026-09-01", "2026-07-01", "2026-05-01"])).toBe(false);
  });

  it("三条扣费：全部间隔 ≤90 天不命中，末段间隔 91 天命中", () => {
    expect(hasSilentSubscription(["2026-01-01", "2026-03-01", "2026-05-01"])).toBe(false);
    expect(hasSilentSubscription(["2026-01-01", "2026-03-01", "2026-06-01"])).toBe(true);
  });
});

describe("evaluateAchievements：聚合与顺序", () => {
  it("全满快照命中全部 12 枚，按 defs 顺序且不含 annual-poster", () => {
    const allHit = snap({
      checkupCount: 1,
      lastCheckupHour: 5,
      silentSubscription: true,
      manualDays: consecutiveDays("2026-10-11", 7),
      budgetMonths: [
        budgetMonth("2026-07", 1000, 900),
        budgetMonth("2026-08", 1000, 1000),
        budgetMonth("2026-09", 1200, 1000),
      ],
      adopted: [{ cardId: "c-1", stage: "anomaly", month: "2026-07" }],
      monthlyExpenses: [
        { month: "2026-07", expenseCents: 10000 },
        { month: "2026-09", expenseCents: 9000 },
      ],
      activatedBenefits: 1,
      dedupeSkippedTotal: 100,
      followupCount: 10,
      favoriteCount: 10,
      challengeCheckins: consecutiveDays("2026-10-11", 7),
    });
    expect(evaluateAchievements(allHit)).toEqual([
      "first-checkup",
      "sub-hunter",
      "streak-7",
      "budget-master",
      "early-bird",
      "night-guard",
      "saver",
      "scholar",
      "cleaner",
      "questioner",
      "collector",
      "challenge-streak",
    ]);
  });

  it("空快照一枚不中；只中一枚时只返回该 id", () => {
    expect(evaluateAchievements(snap({}))).toEqual([]);
    expect(evaluateAchievements(snap({ manualDays: consecutiveDays("2026-10-11", 7) }))).toEqual([
      "streak-7",
    ]);
  });
});

/* ---- recheckAll 组装：node 环境无真实存储，用 stub 模拟浏览器 localStorage ---- */

/** node 单测环境下的浏览器存储桩：window 使存储层进入浏览器分支，localStorage 落 Map */
function stubBrowserStorage(seed: Record<string, string>): Map<string, string> {
  const store = new Map(Object.entries(seed));
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
  return store;
}

/**
 * 重新装载 achievements 模块图：sync 的模块级 lastOverrides 缓存会跨用例残留，
 * 每个存储相关用例都拿一份全新模块实例，避免上一个用例的 overrides 污染
 * 下一个用例的存储读取断言。
 */
async function loadFreshAchievements() {
  vi.resetModules();
  return import("@/lib/achievements");
}

describe("recheckAll：组装 → 判定 → 并集写回", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("node 环境无存储：返回命中集（写入静默失败，不抛异常）", async () => {
    const { recheckAll } = await loadFreshAchievements();
    expect(recheckAll(snap({ manualDays: consecutiveDays("2026-10-11", 7) }))).toEqual([
      "streak-7",
    ]);
  });

  it("与已解锁集取并集写回；无新增时不改写存储", async () => {
    const { recheckAll } = await loadFreshAchievements();
    const store = stubBrowserStorage({
      "spendct:achievements:v1": JSON.stringify(["first-checkup"]),
    });
    expect(recheckAll(snap({ manualDays: consecutiveDays("2026-10-11", 7) }))).toEqual([
      "first-checkup",
      "streak-7",
    ]);
    expect(store.get("spendct:achievements:v1")).toBe(
      JSON.stringify(["first-checkup", "streak-7"]),
    );
    // 再次重算同一快照：并集不变，存储内容原样
    const before = store.get("spendct:achievements:v1");
    expect(recheckAll(snap({ manualDays: consecutiveDays("2026-10-11", 7) }))).toEqual([
      "first-checkup",
      "streak-7",
    ]);
    expect(store.get("spendct:achievements:v1")).toBe(before);
  });

  it("overrides 合并进缓存：无参 recheckAll 复用上一次的视图数据", async () => {
    const { recheckAll } = await loadFreshAchievements();
    expect(recheckAll(snap({ favoriteCount: 10 }))).toEqual(["collector"]);
    expect(recheckAll()).toEqual(["collector"]);
  });
});

describe("buildSnapshotFromStorage：存储字段组装与覆盖", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("存储侧字段从 localStorage 组装：体检次数/小时、手动账日期（expense 去重）、挑战打卡", async () => {
    const { buildSnapshotFromStorage } = await loadFreshAchievements();
    stubBrowserStorage({
      "spendct:checkup-count:v1": "3",
      "spendct:last-checkup-hour:v1": "5",
      "spendct:manual-entries": JSON.stringify([
        {
          id: "m1",
          ts: "2026-10-17",
          direction: "expense",
          category: "餐饮",
          amountCents: 2500,
          note: "",
        },
        {
          id: "m2",
          ts: "2026-10-17",
          direction: "expense",
          category: "交通",
          amountCents: 800,
          note: "",
        },
        {
          id: "m3",
          ts: "2026-10-16",
          direction: "income",
          category: "收入",
          amountCents: 8000,
          note: "",
        },
        {
          id: "m4",
          ts: "2026-10-15",
          direction: "expense",
          category: "餐饮",
          amountCents: 1200,
          note: "",
        },
      ]),
      "spendct:challenge:v1": JSON.stringify({
        category: "餐饮",
        quotaCents: 2000,
        baselineCents: 2500,
        startDate: "2026-10-01",
        checkins: ["2026-10-11", "2026-10-12", "2026-10-13"],
      }),
    });
    const snapshot = buildSnapshotFromStorage({ today: TODAY });
    expect(snapshot.checkupCount).toBe(3);
    expect(snapshot.lastCheckupHour).toBe(5);
    expect(snapshot.manualDays).toEqual(["2026-10-15", "2026-10-17"]);
    expect(snapshot.challengeCheckins).toEqual(["2026-10-11", "2026-10-12", "2026-10-13"]);
    // overrides 优先于存储：显式传入的体检次数直接生效
    expect(buildSnapshotFromStorage({ today: TODAY, checkupCount: 7 }).checkupCount).toBe(7);
  });

  it("进度存储读进快照；存储缺失/损坏回退零值", async () => {
    const { buildSnapshotFromStorage } = await loadFreshAchievements();
    const store = stubBrowserStorage({
      "spendct:achievement-progress:v1": JSON.stringify({
        adopted: [{ cardId: "c-9", stage: "anomaly", month: "2026-09" }],
        activatedBenefits: 2,
        dedupeSkippedTotal: 30,
        followupCount: 4,
      }),
      "spendct:checkup-count:v1": "{broken json",
      "spendct:last-checkup-hour:v1": "null",
    });
    const snapshot = buildSnapshotFromStorage({ today: TODAY });
    expect(snapshot.adopted).toEqual([{ cardId: "c-9", stage: "anomaly", month: "2026-09" }]);
    expect(snapshot.activatedBenefits).toBe(2);
    expect(snapshot.dedupeSkippedTotal).toBe(30);
    expect(snapshot.followupCount).toBe(4);
    expect(snapshot.checkupCount).toBe(0);
    expect(snapshot.lastCheckupHour).toBeNull();
    // 空存储：全部回退零值，不抛异常
    store.clear();
    const empty = buildSnapshotFromStorage({ today: TODAY });
    expect(empty.checkupCount).toBe(0);
    expect(empty.lastCheckupHour).toBeNull();
    expect(empty.manualDays).toEqual([]);
    expect(empty.challengeCheckins).toEqual([]);
  });
});
