/**
 * 工具返回信封契约测试（docs/04-rag-mcp.md §8.5）。
 */
import { describe, expect, it } from "vitest";
import {
  failResult,
  okResult,
  toolFailEnvelopeSchema,
  toolOkEnvelopeSchema,
  toolResultSchema,
  toContent,
} from "../src/types.js";

describe("工具返回信封", () => {
  it("成功信封结构完整，且能被契约 schema 校验", () => {
    const result = okResult([{ id: "P2026-1101", name: "双11 正式期" }], "来源说明");
    expect(result.ok).toBe(true);
    expect(result.meta.source).toBe("来源说明");
    expect(result.meta.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(toolOkEnvelopeSchema.safeParse(result).success).toBe(true);
    expect(toolResultSchema.safeParse(result).success).toBe(true);
  });

  it("失败信封携带错误码与消息，retryAfterSec 为可选字段", () => {
    const plain = failResult("unavailable", "未配置密钥");
    expect(plain.error).toEqual({ code: "unavailable", message: "未配置密钥" });
    expect(toolFailEnvelopeSchema.safeParse(plain).success).toBe(true);

    const withRetry = failResult("upstream_error", "服务繁忙", 4);
    expect(withRetry.error.retryAfterSec).toBe(4);
    expect(toolResultSchema.safeParse(withRetry).success).toBe(true);
  });

  it("toContent 包装为 MCP 文本内容结构，JSON 可逆", () => {
    const result = okResult({ hello: "world" }, "测试");
    const content = toContent(result);
    expect(content.content).toHaveLength(1);
    expect(content.content[0].type).toBe("text");
    expect(JSON.parse(content.content[0].text)).toEqual(result);
  });
});
