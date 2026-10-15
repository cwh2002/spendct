/**
 * 账单库聚合元数据快照（sessionSchema）类型与校验（07 契约 §18 / 04 §8.4）。
 *
 * 随 /api/followup 请求体传递（per-request，服务端不落盘），是 MCP 协议演示工具
 * query_bill_db_metadata 的输入。口径红线：
 *   - 只含聚合元数据（列名/类型/样例、统计），不含明细行；
 *   - 与 MCP 服务端工具（mcp-server/src/tools/bill-metadata.ts）的校验 schema
 *     保持镜像一致——本文件是浏览器构建侧，MCP 侧是严格校验侧。
 */
import { z } from "zod";

/** schema 列元数据（name/type/sample 三字段，多字段即视为明细注入，服务端会拒绝） */
export const sessionSchemaColumnShape = {
  name: z.string().regex(/^[a-z_][a-z0-9_]{0,63}$/, "列名需为小写 snake_case"),
  type: z.string().max(32),
  sample: z.string().max(128).describe("单值样例（截断后）"),
};

/** 列统计项（数值列给数字统计，枚举列允许字符串 min/max） */
export const sessionSchemaStatShape = {
  column: z.string().regex(/^[a-z_][a-z0-9_]{0,63}$/, "列名需为小写 snake_case"),
  min: z.union([z.number(), z.string().max(64)]).optional(),
  max: z.union([z.number(), z.string().max(64)]).optional(),
  mean: z.number().optional(),
  distinct: z.number().int().nonnegative().optional(),
};

export const SESSION_SCHEMA_TABLES = ["transactions", "merchants"] as const;

/** 快照本体（与 MCP 工具 inputSchema 镜像，服务端以 strictObject 严格复检） */
export const sessionSchemaSchema = z.strictObject({
  table: z.enum(SESSION_SCHEMA_TABLES),
  rowCount: z.number().int().min(0).max(10_000_000),
  // 口径：与导入层 hashCleanRows 一致（SHA-256 前 16 位十六进制），放宽到 16-64 位
  datasetTxHash: z
    .string()
    .regex(/^[0-9a-f]{16,64}$/, "数据集指纹需为 16-64 位十六进制"),
  schema: z.array(z.strictObject(sessionSchemaColumnShape)).min(1).max(64),
  stats: z.array(z.strictObject(sessionSchemaStatShape)).max(64),
});

export type SessionSchema = z.infer<typeof sessionSchemaSchema>;
