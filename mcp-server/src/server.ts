/**
 * spendct-mcp 服务端装配：四工具注册（契约见 docs/04-rag-mcp.md §8-§9）。
 *
 * 该装配函数同时被两个入口复用：
 *   - src/index.ts：Streamable HTTP 传输（主站 /api/followup 的接入路径）；
 *   - src/stdio.ts：stdio 传输（本地调试，供 MCP 客户端直接拉起子进程）。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toContent } from "./types.js";
import {
  querySchoolCalendar,
  schoolCalendarInputShape,
  type SchoolCalendarArgs,
} from "./tools/school-calendar.js";
import {
  getWeather,
  weatherInputShape,
  type WeatherArgs,
} from "./tools/weather.js";
import {
  queryPromoCalendar,
  promoCalendarInputShape,
  type PromoCalendarArgs,
} from "./tools/promo-calendar.js";
import {
  billDbMetadataInputShape,
  queryBillDbMetadata,
} from "./tools/bill-metadata.js";

export const SERVER_NAME = "spendct-mcp";
export const SERVER_VERSION = "1.0.0";

export function createSpendctMcpServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    "get_school_calendar",
    {
      title: "高校校历查询",
      description:
        "查询 2026-2027 学年高校校历（考试周/假期/开学/毕业季），" +
        "供消费洞察把季节性事件作为支出波动归因依据。入参可给 type/date/region，均为可选。",
      inputSchema: schoolCalendarInputShape,
    },
    async (args) => toContent(querySchoolCalendar(args as unknown as SchoolCalendarArgs)),
  );

  server.registerTool(
    "get_weather",
    {
      title: "城市天气查询",
      description:
        "查询城市未来 3 或 7 天天气（和风天气）。入参 cityId 或 city 二选一，" +
        "days 缺省为 3。用于把天气纳入消费归因（如雨天外卖占比上升）与出行建议。",
      inputSchema: weatherInputShape,
    },
    async (args) => toContent(await getWeather(args as unknown as WeatherArgs)),
  );

  server.registerTool(
    "get_promo_calendar",
    {
      title: "电商大促日历查询",
      description:
        "查询 2026-2027 电商大促档期（双11/双12/年货节等），入参 date/category/platform 均为可选。" +
        "用于消费建议中的比价时机提示与大促期支出归因。",
      inputSchema: promoCalendarInputShape,
    },
    async (args) => toContent(queryPromoCalendar(args as unknown as PromoCalendarArgs)),
  );

  server.registerTool(
    "query_bill_db_metadata",
    {
      title: "账单库元数据回执",
      description:
        "接收前端 DuckDB-WASM 账单库的聚合元数据快照（表名/行数/数据集指纹/schema/统计）并回执。" +
        "协议演示用：只收聚合元数据，不接收账单明细行；严格校验，未知字段一律拒绝。" +
        "表名白名单：transactions / merchants。",
      inputSchema: billDbMetadataInputShape,
    },
    async (args) => toContent(queryBillDbMetadata(args)),
  );

  return server;
}
