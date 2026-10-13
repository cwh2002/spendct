/**
 * /api/ai/chat —— LLM 文本流式端点（T6 叙事流式接入层）。
 *
 * - 请求：{ task: LlmTask, stage?: StageId, messages: [{ role: "user"|"assistant", content }] }；
 *   role 枚举不含 system（07 §19）；消息总长 ≤8000；
 * - mock 模式：mockTextStream 模板流（text/plain 流式响应）；
 * - live 模式：streamLlmText（SDK streamText → toTextStreamResponse）只做转发，不落盘不记日志（02 §1.2）；
 * - 对应 key 缺失：503 { code: "LLM_EXHAUSTED" }。
 */
import { z } from "zod";
import { NextResponse } from "next/server";

import { SIX_STAGES } from "@/lib/pipeline/stage";
import {
  LLM_TASKS,
  LlmExhaustedError,
  mockTextStream,
  resolveLlmMode,
  streamLlmText,
} from "@/lib/llm/client";

export const runtime = "nodejs";

const ChatRequestSchema = z.strictObject({
  task: z.enum(LLM_TASKS),
  stage: z.enum(SIX_STAGES).optional(),
  messages: z
    .array(
      z.strictObject({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(20)
    .refine(
      (messages) => messages.reduce((total, message) => total + message.content.length, 0) <= 8000,
      {
        message: "消息总长度不能超过 8000 字",
      },
    ),
});

const STREAM_HEADERS = {
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "no-store",
};

/** 把对话拼成模型输入：用户内容直拼，助手内容加前缀区分 */
function buildPrompt(messages: { role: "user" | "assistant"; content: string }[]): string {
  return messages
    .map((message) => (message.role === "user" ? message.content : `助手：${message.content}`))
    .join("\n");
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "请求体必须是 JSON" },
      { status: 400 },
    );
  }
  const parsed = ChatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ code: "BAD_REQUEST", message: "参数校验失败" }, { status: 400 });
  }
  const { task, stage, messages } = parsed.data;

  if (resolveLlmMode() === "mock") {
    return new Response(mockTextStream(task, { stage }), { headers: STREAM_HEADERS });
  }
  try {
    const stream = await streamLlmText(task, { stage, prompt: buildPrompt(messages) });
    return new Response(stream, { headers: STREAM_HEADERS });
  } catch (error) {
    if (error instanceof LlmExhaustedError) {
      return NextResponse.json({ code: "LLM_EXHAUSTED" }, { status: 503 });
    }
    return NextResponse.json({ code: "UPSTREAM_ERROR" }, { status: 502 });
  }
}
