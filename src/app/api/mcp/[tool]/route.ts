/**
 * /api/mcp/[tool] —— MCP 工具代理端点（07 §13 端点清单行：5s 连接超时；
 * 单工具 4s；ok:false 信封）。
 *
 * 给外部调用方（演示脚本、联调工具）提供的 JSON 直调入口：
 *   - 配置 MCP_SERVER_URL：经 MCP 客户端调用真实工具（含退避与两败移除）；
 *   - 未配置 / 连接失败：本地回退实现（静态日历两工具 + 快照本地回执；
 *     天气返回 unavailable 信封，绝不编造）。
 *
 * 响应恒为信封 JSON（{ok:true,data,meta} | {ok:false,error}），
 * 工具级失败是业务结果，HTTP 200；仅信封不可解析时回 502。
 */
import { z } from "zod";

import { getFallbackTool } from "@/server/ai/mcp-fallback";
import { callMcpTool, parseToolEnvelope, MCP_TOOL_NAMES, type McpToolName } from "@/server/ai/mcp";

export const runtime = "nodejs";

const ProxyRequestSchema = z.strictObject({
  tool: z.string().min(1).max(64),
  args: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ tool: string }> },
) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: { code: "invalid_input", message: "请求体必须是 JSON" } }, { status: 400 });
  }
  const parsed = ProxyRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ ok: false, error: { code: "invalid_input", message: "参数校验失败" } }, { status: 400 });
  }

  // URL 里的 [tool] 与 body.tool 取交集：两者一致才放行（防路径参数与意图分离）
  const { tool: pathTool } = await context.params;
  const toolName = parsed.data.tool;
  if (pathTool !== toolName) {
    return Response.json({ ok: false, error: { code: "invalid_input", message: "路径与请求体工具名不一致" } }, { status: 400 });
  }

  const args = parsed.data.args ?? {};
  const mcpUrl = process.env.MCP_SERVER_URL?.trim();

  let text: string;
  if (mcpUrl) {
    if (!MCP_TOOL_NAMES.includes(toolName as McpToolName)) {
      return Response.json({ ok: false, error: { code: "invalid_input", message: `未知工具：${toolName}` } }, { status: 400 });
    }
    const outcome = await callMcpTool(toolName as McpToolName, args);
    text = outcome.text;
  } else {
    // L2 本地回退：静态日历两工具 + 快照本地回执 + 天气诚实降级
    const fallback = getFallbackTool(toolName);
    if (!fallback) {
      return Response.json({ ok: false, error: { code: "invalid_input", message: `未知工具：${toolName}` } }, { status: 400 });
    }
    text = fallback.execute(args);
  }

  const envelope = parseToolEnvelope(text);
  if (!envelope.ok && envelope.error?.code === undefined) {
    return Response.json({ ok: false, error: { code: "upstream_error", message: "工具返回不可解析" } }, { status: 502 });
  }
  return Response.json(JSON.parse(text) as unknown, { status: 200 });
}
