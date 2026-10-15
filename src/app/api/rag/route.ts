/**
 * POST /api/rag —— 案例检索端点（07 §13 信封；04 §4.7 服务端级联的 Next 入口）。
 *
 * - 请求：{ query: string(1..400), categories?: CaseCategory[], topK?: int(1..3) }，zod 严格校验；
 * - 响应：{ ok: true, data: { cases: RetrievedCase[], provider, latencyMs } }
 *   | { ok: false, error: { code, message } }；
 * - 运行模式：resolveLlmMode()==="mock"（演示）或 EMBEDDING_PROVIDER=tfidf-only（公网轻量）
 *   → 恒走浏览器同款 TF-IDF 兜底，确定性可复现；live 模式走 dense+rerank 级联；
 * - RAG_SERVER_URL 设置时改为代理容器 GET /retrieve（07 §16 拓扑预留，零客户端改动）；
 * - 查询文本不打印、不落盘、不记日志（02 §1.2 / 07 §17 允许项③）。
 */
import { z } from "zod";
import { NextResponse } from "next/server";
import { resolveLlmMode } from "@/lib/llm/client";
import { CaseCategorySchema, CaseFilterSchema } from "@/lib/rag/types";
import { retrieveCases } from "@/server/rag/retrieve";

export const runtime = "nodejs";

const RagRequestSchema = z.strictObject({
  query: z.string().min(1).max(400),
  categories: z.array(CaseCategorySchema).max(8).optional(),
  topK: z.number().int().min(1).max(3).optional(),
});

function fail(status: number, code: string, message: string) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, "BAD_REQUEST", "请求体不是合法 JSON");
  }
  const parsed = RagRequestSchema.safeParse(body);
  if (!parsed.success) {
    return fail(400, "BAD_REQUEST", parsed.error.issues[0]?.message ?? "参数不合法");
  }
  const { query, categories, topK } = parsed.data;

  const forceTfidf =
    resolveLlmMode() === "mock" || process.env.EMBEDDING_PROVIDER === "tfidf-only";
  const filter = CaseFilterSchema.parse({ categories });

  const result = await retrieveCases(query, filter, { topK, forceTfidf });
  return NextResponse.json({ ok: true, data: result });
}
