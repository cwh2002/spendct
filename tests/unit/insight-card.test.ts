/**
 * 洞察卡契约单测（07 §4 insight-card@v1）。
 *
 * 覆盖：草稿 Schema 逐字段边界（strictObject 拒多余字段）、运行时 Schema
 * cardId 正则 / status / selfCheck / disclaimer 默认值、passesGate 三条闸门
 * 分支，以及 card-factory 组装成功与拒绝两条路径（引擎依赖的 TemplateCardError）。
 */
import { describe, expect, it } from "vitest";

import {
  ChartSpecSchema,
  CitationSchema,
  InsightCardDraftSchema,
  InsightCardSchema,
  passesGate,
  type ChartSpec,
  type InsightCard,
} from "@/lib/schema/insight-card";
import { buildTemplateCard, TemplateCardError } from "@/lib/pipeline/card-factory";
import { makeCardId, sqlCitation } from "@/lib/pipeline/stages/spec";

// ───────────────────────── 合法样本 ─────────────────────────

const LEGAL_CHART: ChartSpec = {
  tableId: "profile_category_stats",
  chartType: "bar",
  title: "近 90 天分类支出排行",
  dimField: "category",
  measureFields: ["expense_cents"],
  sortBy: "desc",
  topN: 8,
};

const LEGAL_STATS = [
  { label: "餐饮", value: "128530", unit: "分" },
  { label: "占比", value: "36.2%" },
];

const LEGAL_DRAFT = {
  stage: "profile" as const,
  headline: "餐饮支出占比 36%，连续三个月高于历史均值",
  narrative: "近 90 天餐饮支出 12.9 万分，占总支出的 36.2%，高于历史均值 8 个百分点，建议核对大额聚餐记录。",
  confidence: 0.82,
  significance: "占比偏离历史均值 1.5 倍标准差",
  evidence: { chart: LEGAL_CHART, stats: LEGAL_STATS },
  sources: [sqlCitation("table", "profile_category_stats")],
};

const LEGAL_CARD: InsightCard = {
  ...LEGAL_DRAFT,
  cardId: "card_profile_2_1",
  status: "published",
  selfCheck: { pass: true, issues: [] },
  actions: ["confirm", "dispute", "drill"],
  disclaimer: "本结论基于账单聚合数据，金额已脱敏，仅供参考",
};

// ───────────────────────── 草稿 Schema ─────────────────────────

describe("InsightCardDraftSchema", () => {
  it("合法草稿通过校验", () => {
    const parsed = InsightCardDraftSchema.parse(LEGAL_DRAFT);
    expect(parsed.stage).toBe("profile");
    expect(parsed.actions).toEqual(["confirm", "dispute", "drill"]);
  });

  it("strictObject 拒绝多余字段（LLM 注入第 2 层闸门）", () => {
    const withExtra = { ...LEGAL_DRAFT, extraField: "x" };
    const verdict = InsightCardDraftSchema.safeParse(withExtra);
    expect(verdict.success).toBe(false);
  });

  it("headline 低于 8 字被拒", () => {
    expect(InsightCardDraftSchema.safeParse({ ...LEGAL_DRAFT, headline: "太短" }).success).toBe(false);
  });

  it("headline 超过 120 字被拒", () => {
    expect(InsightCardDraftSchema.safeParse({ ...LEGAL_DRAFT, headline: "长".repeat(121) }).success).toBe(false);
  });

  it("confidence 超出 0-1 被拒", () => {
    expect(InsightCardDraftSchema.safeParse({ ...LEGAL_DRAFT, confidence: 1.2 }).success).toBe(false);
    expect(InsightCardDraftSchema.safeParse({ ...LEGAL_DRAFT, confidence: -0.1 }).success).toBe(false);
  });

  it("非法 chartType 被拒（七类枚举不扩展）", () => {
    const bad = {
      ...LEGAL_DRAFT,
      evidence: { ...LEGAL_DRAFT.evidence, chart: { ...LEGAL_CHART, chartType: "sankey" } },
    };
    expect(InsightCardDraftSchema.safeParse(bad).success).toBe(false);
  });

  it("stats 为空数组被拒", () => {
    const bad = { ...LEGAL_DRAFT, evidence: { ...LEGAL_DRAFT.evidence, stats: [] } };
    expect(InsightCardDraftSchema.safeParse(bad).success).toBe(false);
  });

  it("sources 超过 3 条被拒", () => {
    const four = [0, 1, 2, 3].map((i) => sqlCitation("table", `t${i}`));
    expect(InsightCardDraftSchema.safeParse({ ...LEGAL_DRAFT, sources: four }).success).toBe(false);
  });

  it("非法 action 枚举被拒", () => {
    expect(InsightCardDraftSchema.safeParse({ ...LEGAL_DRAFT, actions: ["share"] }).success).toBe(false);
  });
});

// ───────────────────────── 运行时 Schema ─────────────────────────

