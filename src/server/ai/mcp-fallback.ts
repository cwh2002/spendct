/**
 * MCP 本地回退工具（L2，04 §10.2）。
 *
 * 未配置 MCP_SERVER_URL 或连接失败时，追问流仍可携带工具：
 *   - 校历 / 大促日历：静态数据本地过滤（数据文件单一来源 =
 *     mcp-server/src/data/*.json，本模块只读引入、不复制数据）；
 *   - 天气：诚实降级——返回 unavailable 信封，绝不编造天气；
 *   - 账单元数据回执：本地严格校验回执（口径与 MCP 服务端一致）。
 *
 * 过滤逻辑与 mcp-server/src/tools/* 保持镜像（权威实现在 MCP 侧），
 * 信封结构对齐 mcp-server/src/types.ts 的 ToolResult。
 */
import "server-only";

import { sessionSchemaSchema, type SessionSchema } from "@/lib/schema/session-schema";

import promoCalendarData from "../../../mcp-server/src/data/promo-calendar-2026.json";
import schoolCalendarData from "../../../mcp-server/src/data/school-calendar-2026-2027.json";

// ─────────────────────────── 数据形状（与数据文件结构镜像） ───────────────────────────

interface SchoolEvent {
  id: string;
  name: string;
  type: "exam_week" | "vacation" | "term_start" | "graduation";
  startDate: string;
  endDate: string;
  region: string;
  note: string;
  source: string;
}

interface SchoolCalendarFile {
  version: string;
  academicYear: string;
  source: string;
  events: SchoolEvent[];
}

interface PromoEvent {
  id: string;
  name: string;
  category: string;
  startDate: string;
  endDate: string;
  platforms: string[];
  note: string;
  source: string;
}

interface PromoCalendarFile {
  version: string;
  year: number;
  source: string;
  promotions: PromoEvent[];
}

// ─────────────────────────── 信封工具 ───────────────────────────

function okEnvelopeText<T>(data: T, source: string): string {
  return JSON.stringify({ ok: true, data, meta: { source, generatedAt: new Date().toISOString() } });
}

function failEnvelopeText(code: string, message: string): string {
  return JSON.stringify({ ok: false, error: { code, message } });
}

// ─────────────────────────── 回退工具实现 ───────────────────────────

export type FallbackToolName =
  | "get_school_calendar"
  | "get_weather"
  | "get_promo_calendar"
  | "query_bill_db_metadata";

export interface FallbackToolImpl {
  name: FallbackToolName;
  description: string;
  /** 与 mcp-server inputSchema 同构的静态 JSON Schema（镜像，权威在 MCP 侧） */
  inputSchema: Record<string, unknown>;
  /** 返回工具信封 JSON 文本，永不抛错 */
  execute: (args: Record<string, unknown>) => string;
}

const schoolFile = schoolCalendarData as unknown as SchoolCalendarFile;
const promoFile = promoCalendarData as unknown as PromoCalendarFile;

function schoolCalendarExecute(args: Record<string, unknown>): string {
  const type = typeof args.type === "string" ? args.type : undefined;
  const date = typeof args.date === "string" ? args.date : undefined;
  const region = typeof args.region === "string" ? args.region : undefined;
  let events = [...schoolFile.events];
  if (type) events = events.filter((event) => event.type === type);
  if (date) events = events.filter((event) => event.startDate <= date && date <= event.endDate);
  if (region) events = events.filter((event) => event.region === region);
  events.sort((a, b) => a.startDate.localeCompare(b.startDate));
  return okEnvelopeText(
    events,
    `高校校历汇编（${schoolFile.academicYear}，本地静态回退，未连接 MCP 服务器）· ${schoolFile.source}`,
  );
}

function promoCalendarExecute(args: Record<string, unknown>): string {
  const date = typeof args.date === "string" ? args.date : undefined;
  const category = typeof args.category === "string" ? args.category : undefined;
  const platform = typeof args.platform === "string" ? args.platform : undefined;
  let promotions = [...promoFile.promotions];
  if (date) promotions = promotions.filter((p) => p.startDate <= date && date <= p.endDate);
  if (category) promotions = promotions.filter((p) => p.category === category);
  if (platform) promotions = promotions.filter((p) => p.platforms.includes(platform));
  promotions.sort((a, b) => a.startDate.localeCompare(b.startDate));
  return okEnvelopeText(
    promotions,
    `电商大促日历汇编（${promoFile.year}，本地静态回退，未连接 MCP 服务器）· ${promoFile.source}`,
  );
}

