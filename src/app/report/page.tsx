"use client";

import * as echarts from "echarts/core";
import { RadarChart } from "echarts/charts";
import { RadarComponent } from "echarts/components";

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
import {
  chartTokens,
  cssVar,
  EChart,
  type ECOption,
} from "@/components/charts/e-chart";
import { Container } from "@/components/layout/container";
import { RankBadge } from "@/components/report/rank-badge";
import { renderPosterPng } from "@/components/report/poster-canvas";
import { ACHIEVEMENT_DEFS, getUnlockedIds, unlockAchievement } from "@/lib/achievements";
import { DEMO_ACCOUNT_META, DEMO_REPORT } from "@/lib/demo-data";
import { getDuckDB } from "@/lib/duckdb/service";
import { featureFlags } from "@/lib/feature-flags";
import { fmtMonth, fmtYuan, numAt, valAt } from "@/lib/pipeline/stages/spec";
import { usePipeline } from "@/lib/pipeline/store";
import { getRankTier, saveRankTier } from "@/lib/rank";
import type { InsightCard } from "@/lib/schema/insight-card";
import { runWhitelistedAggregate } from "@/lib/sql-guard/whitelist";

/** 六维健康雷达演示静态值：正式版由 v_health_inputs 六维分聚合而来（0-100，越高越健康） */
const RADAR_DIMS = [
  { name: "餐饮", value: 82 },
  { name: "购物", value: 64 },
  { name: "交通", value: 78 },
  { name: "娱乐", value: 46 },
  { name: "居住", value: 81 },
  { name: "其他", value: 55 },
] as const;

/** 四态 → 页面展示元：色+图标+文案成对出现，不靠颜色单独传义（05 §3.1.2） */
const STATUS_META: Record<
  string,
  { label: string; icon: LucideIcon; chip: string; text: string }
> = {
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

/** hex 色值 → rgba：折线面积渐变需要半透明档，CSS 变量只给 hex */
function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// ─────────────────────────── 真实数据查询层（真实优先 + demo 兜底） ───────────────────────────

/**
 * 四条确定性聚合 SQL：全部是代码常量、零用户输入（07 §6 SQL 硬约束 b 类），
 * 统一经 runWhitelistedAggregate 执行（白名单预检 + 3s 超时 + 行数复检）。
 *
 * 白名单文法子集不支持 AS 别名与 COUNT(DISTINCT …)，结果列一律按 SELECT 位置
 * 取值（numAt/valAt，与引擎 stages/spec.ts 同口径），不依赖 DuckDB 自动列名拼写。
 *
 * - annual_summary：年度总览。表按 year 唯一一行，SUM/MAX 只是满足
 *   「SELECT 只能出现分组键与聚合函数」的形态要求，取到的就是该行原值；
 * - v_monthly_summary：近 12 月支出，DESC 取最新 12 行后在解析层倒序为升序；
 * - v_top_merchants_90d：视图内已限定 90 天窗口，按支出额降序取前 6；
 * - 活跃月数：v_monthly_summary 每 (account_id, month) 一行，COUNT(*) 即去重月数。
 */
const ANNUAL_OVERVIEW_SQL =
  "SELECT year, SUM(expense_cents), SUM(income_cents), SUM(tx_count), MAX(top_category) FROM annual_summary GROUP BY year ORDER BY year DESC LIMIT 1";

const MONTHLY_TREND_SQL =
  "SELECT month, SUM(expense_cents), SUM(expense_tx) FROM v_monthly_summary GROUP BY month ORDER BY month DESC LIMIT 12";

const TOP_MERCHANTS_SQL =
  "SELECT merchant, SUM(total_cents), SUM(tx_count) FROM v_top_merchants_90d GROUP BY merchant ORDER BY SUM(total_cents) DESC LIMIT 6";

const ACTIVE_MONTHS_SQL = "SELECT COUNT(*) FROM v_monthly_summary GROUP BY account_id";

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
}