describe("InsightCardSchema", () => {
  it("合法运行时卡通过校验，disclaimer 缺省时套用默认值", () => {
    const parsed = InsightCardSchema.parse({ ...LEGAL_CARD, disclaimer: undefined });
    expect(parsed.disclaimer).toBe("本结论基于账单聚合数据，金额已脱敏，仅供参考");
  });

  it("cardId 正则：stage 前缀限定六阶段 + anchor", () => {
    const good = ["card_clean_1_1", "card_anomaly_3_2", "card_annual_6_3", "card_anchor_0_1"];
    for (const cardId of good) {
      expect(InsightCardSchema.parse({ ...LEGAL_CARD, cardId }).cardId).toBe(cardId);
    }
    const bad = ["card_clean_x_1", "card_clean_1", "card_clean_1_x", "card_summary_1_1"];
    for (const cardId of bad) {
      expect(InsightCardSchema.safeParse({ ...LEGAL_CARD, cardId }).success).toBe(false);
    }
  });

  it("status 非法值被拒", () => {
    expect(InsightCardSchema.safeParse({ ...LEGAL_CARD, status: "archived" }).success).toBe(false);
  });
});

// ───────────────────────── ChartSpec / Citation ─────────────────────────

describe("ChartSpecSchema / CitationSchema", () => {
  it("topN 边界：3-24 通过，2 与 25 被拒", () => {
    expect(ChartSpecSchema.safeParse({ ...LEGAL_CHART, topN: 3 }).success).toBe(true);
    expect(ChartSpecSchema.safeParse({ ...LEGAL_CHART, topN: 24 }).success).toBe(true);
    expect(ChartSpecSchema.safeParse({ ...LEGAL_CHART, topN: 2 }).success).toBe(false);
    expect(ChartSpecSchema.safeParse({ ...LEGAL_CHART, topN: 25 }).success).toBe(false);
  });

  it("citation kind 五类枚举", () => {
    for (const kind of ["sql", "rag", "tool", "rule", "personal"]) {
      expect(CitationSchema.parse({ kind, ref: `x:${kind}` }).kind).toBe(kind);
    }
    expect(CitationSchema.safeParse({ kind: "llm", ref: "x" }).success).toBe(false);
  });
});

// ───────────────────────── passesGate 发布闸门 ─────────────────────────

describe("passesGate", () => {
  it("合规卡通过", () => {
    expect(passesGate(LEGAL_CARD).pass).toBe(true);
  });

  it("selfCheck.pass=false 拦截并带回 issues", () => {
    const card = {
      ...LEGAL_CARD,
      selfCheck: { pass: false, issues: ["统计值全为零，无有效发现"] },
    };
    const verdict = passesGate(card);
    expect(verdict.pass).toBe(false);
    expect(verdict.issues).toContain("统计值全为零，无有效发现");
  });

  it("confidence 低于 0.6 拦截", () => {
    expect(passesGate({ ...LEGAL_CARD, confidence: 0.59 }).pass).toBe(false);
  });

  it("significance 为空拦截", () => {
    expect(passesGate({ ...LEGAL_CARD, significance: "  " }).pass).toBe(false);
  });
});

// ───────────────────────── card-factory 组装 ─────────────────────────

describe("buildTemplateCard", () => {
  it("合法输入产出草稿态运行时卡（actions/disclaimer 由默认补齐）", () => {
    const input = {
      cardId: makeCardId("profile", 1),
      headline: LEGAL_DRAFT.headline,
      narrative: LEGAL_DRAFT.narrative,
      confidence: LEGAL_DRAFT.confidence,
      significance: LEGAL_DRAFT.significance,
      evidence: { chart: LEGAL_CHART, stats: LEGAL_STATS },
      sources: [sqlCitation("table", "profile_category_stats")],
    };
    const card = buildTemplateCard("profile", input);
    expect(card.cardId).toBe("card_profile_2_1");
    expect(card.stage).toBe("profile");
    expect(card.status).toBe("draft");
    expect(card.actions).toEqual(["confirm", "dispute", "drill"]);
    expect(card.disclaimer).toBe("本结论基于账单聚合数据，金额已脱敏，仅供参考");
    // 组装产物必须能过运行时 Schema（引擎 card:complete 事件载荷的校验口径）
    expect(InsightCardSchema.safeParse(card).success).toBe(true);
  });

  it("输入违规抛 TemplateCardError，携带 cardId 与 issue 摘要", () => {
    const input = {
      cardId: makeCardId("profile", 2),
      headline: "太短",
      narrative: LEGAL_DRAFT.narrative,
      confidence: LEGAL_DRAFT.confidence,
      significance: LEGAL_DRAFT.significance,
      evidence: { chart: LEGAL_CHART, stats: LEGAL_STATS },
      sources: [sqlCitation("table", "profile_category_stats")],
    };
    expect(() => buildTemplateCard("profile", input)).toThrow(TemplateCardError);
    try {
      buildTemplateCard("profile", input);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      expect(message).toContain("card_profile_2_2");
      expect(message).toContain("headline");
    }
  });
});
