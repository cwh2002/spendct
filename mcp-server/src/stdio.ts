/**
 * spendct-mcp stdio 入口：供本地 MCP 客户端（Claude Desktop / Cursor 等）
 * 以子进程方式直接拉起调试。
 *
 * 注意：stdio 传输占用 stdout 传递协议消息，本入口不得向 stdout 输出任何日志。
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createSpendctMcpServer } from "./server.js";

async function main(): Promise<void> {
  const server = createSpendctMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

void main();
