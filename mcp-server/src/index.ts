/**
 * spendct-mcp Streamable HTTP 入口。
 *
 * 部署形态（契约见 docs/04-rag-mcp.md §9.2）：
 *   - POST /mcp     MCP Streamable HTTP 单端点（无状态模式）
 *   - GET  /healthz 存活探针
 *
 * 无状态模式说明：transport 以 sessionIdGenerator: undefined 构造，
 * 每个请求独立建 transport 与 server 实例，不保留会话，天然支持多实例水平扩展。
 * 默认只监听 127.0.0.1（容器内通过 HOST=0.0.0.0 覆盖），
 * 请求来源由 createMcpExpressApp 的 DNS rebinding 防护兜底。
 */
import express from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createSpendctMcpServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

const PORT = Number(process.env.PORT ?? 3100);
const HOST = process.env.HOST ?? "127.0.0.1";

// createMcpExpressApp 内置 JSON body 解析与 DNS rebinding 防护
const app = createMcpExpressApp({ host: HOST });

app.get("/healthz", (_req, res) => {
  res.json({
    ok: true,
    service: SERVER_NAME,
    version: SERVER_VERSION,
    uptimeSec: Math.round(process.uptime()),
  });
});

app.post("/mcp", async (req, res) => {
  // 无状态 transport：每次请求独立实例，请求结束即释放；
  // enableJsonResponse 让客户端声明 application/json 时回 JSON（便于调试与测试）
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = createSpendctMcpServer();
  res.on("close", () => {
    transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.listen(PORT, HOST, () => {
  // 仅 HTTP 入口使用标准输出日志；stdio 入口禁止向 stdout 打印任何内容
  console.log(`[spendct-mcp] Streamable HTTP 服务已启动：http://${HOST}:${PORT}/mcp`);
});
