/**
 * 快速记账一句话解析的输出结构（08 §⑥.1，08 修订案 A5 契约逐字，全项目唯一来源）。
 *
 * 用途：/api/ai/task 的 quick-entry 任务在 live 模式下的结构化输出校验；
 * 其他文件只 import 不复制（07 §12 A5 单一来源条款）。
 *
 * 口径说明：
 * - amountCents 一律整数分（07 §3 全项目唯一金额单位），上限 1e9 分；
 * - category 取 bill.ts 的 CATEGORY_CODES 12 类枚举，与本地规则解析共用同一字典；
 * - entry 缺省 = 不可解析（此时应给 reason），调用方落到手动表单兜底（08 §⑥.1），
 *   不阻塞记账流程；
 * - ts 为 ISO 时间串，缺省由调用方按「今天」补全；merchant / note 可选，
 *   长度上限与记账确认卡的版式匹配。
 */
import { z } from "zod";

import { CATEGORY_CODES } from "@/lib/schema/bill";

export const QuickEntrySchema = z.strictObject({
  parseable: z.boolean(),
  entry: z
    .object({
      amountCents: z.number().int().positive().max(1e9), // 单位：分（07 §3）
      direction: z.enum(["expense", "income"]),
      category: z.enum(CATEGORY_CODES), // 12 类唯一枚举（07 §3）
      merchant: z.string().max(30).optional(),
      ts: z.string().datetime().optional(), // 缺省 = 今天
      note: z.string().max(60).optional(),
    })
    .optional(),
  reason: z.string().max(60).optional(), // parseable:false 时给原因
});

export type QuickEntryOutput = z.infer<typeof QuickEntrySchema>;
