/**
 * spendct-mcp 公共类型与工具返回信封（契约见 docs/04-rag-mcp.md §8.5）。
 *
 * 所有 MCP 工具统一返回 JSON 文本信封，客户端（主站 /api/followup 的 MCP 接入层）
 * 只需处理两种形态：
 *   { ok: true,  data, meta }                                —— 成功，data 为工具业务数据
 *   { ok: false, error: { code, message, retryAfterSec? } }  —— 失败，code 见 TOOL_ERROR_CODES
 */
import { z } from "zod";

/** 失败错误码全集 */
export const TOOL_ERROR_CODES = [
  "invalid_input", // 入参或快照不合法（客户端可修正后重试）
  "unavailable", // 依赖缺失（如未配置天气 API 密钥、未开启 mock）
  "timeout", // 上游超时
  "upstream_error", // 上游明确返回错误（HTTP 状态码 / 业务错误码）
] as const;

export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[number];

/** 成功信封 */
export interface ToolOkResult<T> {
  ok: true;
  data: T;
  meta: {
    /** 数据来源说明，始终向用户与模型透出，防止演示口径混淆 */
    source: string;
    /** 生成时刻（ISO 8601） */
    generatedAt: string;
  };
}

/** 失败信封 */
export interface ToolFailResult {
  ok: false;
  error: {
    code: ToolErrorCode;
    message: string;
    /** 建议重试等待秒数（仅 upstream_error 在服务繁忙时携带） */
    retryAfterSec?: number;
  };
}

export type ToolResult<T = unknown> = ToolOkResult<T> | ToolFailResult;

/** 信封 zod 校验（单测与客户端解析共用同一口径） */
export const toolOkEnvelopeSchema = z.object({
  ok: z.literal(true),
  data: z.unknown(),
  meta: z.object({
    source: z.string(),
    generatedAt: z.string(),
  }),
});

export const toolFailEnvelopeSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.enum(TOOL_ERROR_CODES),
    message: z.string(),
    retryAfterSec: z.number().int().nonnegative().optional(),
  }),
});

export const toolResultSchema = z.discriminatedUnion("ok", [
  toolOkEnvelopeSchema,
  toolFailEnvelopeSchema,
]);

/** 构造成功信封 */
export function okResult<T>(data: T, source: string): ToolOkResult<T> {
  return {
    ok: true,
    data,
    meta: { source, generatedAt: new Date().toISOString() },
  };
}

/** 构造失败信封 */
export function failResult(
  code: ToolErrorCode,
  message: string,
  retryAfterSec?: number,
): ToolFailResult {
  const error: ToolFailResult["error"] = { code, message };
  if (retryAfterSec !== undefined) error.retryAfterSec = retryAfterSec;
  return { ok: false, error };
}

/** 把信封包装成 MCP 工具回调的标准返回结构（文本 JSON） */
export function toContent(result: ToolResult): {
  content: Array<{ type: "text"; text: string }>;
} {
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
}
