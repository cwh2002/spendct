/**
 * 年度海报的输入数据层（修订案 A17）：报告页与海报页共用的单一来源。
 *
 * 海报只需「年度总览 + 六维健康分 + 四具名指标」，对应三条确定性聚合 SQL
 * （代码常量、零用户输入，07 §6 SQL 硬约束 b 类），统一经
 * runWhitelistedAggregate 执行（白名单预检 + 3s 超时 + 行数复检）。
 * 白名单文法子集不支持 AS 别名与 COUNT(DISTINCT …)，结果列一律按 SELECT
 * 位置取值（numAt/valAt，与引擎 stages/spec.ts 同口径）。
 *
 * 口径说明（与报告页原实现逐字一致，2026-10-16 抽层时整体迁移）：
 * - annual_summary：表按 year 唯一一行，SUM/MAX 只是满足「SELECT 只能出现
 *   分组键与聚合函数」的形态要求，取到的就是该行原值；
 * - 活跃月数：v_monthly_summary 每 (account_id, month) 一行，COUNT(*) 即去重月数；
 * - v_health_inputs：视图逐月一行，AVG(ratio) 按 month 分组后等价于该月比率
 *   本身，DESC + LIMIT 12 取近 12 个月，解析层倒序为升序后做均值与环比；
 * - 四指标阈值沿用 2b 确定性规则；结余率全国基准 = 1 − 2025 人均消费支出
 *   29,476 元 ÷ 2025 人均可支配收入 43,377 元（国家统计局 2026-01-19 发布
 *   《2025 年居民收入和消费支出情况》官方数字），推算得 ≈ 32.0%。
 */

import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";

import { DEMO_ACCOUNT_META, DEMO_REPORT } from "@/lib/demo-data";
import { fmtMonth, numAt, valAt } from "@/lib/pipeline/stages/spec";
import { runWhitelistedAggregate } from "@/lib/sql-guard/whitelist";
import type { RatioKey } from "@/lib/report/labels";

// ─────────────────────────── 三条确定性聚合 SQL ───────────────────────────

export const ANNUAL_OVERVIEW_SQL =
  "SELECT year, SUM(expense_cents), SUM(income_cents), SUM(tx_count), MAX(top_category) FROM annual_summary GROUP BY year ORDER BY year DESC LIMIT 1";

export const HEALTH_INPUTS_SQL =
  "SELECT month, AVG(food_ratio), AVG(sub_ratio), AVG(impulse_ratio), AVG(night_ratio), AVG(surplus_ratio), AVG(big_pulse_ratio) FROM v_health_inputs GROUP BY month ORDER BY month DESC LIMIT 12";

export const ACTIVE_MONTHS_SQL = "SELECT COUNT(*) FROM v_monthly_summary GROUP BY account_id";

// ─────────────────────────── 六维健康分口径（F10） ───────────────────────────

/**
 * F10 六维健康分维度定义：key 对应 v_health_inputs 的六个比率列（单位 %）。
 * 方向口径（越高越健康）：五个占比类指标越低越好，结余率越高越好。
 * 线性分段边界（fullAt=满分区、zeroAt=零分区）按消费常识设定：
 * 餐饮占比用国家统计局 2025 恩格尔系数 29.3% 作中间锚点（10% 以下满分、50% 以上零分）；
 * 结余率以全国平均 32.0% 作中间锚点（40% 以上满分、0% 以下零分）。
 */
interface HealthDimDef {
  /** RatioKey 类型来自 @/lib/report/labels（文案层与评分层共用同一组六维键） */
  key: RatioKey;
  name: string;
  /** lower = 占比越低越健康；higher = 越高越健康（仅结余率） */
  direction: "lower" | "higher";
  /** 满分区边界：lower 维度低于 fullAt 得满分；higher 维度高于 fullAt 得满分 */
  fullAt: number;
  /** 零分区边界：lower 维度高于 zeroAt 得 0 分；higher 维度低于 zeroAt 得 0 分 */
  zeroAt: number;
}

