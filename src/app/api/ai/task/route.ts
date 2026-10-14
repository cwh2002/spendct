/**
 * /api/ai/task —— LLM 短任务统一端点（08 修订案 A6：单次 JSON 请求/响应，无 SSE）。
 *
 * - 请求：{ task: LlmTask, input: { text?, stage?, ... } }，zod 严格校验；
 * - 响应信封（07 §13）：{ ok: true, data } | { ok: false, error: { code, message } }；
 * - mock 模式：quick-entry 走本地规则解析（确定性兜底），其余任务返回模板 JSON；
 * - live 模式：四个结构化任务（quick-entry / budget-advice / forecast-narrative /
 *   tip-personalize）走 SDK generateObject + 08 §⑥ zod 结构，生成 → 校验 → 修复 ≤2 次
 *   （03 §4 闭环 / 07 §13 A6）；校验仍失败或上游不可用时回落 mock 响应形状，
 *   响应信封不变、前端零改动（07 §12 各任务降级链的终档都是确定性模板）；
 * - narrative / annual-story 的 live 叙事走既有流式端点（07 §13 A6），本端点仍返回 501；
 * - 不打印、不落盘任何输入文本（02 §1.2 / 07 §17 允许项③）。
 */
import { z } from "zod";
import { NextResponse } from "next/server";
import {
  InvalidResponseDataError,
  JSONParseError,
  NoObjectGeneratedError,
  TypeValidationError,
} from "ai";

import { SIX_STAGES } from "@/lib/pipeline/stage";
import { generateLlmObject, LLM_TASKS, resolveLlmMode, type LlmTask } from "@/lib/llm/client";
import {
  mockBudgetAdvice,
  mockForecastNarrative,
  mockTips,
  pickMockText,
} from "@/lib/llm/mock-narratives";
import { parseQuickEntryText } from "@/lib/llm/quick-entry-rule";
import { BudgetAdviceSchema } from "@/lib/schema/budget-advice";
import { ForecastNarrativeSchema } from "@/lib/schema/forecast-narrative";
import { QuickEntrySchema } from "@/lib/schema/quick-entry";
import { TipPersonalizeSchema } from "@/lib/schema/tip-personalize";

export const runtime = "nodejs";

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

/** live 结构化任务的 zod 结构映射（08 §⑥ 单一来源文件）；不在表内的任务返回 undefined */
function structuredSchema(task: LlmTask): z.ZodType | undefined {
  switch (task) {
    case "quick-entry":
      return QuickEntrySchema;
    case "budget-advice":
      return BudgetAdviceSchema;
    case "forecast-narrative":
      return ForecastNarrativeSchema;
    case "tip-personalize":
      return TipPersonalizeSchema;
    default:
      return undefined;
  }
}

/**
 * live 模式各任务的输入文案：只喂请求里已有的字段，数字与枚举口径写进提示
 * （08 §⑥ 各任务的提示词要点），不注入请求之外的数据，也不落盘。
 */
