/**
 * 结果脱敏器（07 §5 唯一函数签名 + 加盐策略，全仓唯一实现，修订案 A12 落地）。
 *
 * 对一组查询结果行做五步脱敏（S1-S5，07 §5 逐条对应）：
 *   S1 金额分箱：仅对明细列 amount_cents 分箱（≤5元/…/>500元 标签）；
 *      聚合值（SUM/AVG 别名列）不分箱，仅四舍五入；
 *   S2 商户加盐哈希：merchant 列 → "m_" + sha256(商户名 + 盐) 前 8 位 hex；
 *   S3 禁列剥离：FORBIDDEN_COLUMNS（交易单号/外部单号/备注/对手方/原始引用）；
 *   S4 数值舍入：均值/标准差类列四舍五入 2 位小数；
 *   S5 行截断：超过 maxRows 只保留前 maxRows 行。
 *
 * 盐策略（07 §5 唯一）：盐 = 每次体检运行开始生成（crypto.randomUUID），
 * 浏览器端存 sessionStorage["spendct:salt"]，绝不落盘、不跨会话；服务端与
 * 测试环境每次调用取新盐。同一数据集两次运行的哈希不同（防彩虹表）。
 *
 * 与文档签名的差异（A12 修订）：sha256 依赖 WebCrypto 异步 API，函数返回
 * Promise<SanitizedResult>（哈希口径与 src/lib/import/clean-input.ts 的
 * sha256Hex 同源）；文档 §5 签名同步更新。
 */
import { sha256Hex } from "@/lib/import/clean-input";

/** 禁列清单（07 §5 S3）：交易单号 / 外部单号 / 备注 / 对手方 / 原始引用 */
export const FORBIDDEN_COLUMNS = ["tx_id", "external_id", "note", "counterparty", "raw_ref"] as const;

/** 默认金额分箱上限（元，07 §5 S1）：[0,5,10,20,50,100,200,500] */
export const DEFAULT_AMOUNT_BUCKETS = [0, 5, 10, 20, 50, 100, 200, 500] as const;

/** 浏览器端运行盐的 sessionStorage 键（07 §5 唯一键名） */
const RUN_SALT_KEY = "spendct:salt";

/** 脱敏选项（07 §5）：amountBuckets 与 merchantSalt 必填，其余有默认值 */
export interface SanitizerOptions {
  /** 分箱上限（元），默认 DEFAULT_AMOUNT_BUCKETS */
  amountBuckets?: number[];
  /** 本次运行盐（getRunSalt 取得；绝不落盘、不跨会话） */
  merchantSalt: string;
  /** 行数上限，默认 200（模板产物）/ 50（追问结果，由调用方传） */
  maxRows?: number;
  /** 禁列清单，默认 FORBIDDEN_COLUMNS */
  forbiddenColumns?: readonly string[];
}

/** 脱敏产物（07 §5）：行、列、已执行步骤、异常告警 */
export interface SanitizedResult {
  rows: Record<string, unknown>[];
  columns: string[];
  /** 实际执行的脱敏步骤（按执行顺序，供回答溯源面板展示） */
  applied: string[];
  /** 异常告警（如金额不可解析）：不阻断脱敏，如实报告 */
  warnings: string[];
}

