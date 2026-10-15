/**
 * 预算建议任务的输出结构（08 §⑥.2，08 修订案 A5 契约逐字，全项目唯一来源）。
 *
 * 用途：/api/ai/task 的 budget-advice 任务在 live 模式下的结构化输出校验；
 * 生成失败时回落 mock-narratives.mockBudgetAdvice 模板（07 §12 降级链：
 * qwen → 确定性模板兜底），本结构与模板形状一致，前端拿到的数据形状不变。
 *
 * 口径说明：
 * - severity 由预算使用率阈值判定：<80% ok / 80%-100% warn / ≥100% over，
 *   阈值口径与 mockBudgetAdvice 完全一致；
 * - actions 最多 2 项，取值对应预算页的三个动作按钮，由前端按枚举渲染；
 * - headline ≤60 字、advice ≤160 字，与超支提示卡的排版上限匹配。
 */
import { z } from "zod";

export const BudgetAdviceSchema = z.strictObject({
  severity: z.enum(["ok", "warn", "over"]), // ratio<80% / 80-100% / ≥100%
  headline: z.string().max(60),
  advice: z.string().max(160),
  actions: z.array(z.enum(["adjust_budget", "view_detail", "dismiss"])).max(2),
});

export type BudgetAdviceOutput = z.infer<typeof BudgetAdviceSchema>;
