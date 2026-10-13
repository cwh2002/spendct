/**
 * LLM 接入层客户端（T6 叙事流式 + 08 扩展任务路由的唯一入口，07 §12/§19）。
 *
 * 硬约束：
 * - 仅服务端：顶部 import "server-only"，客户端打包直接报错（02 §1.2「服务器只做转发」）；
 * - 不落盘、不记日志、不打印用户输入（02 §1.2 服务器零存储）；
 * - 模型路由按 07 §12 任务级路由表：narrative / annual-story → deepseek，
 *   其余轻任务 → SiliconFlow Qwen（openai-compatible）；
 * - 无对应 key 抛 LlmExhaustedError，由路由层转 503 { code: "LLM_EXHAUSTED" }。
 */
import "server-only";

import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";

import { pickMockText, type LlmTask } from "./mock-narratives";

export { LLM_TASKS } from "./mock-narratives";
export type { LlmTask } from "./mock-narratives";

/** 叙事类任务走 DeepSeek 主脑；其余为轻任务走 Qwen（07 §12） */
const DEEPSEEK_TASKS: readonly LlmTask[] = ["narrative", "annual-story"];

/** DeepSeek 官方 chat 模型名（01 §1 锁表：deepseek → DeepSeek-V3 系） */
const DEEPSEEK_MODEL_ID = "deepseek-chat";

/** SiliconFlow Qwen 轻任务模型名（01 §1 候选 Qwen/Qwen3-8B / Qwen/Qwen2.5-7B-Instruct 中选型） */
const QWEN_MODEL_ID = "Qwen/Qwen3-8B";
const QWEN_DEFAULT_BASE_URL = "https://api.siliconflow.cn/v1";

/** key 读取双名兼容：QWEN_API_KEY 为任务书命名，SILICONFLOW_API_KEY 为 07 §12 env 唯一清单名 */
function qwenApiKey(): string | undefined {
  return process.env.QWEN_API_KEY?.trim() || process.env.SILICONFLOW_API_KEY?.trim() || undefined;
}

function qwenBaseUrl(): string {
  return (
    process.env.QWEN_BASE_URL?.trim() ||
    process.env.SILICONFLOW_BASE_URL?.trim() ||
    QWEN_DEFAULT_BASE_URL
  );
}

/** key 缺失错误：路由层据此返回 503 + { code: "LLM_EXHAUSTED" } */
export class LlmExhaustedError extends Error {
  readonly code = "LLM_EXHAUSTED" as const;
  readonly task: LlmTask;

  constructor(task: LlmTask) {
    super(`llm task ${task} has no api key configured`);
    this.name = "LlmExhaustedError";
    this.task = task;
  }
}

/**
 * 运行模式判定：DEMO_MODE=mock 或两个供应商 key 都缺 → mock；否则 live。
 * （07 §7：零密钥时服务端强制 mock，保证演示可跑。）
 */
export function resolveLlmMode(): "live" | "mock" {
  if (process.env.DEMO_MODE === "mock") return "mock";
  const hasDeepseek = Boolean(process.env.DEEPSEEK_API_KEY?.trim());
  const hasQwen = Boolean(qwenApiKey());
  if (!hasDeepseek && !hasQwen) return "mock";
  return "live";
}

/** 各任务的系统提示（07 §19：一律走 instructions 选项，messages 中禁 role:"system"） */
const TASK_INSTRUCTIONS: Record<LlmTask, string> = {
  narrative:
    "你是账单体检平台的叙事编辑。基于输入里的聚合数据写 100-200 字中文点评：只说数据支持的事实，语气像财经编辑，不用「综上所述」「值得注意的是」这类套话，不编造输入里没有的数字。",
  "budget-advice":
    "你是预算助手。只基于输入数字给方向性建议，金额一律来自输入行，不虚构外部基准，输出简体中文。",
  "forecast-narrative":
    "你是预算预测编辑。只讲方向与幅度，不承诺精确金额，保留免责声明原文，数字一律来自输入。",
  "quick-entry":
    "你是记账解析器。把一句话记账文本解析为结构化字段，金额一律整数分，无法确定的内容不要编造，非记账文本标记为不可解析。",
  "annual-story":
    "你是年度账单编辑。按输入的分段素材写年度故事，每段数字必须能在输入里找到来源，语气克制、像财经编辑。",
  "tip-personalize":
    "你是省钱贴士适配器。只为输入里出现过的案例写适配理由，不引用输入里没有的案例编号。",
};

/** 按路由表取模型；对应 key 缺失抛 LlmExhaustedError */
function resolveModel(task: LlmTask) {
  if (DEEPSEEK_TASKS.includes(task)) {
    const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
    if (!apiKey) throw new LlmExhaustedError(task);
    return createDeepSeek({
      apiKey,
      baseURL: process.env.DEEPSEEK_BASE_URL?.trim() || undefined,
    }).chat(DEEPSEEK_MODEL_ID);
  }
  const apiKey = qwenApiKey();
  if (!apiKey) throw new LlmExhaustedError(task);
  return createOpenAICompatible({
    name: "siliconflow",
    baseURL: qwenBaseUrl(),
    apiKey,
  }).chatModel(QWEN_MODEL_ID);
}

/**
 * live 流式文本：SDK streamText → toTextStreamResponse → 只取 body 转发。
 * 服务端不消费、不缓存、不落盘流内容（02 §1.2）。
 */
export async function streamLlmText(
  task: LlmTask,
  input: { stage?: string; prompt: string },
): Promise<ReadableStream<Uint8Array>> {
  const model = resolveModel(task);
  const result = streamText({
    model,
    instructions: TASK_INSTRUCTIONS[task],
    prompt: input.prompt,
  });
  const response = result.toTextStreamResponse();
  if (!response.body) throw new Error("streamText 返回的响应没有 body");
  return response.body;
}

/** mock 流：模板文本按码点切 6 字小片，固定 40ms 延时逐片输出（30-60ms 区间取定值，保证可复现） */
const MOCK_CHUNK_CODE_POINTS = 6;
const MOCK_CHUNK_DELAY_MS = 40;

export function mockTextStream(
  task: LlmTask,
  input: { stage?: string; prompt?: string },
): ReadableStream<Uint8Array> {
  const text = pickMockText(task, input.stage);
  const encoder = new TextEncoder();
  const chunks: string[] = [];
  const codePoints = Array.from(text);
  for (let i = 0; i < codePoints.length; i += MOCK_CHUNK_CODE_POINTS) {
    chunks.push(codePoints.slice(i, i + MOCK_CHUNK_CODE_POINTS).join(""));
  }
  let index = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, MOCK_CHUNK_DELAY_MS));
      const chunk = chunks[index];
      index += 1;
      if (chunk !== undefined) controller.enqueue(encoder.encode(chunk));
    },
  });
}
