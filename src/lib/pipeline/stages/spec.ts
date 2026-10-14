/**
 * 阶段执行器公共契约（03 §1.3 的 QuerySpec[] 形态 + 引擎状态机所需的最小接口）。
 *
 * 每阶段一个执行器文件：声明确定性 SQL（必须能过 SQL 白名单预检，
 * 聚合 GROUP BY 维度 ≤3、LIMIT ≤50，维度只用 ALLOWED_DIMENSIONS 清单）与
 * 「聚合结果 → 模板卡输入」的组装函数。SQL 是代码常量，不经 LLM 生成，
 * 因此不走追问 SQL 校验；但引擎统一经 runWhitelistedAggregate 执行（双保险）。
 */
import type { StageId } from "@/lib/pipeline/stage";
import { STAGE_DISPLAY_NAMES } from "@/lib/pipeline/stage";

/**
 * 模板卡输入：形态对齐 07 §4 insight-card@v1 草稿字段（headline/narrative/
 * confidence/significance/evidence.chart/evidence.stats/sources），另加 cardId。
 * 引擎把本输入原样交给 card-factory 的 buildTemplateCard(stage, input) 组装运行时卡。
 */
export interface StatInput {
  label: string;
  value: string;
  unit?: string;
}

export interface ChartSpecInput {
  tableId: string;
  chartType: "bar" | "line" | "pie" | "histogram" | "scatter" | "heatmap" | "table";
  title: string;
  dimField: string;
  measureFields: string[];
  sortBy?: "desc" | "asc";
  topN?: number;
  /** 引擎模板专用行过滤（白名单预检双保险），形态见 ChartSpecSchema 正则口径 */
  where?: string;
  /** 引擎模板专用聚合过滤，形态见 ChartSpecSchema 正则口径 */
  having?: string;
}

export interface CitationInput {
  kind: "sql" | "rag" | "tool" | "rule" | "personal";
  ref: string;
}

export interface TemplateCardInput {
  cardId: string;
  headline: string;
  narrative: string;
  confidence: number;
  significance: string;
  evidence: { chart: ChartSpecInput; stats: StatInput[] };
  sources: CitationInput[];
}

/** 一条确定性聚合：tableId 为预计算表/视图注册名，sql 为白名单可执行语句 */
export interface QuerySpec {
  tableId: string;
  sql: string;
}

/** 一次聚合执行后的证据产物（引擎发 stage:evidence 事件的数据源） */
export interface EvidenceResult {
  tableId: string;
  sqlHash: string;
  rows: Record<string, unknown>[];
  rowCount: number;
  elapsedMs: number;
}

/** 卡片组装期的跨阶段上下文：订阅卡需要 clean 阶段的支出总额算占比 */
export interface StageCardContext {
  getEvidence(stage: StageId): EvidenceResult[];
}

export interface StageExecutor {
  stage: StageId;
  queries: readonly QuerySpec[];
  buildCardInputs(evidence: EvidenceResult[], ctx: StageCardContext): TemplateCardInput[];
}

/** 空数据集：clean 阶段检出 0 行时抛出，引擎映射 EMPTY_DATASET（不可重试） */
export class EmptyDatasetError extends Error {
  constructor() {
    super("数据集为空，无法执行体检");
    this.name = "EmptyDatasetError";
  }
}

/**
 * 行内取值。DuckDB 白名单文法子集不支持 AS 别名，聚合列名由 DuckDB 自动生成，
 * 引擎统一按 SELECT 位置取值，避免依赖自动列名的拼写。
 */
export function valAt(row: Record<string, unknown>, index: number): unknown {
  return Object.values(row)[index] ?? null;
}

/**
 * 按位置取数值：兼容 DuckDB 聚合结果经箭头层的几种物化形态——
 * BIGINT → bigint、INTEGER → number、HUGEINT/SUM → 128 位大数对象（Number()
 * 经 valueOf 转数值）。不可解析时兜底 0。
 */
export function numAt(row: Record<string, unknown>, index: number): number {
  const value = valAt(row, index);
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** 金额展示：整数分 → 「元」字符串，保留 2 位小数（07 §3 仅展示层换算） */
export function fmtYuan(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * 月份维度 → YYYY-MM。兼容三种物化形态：Date 对象、epoch 毫秒 number
 * （DATE/TIMESTAMP 经箭头层的时间整数）、"YYYY-MM-DD" 字符串。
 * 时间值按本地钟表分量格式：导入的 ts 是无时区本地时间，UTC 格式化会漂移一天。
 */
export function fmtMonth(value: unknown): string {
  const date =
    value instanceof Date
      ? value
      : typeof value === "number" && Number.isFinite(value)
        ? new Date(value)
        : null;
  if (date && !Number.isNaN(date.getTime())) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
  }
  return String(value ?? "").slice(0, 7);
}

/** 日期维度 → YYYY-MM-DD：物化形态与本地口径同 fmtMonth */
export function fmtDate(value: unknown): string {
  const date =
    value instanceof Date
      ? value
      : typeof value === "number" && Number.isFinite(value)
        ? new Date(value)
        : null;
  if (date && !Number.isNaN(date.getTime())) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
  return String(value ?? "").slice(0, 10);
}

/** 卡 ID：card_<stage>_<阶段序号>_<阶段内序号>（07 §4 正则 card_(clean|...)_\d+_\d+） */
export function makeCardId(stage: StageId, seq: number): string {
  return `card_${stage}_${STAGE_DISPLAY_NAMES[stage].order}_${seq}`;
}

/** SQL 引用（07 §4 CitationSchema：sql:${table|view}:${tableId}） */
export function sqlCitation(relation: "table" | "view", tableId: string): CitationInput {
  return { kind: "sql", ref: `sql:${relation}:${tableId}` };
}

/** 规则引用（deterministic 规则来源，供卡面展示溯源） */
export function ruleCitation(ruleId: string): CitationInput {
  return { kind: "rule", ref: `rule:${ruleId}` };
}

/**
 * 「未发现」模板卡输入：样本不足时产出全零统计卡，由引擎 reflect 闸门
 * 以「统计值全零 / 置信度不足」拦下（07 §20 宁缺毋滥，不自动发布）。
 */
export function noFindingsInput(
  stage: StageId,
  seq: number,
  opts: { headline: string; narrative: string; tableId: string },
): TemplateCardInput {
  return {
    cardId: makeCardId(stage, seq),
    headline: opts.headline,
    narrative: opts.narrative,
    confidence: 0.5,
    significance: "未命中该阶段显著性门槛",
    evidence: {
      chart: {
        tableId: opts.tableId,
        chartType: "bar",
        title: "暂无数据",
        dimField: "category",
        measureFields: ["expense_cents"],
      },
      stats: [{ label: "样本量", value: "0" }],
    },
    sources: [sqlCitation("table", opts.tableId)],
  };
}