const HEALTH_DIMS: readonly HealthDimDef[] = [
  { key: "foodRatio", name: "餐饮", direction: "lower", fullAt: 10, zeroAt: 50 },
  { key: "subRatio", name: "订阅", direction: "lower", fullAt: 0, zeroAt: 20 },
  { key: "impulseRatio", name: "冲动", direction: "lower", fullAt: 0, zeroAt: 30 },
  { key: "nightRatio", name: "深夜", direction: "lower", fullAt: 0, zeroAt: 15 },
  { key: "surplusRatio", name: "结余", direction: "higher", fullAt: 40, zeroAt: 0 },
  { key: "bigPulseRatio", name: "大额脉冲", direction: "lower", fullAt: 0, zeroAt: 40 },
];

/**
 * 单个比率 → 0-100 分：线性插值后截断到 [0,1] 再放大，保证极端值不越界。
 * 跨度按方向分别计算（lower 用 zeroAt − fullAt、higher 用 fullAt − zeroAt）——
 * 原实现统一用 zeroAt − fullAt，higher 维度（结余率）跨度恒为负被
 * span ≤ 0 兜底拦成 0 分，与 F10 口径（40% 以上满分）不符，A17 修订修复。
 */
function dimScore(ratio: number, def: HealthDimDef): number {
  const span =
    def.direction === "lower" ? def.zeroAt - def.fullAt : def.fullAt - def.zeroAt;
  if (span <= 0) return 0;
  const raw =
    def.direction === "lower" ? 1 - (ratio - def.fullAt) / span : (ratio - def.zeroAt) / span;
  return Math.round(Math.min(1, Math.max(0, raw)) * 100);
}

// ─────────────────────────── 具名指标口径（2b/2c） ───────────────────────────

/** 海报单条指标：benchmark 为 null 时不渲染基准行（无公开来源不显示对比值） */
export interface PosterMetric {
  name: string;
  value: string;
  delta: string;
  status: "good" | "warn" | "serious";
  benchmark: string | null;
}

/**
 * 具名指标完整形状：benchmark 只挂有公开来源的可信基准，无公开基准的指标
 * 为 null 且不渲染基准行（2c：删掉「同龄人平均」虚构对比值）。
 */
export interface NamedMetric extends PosterMetric {
  id: string;
  /** 指标说明文案：内置与真实动线共用 */
  explain: string;
}

/** 四指标展示名：真实与内置两条动线共用，避免同一指标两套叫法 */
const METRIC_NAMES: Record<string, string> = {
  "hidden-subscription": "订阅率",
  impulse: "冲动消费浓度",
  "dining-share": "餐饮占比",
  "save-rate": "结余率",
};

/**
 * 结余率全国基准：1 − 2025 人均消费支出 29,476 元 ÷ 2025 人均可支配收入 43,377 元。
 * 两个分子分母均为国家统计局 2026-01-19 发布的《2025 年居民收入和消费支出情况》
 * 官方数字，推算得 ≈ 32.0%。
 */
const SAVE_RATE_BENCHMARK_PCT = 100 * (1 - 29476 / 43377);

/**
 * 每项指标单独的可信基准（2c）：
 * - 餐饮占比 29.3% = 国家统计局 2025 恩格尔系数（居民消费构成·食品烟酒）；
 * - 结余率 = 国家统计局 2025 人均收支数据推算；
 * - 订阅率/冲动浓度没有公开全国基准 → null，不显示基准行。
 * 内置数据与真实两条动线共用同一套常量。
 */
const METRIC_BENCHMARKS: Record<string, string | null> = {
  "hidden-subscription": null,
  impulse: null,
  "dining-share": "29.3%",
  "save-rate": `${SAVE_RATE_BENCHMARK_PCT.toFixed(1)}%`,
};

