"use client";

import * as echarts from "echarts/core";
import { RadarChart } from "echarts/charts";
import { RadarComponent } from "echarts/components";
// 函数式 tooltip 参数类型（官方导出路径，避免 any；package.json exports 已声明 ./types/dist/shared）
import type { CallbackDataParams } from "echarts/types/dist/shared";

// 页面级补充注册（use 幂等）：雷达图仅本页使用，避免共享组件注册集变动影响渲染
echarts.use([RadarChart, RadarComponent]);

import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BookOpenText,
  CircleCheck,
  CircleX,
  Download,
  FileText,
  Trophy,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AchievementWall } from "@/components/achievements/achievement-wall";
import { AuthGuard } from "@/components/auth/route-guard";
import { chartTokens, cssVar, EChart, type ECOption } from "@/components/charts/e-chart";
import { Container } from "@/components/layout/container";
import { RankBadge } from "@/components/report/rank-badge";
import { renderPosterPng } from "@/components/report/poster-canvas";
import { ACHIEVEMENT_DEFS, unlockAchievement, useUnlockedIds } from "@/lib/achievements";
import { DEMO_ACCOUNT_META, DEMO_REPORT } from "@/lib/demo-data";
import { getDuckDB } from "@/lib/duckdb/service";
import { featureFlags } from "@/lib/feature-flags";
import { fmtMonth, fmtYuan, numAt, valAt } from "@/lib/pipeline/stages/spec";
import { usePipeline } from "@/lib/pipeline/store";
import { saveRankTier, useRankTier } from "@/lib/rank";
import {
  buildHealthComment,
  buildHealthDims,
  healthRatingLabel,
  type HealthRatingTone,
  type RatioKey,
} from "@/lib/report/labels";
// 六维健康分与具名指标的评分/解析层已抽到共享模块（A17）：报告页与海报页
// 共用同一份实现（SQL 常量、阈值规则、解析函数），避免两处口径漂移
import {
  ACTIVE_MONTHS_SQL,
  ANNUAL_OVERVIEW_SQL,
  HEALTH_INPUTS_SQL,
  buildDemoMetrics,
  buildRealMetrics,
  computeHealthScore,
  parseAnnualOverview,
  parseHealthRows,
  type AnnualOverview,
  type HealthStats,
  type NamedMetric,
} from "@/lib/report/poster-input";
import type { InsightCard } from "@/lib/schema/insight-card";
import { runWhitelistedAggregate } from "@/lib/sql-guard/whitelist";

// ─────────────────────────── 六维健康分口径（F10） ───────────────────────────

/** 雷达/六维分的统一维度形状：name 为展示名，value 为 0-100 分 */
interface RadarDim {
  name: string;
  value: number;
}

/**
 * 内置数据雷达维度兜底：demo-data.ts 的 DEMO_REPORT.radarDims 由另一工作线
 * 与海报同波新增。字段尚未落地时退回这里的旧静态值，避免页面空引用白屏；
 * 字段落地后自动读 DEMO_REPORT.radarDims，本常量不再被取到。
 */
const FALLBACK_RADAR_DIMS: RadarDim[] = [
  { name: "餐饮", value: 82 },
  { name: "购物", value: 64 },
  { name: "交通", value: 78 },
  { name: "娱乐", value: 46 },
  { name: "居住", value: 81 },
  { name: "其他", value: 55 },
];

/** 内置数据路径的雷达维度：优先 DEMO_REPORT.radarDims，字段缺失时退回静态兜底 */
function demoRadarDims(): RadarDim[] {
  const dims = (DEMO_REPORT as { radarDims?: RadarDim[] }).radarDims;
  return dims && dims.length > 0 ? dims : FALLBACK_RADAR_DIMS;
}

// 六维健康分与具名指标的口径（维度定义 / 阈值规则 / 评分与解析函数）
// 已整体抽到 @/lib/report/poster-input.ts（A17 修订）：报告页与海报页共用
// 同一份实现，本页只做展示层映射（STATUS_META / 评级徽标 / 雷达图）。

// ─────────────────────────── 四态 → 页面展示元（色+图标+文案成对出现） ───────────────────────────

const STATUS_META: Record<string, { label: string; icon: LucideIcon; chip: string; text: string }> =
  {
    good: {
      label: "良好",
      icon: CircleCheck,
      chip: "bg-(--color-good)/10 text-(--color-good-ink) dark:text-(--color-good)",
      text: "text-(--color-good-ink) dark:text-(--color-good)",
    },
    warn: {
      label: "关注",
      icon: AlertTriangle,
      chip: "bg-(--color-warning)/15 text-(--color-warning-ink) dark:text-(--color-warning)",
      text: "text-(--color-warning-ink) dark:text-(--color-warning)",
    },
    serious: {
      label: "预警",
      icon: AlertCircle,
      chip: "bg-(--color-critical)/10 text-(--color-critical-ink) dark:text-(--color-critical)",
      text: "text-(--color-critical-ink) dark:text-(--color-critical)",
    },
  };

/**
 * 健康指数评级徽标色（纯展示层）：labels.ts 的 healthRatingLabel 只输出 tone，
 * 颜色在此按页面既有语义色令牌配对（优秀→good、良好→health、需关注→warning、
 * 风险→critical），chip 写法与四指标卡 STATUS_META 保持一致。
 */
const RATING_TONE_META: Record<HealthRatingTone, { chip: string }> = {
  good: { chip: "bg-(--color-good)/10 text-(--color-good-ink) dark:text-(--color-good)" },
  health: { chip: "bg-(--color-health)/10 text-(--color-health)" },
  warn: { chip: "bg-(--color-warning)/15 text-(--color-warning-ink) dark:text-(--color-warning)" },
  serious: {
    chip: "bg-(--color-critical)/10 text-(--color-critical-ink) dark:text-(--color-critical)",
  },
};

/** hex 色值 → rgba：折线面积渐变需要半透明档，CSS 变量只给 hex */
function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// ─────────────────────────── 真实数据查询层（真实优先 + demo 兜底） ───────────────────────────

