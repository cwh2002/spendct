/**
 * 追问定向明细检索单测（src/lib/chat/targeted-detail.ts，08 修订案 A15）。
 *
 * 覆盖：
 * 1. buildTargetedDetailPlan 槽位识别：阿拉伯数字 / 中文数字 / 相对月份
 *    （含上上个月与大上个月）、三阶及以上月份与含糊多月说法作废整个计划
 *    （A18 热修复）、「最近三个月/近三个月」映射为显式 90 天日期范围、
 *    年份、深夜关键词、12 类目词表、商户最长匹配（含长度 <2 跳过）、
 *    显式日期范围（A18）；
 * 2. buildTargetedDetailSql：计划全空返回 null、条件拼装、SQL 注入防护
 *    （商户名单含单引号名称、非法月份/年份/类目/超长商户/非法日期范围
 *    不产生非法 SQL）；
 * 3. buildTargetedDetailContext：前缀与行格式、空结果诚实文案、
 *    超长整行截断、执行异常返回空串；
 * 4. planScopeText 范围说明文案、createTargetedDetailRunner 直连执行器接线。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildTargetedDetailContext,
  buildTargetedDetailPlan,
  buildTargetedDetailSql,
  createTargetedDetailRunner,
  planScopeText,
  TARGETED_CONTEXT_MAX_LENGTH,
  type TargetedDetailPlan,
} from "@/lib/chat/targeted-detail";

// ─────────────────────────── 识别计划（buildTargetedDetailPlan） ───────────────────────────

describe("buildTargetedDetailPlan（检索条件识别）", () => {
  beforeEach(() => {
    // 相对月份识别依赖本地时钟，固定到 2026-10-14 保证断言确定
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 14, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("阿拉伯数字月份：「5月」「5月份」「5 月」补零成两位，1-12 之外不命中", () => {
    expect(buildTargetedDetailPlan("5月花了多少", []).month).toBe("05");
    expect(buildTargetedDetailPlan("12月份花了多少", []).month).toBe("12");
    expect(buildTargetedDetailPlan("10月15日", []).month).toBe("10");
    expect(buildTargetedDetailPlan("五月 5 月", []).month).toBe("05");
    expect(buildTargetedDetailPlan("13月花了多少", []).month).toBeNull();
    expect(buildTargetedDetailPlan("5个月花了多少", []).month).toBeNull();
  });

  it("中文数字月份：「一月」到「十二月」全部识别", () => {
    const cases: Array<[string, string]> = [
      ["一月", "01"],
      ["二月", "02"],
      ["三月", "03"],
      ["四月", "04"],
      ["五月", "05"],
      ["六月", "06"],
      ["七月", "07"],
      ["八月", "08"],
      ["九月", "09"],
      ["十月", "10"],
      ["十一月", "11"],
      ["十二月", "12"],
    ];
    for (const [word, mm] of cases) {
      expect(buildTargetedDetailPlan(`${word}花了多少`, []).month, word).toBe(mm);
    }
  });

  it("相对月份：本月/这个月 → 当前月，上月/上个月 → 前一月，上上个月 → 前两月（固定时钟 2026-10）", () => {
    expect(buildTargetedDetailPlan("这个月花了多少", []).month).toBe("10");
    expect(buildTargetedDetailPlan("本月花了多少", []).month).toBe("10");
    expect(buildTargetedDetailPlan("上个月深夜消费", []).month).toBe("09");
    expect(buildTargetedDetailPlan("上月花了多少", []).month).toBe("09");
    // A18：长词先于短词，「上上个月」不再被错配成前一月；
    // 「上上月」「大上月」含子串「上月」、「大上个月」含子串「上个月」，
    // 同样靠先声明 -2 词条取胜
    expect(buildTargetedDetailPlan("上上个月交通花了多少", []).month).toBe("08");
    expect(buildTargetedDetailPlan("上上月交通花了多少", []).month).toBe("08");
    expect(buildTargetedDetailPlan("大上个月交通花了多少", []).month).toBe("08");
    expect(buildTargetedDetailPlan("大上月交通花了多少", []).month).toBe("08");
  });

  it("A18 三阶以上月份与含糊多月说法作废整个计划：全槽位为空（转在线兜底）", () => {
    const empty: TargetedDetailPlan = {
      month: null,
      year: null,
      dateRange: null,
      merchant: null,
      category: null,
      nightOnly: false,
    };
    // 「上上上个月」含子串「上上个月」：弃权守卫先于词表，绝不猜成前两月
    expect(buildTargetedDetailPlan("上上上个月交通花了多少", [])).toEqual(empty);
    expect(buildTargetedDetailPlan("上上上月交通花了多少", [])).toEqual(empty);
    expect(buildTargetedDetailPlan("上两个月交通花了多少", [])).toEqual(empty);
    expect(buildTargetedDetailPlan("前几个月交通花了多少", [])).toEqual(empty);
    // 「前两个月」语义有歧义：一律弃权转在线，不本地猜
    expect(buildTargetedDetailPlan("前两个月交通花了多少", [])).toEqual(empty);
    // 弃权作废整个计划：问题里另有明确月份（阿拉伯数字）也不猜——
    // 只跳过相对词会留下「上上上个月」与「5月」的矛盾，直接转在线兜底
    expect(buildTargetedDetailPlan("上上上个月5月交通花了多少", [])).toEqual(empty);
    // 类目等槽位同样清空：不生成无月份条件的全期明细
    expect(buildTargetedDetailPlan("上上上个月餐饮花了多少", [])).toEqual(empty);
    // 「大上上」变体：与「上上上个月」同样弃权，不被 -2 词条吞成前两月
    expect(buildTargetedDetailPlan("大上上个月交通花了多少", [])).toEqual(empty);
    expect(buildTargetedDetailPlan("大上上月交通花了多少", [])).toEqual(empty);
  });

  it("「最近三个月/近三个月」映射为显式 90 天日期范围（本模块无 90 天窗）", () => {
    // 固定时钟 2026-10-14：范围 = 今天-90天（2026-07-16）起、今天止，
    // 与 qa-engine 的 last_90d 窗口径对齐；类目等其余槽位照常识别
    const plan = buildTargetedDetailPlan("最近三个月交通花了多少", []);
    expect(plan.dateRange).toEqual({ start: "2026-07-16", end: "2026-10-14" });
    expect(plan.month).toBeNull();
    expect(plan.year).toBeNull();
    expect(plan.category).toBe("交通");
    const plan2 = buildTargetedDetailPlan("近三个月餐饮花了多少", []);
    expect(plan2.dateRange).toEqual({ start: "2026-07-16", end: "2026-10-14" });
    expect(plan2.category).toBe("餐饮");
  });

  it("年份识别：只认「YYYY 年」写法，裸数字不误判", () => {
    expect(buildTargetedDetailPlan("2026年5月花了多少", []).year).toBe("2026");
    expect(buildTargetedDetailPlan("2026 年 5 月", []).year).toBe("2026");
    expect(buildTargetedDetailPlan("花了2026元", []).year).toBeNull();
  });

  it("显式日期范围（A18）：识别「YYYY-MM-DD 到 YYYY-MM-DD」，年月槽位让位", () => {
    const plan = buildTargetedDetailPlan("2026-01-01到2026-05-30这段时间的交通费用", []);
    expect(plan.dateRange).toEqual({ start: "2026-01-01", end: "2026-05-30" });
    expect(plan.month).toBeNull();
    expect(plan.year).toBeNull();
    expect(plan.category).toBe("交通");
  });

  it("起止颠倒的日期范围视为无效：不进 SQL，也不影响其他槽位", () => {
    const plan = buildTargetedDetailPlan("2026-05-30到2026-01-01的交通", []);
    expect(plan.dateRange).toBeNull();
    expect(plan.month).toBeNull();
  });

  it("深夜关键词：深夜/半夜/凌晨/夜宵/熬夜 → nightOnly，无关词不命中", () => {
    for (const word of ["深夜", "半夜", "凌晨", "夜宵", "熬夜"]) {
      expect(buildTargetedDetailPlan(`${word}花了什么`, []).nightOnly, word).toBe(true);
    }
    expect(buildTargetedDetailPlan("白天花了多少", []).nightOnly).toBe(false);
  });

  it("12 类目词表：问题里出现类目名即命中", () => {
    const names = [
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
    for (const name of names) {
      expect(buildTargetedDetailPlan(`${name}花了多少`, []).category, name).toBe(name);
    }
    expect(buildTargetedDetailPlan("花了多少", []).category).toBeNull();
  });

  it("商户识别：DB 名单里完整出现在问题中的最长匹配优先，长度 <2 跳过", () => {
    const names = ["蜜雪冰城", "蜜雪", "蜜", "美团外卖"];
    expect(buildTargetedDetailPlan("蜜雪冰城花了多少", names).merchant).toBe("蜜雪冰城");
    expect(buildTargetedDetailPlan("蜜雪花了多少", names).merchant).toBe("蜜雪");
    // 问题里没有商户名 → 不命中
    expect(buildTargetedDetailPlan("外卖花了多少", names).merchant).toBeNull();
  });

  it("空问题 / 无关问题：计划全空（SQL 层返回 null 跳过该段）", () => {
    const plan = buildTargetedDetailPlan("今天天气怎么样", []);
    expect(plan).toEqual({
      month: null,
      year: null,
      dateRange: null,
      merchant: null,
      category: null,
      nightOnly: false,
    });
  });
});

// ─────────────────────────── SQL 生成与注入防护（buildTargetedDetailSql） ───────────────────────────

describe("buildTargetedDetailSql（固定模板 + 参数校验）", () => {
  const emptyPlan: TargetedDetailPlan = {
    month: null,
    year: null,
    dateRange: null,
    merchant: null,
    category: null,
    nightOnly: false,
  };

  it("计划全空返回 null（不生成 SQL）", () => {
    expect(buildTargetedDetailSql(emptyPlan)).toBeNull();
  });

  it("条件组合拼装：月份 / 年份 / 商户 / 类目 / 深夜全部落进 WHERE", () => {
    const sql = buildTargetedDetailSql({
      month: "05",
      year: "2026",
      dateRange: null,
      merchant: "蜜雪冰城",
      category: "餐饮",
      nightOnly: true,
    });
    expect(sql).not.toBeNull();
    expect(sql).toContain("SUBSTR(date_iso, 6, 2) = '05'");
    expect(sql).toContain("date_iso LIKE '2026-%'");
    expect(sql).toContain("merchant = '蜜雪冰城'");
    expect(sql).toContain("category = '餐饮'");
    expect(sql).toContain("EXTRACT(HOUR FROM ts) >= 23");
    expect(sql).toContain("ORDER BY ts DESC");
    expect(sql).toContain("LIMIT 200");
    // 与 A8 快照同口径：只收支行，排除 neutral / refunded
    expect(sql).toContain("direction <> 'neutral' AND status <> 'refunded'");
  });

  it("非法月份不产生非法 SQL：非两位数字 / 注入片段 → 返回 null", () => {
    expect(buildTargetedDetailSql({ ...emptyPlan, month: "5" })).toBeNull();
    expect(buildTargetedDetailSql({ ...emptyPlan, month: "abc" })).toBeNull();
    expect(buildTargetedDetailSql({ ...emptyPlan, month: "05' OR 1=1 --" })).toBeNull();
    expect(
      buildTargetedDetailSql({ ...emptyPlan, month: "05; DROP TABLE transactions" }),
    ).toBeNull();
  });

  it("非法年份不产生非法 SQL：非四位数字 → 返回 null", () => {
    expect(buildTargetedDetailSql({ ...emptyPlan, year: "26" })).toBeNull();
    expect(buildTargetedDetailSql({ ...emptyPlan, year: "20'26" })).toBeNull();
  });

  it("日期范围条件（A18）：双端点校验后落进 WHERE 闭区间", () => {
    const sql = buildTargetedDetailSql({
      ...emptyPlan,
      dateRange: { start: "2026-01-01", end: "2026-05-30" },
    });
    expect(sql).toContain("AND date_iso >= '2026-01-01' AND date_iso <= '2026-05-30'");
  });

  it("非法日期范围不产生非法 SQL：非 ISO 端点 / 起止颠倒 → 返回 null", () => {
    expect(
      buildTargetedDetailSql({
        ...emptyPlan,
        dateRange: { start: "2026-01-01", end: "2026-05-30'; DROP TABLE transactions" },
      }),
    ).toBeNull();
    expect(
      buildTargetedDetailSql({
        ...emptyPlan,
        dateRange: { start: "2026-05-30", end: "2026-01-01" },
      }),
    ).toBeNull();
  });

  it("商户名单含单引号名称：单引号双写转义，不产生可注入的未转义引号", () => {
    const sql = buildTargetedDetailSql({ ...emptyPlan, merchant: "O'Brien茶饮" });
    expect(sql).toContain("merchant = 'O''Brien茶饮'");
    expect(sql).not.toContain("'O'Brien茶饮'");
  });

  it("商户名超长（>60 字）返回 null，不硬拼超长语句", () => {
    expect(buildTargetedDetailSql({ ...emptyPlan, merchant: "长".repeat(61) })).toBeNull();
  });

  it("类目必须是常量词表成员：非成员返回 null", () => {
    expect(buildTargetedDetailSql({ ...emptyPlan, category: "外卖" })).toBeNull();
  });

  it("仅深夜条件也能生成 SQL", () => {
    const sql = buildTargetedDetailSql({ ...emptyPlan, nightOnly: true });
    expect(sql).toContain("AND (EXTRACT(HOUR FROM ts) >= 23 OR EXTRACT(HOUR FROM ts) < 5)");
  });
});

// ─────────────────────────── 上下文文本（buildTargetedDetailContext） ───────────────────────────

describe("buildTargetedDetailContext（定向明细文本块）", () => {
  /** 假明细行：列序与定向明细 SQL / DETAIL_SNAPSHOT_SQL 的 SELECT 顺序一致（7 列） */
  function detailRow(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
    return {
      0: "2026-05-10",
      1: "2026-05-10 23:40:15",
      2: "餐饮",
      3: "蜜雪冰城",
      4: 2560n,
      5: "expense",
      6: 1,
      ...over,
    };
  }

  const plan: TargetedDetailPlan = {
    month: "05",
    year: "2026",
    dateRange: null,
    merchant: null,
    category: null,
    nightOnly: true,
  };
  const runSql = (rows: unknown[]) => async () => rows;

  it("拼「与问题直接相关的明细（范围，共 N 笔）：」前缀 + 明细行（深夜行带标记）", async () => {
    const text = await buildTargetedDetailContext(
      runSql([detailRow(), detailRow({ 0: "2026-05-09", 1: "2026-05-09 12:00:00", 6: 0 })]),
      plan,
    );
    expect(text).toContain("与问题直接相关的明细（2026 年 5 月、深夜，共 2 笔）：");
    expect(text).toContain("2026-05-10 23:40:15 餐饮 蜜雪冰城 支出¥25.60 元（深夜）");
    expect(text).toContain("2026-05-09 12:00:00 餐饮 蜜雪冰城 支出¥25.60 元");
  });

  it("空结果返回诚实空态文案，不假装有数据", async () => {
    const text = await buildTargetedDetailContext(runSql([]), plan);
    expect(text).toBe("本地账单里没有查到与问题直接相关的明细（2026 年 5 月、深夜）。");
  });

  it("日期范围计划的空结果文案与命中前缀（A18）", async () => {
    const rangePlan: TargetedDetailPlan = {
      month: null,
      year: null,
      dateRange: { start: "2026-01-01", end: "2026-05-30" },
      merchant: null,
      category: "交通",
      nightOnly: false,
    };
    const empty = await buildTargetedDetailContext(runSql([]), rangePlan);
    expect(empty).toBe(
      "本地账单里没有查到与问题直接相关的明细（日期 2026-01-01 至 2026-05-30、类目 交通）。",
    );
    const hit = await buildTargetedDetailContext(runSql([detailRow()]), rangePlan);
    expect(hit).toContain(
      "与问题直接相关的明细（日期 2026-01-01 至 2026-05-30、类目 交通，共 1 笔）：",
    );
  });

  it("执行异常返回空串（调用方省略该段）", async () => {
    const text = await buildTargetedDetailContext(
      async () => Promise.reject(new Error("boom")),
      plan,
    );
    expect(text).toBe("");
  });

  it("计划全空不执行查询直接返回空串", async () => {
    const spy = vi.fn<() => Promise<unknown[]>>(async () => []);
    const text = await buildTargetedDetailContext(spy, {
      month: null,
      year: null,
      dateRange: null,
      merchant: null,
      category: null,
      nightOnly: false,
    });
    expect(text).toBe("");
    expect(spy).not.toHaveBeenCalled();
  });

  it("超长按行整条丢弃：200 行长明细最终不超过 2500 字上限", async () => {
    const rows = Array.from({ length: 200 }, (_, i) =>
      detailRow({ 1: `2026-05-${String((i % 28) + 1).padStart(2, "0")} 23:40:15` }),
    );
    const text = await buildTargetedDetailContext(runSql(rows), plan);
    expect(text.length).toBeLessThanOrEqual(TARGETED_CONTEXT_MAX_LENGTH);
    expect(text.startsWith("与问题直接相关的明细（")).toBe(true);
  });
});

