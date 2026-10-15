/**
 * 省钱贴士个性化任务的输出结构（08 §⑥.4，08 修订案 A5 契约逐字，全项目唯一来源）。
 *
 * 用途：/api/ai/task 的 tip-personalize 任务在 live 模式下的结构化输出校验；
 * 生成失败时回落 mockTips（top-3 直出 + 通用适配句，07 §12 降级链），
 * 本结构与模板形状一致，前端拿到的数据形状不变。
 *
 * 口径说明：
 * - tips 固定 3 条（z.length(3)），与洞察流贴士卡一次展示 3 条的版式对齐；
 * - caseId 只能来自检索候选列表：候选集合随请求变化，结构层不做白名单校验，
 *   引用白名单校验在调用方做后处理（04 §5.3 机制复用，防编造引用）；
 * - why 是一句话适配理由（≤40 字），写「对你的适配点」而非复述案例原文。
 */
import { z } from "zod";

export const TipPersonalizeSchema = z.strictObject({
  tips: z
    .array(
      z.object({
        caseId: z.string(), // 必须来自检索结果（引用白名单后处理复用 04 §5.3）
        why: z.string().max(40), // 一句话适配理由
      }),
    )
    .length(3),
});

export type TipPersonalizeOutput = z.infer<typeof TipPersonalizeSchema>;