/**
 * 本页四条确定性聚合 SQL：全部是代码常量、零用户输入（07 §6 SQL 硬约束 b 类），
 * 统一经 runWhitelistedAggregate 执行（白名单预检 + 3s 超时 + 行数复检）。
 * 年度总览 / 活跃月数 / 六维健康三条已抽到 @/lib/report/poster-input.ts
 * （A17 修订：报告页与海报页共用），本页不再重复定义。
 *
 * 白名单文法子集不支持 AS 别名与 COUNT(DISTINCT …)，结果列一律按 SELECT 位置
 * 取值（numAt/valAt，与引擎 stages/spec.ts 同口径），不依赖 DuckDB 自动列名拼写。
 *
 * - v_monthly_summary：近 12 月支出，DESC 取最新 12 行后在解析层倒序为升序；
 * - v_top_merchants_90d：视图内已限定 90 天窗口，按支出额降序取前 6；
 * - 餐饮细分：transactions 按 sub_category 求和，方向/状态过滤与各视图口径一致
 *   （只统计 expense+paid 的支出），ORDER BY 聚合列属于白名单允许形态；
 * - 类目总额：v_category_monthly 跨月按 category 求和，供段 4 三组映射使用。
 */
const MONTHLY_TREND_SQL =
  "SELECT month, SUM(expense_cents), SUM(expense_tx) FROM v_monthly_summary GROUP BY month ORDER BY month DESC LIMIT 12";

const TOP_MERCHANTS_SQL =
  "SELECT merchant, SUM(total_cents), SUM(tx_count) FROM v_top_merchants_90d GROUP BY merchant ORDER BY SUM(total_cents) DESC LIMIT 6";

const FOOD_SUBCATEGORY_SQL =
  "SELECT sub_category, SUM(amount_cents) FROM transactions WHERE category = '餐饮' AND direction = 'expense' AND status = 'paid' GROUP BY sub_category ORDER BY SUM(amount_cents) DESC LIMIT 12";

const CATEGORY_TOTAL_SQL =
  "SELECT category, SUM(expense_cents) FROM v_category_monthly GROUP BY category";

/** 报告页展示数据的统一形态：真实模式由聚合结果组装，缺失字段按 demo 值兜底 */
interface ReportMeta {
  /** 报告标题年份：annual_summary 的 year（demo 路径固定 2026） */
  year: string;
  monthsCovered: number;
  totalTransactions: number;
  totalExpenseCents: number;
}

interface ReportStorySegment {
  headline: string;
  narrative: string;
  /** timeseries | donut | bar；demo 常量推断为 string，与三类分支判断同口径 */
  chartKind: string;
  chartData: number[];
  chartLabels: string[];
  /** donut 数值单位：yuan=元（真实段，分/100 后的元）、percent=百分比（demo 段数据本身就是占比）；缺省按 percent 兜底 */
  chartUnit?: "yuan" | "percent";
}

interface ReportData {
  /** 年度总览是否来自真实聚合：控制「内置数据/本地数据」徽标与海报绘制路径 */
  isReal: boolean;
  meta: ReportMeta;
  /** 六维健康指数 0-100：真实模式由 F10 六比率映射合成，失败回退 demo 值 */
  healthIndex: number;
  /** 健康指数是否来自真实六维聚合：只有 true 才把档位写入本地存储（2g） */
  healthIndexReal: boolean;
  /** 雷达六维：真实模式为六个比率映射出的 0-100 分，demo 模式读 DEMO_REPORT.radarDims */
  radarDims: RadarDim[];
  /**
   * 六维原始比率（%，近 12 月均值口径）：只供六维明细的「状态标签 + 大白话 +
   * 右侧小字百分比」展示（labels.ts buildHealthDims），不参与健康分与雷达计算。
   */
  healthRatios: Record<RatioKey, number>;
  /** 四指标（订阅率/冲动浓度/餐饮占比/结余率），真实与 demo 两动线共用基准常量 */
  namedMetrics: NamedMetric[];
  storySegments: ReportStorySegment[];
}

/** demo 报告对象：lastRun === null 时整页沿用，展示字段与内置数据保持原样 */
function demoReportData(): ReportData {
  return {
    isReal: false,
    meta: {
      year: "2026",
      monthsCovered: DEMO_ACCOUNT_META.monthsCovered,
      totalTransactions: DEMO_ACCOUNT_META.totalTransactions,
      totalExpenseCents: DEMO_ACCOUNT_META.totalExpenseCents,
    },
    healthIndex: DEMO_REPORT.healthIndex,
    healthIndexReal: false,
    radarDims: demoRadarDims(),
    healthRatios: DEMO_REPORT.healthRatios,
    namedMetrics: buildDemoMetrics(),
    storySegments: DEMO_REPORT.storySegments,
  };
}

/** 故事段兜底占位：仅在 demo 常量缺失等异常形态下使用，正常两条动线都不会触发 */
const EMPTY_SEGMENT: ReportStorySegment = {
  headline: "暂无数据",
  narrative: "数据不足，未能生成故事段。",
  chartKind: "donut",
  chartData: [1],
  chartLabels: ["暂无数据"],
};

/** 年度总览聚合行：类型与解析函数已随三条共享 SQL 抽到 poster-input.ts（A17 修订） */

interface MonthPoint {
  /** YYYY-MM（fmtMonth 口径，与引擎月份展示一致） */
  label: string;
  expenseCents: number;
}

function parseMonthlyTrend(rows: Record<string, unknown>[]): MonthPoint[] {
  return rows
    .map((row) => ({ label: fmtMonth(valAt(row, 0)), expenseCents: numAt(row, 1) }))
    .filter((point) => point.expenseCents > 0 && point.label.length >= 4)
    .reverse(); // 查询按月份 DESC 取最新 12 行，展示需要升序
}

interface MerchantPoint {
  merchant: string;
  totalCents: number;
  txCount: number;
}

function parseTopMerchants(rows: Record<string, unknown>[]): MerchantPoint[] {
  return rows
    .map((row) => ({
      merchant: String(valAt(row, 0) ?? ""),
      totalCents: numAt(row, 1),
      txCount: numAt(row, 2),
    }))
    .filter((point) => point.merchant.length > 0 && point.totalCents > 0);
}

