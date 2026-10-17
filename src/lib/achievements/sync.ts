/**
 * 成就判定组装层（WP8 §8a）：把「存储里的行为数据」与「页面装载后的视图数据」
 * 合并成快照，交给 rules.evaluateAchievements 判定，命中集与已解锁集取并集写回
 * 并通知订阅组件重渲染。
 *
 * 数据分两类：
 * - 存储侧（buildSnapshotFromStorage 每次全量读 localStorage）：
 *   体检次数 / 最近体检小时 / 手动记账日期 / 挑战打卡 / 行为进度四字段；
 * - 视图侧（页面数据装载完成后以 overrides 传入 recheckAll）：
 *   沉默订阅（订阅页用 hasSilentSubscription 判好传 silentSubscription）、
 *   预算月表、逐月支出、收藏数等——这些数据只在页面装载的某个时刻存在，
 *   存储里没有全量留底。
 *
 * overrides 会合并进模块级 lastOverrides：预算页装载时传一次 budgetMonths 与
 * monthlyExpenses，之后保存/删除手动账再 recheckAll() 不带参，仍复用同一份
 * 视图数据（当月账单数据不会在两次调用之间变化）。
 *
 * 规则层（rules.ts）保持纯函数：本模块负责 Date / localStorage 这两个不纯来源，
 * 快照一旦组装好，判定结果完全确定。
 */

import { commitUnlockedIds, getUnlockedIds } from "@/lib/achievements";
import { sanitizeManualEntries } from "@/lib/budget/manual-merge";
import { readChallenge } from "@/lib/insights/challenge-store";
import { toDateKey } from "@/lib/insights/challenge-sql";

import { readProgress } from "./progress";
import { evaluateAchievements } from "./rules";
import type { AchievementSnapshot } from "./rules";

/** 体检次数落盘键（runner 真实跑完管线后自增，WP8 §8e；me 页展示共用，改键只动此处） */
export const CHECKUP_COUNT_KEY = "spendct:checkup-count:v1";
/** 最近体检小时落盘键（0-23，runner 记体检完成时刻的小时） */
export const LAST_CHECKUP_HOUR_KEY = "spendct:last-checkup-hour:v1";
/** 手动账本键：与 notifications.MANUAL_ENTRIES_KEY 同一本账（预算页/挑战页共用） */
const MANUAL_ENTRIES_KEY = "spendct:manual-entries";

/**
 * 模块级 overrides 缓存：recheckAll(overrides) 传入的视图数据合并进这里，
 * 供之后无参 recheckAll 复用（见文件头注释）。
 */
let lastOverrides: Partial<AchievementSnapshot> = {};

/**
 * 清空视图侧 overrides 缓存：新数据集导入落库后调用（CSV / OCR 两条路径的
 * 合并落库收口处）。换数据集后旧视图字段（预算月表 / 逐月支出等）全部作废，
 * 下一次页面装载会重新传入新值；不清理的话，无参 recheckAll 会拿旧数据集的
 * 月表继续判定（saver 等），而解锁集只并集不回退，误命中一次就永久保留。
 */
export function resetRecheckOverrides(): void {
  lastOverrides = {};
}

/**
 * 组装判定快照：存储侧字段读 localStorage（缺失/损坏回退零值），
 * 其余字段取 overrides 与 lastOverrides 合并后的值（overrides 优先级最高，
 * 每字段都能被显式覆盖，便于调用方与单测注入）。overrides 同时合并进
 * lastOverrides 缓存。
 */
