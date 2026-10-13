/**
 * 洞察卡 JSON Schema —— 全仓唯一事实来源（07 契约 §4，insight-card@v1）。
 *
 * 草稿与运行时卡同文件定义：草稿形态取 03 CardDraft，运行时字段取 02 §2.6，
 * confidence 统一 0-1 数值（禁用 high|medium|low 枚举）。
 * 草稿用 z.strictObject：LLM 输出多出的字段直接被拒（注入第 2 层闸门）。
 * 管线引擎产出卡经 buildTemplateCard 组装（见 src/lib/pipeline/card-factory.ts），
 * 发布闸门 passesGate 与引擎 reflect 自检口径一致（07 §20）。
 */
import { z } from "zod";

import { SIX_STAGES } from "@/lib/pipeline/stage";

/** 图表规格：只声明「哪张表 + 哪种图 + 哪个维度」（模板优先，七类枚举不扩展） */
export const ChartSpecSchema = z.object({
  tableId: z.string(),
  chartType: z.enum(["bar", "line", "pie", "histogram", "scatter", "heatmap", "table"]),
  title: z.string().min(1).max(40),
  dimField: z.string(),
  measureFields: z.array(z.string()).min(1).max(2),
  sortBy: z.enum(["desc", "asc"]).optional(),
  topN: z.number().int().min(3).max(24).optional(),
  note: z.string().max(60).optional(),
});

/** 来源引用（kind 枚举与 ref 格式唯一口径） */
export const CitationSchema = z.object({
  kind: z.enum(["sql", "rag", "tool", "rule", "personal"]),
  ref: z.string(), // sql:${table|view}:${tableId} / rag:${caseId} / tool:${toolName} / rule:${ruleId} / personal:${anomalyId}
  meta: z
    .object({
      source: z.string().optional(),
      version: z.string().optional(),
      updatedAt: z.string().optional(),
    })
    .optional(),
});

/** LLM 输出层（草稿） */
export const InsightCardDraftSchema = z.strictObject({
  stage: z.enum(SIX_STAGES),
  headline: z.string().min(8).max(120),
  narrative: z.string().min(8).max(600),
  confidence: z.number().min(0).max(1),
  significance: z.string().max(40),
  evidence: z.object({
    chart: ChartSpecSchema,
    stats: z
      .array(
        z.object({
          label: z.string().max(20),
          value: z.string().max(20),
          unit: z.string().max(6).optional(),
        }),
      )
      .min(1)
      .max(4),
  }),
  sources: z.array(CitationSchema).min(1).max(3),
  actions: z.array(z.enum(["confirm", "dispute", "drill", "fix"])).default(["confirm", "dispute", "drill"]),
});

/** 运行时卡 = 草稿 + 运行时字段（cardId 格式为全仓唯一口径） */
export const InsightCardSchema = InsightCardDraftSchema.extend({
  cardId: z.string().regex(/^card_(clean|profile|anomaly|subscription|attribution|annual|anchor)_\d+_\d+$/),
  status: z.enum(["draft", "published", "withheld"]),
  selfCheck: z
    .object({
      pass: z.boolean(),
      issues: z.array(z.string()),
      revisedConfidence: z.number().optional(),
    })
    .optional(),
  disclaimer: z.string().default("本结论基于账单聚合数据，金额已脱敏，仅供参考"),
});

export type InsightCardDraft = z.infer<typeof InsightCardDraftSchema>;
export type InsightCard = z.infer<typeof InsightCardSchema>;
export type ChartSpec = z.infer<typeof ChartSpecSchema>;
export type Citation = z.infer<typeof CitationSchema>;

/**
 * 发布闸门（07 §20 唯一口径）：selfCheck.pass && confidence≥0.6 && 显著性达标。
 * 引擎在 reflect 阶段调用的自检是同一套规则（confidence/证据行数/统计值/长度），
 * 本函数为外部消费方（页面/测试）提供无副作用的口径判断。
 */
export function passesGate(card: InsightCard): { pass: boolean; issues: string[] } {
  const issues: string[] = [];
  if (card.selfCheck && card.selfCheck.pass === false) {
    issues.push(...card.selfCheck.issues);
  }
  if (card.confidence < 0.6) {
    issues.push(`置信度 ${card.confidence.toFixed(2)} 低于 0.6 发布线`);
  }
  if (card.significance.trim() === "") {
    issues.push("显著性依据为空");
  }
  return { pass: issues.length === 0, issues };
}
