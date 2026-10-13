/**
 * 账单 CSV 解析（T3/T4：微信/支付宝嗅探，07 契约 §9/§15）。
 *
 * 职责边界：
 * - 本模块只做「文本 → BillRow」的结构化解析。字节 → 文本的编码解码链
 *   （TextDecoder 探测，07 §9）由读取文件的调用方完成；这里只识别已解码
 *   文本中的乱码痕迹，并给出面向用户的提示；
 * - 金额在此处收敛为整数分（07 §3 全项目唯一金额单位）；
 * - 商户分类不在这里做：解析期统一落「其他」，clean 阶段按商户词典细分。
 */
import Papa from "papaparse";

import type { BillRow, ParseResult } from "./types";

/** 标准输出列顺序（与 importBillCsv 的 read_csv_auto 建表列一致） */
export const STANDARD_COLUMNS = [
  "date_iso",
  "category",
  "merchant",
  "channel",
  "direction",
  "amount_cents",
] as const;

/** 12 类目兜底值（07 §3 类目枚举；分类在 clean 阶段完成） */
const DEFAULT_CATEGORY = "其他";

/** 编码提示文案：上传页直接渲染，保持唯一措辞 */
const ENCODING_WARNING = "文件可能是 GBK/GB2312 编码，请用记事本另存为 UTF-8 后重试";

type CanonicalField =
  | "datetime" // 同时产出 dateIso 与 timeIso
  | "date" // 只产出 dateIso
  | "amount"
  | "direction"
  | "merchant"
  | "note"
  | "rawRef"
  | "refund" // 支付宝「成功退款」列：金额 > 0 即退款行
  | "status" // 辅助列：渠道识别与退款判断用，不产出字段
  | "type"; // 辅助列：同上

/** 微信/支付宝常见表头别名表。键是 normalizeHeader 之后的形态（小写、去空白、全角括号转半角） */
const HEADER_ALIASES: Record<string, CanonicalField> = {
  // 日期时间
  交易时间: "datetime",
  交易创建时间: "datetime",
  付款时间: "datetime",
  支付时间: "datetime",
  记账时间: "datetime",
  时间: "datetime",
  交易日期: "date",
  日期: "date",
  // 金额
  "金额(元)": "amount",
  金额: "amount",
  交易金额: "amount",
  实收金额: "amount",
  // 方向
  "收/支": "direction",
  收支: "direction",
  资金流向: "direction",
  // 商户
  交易对方: "merchant",
  对方: "merchant",
  商户: "merchant",
  商户名称: "merchant",
  // 说明
  商品: "note",
  商品名称: "note",
  商品说明: "note",
  备注: "note",
  // 单号
  交易单号: "rawRef",
  商户单号: "rawRef",
  交易号: "rawRef",
  商家订单号: "rawRef",
  // 退款金额（辅助）
  "成功退款(元)": "refund",
  // 状态/类型（辅助，只用于渠道识别与退款判断）
  当前状态: "status",
  交易状态: "status",
  资金状态: "status",
  交易类型: "type",
  类型: "type",
};

/** 规范化字段 → 标准列名。辅助列（status/type/refund）不进入 mapping，避免预览 UI 噪音 */
const FIELD_TO_STANDARD: Partial<Record<CanonicalField, string>> = {
  datetime: "dateIso",
  date: "dateIso",
  amount: "amountCents",
  direction: "direction",
  merchant: "merchant",
  note: "note",
  rawRef: "rawRef",
};

/** 微信导出列位置（07 §15 字段清单顺序）：首行无表头时按位置兜底 */
const WECHAT_POSITIONS: (CanonicalField | null)[] = [
  "datetime", // 交易时间
  "type", // 交易类型
  "merchant", // 交易对方
  "note", // 商品
  "direction", // 收/支
  "amount", // 金额(元)
  null, // 支付方式
  "status", // 当前状态
  "rawRef", // 交易单号
  null, // 商户单号
  "note", // 备注
];

/** 支付宝导出列位置（常见 16 列形态）：首行无表头时按位置兜底 */
const ALIPAY_POSITIONS: (CanonicalField | null)[] = [
  "rawRef", // 交易号
  null, // 商家订单号
  "datetime", // 交易创建时间
  null, // 付款时间（与创建时间重复，取前者）
  null, // 最近修改时间
  null, // 交易来源地
  "type", // 类型
  "merchant", // 交易对方
  "note", // 商品名称
  "amount", // 金额（元）
  "direction", // 收/支
  "status", // 交易状态
  null, // 服务费（元）
  "refund", // 成功退款（元）
  "note", // 备注
  null, // 资金状态
];