export function buildSnapshotFromStorage(
  overrides?: Partial<AchievementSnapshot>,
): AchievementSnapshot {
  if (overrides) {
    lastOverrides = { ...lastOverrides, ...overrides };
  }
  const merged = lastOverrides;
  const progress = readProgress();
  return {
    today: merged.today ?? toDateKey(new Date()),
    checkupCount: merged.checkupCount ?? readStoredCheckupCount(),
    lastCheckupHour:
      merged.lastCheckupHour !== undefined ? merged.lastCheckupHour : readStoredLastCheckupHour(),
    silentSubscription: merged.silentSubscription ?? false,
    manualDays: merged.manualDays ?? readStoredManualDays(),
    budgetMonths: merged.budgetMonths ?? [],
    adopted: merged.adopted ?? progress.adopted,
    monthlyExpenses: merged.monthlyExpenses ?? [],
    activatedBenefits: merged.activatedBenefits ?? progress.activatedBenefits,
    dedupeSkippedTotal: merged.dedupeSkippedTotal ?? progress.dedupeSkippedTotal,
    followupCount: merged.followupCount ?? progress.followupCount,
    favoriteCount: merged.favoriteCount ?? 0,
    challengeCheckins: merged.challengeCheckins ?? readStoredChallengeCheckins(),
  };
}

/**
 * 全量重算：组装快照 → 12 枚规则判定 → 命中集与已解锁集并集写回。
 * 返回本次重算后的完整解锁集。调用点（体检完成/记账保存/打卡/收藏/追问/
 * 导入去重后等）在任何行为数据变化后调一次即可，幂等。
 */
export function recheckAll(overrides?: Partial<AchievementSnapshot>): string[] {
  return applyRecheck(evaluateAchievements(buildSnapshotFromStorage(overrides)));
}

/**
 * 命中集与现有解锁集取并集，写 "spendct:achievements:v1" 并通知订阅组件，
 * 返回更新后的全集。无新增时不落盘不通知（并集未变，避免无意义的重渲染）。
 */
export function applyRecheck(hitIds: string[]): string[] {
  const current = getUnlockedIds();
  const next = [...current];
  for (const id of hitIds) {
    if (!next.includes(id)) next.push(id);
  }
  if (next.length === current.length) return next;
  return commitUnlockedIds(next);
}

/* ---- 存储侧读取（每个键独立防御：node 环境/损坏数据回退零值） ---- */

/**
 * 读数字型存储：值可能是 JSON 数字或数字字符串（两任写入方习惯不同），
 * 解析失败返回 null 由调用方决定回退值。
 */
function readStoredNumber(key: string): number | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null) return null;
    const n =
      typeof parsed === "number"
        ? parsed
        : typeof parsed === "string" && parsed.trim() !== ""
          ? Number(parsed)
          : Number.NaN;
    return Number.isFinite(n) ? Math.floor(n) : null;
  } catch {
    return null;
  }
}

/** 体检次数：缺失/损坏/负数按 0 */
function readStoredCheckupCount(): number {
  const n = readStoredNumber(CHECKUP_COUNT_KEY);
  return n === null || n < 0 ? 0 : n;
}

/** 最近体检小时：缺失/损坏/越界（0-23 之外）按 null（无数据，early-bird 不命中） */
function readStoredLastCheckupHour(): number | null {
  const n = readStoredNumber(LAST_CHECKUP_HOUR_KEY);
  return n === null || n < 0 || n > 23 ? null : n;
}

/**
 * 有手动记账的日期（expense 口径，去重升序）：与预算页同一本账，逐条
 * sanitize 防御手工改坏的脏条目，只取日期本身参与连续判定。
 */
function readStoredManualDays(): string[] {
  if (typeof localStorage === "undefined") return [];
  let list: unknown = [];
  try {
    const raw = localStorage.getItem(MANUAL_ENTRIES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) list = parsed;
  } catch {
    return []; // 账本损坏：按无记账处理
  }
  const days = new Set<string>();
  for (const entry of sanitizeManualEntries(list)) {
    if (entry.direction === "expense") days.add(entry.ts);
  }
  return [...days].sort();
}

/** 挑战打卡日期集：读挑战记录（readChallenge 自带形态校验），无挑战为空集 */
function readStoredChallengeCheckins(): string[] {
  return readChallenge()?.checkins ?? [];
}
