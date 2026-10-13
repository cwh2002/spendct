/**
 * SQL 聚合白名单——全仓唯一实现（07 契约 §6，规则全文以 02 §6 R1-R10 为准）。
 *
 * 只放行一个极窄的文法子集：
 *   SELECT <分组键 | 聚合函数> FROM <单一白名单关系>
 *   [WHERE 简单比较表达式] [GROUP BY ≤3 列] [HAVING 聚合过滤]
 *   [ORDER BY 分组键|聚合] [LIMIT ≤50]
 * 其余一律拒绝：多语句 / 子查询 / UNION / JOIN / WITH / DDL / PRAGMA / 注释 / 明细列投影。
 *
 * 任何 ok:false 直接拒绝执行。Worker 超时 3s 中断（10s 强杀在 DuckDB 调用层，01 §1.5）。
 */
import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import { z } from "zod";

/** 允许的 9 个聚合函数（07 §6，大写规范；比较前统一大写） */
export const ALLOWED_AGGREGATES = [
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "STDDEV",
  "MEDIAN",
  "MODE",
  "ROUND",
] as const;

/** 允许的分组维度列（02 §6.2 清单唯一；ym 为预算三表月份维度，08 修订案 A2） */
export const ALLOWED_DIMENSIONS = [
  "account_id",
  "month",
  "category",
  "sub_category",
  "merchant",
  "channel",
  "direction",
  "status",
  "date_iso",
  "year",
  "ym",
] as const;

/** 身份信息列：永不可出现在任何 SQL 位置（02 §6.2） */
export const FORBIDDEN_COLUMNS = [
  "tx_id",
  "external_id",
  "note",
  "counterparty",
  "raw_ref",
] as const;

/**
 * 白名单关系 = transactions + 13 视图 + 9 张六阶段预计算表 + 预算三表（07 §6 唯一清单）。
 * 预计算表必须注册，否则模板优先主流程会被白名单拒绝（#43）。
 */
export const ALLOWED_RELATIONS = [
  "transactions",
  "v_monthly_summary",
  "v_category_monthly",
  "v_merchant_monthly",
  "v_daily_expense",
  "v_merchant_periodic",
  "v_subscription_candidates",
  "v_anomaly_daily",
  "v_top_merchants_90d",
  "v_mom_category",
  "v_yearly",
  "v_impulse_events",
  "v_night_spend",
  "v_health_inputs",
  "clean_overview",
  "profile_category_stats",
  "profile_merchant_stats",
  "profile_monthly_stats",
  "anomaly_daily_stats",
  "anomaly_merchant_stats",
  "subscription_patterns",
  "attribution_mom_stats",
  "annual_summary",
  "budgets",
  "budget_vs_actual",
  "forecast_monthly",
] as const;

/** DDL / 写操作黑名单（06 §2.0 清单 + REINDEX，#73），按整词匹配、忽略大小写 */
const DEFAULT_BANNED_KEYWORDS = [
  "DELETE",
  "INSERT",
  "UPDATE",
  "DROP",
  "ALTER",
  "CREATE",
  "PRAGMA",
  "ATTACH",
  "DETACH",
  "COPY",
  "EXPORT",
  "IMPORT",
  "VACUUM",
  "REINDEX",
];

export const DEFAULT_AGGREGATE_POLICY = {
  maxResultRows: 50, // 固定 50：追问 SQL 行数上限（07 §7 追问档）
  maxGroupByCols: 3,
  allowedAggFns: [...ALLOWED_AGGREGATES],
  bannedKeywords: DEFAULT_BANNED_KEYWORDS,
  maxSqlLength: 4000, // 统一 4000 字符（07 §6）
} as const;

export interface AggregatePolicy {
  maxResultRows: number;
  maxGroupByCols: number;
  allowedAggFns: readonly string[];
  bannedKeywords: readonly string[];
  maxSqlLength: number;
}

/** policy 运行时校验（06 §2.0 的 policy 参数形态；zod 4 默认拒绝未知字段） */
export const AggregatePolicySchema = z.object({
  maxResultRows: z.number().int().default(DEFAULT_AGGREGATE_POLICY.maxResultRows),
  maxGroupByCols: z.number().int().min(1).max(3).default(DEFAULT_AGGREGATE_POLICY.maxGroupByCols),
  allowedAggFns: z
    .array(z.enum(ALLOWED_AGGREGATES))
    .default([...DEFAULT_AGGREGATE_POLICY.allowedAggFns]),
  bannedKeywords: z.array(z.string()).default([...DEFAULT_AGGREGATE_POLICY.bannedKeywords]),
  maxSqlLength: z.number().int().default(DEFAULT_AGGREGATE_POLICY.maxSqlLength),
});