/** 商户轴标签截断：长商户名压到 5 字符加省略号，配合 30° 旋转避免类目轴标签互相压盖 */
function shortMerchant(name: string): string {
  return name.length > 5 ? `${name.slice(0, 5)}…` : name;
}

/** 六维健康聚合行：类型与解析函数已抽到 poster-input.ts（A17 修订），本页直接复用 */

/** 餐饮细分聚合行 */
interface FoodSubPoint {
  subCategory: string;
  totalCents: number;
}

function parseFoodSub(rows: Record<string, unknown>[]): FoodSubPoint[] {
  return rows
    .map((row) => ({
      subCategory: String(valAt(row, 0) ?? "").trim(),
      totalCents: numAt(row, 1),
    }))
    .filter((point) => point.subCategory.length > 0 && point.totalCents > 0);
}

/** 类目总额聚合行（v_category_monthly 跨月求和结果） */
interface CategoryCentsPoint {
  category: string;
  expenseCents: number;
}

function parseCategoryCents(rows: Record<string, unknown>[]): CategoryCentsPoint[] {
  return rows
    .map((row) => ({
      category: String(valAt(row, 0) ?? "").trim(),
      expenseCents: numAt(row, 1),
    }))
    .filter((point) => point.category.length > 0 && point.expenseCents > 0);
}

/**
 * 年度关键词与总结口径：取 lastRun.cards 中 stage === "annual" 且 confidence
 * 最高的一张（store 落卡时已过滤 status === "published"，此处不重复过滤）。
 * headline 作为故事首段的关键词行，narrative 作为年度总结；
 * 年度阶段整体降级（无卡）时回退模板句（由真实聚合数字填数）。
 */
function pickAnnualCard(cards: InsightCard[]): InsightCard | null {
  const annualCards = cards.filter((card) => card.stage === "annual");
  if (annualCards.length === 0) return null;
  return annualCards.reduce((best, card) => (card.confidence > best.confidence ? card : best));
}

interface RealAggregates {
  annual: AnnualOverview | null;
  monthly: MonthPoint[];
  merchants: MerchantPoint[];
  activeMonths: number | null;
  /** 六维健康聚合：查询失败或 0 行时为 null，healthIndex/雷达/四指标整组回退 demo */
  health: HealthStats | null;
  foodSub: FoodSubPoint[];
  categoryCents: CategoryCentsPoint[];
}

/** 健康分合成与真实四指标：实现已抽到 poster-input.ts（A17 修订），本页直接复用 */

/**
 * 段 2（餐饮细分 donut）：真实查询失败或餐饮无细分记录时返回 null 回退 demo 段。
 * 环形图最多取前 6 个细分场景（超过 6 瓣标签会互压），叙事里的占比按全部
 * 查询结果（≤12 类）计算，图表只呈现头部切片。
 */
function buildFoodSegment(points: FoodSubPoint[]): ReportStorySegment | null {
  const valid = points.filter((point) => point.subCategory.length > 0 && point.totalCents > 0);
  if (valid.length === 0) return null;
  const total = valid.reduce((sum, point) => sum + point.totalCents, 0);
  const top = valid[0]!;
  const second = valid[1];
  const slices = valid.slice(0, 6);
  return {
    headline: `餐饮支出里「${top.subCategory}」排第一`,
    narrative:
      `账单里的餐饮细分共 ${valid.length} 类，其中「${top.subCategory}」花得最多，` +
      `¥${fmtYuan(top.totalCents)}（占餐饮 ${((top.totalCents / total) * 100).toFixed(1)}%）` +
      (second ? `；其次「${second.subCategory}」¥${fmtYuan(second.totalCents)}` : "") +
      `。`,
    chartKind: "donut",
    chartData: slices.map((point) => point.totalCents / 100), // 分 → 元：donut 只按占比归一，刻度与元对齐
    chartLabels: slices.map((point) => point.subCategory),
    chartUnit: "yuan",
  };
}

/**
 * 段 4 三组映射常量：把 12 类目归入「体验/实物/服务」三组。
 * 口径：体验 = 现场感与社交性消费（演出/旅行/聚餐/礼赠），实物 = 有形商品购买，
 * 其余生活运行类（居住/交通/医疗/教育/金融/订阅）归服务。
 */
const EXPERIENCE_GROUP_MAP: Readonly<Record<string, "体验" | "实物" | "服务">> = {
  娱乐: "体验",
  餐饮: "体验",
  人情: "体验",
  购物: "实物",
  通讯: "实物",
  居住: "服务",
  交通: "服务",
  医疗: "服务",
  教育: "服务",
  金融: "服务",
  订阅: "服务",
  其他: "服务",
};

/** 段 4（体验/实物/服务 donut）：真实查询失败或全零时返回 null 回退 demo 段 */
function buildExperienceSegment(points: CategoryCentsPoint[]): ReportStorySegment | null {
  const groupCents = new Map<"体验" | "实物" | "服务", number>([
    ["体验", 0],
    ["实物", 0],
    ["服务", 0],
  ]);
  for (const point of points) {
    const group = EXPERIENCE_GROUP_MAP[point.category];
    if (group) groupCents.set(group, (groupCents.get(group) ?? 0) + point.expenseCents);
  }
  const entries = [...groupCents.entries()]
    .map(([name, cents]) => ({ name, cents }))
    .sort((a, b) => b.cents - a.cents);
  const total = entries.reduce((sum, entry) => sum + entry.cents, 0);
  if (total <= 0) return null;
  const top = entries[0]!;
  const second = entries[1];
  return {
    headline: `你的消费在向「${top.name}」倾斜`,
    narrative:
      `按体验/实物/服务三分后，「${top.name}」占 ${((top.cents / total) * 100).toFixed(1)}%` +
      `（¥${fmtYuan(top.cents)}）` +
      (second && second.cents > 0 ? `，其次「${second.name}」¥${fmtYuan(second.cents)}` : "") +
      `。`,
    chartKind: "donut",
    chartData: entries.map((entry) => entry.cents / 100),
    chartLabels: entries.map((entry) => entry.name),
    chartUnit: "yuan",
  };
}