interface ReportData {
  /** 年度总览是否来自真实聚合：控制「演示数据/本地数据」徽标与海报绘制路径 */
  isReal: boolean;
  meta: ReportMeta;
  /** 六维分聚合口径未落地前两动线同值（demo 78） */
  healthIndex: number;
  /** 四指标（订阅率/冲动浓度/餐饮占比/结余率）同样沿用 demo，见 buildReportData 注释 */
  namedMetrics: (typeof DEMO_REPORT.namedMetrics)[number][];
  storySegments: ReportStorySegment[];
}

/** demo 报告对象：lastRun === null 时整页沿用，演示路径的字段与展示保持原样 */
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
    namedMetrics: DEMO_REPORT.namedMetrics,
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

/** annual_summary 聚合行（按 ANNUAL_OVERVIEW_SQL 的 SELECT 位置取数） */
interface AnnualOverview {
  year: string;
  totalExpenseCents: number;
  totalIncomeCents: number;
  totalTx: number;
  topCategory: string | null;
}

function parseAnnualOverview(rows: Record<string, unknown>[]): AnnualOverview | null {
  const row = rows[0];
  if (!row) return null;
  const totalTx = numAt(row, 3);
  // 空库兜底：全零聚合视为无年度数据，整份报告保持 demo
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

/** 商户轴标签截断：长商户名压到 8 字符加省略号，避免 echarts 类目轴标签互相压盖 */
function shortMerchant(name: string): string {
  return name.length > 8 ? `${name.slice(0, 8)}…` : name;
}

/**
 * 年度关键词与总结口径：取 lastRun.cards 中 stage === "annual" 且 confidence
 * 最高的一张（store 落卡时已过滤 status === "published"，此处不重复过滤）。
 * headline 作为故事首段的关键词行，narrative 作为年度总结；
 * 年度阶段整体降级（无卡）时回退 demo 首段文案。
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
}

/**
 * 真实聚合 → 报告对象映射（真实优先 + 字段级 demo 兜底，任一查询失败只降级对应字段）：
 * - 年度总览（年份/月数/笔数/总额）：annual 聚合失败或空库时整体回退 demo meta；
 *   活跃月数失败时依次回退月度行数、demo 值；
 * - 故事段 1 月度趋势：monthly 聚合失败时整段回退 demo 趋势段；
 * - 故事段 3 Top 商户：merchants 聚合失败或近 90 天无支出时整段回退 demo 订阅 bar 段
 *   （bar 图 kind 对位，demo 段的订阅口径与 v_top_merchants_90d 的 bar 形态一致）；
 * - 故事段 2/4（外卖/堂食、体验/实物/服务 donut）没有本波次的真实查询来源，沿用
 *   demo 段兜底；
 * - healthIndex 与四指标的六维分/同龄基准聚合口径尚未落地（RADAR_DIMS 注释同口径），
 *   沿用 demo 值，后续接入 v_health_inputs 后本对象自动跟随。
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

  const trendSegment: ReportStorySegment =
    agg.monthly.length > 0
      ? {
          // 关键词行优先用 annual 卡 headline；无卡但有年度聚合时按聚合数字生成
          headline:
            annualCard?.headline ??
            (agg.annual
              ? `${agg.annual.year} 年支出 ¥${fmtYuan(agg.annual.totalExpenseCents)} · 共 ${agg.annual.totalTx} 笔`
              : (demoTrend ?? EMPTY_SEGMENT).headline),
          // 年度总结 = confidence 最高的 annual 卡 narrative
          narrative: annualCard?.narrative ?? (demoTrend ?? EMPTY_SEGMENT).narrative,
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

  return {
    isReal: agg.annual !== null,
    meta,
    healthIndex: demo.healthIndex,
    namedMetrics: demo.namedMetrics,
    storySegments: [
      trendSegment,
      demoFood ?? EMPTY_SEGMENT,
      merchantSegment,
      demoExperience ?? EMPTY_SEGMENT,
    ],
  };
}

// ─────────────────────────── 真实数据年度海报（本页本地实现） ───────────────────────────

/**
 * 公共层 components/report/poster-canvas.ts 的 renderPosterPng 不接受数据参数
 * （内部只读 DEMO_ACCOUNT_META / DEMO_REPORT），且该目录属公共层只读。
 * 真实动线的海报因此在本页绘制同构版本：入参即映射后的报告对象，
 * healthIndex/四指标未来接入真实口径后海报自动跟随。
 * 待公共层开放 renderPosterPng(report) 形参后，应删除本段回归公共层实现。
 */
const POSTER_W = 1080;
const POSTER_H = 1920;
const POSTER_FONT_STACK = `"PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei", system-ui, sans-serif`;

/** 渐变底上的状态色：与公共层海报同值（比页面 -ink 档亮一档保证对比度） */
const POSTER_STATUS_COLORS: Record<string, string> = {
  good: "#8df0b4",
  warn: "#ffd76a",
  serious: "#ffa58a",
};

/** 健康指数环进度色：与公共层海报同值 */
const POSTER_HEALTH_COLOR = "#7ee2a8";

function posterRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 二维码占位（与公共层海报同构：回字形定位图案 ×3 + 中心说明文字） */
function posterDrawFinder(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.fillStyle = "#16181d";
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x + size / 4, y + size / 4, size / 2, size / 2);
}