export type WhitelistVerdict =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "NO_GROUP_BY" // 必须 GROUP BY（R1）
        | "SELECT_STAR" // 禁 SELECT *（R2）
        | "DETAIL_COLUMN" // 禁明细列投影：SELECT 只能出现分组键与聚合函数（R3）
        | "BANNED_KEYWORD" // 命中 DDL/写操作黑名单（R4）
        | "UNSUPPORTED_SYNTAX" // 子查询/UNION/CTE/多语句等一律拒绝（R5）
        | "ROW_LIMIT_EXCEEDED" // 结果行数超上限（R6，执行后二次校验）
        | "PARSE_ERROR";
    };

/** 白名单拒绝错误：runWhitelistedAggregate 在拒绝时抛出，携带 reason 供流水线映射事件 */
export class WhitelistRejectedError extends Error {
  readonly reason: NonNullable<Extract<WhitelistVerdict, { ok: false }>["reason"]>;

  constructor(reason: WhitelistRejectedError["reason"], detail: string) {
    super(`${reason}: ${detail}`);
    this.name = "WhitelistRejectedError";
    this.reason = reason;
  }
}

// ─────────────────────────── 词法 ───────────────────────────

type Token =
  | { kind: "word"; value: string }
  | { kind: "string"; value: string }
  | { kind: "number"; value: number }
  | { kind: "op"; value: string }
  | { kind: "eof" };

// 词法层只做字符识别，尽量不在此层拒绝：/ . + - ; 等留给语法层判 UNSUPPORTED_SYNTAX
const OPERATORS = [
  "(",
  ")",
  ",",
  "=",
  "!=",
  "<>",
  "<",
  "<=",
  ">",
  ">=",
  "*",
  "/",
  "+",
  "-",
  ".",
  ";",
];

function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "'") {
      // 字符串字面量：'' 为转义单引号
      let value = "";
      i++;
      while (i < sql.length) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            value += "'";
            i += 2;
            continue;
          }
          i++;
          break;
        }
        value += sql[i];
        i++;
      }
      if (i > sql.length || sql[i - 1] !== "'") {
        throw new Error("未闭合的字符串字面量");
      }
      tokens.push({ kind: "string", value });
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let num = "";
      while (i < sql.length && /[0-9]/.test(sql[i]!)) {
        num += sql[i];
        i++;
      }
      tokens.push({ kind: "number", value: Number.parseInt(num, 10) });
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let word = "";
      while (i < sql.length && /[A-Za-z0-9_]/.test(sql[i]!)) {
        word += sql[i];
        i++;
      }
      tokens.push({ kind: "word", value: word });
      continue;
    }
    const two = sql.slice(i, i + 2);
    if (OPERATORS.includes(two)) {
      tokens.push({ kind: "op", value: two });
      i += 2;
      continue;
    }
    if (OPERATORS.includes(ch)) {
      tokens.push({ kind: "op", value: ch });
      i++;
      continue;
    }
    throw new Error(`无法识别的字符「${ch}」`);
  }
  tokens.push({ kind: "eof" });
  return tokens;
}

// ─────────────────────────── 语法 ───────────────────────────

interface SelectItem {
  kind: "column" | "aggregate" | "star";
  name: string; // 聚合函数名（大写）或列名
  args: string[]; // aggregate: 列名列表（COUNT(*) → ["*"]；ROUND 支持第二参数）
}

interface ParsedStatement {
  relation: string;
  selectItems: SelectItem[];
  groupBy: string[];
  whereTokens: Token[] | null;
  havingTokens: Token[] | null;
  orderBy: { name: string; args: string[]; dir: "ASC" | "DESC" }[];
  limit: number | null;
}