/**
 * 真实聚合 → 报告对象映射（真实优先 + 字段级 demo 兜底，任一查询失败只降级对应字段）：
 * - 年度总览（年份/月数/笔数/总额）：annual 聚合失败或空库时整体回退 demo meta；
 *   活跃月数失败时依次回退月度行数、demo 值；
 * - 六维健康（healthIndex/雷达/四指标）：health 聚合失败或 0 行时整组回退 demo；
 * - 故事段 1 月度趋势：monthly 聚合失败时整段回退 demo 趋势段；无 annual 卡时
 *   叙事走模板句，数字全部由真实聚合填数（2f：不出现写死演示数）；
 * - 故事段 2 餐饮细分：foodSub 聚合失败或无数据时整段回退 demo 外卖/堂食段；
 * - 故事段 3 Top 商户：merchants 聚合失败或近 90 天无支出时整段回退 demo 订阅 bar 段
 *   （bar 图 kind 对位，demo 段的订阅口径与 v_top_merchants_90d 的 bar 形态一致）；
 * - 故事段 4 体验/实物/服务：categoryCents 聚合失败或无数据时整段回退 demo 段。
 */
function buildReportData(agg: RealAggregates, cards: InsightCard[]): ReportData {
  const demo = demoReportData();
  const [demoTrend, demoFood, demoSub, demoExperience] = demo.storySegments;
  const annualCard = pickAnnualCard(cards);

  const meta: ReportMeta = agg.annual
    ? {
        year: agg.annual.year,
        monthsCovered:
          agg.activeMonths ??
          (agg.monthly.length > 0 ? agg.monthly.length : demo.meta.monthsCovered),
        totalTransactions: agg.annual.totalTx,
        totalExpenseCents: agg.annual.totalExpenseCents,
      }
    : demo.meta;

  // 年度故事模板句（2f）：无 annual 卡时由月度聚合填数，峰值/谷值/月均全部来自真实行
  let realTrendNarrative = "";
  if (agg.monthly.length > 0) {
    const totalCents = agg.monthly.reduce((sum, point) => sum + point.expenseCents, 0);
    const avgCents = Math.round(totalCents / agg.monthly.length);
    const peak = agg.monthly.reduce((a, b) => (b.expenseCents > a.expenseCents ? b : a));
    const trough = agg.monthly.reduce((a, b) => (b.expenseCents < a.expenseCents ? b : a));
    realTrendNarrative =
      `近 ${agg.monthly.length} 个月一共花 ¥${fmtYuan(totalCents)}，月均 ¥${fmtYuan(avgCents)}。` +
      `花得最多的是 ${peak.label}（¥${fmtYuan(peak.expenseCents)}），` +
      `最少的是 ${trough.label}（¥${fmtYuan(trough.expenseCents)}）。`;
  }

  const trendSegment: ReportStorySegment =
    agg.monthly.length > 0
      ? {
          // 关键词行优先用 annual 卡 headline；无卡但有年度聚合时按聚合数字生成
          headline:
            annualCard?.headline ??
            (agg.annual
              ? `${agg.annual.year} 年支出 ¥${fmtYuan(agg.annual.totalExpenseCents)} · 共 ${agg.annual.totalTx} 笔`
              : (demoTrend ?? EMPTY_SEGMENT).headline),
          // 年度总结 = confidence 最高的 annual 卡 narrative；无卡时用真实数字模板句
          narrative:
            annualCard?.narrative ?? realTrendNarrative ?? (demoTrend ?? EMPTY_SEGMENT).narrative,
          chartKind: "timeseries",
          chartData: agg.monthly.map((point) => point.expenseCents / 100), // 分 → 元：折线段 tooltip 按「N 元」展示
          chartLabels: agg.monthly.map((point) => point.label),
        }
      : (demoTrend ?? EMPTY_SEGMENT);

  const topMerchant = agg.merchants[0];
  const merchantTotalCents = agg.merchants.reduce((sum, point) => sum + point.totalCents, 0);
  const merchantSegment: ReportStorySegment =
    agg.merchants.length > 0 && topMerchant
      ? {
          headline: `近 90 天花钱最多的 ${agg.merchants.length} 家商户 · ${shortMerchant(topMerchant.merchant)} 排第一`,
          narrative:
            `近 90 天的支出集中在 ${agg.merchants.length} 家商户，合计 ¥${fmtYuan(merchantTotalCents)}；` +
            `其中 ${shortMerchant(topMerchant.merchant)} 花得最多，共 ¥${fmtYuan(topMerchant.totalCents)}（${topMerchant.txCount} 笔）。`,
          chartKind: "bar",
          chartData: agg.merchants.map((point) => point.totalCents), // 单位分：bar 段 tooltip/y 轴按 /100 换算元（与 demo 订阅段同口径）
          chartLabels: agg.merchants.map((point) => shortMerchant(point.merchant)),
        }
      : (demoSub ?? EMPTY_SEGMENT);

  const foodSegment =
    (agg.foodSub.length > 0 ? buildFoodSegment(agg.foodSub) : null) ?? demoFood ?? EMPTY_SEGMENT;
  const experienceSegment =
    (agg.categoryCents.length > 0 ? buildExperienceSegment(agg.categoryCents) : null) ??
    demoExperience ??
    EMPTY_SEGMENT;

  const healthScore = agg.health ? computeHealthScore(agg.health) : null;

  return {
    isReal: agg.annual !== null,
    meta,
    healthIndex: healthScore?.healthIndex ?? demo.healthIndex,
    healthIndexReal: healthScore !== null,
    radarDims: healthScore?.dims ?? demo.radarDims,
    healthRatios: healthScore?.ratios ?? demo.healthRatios,
    namedMetrics: agg.health ? buildRealMetrics(agg.health) : demo.namedMetrics,
    storySegments: [trendSegment, foodSegment, merchantSegment, experienceSegment],
  };
}

// 年度海报统一收敛在公共层 components/report/poster-canvas.ts（renderPosterPng(report)
// 支持内置/真实两条动线的报告对象，导出分辨率与布局修正在公共层一次生效），
// 本页不再维护海报副本实现。

