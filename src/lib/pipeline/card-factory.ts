/**
 * 模板卡组装工厂（07 契约 §4 运行时卡的唯一产出入口）。
 *
 * 数据流：阶段执行器的 buildCardInputs 产出 TemplateCardInput（不含 stage），
 * 引擎把阶段名与本输入一起交给 buildTemplateCard(stage, input)，
 * 本函数合并成运行时卡草稿（status: "draft"）后经两层 Schema 校验：
 *   1. InsightCardDraftSchema 校验草稿字段（strictObject 拒多余字段），
 *      失败抛 TemplateCardError 携带 issues 摘要 —— 引擎按 PARSE_FAILED 降级；
 *   2. InsightCardSchema 校验运行时字段（cardId 正则 / status 枚举）并补齐
 *      disclaimer 默认值 —— 产出即过运行时 Schema，与引擎 card:complete 载荷口径一致。
 * 发布与否由引擎 reflect 闸门决定（07 §20），本工厂只保证「草稿态合法」。
 *
 * 说明：TemplateCardInput 的 ChartSpecInput/CitationInput 是契约 Schema 的结构子集，
 * 直接展开合并即可，无需字段重命名（两处类型由契约 §4 同一份字段表对齐）。
 */
import { InsightCardDraftSchema, InsightCardSchema, type InsightCard } from "@/lib/schema/insight-card";
import type { StageId } from "@/lib/pipeline/stage";

import type { TemplateCardInput } from "./stages/spec";

/** 组装失败时抛出：message 携带 zod issues 摘要，引擎 classifyError 映射 PARSE_FAILED */
export class TemplateCardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateCardError";
  }
}

/**
 * 模板卡输入 → 运行时卡（草稿态）。
 * 默认动作集 ["confirm","dispute","drill"] 与免责声明由契约 Schema 的 default 补齐。
 */
export function buildTemplateCard(stage: StageId, input: TemplateCardInput): InsightCard {
  // 草稿 Schema 不含 cardId/status（运行时字段），先构造草稿字段并校验，再补运行时字段
  const draftOnly = {
    stage,
    headline: input.headline,
    narrative: input.narrative,
    confidence: input.confidence,
    significance: input.significance,
    evidence: {
      chart: input.evidence.chart,
      stats: input.evidence.stats,
    },
    sources: input.sources,
  };
  const verdict = InsightCardDraftSchema.safeParse(draftOnly);
  if (!verdict.success) {
    const issues = verdict.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("；");
    throw new TemplateCardError(`模板卡输入未通过契约校验（cardId=${input.cardId}）：${issues}`);
  }

  // 运行时 Schema 第二层校验：cardId 正则 / status 枚举，并补齐 disclaimer 默认值。
  // cardId 由 makeCardId 生成、status 为常量，此步在实践上只负责应用默认值。
  return InsightCardSchema.parse({
    cardId: input.cardId,
    status: "draft",
    ...verdict.data,
  });
}
