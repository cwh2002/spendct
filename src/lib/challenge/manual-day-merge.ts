/**
 * 挑战页「记今日支出」的手动账合并纯函数（WP4 §4a）。
 *
 * 挑战页与预算页共用同一条 localStorage 手动账本（键 spendct:manual-entries，
 * 条目形状复用 src/lib/budget/manual-merge 的 ManualEntry）：挑战页只往里写
 * 「当日 + 挑战类目」的 expense 记录，读进来后在渲染期把手动账按
 * (category, date) 叠加到账单查询点（points）上——今日卡、近 7 天条、
 * 完成回顾等一切消费端都走合并后的序列，即时联动、无需重查 DuckDB。
 *
 * 口径约定：手动账从今天起才有记录，挑战开始前的 30 天基线窗口不受影响；
 * income 记录不参与合并（挑战跟踪的是支出）；金额一律整数分；
 * 日期键统一 YYYY-MM-DD（与 challenge-sql 的 CategoryDayCents.date 同口径）。
 * 三个函数全是纯函数：只吃入参、不改入参、返回新数组，可直接单测。
 */

import type { ManualEntry } from "@/lib/budget/manual-merge";
import type { CategoryDayCents } from "@/lib/insights/challenge-sql";

/** 挑战页新增手动账的 note 占位文案：预算页「最近记账」列表里能看出这笔的来源 */
const CHALLENGE_MANUAL_NOTE = "挑战页手动记录";

/** (category, date) 组合键：\u0000 分隔避免类目名与日期边界拼接歧义 */
function keyOf(category: string, date: string): string {
  return `${category}\u0000${date}`;
}

/**
 * 当日同类目支出覆盖 / 追加（纯函数，返回新数组，不改入参）：
 * - 已有「同 ts + 同类目 + direction==="expense"」的记录：覆盖金额，
 *   保留原 id 与 note（同一天同类目只保留一笔，与今日卡展示一致）；
 * - 没有：追加一条新 ManualEntry（id 与预算页快速记账同款
 *   `时间戳-随机尾缀`，direction 固定 "expense"，note 写挑战页占位文案）；
 * - income 记录既不参与匹配，也不被覆盖。
 * 调用方负责把返回结果写回 localStorage（与预算页同键同款写回）。
 */
export function upsertManualDayEntry(
  entries: readonly ManualEntry[],
  input: { ts: string; category: string; amountCents: number },
): ManualEntry[] {
  const hitIndex = entries.findIndex(
    (entry) =>
      entry.direction === "expense" && entry.ts === input.ts && entry.category === input.category,
  );
  if (hitIndex >= 0) {
    // 只覆盖金额：id 保持不变（列表 key 稳定），note 保留原值
    return entries.map((entry, index) =>
      index === hitIndex ? { ...entry, amountCents: input.amountCents } : entry,
    );
  }
  return [
    ...entries,
    {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ts: input.ts,
      direction: "expense",
      category: input.category,
      amountCents: input.amountCents,
      note: CHALLENGE_MANUAL_NOTE,
    },
  ];
}

/**
 * 手动支出叠加到逐日类目支出点（纯函数，返回新数组，不改入参）：
 * 每条 expense 手动账按 (category, date) 叠加到 points 的 cents；
 * points 中没有该组合时补一个新点（排在原有点之后，原顺序保持）；
 * income 记录与金额非正或非数字的脏记录不参与。演示序列与真实查询共用此函数。
 */
export function mergeChallengePoints(
  points: readonly CategoryDayCents[],
  entries: readonly ManualEntry[],
): CategoryDayCents[] {
  // 先整体浅拷贝原有点：Map 保持插入序 = 原有点在前、补点在后的输出顺序
  const byKey = new Map<string, CategoryDayCents>();
  for (const point of points) {
    byKey.set(keyOf(point.category, point.date), { ...point });
  }
  for (const entry of entries) {
    if (
      entry.direction !== "expense" ||
      !Number.isFinite(entry.amountCents) ||
      entry.amountCents <= 0
    )
      continue;
    const key = keyOf(entry.category, entry.ts);
    const existing = byKey.get(key);
    if (existing) {
      existing.cents += entry.amountCents;
    } else {
      byKey.set(key, { category: entry.category, date: entry.ts, cents: entry.amountCents });
    }
  }
  return [...byKey.values()];
}

/** 该日该类目 expense 手动账金额合计（分）；没有记录返回 0（今日卡「含手动记录」小注用） */
export function manualDayCents(
  entries: readonly ManualEntry[],
  category: string,
  date: string,
): number {
  let total = 0;
  for (const entry of entries) {
    if (entry.direction === "expense" && entry.category === category && entry.ts === date) {
      total += entry.amountCents;
    }
  }
  return total;
}
