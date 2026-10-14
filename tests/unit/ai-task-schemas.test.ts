/**
 * 四个结构化任务 zod 输出结构的单测（07 §12 A5 契约逐字验收）：
 * 合法输出通过、缺字段/类型错误/枚举越界/超长/多余键拒绝；
 * 另含「mock 兜底形状能被 schema 解析」一组——保证 live 失败回落模板时前端零改动。
 */
import { describe, expect, it } from "vitest";

import { mockBudgetAdvice, mockForecastNarrative, mockTips } from "@/lib/llm/mock-narratives";
import { BudgetAdviceSchema } from "@/lib/schema/budget-advice";
import { ForecastNarrativeSchema } from "@/lib/schema/forecast-narrative";
import { QuickEntrySchema } from "@/lib/schema/quick-entry";
import { TipPersonalizeSchema } from "@/lib/schema/tip-personalize";

describe("QuickEntrySchema（08 §⑥.1）", () => {
  it("完整可解析输出通过：1500 分 / 支出 / 餐饮 / 商户 / 时间 / 备注", () => {
    const result = QuickEntrySchema.safeParse({
      parseable: true,
      entry: {
        amountCents: 1500,
        direction: "expense",
        category: "餐饮",
        merchant: "食堂",
        ts: "2026-10-13T12:00:00Z",
        note: "午饭",
      },
    });
    expect(result.success).toBe(true);
  });

  it("最小可解析输出通过（商户/时间/备注可缺省）", () => {
    expect(
      QuickEntrySchema.safeParse({
        parseable: true,
        entry: { amountCents: 400, direction: "expense", category: "交通" },
      }).success,
    ).toBe(true);
  });

  it("不可解析输出通过：parseable=false + reason", () => {
    expect(
      QuickEntrySchema.safeParse({ parseable: false, reason: "没识别出金额" }).success,
    ).toBe(true);
  });

  it("缺 parseable 拒绝", () => {
    expect(
      QuickEntrySchema.safeParse({
        entry: { amountCents: 100, direction: "expense", category: "其他" },
      }).success,
    ).toBe(false);
  });

  it("金额必须是整数分：小数拒绝", () => {
    expect(
      QuickEntrySchema.safeParse({
        parseable: true,
        entry: { amountCents: 15.5, direction: "expense", category: "餐饮" },
      }).success,
    ).toBe(false);
  });

  it("金额必须为正整数：0、负数、超上限拒绝，1e9 分恰好通过", () => {
    const entry = (amountCents: number) => ({
      parseable: true,
      entry: { amountCents, direction: "expense" as const, category: "餐饮" as const },
    });
    expect(QuickEntrySchema.safeParse(entry(0)).success).toBe(false);
    expect(QuickEntrySchema.safeParse(entry(-100)).success).toBe(false);
    expect(QuickEntrySchema.safeParse(entry(1e9 + 1)).success).toBe(false);
    expect(QuickEntrySchema.safeParse(entry(1e9)).success).toBe(true);
  });

  it("方向枚举越界拒绝", () => {
    expect(
      QuickEntrySchema.safeParse({
        parseable: true,
        entry: { amountCents: 100, direction: "transfer", category: "餐饮" },
      }).success,
    ).toBe(false);
  });

  it("类目不在 12 类字典拒绝", () => {
    expect(
      QuickEntrySchema.safeParse({
        parseable: true,
        entry: { amountCents: 100, direction: "expense", category: "未知类目" },
      }).success,
    ).toBe(false);
  });

  it("reason 超 60 字拒绝", () => {
    expect(QuickEntrySchema.safeParse({ parseable: false, reason: "长".repeat(61) }).success).toBe(
      false,
    );
  });

  it("多余键拒绝（strictObject）", () => {
    expect(QuickEntrySchema.safeParse({ parseable: true, extra: 1 }).success).toBe(false);
  });

  it("parseable 非布尔拒绝", () => {
    expect(QuickEntrySchema.safeParse({ parseable: "true", reason: "x" }).success).toBe(false);
  });
});

describe("BudgetAdviceSchema（08 §⑥.2）", () => {
  it("完整合法输出通过", () => {
    expect(
      BudgetAdviceSchema.safeParse({
        severity: "warn",
        headline: "餐饮已用 87%，临近警戒线",
        advice: "剩余额度要撑未来 5 天，外卖频次收一收。",
        actions: ["view_detail"],
      }).success,
    ).toBe(true);
  });

  it("actions 为空数组通过（ok 档不触发动作）", () => {
    expect(
      BudgetAdviceSchema.safeParse({
        severity: "ok",
        headline: "节奏健康",
        advice: "不用调整",
        actions: [],
      }).success,
    ).toBe(true);
  });

  it("severity 枚举越界拒绝", () => {
    expect(
      BudgetAdviceSchema.safeParse({
        severity: "critical",
        headline: "x",
        advice: "y",
        actions: [],
      }).success,
    ).toBe(false);
  });

  it("headline 超 60 字拒绝", () => {
    expect(
      BudgetAdviceSchema.safeParse({
        severity: "ok",
        headline: "长".repeat(61),
        advice: "y",
        actions: [],
      }).success,
    ).toBe(false);
  });

  it("advice 超 160 字拒绝", () => {
    expect(
      BudgetAdviceSchema.safeParse({
        severity: "ok",
        headline: "x",
        advice: "长".repeat(161),
        actions: [],
      }).success,
    ).toBe(false);
  });

  it("actions 最多 2 项：3 项拒绝", () => {
    expect(
      BudgetAdviceSchema.safeParse({
        severity: "over",
        headline: "x",
        advice: "y",
        actions: ["adjust_budget", "view_detail", "dismiss"],
      }).success,
    ).toBe(false);
  });

  it("actions 取值越界拒绝", () => {
    expect(
      BudgetAdviceSchema.safeParse({
        severity: "ok",
        headline: "x",
        advice: "y",
        actions: ["other"],
      }).success,
    ).toBe(false);
  });

  it("缺字段拒绝", () => {
    expect(BudgetAdviceSchema.safeParse({ severity: "ok", headline: "x" }).success).toBe(false);
  });
});

