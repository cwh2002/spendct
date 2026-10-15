/**
 * 工具注册表（全项目唯一，07 契约 §18）。
 *
 * 短名（PlanStep.toolName / 工具徽章标识）↔ 真实工具名 的映射与展示元数据。
 * 五工具分两类执行位置：
 *   - server-mcp：经 MCP 服务器调用（主站接入层见 src/server/ai/mcp.ts）；
 *   - browser：在浏览器 DuckDB-WASM 直读，服务端绝不执行 SQL。
 *
 * 本文件是纯数据，客户端与服务端都可安全引用（徽章渲染与路由校验共用同一口径）。
 */

export type ToolShortName = "calendar" | "weather" | "promo" | "duckdb_meta" | "sql";

export type ToolLocation = "server-mcp" | "browser";

export interface ToolRegistryEntry {
  /** 短名：PlanStep.toolName 与 SSE tool 事件里使用的标识 */
  shortName: ToolShortName;
  /** 真实工具名：服务端 MCP 工具为 MCP 注册名；浏览器工具即短名本身 */
  realName: string;
  /** 中文展示名（工具徽章等 UI 场景） */
  label: string;
  /** 一句话说明 */
  description: string;
  /** 执行位置 */
  location: ToolLocation;
}

/** 服务端 MCP 三工具 + 浏览器直读两工具（顺序即徽章展示顺序） */
export const TOOL_REGISTRY: readonly ToolRegistryEntry[] = [
  {
    shortName: "calendar",
    realName: "get_school_calendar",
    label: "高校校历",
    description: "查询 2026-2027 学年校历（考试周/假期/开学/毕业季），作消费归因背景",
    location: "server-mcp",
  },
  {
    shortName: "weather",
    realName: "get_weather",
    label: "城市天气",
    description: "查询城市未来 3/7 天天气（和风天气），作消费归因背景",
    location: "server-mcp",
  },
  {
    shortName: "promo",
    realName: "get_promo_calendar",
    label: "大促日历",
    description: "查询电商大促档期（双11/双12/年货节等），供比价时机提示",
    location: "server-mcp",
  },
  {
    shortName: "duckdb_meta",
    realName: "duckdb_meta",
    label: "账单库元数据",
    description: "浏览器直读 DuckDB-WASM 实时 schema（追问实际使用，永不过期）",
    location: "browser",
  },
  {
    shortName: "sql",
    realName: "run_browser_sql",
    label: "账单数据查询",
    description: "白名单 SQL 在浏览器执行，服务端绝不执行 SQL",
    location: "browser",
  },
];

/** 短名 → 注册表条目 */
const BY_SHORT_NAME = new Map(TOOL_REGISTRY.map((entry) => [entry.shortName, entry]));

export function getToolEntry(shortName: string): ToolRegistryEntry | undefined {
  return BY_SHORT_NAME.get(shortName as ToolShortName);
}

/** 服务端 MCP 三工具的短名集合（MCP 工具集装配时按此过滤） */
export const SERVER_MCP_SHORT_NAMES = TOOL_REGISTRY.filter(
  (entry) => entry.location === "server-mcp",
).map((entry) => entry.shortName);

/** 短名 → MCP 真实名（MCP 客户端 tools/list 结果按此映射回短名） */
export function shortNameOfMcpTool(mcpName: string): ToolShortName | undefined {
  const entry = TOOL_REGISTRY.find(
    (candidate) => candidate.location === "server-mcp" && candidate.realName === mcpName,
  );
  return entry?.shortName;
}

/** §18 五工具表之外的展示名补表（协议演示工具等） */
const EXTRA_TOOL_LABELS: Record<string, string> = {
  query_bill_db_metadata: "账单库元数据回执",
};

/**
 * 工具展示名解析：优先注册表（按短名或真实名），其次补表，最后回原名。
 * 面板工具徽章与 SSE tool 事件统一走这里，保证展示口径单一来源。
 */
export function getToolLabel(toolName: string): string {
  const entry = TOOL_REGISTRY.find(
    (candidate) => candidate.shortName === toolName || candidate.realName === toolName,
  );
  return entry?.label ?? EXTRA_TOOL_LABELS[toolName] ?? toolName;
}