function posterDrawEcg(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(cx - 20, cy);
  ctx.lineTo(cx - 11, cy);
  ctx.lineTo(cx - 2, cy - 10);
  ctx.lineTo(cx + 5, cy + 8);
  ctx.lineTo(cx + 13, cy - 14);
  ctx.lineTo(cx + 20, cy);
  ctx.stroke();
}

/**
 * 绘制真实数据年度海报：布局与公共层 drawAnnualPoster 同构（品牌条 → 主标题 →
 * 健康指数环 → 四指标 → 段位 → 数据来源 → Logo + 二维码占位），
 * 差异仅在数据来源（入参 report）与副标题行（追加年度支出总额）。
 */
function drawReportPoster(ctx: CanvasRenderingContext2D, report: ReportData): void {
  const primary = cssVar("--color-primary", "#2e7ce8");
  const brand700 = cssVar("--color-brand-700", "#1a55ad");

  // 渐变底 + 纯装饰圆（只做层次，不承载信息）
  const bg = ctx.createLinearGradient(0, 0, 0, POSTER_H);
  bg.addColorStop(0, primary);
  bg.addColorStop(1, brand700);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, POSTER_W, POSTER_H);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.beginPath();
  ctx.arc(POSTER_W - 140, 260, 260, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-120, POSTER_H - 460, 300, 0, Math.PI * 2);
  ctx.fill();

  const cx = POSTER_W / 2;
  ctx.textAlign = "center";

  // 品牌条
  posterRoundRect(ctx, cx - 170, 96, 340, 56, 28);
  ctx.fillStyle = "rgba(255,255,255,0.14)";
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.font = `500 26px ${POSTER_FONT_STACK}`;
  ctx.textBaseline = "middle";
  ctx.fillText("SpendCT · 年度账单体检", cx, 125);

  // 主标题与副标题：年份与覆盖口径来自映射后的报告对象
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 76px ${POSTER_FONT_STACK}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(`我的 ${report.meta.year} 消费年报`, cx, 270);
  ctx.fillStyle = "rgba(255,255,255,0.82)";
  ctx.font = `400 28px ${POSTER_FONT_STACK}`;
  ctx.fillText(
    `六步体检 · 覆盖 ${report.meta.monthsCovered} 个月 · ${report.meta.totalTransactions.toLocaleString("zh-CN")} 笔 · 年度支出 ¥${fmtYuan(report.meta.totalExpenseCents)}`,
    cx,
    326,
  );

  // 健康指数环：270° 进度弧 + 中心大数字
  const ringR = 128;
  const ringY = 540;
  ctx.lineCap = "round";
  ctx.lineWidth = 20;
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.beginPath();
  ctx.arc(cx, ringY, ringR, Math.PI * 0.75, Math.PI * 2.25);
  ctx.stroke();
  const frac = Math.min(1, report.healthIndex / 100);
  ctx.strokeStyle = POSTER_HEALTH_COLOR;
  ctx.beginPath();
  ctx.arc(cx, ringY, ringR, Math.PI * 0.75, Math.PI * 0.75 + Math.PI * 1.5 * frac);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 118px ${POSTER_FONT_STACK}`;
  ctx.fillText(String(report.healthIndex), cx, ringY + 28);
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = `400 26px ${POSTER_FONT_STACK}`;
  ctx.fillText("健康指数（满分 100）", cx, ringY + 86);

  // 四指标卡：2×2
  const cardW = (POSTER_W - 88 * 2 - 24) / 2;
  const cardH = 150;
  const cardsTop = 736;
  report.namedMetrics.forEach((m, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 88 + col * (cardW + 24);
    const y = cardsTop + row * (cardH + 20);
    posterRoundRect(ctx, x, y, cardW, cardH, 20);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fill();

    const statusColor = POSTER_STATUS_COLORS[m.status] ?? "#ffffff";

    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.font = `500 24px ${POSTER_FONT_STACK}`;
    ctx.fillText(m.name, x + 28, y + 42);

    // delta 放右侧：变化幅度紧贴基准读数
    ctx.textAlign = "right";
    ctx.fillStyle = statusColor;
    ctx.font = `600 26px ${POSTER_FONT_STACK}`;
    ctx.fillText(m.delta, x + cardW - 28, y + 42);

    ctx.textAlign = "left";
    ctx.fillStyle = statusColor;
    ctx.font = `800 46px ${POSTER_FONT_STACK}`;
    ctx.fillText(m.value, x + 28, y + 96);
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = `400 22px ${POSTER_FONT_STACK}`;
    ctx.fillText(`同龄人平均 ${m.benchmark}`, x + 28, y + 130);
  });

  // 段位条
  const rank = getRankTier();
  const rankY = cardsTop + 2 * (cardH + 20) + 28;
  posterRoundRect(ctx, 88, rankY, POSTER_W - 176, 112, 20);
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fill();
  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 34px ${POSTER_FONT_STACK}`;
  ctx.fillText(`段位 Lv.${rank.tier} · ${rank.name}`, 116, rankY + 56);
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = `400 24px ${POSTER_FONT_STACK}`;
  ctx.fillText(rank.desc, 116, rankY + 96);

  // 数据来源：突出本地计算承诺
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = `400 24px ${POSTER_FONT_STACK}`;
  ctx.fillText("你的账单全程只在浏览器本地分析，数据不会上传", cx, rankY + 112 + 72);

  // 底部：Logo + 二维码占位
  const footerY = POSTER_H - 360;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(150, footerY + 40, 34, 0, Math.PI * 2);
  ctx.fill();
  posterDrawEcg(ctx, 150, footerY + 40, brand700);
  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 34px ${POSTER_FONT_STACK}`;
  ctx.textBaseline = "middle";
  ctx.fillText("SpendCT", 210, footerY + 40);

  const qrSize = 240;
  const qrX = POSTER_W - 88 - qrSize;
  const qrY = footerY - 70;
  posterRoundRect(ctx, qrX, qrY, qrSize, qrSize, 24);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  posterDrawFinder(ctx, qrX + 40, qrY + 40, 56);
  posterDrawFinder(ctx, qrX + qrSize - 96, qrY + 40, 56);
  posterDrawFinder(ctx, qrX + 40, qrY + qrSize - 96, 56);
  ctx.fillStyle = "#8a8f99";
  ctx.font = `500 24px ${POSTER_FONT_STACK}`;
  ctx.textAlign = "center";
  ctx.fillText("作品二维码位", qrX + qrSize / 2, qrY + qrSize / 2);
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = `400 22px ${POSTER_FONT_STACK}`;
  ctx.fillText("扫码查看完整报告", qrX + qrSize / 2, qrY + qrSize + 46);
}

/** 在内存 canvas 上渲染真实数据海报并输出 PNG Blob：不插入 DOM，下载由调用方处理 */
function renderReportPosterPng(report: ReportData): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = POSTER_W;
      canvas.height = POSTER_H;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }
      drawReportPoster(ctx, report);
      canvas.toBlob((blob) => resolve(blob), "image/png");
    } catch {
      // 绘制异常（如字体度量缺失）不抛出：调用方按失败提示
      resolve(null);
    }
  });
}

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
        radius: "95%",
        center: ["50%", "58%"],
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

/** 六维健康雷达：单系列多边形，面积填充半透明主色 */
const buildRadarOption = (): ECOption => {
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
      indicator: RADAR_DIMS.map((d) => ({ name: d.name, max: 100 })),
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
        data: [{ value: RADAR_DIMS.map((d) => d.value), name: "六维健康分" }],
      },
    ],
  };
};

/**
 * 数据故事四段各自的图表工厂。storySegments 的 chartData 单位不统一：
 * timeseries/donut 为元或百分比刻度，bar（订阅/商户段）为分——按段语义分别换算。
 */
function buildStoryOption(seg: ReportStorySegment): () => ECOption {
  return () => {
    const t = chartTokens();
    const tooltipBase = {
      backgroundColor: t.surface,
      borderColor: t.lineHair,
      textStyle: { color: t.ink },
    };

    if (seg.chartKind === "timeseries") {
      const primary = t.palette[0] ?? "#2e7ce8";
      return {
        grid: { left: 8, right: 8, top: 28, bottom: 8, containLabel: true },
        tooltip: {
          ...tooltipBase,
          trigger: "axis",
          valueFormatter: (value: unknown) => `${value} 元`,
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
          axisLabel: { color: t.inkMuted },
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
          axisLabel: { color: t.inkSecondary },
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

    // donut：分类占比，图例 + 直标百分比，颜色按实体固定顺序取色板
    return {
      tooltip: { ...tooltipBase, trigger: "item", formatter: "{b}：{d}%" },
      legend: {
        bottom: 0,
        icon: "circle",
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { color: t.inkSecondary },
      },
      series: [
        {
          type: "pie",
          radius: ["52%", "74%"],
          center: ["50%", "44%"],
          label: { show: true, color: t.ink, formatter: "{b}\n{d}%", fontSize: 11 },
          labelLine: { length: 8, length2: 6 },
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
  const rank = useMemo(() => getRankTier(), []);
  const [unlockedIds, setUnlockedIds] = useState<string[]>(() => getUnlockedIds());
  const [posterBusy, setPosterBusy] = useState(false);
  const [toast, setToast] = useState<{ id: number; text: string; kind: "ok" | "error" } | null>(
    null,
  );

  // 数据源：最近一次体检运行。null = 演示路径（整页保持 DEMO_REPORT 静态展示）；
  // 存在 = 真实优先，effect 里从预计算表/视图聚合，失败字段逐项回退 demo
  const lastRun = usePipeline((s) => s.lastRun);
  const [report, setReport] = useState<ReportData>(demoReportData);

  useEffect(() => {
    // 演示路径不发起任何查询
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

      // 四条确定性聚合并行执行；allSettled 保证任一失败不拖垮其余字段
      const [annualRes, monthlyRes, merchantsRes, monthsRes] = await Promise.allSettled([
        runWhitelistedAggregate(conn, ANNUAL_OVERVIEW_SQL),
        runWhitelistedAggregate(conn, MONTHLY_TREND_SQL),
        runWhitelistedAggregate(conn, TOP_MERCHANTS_SQL),
        runWhitelistedAggregate(conn, ACTIVE_MONTHS_SQL),
      ]);
      if (cancelled) return;

      const rowsOf = (
        res: PromiseSettledResult<{ rows: unknown[] }>,
      ): Record<string, unknown>[] =>
        res.status === "fulfilled" ? (res.value.rows as Record<string, unknown>[]) : [];

      const annual =
        annualRes.status === "fulfilled" ? parseAnnualOverview(rowsOf(annualRes)) : null;
      const monthly =
        monthlyRes.status === "fulfilled" ? parseMonthlyTrend(rowsOf(monthlyRes)) : [];
      const merchants =
        merchantsRes.status === "fulfilled" ? parseTopMerchants(rowsOf(merchantsRes)) : [];
      const monthCount =
        monthsRes.status === "fulfilled" ? numAt(rowsOf(monthsRes)[0] ?? {}, 0) : 0;

      setReport(
        buildReportData(
          { annual, monthly, merchants, activeMonths: monthCount > 0 ? monthCount : null },
          lastRun.cards,
        ),
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [lastRun]);

  // 报告页是段位的计算源头：重算后写回本地，个人中心与海报读同一份
  useEffect(() => {
    saveRankTier(rank.tier);
  }, [rank.tier]);

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

  const handlePoster = useCallback(async () => {
    setPosterBusy(true);
    try {
      // 真实动线用映射后的报告对象绘制海报；演示动线保持公共层原路径不动
      const blob = report.isReal
        ? await renderReportPosterPng(report)
        : await renderPosterPng();
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
      // 生成海报即解锁对应成就，成就墙对新徽章播放弹入动画
      setUnlockedIds(unlockAchievement("annual-poster"));
    } catch {
      showToast("海报生成失败，请重试", "error");
    } finally {
      setPosterBusy(false);
    }
  }, [showToast, report]);

  return (
    <Container wide className="py-8">
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
            {report.isReal ? "本地数据" : "演示数据"}
          </span>
        </div>
      </header>

      {/* Hero：健康仪表 + 四具名指标 */}
      <section aria-label="健康总览" className="mt-6 grid gap-4 lg:grid-cols-5">
        <div className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-4 shadow-(--shadow-sm) lg:col-span-2">
          <EChart
            option={gaugeOption}
            height={272}
            ariaLabel={`消费健康指数仪表盘：${report.healthIndex} 分`}
          />
          <p className="text-center text-xs text-(--color-ink-muted)">
            综合六维消费健康分 · 满分 100
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
                  <span className="text-(--color-ink-muted)">同龄人平均 {m.benchmark}</span>
                </p>
                <p className="mt-2 text-xs leading-relaxed text-(--color-ink-muted)">
                  {m.explain}
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
                className="grid gap-4 rounded-(--radius-xl) border border-(--color-border) bg-(--color-surface) p-5 shadow-(--shadow-sm) md:grid-cols-2 md:p-6"
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
      <section aria-label="段位与成就" className="mt-8 grid gap-4 lg:grid-cols-5">
        <RankBadge tier={rank} className="lg:col-span-2" />
        <div className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-4 shadow-(--shadow-sm) lg:col-span-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Trophy className="size-4 text-(--color-primary)" aria-hidden />
              六维健康雷达
            </h2>
            <span className="text-xs text-(--color-ink-muted)">分数越高越健康</span>
          </div>
          <EChart option={buildRadarOption} height={300} ariaLabel="六维健康雷达图：餐饮、购物、交通、娱乐、居住、其他六个维度的健康分" />
        </div>
      </section>

      {featureFlags.achievements ? (
        <section aria-label="成就墙" className="mt-4">
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
      <section aria-label="海报与导出" className="mt-8">
        <div className="rounded-(--radius-xl) border border-(--color-border) bg-(--color-surface) p-5 shadow-(--shadow-sm) md:p-6">
          <h2 className="text-lg font-bold">海报与导出</h2>
          <p className="mt-1 text-sm text-(--color-ink-secondary)">
            生成一张高清年度海报，长按可分享；海报在你的设备上直接生成，不上传任何数据。
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
              onClick={() => showToast("PDF 导出即将上线")}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-(--color-border) px-5 text-sm font-medium transition-colors hover:border-(--color-border-strong)"
            >
              <FileText className="size-4" aria-hidden />
              导出 PDF
            </button>
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-xs text-(--color-ink-muted)">
            <CircleCheck className="size-3.5" aria-hidden />
            生成海报会自动解锁「年度海报」成就；PDF 导出功能即将开放。
          </p>
        </div>
      </section>

      {/* 轻提示：底部居中，不打断操作 */}
      <AnimatePresence>
        {toast ? (
          <div
            key={toast.id}
            className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-4 md:bottom-8"
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
  );
}
