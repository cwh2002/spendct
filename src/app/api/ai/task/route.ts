/**
 * /api/ai/task —— LLM 短任务统一端点（08 修订案 A6：单次 JSON 请求/响应，无 SSE）。
 *
 * - 请求：{ task: LlmTask, input: { text?, stage?, ... } }，zod 严格校验；
 * - 响应信封（07 §13）：{ ok: true, data } | { ok: false, error: { code, message } }；
 * - mock 模式：quick-entry 走本地规则解析（确定性兜底），其余任务返回模板 JSON；
 * - live 模式：本轮留 TODO——接 SDK generateObject 结构化输出（schema 见 08 §⑥）。
 * - 不打印、不落盘任何输入文本（02 §1.2 / 07 §17 允许项③）。
 */
import { z } from "zod";
import { NextResponse } from "next/server";

import { SIX_STAGES } from "@/lib/pipeline/stage";
import { LLM_TASKS, resolveLlmMode, type LlmTask } from "@/lib/llm/client";
import {
  mockBudgetAdvice,
  mockForecastNarrative,
  mockTips,
  pickMockText,
} from "@/lib/llm/mock-narratives";
import { parseQuickEntryText } from "@/lib/llm/quick-entry-rule";
import { CATEGORY_CODES } from "@/lib/schema/bill";

export const runtime = "nodejs";

/**
 * 08 §⑥.1 QuickEntrySchema 内联副本（07 修订案 A5 契约逐字）。
 * 单一来源 src/lib/schema/quick-entry.ts 落位后改为 import，本副本删除。
 */
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

const TaskRequestSchema = z.strictObject({
  task: z.enum(LLM_TASKS),
  input: z
    .strictObject({
      text: z.string().max(200).optional(),
      stage: z.enum(SIX_STAGES).optional(),
    })
    .catchall(z.unknown()),
});

function fail(status: number, code: string, message: string) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

/** 本地日期 YYYY-MM-DD（quick-entry 缺省日期口径：缺省 = 今天） */
function todayIso(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** mock 模式：按任务产出确定性 JSON */
function mockTaskResult(task: LlmTask, input: Record<string, unknown>): unknown {
  if (task === "quick-entry") {
    return parseQuickEntryText(typeof input.text === "string" ? input.text : "", todayIso());
  }
  if (task === "narrative" || task === "annual-story") {
    const stage = typeof input.stage === "string" ? input.stage : undefined;
    return { text: pickMockText(task, stage) };
  }
  if (task === "budget-advice") {
    const ratio =
      typeof input.ratio === "number" && Number.isFinite(input.ratio) ? input.ratio : undefined;
    return mockBudgetAdvice(ratio);
  }
  if (task === "forecast-narrative") {
    const trend =
      input.trend === "up" || input.trend === "down" || input.trend === "flat"
        ? input.trend
        : undefined;
    return mockForecastNarrative(trend);
  }
  const caseIds = Array.isArray(input.caseIds)
    ? input.caseIds.filter((id): id is string => typeof id === "string")
    : [];
  return mockTips(caseIds);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "BAD_REQUEST", "请求体必须是 JSON");
  }
  const parsed = TaskRequestSchema.safeParse(body);
  if (!parsed.success) {
    return fail(400, "BAD_REQUEST", "参数校验失败");
  }
  const { task, input } = parsed.data;

  if (resolveLlmMode() === "mock") {
    return NextResponse.json({ ok: true, data: mockTaskResult(task, input) });
  }

  // TODO(T49)：live 结构化输出。接 SDK generateObject：
  // - quick-entry 用上方内联 QuickEntrySchema（单一来源 src/lib/schema/quick-entry.ts 落位后改为 import）；
  // - budget-advice / forecast-narrative / tip-personalize 分别用 08 §⑥.2/⑥.3 的
  //   BudgetAdviceSchema / ForecastNarrativeSchema / TipPersonalizeSchema；
  // - 复用既有栈：生成 → zod 校验 → 修复 ≤2 次，wrapTool 降级信封（07 §13 A6）。
  // 本轮未接入前返回 501，前端按 mock 路径兜底。
  return fail(501, "NOT_IMPLEMENTED", "live 结构化输出将在 generateObject 接入后启用");
}