/** 健康指数仪表盘：270° 环形进度 + 中心大数字（工厂函数在暗色切换时重取色板） */
const buildGaugeOption = (healthIndex: number): ECOption => {
  const t = chartTokens();
  return {
    series: [
      {
        type: "gauge",
        startAngle: 210,
        endAngle: -30,
        min: 0,
        max: 100,
        // 95%→82%：270° 弧的最底点落在半径 × 中心偏移处，原值会把弧底裁出画布 15-23px
        radius: "82%",
        center: ["50%", "55%"],
        progress: {
          show: true,
          width: 16,
          roundCap: true,
          itemStyle: { color: cssVar("--color-health", "#0fa87a") },
        },
        axisLine: { lineStyle: { width: 16, color: [[1, t.lineHair]] } },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        pointer: { show: false },
        title: {
          show: true,
          offsetCenter: [0, "38%"],
          fontSize: 13,
          color: t.inkSecondary,
        },
        detail: {
          valueAnimation: true,
          offsetCenter: [0, "-12%"],
          fontSize: 46,
          fontWeight: 700,
          color: t.ink,
          formatter: "{value}",
        },
        data: [{ value: healthIndex, name: "健康指数" }],
      },
    ],
  };
};

/** 六维健康雷达：单系列多边形，面积填充半透明主色；维度来自报告对象（真实=六维分，demo=DEMO_REPORT.radarDims） */
const buildRadarOption = (dims: RadarDim[]): ECOption => {
  const t = chartTokens();
  const primary = t.palette[0] ?? "#2e7ce8";
  return {
    tooltip: {
      trigger: "item",
      backgroundColor: t.surface,
      borderColor: t.lineHair,
      textStyle: { color: t.ink },
    },
    radar: {
      indicator: dims.map((d) => ({ name: d.name, max: 100 })),
      radius: "66%",
      splitNumber: 4,
      axisName: { color: t.inkSecondary, fontSize: 12 },
      axisLine: { lineStyle: { color: t.lineHair } },
      splitLine: { lineStyle: { color: t.lineHair } },
      splitArea: { areaStyle: { color: ["transparent"] } },
    },
    series: [
      {
        type: "radar",
        symbolSize: 6,
        lineStyle: { color: primary, width: 2 },
        itemStyle: { color: primary },
        areaStyle: { color: hexToRgba(primary, 0.18) },
        data: [{ value: dims.map((d) => d.value), name: "六维健康分" }],
      },
    ],
  };
};

/**
 * 数据故事四段各自的图表工厂。storySegments 的 chartData 单位不统一：
 * timeseries/donut 为元或百分比刻度，bar（订阅/商户段）为分——按段语义分别换算。
 * tooltip 三图统一（审计修复 3c）：confine 防溢出容器、内边距与圆角提升可读性。
 */
function buildStoryOption(seg: ReportStorySegment): () => ECOption {
  return () => {
    const t = chartTokens();
    const tooltipBase = {
      backgroundColor: t.surface,
      borderColor: t.lineHair,
      textStyle: { color: t.ink, fontSize: 12 },
      confine: true,
      padding: [8, 12],
      extraCssText: "border-radius:8px;",
    };

    if (seg.chartKind === "timeseries") {
      const primary = t.palette[0] ?? "#2e7ce8";
      return {
        grid: { left: 8, right: 8, top: 28, bottom: 8, containLabel: true },
        tooltip: {
          ...tooltipBase,
          trigger: "axis",
          // 固定两位小数，避免 1876.5 元 / 1876.54 元混排（demo 与真实段均为元刻度）
          valueFormatter: (value: unknown) => `${Number(value).toFixed(2)} 元`,
        },
        xAxis: {
          type: "category",
          data: seg.chartLabels,
          boundaryGap: false,
          axisTick: { show: false },
          axisLine: { lineStyle: { color: t.lineHair } },
          axisLabel: { color: t.inkMuted },
        },
        yAxis: {
          type: "value",
          splitLine: { lineStyle: { color: t.lineHair } },
          axisLabel: {
            color: t.inkMuted,
            // 轴刻度带 ¥ 前缀：报告段数据统一为元刻度，轴示值与 tooltip 同口径
            formatter: (value: number) => `¥${value}`,
          },
        },
        series: [
          {
            type: "line",
            data: seg.chartData,
            smooth: true,
            symbol: "circle",
            symbolSize: 7,
            lineStyle: { width: 2, color: primary },
            itemStyle: { color: primary, borderColor: t.surface, borderWidth: 2 },
            areaStyle: {
              color: {
                type: "linear",
                x: 0,
                y: 0,
                x2: 0,
                y2: 1,
                colorStops: [
                  { offset: 0, color: hexToRgba(primary, 0.22) },
                  { offset: 1, color: hexToRgba(primary, 0) },
                ],
              },
            },
          },
        ],
      };
    }

    if (seg.chartKind === "bar") {
      return {
        grid: { left: 8, right: 8, top: 24, bottom: 8, containLabel: true },
        tooltip: {
          ...tooltipBase,
          trigger: "axis",
          axisPointer: { type: "shadow" },
          valueFormatter: (value: unknown) => `¥${(Number(value) / 100).toFixed(2)}`,
        },
        xAxis: {
          type: "category",
          data: seg.chartLabels,
          axisTick: { show: false },
          axisLine: { lineStyle: { color: t.lineHair } },
          // 审计修复 3b：字号 10 + 全部渲染 + 30° 旋转 + 上移 8px，避免类目标签互压
          axisLabel: {
            color: t.inkSecondary,
            fontSize: 10,
            interval: 0,
            rotate: 30,
            margin: 8,
          },
        },
        yAxis: {
          type: "value",
          splitLine: { lineStyle: { color: t.lineHair } },
          axisLabel: {
            color: t.inkMuted,
            formatter: (value: number) => `¥${(value / 100).toFixed(0)}`,
          },
        },
        series: [
          {
            type: "bar",
            barWidth: 36,
            data: seg.chartData.map((value, i) => ({
              value,
              itemStyle: {
                color: t.palette[i % t.palette.length],
                borderRadius: [4, 4, 0, 0],
              },
            })),
          },
        ],
      };
    }

    // donut：分类占比，图例 + 直标百分比，颜色按实体固定顺序取色板。
    // 审计修复 3a：图例移到顶部、环半径收窄并下移中心，给标签留出上下空间；
    // 标签只写百分比单行 + 重叠隐藏，避免多瓣时标签互相压盖；
    // 真实段（chartUnit=yuan）tooltip 报金额 + 1 位小数占比，demo 段数据本身就是百分比只报占比
    const isYuan = seg.chartUnit === "yuan";
    return {
      tooltip: {
        ...tooltipBase,
        trigger: "item",
        formatter: (p: CallbackDataParams | CallbackDataParams[]) => {
          const params = Array.isArray(p) ? p[0] : p;
          const name = params?.name ?? "";
          const pct = typeof params?.percent === "number" ? params.percent.toFixed(1) : "0.0";
          if (!isYuan) return `${name}：${pct}%`;
          const v = Number(params?.value ?? 0);
          return `${name}：¥${v.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}（${pct}%）`;
        },
      },
      legend: {
        top: 0,
        icon: "circle",
        itemWidth: 10,
        itemHeight: 10,
        itemGap: 14,
        textStyle: { color: t.inkSecondary, fontSize: 11 },
      },
      series: [
        {
          type: "pie",
          radius: ["50%", "68%"],
          center: ["50%", "54%"],
          avoidLabelOverlap: true,
          label: {
            show: true,
            color: t.ink,
            // 1 位小数，与叙事口径一致；percent 在类型上可选，需 ?? 0 兜底
            formatter: (p) => `${(p.percent ?? 0).toFixed(1)}%`,
            fontSize: 11,
          },
          labelLine: { length: 6, length2: 6 },
          labelLayout: { hideOverlap: true },
          // 小角切片不拉标签线（6.1.0 支持）
          minShowLabelAngle: 8,
          itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 6 },
          data: seg.chartLabels.map((name, i) => ({
            name,
            value: seg.chartData[i] ?? 0,
            itemStyle: { color: t.palette[i % t.palette.length] },
          })),
        },
      ],
    };
  };
}