function buildLivePrompt(task: LlmTask, input: Record<string, unknown>): string {
  if (task === "quick-entry") {
    const text = typeof input.text === "string" ? input.text.trim() : "";
    return [
      `记账文本：${text || "（空）"}`,
      `今天日期：${todayIso()}（文本里没有明确日期时，ts 缺省用今天）`,
      "类目词典（12 类，只能从中选）：餐饮、交通、购物、娱乐、居住、通讯、医疗、教育、人情、金融、订阅、其他",
      "金额一律整数分（1 元 = 100 分）；无法确定的商户不要编造；非记账文本（闲聊/问句）标记 parseable=false 并给 reason。",
    ].join("\n");
  }
  if (task === "budget-advice") {
    const ratio =
      typeof input.ratio === "number" && Number.isFinite(input.ratio) ? input.ratio : undefined;
    const pct = ratio === undefined ? "未提供" : `${Math.round(ratio * 100)}%`;
    return [
      `某类目本月预算使用率：${pct}`,
      "severity 判定口径：低于 80% 为 ok，80%-100% 为 warn，100% 及以上为 over。",
      "advice 只基于使用率给方向性建议，不引用任何外部基准；headline 不超过 60 字、advice 不超过 160 字；actions 按 severity 给 0-2 个动作。",
    ].join("\n");
  }
  if (task === "forecast-narrative") {
    const trend =
      input.trend === "up" || input.trend === "down" || input.trend === "flat"
        ? input.trend
        : "up";
    return [
      `下月预测趋势：${trend}（up=环比上涨，down=环比回落，flat=走平）`,
      "只讲方向与幅度，不承诺精确金额；headline 不超过 60 字、narrative 不超过 300 字。",
      "disclaimer 必须逐字输出「朴素季节外推，仅作参考，不构成建议」。",
    ].join("\n");
  }
  const caseIds = Array.isArray(input.caseIds)
    ? input.caseIds.filter((id): id is string => typeof id === "string")
    : [];
  return [
    `候选案例编号：${caseIds.length > 0 ? caseIds.join("、") : "（未提供）"}`,
    "从候选里选 3 个输出 tips；caseId 只能来自候选列表；why 不超过 40 字，写「对你的适配点」而非复述案例。",
  ].join("\n");
}

/** 修复上限：生成 → 校验失败 → 把错误回传重试，最多修复 2 次（03 §4 闭环 / 07 §13 A6） */
const MAX_REPAIR_ROUNDS = 2;

/** 回传的错误摘录长度上限：控制修复轮次的输入规模，也避免把完整生成文本原样喂回 */
const REPAIR_EXCERPT_LIMIT = 600;

/** 只有结构校验类失败值得回传修复；网络/密钥等问题修复无效，直接落模板兜底 */
function isSchemaFailure(error: unknown): boolean {
  return (
    error instanceof NoObjectGeneratedError ||
    error instanceof TypeValidationError ||
    error instanceof JSONParseError ||
    error instanceof InvalidResponseDataError
  );
}

function describeFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 修复轮次的提示：原文 + 校验错误摘录，让下一轮针对错误重写输出 */
function repairPrompt(original: string, failure: string): string {
  return [
    original,
    "上一次输出没有通过结构校验，请对照错误信息修正后重新输出。错误摘录：",
    failure.slice(0, REPAIR_EXCERPT_LIMIT),
  ].join("\n");
}

/**
 * live 结构化结果：生成 → 校验 → 修复 ≤2 次 → 回落 mock。
 * 任何失败路径都返回 mock 响应形状（07 §12 各任务降级链终档都是确定性模板），
 * 信封保持 { ok: true, data }，前端零改动。
 */
async function liveStructuredResult(
  task: LlmTask,
  schema: z.ZodType,
  input: Record<string, unknown>,
): Promise<unknown> {
  const prompt = buildLivePrompt(task, input);
  let failure: string | undefined;
  for (let attempt = 0; attempt <= MAX_REPAIR_ROUNDS; attempt += 1) {
    try {
      return await generateLlmObject(
        task,
        schema,
        failure ? repairPrompt(prompt, failure) : prompt,
      );
    } catch (error) {
      if (!isSchemaFailure(error) || attempt === MAX_REPAIR_ROUNDS) {
        return mockTaskResult(task, input);
      }
      failure = describeFailure(error);
    }
  }
  return mockTaskResult(task, input); // 循环必然返回，此行仅为类型收敛
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

  const schema = structuredSchema(task);
  if (!schema) {
    // narrative / annual-story 的 live 叙事走既有流式端点（07 §13 A6），本端点维持 501
    return fail(501, "NOT_IMPLEMENTED", "该任务尚未接入本端点的 live 结构化输出");
  }
  const data = await liveStructuredResult(task, schema, input);
  return NextResponse.json({ ok: true, data });
}