class Parser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.pos]!;
  }

  private next(): Token {
    return this.tokens[this.pos++]!;
  }

  /**
   * 消费一个标识符 token 并收窄类型。调用方需已通过 peek 确认当前是标识符，
   * 此处的 kind 检查属于防御兜底，正常语法路径不会触发。
   */
  private nextWord(): Extract<Token, { kind: "word" }> {
    const t = this.next();
    if (t.kind !== "word") {
      throw new Error("预期标识符");
    }
    return t;
  }

  private expectOp(value: string): void {
    const t = this.next();
    if (t.kind !== "op" || t.value !== value) {
      throw new Error(`期望「${value}」`);
    }
  }

  private isWord(value: string): boolean {
    const t = this.peek();
    return t.kind === "word" && t.value.toUpperCase() === value;
  }

  private takeWordIf(value: string): boolean {
    if (this.isWord(value)) {
      this.next();
      return true;
    }
    return false;
  }

  /** 逗号、括号等是 op token，不是 word——列表分隔要用这个方法而不是 takeWordIf */
  private takeOpIf(value: string): boolean {
    const t = this.peek();
    if (t.kind === "op" && t.value === value) {
      this.next();
      return true;
    }
    return false;
  }

  private expectClauseWord(value: string): void {
    if (!this.takeWordIf(value)) {
      throw new Error(`期望子句关键字「${value}」`);
    }
  }

  parse(): ParsedStatement {
    this.expectClauseWord("SELECT");

    // selectList：分组键列 | 聚合函数 | （仅 COUNT 允许 *）
    const selectItems: SelectItem[] = [];
    for (;;) {
      const t = this.peek();
      if (t.kind === "op" && t.value === "*") {
        // 裸 * 只有当它是聚合参数时合法，这里直接拒绝 SELECT *
        throw new Error("SELECT * 被禁止");
      }
      if (t.kind !== "word") {
        throw new Error("SELECT 列表只能包含列或聚合函数");
      }
      const rawName = this.nextWord().value;
      // 规范：聚合函数名统一大写，列名统一小写（SQL 标识符大小写不敏感）
      const ahead = this.peek();
      if (ahead.kind === "op" && ahead.value === "(") {
        selectItems.push(this.parseAggregate(rawName.toUpperCase()));
      } else {
        selectItems.push({ kind: "column", name: rawName.toLowerCase(), args: [] });
      }
      if (!this.takeOpIf(",")) break;
    }

    this.expectClauseWord("FROM");
    const relToken = this.next();
    if (relToken.kind !== "word") {
      throw new Error("FROM 后必须是单一关系名");
    }
    // SQL 标识符大小写不敏感，统一小写后与白名单比对（清单均为小写）
    const relation = relToken.value.toLowerCase();

    let whereTokens: Token[] | null = null;
    const groupBy: string[] = [];
    let havingTokens: Token[] | null = null;
    const orderBy: ParsedStatement["orderBy"] = [];
    let limit: number | null = null;

    while (this.peek().kind !== "eof") {
      if (this.takeWordIf("WHERE")) {
        whereTokens = this.collectExprTokens();
      } else if (this.takeWordIf("GROUP")) {
        this.expectClauseWord("BY");
        for (;;) {
          const col = this.next();
          if (col.kind !== "word") {
            throw new Error("GROUP BY 后必须是列名");
          }
          groupBy.push(col.value.toLowerCase());
          if (!this.takeOpIf(",")) break;
        }
      } else if (this.takeWordIf("HAVING")) {
        havingTokens = this.collectExprTokens();
      } else if (this.takeWordIf("ORDER")) {
        this.expectClauseWord("BY");
        for (;;) {
          const t = this.peek();
          if (t.kind !== "word") {
            throw new Error("ORDER BY 后必须是列或聚合函数");
          }
          const rawName = this.nextWord().value;
          let name = rawName.toUpperCase();
          const args: string[] = [];
          const ahead = this.peek();
          if (ahead.kind === "op" && ahead.value === "(") {
            // 仅允许聚合函数出现在 ORDER BY
            this.expectOp("(");
            for (;;) {
              const arg = this.next();
              if (arg.kind !== "word" && !(arg.kind === "op" && arg.value === "*")) {
                throw new Error("ORDER BY 聚合参数非法");
              }
              args.push(arg.kind === "word" ? arg.value.toLowerCase() : "*");
              if (!this.takeOpIf(",")) break;
            }
            this.expectOp(")");
          } else {
            name = rawName.toLowerCase();
          }
          let dir: "ASC" | "DESC" = "ASC";
          if (this.isWord("ASC") || this.isWord("DESC")) {
            const dirToken = this.next();
            if (dirToken.kind !== "word") {
              throw new Error("ORDER BY 方向必须是 ASC 或 DESC");
            }
            dir = dirToken.value.toUpperCase() as "ASC" | "DESC";
          }
          orderBy.push({ name, args, dir });
          if (!this.takeOpIf(",")) break;
        }
      } else if (this.takeWordIf("LIMIT")) {
        const n = this.next();
        if (n.kind !== "number") {
          throw new Error("LIMIT 后必须是整数");
        }
        limit = n.value;
      } else {
        const t = this.peek();
        if (t.kind === "op" && t.value === ";") {
          throw new Error("多语句被禁止");
        }
        const label = t.kind === "eof" ? "EOF" : t.value;
        throw new Error(`意外的关键字「${label}」`);
      }
    }

    return { relation, selectItems, groupBy, whereTokens, havingTokens, orderBy, limit };
  }

  private parseAggregate(fnName: string): SelectItem {
    this.expectOp("(");
    const args: string[] = [];
    for (;;) {
      const t = this.peek();
      if (t.kind === "op" && t.value === "*") {
        this.next();
        args.push("*");
      } else if (t.kind === "word") {
        const word = this.nextWord();
        const ahead = this.peek();
        if (ahead.kind === "op" && ahead.value === "(") {
          // 支持一层嵌套：ROUND(AVG(amount_cents), 2)。
          // 内层函数名（大写）与参数（小写列名）并入同一列表，校验阶段统一筛查身份列。
          args.push(word.value.toUpperCase());
          this.expectOp("(");
          for (;;) {
            const inner = this.next();
            if (inner.kind === "word") {
              args.push(inner.value.toLowerCase());
            } else if (inner.kind === "op" && inner.value === "*") {
              args.push("*");
            } else {
              throw new Error("嵌套聚合参数非法");
            }
            if (!this.takeOpIf(",")) break;
          }
          this.expectOp(")");
        } else {
          args.push(word.value.toLowerCase());
        }
      } else if (t.kind === "number" && fnName === "ROUND" && args.length >= 1) {
        const n = this.next();
        args.push(n.kind === "number" ? String(n.value) : "");
      } else {
        throw new Error(`聚合函数「${fnName}」参数非法`);
      }
      if (!this.takeOpIf(",")) break;
    }
    this.expectOp(")");
    return { kind: "aggregate", name: fnName, args };
  }

  /** 收集一段表达式 token 直到遇到子句关键字或语句结尾（不在这里做语义校验，交给校验器） */
  private collectExprTokens(): Token[] {
    const out: Token[] = [];
    let depth = 0;
    while (this.peek().kind !== "eof") {
      const t = this.peek();
      if (depth === 0 && t.kind === "word") {
        const upper = t.value.toUpperCase();
        if (["GROUP", "HAVING", "ORDER", "LIMIT", "WHERE"].includes(upper)) {
          break;
        }
        if (["UNION", "JOIN", "WITH", "SELECT", "IN", "EXISTS", "BETWEEN", "CASE", "LIKE"].includes(upper)) {
          throw new Error(`表达式不支持关键字「${upper}」`);
        }
      }
      if (t.kind === "op" && t.value === "(") {
        // 子查询以 (SELECT 开头：直接拒绝
        const after = this.tokens[this.pos + 1];
        if (after && after.kind === "word" && after.value.toUpperCase() === "SELECT") {
          throw new Error("子查询被禁止");
        }
        depth++;
      }
      if (t.kind === "op" && t.value === ")") {
        depth--;
        if (depth < 0) {
          throw new Error("括号不匹配");
        }
      }
      if (t.kind === "op" && ["+", "-", "/"].includes(t.value)) {
        throw new Error("表达式不支持算术运算");
      }
      out.push(this.next());
    }
    if (depth !== 0) {
      throw new Error("括号不匹配");
    }
    return out;
  }
}