/** 四指标说明文案：内置与真实动线共用，不引用任何虚构对比口径 */
const METRIC_EXPLAINS: Record<string, string> = {
  "hidden-subscription": "订阅支出占总支出的比例；暂无公开全国基准，重点看长期趋势与取消空间",
  impulse: "深夜与促销日集中消费占总支出的比例；暂无公开全国基准，越低越健康",
  "dining-share":
    "餐饮支出占总支出的比例；全国平均 29.3%（国家统计局 2025 年居民消费构成·食品烟酒）",
  "save-rate": "月均结余占收入的比例；全国平均 32.0%（按国家统计局 2025 年人均收支数据推算）",
};

/**
 * 具名指标状态阈值（确定性规则，2b）：
 * - 订阅率/冲动浓度/餐饮占比为占比类指标，越低越健康：≥ warnAt 关注、≥ seriousAt 预警；
 *   餐饮占比的 warnAt 对齐全国平均 29.3%；
 * - 结余率越高越健康：≥ goodAt 良好、≥ warnAt 关注、低于 warnAt 预警，goodAt 对齐全国平均。
 */
interface MetricRule {
  id: string;
  key: RatioKey;
  lowerBetter: boolean;
  warnAt: number;
  /** 占比类指标的预警线；结余率不使用该字段 */
  seriousAt: number;
  /** 结余率专用：达到该值计良好（默认对齐全国平均基准） */
  goodAt?: number;
}

const METRIC_RULES: readonly MetricRule[] = [
  { id: "hidden-subscription", key: "subRatio", lowerBetter: true, warnAt: 3, seriousAt: 6 },
  { id: "impulse", key: "impulseRatio", lowerBetter: true, warnAt: 15, seriousAt: 25 },
  { id: "dining-share", key: "foodRatio", lowerBetter: true, warnAt: 29.3, seriousAt: 40 },
  {
    id: "save-rate",
    key: "surplusRatio",
    lowerBetter: false,
    warnAt: 15,
    seriousAt: 0,
    goodAt: SAVE_RATE_BENCHMARK_PCT,
  },
];

function metricStatus(value: number, rule: MetricRule): NamedMetric["status"] {
  if (rule.lowerBetter) {
    if (value >= rule.seriousAt) return "serious";
    if (value >= rule.warnAt) return "warn";
    return "good";
  }
  if (value >= (rule.goodAt ?? 0)) return "good";
  if (value >= rule.warnAt) return "warn";
  return "serious";
}

/** 环比变化格式化：单位百分点、一位小数；正负带符号，接近 0 显示 0.0 */
function fmtDeltaPct(delta: number): string {
  if (Math.abs(delta) < 0.05) return "0.0 个百分点";
  const sign = delta > 0 ? "+" : "-";
  return `${sign}${Math.abs(delta).toFixed(1)} 个百分点`;
}

/** 内置数据路径的四指标：数值/环比沿用 DEMO_REPORT，基准与说明统一换成本文件的真实基准常量 */
export function buildDemoMetrics(): NamedMetric[] {
  return DEMO_REPORT.namedMetrics.map((m) => {
    const status: NamedMetric["status"] =
      m.status === "warn" || m.status === "serious" ? m.status : "good";
    return {
      id: m.id,
      name: METRIC_NAMES[m.id] ?? m.name,
      // demo 常量个别百分比是整数（如 34%），统一补一位小数与真实口径对齐
      value: /^\d+%$/.test(m.value) ? `${m.value.slice(0, -1)}.0%` : m.value,
      delta: m.delta,
      status,
      benchmark: METRIC_BENCHMARKS[m.id] ?? null,
      explain: METRIC_EXPLAINS[m.id] ?? m.explain,
    };
  });
}

// ─────────────────────────── 真实数据解析层 ───────────────────────────

/** annual_summary 聚合行（按 ANNUAL_OVERVIEW_SQL 的 SELECT 位置取数） */
export interface AnnualOverview {
  year: string;
  totalExpenseCents: number;
  totalIncomeCents: number;
  totalTx: number;
  topCategory: string | null;
}

