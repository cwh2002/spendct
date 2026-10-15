/**
 * 工具 get_school_calendar：高校校历查询（契约见 docs/04-rag-mcp.md §8.1）。
 *
 * 数据源为 2026-2027 学年公开校历汇编（data/school-calendar-2026-2027.json），
 * 支持按事件类型 / 日期落点 / 地区过滤。典型用途：追问场景中把
 * 「考试周」等季节性事件作为消费波动的归因依据（消费洞察的校历上下文）。
 */
import { z } from "zod";
import { readJson } from "../data/load.js";
import { okResult, type ToolResult } from "../types.js";

export const SCHOOL_EVENT_TYPES = [
  "exam_week",
  "vacation",
  "term_start",
  "graduation",
] as const;

export type SchoolEventType = (typeof SCHOOL_EVENT_TYPES)[number];

export interface SchoolCalendarEvent {
  id: string;
  name: string;
  type: SchoolEventType;
  startDate: string; // YYYY-MM-DD，含首尾
  endDate: string;
  region: string;
  note: string;
  source: string;
}

interface SchoolCalendarData {
  version: string;
  academicYear: string;
  source: string;
  events: SchoolCalendarEvent[];
}

/** MCP inputSchema（原始 shape，由 SDK 包装为 zod 对象） */
export const schoolCalendarInputShape = {
  type: z
    .enum(SCHOOL_EVENT_TYPES)
    .optional()
    .describe("事件类型：考试周 / 假期 / 开学 / 毕业季"),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式应为 YYYY-MM-DD")
    .optional()
    .describe("落点日期，返回覆盖该日期的事件"),
  region: z.string().max(32).optional().describe("地区过滤，如 nationwide"),
} as const;

export interface SchoolCalendarArgs {
  type?: SchoolEventType;
  date?: string;
  region?: string;
}

export function querySchoolCalendar(
  args: SchoolCalendarArgs,
): ToolResult<SchoolCalendarEvent[]> {
  const data = readJson<SchoolCalendarData>("school-calendar-2026-2027.json");
  let events = [...data.events];

  const { type, date, region } = args;
  if (type !== undefined) {
    events = events.filter((e) => e.type === type);
  }
  if (date !== undefined) {
    // ISO 日期字符串可按字典序比较，覆盖语义为 [startDate, endDate] 闭区间
    events = events.filter(
      (e) => e.startDate <= date && date <= e.endDate,
    );
  }
  if (region !== undefined) {
    events = events.filter((e) => e.region === region);
  }
  events.sort((a, b) => a.startDate.localeCompare(b.startDate));

  return okResult(events, `高校校历汇编（${data.academicYear}）· ${data.source}`);
}