interface ColumnMap {
  datetime: number[];
  date: number[];
  amount: number[];
  direction: number[];
  merchant: number[];
  note: number[];
  rawRef: number[];
  refund: number[];
  status: number[];
  type: number[];
}

function emptyColumnMap(): ColumnMap {
  return {
    datetime: [],
    date: [],
    amount: [],
    direction: [],
    merchant: [],
    note: [],
    rawRef: [],
    refund: [],
    status: [],
    type: [],
  };
}

/** 表头别名大小写与空格不敏感；全角括号与半角括号等价（支付宝用（），微信用 ()） */
function normalizeHeader(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\s　]+/g, "")
    .replace(/（/g, "(")
    .replace(/）/g, ")");
}

const DATE_TIME_PATTERN =
  /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[\sT]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/;

/**
 * 解析账单时间列。支持 "2026-01-05 12:34:56"、"2026/1/5 12:34"、"2026-01-05" 等形态，
 * 输出恒定补零的 ISO 形态，保证 DuckDB 列内格式一致。
 */
export function parseBillDateTime(raw: string): { dateIso: string; timeIso?: string } | null {
  const match = DATE_TIME_PATTERN.exec(raw.trim());
  if (!match) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dateIso = `${match[1]}-${match[2]!.padStart(2, "0")}-${match[3]!.padStart(2, "0")}`;
  if (match[4] === undefined) return { dateIso };
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] ?? "00";
  if (hour > 23 || minute > 59 || Number(second) > 59) return null;
  return {
    dateIso,
    timeIso: `${match[4]!.padStart(2, "0")}:${match[5]!.padStart(2, "0")}:${second.padStart(2, "0")}`,
  };
}