function billMetadataExecute(args: Record<string, unknown>): string {
  const parsed = sessionSchemaSchema.safeParse(args);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (!issue) return failEnvelopeText("invalid_input", "sessionSchema 快照校验失败");
    const path = issue.path.length > 0 ? issue.path.join(".") : "根节点";
    return failEnvelopeText("invalid_input", `sessionSchema 快照校验失败（${path}）：${issue.message}`);
  }
  return okEnvelopeText(
    parsed.data satisfies SessionSchema,
    "客户端 DuckDB-WASM 会话快照（聚合元数据，本地回退校验，未连接 MCP 服务器）",
  );
}

export const FALLBACK_TOOLS: readonly FallbackToolImpl[] = [
  {
    name: "get_school_calendar",
    description:
      "查询 2026-2027 学年高校校历（考试周/假期/开学/毕业季），供消费洞察把季节性事件作为支出波动归因依据。入参可给 type/date/region，均为可选。",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["exam_week", "vacation", "term_start", "graduation"] },
        date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        region: { type: "string", maxLength: 32 },
      },
      additionalProperties: false,
    },
    execute: schoolCalendarExecute,
  },
  {
    name: "get_weather",
    description:
      "查询城市未来 3 或 7 天天气（和风天气）。入参 cityId 或 city 二选一，days 缺省为 3。",
    inputSchema: {
      type: "object",
      properties: {
        cityId: { type: "string", pattern: "^\\d{9}$" },
        city: { type: "string", maxLength: 32 },
        days: { type: "integer", enum: [3, 7] },
      },
      additionalProperties: false,
    },
    // 天气需要上游 API，本地回退不持有任何天气数据：诚实降级，绝不编造
    execute: () =>
      failEnvelopeText(
        "unavailable",
        "未连接 MCP 服务器，天气查询不可用（本地回退不含天气数据）",
      ),
  },
  {
    name: "get_promo_calendar",
    description:
      "查询 2026-2027 电商大促档期（双11/双12/年货节等），入参 date/category/platform 均为可选。用于消费建议中的比价时机提示与大促期支出归因。",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        category: { type: "string", maxLength: 32 },
        platform: { type: "string", maxLength: 32 },
      },
      additionalProperties: false,
    },
    execute: promoCalendarExecute,
  },
  {
    name: "query_bill_db_metadata",
    description:
      "接收前端 DuckDB-WASM 账单库的聚合元数据快照并回执（协议演示；只收聚合元数据，不接收明细行）。",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string", enum: ["transactions", "merchants"] },
        rowCount: { type: "integer", minimum: 0, maximum: 10_000_000 },
        datasetTxHash: { type: "string", pattern: "^[0-9a-f]{16,64}$" },
        schema: {
          type: "array",
          minItems: 1,
          maxItems: 64,
          items: {
            type: "object",
            properties: {
              name: { type: "string", pattern: "^[a-z_][a-z0-9_]{0,63}$" },
              type: { type: "string", maxLength: 32 },
              sample: { type: "string", maxLength: 128 },
            },
            required: ["name", "type", "sample"],
            additionalProperties: false,
          },
        },
        stats: { type: "array", maxItems: 64 },
      },
      required: ["table", "rowCount", "datasetTxHash", "schema", "stats"],
      additionalProperties: false,
    },
    execute: billMetadataExecute,
  },
];

const FALLBACK_BY_NAME = new Map(FALLBACK_TOOLS.map((toolImpl) => [toolImpl.name, toolImpl]));

export function getFallbackTool(name: string): FallbackToolImpl | undefined {
  return FALLBACK_BY_NAME.get(name as FallbackToolName);
}

/** 模型可调用的三工具（协议演示工具 query_bill_db_metadata 由路由确定性调用） */
export const LLM_FALLBACK_TOOL_NAMES: readonly FallbackToolName[] = [
  "get_school_calendar",
  "get_weather",
  "get_promo_calendar",
];