/** 生成随机盐：优先 crypto.randomUUID，退化环境用时间戳+随机数拼接 */
function randomSalt(): string {
  const cryptoObj = globalThis.crypto;
  if (typeof cryptoObj?.randomUUID === "function") return cryptoObj.randomUUID();
  return `salt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 取本次运行盐（07 §5 盐策略唯一实现）：
 * 浏览器端读/写 sessionStorage（跨页面同会话共用、关闭即弃）；
 * 无 sessionStorage 的环境（服务端/测试）每次取新盐。
 */
export function getRunSalt(): string {
  if (typeof sessionStorage !== "undefined") {
    try {
      const existing = sessionStorage.getItem(RUN_SALT_KEY);
      if (existing) return existing;
      const salt = randomSalt();
      sessionStorage.setItem(RUN_SALT_KEY, salt);
      return salt;
    } catch {
      return randomSalt();
    }
  }
  return randomSalt();
}

/** 元金额（分）→ 分箱标签（07 §5 S1 标签口径） */
function bucketLabel(cents: number, buckets: number[]): string {
  const yuan = cents / 100;
  const sorted = [...buckets].sort((a, b) => a - b);
  for (const bound of sorted) {
    if (yuan <= bound) return `≤${bound}元`;
  }
  return `>${sorted[sorted.length - 1]}元`;
}

/** 四舍五入 2 位小数（07 §5 S4 口径） */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** 列是否为均值/标准差类聚合列（07 §5 S4：均值/标准差 2 位小数） */
function isStatColumn(column: string): boolean {
  return column.startsWith("avg_") || column.startsWith("stddev_") || column.startsWith("mean_");
}

/**
 * 结果脱敏主入口（07 §5 唯一函数）：五步全量执行，返回行、列与步骤报告。
 * 输入行不被修改：每一步都在拷贝上行进。
 */
export async function sanitizeResult(
  rows: Record<string, unknown>[],
  columns: string[],
  opts: SanitizerOptions,
): Promise<SanitizedResult> {
  const buckets = opts.amountBuckets && opts.amountBuckets.length > 0
    ? [...opts.amountBuckets].sort((a, b) => a - b)
    : [...DEFAULT_AMOUNT_BUCKETS];
  const forbidden = opts.forbiddenColumns ?? FORBIDDEN_COLUMNS;
  const maxRows = opts.maxRows ?? 200;
  const applied: string[] = [];
  const warnings: string[] = [];

  // S3 禁列剥离：先于其余步骤，禁列内容不参与任何后续处理
  const keptColumns = columns.filter((column) => !forbidden.includes(column));
  const stripped = columns.filter((column) => forbidden.includes(column));
  if (stripped.length > 0) {
    applied.push(`forbidden-stripped:${stripped.join(",")}`);
  }

  // S5 行截断：截断先执行，后续哈希/分箱只处理保留行（省算力也守上限）
  let keptRows = rows;
  if (rows.length > maxRows) {
    keptRows = rows.slice(0, maxRows);
    applied.push(`truncated:${maxRows}`);
  }

  // S1 金额分箱 + S4 数值舍入：金额列按明细/聚合口径分别处理
  const hasDetailAmount = keptColumns.includes("amount_cents");
  let bucketedCount = 0;
  let roundedCount = 0;

  // S2 商户加盐哈希：预计算每行的哈希（sha256 为异步，逐行 await）
  const hasMerchant = keptColumns.includes("merchant");
  const merchantHashes = new Map<string, string>();
  if (hasMerchant) {
    for (const row of keptRows) {
      const merchant = row.merchant;
      if (typeof merchant !== "string" || merchant.length === 0) continue;
      if (!merchantHashes.has(merchant)) {
        const digest = await sha256Hex(`${merchant}${opts.merchantSalt}`);
        merchantHashes.set(merchant, `m_${digest.slice(0, 8)}`);
      }
    }
  }

  const outRows = keptRows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const column of keptColumns) {
      const value = row[column];
      if (column === "amount_cents" && typeof value === "number" && Number.isFinite(value)) {
        out[column] = bucketLabel(value, buckets);
        bucketedCount += 1;
      } else if (column === "merchant" && typeof value === "string") {
        out[column] = value.length > 0 ? (merchantHashes.get(value) ?? value) : value;
      } else if (isStatColumn(column) && typeof value === "number" && Number.isFinite(value)) {
        out[column] = round2(value);
        roundedCount += 1;
      } else if (typeof value === "number" && !Number.isFinite(value)) {
        // 非有限数值（NaN/Infinity）：置空并告警，不让脏值流出
        out[column] = null;
        warnings.push(`non-finite:${column}`);
      } else {
        out[column] = value;
      }
    }
    return out;
  });

  if (hasDetailAmount && bucketedCount > 0) {
    applied.push(`amount-bucketed:${bucketedCount}rows`);
  }
  if (hasMerchant) applied.push("merchant-hashed:merchant");
  if (roundedCount > 0) applied.push(`rounded:${roundedCount}cells`);

  return { rows: outRows, columns: keptColumns, applied, warnings };
}