// ─────────────────────────── 校验 ───────────────────────────

function buildPolicy(overrides?: Partial<AggregatePolicy>): AggregatePolicy {
  const merged = { ...DEFAULT_AGGREGATE_POLICY, ...overrides };
  // 运行时参数同样过 zod，防止调用方传入越界值（如 maxGroupByCols: 99）
  return AggregatePolicySchema.parse(merged);
}

/** 校验 WHERE/HAVING 表达式 token：只允许 列/字面量/聚合函数 与 比较、逻辑运算、括号 */
function validateExprTokens(
  tokens: Token[],
  policy: AggregatePolicy,
  allowAggregates: boolean,
): void {
  const banned = new Set(policy.bannedKeywords.map((k) => k.toUpperCase()));
  const allowedAggs = new Set(policy.allowedAggFns.map((a) => a.toUpperCase()));
  const compareOps = ["=", "!=", "<>", "<", "<=", ">", ">="];
  let prev: Token | null = null;
  for (const t of tokens) {
    if (t.kind === "word") {
      const upper = t.value.toUpperCase();
      if (banned.has(upper)) {
        throw new Error(`黑名单关键字「${upper}」`);
      }
      if (["AND", "OR", "NOT"].includes(upper)) {
        prev = t;
        continue;
      }
      // 可能是列名，也可能是聚合函数开头（后跟括号）
      const idx = tokens.indexOf(t);
      const nextToken = tokens[idx + 1];
      if (nextToken && nextToken.kind === "op" && nextToken.value === "(") {
        if (!allowAggregates) {
          throw new Error("该位置不允许聚合函数");
        }
        if (!allowedAggs.has(upper)) {
          throw new Error(`聚合函数「${upper}」不在白名单`);
        }
        if (FORBIDDEN_COLUMNS.some((c) => upper === c.toUpperCase())) {
          throw new Error(`禁止使用身份列「${upper}」`);
        }
        prev = t;
        continue;
      }
      if (FORBIDDEN_COLUMNS.some((c) => upper === c.toUpperCase())) {
        throw new Error(`禁止使用身份列「${upper}」`);
      }
      prev = t;
      continue;
    }
    if (t.kind === "string" || t.kind === "number") {
      prev = t;
      continue;
    }
    if (t.kind === "op" && t.value === "*") {
      // 仅允许 COUNT(*) 这类聚合参数星号（紧跟左括号之后）
      if (!prev || !(prev.kind === "op" && prev.value === "(")) {
        throw new Error("表达式不允许星号");
      }
      prev = t;
      continue;
    }
    // 操作符：只允许比较、逻辑括号与聚合参数分隔符逗号（算术已在收集阶段拒绝）
    if (t.kind === "op" && !["(", ")", ",", ...compareOps].includes(t.value)) {
      throw new Error(`表达式不允许操作符「${t.value}」`);
    }
    prev = t;
  }
  if (prev && prev.kind === "op" && compareOps.includes(prev.value)) {
    throw new Error("表达式以比较符结尾");
  }
}

