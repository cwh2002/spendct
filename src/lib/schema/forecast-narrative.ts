/**
 * 下月预测叙事任务的输出结构（08 §⑥.3，07 修订案 A5 契约逐字，全项目唯一来源）。
 *
 * 用途：/api/ai/task 的 forecast-narrative 任务在 live 模式下的结构化输出校验；
 * 生成失败时回落 mockForecastNarrative 固定句式模板（07 §12 降级链），
 * 本结构与模板形状一致，前端拿到的数据形状不变。
 *
 * 口径说明：
 * - narrative 只讲方向与幅度、不承诺精确金额，数字一律来自输入行（03 §2.0 铁律 2 延伸）；
 * - disclaimer 是固定免责声明原文，用 z.literal 强制逐字输出，
 *   防止生成内容把免责条款改写成别的措辞；
 * - headline ≤60 字、narrative ≤300 字，与预测图表卡片的版式上限匹配。
 */
import { z } from "zod";

export const ForecastNarrativeSchema = z.strictObject({
  headline: z.string().max(60),
  narrative: z.string().max(300),
  disclaimer: z.literal("朴素季节外推，仅作参考，不构成建议"),
});

export type ForecastNarrativeOutput = z.infer<typeof ForecastNarrativeSchema>;
