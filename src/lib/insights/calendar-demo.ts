/**
 * 消费日历页（A15 第四部分）的演示流水生成器。
 *
 * 与 ledger-demo.ts / merchant-detail.ts 同口径：无体检结果（lastRun 为空）
 * 或 DuckDB 查询失败时，消费日历回退到同一批确定性演示流水——以账本演示行
 * 为底，补上时分秒与方向点缀；固定种子固定输出，重渲染不「洗牌」。
 */

import { generateLedgerDemoRows } from "@/lib/insights/ledger-demo";
import type { CalendarTimelineRow } from "@/lib/insights/calendar-aggregate";

/** 演示收入商户池：方向徽标与「收入」筛选在演示动线下有真实可筛的内容 */
const INCOME_MERCHANTS = ["兼职工资", "奖学金到账", "闲置转卖", "红包入账"] as const;

/**
 * 生成 100 行演示流水（时间倒序）：
 * - 时分秒按行 id 确定性点缀（hour=(id*7)%24 因 gcd(7,24)=1 在 0-23 全量循环，
 *   深夜小时（23、0-4）约占 1/4，保证深夜徽标可见，与 merchant-detail 同款算法）；
 * - 每 9 笔插一笔收入（id % 9 === 0，共 11 行），其余为支出，方向筛选两种档位
 *   都有内容；
 * - 金额与商户直接复用账本演示行（generateLedgerDemoRows），与账本汇总 /
 *   商户统计两个视图的演示口径一致。
 */
export function generateCalendarDemoRows(): CalendarTimelineRow[] {
  const pad = (n: number) => String(n).padStart(2, "0");
  // 显式标注返回类型：让方向字段的字面量联合（income | expense）获得上下文收窄
  const rows: CalendarTimelineRow[] = generateLedgerDemoRows().map((row) => {
    const hour = (row.id * 7) % 24;
    const minute = (row.id * 13) % 60;
    const second = (row.id * 29) % 60;
    const date = new Date(row.date);
    date.setHours(hour, minute, second, 0);
    const isIncome = row.id % 9 === 0;
    return {
      id: row.id,
      ts: date,
      dateIso: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
      merchant: isIncome ? (INCOME_MERCHANTS[row.id % INCOME_MERCHANTS.length] ?? "红包入账") : row.merchant,
      category: isIncome ? "其他" : row.category,
      amountCents: row.amountCents,
      direction: isIncome ? "income" : "expense",
    };
  });
  return rows.sort((a, b) => b.ts.getTime() - a.ts.getTime());
}