describe("ForecastNarrativeSchema（08 §⑥.3）", () => {
  it("合法输出通过", () => {
    expect(
      ForecastNarrativeSchema.safeParse({
        headline: "餐饮下月预计环比 +8%",
        narrative: "近三月逐月走高，按朴素外推下月继续上行。",
        disclaimer: "朴素季节外推，仅作参考，不构成建议",
      }).success,
    ).toBe(true);
  });

  it("disclaimer 改写拒绝（literal 逐字）", () => {
    expect(
      ForecastNarrativeSchema.safeParse({
        headline: "x",
        narrative: "y",
        disclaimer: "仅供参考，不构成建议",
      }).success,
    ).toBe(false);
  });

  it("narrative 超 300 字拒绝", () => {
    expect(
      ForecastNarrativeSchema.safeParse({
        headline: "x",
        narrative: "长".repeat(301),
        disclaimer: "朴素季节外推，仅作参考，不构成建议",
      }).success,
    ).toBe(false);
  });

  it("headline 超 60 字拒绝", () => {
    expect(
      ForecastNarrativeSchema.safeParse({
        headline: "长".repeat(61),
        narrative: "y",
        disclaimer: "朴素季节外推，仅作参考，不构成建议",
      }).success,
    ).toBe(false);
  });

  it("缺 disclaimer 拒绝", () => {
    expect(ForecastNarrativeSchema.safeParse({ headline: "x", narrative: "y" }).success).toBe(
      false,
    );
  });
});

describe("TipPersonalizeSchema（08 §⑥.4）", () => {
  it("3 条贴士合法输出通过", () => {
    expect(
      TipPersonalizeSchema.safeParse({
        tips: [
          { caseId: "case-1", why: "外卖占你餐饮的一半，先凑满减" },
          { caseId: "case-2", why: "深夜点单多，改白天囤货" },
          { caseId: "case-3", why: "多项自动续费，年付更省" },
        ],
      }).success,
    ).toBe(true);
  });

  it("条数不是 3 拒绝（2 条与 4 条）", () => {
    const tip = { caseId: "case-1", why: "适配理由" };
    expect(TipPersonalizeSchema.safeParse({ tips: [tip, tip] }).success).toBe(false);
    expect(TipPersonalizeSchema.safeParse({ tips: [tip, tip, tip, tip] }).success).toBe(false);
  });

  it("why 超 40 字拒绝", () => {
    expect(
      TipPersonalizeSchema.safeParse({
        tips: [
          { caseId: "case-1", why: "长".repeat(41) },
          { caseId: "case-2", why: "适配理由" },
          { caseId: "case-3", why: "适配理由" },
        ],
      }).success,
    ).toBe(false);
  });

  it("caseId 缺失拒绝", () => {
    expect(
      TipPersonalizeSchema.safeParse({
        tips: [
          { why: "适配理由" },
          { caseId: "case-2", why: "适配理由" },
          { caseId: "case-3", why: "适配理由" },
        ],
      }).success,
    ).toBe(false);
  });

  it("外层多余键拒绝（strictObject）", () => {
    expect(TipPersonalizeSchema.safeParse({ tips: [], extra: 1 }).success).toBe(false);
  });
});

describe("mock 兜底形状与 schema 对齐（live 失败回落时前端零改动）", () => {
  it("mockBudgetAdvice 三档输出都能被 BudgetAdviceSchema 解析", () => {
    for (const ratio of [0.5, 0.85, 1.1]) {
      const parsed = BudgetAdviceSchema.safeParse(mockBudgetAdvice(ratio));
      expect(parsed.success, `ratio=${ratio}`).toBe(true);
    }
  });

  it("mockForecastNarrative 三档输出都能被 ForecastNarrativeSchema 解析", () => {
    for (const trend of ["up", "down", "flat"] as const) {
      const parsed = ForecastNarrativeSchema.safeParse(mockForecastNarrative(trend));
      expect(parsed.success, `trend=${trend}`).toBe(true);
    }
  });

  it("mockTips 输出能被 TipPersonalizeSchema 解析（有候选与缺省占位 id 两种）", () => {
    expect(TipPersonalizeSchema.safeParse(mockTips(["a", "b", "c"])).success).toBe(true);
    expect(TipPersonalizeSchema.safeParse(mockTips([])).success).toBe(true);
  });
});
