/**
 * 工具 get_promo_calendar：电商大促日历查询（契约见 docs/04-rag-mcp.md §8.3）。
 *
 * 数据源为电商平台历年固定档期汇编（data/promo-calendar-2026.json），
 * 支持按日期落点 / 品类 / 平台过滤。典型用途：追问场景中把「双11 预热期」
 * 等促销档期作为消费波动的归因依据，并用于消费建议中的比价时机提示。
 */
import { z } from "zod";
import { readJson } from "../data/load.js";
import { okResult, type ToolResult } from "../types.js";

export interface PromoEvent {
  id: string;
  name: string;
  category: string;
  startDate: string; // YYYY-MM-DD，含首尾
  endDate: string;
  platforms: string[];
  note: string;
  source: string;
}

interface PromoCalendarData {
  version: string;
  year: number;
  source: string;
  promotions: PromoEvent[];
}

/** MCP inputSchema（原始 shape，由 SDK 包装为 zod 对象） */
export const promoCalendarInputShape = {
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式应为 YYYY-MM-DD")
    .optional()
    .describe("落点日期，返回覆盖该日期的档期"),
  category: z.string().max(32).optional().describe("品类过滤，如 shopping"),
  platform: z.string().max(32).optional().describe("平台过滤，如 淘宝"),
} as const;

export interface PromoCalendarArgs {
  date?: string;
  category?: string;
  platform?: string;
}

export function queryPromoCalendar(args: PromoCalendarArgs): ToolResult<PromoEvent[]> {
  const data = readJson<PromoCalendarData>("promo-calendar-2026.json");
  let promotions = [...data.promotions];

  const { date, category, platform } = args;
  if (date !== undefined) {
    // 与校历工具一致：ISO 日期字典序比较，[startDate, endDate] 闭区间
    promotions = promotions.filter(
      (p) => p.startDate <= date && date <= p.endDate,
    );
  }
  if (category !== undefined) {
    promotions = promotions.filter((p) => p.category === category);
  }
  if (platform !== undefined) {
    promotions = promotions.filter((p) => p.platforms.includes(platform));
  }
  promotions.sort((a, b) => a.startDate.localeCompare(b.startDate));

  return okResult(promotions, `电商大促日历汇编（${data.year}）· ${data.source}`);
}