export function parseAnnualOverview(rows: Record<string, unknown>[]): AnnualOverview | null {
  const row = rows[0];
  if (!row) return null;
  const totalTx = numAt(row, 3);
  // 空库兜底：全零聚合视为无年度数据，整份海报保持 demo
  if (totalTx <= 0) return null;
  const topCategory = valAt(row, 4);
  return {
    year: String(numAt(row, 0)),
    totalExpenseCents: numAt(row, 1),
    totalIncomeCents: numAt(row, 2),
    totalTx,
    topCategory: typeof topCategory === "string" ? topCategory : null,
  };
}

/** v_health_inputs 逐月一行：六个比率（%）按 HEALTH_INPUTS_SQL 的 SELECT 位置取数 */
interface HealthMonthRow {
  month: string;
  foodRatio: number;
  subRatio: number;
  impulseRatio: number;
  nightRatio: number;
  surplusRatio: number;
  bigPulseRatio: number;
}

/** 六维健康聚合结果：升序的逐月比率行，均值/环比都在解析层由行内数据计算 */
export interface HealthStats {
  rows: HealthMonthRow[];
}

export function parseHealthRows(rows: Record<string, unknown>[]): HealthMonthRow[] {
  return rows
    .map((row) => ({
      month: fmtMonth(valAt(row, 0)),
      foodRatio: numAt(row, 1),
      subRatio: numAt(row, 2),
      impulseRatio: numAt(row, 3),
      nightRatio: numAt(row, 4),
      surplusRatio: numAt(row, 5),
      bigPulseRatio: numAt(row, 6),
    }))
    .filter((row) => row.month.length >= 4)
    .reverse(); // 查询 DESC，展示与环比计算需要升序
}

/**
 * 近 12 月六比率均值 + F10 映射 → 健康指数与六维分。
 * ratios 为六维原始比率均值（%）：报告页的六维明细与雷达继续消费，
 * 海报只取 healthIndex 与四指标。
 */
export function computeHealthScore(health: HealthStats): {
  healthIndex: number;
  dims: { name: string; value: number }[];
  ratios: Record<RatioKey, number>;
} {
  const meanOf = (key: RatioKey) =>
    health.rows.reduce((sum, row) => sum + row[key], 0) / health.rows.length;
  const ratios: Record<RatioKey, number> = {
    foodRatio: meanOf("foodRatio"),
    subRatio: meanOf("subRatio"),
    impulseRatio: meanOf("impulseRatio"),
    nightRatio: meanOf("nightRatio"),
    surplusRatio: meanOf("surplusRatio"),
    bigPulseRatio: meanOf("bigPulseRatio"),
  };
  const scores = HEALTH_DIMS.map((def) => ({
    name: def.name,
    value: dimScore(ratios[def.key], def),
  }));
  // F10 合成：六维等权（各 1/6），取整为 0-100 整数
  const healthIndex = Math.round(scores.reduce((sum, dim) => sum + dim.value, 0) / scores.length);
  return { healthIndex, dims: scores, ratios };
}

/** 真实四指标：12 月均值做展示值，最近一月减上一月做环比（百分点，同源行内计算） */
export function buildRealMetrics(health: HealthStats): NamedMetric[] {
  const rows = health.rows;
  const latest = rows[rows.length - 1]!;
  const prev = rows.length > 1 ? rows[rows.length - 2]! : null;
  const meanOf = (key: RatioKey) => rows.reduce((sum, row) => sum + row[key], 0) / rows.length;

  return METRIC_RULES.map((rule) => {
    const value = meanOf(rule.key);
    const delta = prev ? latest[rule.key] - prev[rule.key] : 0;
    return {
      id: rule.id,
      name: METRIC_NAMES[rule.id] ?? rule.id,
      value: `${value.toFixed(1)}%`,
      delta: fmtDeltaPct(delta),
      status: metricStatus(value, rule),
      benchmark: METRIC_BENCHMARKS[rule.id] ?? null,
      explain: METRIC_EXPLAINS[rule.id] ?? "",
    };
  });
}

// ─────────────────────────── 海报输入组装 ───────────────────────────

