/**
 * 省钱挑战打卡的本地状态层（修订案 A17）。
 *
 * 挑战配置与打卡记录持久化在 localStorage "spendct:challenge:v1"：
 * 一条记录 = 挑战类目 + 每日预算 + 基线日均 + 开始日 + 已打卡日期集。
 * 统计口径（逐日状态 / 连续打卡 / 累计节省）全部是纯函数、只吃入参，
 * 读写函数只做存储边界（隐私模式下不可写时静默降级），可直接单测。
 */

import {
  addDays,
  CHALLENGE_BASELINE_DAYS,
  CHALLENGE_DURATION_DAYS,
  averageDaily,
  seriesOf,
  toDateKey,
  type CategoryDayCents,
} from "./challenge-sql";

const STORAGE_KEY = "spendct:challenge:v1";

export interface ChallengeRecord {
  /** 挑战类目（12 类之一） */
  category: string;
  /** 每日预算（分） */
  quotaCents: number;
  /** 挑战前 30 天该类目日均支出（分）：节省额口径基准 */
  baselineCents: number;
  /** 开始日 YYYY-MM-DD（当天即挑战第 1 天） */
  startDate: string;
  /** 已打卡日期集（升序去重） */
  checkins: string[];
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 读挑战记录：解析失败、字段缺失或形态不合法一律按无记录处理，不抛异常 */
export function readChallenge(): ChallengeRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const rec = parsed as Partial<ChallengeRecord>;
    if (
      typeof rec.category !== "string" ||
      rec.category.length === 0 ||
      typeof rec.quotaCents !== "number" ||
      rec.quotaCents <= 0 ||
      typeof rec.baselineCents !== "number" ||
      typeof rec.startDate !== "string" ||
      !DATE_KEY_RE.test(rec.startDate) ||
      !Array.isArray(rec.checkins)
    ) {
      return null;
    }
    return {
      category: rec.category,
      quotaCents: Math.round(rec.quotaCents),
      baselineCents: Math.round(rec.baselineCents),
      startDate: rec.startDate,
      checkins: rec.checkins
        .filter((d): d is string => typeof d === "string" && DATE_KEY_RE.test(d))
        .sort(),
    };
  } catch {
    // 存储不可用（隐私模式）或内容损坏：按无记录处理
    return null;
  }
}

/** 写挑战记录：隐私模式不可写时静默降级（仅本次会话生效） */
export function saveChallenge(record: ChallengeRecord): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // 隐私模式不可写：跳过持久化
  }
}

/** 清空挑战记录（放弃挑战 / 完成后「再来一次」都走这里） */
export function clearChallenge(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 隐私模式不可写：无操作
  }
}

/** 打卡（幂等）：同一天重复打卡不产生重复记录，返回更新后的记录 */
export function checkIn(record: ChallengeRecord, dateKey: string): ChallengeRecord {
  if (record.checkins.includes(dateKey)) return record;
  return { ...record, checkins: [...record.checkins, dateKey].sort() };
}

/** 取消打卡：误点后的回退入口，返回更新后的记录 */
export function uncheck(record: ChallengeRecord, dateKey: string): ChallengeRecord {
  if (!record.checkins.includes(dateKey)) return record;
  return { ...record, checkins: record.checkins.filter((d) => d !== dateKey) };
}

/**
 * 连续打卡天数：从今天往回数；今天还没打卡时从昨天起算——
 * 当天打上卡就算 1 天，昨天断档则连续数为 0。
 */
export function streakOf(checkins: string[], todayKey: string): number {
  const set = new Set(checkins);
  let cursor = set.has(todayKey) ? todayKey : addDays(todayKey, -1);
  let streak = 0;
  while (set.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/** 挑战期内逐日状态：挑战页「今日卡 / 近 7 天条 / 完成回顾」的唯一数据来源 */
export interface ChallengeDayStatus {
  /** YYYY-MM-DD */
  date: string;
  /** 当日该类目实际支出（分，无记录为 0） */
  cents: number;
  /** 当日预算（分，整条挑战共用） */
  quotaCents: number;
  /** 当天是否已打卡 */
  checked: boolean;
  /** 当天是否达标：支出 ≤ 预算 */
  passed: boolean;
  /** 当天节省：基线 − 实际（可为负，即超支） */
  savedCents: number;
}

/**
 * 生成挑战逐日状态：从开始日到「第 21 天与今天的较小者」——
 * 未来的天不生成（没有实际支出），挑战结束后最后一天仍计入。
 */
export function buildChallengeDays(
  record: ChallengeRecord,
  points: CategoryDayCents[],
  todayKey: string,
): ChallengeDayStatus[] {
  const series = seriesOf(points, record.category);
  const endKey = addDays(record.startDate, CHALLENGE_DURATION_DAYS - 1);
  const lastKey = endKey < todayKey ? endKey : todayKey;
  const checked = new Set(record.checkins);
  const days: ChallengeDayStatus[] = [];
  for (let key = record.startDate; key <= lastKey; key = addDays(key, 1)) {
    const cents = series.get(key) ?? 0;
    days.push({
      date: key,
      cents,
      quotaCents: record.quotaCents,
      checked: checked.has(key),
      passed: cents <= record.quotaCents,
      savedCents: record.baselineCents - cents,
    });
  }
  return days;
}

/** 挑战汇总：概览四宫格与完成回顾共用 */
export interface ChallengeTotals {
  /** 已打卡天数 */
  checkedDays: number;
  /** 达标天数（支出 ≤ 预算，不要求打卡） */
  passedDays: number;
  /** 累计节省：Σ max(0, 基线 − 实际)，只计正贡献 */
  savedCents: number;
  /** 累计超支：Σ max(0, 实际 − 基线) */
  overCents: number;
  /** 挑战是否已结束：今天晚于第 21 天 */
  finished: boolean;
}

export function summarizeDays(days: ChallengeDayStatus[], finished: boolean): ChallengeTotals {
  let checkedDays = 0;
  let passedDays = 0;
  let savedCents = 0;
  let overCents = 0;
  for (const day of days) {
    if (day.checked) checkedDays += 1;
    if (day.passed) passedDays += 1;
    if (day.savedCents > 0) savedCents += day.savedCents;
    else overCents -= day.savedCents;
  }
  return { checkedDays, passedDays, savedCents, overCents, finished };
}

/** 创建挑战时的基线：开始日前 30 个自然日的日均支出（窗口内无记录返回 0） */
export function computeBaselineCents(
  points: CategoryDayCents[],
  category: string,
  startDate: string,
): number {
  const series = seriesOf(points, category);
  const from = addDays(startDate, -CHALLENGE_BASELINE_DAYS);
  return averageDaily(series, from, addDays(startDate, -1));
}

/**
 * 校验挑战是否过期：开始日早于「今天 − 21 天」即已结束（结束日当天仍算进行中，
 * 由 buildChallengeDays 的 lastKey 与 summarizeDays 的 finished 表达同一口径）。
 * 过期记录在读取时由视图决定清理时机，本函数只做判定。
 */
export function isChallengeExpired(record: ChallengeRecord, today: Date): boolean {
  const endKey = addDays(record.startDate, CHALLENGE_DURATION_DAYS - 1);
  return endKey < toDateKey(today);
}