export default function ReportPage() {
  // 成就属客户端本地数据：订阅式读取，SSR 首帧空集与水合后本地集合口径一致
  const unlockedIds = useUnlockedIds();
  const [posterBusy, setPosterBusy] = useState(false);
  const [toast, setToast] = useState<{ id: number; text: string; kind: "ok" | "error" } | null>(
    null,
  );

  // 数据源：最近一次体检运行。null = 内置数据路径（整页保持 DEMO_REPORT 静态展示）；
  // 存在 = 真实优先，effect 里从预计算表/视图聚合，失败字段逐项回退 demo
  const lastRun = usePipeline((s) => s.lastRun);
  const [report, setReport] = useState<ReportData>(demoReportData);

  useEffect(() => {
    // 内置数据路径不发起任何查询
    if (!lastRun) return;
    let cancelled = false;

    void (async () => {
      let conn: AsyncDuckDBConnection;
      try {
        conn = await getDuckDB();
      } catch {
        // 数据库不可用（wasm 加载失败等）：整份报告保持 demo 兜底，不做局部重试
        return;
      }

      // 七条确定性聚合并行执行；allSettled 保证任一失败不拖垮其余字段
      const [annualRes, monthlyRes, merchantsRes, monthsRes, healthRes, foodSubRes, categoryRes] =
        await Promise.allSettled([
          runWhitelistedAggregate(conn, ANNUAL_OVERVIEW_SQL),
          runWhitelistedAggregate(conn, MONTHLY_TREND_SQL),
          runWhitelistedAggregate(conn, TOP_MERCHANTS_SQL),
          runWhitelistedAggregate(conn, ACTIVE_MONTHS_SQL),
          runWhitelistedAggregate(conn, HEALTH_INPUTS_SQL),
          runWhitelistedAggregate(conn, FOOD_SUBCATEGORY_SQL),
          runWhitelistedAggregate(conn, CATEGORY_TOTAL_SQL),
        ]);
      if (cancelled) return;

      const rowsOf = (res: PromiseSettledResult<{ rows: unknown[] }>): Record<string, unknown>[] =>
        res.status === "fulfilled" ? (res.value.rows as Record<string, unknown>[]) : [];

      const annual =
        annualRes.status === "fulfilled" ? parseAnnualOverview(rowsOf(annualRes)) : null;
      const monthly =
        monthlyRes.status === "fulfilled" ? parseMonthlyTrend(rowsOf(monthlyRes)) : [];
      const merchants =
        merchantsRes.status === "fulfilled" ? parseTopMerchants(rowsOf(merchantsRes)) : [];
      const monthCount =
        monthsRes.status === "fulfilled" ? numAt(rowsOf(monthsRes)[0] ?? {}, 0) : 0;
      // 六维健康：查询失败时 health 为 null，healthIndex/雷达/四指标整组回退 demo
      const health =
        healthRes.status === "fulfilled"
          ? ((): HealthStats | null => {
              const rows = parseHealthRows(rowsOf(healthRes));
              return rows.length > 0 ? { rows } : null;
            })()
          : null;
      const foodSub = foodSubRes.status === "fulfilled" ? parseFoodSub(rowsOf(foodSubRes)) : [];
      const categoryCents =
        categoryRes.status === "fulfilled" ? parseCategoryCents(rowsOf(categoryRes)) : [];

      setReport(
        buildReportData(
          {
            annual,
            monthly,
            merchants,
            activeMonths: monthCount > 0 ? monthCount : null,
            health,
            foodSub,
            categoryCents,
          },
          lastRun.cards,
        ),
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [lastRun]);

  // 报告页是段位的计算源头：真实健康分算出后按分分档并写回本地，个人中心与海报
  // 读同一份；内置数据路径不写档位（2g：只在真实 healthIndex 算出后保存）。
  // 用订阅式读取：SSR 首帧按纯分档渲染，水合后再读本地存储档位
  const rank = useRankTier(report.healthIndexReal ? report.healthIndex : undefined);

  useEffect(() => {
    if (report.healthIndexReal) saveRankTier(rank.tier);
  }, [report.healthIndexReal, rank.tier]);

  const showToast = useCallback((text: string, kind: "ok" | "error" = "ok") => {
    setToast({ id: Date.now(), text, kind });
  }, []);

  const storyOptions = useMemo(
    () => report.storySegments.map((seg) => buildStoryOption(seg)),
    [report.storySegments],
  );

  // 工厂闭包保持稳定引用：EChart 以 option 引用变化作为重绘信号，避免每渲染重设
  const gaugeOption = useMemo(
    () => () => buildGaugeOption(report.healthIndex),
    [report.healthIndex],
  );

  const radarOption = useMemo(() => () => buildRadarOption(report.radarDims), [report.radarDims]);

  // 六维明细行、评级与总评大白话：全部来自 labels.ts 纯函数，只改展示文案层
  // （评级徽标、状态标签、措辞），健康分与段位的计算口径保持不变
  const healthDims = useMemo(() => buildHealthDims(report.healthRatios), [report.healthRatios]);
  const healthRating = healthRatingLabel(report.healthIndex);
  const healthComment = useMemo(() => buildHealthComment(healthDims), [healthDims]);

  const handlePoster = useCallback(async () => {
    setPosterBusy(true);
    try {
      // 海报统一走公共层：内置/真实两条动线都传已映射的报告对象（同一数据形状）
      const blob = await renderPosterPng(report);
      if (!blob) {
        showToast("海报生成失败，请重试", "error");
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "spendct-annual-poster.png";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // 延迟回收：等浏览器取完 Blob 再释放对象 URL
      window.setTimeout(() => URL.revokeObjectURL(url), 3000);
      showToast("海报已生成，开始下载");
      // 生成海报即解锁对应成就：unlockAchievement 持久化并通知订阅组件，
      // 成就墙对新徽章播放弹入动画
      unlockAchievement("annual-poster");
    } catch {
      showToast("海报生成失败，请重试", "error");
    } finally {
      setPosterBusy(false);
    }
  }, [showToast, report]);

  return (
    <AuthGuard>
      <Container wide className="py-8 print:max-w-none print:px-2 print:py-4">
        {/* 打印样式：全局壳层（顶栏/页脚/底部 tab）不在本页可改范围内，
          用 style 标签在打印时整体隐藏；页内控件用 Tailwind print: 工具类处理 */}
        <style>{`
        @media print {
          body > header,
          body > footer,
          body > nav[aria-label="底部导航"] {
            display: none !important;
          }
        }
      `}</style>

        {/* 页头 */}
        <header className="flex flex-wrap items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-(--radius-md) bg-(--color-primary-soft) text-(--color-primary)">
            <BookOpenText className="size-6" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold">{report.meta.year} 年度报告</h1>
            <p className="text-sm text-(--color-ink-secondary)">
              六步体检的年度汇总：健康指数、四段数据故事、段位与成就
            </p>
          </div>
          <div className="ml-auto hidden items-center gap-2 sm:flex">
            <span className="rounded-full border border-(--color-border) px-3 py-1 text-xs text-(--color-ink-secondary)">
              覆盖 {report.meta.monthsCovered} 个月
            </span>
            <span className="rounded-full border border-(--color-border) px-3 py-1 text-xs text-(--color-ink-secondary)">
              {report.meta.totalTransactions.toLocaleString("zh-CN")} 笔
            </span>
            {report.isReal ? (
              <span className="rounded-full border border-(--color-border) px-3 py-1 text-xs text-(--color-ink-secondary)">
                年度支出 ¥{fmtYuan(report.meta.totalExpenseCents)}
              </span>
            ) : null}
            <span className="rounded-full border border-(--color-border) px-3 py-1 text-xs text-(--color-ink-secondary)">
              {report.isReal ? "本地数据" : "内置数据"}
            </span>
          </div>
        </header>

        {/* Hero：健康仪表 + 四具名指标 */}
        <section
          aria-label="健康总览"
          className="mt-6 grid gap-4 lg:grid-cols-5 print:break-inside-avoid"
        >
          <div className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-4 shadow-(--shadow-sm) lg:col-span-2">
            <EChart
              option={gaugeOption}
              height={272}
              ariaLabel={`消费健康指数仪表盘：${report.healthIndex} 分`}
            />
            {/* 评级徽标 + 总分注释：评级只影响展示，不参与段位判定（段位走 rank.ts TIER_BANDS） */}
            <div className="mt-1 flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${RATING_TONE_META[healthRating.tone].chip}`}
              >
                {healthRating.label}
              </span>
              <p className="text-center text-xs text-(--color-ink-muted)">
                综合六维消费健康分 · 满分 100
              </p>
            </div>
            {/* 六维总评大白话：由六维状态规则生成，结论先行、点到为止 */}
            <p className="mx-auto mt-2 max-w-72 text-center text-xs leading-relaxed text-(--color-ink-secondary)">
              {healthComment}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:col-span-3">
            {report.namedMetrics.map((m) => {
              const meta = STATUS_META[m.status] ?? STATUS_META.warn!;
              const StatusIcon = meta.icon;
              const DeltaIcon = m.delta.startsWith("+") ? ArrowUpRight : ArrowDownRight;
              return (
                <div
                  key={m.id}
                  className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-4 shadow-(--shadow-sm)"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-(--color-ink-secondary)">{m.name}</p>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${meta.chip}`}
                    >
                      <StatusIcon className="size-3.5" aria-hidden />
                      {meta.label}
                    </span>
                  </div>
                  <p className="mt-2 text-3xl font-bold tabular-nums">{m.value}</p>
                  <p className="mt-1 flex items-center gap-2 text-sm">
                    <span
                      className={`inline-flex items-center gap-0.5 font-semibold tabular-nums ${meta.text}`}
                    >
                      <DeltaIcon className="size-4" aria-hidden />
                      {m.delta}
                    </span>
                    {/* 只渲染有公开来源的基准（2c）：无公开基准的指标不显示基准行 */}
                    {m.benchmark !== null ? (
                      <span className="text-(--color-ink-muted)">
                        全国平均 {m.benchmark} · 国家统计局 2025
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-(--color-ink-muted)">
                    {m.explain}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        {/* 六维明细：维度名 + 状态标签（健康/注意/风险）+ 一句大白话，
          原百分比降为右侧小字（颜色随状态）。状态阈值与句式来自 labels.ts
          （沿用四指标卡既有阈值），只做展示映射，不影响六维健康分计算 */}
        <section aria-label="六维健康明细" className="mt-4 print:break-inside-avoid">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <CircleCheck className="size-5 text-(--color-primary)" aria-hidden />
            六维健康明细
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {healthDims.map((row) => {
              const meta = STATUS_META[row.status] ?? STATUS_META.warn!;
              const StatusIcon = meta.icon;
              return (
                <div
                  key={row.key}
                  className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-3 shadow-(--shadow-sm)"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{row.name}</p>
                    <div className="flex items-center gap-2">
                      {/* 右侧小字：原始比率保留一位小数，颜色随状态 */}
                      <span className={`text-xs tabular-nums ${meta.text}`}>
                        {row.ratio.toFixed(1)}%
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${meta.chip}`}
                      >
                        <StatusIcon className="size-3.5" aria-hidden />
                        {row.statusLabel}
                      </span>
                    </div>
                  </div>
                  {/* 大白话短句：按「每 100 元」口径换算取整，数字不再是干巴巴的百分比 */}
                  <p className="mt-1.5 text-xs leading-relaxed text-(--color-ink-secondary)">
                    {row.plain}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        {/* 滚动式数据故事 */}
        {featureFlags.reportStory ? (
          <section aria-label="年度数据故事" className="mt-8">
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <BookOpenText className="size-5 text-(--color-primary)" aria-hidden />
              年度数据故事
            </h2>
            <div className="mt-4 flex flex-col gap-4">
              {report.storySegments.map((seg, i) => (
                <motion.article
                  key={seg.headline}
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-60px" }}
                  transition={{ duration: 0.24, ease: "easeOut" }}
                  className="grid gap-4 rounded-(--radius-xl) border border-(--color-border) bg-(--color-surface) p-5 shadow-(--shadow-sm) md:grid-cols-2 md:p-6 print:break-inside-avoid"
                >
                  <div className="flex flex-col justify-center">
                    <span className="w-max rounded-full bg-(--color-primary-soft) px-2.5 py-0.5 text-xs font-semibold text-(--color-brand-600) tabular-nums">
                      {String(i + 1).padStart(2, "0")} / {report.storySegments.length}
                    </span>
                    <h3 className="mt-3 text-lg font-bold">{seg.headline}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-(--color-ink-secondary)">
                      {seg.narrative}
                    </p>
                  </div>
                  <EChart
                    option={storyOptions[i] ?? (() => ({}))}
                    height={260}
                    ariaLabel={seg.headline}
                  />
                </motion.article>
              ))}
            </div>
          </section>
        ) : null}

        {/* 段位与成就 */}
        <section
          aria-label="段位与成就"
          className="mt-8 grid gap-4 lg:grid-cols-5 print:break-before-page"
        >
          <RankBadge tier={rank} className="lg:col-span-2" />
          <div className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-4 shadow-(--shadow-sm) lg:col-span-3">
            <div className="flex items-center justify-between px-1">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Trophy className="size-4 text-(--color-primary)" aria-hidden />
                六维健康雷达
              </h2>
              <span className="text-xs text-(--color-ink-muted)">分数越高越健康</span>
            </div>
            <EChart
              option={radarOption}
              height={300}
              ariaLabel={`六维健康雷达图：${report.radarDims.map((d) => d.name).join("、")}六个维度的健康分`}
            />
          </div>
        </section>

        {featureFlags.achievements ? (
          <section aria-label="成就墙" className="mt-4 print:break-inside-avoid">
            <div className="mb-3">
              <h2 className="flex items-center gap-2 text-lg font-bold">
                <Trophy className="size-5 text-(--color-primary)" aria-hidden />
                成就徽章
              </h2>
              <p className="mt-1 text-sm text-(--color-ink-secondary)">
                已解锁 {unlockedIds.length}/{ACHIEVEMENT_DEFS.length} 枚，完成条件即自动解锁
              </p>
            </div>
            <AchievementWall unlockedIds={unlockedIds} compact />
          </section>
        ) : null}

        {/* 海报与导出 */}
        <section aria-label="海报与导出" className="mt-8 print:hidden">
          <div className="rounded-(--radius-xl) border border-(--color-border) bg-(--color-surface) p-5 shadow-(--shadow-sm) md:p-6">
            <h2 className="text-lg font-bold">海报与导出</h2>
            <p className="mt-1 text-sm text-(--color-ink-secondary)">
              生成一张高清年度海报，长按可分享；海报直接在浏览器里生成。
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void handlePoster()}
                disabled={posterBusy}
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-(--color-btn-primary) px-5 text-sm font-medium text-white transition-colors hover:bg-(--color-btn-primary-hover) disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Download className="size-4" aria-hidden />
                {posterBusy ? "生成中…" : "生成年度海报"}
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-(--color-border) px-5 text-sm font-medium transition-colors hover:border-(--color-border-strong)"
              >
                <FileText className="size-4" aria-hidden />
                导出 PDF
              </button>
            </div>
            <p className="mt-3 flex items-center gap-1.5 text-xs text-(--color-ink-muted)">
              <CircleCheck className="size-3.5" aria-hidden />
              生成海报会自动解锁「年度海报」成就；导出 PDF 调用浏览器打印，请在打印窗口选择「另存为
              PDF」。
            </p>
          </div>
        </section>

        {/* 轻提示：底部居中，不打断操作 */}
        <AnimatePresence>
          {toast ? (
            <div
              key={toast.id}
              className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-4 md:bottom-8 print:hidden"
            >
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.18 }}
                onAnimationComplete={() => {
                  window.setTimeout(() => {
                    setToast((current) => (current?.id === toast.id ? null : current));
                  }, 2600);
                }}
                className="flex items-center gap-2 rounded-full bg-(--color-ink) px-4 py-2.5 text-sm text-(--color-surface) shadow-(--shadow-lg)"
              >
                {toast.kind === "ok" ? (
                  <CircleCheck className="size-4 text-(--color-good)" aria-hidden />
                ) : (
                  <CircleX className="size-4 text-(--color-critical)" aria-hidden />
                )}
                {toast.text}
              </motion.div>
            </div>
          ) : null}
        </AnimatePresence>
      </Container>
    </AuthGuard>
  );
}