/** 海报输入：poster-canvas 的最小数据形状（内置与真实两条动线共用） */
export interface PosterInput {
  /** 年度总览是否来自真实聚合：控制「内置数据/本地数据」徽标 */
  isReal: boolean;
  meta: {
    year: string;
    monthsCovered: number;
    totalTransactions: number;
    totalExpenseCents: number;
  };
  /** 六维健康指数 0-100 */
  healthIndex: number;
  /** 健康指数是否来自真实六维聚合（报告页据此决定是否写入段位） */
  healthIndexReal: boolean;
  namedMetrics: PosterMetric[];
}

/** 内置数据路径的海报输入：数值与 DEMO_ACCOUNT_META/DEMO_REPORT 同源 */
export function demoPosterInput(): PosterInput {
  return {
    isReal: false,
    meta: {
      year: "2026", // 内置数据集年份（DEMO_REPORT 故事段口径，报告页 demoReportData 同值）
      monthsCovered: DEMO_ACCOUNT_META.monthsCovered,
      totalTransactions: DEMO_ACCOUNT_META.totalTransactions,
      totalExpenseCents: DEMO_ACCOUNT_META.totalExpenseCents,
    },
    healthIndex: DEMO_REPORT.healthIndex,
    healthIndexReal: false,
    namedMetrics: buildDemoMetrics(),
  };
}

/**
 * 聚合结果 → 海报输入（真实优先 + 字段级 demo 兜底，任一查询失败只降级对应字段）：
 * - 年度总览失败或空库时整份回退 demo；
 * - 六维健康失败时 healthIndex 与四指标整组回退 demo。
 */
function buildPosterInput(
  annual: AnnualOverview | null,
  health: HealthStats | null,
  activeMonths: number | null,
): PosterInput {
  const demo = demoPosterInput();
  if (!annual) return demo;
  const healthScore = health ? computeHealthScore(health) : null;
  return {
    isReal: true,
    meta: {
      year: annual.year,
      monthsCovered: activeMonths ?? demo.meta.monthsCovered,
      totalTransactions: annual.totalTx,
      totalExpenseCents: annual.totalExpenseCents,
    },
    healthIndex: healthScore?.healthIndex ?? demo.healthIndex,
    healthIndexReal: healthScore !== null,
    namedMetrics: health ? buildRealMetrics(health) : demo.namedMetrics,
  };
}

/** 海报输入装载：三条确定性聚合并行执行，allSettled 保证任一失败不拖垮其余字段。
 * 数据库本身不可用时调用方捕获（getDuckDB 抛错），本函数只处理查询级失败；
 * 空库（annual 为 null）返回 null，调用方整页保持 demo 口径。
 */
export async function loadPosterInput(
  conn: AsyncDuckDBConnection,
): Promise<PosterInput | null> {
  const [annualRes, healthRes, monthsRes] = await Promise.allSettled([
    runWhitelistedAggregate(conn, ANNUAL_OVERVIEW_SQL),
    runWhitelistedAggregate(conn, HEALTH_INPUTS_SQL),
    runWhitelistedAggregate(conn, ACTIVE_MONTHS_SQL),
  ]);

  const rowsOf = (res: PromiseSettledResult<{ rows: unknown[] }>): Record<string, unknown>[] =>
    res.status === "fulfilled" ? (res.value.rows as Record<string, unknown>[]) : [];

  const annual =
    annualRes.status === "fulfilled" ? parseAnnualOverview(rowsOf(annualRes)) : null;
  const health =
    healthRes.status === "fulfilled"
      ? ((): HealthStats | null => {
          const rows = parseHealthRows(rowsOf(healthRes));
          return rows.length > 0 ? { rows } : null;
        })()
      : null;
  const monthCount =
    monthsRes.status === "fulfilled" ? numAt(rowsOf(monthsRes)[0] ?? {}, 0) : 0;

  if (!annual) return null;
  return buildPosterInput(annual, health, monthCount > 0 ? monthCount : null);
}
