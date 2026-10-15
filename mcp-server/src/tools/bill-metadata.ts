/**
 * 工具 query_bill_db_metadata：账单库元数据回执（契约见 docs/04-rag-mcp.md §8.4）。
 *
 * 这是协议演示性质的「数据不下云」工具：主站前端在 DuckDB-WASM 内完成
 * 账单聚合后，只把 schema/统计/指纹等聚合元数据快照传给 MCP 服务端，
 * 服务端校验通过后原样回执。设计红线：
 *   - 只接收聚合元数据（列名/类型/样例、min/max/mean/distinct 统计）；
 *   - 严格模式（strictObject）拒绝任何未声明的字段，明细行对象会因字段
 *     不匹配直接判为 invalid_input，从协议层面杜绝明细数据外泄；
 *   - 不落盘、不记录任何快照内容，回执后即弃。
 */
import { z } from "zod";
import { failResult, okResult, type ToolResult } from "../types.js";

/**
 * 前端 DuckDB-WASM 表名白名单（07 契约 §18 修订：bills|merchants → transactions|merchants，
 * 物理表只有 transactions 与 merchants 两张，07 §3 单一事实源）
 */
export const KNOWN_TABLES = ["transactions", "merchants"] as const;
export type KnownTable = (typeof KNOWN_TABLES)[number];

/** schema 列：仅聚合元数据，任何多余字段都会被 strictObject 拒绝 */
const schemaColumnShape = {
  name: z.string().regex(/^[a-z_][a-z0-9_]{0,63}$/, "列名需为小写 snake_case"),
  type: z.string().max(32),
  sample: z.string().max(128).describe("单值样例（截断后），不接收完整列值"),
};

/** 统计项：数值列为数字统计，枚举列允许字符串 min/max（如账期范围） */
const statShape = {
  column: z.string().regex(/^[a-z_][a-z0-9_]{0,63}$/, "列名需为小写 snake_case"),
  min: z.union([z.number(), z.string().max(64)]).optional(),
  max: z.union([z.number(), z.string().max(64)]).optional(),
  mean: z.number().optional(),
  distinct: z.number().int().nonnegative().optional(),
};

const schemaColumnSchema = z.strictObject(schemaColumnShape);
const statSchema = z.strictObject(statShape);

export const billDbMetadataSchema = z.strictObject({
  table: z.enum(KNOWN_TABLES),
  rowCount: z.number().int().min(0).max(10_000_000),
  datasetTxHash: z
    .string()
    .regex(/^[0-9a-f]{16,64}$/, "数据集指纹需为 16-64 位十六进制"),
  schema: z.array(schemaColumnSchema).min(1).max(64),
  stats: z.array(statSchema).max(64),
});

export type BillDbMetadata = z.infer<typeof billDbMetadataSchema>;

/** MCP inputSchema（原始 shape，SDK 层做宽松校验，工具内再严格复检） */
export const billDbMetadataInputShape = {
  table: z.enum(KNOWN_TABLES).describe("表名白名单：transactions / merchants"),
  rowCount: z
    .number()
    .int()
    .min(0)
    .max(10_000_000)
    .describe("行数统计（聚合值，不接收明细）"),
  datasetTxHash: z
    .string()
    .regex(/^[0-9a-f]{40,64}$/, "数据集指纹需为 40-64 位十六进制")
    .describe("导入数据集 SHA-256 指纹（取前 40 位以上）"),
  schema: z
    .array(schemaColumnSchema)
    .min(1)
    .max(64)
    .describe("列元数据：name/type/sample"),
  stats: z.array(statSchema).max(64).describe("列统计：column/min/max/mean/distinct"),
} as const;

export function queryBillDbMetadata(
  input: unknown,
): ToolResult<BillDbMetadata> {
  const parsed = billDbMetadataSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue.path.length > 0 ? issue.path.join(".") : "根节点";
    return failResult("invalid_input", `sessionSchema 快照校验失败（${path}）：${issue.message}`);
  }
  // 回执即弃：只返回校验后的快照本体与来源说明，不落任何日志
  return okResult(parsed.data, "客户端 DuckDB-WASM 会话快照（聚合元数据）");
}