/**
 * 预检一条聚合 SQL。返回 ok:true 才允许执行；任何 ok:false 直接拒绝，不执行 SQL。
 */
export function precheckAggregateSql(
  sql: string,
  overrides?: Partial<AggregatePolicy>,
): WhitelistVerdict {
  const policy = buildPolicy(overrides);

  if (sql.length > policy.maxSqlLength) {
    return { ok: false, reason: "PARSE_ERROR" };
  }
  if (/--/.test(sql) || /\/\*/.test(sql)) {
    // 注释一律拒绝：窄文法之外的内容不许混入
    return { ok: false, reason: "UNSUPPORTED_SYNTAX" };
  }

  let tokens: Token[];
  try {
    tokens = tokenize(sql);
  } catch {
    return { ok: false, reason: "PARSE_ERROR" };
  }

  // 黑名单整词扫描（R4）：字符串字面量之外的 word token
  const banned = new Set(policy.bannedKeywords.map((k) => k.toUpperCase()));
  for (const t of tokens) {
    if (t.kind === "word" && banned.has(t.value.toUpperCase())) {
      return { ok: false, reason: "BANNED_KEYWORD" };
    }
  }

  // R2：SELECT 后紧跟 *（含 COUNT(*) 之外的一切裸 *）——单独识别以给出准确原因码
  const first = tokens[0];
  const second = tokens[1];
  if (
    first &&
    first.kind === "word" &&
    first.value.toUpperCase() === "SELECT" &&
    second &&
    second.kind === "op" &&
    second.value === "*"
  ) {
    return { ok: false, reason: "SELECT_STAR" };
  }

  let parsed: ParsedStatement;
  try {
    parsed = new Parser(tokens).parse();
  } catch {
    // 语法错误统一归为不支持语法（子查询、多语句、算术表达式等）
    return { ok: false, reason: "UNSUPPORTED_SYNTAX" };
  }

  // 关系名必须在白名单内
  if (!ALLOWED_RELATIONS.includes(parsed.relation as (typeof ALLOWED_RELATIONS)[number])) {
    return { ok: false, reason: "PARSE_ERROR" };
  }

  // R1：必须 GROUP BY
  if (parsed.groupBy.length === 0) {
    return { ok: false, reason: "NO_GROUP_BY" };
  }
  if (parsed.groupBy.length > policy.maxGroupByCols) {
    return { ok: false, reason: "UNSUPPORTED_SYNTAX" };
  }
  const groupBySet = new Set(parsed.groupBy);
  for (const col of parsed.groupBy) {
    if (!ALLOWED_DIMENSIONS.includes(col as (typeof ALLOWED_DIMENSIONS)[number])) {
      return { ok: false, reason: "UNSUPPORTED_SYNTAX" };
    }
  }

  // R2/R3：SELECT 列表 = 分组键 + 聚合函数；聚合函数必须白名单内、参数不得是身份列
  const allowedAggs = new Set(policy.allowedAggFns);
  for (const item of parsed.selectItems) {
    if (item.kind === "star") {
      return { ok: false, reason: "SELECT_STAR" };
    }
    if (item.kind === "aggregate") {
      if (!allowedAggs.has(item.name)) {
        return { ok: false, reason: "UNSUPPORTED_SYNTAX" };
      }
      for (const arg of item.args) {
        if (arg !== "*" && FORBIDDEN_COLUMNS.includes(arg as (typeof FORBIDDEN_COLUMNS)[number])) {
          return { ok: false, reason: "UNSUPPORTED_SYNTAX" };
        }
      }
    } else {
      if (!groupBySet.has(item.name)) {
        return { ok: false, reason: "DETAIL_COLUMN" };
      }
      if (FORBIDDEN_COLUMNS.includes(item.name as (typeof FORBIDDEN_COLUMNS)[number])) {
        return { ok: false, reason: "UNSUPPORTED_SYNTAX" };
      }
    }
  }

  // WHERE / HAVING 表达式校验
  try {
    if (parsed.whereTokens) {
      validateExprTokens(parsed.whereTokens, policy, false);
    }
    if (parsed.havingTokens) {
      validateExprTokens(parsed.havingTokens, policy, true);
    }
  } catch {
    return { ok: false, reason: "UNSUPPORTED_SYNTAX" };
  }

  // ORDER BY：只能引用分组键或白名单聚合
  for (const o of parsed.orderBy) {
    if (o.args.length > 0) {
      if (!allowedAggs.has(o.name)) {
        return { ok: false, reason: "UNSUPPORTED_SYNTAX" };
      }
    } else if (!groupBySet.has(o.name)) {
      return { ok: false, reason: "UNSUPPORTED_SYNTAX" };
    }
  }

  // LIMIT 必须 ≤ 上限（执行后还会按实际行数二次校验）
  if (parsed.limit !== null && parsed.limit > policy.maxResultRows) {
    return { ok: false, reason: "ROW_LIMIT_EXCEEDED" };
  }

  return { ok: true };
}