/** 金额 → 整数分。支持 ¥/￥ 前缀、千分位逗号与负号；无法解析返回 null（负数原样保留供退款判断） */
function parseAmountCents(raw: string): number | null {
  const cleaned = raw.replace(/[¥￥,，\s]/g, "");
  if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/**
 * 乱码痕迹识别：U+FFFD 替换符直接命中；GBK 字节被按 Latin-1 解码时会出现
 * 连续高位字符（如「½ð¶î」），作为特征兜底。只提示、不阻断解析。
 */
function looksGarbled(text: string): boolean {
  if (text.includes("�")) return true;
  return /[ -ÿ]{2,}/.test(text.slice(0, 4000));
}

/** 取某字段在行内的第一个非空值；「/」是微信导出的「无」占位符，视为空 */
function pick(cells: string[], indices: number[]): string {
  for (const index of indices) {
    const value = (cells[index] ?? "").trim();
    if (value !== "" && value !== "/") return value;
  }
  return "";
}

type RowOutcome =
  { kind: "row"; row: BillRow } | { kind: "skip"; reason: "badDate" | "badAmount" | "zeroAmount" };

function buildBillRow(cells: string[], map: ColumnMap, channel: BillRow["channel"]): RowOutcome {
  const datetimeRaw = pick(cells, [...map.datetime, ...map.date]);
  const parsedTime = parseBillDateTime(datetimeRaw);
  if (!parsedTime) return { kind: "skip", reason: "badDate" };

  const amountRaw = pick(cells, map.amount);
  const signedCents = parseAmountCents(amountRaw);
  if (signedCents === null) return { kind: "skip", reason: "badAmount" };
  const amountCents = Math.abs(signedCents);
  if (amountCents === 0) return { kind: "skip", reason: "zeroAmount" };

  const statusRaw = pick(cells, map.status);
  const typeRaw = pick(cells, map.type);
  const refundRaw = pick(cells, map.refund);
  const refundCents = parseAmountCents(refundRaw) ?? 0;
  // 退款行按支出方向记账（钱已流出，退款是回补），note 打前缀标记，
  // clean 阶段据此匹配原订单做冲销
  const isRefund =
    signedCents < 0 || refundCents > 0 || /退款/.test(statusRaw) || /退款/.test(typeRaw);

  const directionRaw = pick(cells, map.direction);
  const direction: BillRow["direction"] = isRefund
    ? "expense"
    : directionRaw.includes("收入")
      ? "income"
      : "expense";

  const merchant = pick(cells, map.merchant);
  const rawRef = pick(cells, map.rawRef);
  const noteRaw = pick(cells, map.note);

  return {
    kind: "row",
    row: {
      dateIso: parsedTime.dateIso,
      timeIso: parsedTime.timeIso,
      category: DEFAULT_CATEGORY,
      merchant,
      channel,
      direction,
      amountCents,
      rawRef: rawRef === "" ? undefined : rawRef,
      note: isRefund
        ? `[退款]${noteRaw === "" ? "" : ` ${noteRaw}`}`
        : noteRaw === ""
          ? undefined
          : noteRaw,
    },
  };
}

function matchHeaders(cells: string[]): {
  map: ColumnMap;
  mapping: Record<string, string>;
  normalized: string[];
  matchedCount: number;
} {
  const map = emptyColumnMap();
  const mapping: Record<string, string> = {};
  const normalized: string[] = [];
  for (const [index, raw] of cells.entries()) {
    const key = normalizeHeader(raw ?? "");
    normalized.push(key);
    const field = HEADER_ALIASES[key];
    if (!field) continue;
    map[field].push(index);
    const standard = FIELD_TO_STANDARD[field];
    if (standard) mapping[raw!.trim()] = standard;
  }
  return { map, mapping, normalized, matchedCount: Object.keys(mapping).length };
}

interface ChannelInfo {
  channel: BillRow["channel"] | null;
  /** marker=表头渠道标识列命中；file=靠文件名猜；none=无法确定 */
  source: "marker" | "file" | "none";
}

function detectChannel(normalizedHeaders: string[], fileName: string): ChannelInfo {
  const has = (key: string) => normalizedHeaders.includes(key);
  // 渠道专属列：微信有「商户单号/当前状态」，支付宝有「商家订单号/资金状态」等
  const wechatMarker = has("商户单号") || has("当前状态");
  const alipayMarker =
    has("商家订单号") || has("资金状态") || has("交易来源地") || has("最近修改时间");
  if (wechatMarker && !alipayMarker) return { channel: "wechat", source: "marker" };
  if (alipayMarker && !wechatMarker) return { channel: "alipay", source: "marker" };
  if (/wechat|微信/i.test(fileName)) return { channel: "wechat", source: "file" };
  if (/alipay|支付宝/i.test(fileName)) return { channel: "alipay", source: "file" };
  return { channel: null, source: "none" };
}

function pickPositional(colCount: number): {
  map: ColumnMap;
  mapping: Record<string, string>;
  layout: "wechat" | "alipay";
} {
  // 支付宝 16 列 vs 微信 11 列：14 是两者之间无歧义的分界
  const layout: "wechat" | "alipay" = colCount >= 14 ? "alipay" : "wechat";
  const positions = layout === "alipay" ? ALIPAY_POSITIONS : WECHAT_POSITIONS;
  const map = emptyColumnMap();
  const mapping: Record<string, string> = {};
  positions.forEach((field, index) => {
    if (!field) return;
    map[field].push(index);
    const standard = FIELD_TO_STANDARD[field];
    if (standard) mapping[`第${index + 1}列`] = standard;
  });
  return { map, mapping, layout };
}

/** 判断首行是否是数据行：任一单元格像日期 且 任一单元格像金额 */
function rowHasDateAndAmount(cells: string[]): boolean {
  const hasDate = cells.some((cell) => parseBillDateTime((cell ?? "").trim()) !== null);
  const hasAmount = cells.some((cell) => parseAmountCents(cell ?? "") !== null);
  return hasDate && hasAmount;
}

/**
 * 解析账单 CSV 文本。
 * 主链路：表头别名嗅探 → 渠道识别 → 逐行结构化 → 重复计数；
 * 兜底：首行直接是数据时按微信/支付宝列位置规则解析并降置信度。
 */
export function parseBillCsv(text: string, fileName: string): ParseResult {
  const warnings: string[] = [];

  // Excel 另存 UTF-8 的文件常带 BOM，不去掉会污染第一个表头名
  const stripped = text.replace(/^﻿/, "");
  const garbled = looksGarbled(stripped);
  if (garbled) warnings.push(ENCODING_WARNING);

  const parsed = Papa.parse<string[]>(stripped, { skipEmptyLines: "greedy" });
  if (parsed.errors.length > 0) {
    const firstErrorLine = (parsed.errors[0]?.row ?? 0) + 1;
    warnings.push(
      `CSV 结构异常 ${parsed.errors.length} 处（首次出现在第 ${firstErrorLine} 行附近），异常行之后的内容可能不完整`,
    );
  }

  const lines = parsed.data;
  if (lines.length === 0) {
    return {
      format: "unknown",
      confidence: "low",
      rows: [],
      warnings: [...warnings, "文件为空或没有任何数据行"],
      mapping: {},
    };
  }

  const firstLine = lines[0] ?? [];
  const headerMatch = matchHeaders(firstLine);

  let map: ColumnMap;
  let mapping: Record<string, string>;
  let channelInfo: ChannelInfo;
  let positional = false;
  let dataStart = 1;

  if (headerMatch.matchedCount >= 2) {
    map = headerMatch.map;
    mapping = headerMatch.mapping;
    channelInfo = detectChannel(headerMatch.normalized, fileName);
  } else if (rowHasDateAndAmount(firstLine)) {
    // 首行直接是数据（表头被裁掉/手工拼接的文件）：按列数走位置规则，置信度降档
    const fallback = pickPositional(firstLine.length);
    map = fallback.map;
    mapping = fallback.mapping;
    channelInfo = { channel: fallback.layout, source: "marker" };
    positional = true;
    dataStart = 0;
    warnings.push(
      `首行不是表头，已按${fallback.layout === "wechat" ? "微信" : "支付宝"}列位置规则解析，请在预览页确认字段映射`,
    );
  } else {
    return {
      format: "unknown",
      confidence: "low",
      rows: [],
      warnings: [...warnings, "无法识别为微信或支付宝账单，请确认导出文件的表头结构"],
      mapping: {},
    };
  }

  if (channelInfo.channel === null) {
    return {
      format: "unknown",
      confidence: "low",
      rows: [],
      warnings: [
        ...warnings,
        "无法确定账单来源渠道：表头缺少「商户单号」「商家订单号」等渠道标识列，文件名也未能提示渠道",
      ],
      mapping,
    };
  }
  const channel = channelInfo.channel;

  const skipCounts = { badDate: 0, badAmount: 0, zeroAmount: 0 };
  const rows: BillRow[] = [];
  for (let lineIndex = dataStart; lineIndex < lines.length; lineIndex++) {
    const outcome = buildBillRow(lines[lineIndex] ?? [], map, channel);
    if (outcome.kind === "row") rows.push(outcome.row);
    else skipCounts[outcome.reason] += 1;
  }

  if (skipCounts.badDate > 0) warnings.push(`跳过 ${skipCounts.badDate} 行：日期无法解析`);
  if (skipCounts.badAmount > 0) warnings.push(`跳过 ${skipCounts.badAmount} 行：金额无法解析`);
  if (skipCounts.zeroAmount > 0) {
    warnings.push(`跳过 ${skipCounts.zeroAmount} 行：金额为 0（多为不计收支的转账/红包）`);
  }

  const duplicateCount = countDuplicates(rows);
  if (duplicateCount > 0) {
    warnings.push(`检测到 ${duplicateCount} 条疑似重复记录，导入时将去重`);
  }

  let confidence: ParseResult["confidence"] = "high";
  if (garbled || positional) {
    confidence = "low";
  } else if (
    channelInfo.source === "file" ||
    map.direction.length === 0 ||
    map.merchant.length === 0
  ) {
    // 渠道靠文件名猜、方向/商户列缺失靠默认值：预览页必须人工确认
    confidence = "medium";
  }

  return { format: channel, confidence, rows, warnings, mapping };
}

function duplicateKey(row: BillRow): string {
  return `${row.dateIso}\u0000${row.amountCents}\u0000${row.merchant}`;
}

function countDuplicates(rows: BillRow[]): number {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const row of rows) {
    const key = duplicateKey(row);
    if (seen.has(key)) duplicates += 1;
    else seen.add(key);
  }
  return duplicates;
}

/** 按 (dateIso, amountCents, merchant) 去重，保留首次出现，维持原顺序 */
export function stripDuplicates(rows: BillRow[]): BillRow[] {
  const seen = new Set<string>();
  const kept: BillRow[] = [];
  for (const row of rows) {
    const key = duplicateKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(row);
  }
  return kept;
}

/** 输出标准列 CSV（供 importBillCsv 走 read_csv_auto 建表），字段按需转义 */
export function buildCleanCsv(rows: BillRow[]): string {
  const lines = [STANDARD_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(
      [row.dateIso, row.category, row.merchant, row.channel, row.direction, String(row.amountCents)]
        .map(escapeCsvCell)
        .join(","),
    );
  }
  return lines.join("\n");
}

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