// ─────────────────────────── 范围说明与执行器（planScopeText / createTargetedDetailRunner） ───────────────────────────

describe("planScopeText（范围说明文案）", () => {
  const base: TargetedDetailPlan = {
    month: null,
    year: null,
    dateRange: null,
    merchant: null,
    category: null,
    nightOnly: false,
  };

  it("年月组合：2026 年 5 月；单月：5 月；单年：2026 年", () => {
    expect(planScopeText({ ...base, year: "2026", month: "05" })).toBe("2026 年 5 月");
    expect(planScopeText({ ...base, month: "05" })).toBe("5 月");
    expect(planScopeText({ ...base, year: "2026" })).toBe("2026 年");
  });

  it("商户 / 类目 / 深夜组合用顿号连接", () => {
    expect(
      planScopeText({
        ...base,
        year: "2026",
        month: "05",
        merchant: "蜜雪冰城",
        category: "餐饮",
        nightOnly: true,
      }),
    ).toBe("2026 年 5 月、商户 蜜雪冰城、类目 餐饮、深夜");
  });

  it("全空计划范围说明为空串", () => {
    expect(planScopeText(base)).toBe("");
  });

  it("日期范围优先于年月（A18）", () => {
    expect(
      planScopeText({
        ...base,
        dateRange: { start: "2026-01-01", end: "2026-05-30" },
        year: "2026",
        month: "05",
      }),
    ).toBe("日期 2026-01-01 至 2026-05-30");
    expect(
      planScopeText({
        ...base,
        dateRange: { start: "2026-01-01", end: "2026-05-30" },
        category: "交通",
      }),
    ).toBe("日期 2026-01-01 至 2026-05-30、类目 交通");
  });
});

describe("createTargetedDetailRunner（直连执行器接线）", () => {
  it("经注入的连接执行 SQL 并返回 toArray 结果", async () => {
    const rows = [{ ts_text: "2026-05-10 23:40:15" }];
    const fakeConn = {
      query: async (sql: string) => ({ toArray: () => rows, receivedSql: sql }),
    };
    const runner = createTargetedDetailRunner(async () => fakeConn);
    expect(await runner("SELECT 1")).toBe(rows);
  });
});