/**
 * 校验 → 执行 → 行数复检。返回脱敏前的聚合结果与耗时。
 * 拒绝时抛出 WhitelistRejectedError（携带 reason），调用方据此发 WHITELIST_REJECTED 事件。
 */
export async function runWhitelistedAggregate(
  conn: AsyncDuckDBConnection,
  sql: string,
  overrides?: Partial<AggregatePolicy>,
  timeoutMs = 3000, // 契约 §6：Worker 超时 3s 中断（10s 强杀在 DuckDB 调用层）
): Promise<{ rows: unknown[]; rowCount: number; elapsedMs: number }> {
  const policy = buildPolicy(overrides);
  const verdict = precheckAggregateSql(sql, policy);
  if (!verdict.ok) {
    throw new WhitelistRejectedError(verdict.reason, "预检未通过，SQL 未执行");
  }

  const startedAt = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const queryPromise = conn.query(sql);
    const result = await Promise.race([
      queryPromise,
      new Promise<never>((_, reject) => {
        // 超时是执行层问题而非白名单问题：抛普通 Error，调用方据此映射 TIMEOUT 事件
        timer = setTimeout(() => reject(new Error(`DuckDB 查询超时（${timeoutMs}ms）`)), timeoutMs);
      }),
    ]);
    const rows = await result.toArray();
    const elapsedMs = performance.now() - startedAt;
    if (rows.length > policy.maxResultRows) {
      throw new WhitelistRejectedError("ROW_LIMIT_EXCEEDED", `返回 ${rows.length} 行，超过上限 ${policy.maxResultRows}`);
    }
    return { rows, rowCount: rows.length, elapsedMs };
  } catch (err) {
    if (err instanceof WhitelistRejectedError) {
      throw err;
    }
    throw new WhitelistRejectedError("PARSE_ERROR", err instanceof Error ? err.message : String(err));
  } finally {
    if (timer) clearTimeout(timer);
  }
}
